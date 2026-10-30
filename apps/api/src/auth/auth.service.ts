import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { hashToken } from '../common/auth.guard';
import { slugify } from '../common/permissions';
import { AuditService } from '../audit/audit.service';
import { FAIL_WINDOW_MS, MAX_FAILS, lockoutMs } from '../common/rate-limit';
import { EmailService } from '../common/email.service';
import { appUrl, requireEmailVerification } from '../common/config';
import type { VerifiedGoogleUser } from './google-oauth';

export const SESSION_HOURS = 12;
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8e4KQGw.b5n3MGQ7IC0zRx1cQ6wD9e';
const MAX_TRACKED = 50_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 30 * 60_000;

type Failure = { count: number; lockedUntil: number; lastSeen: number };
/** Keyed by IP + email: an attacker on one address cannot lock a victim out from another. */
const failures = new Map<string, Failure>();

function trackFailure(key: string, value: Failure) {
  if (!failures.has(key) && failures.size >= MAX_TRACKED) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(key, value);
}

export function assertPasswordPolicy(pw: string) {
  if (pw.length < 10) throw new BadRequestException('Password must be at least 10 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new BadRequestException('Password must contain letters and numbers');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(private prisma: PrismaService, private audit: AuditService, private email: EmailService) {}

  async register(input: { name: string; email: string; password: string; organizationName: string }, ip?: string) {
    assertPasswordPolicy(input.password);
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Could not create an account with these details');
    }
    const verifyRequired = requireEmailVerification();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const slug = `${slugify(input.organizationName)}-${randomBytes(3).toString('hex')}`;
    const { user, org } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, fullName: input.name, passwordHash, emailVerifiedAt: verifyRequired ? null : new Date() },
      });
      const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
      await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'ADMIN' } });
      return { user, org };
    });
    await this.audit.record({ organizationId: org.id, userId: user.id, action: 'auth.register', entityType: 'User', entityId: user.id, ip });
    if (verifyRequired) await this.safeSendVerification(user.id, email);
    return { userId: user.id, organizationId: org.id, verificationRequired: verifyRequired };
  }

  /** Returns a raw session token (only its hash is stored). */
  async login(email: string, password: string, ip?: string) {
    const normalized = email.trim().toLowerCase();
    const key = `${ip ?? 'unknown'}|${normalized}`;
    const stored = failures.get(key);
    if (stored && stored.lockedUntil > Date.now()) {
      throw new UnauthorizedException('Too many failed attempts. Try again later.');
    }
    const previous = stored && Date.now() - stored.lastSeen < FAIL_WINDOW_MS ? stored : undefined;

    const user = await this.prisma.user.findUnique({ where: { email: normalized }, include: { memberships: true } });
    // Compare even for unknown users so response timing does not reveal which emails exist.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.memberships.length === 0) {
      const count = (previous?.count ?? 0) + 1;
      const now = Date.now();
      trackFailure(key, { count, lockedUntil: count >= MAX_FAILS ? now + lockoutMs(count) : 0, lastSeen: now });
      if (user && user.memberships[0]) {
        await this.audit.record({ organizationId: user.memberships[0].organizationId, userId: user.id, action: 'auth.login_failed', entityType: 'User', entityId: user.id, details: { email: normalized }, ip });
      }
      throw new UnauthorizedException('Invalid email or password');
    }
    // Only after the password is proven correct do we reveal the verification requirement.
    if (requireEmailVerification() && !user.emailVerifiedAt) {
      throw new ForbiddenException('Please verify your email first. Check your inbox for the link.');
    }
    failures.delete(key);

    const membership = user.memberships[0];
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        organizationId: membership.organizationId,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
      },
    });
    await this.audit.record({ organizationId: membership.organizationId, userId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ip });
    return { token, maxAgeMs: SESSION_HOURS * 3600_000, user: { id: user.id, email: user.email, name: user.fullName, orgId: membership.organizationId, role: membership.role } };
  }

  async logout(sessionId: string, userId: string, orgId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await this.audit.record({ organizationId: orgId, userId, action: 'auth.logout', entityType: 'Session', entityId: sessionId });
  }

  // ---------- Email verification ----------

  /** Always answers the same way, so the endpoint does not reveal which emails are registered. */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (user && !user.emailVerifiedAt) await this.safeSendVerification(user.id, user.email);
  }

  async verifyEmail(raw: string) {
    const token = await this.findUsableToken(raw, 'VERIFY_EMAIL');
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  /** The account already exists, so a mail-provider outage must not turn signup into a 500. The user can ask for a new link. */
  private async safeSendVerification(userId: string, to: string) {
    try {
      await this.sendVerification(userId, to);
    } catch (e) {
      this.logger.error(`Verification email could not be sent for user ${userId}: ${(e as Error).message}`);
    }
  }

  private async sendVerification(userId: string, to: string) {
    const raw = await this.issueToken(userId, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await this.email.send({
      to,
      subject: 'Confirm your email · ኢሜይልዎን ያረጋግጡ',
      text: `Confirm your KaluSmart Trade email by opening this link (valid 24 hours):\n${appUrl()}/verify-email?token=${raw}\n\nኢሜይልዎን ለማረጋገጥ ይህን ሊንክ ይክፈቱ (ለ24 ሰዓት ያገለግላል)።\n\nIf you did not create an account, ignore this message.`,
    });
  }

  // ---------- Password reset ----------

  /** Always answers the same way. The email is sent in the background so timing does not reveal the account. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (user) {
      const raw = await this.issueToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
      void this.email
        .send({
          to: user.email,
          subject: 'Reset your password · የይለፍ ቃል ዳግም ማስጀመር',
          text: `Reset your KaluSmart Trade password with this link (valid 30 minutes):\n${appUrl()}/reset-password?token=${raw}\n\nየይለፍ ቃልዎን ለማስጀመር ይህን ሊንክ ይክፈቱ (ለ30 ደቂቃ ይገለገላል)።\n\nIf you did not ask for this, ignore this message; your password stays the same.`,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  async resetPassword(raw: string, newPassword: string) {
    assertPasswordPolicy(newPassword);
    const token = await this.findUsableToken(raw, 'RESET_PASSWORD');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
      // A reset signs out every existing session.
      this.prisma.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    const user = await this.prisma.user.findUnique({ where: { id: token.userId }, include: { memberships: true } });
    if (user?.memberships[0]) {
      await this.audit.record({ organizationId: user.memberships[0].organizationId, userId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id });
    }
    return { ok: true };
  }

  // ---------- Google sign-in ----------

  /**
   * Signs in (or creates) the account for a Google identity that has already passed every claim check.
   * Google proves the email is owned by the person, so an existing account with that email is linked,
   * its email is marked verified, and it gets a normal session. A new account gets a random, unusable password
   * hash, so password login only works after a password reset.
   */
  async signInWithGoogle(g: VerifiedGoogleUser, ip?: string) {
    let user = await this.prisma.user.findUnique({ where: { email: g.email }, include: { memberships: true } });
    if (!user) {
      const unusable = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      const slug = `${slugify(g.name)}-${randomBytes(3).toString('hex')}`;
      const created = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email: g.email, fullName: g.name, passwordHash: unusable, emailVerifiedAt: new Date() },
        });
        const org = await tx.organization.create({ data: { name: `${g.name} workspace`, slug } });
        await tx.membership.create({ data: { userId: u.id, organizationId: org.id, role: 'ADMIN' } });
        return u.id;
      });
      user = await this.prisma.user.findUnique({ where: { id: created }, include: { memberships: true } });
      await this.audit.record({ organizationId: user!.memberships[0].organizationId, userId: created, action: 'auth.register_google', entityType: 'User', entityId: created, ip });
    } else if (!user.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    const membership = user!.memberships[0];
    if (!membership) throw new UnauthorizedException('This account has no workspace access');

    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user!.id,
        organizationId: membership.organizationId,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
      },
    });
    await this.audit.record({ organizationId: membership.organizationId, userId: user!.id, action: 'auth.login_google', entityType: 'User', entityId: user!.id, ip });
    return { token, maxAgeMs: SESSION_HOURS * 3600_000, user: { id: user!.id, email: user!.email, name: user!.fullName, orgId: membership.organizationId, role: membership.role } };
  }

  // ---------- Token helpers ----------

  /** Creates a one-time token, stores only its hash, and invalidates older unused tokens of the same purpose. */
  private async issueToken(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', ttlMs: number): Promise<string> {
    await this.prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.authToken.create({
      data: { userId, purpose, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return raw;
  }

  private async findUsableToken(raw: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('This link is invalid or has expired. Request a new one.');
    }
    return token;
  }
}
