import { BadRequestException, Body, ConflictException, Controller, Get, Headers, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ruleGuard, ruleGuardAsync } from '../common/rule-guard';
import { assertPurchaseAction, MAX_PURCHASE_QTY, normalizePurchaseLines } from '../inventory/purchase-rules';
import { pageBounds, validateDateRange, validateSpentAt } from '../finance/expense-rules';
import { balanceFor } from '../finance/ledger';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

class PurchaseLineDto {
  @IsString() @MaxLength(64) productId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PURCHASE_QTY) quantity!: number;
  @IsString() @MaxLength(20) unitCost!: string;
}

class PurchaseDto {
  @IsString() @MaxLength(64) supplierId!: string;
  @IsOptional() @IsString() @MaxLength(80) supplierReference?: string;
  @IsOptional() @IsDateString() purchasedAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseLineDto) items!: PurchaseLineDto[];
}

class PurchaseEditDto {
  @IsOptional() @IsString() @MaxLength(80) supplierReference?: string;
  @IsOptional() @IsDateString() purchasedAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseLineDto) items?: PurchaseLineDto[];
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class PurchaseListQuery {
  @IsOptional() @IsIn(['DRAFT', 'RECEIVED', 'CANCELLED']) status?: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  @IsOptional() @IsString() @MaxLength(64) supplierId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

const PRODUCT_SELECT = { select: { name: true, sku: true } } as const;

/**
 * Purchases from suppliers. A DRAFT changes nothing. RECEIVING it (once) increases stock and writes one
 * StockMovement per line, in a single transaction. Unit costs are stored on each line and never change prices.
 */
@Controller('purchases')
export class PurchasesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('purchases:read')
  async list(@Me() me: CurrentUser, @Query() q: PurchaseListQuery) {
    const { page, pageSize, skip } = ruleGuard(() => pageBounds(q.page, q.pageSize));
    const range = ruleGuard(() => validateDateRange(q.from, q.to));
    const where: Prisma.PurchaseWhereInput = { organizationId: me.orgId };
    if (q.status) where.status = q.status;
    if (q.supplierId) where.supplierId = q.supplierId;
    if (range.gte || range.lte) where.purchasedAt = { gte: range.gte, lte: range.lte };
    const [items, total] = await Promise.all([
      this.prisma.purchase.findMany({ where, include: { supplier: { select: { name: true } } }, orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }], skip, take: pageSize }),
      this.prisma.purchase.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** The purchase with its lines and its balance, computed on the server from confirmed and pending supplier payments. */
  @Get(':id') @RequirePermission('purchases:read')
  async one(@Me() me: CurrentUser, @Param('id') id: string) {
    const p = await this.prisma.purchase.findFirst({
      where: { id, organizationId: me.orgId },
      include: { items: { include: { product: PRODUCT_SELECT } }, supplier: { select: { id: true, name: true } }, supplierPayments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Purchase not found');
    const b = balanceFor(p.total.toFixed(2), p.supplierPayments.map((payment) => ({ ...payment, amount: payment.amount.toFixed(2) })));
    const fmt = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
    return { ...p, balance: { total: fmt(b.totalCents), paid: fmt(b.confirmedCents), pending: fmt(b.pendingCents), balanceDue: fmt(b.balanceCents) } };
  }

  @Post() @RequirePermission('purchases:write')
  async create(@Me() me: CurrentUser, @Body() d: PurchaseDto, @Headers('idempotency-key') idemKey?: string) {
    if (idemKey !== undefined && !IDEMPOTENCY_KEY.test(idemKey)) {
      throw new BadRequestException('Idempotency-Key must be 8 to 64 letters, digits, dashes or underscores');
    }
    if (idemKey) {
      const existing = await this.prisma.purchase.findFirst({ where: { organizationId: me.orgId, idempotencyKey: idemKey }, include: { items: true } });
      if (existing) return this.sameOrConflict(existing, d);
    }
    try {
      const p = await this.createDraft(me, d, idemKey);
      await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'purchase.create', entityType: 'Purchase', entityId: p.id, details: { reference: p.reference, total: p.total.toFixed(2) } });
      return p;
    } catch (e) {
      if (idemKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.purchase.findFirst({ where: { organizationId: me.orgId, idempotencyKey: idemKey }, include: { items: true } });
        if (existing) return this.sameOrConflict(existing, d);
      }
      throw this.mapUniqueErrors(e);
    }
  }

  /** Draft only. Lines are replaced as a whole, so the total is always recomputed from them. */
  @Patch(':id') @RequirePermission('purchases:write')
  async edit(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: PurchaseEditDto) {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \"Purchase\" WHERE id = ${id} AND \"organizationId\" = ${me.orgId} FOR UPDATE`;
        const p = await tx.purchase.findFirst({ where: { id, organizationId: me.orgId } });
        if (!p) throw new NotFoundException('Purchase not found');
        await ruleGuardAsync(async () => assertPurchaseAction(p.status, 'edit'));

        const data: Prisma.PurchaseUpdateInput = {};
        if (d.supplierReference !== undefined) data.supplierReference = d.supplierReference.trim() || null;
        if (d.notes !== undefined) data.notes = d.notes.trim() || null;
        if (d.purchasedAt !== undefined) data.purchasedAt = ruleGuard(() => validateSpentAt(d.purchasedAt));
        if (d.items) {
          const norm = ruleGuard(() => normalizePurchaseLines(d.items!));
          await this.assertProducts(tx, me.orgId, norm.lines.map((l) => l.productId));
          await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
          await tx.purchaseItem.createMany({
            data: norm.lines.map((l) => ({ purchaseId: id, productId: l.productId, quantity: l.quantity, unitCost: new Prisma.Decimal(l.unitCost), lineTotal: new Prisma.Decimal(l.lineTotal) })),
          });
          data.total = new Prisma.Decimal(norm.total);
        }
        if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change');
        await tx.purchase.update({ where: { id }, data });
        return tx.purchase.findFirst({ where: { id, organizationId: me.orgId }, include: { items: true } });
      });
      await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'purchase.edit', entityType: 'Purchase', entityId: id });
      return updated;
    } catch (e) {
      throw this.mapUniqueErrors(e);
    }
  }

  /**
   * Receives a draft exactly once. The row lock serializes concurrent receive requests, and the status check
   * refuses a second receive. Stock and movements are written in the same transaction, so a failure rolls all back.
   */
  @Post(':id/receive') @RequirePermission('purchases:receive')
  async receive(@Me() me: CurrentUser, @Param('id') id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \"Purchase\" WHERE id = ${id} AND \"organizationId\" = ${me.orgId} FOR UPDATE`;
      const p = await tx.purchase.findFirst({ where: { id, organizationId: me.orgId }, include: { items: true } });
      if (!p) throw new NotFoundException('Purchase not found');
      await ruleGuardAsync(async () => assertPurchaseAction(p.status, 'receive'));

      const movements: Prisma.StockMovementCreateManyInput[] = [];
      for (const item of p.items) {
        // Conditional increase: the row must still exist for this organization, or the whole receipt is refused.
        const rows = await tx.$queryRaw<{ quantity: number }[]>`
          UPDATE \"Product\" SET quantity = quantity + ${item.quantity}, \"updatedAt\" = now()
          WHERE id = ${item.productId} AND \"organizationId\" = ${me.orgId} RETURNING quantity`;
        if (!rows.length) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'A product on this purchase no longer exists' });
        movements.push({
          organizationId: me.orgId,
          productId: item.productId,
          delta: item.quantity,
          quantityAfter: rows[0].quantity,
          reason: 'PURCHASE_RECEIPT',
          purchaseId: id,
          createdById: me.id,
        });
      }
      await tx.stockMovement.createMany({ data: movements });

      const r = await tx.purchase.updateMany({
        where: { id, organizationId: me.orgId, status: 'DRAFT' },
        data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: me.id },
      });
      if (r.count !== 1) throw new BadRequestException({ code: 'NOT_DRAFT', message: 'Only draft purchases can be received' });
      return tx.purchase.findFirst({ where: { id, organizationId: me.orgId }, include: { items: true } });
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'purchase.receive', entityType: 'Purchase', entityId: id, details: { lines: result?.items.length ?? 0 } });
    return result;
  }

  /**
   * Draft: cancelled, no stock change. Received: cancelled with a reason and stock reversed, but only while no
   * supplier payment is confirmed against it and the stock has not been sold on.
   */
  @Post(':id/cancel') @RequirePermission('purchases:receive')
  async cancel(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: CancelDto) {
    const reason = d.reason?.trim() || undefined;
    const prior = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \"Purchase\" WHERE id = ${id} AND \"organizationId\" = ${me.orgId} FOR UPDATE`;
      const p = await tx.purchase.findFirst({ where: { id, organizationId: me.orgId }, include: { items: true } });
      if (!p) throw new NotFoundException('Purchase not found');
      const confirmed = await tx.supplierPayment.count({ where: { organizationId: me.orgId, purchaseId: id, status: 'CONFIRMED' } });
      await ruleGuardAsync(async () => assertPurchaseAction(p.status, 'cancel', { reason, hasConfirmedPayments: confirmed > 0 }));

      if (p.status === 'RECEIVED') {
        const movements: Prisma.StockMovementCreateManyInput[] = [];
        for (const item of p.items) {
          const rows = await tx.$queryRaw<{ quantity: number }[]>`
            UPDATE \"Product\" SET quantity = quantity - ${item.quantity}, \"updatedAt\" = now()
            WHERE id = ${item.productId} AND \"organizationId\" = ${me.orgId} AND quantity >= ${item.quantity} RETURNING quantity`;
          if (!rows.length) {
            throw new BadRequestException({ code: 'STOCK_ALREADY_SOLD', message: 'Some of this stock has already been sold, so the purchase cannot be cancelled' });
          }
          movements.push({ organizationId: me.orgId, productId: item.productId, delta: -item.quantity, quantityAfter: rows[0].quantity, reason: 'PURCHASE_REVERSAL', purchaseId: id, createdById: me.id });
        }
        await tx.stockMovement.createMany({ data: movements });
      }

      const r = await tx.purchase.updateMany({
        where: { id, organizationId: me.orgId, status: p.status },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: me.id, cancelReason: reason ?? null },
      });
      if (r.count !== 1) throw new BadRequestException({ code: 'CHANGED_ELSEWHERE', message: 'This purchase changed while you were cancelling it. Refresh and try again.' });
      return p.status;
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'purchase.cancel', entityType: 'Purchase', entityId: id, details: { fromStatus: prior, reason: reason ?? null } });
    return this.prisma.purchase.findFirst({ where: { id, organizationId: me.orgId } });
  }

  private async createDraft(me: CurrentUser, d: PurchaseDto, idemKey?: string) {
    const norm = ruleGuard(() => normalizePurchaseLines(d.items));
    const purchasedAt = ruleGuard(() => validateSpentAt(d.purchasedAt));
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: d.supplierId, organizationId: me.orgId, isActive: true }, select: { id: true } });
      if (!supplier) throw new BadRequestException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier not found or inactive' });
      await this.assertProducts(tx, me.orgId, norm.lines.map((l) => l.productId));

      const reference = `P-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      return tx.purchase.create({
        data: {
          organizationId: me.orgId,
          supplierId: supplier.id,
          reference,
          supplierReference: d.supplierReference?.trim() || null,
          purchasedAt,
          notes: d.notes?.trim() || null,
          total: new Prisma.Decimal(norm.total),
          idempotencyKey: idemKey ?? null,
          createdById: me.id,
          items: {
            create: norm.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: new Prisma.Decimal(l.unitCost), lineTotal: new Prisma.Decimal(l.lineTotal) })),
          },
        },
        include: { items: true },
      });
    });
  }

  private async assertProducts(tx: Prisma.TransactionClient, orgId: string, ids: string[]) {
    const found = await tx.product.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true } });
    if (found.length !== ids.length) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'One or more products were not found' });
  }

  /** Same key and same request returns the existing purchase; same key with a different request is refused. */
  private sameOrConflict(existing: { supplierId: string; items: { productId: string; quantity: number; unitCost: Prisma.Decimal }[] } & Record<string, unknown>, d: PurchaseDto) {
    const norm = ruleGuard(() => normalizePurchaseLines(d.items));
    const stored = new Map(existing.items.map((i) => [i.productId, `${i.quantity}|${i.unitCost.toFixed(2)}`]));
    const same = existing.supplierId === d.supplierId && stored.size === norm.lines.length && norm.lines.every((l) => stored.get(l.productId) === `${l.quantity}|${Number(l.unitCost).toFixed(2)}`);
    if (!same) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'This Idempotency-Key was already used for a different purchase' });
    return existing;
  }

  private mapUniqueErrors(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = JSON.stringify(e.meta?.target ?? '');
      if (target.includes('supplierReference')) {
        return new BadRequestException({ code: 'DUPLICATE_SUPPLIER_INVOICE', message: 'This supplier invoice number is already recorded for this supplier' });
      }
    }
    return e;
  }
}


