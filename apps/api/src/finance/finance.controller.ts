import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ruleGuard } from '../common/rule-guard';
import { assertEditable, expenseAmountCents, expensePaymentReference, pageBounds, validateDateRange, validateSpentAt, voidReason } from './expense-rules';
import { Type } from 'class-transformer';

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

class ExpenseDto {
  @IsString() @MinLength(2) @MaxLength(60) category!: string;
  @IsString() @MinLength(1) @MaxLength(200) description!: string;
  @Matches(AMOUNT, { message: 'amount must be a positive number with up to 2 decimals' }) amount!: string;
  @IsOptional() @IsDateString() spentAt?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

class ExpenseUpdateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) description?: string;
  @IsOptional() @Matches(AMOUNT, { message: 'amount must be a positive number with up to 2 decimals' }) amount?: string;
  @IsOptional() @IsDateString() spentAt?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod | null;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
}

class VoidDto {
  @IsString() @MaxLength(200) reason!: string;
}

class ExpenseListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsIn(['ACTIVE', 'VOIDED', 'ALL']) status?: 'ACTIVE' | 'VOIDED' | 'ALL';
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

/**
 * Operating expenses. Never deleted: a mistake is voided with a reason. Expenses are never purchases
 * (purchases affect stock and supplier payables), so the two are not counted twice anywhere.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('expenses:read')
  async list(@Me() me: CurrentUser, @Query() q: ExpenseListQuery) {
    const { page, pageSize, skip } = ruleGuard(() => pageBounds(q.page, q.pageSize));
    const range = ruleGuard(() => validateDateRange(q.from, q.to));
    const where: Prisma.ExpenseWhereInput = { organizationId: me.orgId };
    if (q.status !== 'ALL') where.status = q.status ?? 'ACTIVE';
    if (q.category) where.category = q.category;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.q) where.OR = [{ description: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }];
    if (range.gte || range.lte) where.spentAt = { gte: range.gte, lte: range.lte };

    const [items, total, sum] = await Promise.all([
      this.prisma.expense.findMany({ where, orderBy: [{ spentAt: 'desc' }, { id: 'desc' }], skip, take: pageSize }),
      this.prisma.expense.count({ where }),
      // Totals always count ACTIVE rows only, whatever the status filter shows.
      this.prisma.expense.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { amount: true } }),
    ]);
    return { items, total, page, pageSize, activeTotal: (sum._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) };
  }

  @Get(':id') @RequirePermission('expenses:read')
  async one(@Me() me: CurrentUser, @Param('id') id: string) {
    const e = await this.prisma.expense.findFirst({ where: { id, organizationId: me.orgId } });
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }

  @Post() @RequirePermission('expenses:write')
  async create(@Me() me: CurrentUser, @Body() d: ExpenseDto) {
    ruleGuard(() => expenseAmountCents(d.amount));
    const spentAt = ruleGuard(() => validateSpentAt(d.spentAt));
    const reference = ruleGuard(() => expensePaymentReference(d.paymentMethod ?? null, d.reference));
    const e = await this.prisma.expense.create({
      data: {
        organizationId: me.orgId,
        category: d.category.trim(),
        description: d.description.trim(),
        amount: new Prisma.Decimal(d.amount),
        spentAt,
        paymentMethod: d.paymentMethod ?? null,
        reference,
        createdById: me.id,
      },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'expense.create', entityType: 'Expense', entityId: e.id, details: { category: e.category, amount: e.amount.toFixed(2) } });
    return e;
  }

  /** Edits an ACTIVE expense. The audit entry lists which fields changed (not their values). */
  @Patch(':id') @RequirePermission('expenses:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: ExpenseUpdateDto) {
    const current = await this.prisma.expense.findFirst({ where: { id, organizationId: me.orgId } });
    if (!current) throw new NotFoundException('Expense not found');
    ruleGuard(() => assertEditable(current.status));

    const data: Prisma.ExpenseUpdateManyMutationInput = {};
    if (d.category !== undefined) data.category = d.category.trim();
    if (d.description !== undefined) data.description = d.description.trim();
    if (d.amount !== undefined) {
      ruleGuard(() => expenseAmountCents(d.amount!));
      data.amount = new Prisma.Decimal(d.amount);
    }
    if (d.spentAt !== undefined) data.spentAt = ruleGuard(() => validateSpentAt(d.spentAt));
    const method = d.paymentMethod !== undefined ? d.paymentMethod : current.paymentMethod;
    const ref = d.reference !== undefined ? d.reference : current.reference;
    if (d.paymentMethod !== undefined || d.reference !== undefined) {
      data.paymentMethod = method ?? null;
      data.reference = ruleGuard(() => expensePaymentReference(method ?? null, ref ?? null));
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change');

    // Guarded on status, so a void that lands in the meantime cannot be overwritten.
    const r = await this.prisma.expense.updateMany({ where: { id, organizationId: me.orgId, status: 'ACTIVE' }, data });
    if (!r.count) throw new BadRequestException({ code: 'EXPENSE_VOIDED', message: 'A voided expense cannot be changed' });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'expense.update', entityType: 'Expense', entityId: id, details: { changed: Object.keys(data) } });
    return this.prisma.expense.findFirst({ where: { id, organizationId: me.orgId } });
  }

  @Post(':id/void') @RequirePermission('expenses:void')
  async void(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: VoidDto) {
    const reason = ruleGuard(() => voidReason(d.reason));
    const now = new Date();
    const r = await this.prisma.expense.updateMany({
      where: { id, organizationId: me.orgId, status: 'ACTIVE' },
      data: { status: 'VOIDED', voidedAt: now, voidedById: me.id, voidReason: reason },
    });
    if (!r.count) {
      const exists = await this.prisma.expense.findFirst({ where: { id, organizationId: me.orgId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Expense not found');
      throw new BadRequestException({ code: 'EXPENSE_VOIDED', message: 'This expense is already voided' });
    }
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'expense.void', entityType: 'Expense', entityId: id, details: { reason } });
    return this.prisma.expense.findFirst({ where: { id, organizationId: me.orgId } });
  }
}
