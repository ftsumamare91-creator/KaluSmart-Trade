import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { ROLES } from '../common/permissions';
import { AuditService } from '../audit/audit.service';
import { assertPasswordPolicy } from '../auth/auth.service';
import { wouldLeaveNoAdmin } from './admin-rules';

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @IsIn(ROLES as unknown as string[]) role!: string;
}
class UpdateRoleDto { @IsIn(ROLES as unknown as string[]) role!: string; }

@Controller('users') @RequirePermission('users:manage')
export class UsersController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list(@Me() me: CurrentUser) {
    return this.prisma.membership.findMany({
      where: { organizationId: me.orgId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Admin creates an account for a staff member inside their own organization. */
  @Post()
  async create(@Me() me: CurrentUser, @Body() d: CreateUserDto) {
    assertPasswordPolicy(d.password);
    const email = d.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(d.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, fullName: d.name, passwordHash } });
      await tx.membership.create({ data: { userId: u.id, organizationId: me.orgId, role: d.role as any } });
      return u;
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'user.create', entityType: 'User', entityId: user.id, details: { role: d.role } });
    return { id: user.id, email: user.email, role: d.role };
  }

  @Patch(':userId/role')
  async setRole(@Me() me: CurrentUser, @Param('userId') userId: string, @Body() d: UpdateRoleDto) {
    if (userId === me.id) throw new BadRequestException('You cannot change your own role');
    // The check and the write run in one serializable transaction, so two administrators cannot each demote the other.
    await this.prisma.$transaction(
      async (tx) => {
        await this.assertNotLastAdmin(tx, me.orgId, userId, d.role);
        const r = await tx.membership.updateMany({ where: { userId, organizationId: me.orgId }, data: { role: d.role as any } });
        if (!r.count) throw new NotFoundException();
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'user.role_change', entityType: 'User', entityId: userId, details: { role: d.role } });
    return { ok: true };
  }

  @Delete(':userId')
  async remove(@Me() me: CurrentUser, @Param('userId') userId: string) {
    if (userId === me.id) throw new ForbiddenException('You cannot remove yourself');
    await this.prisma.$transaction(
      async (tx) => {
        await this.assertNotLastAdmin(tx, me.orgId, userId, null);
        const r = await tx.membership.deleteMany({ where: { userId, organizationId: me.orgId } });
        if (!r.count) throw new NotFoundException();
        await tx.session.updateMany({ where: { userId, organizationId: me.orgId }, data: { revokedAt: new Date() } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'user.remove', entityType: 'User', entityId: userId });
    return { ok: true };
  }

  /**
   * An organization must always keep at least one ADMIN. Blocks demoting or removing the last one.
   * `nextRole` is null for removal. Runs inside the caller's serializable transaction.
   */
  private async assertNotLastAdmin(tx: Prisma.TransactionClient, orgId: string, userId: string, nextRole: string | null) {
    const target = await tx.membership.findFirst({ where: { userId, organizationId: orgId }, select: { role: true } });
    if (!target) throw new NotFoundException();
    if (target.role !== 'ADMIN') return;
    const admins = await tx.membership.count({ where: { organizationId: orgId, role: 'ADMIN' } });
    if (wouldLeaveNoAdmin(target.role, nextRole, admins)) {
      throw new BadRequestException('The organization must keep at least one administrator');
    }
  }
}
