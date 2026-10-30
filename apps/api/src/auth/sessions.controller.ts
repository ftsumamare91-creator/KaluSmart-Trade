import { BadRequestException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The signed-in user's own sessions. Any authenticated user may use these endpoints, but only for their own sessions.
 * The model stores no IP address, device or last-activity time, so the list shows only what is recorded:
 * when each session started and when it expires. Raw tokens and token hashes are never returned.
 */
@Controller('auth/sessions')
export class SessionsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  async list(@Me() me: CurrentUser) {
    const rows = await this.prisma.session.findMany({
      where: { userId: me.id, organizationId: me.orgId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ ...r, current: r.id === me.sessionId }));
  }

  @Post(':id/revoke')
  async revoke(@Me() me: CurrentUser, @Param('id') id: string) {
    if (!SAFE_ID.test(id)) throw new NotFoundException('Session not found');
    // Scoped to the caller's own user id: another user's session id simply does not match.
    const r = await this.prisma.session.updateMany({
      where: { id, userId: me.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Session not found');
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'session.revoke', entityType: 'Session', entityId: id });
    return { ok: true, signedOutCurrent: id === me.sessionId };
  }

  @Post('revoke-others')
  async revokeOthers(@Me() me: CurrentUser) {
    if (!me.sessionId) throw new BadRequestException('No current session');
    const r = await this.prisma.session.updateMany({
      where: { userId: me.id, revokedAt: null, id: { not: me.sessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'session.revoke_others', entityType: 'Session', details: { count: r.count } });
    return { ok: true, revoked: r.count };
  }
}
