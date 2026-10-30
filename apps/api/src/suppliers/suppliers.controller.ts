import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ruleGuard } from '../common/rule-guard';
import { pageBounds } from '../finance/expense-rules';

class SupplierDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SupplierUpdateDto extends SupplierDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class SupplierListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

/** Suppliers. Deactivated rather than deleted, so purchase history stays intact. */
@Controller('suppliers')
export class SuppliersController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('suppliers:read')
  async list(@Me() me: CurrentUser, @Query() q: SupplierListQuery) {
    const { page, pageSize, skip } = ruleGuard(() => pageBounds(q.page, q.pageSize));
    const where: Prisma.SupplierWhereInput = { organizationId: me.orgId };
    if (q.active !== undefined) where.isActive = q.active === 'true';
    if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }];
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take: pageSize }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @Get(':id') @RequirePermission('suppliers:read')
  async one(@Me() me: CurrentUser, @Param('id') id: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id, organizationId: me.orgId } });
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  @Post() @RequirePermission('suppliers:write')
  async create(@Me() me: CurrentUser, @Body() d: SupplierDto) {
    const s = await this.prisma.supplier.create({
      data: { organizationId: me.orgId, name: d.name.trim(), phone: d.phone?.trim() || null, email: d.email?.trim() || null, address: d.address?.trim() || null, notes: d.notes?.trim() || null },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'supplier.create', entityType: 'Supplier', entityId: s.id });
    return s;
  }

  @Patch(':id') @RequirePermission('suppliers:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: SupplierUpdateDto) {
    const data: Prisma.SupplierUpdateManyMutationInput = {};
    if (d.name !== undefined) data.name = d.name.trim();
    if (d.phone !== undefined) data.phone = d.phone?.trim() || null;
    if (d.email !== undefined) data.email = d.email?.trim() || null;
    if (d.address !== undefined) data.address = d.address?.trim() || null;
    if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
    if (d.isActive !== undefined) data.isActive = d.isActive;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change');
    const r = await this.prisma.supplier.updateMany({ where: { id, organizationId: me.orgId }, data });
    if (!r.count) throw new NotFoundException('Supplier not found');
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'supplier.update', entityType: 'Supplier', entityId: id, details: { changed: Object.keys(data) } });
    return this.prisma.supplier.findFirst({ where: { id, organizationId: me.orgId } });
  }
}
