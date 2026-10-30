import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ruleGuard } from '../common/rule-guard';
import { assertFits, balanceFor, cents, payablesBySupplier, receivablesByCustomer } from './ledger';
import { referenceProblem } from './payment-verification';
import { requiresReference, toCents } from './money';
import { pageBounds } from './expense-rules';

class SupplierPaymentDto {
  @IsString() @MaxLength(64) purchaseId!: string;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'amount must be a positive number with up to 2 decimals' }) amount!: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

class SupplierPaymentQuery {
  @IsOptional() @IsString() @MaxLength(64) purchaseId?: string;
  @IsOptional() @IsString() @MaxLength(64) supplierId?: string;
  @IsOptional() @IsIn(['PENDING', 'CONFIRMED', 'REJECTED', 'FAILED']) status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'FAILED';
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

const SALE_RECEIVABLE = ['CONFIRMED', 'PAID'] as const;

/**
 * Customer receivables and supplier payables. Balances are computed here from persisted sales, purchases
 * and payments. Nothing in the request can set a balance. Only CONFIRMED amounts reduce what is owed.
 */
@Controller()
export class LedgerController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('ledger/receivables') @RequirePermission('ledger:read')
  async receivables(@Me() me: CurrentUser) {
    const [sales, payments, customers] = await Promise.all([
      this.prisma.sale.findMany({ where: { organizationId: me.orgId, status: { in: [...SALE_RECEIVABLE] } }, select: { id: true, customerId: true, status: true, total: true } }),
      this.prisma.payment.findMany({ where: { organizationId: me.orgId, status: { in: ['CONFIRMED', 'PENDING'] } }, select: { saleId: true, status: true, amount: true } }),
      this.prisma.customer.findMany({ where: { organizationId: me.orgId }, select: { id: true, name: true } }),
    ]);
    const { rows, grandBalanceCents } = receivablesByCustomer(
      sales.map((s) => ({ ...s, total: s.total.toFixed(2) })),
      payments.map((p) => ({ saleId: p.saleId, status: p.status, amount: p.amount.toFixed(2) })),
    );
    const names = new Map(customers.map((c) => [c.id, c.name]));
    return {
      rows: rows.map((r) => ({
        customerId: r.customerId,
        customerName: r.customerId === null ? 'Walk-in' : names.get(r.customerId) ?? null,
        walkIn: r.customerId === null,
        saleCount: r.saleCount,
        total: cents(r.totalCents),
        confirmed: cents(r.confirmedCents),
        pending: cents(r.pendingCents),
        balanceDue: cents(r.balanceCents),
      })),
      grandBalanceDue: cents(grandBalanceCents),
    };
  }

  @Get('ledger/receivables/customers/:customerId') @RequirePermission('ledger:read')
  async customerLedger(@Me() me: CurrentUser, @Param('customerId') customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: me.orgId }, select: { id: true, name: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const sales = await this.prisma.sale.findMany({
      where: { organizationId: me.orgId, customerId, status: { in: [...SALE_RECEIVABLE] } },
      select: { id: true, reference: true, soldAt: true, status: true, total: true, payments: { where: { status: { in: ['CONFIRMED', 'PENDING'] } }, select: { status: true, amount: true, method: true, createdAt: true } } },
      orderBy: { soldAt: 'asc' },
    });
    const lines = sales.map((s) => {
      const b = balanceFor(s.total.toFixed(2), s.payments.map((p) => ({ status: p.status, amount: p.amount.toFixed(2) })));
      return { saleId: s.id, reference: s.reference, soldAt: s.soldAt, status: s.status, total: cents(b.totalCents), confirmed: cents(b.confirmedCents), pending: cents(b.pendingCents), balanceDue: cents(b.balanceCents), payments: s.payments };
    });
    const balanceDue = lines.reduce((acc, l) => acc + toCents(l.balanceDue), 0n);
    return { customer, lines, balanceDue: cents(balanceDue) };
  }

