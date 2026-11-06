import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Me, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { SESSION_COOKIE } from '../common/auth.guard';
import { appUrl, isSecureCookie } from '../common/config';
import { GOOGLE_TOKEN_URL, buildAuthorizeUrl, constantTimeEqual, decodeJwtPayload, googleConfig, verifyIdTokenClaims } from './google-oauth';
import { RateLimiter } from '../common/rate-limit';

const HOUR = 60 * 60_000;
/** Per-IP budgets. Email-sending endpoints are the most expensive and most abused, so they get the tightest limits. */
const loginLimiter = new RateLimiter(20, 60_000);
const registerLimiter = new RateLimiter(5, HOUR);
const emailLimiter = new RateLimiter(5, HOUR);      // resend verification, forgot password
const tokenLimiter = new RateLimiter(20, HOUR);     // verify email, reset password attempts

class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @IsString() @MinLength(2) @MaxLength(100) organizationName!: string;
}
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(128) password!: string;
}
class EmailDto {
  @IsEmail() email!: string;
}
class TokenDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
}
class ResetDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}

const GOOGLE_COOKIE = 'kalu_google_oauth';
const GOOGLE_COOKIE_PATH = '/api/auth/google';

function googleCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: isSecureCookie(), path: GOOGLE_COOKIE_PATH };
}

function setCookie(res: Response, token: string, maxAgeMs: number) {
  const secure = isSecureCookie();

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: maxAgeMs,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public() @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    registerLimiter.consume(req.ip ?? 'unknown');
    const created = await this.auth.register(dto, req.ip);
    if (created.verificationRequired) return { verificationRequired: true };
    const s = await this.auth.login(dto.email, dto.password, req.ip);
    setCookie(res, s.token, s.maxAgeMs);
    return s.user;
  }

  @Public() @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    loginLimiter.consume(req.ip ?? 'unknown');
    const s = await this.auth.login(dto.email, dto.password, req.ip);
    setCookie(res, s.token, s.maxAgeMs);
    return s.user;
  }

  @Public() @Post('verify-email')
  async verifyEmail(@Body() dto: TokenDto, @Req() req: Request) {
    tokenLimiter.consume(req.ip ?? 'unknown');
    return this.auth.verifyEmail(dto.token);
  }

  @Public() @Post('resend-verification')
  async resendVerification(@Body() dto: EmailDto, @Req() req: Request) {
    emailLimiter.consume(req.ip ?? 'unknown');
    await this.auth.resendVerification(dto.email);
    return { ok: true, message: 'If this account needs confirmation, a new link has been sent.' };
  }

  @Public() @Post('forgot-password')
  async forgotPassword(@Body() dto: EmailDto, @Req() req: Request) {
    emailLimiter.consume(req.ip ?? 'unknown');
    await this.auth.forgotPassword(dto.email);
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.' };
  }

  @Public() @Post('reset-password')
  async resetPassword(@Body() dto: ResetDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    tokenLimiter.consume(req.ip ?? 'unknown');
    await this.auth.resetPassword(dto.token, dto.password);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** Starts Google sign-in. A random state and nonce are kept in a short-lived HttpOnly cookie. */
  @Public() @Get('google/start')
  googleStart(@Req() req: Request, @Res() res: Response) {
    const cfg = googleConfig();
    if (!cfg) return res.redirect(`${appUrl()}/login?error=google_unavailable`);
    loginLimiter.consume(req.ip ?? 'unknown');
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    res.cookie(GOOGLE_COOKIE, `${state}.${nonce}`, { ...googleCookieOptions(), maxAge: 10 * 60_000 });
    return res.redirect(buildAuthorizeUrl(cfg, state, nonce));
  }

  /** Google returns here. Every check must pass before a session is created; failures send the user back to /login. */
  @Public() @Get('google/callback')
  async googleCallback(
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const fail = (code: string) => {
      res.clearCookie(GOOGLE_COOKIE, { path: GOOGLE_COOKIE_PATH });
      return res.redirect(`${appUrl()}/login?error=${code}`);
    };
    const cfg = googleConfig();
    if (!cfg) return fail('google_unavailable');
    if (q.error) return fail('google_denied');

    const cookie = req.cookies?.[GOOGLE_COOKIE];
    res.clearCookie(GOOGLE_COOKIE, { path: GOOGLE_COOKIE_PATH }); // one attempt per start
    if (typeof cookie !== 'string' || !cookie.includes('.')) return fail('google_state');
    const [expectedState, expectedNonce] = cookie.split('.');
    if (typeof q.state !== 'string' || !constantTimeEqual(q.state, expectedState)) return fail('google_state');
    if (typeof q.code !== 'string' || q.code.length === 0 || q.code.length > 2048) return fail('google_failed');

    let tokenRes: globalThis.Response;
    try {
      tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: q.code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return fail('google_failed');
    }
    const body: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || typeof body.id_token !== 'string') return fail('google_failed');

    const claims = decodeJwtPayload(body.id_token);
    const verified = claims ? verifyIdTokenClaims(claims, { clientId: cfg.clientId, nonce: expectedNonce }) : null;
    if (!verified) return fail('google_unverified');

    const s = await this.auth.signInWithGoogle(verified, req.ip);
    setCookie(res, s.token, s.maxAgeMs);
    return res.redirect(`${appUrl()}/`);
  }

  @Post('logout')
  async logout(@Me() me: CurrentUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(me.sessionId, me.id, me.orgId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async meInfo(@Me() me: CurrentUser) {
    const org = await this.prisma.organization.findUnique({ where: { id: me.orgId }, select: { id: true, name: true } });
    return { id: me.id, email: me.email, name: me.name, role: me.role, organization: org };
  }
}
