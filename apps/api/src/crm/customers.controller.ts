import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { ListQuery, take } from '../common/dto';
import { AuditService } from '../audit/audit.service';

class CustomerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('customers:read')
  list(@Me() me: CurrentUser, @Query() q: ListQuery) {
    return this.prisma.customer.findMany({
      where: {
        organizationId: me.orgId,
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take(q),
    });
  }

  @Post() @RequirePermission('customers:write')
  async create(@Me() me: CurrentUser, @Body() d: CustomerDto) {
    const c = await this.prisma.customer.create({ data: { ...d, organizationId: me.orgId } });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'customer.create', entityType: 'Customer', entityId: c.id });
    return c;
  }

  @Patch(':id') @RequirePermission('customers:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: Partial<CustomerDto>) {
    const r = await this.prisma.customer.updateMany({ where: { id, organizationId: me.orgId }, data: d });
    if (!r.count) throw new NotFoundException();
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'customer.update', entityType: 'Customer', entityId: id });
    return this.prisma.customer.findFirst({ where: { id, organizationId: me.orgId } });
  }

  @Delete(':id') @RequirePermission('customers:delete')
  async remove(@Me() me: CurrentUser, @Param('id') id: string) {
    const r = await this.prisma.customer.deleteMany({ where: { id, organizationId: me.orgId } });
    if (!r.count) throw new NotFoundException();
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'customer.delete', entityType: 'Customer', entityId: id });
    return { ok: true };
  }
}
