import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from './prisma.service';
import { IS_PUBLIC, PERM_KEY } from './decorators';
import { can, Permission } from './permissions';

export const SESSION_COOKIE = 'kalusmart_session';
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException();

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
    });
    if (!membership) throw new UnauthorizedException();

    req.user = {
      id: session.userId,
      email: session.user.email,
      name: session.user.fullName,
      orgId: session.organizationId,
      role: membership.role,
      sessionId: session.id,
    };

    const perm = this.reflector.getAllAndOverride<Permission>(PERM_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (perm && !can(membership.role, perm)) throw new ForbiddenException('You do not have permission for this action');
    return true;
  }
}