  @Get('ledger/payables') @RequirePermission('ledger:read')
  async payables(@Me() me: CurrentUser) {
    const [purchases, payments, suppliers] = await Promise.all([
      this.prisma.purchase.findMany({ where: { organizationId: me.orgId, status: 'RECEIVED' }, select: { id: true, supplierId: true, status: true, total: true } }),
      this.prisma.supplierPayment.findMany({ where: { organizationId: me.orgId, status: { in: ['CONFIRMED', 'PENDING'] } }, select: { purchaseId: true, status: true, amount: true } }),
      this.prisma.supplier.findMany({ where: { organizationId: me.orgId }, select: { id: true, name: true } }),
    ]);
    const { rows, grandBalanceCents } = payablesBySupplier(
      purchases.map((p) => ({ ...p, total: p.total.toFixed(2) })),
      payments.map((p) => ({ purchaseId: p.purchaseId, status: p.status, amount: p.amount.toFixed(2) })),
    );
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return {
      rows: rows.map((r) => ({
        supplierId: r.supplierId,
        supplierName: names.get(r.supplierId) ?? null,
        purchaseCount: r.purchaseCount,
        total: cents(r.totalCents),
        paid: cents(r.paidCents),
        pending: cents(r.pendingCents),
        balanceDue: cents(r.balanceCents),
      })),
      grandBalanceDue: cents(grandBalanceCents),
    };
  }

