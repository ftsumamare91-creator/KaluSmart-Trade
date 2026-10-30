import { BadRequestException, Body, ConflictException, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayMinSize, ArrayMaxSize, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { ListQuery, take } from '../common/dto';
import { AuditService } from '../audit/audit.service';
import { feeFor, fromCents, platformFeePercent, toCents } from '../finance/money';

const MAX_QTY_PER_PRODUCT = 100_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

class SaleItemDto {
  @IsString() @MaxLength(64) productId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_QTY_PER_PRODUCT) quantity!: number;
}
class SaleDto {
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  /** Optional link to a known customer. Omit for a walk-in sale. The customer must belong to this organization. */
  @IsOptional() @IsString() @MaxLength(64) customerId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items!: SaleItemDto[];
}

/** Repeated product lines are summed, so each product is checked and deducted exactly once. */
function mergeLines(items: SaleItemDto[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const item of items) merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  for (const qty of merged.values()) {
    if (qty > MAX_QTY_PER_PRODUCT) throw new BadRequestException(`Total quantity per product must not exceed ${MAX_QTY_PER_PRODUCT}`);
  }
  return merged;
}

@Controller('sales')
export class SalesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('sales:read')
  list(@Me() me: CurrentUser, @Query() q: ListQuery) {
    return this.prisma.sale.findMany({ where: { organizationId: me.orgId }, include: { items: true }, orderBy: { soldAt: 'desc' }, take: take(q) });
  }

  /**
   * Prices come from the database, totals are computed here, and the whole sale succeeds or rolls back.
   * With an Idempotency-Key header, a retry returns the sale that already exists instead of creating another one.
   */
  @Post() @RequirePermission('sales:write')
  async create(@Me() me: CurrentUser, @Body() d: SaleDto, @Headers('idempotency-key') idemKey?: string) {
    if (idemKey !== undefined && !IDEMPOTENCY_KEY.test(idemKey)) {
      throw new BadRequestException('Idempotency-Key must be 8 to 64 letters, digits, dashes or underscores');
    }
    const merged = mergeLines(d.items);

    if (idemKey) {
      const existing = await this.findByKey(me.orgId, idemKey);
      if (existing) return this.sameSaleOrConflict(existing, d, merged);
    }

    try {
      const sale = await this.persistSale(me, d, merged, idemKey);
      await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'sale.create', entityType: 'Sale', entityId: sale.id, details: { reference: sale.reference, total: sale.total.toString() } });
      return sale;
    } catch (e) {
      // Two identical requests raced: the loser's transaction rolled back, so only the winner's sale exists.
      if (idemKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.findByKey(me.orgId, idemKey);
        if (existing) return this.sameSaleOrConflict(existing, d, merged);
      }
      throw e;
    }
  }

  /**
   * Read-only receipt data. Prices and totals are the stored values from the time of sale,
   * never recalculated from current product prices. Another tenant's sale is reported as not found.
   */
  @Get(':id') @RequirePermission('sales:read')
  async receipt(@Me() me: CurrentUser, @Param('id') id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, organizationId: me.orgId },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
        payments: { where: { status: 'CONFIRMED' }, select: { amount: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    const org = await this.prisma.organization.findUnique({ where: { id: me.orgId }, select: { name: true } });
    const paid = sale.payments.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
    const due = sale.total.sub(paid);
    return {
      id: sale.id,
      reference: sale.reference,
      status: sale.status,
      soldAt: sale.soldAt,
      customerName: sale.customerName ?? null,
      organizationName: org?.name ?? null,
      total: sale.total.toFixed(2),
      paid: paid.toFixed(2),
      balanceDue: (due.lt(0) ? new Prisma.Decimal(0) : due).toFixed(2),
      items: sale.items.map((i) => ({
        productName: i.product.name,
        sku: i.product.sku ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toFixed(2),
        lineTotal: i.lineTotal.toFixed(2),
      })),
    };
  }

  /**
   * Stock is decremented with a conditional UPDATE that returns the new level, and one StockMovement is written
   * per product in the same transaction. The sale, its stock and its movement history succeed or roll back together.
   */
  private async persistSale(me: CurrentUser, d: SaleDto, merged: Map<string, number>, idemKey?: string) {
    const ids = [...merged.keys()];
    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: ids }, organizationId: me.orgId } });
      if (products.length !== ids.length) throw new BadRequestException('One or more products were not found');
      const byId = new Map(products.map((p) => [p.id, p]));

      let customer: { id: string; name: string } | null = null;
      if (d.customerId) {
        customer = await tx.customer.findFirst({ where: { id: d.customerId, organizationId: me.orgId }, select: { id: true, name: true } });
        if (!customer) throw new BadRequestException('Customer not found');
      }

      const lines: { productId: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] = [];
      const movements: { productId: string; delta: number; quantityAfter: number }[] = [];
      let total = new Prisma.Decimal(0);
      for (const [productId, quantity] of merged) {
        const p = byId.get(productId)!;
        // Conditional update: the stock check and the deduction are one statement, so concurrent sales cannot oversell.
        const rows = await tx.$queryRaw<{ quantity: number }[]>`
          UPDATE \"Product\" SET quantity = quantity - ${quantity}, \"updatedAt\" = now()
          WHERE id = ${p.id} AND \"organizationId\" = ${me.orgId} AND quantity >= ${quantity} RETURNING quantity`;
        if (!rows.length) throw new BadRequestException(`Not enough stock for ${p.name}`);
        movements.push({ productId: p.id, delta: -quantity, quantityAfter: rows[0].quantity });
        const lineTotal = p.unitPrice.mul(quantity);
        total = total.add(lineTotal);
        lines.push({ productId: p.id, quantity, unitPrice: p.unitPrice, lineTotal });
      }

      const reference = `S-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      // The fee percent is fixed on the sale when it is made, so later changes do not alter past sales.
      const feePercent = platformFeePercent();
      const { feeCents, netCents } = feeFor(toCents(total.toFixed(2)), feePercent);
      const sale = await tx.sale.create({
        data: {
          organizationId: me.orgId,
          reference,
          status: 'CONFIRMED',
          total,
          feePercent,
          feeAmount: fromCents(feeCents),
          netAmount: fromCents(netCents),
          customerId: customer?.id ?? null,
          customerName: d.customerName || customer?.name || undefined,
          idempotencyKey: idemKey ?? null,
          items: { create: lines },
        },
        include: { items: true },
      });
      await tx.stockMovement.createMany({
        data: movements.map((m) => ({
          organizationId: me.orgId,
          productId: m.productId,
          delta: m.delta,
          quantityAfter: m.quantityAfter,
          reason: 'SALE' as const,
          saleId: sale.id,
          createdById: me.id,
        })),
      });
      return sale;
    });
  }

  private findByKey(orgId: string, key: string) {
    return this.prisma.sale.findFirst({ where: { organizationId: orgId, idempotencyKey: key }, include: { items: true } });
  }

  /** Same key and same request: return the existing sale. Same key but a different request: refuse. */
  private sameSaleOrConflict(
    existing: { customerName: string | null; customerId?: string | null; items: { productId: string; quantity: number }[] } & Record<string, unknown>,
    d: SaleDto,
    merged: Map<string, number>,
  ) {
    const stored = new Map<string, number>();
    for (const item of existing.items) stored.set(item.productId, (stored.get(item.productId) ?? 0) + item.quantity);
    const sameItems = stored.size === merged.size && [...merged].every(([id, qty]) => stored.get(id) === qty);
    // A customer given only by id takes its name from the customer record, so the name is not compared in that case.
    const nameMatches = (existing.customerName ?? undefined) === (d.customerName || undefined) || (!!d.customerId && !d.customerName);
    const sameCustomer = (existing.customerId ?? null) === (d.customerId || null) && nameMatches;
    if (!sameItems || !sameCustomer) {
      throw new ConflictException('This Idempotency-Key was already used for a different sale');
    }
    return existing;
  }
}