  @Get('ledger/payables/suppliers/:supplierId') @RequirePermission('ledger:read')
  async supplierLedger(@Me() me: CurrentUser, @Param('supplierId') supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId: me.orgId }, select: { id: true, name: true } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const purchases = await this.prisma.purchase.findMany({
      where: { organizationId: me.orgId, supplierId, status: 'RECEIVED' },
      select: { id: true, reference: true, supplierReference: true, purchasedAt: true, total: true, supplierPayments: { where: { status: { in: ['CONFIRMED', 'PENDING'] } }, select: { id: true, status: true, amount: true, method: true, reference: true, createdAt: true } } },
      orderBy: { purchasedAt: 'asc' },
    });
    const lines = purchases.map((p) => {
      const b = balanceFor(p.total.toFixed(2), p.supplierPayments.map((x) => ({ status: x.status, amount: x.amount.toFixed(2) })));
      return { purchaseId: p.id, reference: p.reference, supplierReference: p.supplierReference, purchasedAt: p.purchasedAt, total: cents(b.totalCents), paid: cents(b.confirmedCents), pending: cents(b.pendingCents), balanceDue: cents(b.balanceCents), payments: p.supplierPayments };
    });
    const balanceDue = lines.reduce((acc, l) => acc + toCents(l.balanceDue), 0n);
    return { supplier, lines, balanceDue: cents(balanceDue) };
  }

  /**
   * Records a payment to a supplier against one RECEIVED purchase, as PENDING. It counts only once confirmed.
   * The purchase row is locked, so two payments cannot together exceed what is owed.
   */
  @Post('supplier-payments') @RequirePermission('payables:write')
  async recordSupplierPayment(@Me() me: CurrentUser, @Body() d: SupplierPaymentDto) {
    const amountCents = toCents(d.amount);
    if (amountCents <= 0n) throw new BadRequestException('Amount must be greater than zero');
    let reference: string | null = null;
    if (requiresReference(d.method)) {
      const problem = referenceProblem(d.reference);
      if (problem) throw new BadRequestException({ code: problem, message: 'A payment reference is required and must be 4 to 80 letters, digits, dashes, underscores or slashes' });
      reference = d.reference!.trim();
    } else if (d.reference?.trim()) {
      reference = d.reference.trim();
    }

    try {
      const sp = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \"Purchase\" WHERE id = ${d.purchaseId} AND \"organizationId\" = ${me.orgId} FOR UPDATE`;
        const purchase = await tx.purchase.findFirst({ where: { id: d.purchaseId, organizationId: me.orgId } });
        if (!purchase) throw new NotFoundException('Purchase not found');
        if (purchase.status !== 'RECEIVED') throw new BadRequestException({ code: 'PURCHASE_NOT_RECEIVED', message: 'Payments can be recorded only against a received purchase' });
        const existing = await tx.supplierPayment.findMany({ where: { organizationId: me.orgId, purchaseId: purchase.id }, select: { status: true, amount: true } });
        ruleGuard(() => assertFits(balanceFor(purchase.total.toFixed(2), existing.map((x) => ({ status: x.status, amount: x.amount.toFixed(2) }))), d.amount));
        return tx.supplierPayment.create({
          data: { organizationId: me.orgId, supplierId: purchase.supplierId, purchaseId: purchase.id, method: d.method, status: 'PENDING', amount: new Prisma.Decimal(d.amount), reference, recordedById: me.id },
        });
      });
      await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'supplier_payment.record', entityType: 'SupplierPayment', entityId: sp.id, details: { purchaseId: sp.purchaseId, method: sp.method, amount: d.amount } });
      return sp;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException({ code: 'DUPLICATE_REFERENCE', message: 'This payment reference has already been recorded' });
      }
      throw e;
    }
  }

  @Get('supplier-payments') @RequirePermission('ledger:read')
  async listSupplierPayments(@Me() me: CurrentUser, @Query() q: SupplierPaymentQuery) {
    const { page, pageSize, skip } = ruleGuard(() => pageBounds(q.page, q.pageSize));
    const where: Prisma.SupplierPaymentWhereInput = { organizationId: me.orgId };
    if (q.purchaseId) where.purchaseId = q.purchaseId;
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.status) where.status = q.status;
    return this.prisma.supplierPayment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: pageSize });
  }

  @Post('supplier-payments/:id/confirm') @RequirePermission('payments:confirm')
  async confirmSupplierPayment(@Me() me: CurrentUser, @Param('id') id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.supplierPayment.findFirst({ where: { id, organizationId: me.orgId } });
      if (!pending) throw new NotFoundException('Supplier payment not found');
      await tx.$queryRaw`SELECT id FROM \"Purchase\" WHERE id = ${pending.purchaseId} FOR UPDATE`;
      const sp = await tx.supplierPayment.findFirst({ where: { id, organizationId: me.orgId } });
      if (!sp) throw new NotFoundException('Supplier payment not found');
      if (sp.status !== 'PENDING') throw new BadRequestException({ code: 'NOT_PENDING', message: 'Only pending payments can be confirmed' });
      const purchase = await tx.purchase.findFirstOrThrow({ where: { id: sp.purchaseId, organizationId: me.orgId } });
      if (purchase.status !== 'RECEIVED') throw new BadRequestException({ code: 'PURCHASE_NOT_RECEIVED', message: 'This purchase is no longer open for payment' });
      const all = await tx.supplierPayment.findMany({ where: { organizationId: me.orgId, purchaseId: purchase.id }, select: { status: true, amount: true } });
      const confirmedOnly = all.filter((x) => x.status === 'CONFIRMED').map((x) => ({ status: x.status, amount: x.amount.toFixed(2) }));
      const b = balanceFor(purchase.total.toFixed(2), confirmedOnly);
      ruleGuard(() => assertFits({ ...b, pendingCents: 0n }, sp.amount.toFixed(2)));
      const updated = await tx.supplierPayment.update({ where: { id }, data: { status: 'CONFIRMED', confirmedById: me.id, confirmedAt: new Date() } });
      return { updated, purchaseId: purchase.id, supplierId: purchase.supplierId };
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'supplier_payment.confirm', entityType: 'SupplierPayment', entityId: id, details: { purchaseId: result.purchaseId } });
    return result.updated;
  }

  @Post('supplier-payments/:id/reject') @RequirePermission('payments:confirm')
  async rejectSupplierPayment(@Me() me: CurrentUser, @Param('id') id: string) {
    const r = await this.prisma.supplierPayment.updateMany({
      where: { id, organizationId: me.orgId, status: 'PENDING' },
      data: { status: 'REJECTED', confirmedById: me.id, confirmedAt: new Date() },
    });
    if (!r.count) {
      const exists = await this.prisma.supplierPayment.findFirst({ where: { id, organizationId: me.orgId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Supplier payment not found');
      throw new BadRequestException({ code: 'NOT_PENDING', message: 'Only pending payments can be rejected' });
    }
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'supplier_payment.reject', entityType: 'SupplierPayment', entityId: id });
    return this.prisma.supplierPayment.findFirst({ where: { id, organizationId: me.orgId } });
  }
}
