import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { ruleGuard } from '../common/rule-guard';
import { fromCents, toCents } from '../finance/money';
import { receivablesByCustomer } from '../finance/ledger';
import {
  Range,
  Unit,
  bucketKeys,
  previousRange,
  reportOffsetMinutes,
  resolveRange,
  UNITS,
} from './analytics-rules';
import { buildProfitLoss, PNL_NOTES } from './profit-loss';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 732;
const SALE_STATUSES: SaleStatus[] = [SaleStatus.CONFIRMED, SaleStatus.PAID];

class RangeQuery {
  @IsOptional() @Matches(YMD, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(YMD, { message: 'to must be YYYY-MM-DD' }) to?: string;
}

class SeriesQuery extends RangeQuery {
  @IsOptional() @IsIn(UNITS) granularity?: Unit;
}

class OverviewQuery extends RangeQuery {
  @IsOptional() @IsIn(['true', 'false']) compare?: 'true' | 'false';
}

class TopQuery extends RangeQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class InventoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

const money = (v: Prisma.Decimal | string | number | null | undefined): string => (v === null || v === undefined ? '0.00' : new Prisma.Decimal(v).toFixed(2));
const cents = (v: string | null | undefined): bigint => (v ? toCents(v) : 0n);

/**
 * Read-only analytics. Every figure is a server-side aggregate over persisted rows, scoped to the caller's
 * organization. No endpoint accepts totals or balances from the client. Money is returned as decimal strings.
 */
@Controller()
export class AnalyticsController {
  constructor(private prisma: PrismaService) {}

  private offset(): number {
    return reportOffsetMinutes();
  }

  private range(q: RangeQuery, maxDays = MAX_RANGE_DAYS, defaultDays = 30): Range {
    return ruleGuard(() => resolveRange({ from: q.from, to: q.to, now: new Date(), offsetMin: this.offset(), maxDays, defaultDays }));
  }

  /** Totals for one period. Each sum is a single aggregate, so joins cannot duplicate rows. */
  private async metricsFor(orgId: string, r: Range) {
    const [sales, collections, expenses, purchases] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { organizationId: orgId, status: { in: SALE_STATUSES }, soldAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { organizationId: orgId, status: 'CONFIRMED', confirmedAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { organizationId: orgId, status: 'ACTIVE', spentAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { amount: true },
      }),
      this.prisma.purchase.aggregate({
        where: { organizationId: orgId, status: 'RECEIVED', receivedAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { total: true },
      }),
    ]);
    return {
      salesCount: sales._count._all,
      salesCents: cents(money(sales._sum.total)),
      collectionsCents: cents(money(collections._sum.amount)),
      expensesCents: cents(money(expenses._sum.amount)),
      purchasesCents: cents(money(purchases._sum.total)),
    };
  }

  /** Customer receivables and supplier payables at the end of a period, from every row dated before it. */
  private async balancesAt(orgId: string, asOf: Date) {
    const [recv] = await this.prisma.$queryRaw<{ due: string }[]>`
      SELECT COALESCE(SUM(GREATEST(s.total - COALESCE(pp.paid, 0), 0)), 0)::text AS due
      FROM "Sale" s
      LEFT JOIN (
        SELECT "saleId", SUM(amount) AS paid FROM "Payment"
        WHERE "organizationId" = ${orgId} AND status = 'CONFIRMED' AND "confirmedAt" < ${asOf}
        GROUP BY "saleId"
      ) pp ON pp."saleId" = s.id
      WHERE s."organizationId" = ${orgId} AND s.status IN ('CONFIRMED', 'PAID') AND s."soldAt" < ${asOf}`;
    const [pay] = await this.prisma.$queryRaw<{ due: string }[]>`
      SELECT COALESCE(SUM(GREATEST(p.total - COALESCE(sp.paid, 0), 0)), 0)::text AS due
      FROM "Purchase" p
      LEFT JOIN (
        SELECT "purchaseId", SUM(amount) AS paid FROM "SupplierPayment"
        WHERE "organizationId" = ${orgId} AND status = 'CONFIRMED' AND "confirmedAt" < ${asOf}
        GROUP BY "purchaseId"
      ) sp ON sp."purchaseId" = p.id
      WHERE p."organizationId" = ${orgId} AND p.status = 'RECEIVED' AND p."receivedAt" < ${asOf}`;
    return { receivablesCents: cents(recv?.due ?? '0'), payablesCents: cents(pay?.due ?? '0') };
  }

  /** Per-bucket sums for the four measures, computed in the database with date_trunc on local time. */
  private async bucketSums(orgId: string, r: Range, unit: Unit) {
    const off = r.offsetMin;
    const [sales, collections, expenses, purchases] = await Promise.all([
      this.prisma.$queryRaw<{ b: string; n: number; amt: string }[]>`
        SELECT to_char(date_trunc(${unit}::text, "soldAt" + (${off}::int * interval '1 minute')), 'YYYY-MM-DD') AS b,
               COUNT(*)::int AS n, COALESCE(SUM(total), 0)::text AS amt
        FROM "Sale"
        WHERE "organizationId" = ${orgId} AND status IN ('CONFIRMED', 'PAID') AND "soldAt" >= ${r.startUtc} AND "soldAt" < ${r.endUtc}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ b: string; amt: string }[]>`
        SELECT to_char(date_trunc(${unit}::text, "confirmedAt" + (${off}::int * interval '1 minute')), 'YYYY-MM-DD') AS b,
               COALESCE(SUM(amount), 0)::text AS amt
        FROM "Payment"
        WHERE "organizationId" = ${orgId} AND status = 'CONFIRMED' AND "confirmedAt" >= ${r.startUtc} AND "confirmedAt" < ${r.endUtc}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ b: string; amt: string }[]>`
        SELECT to_char(date_trunc(${unit}::text, "spentAt" + (${off}::int * interval '1 minute')), 'YYYY-MM-DD') AS b,
               COALESCE(SUM(amount), 0)::text AS amt
        FROM "Expense"
        WHERE "organizationId" = ${orgId} AND status = 'ACTIVE' AND "spentAt" >= ${r.startUtc} AND "spentAt" < ${r.endUtc}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ b: string; amt: string }[]>`
        SELECT to_char(date_trunc(${unit}::text, "receivedAt" + (${off}::int * interval '1 minute')), 'YYYY-MM-DD') AS b,
               COALESCE(SUM(total), 0)::text AS amt
        FROM "Purchase"
        WHERE "organizationId" = ${orgId} AND status = 'RECEIVED' AND "receivedAt" >= ${r.startUtc} AND "receivedAt" < ${r.endUtc}
        GROUP BY 1`,
    ]);
    const map = new Map<string, { salesCount: number; sales: bigint; collections: bigint; expenses: bigint; purchases: bigint }>();
    const slot = (k: string) => {
      let v = map.get(k);
      if (!v) map.set(k, (v = { salesCount: 0, sales: 0n, collections: 0n, expenses: 0n, purchases: 0n }));
      return v;
    };
    for (const r1 of sales) { const s = slot(r1.b); s.salesCount += r1.n; s.sales += cents(r1.amt); }
    for (const r1 of collections) slot(r1.b).collections += cents(r1.amt);
    for (const r1 of expenses) slot(r1.b).expenses += cents(r1.amt);
    for (const r1 of purchases) slot(r1.b).purchases += cents(r1.amt);
    return map;
  }

  @Get('analytics/overview') @RequirePermission('analytics:read')
  async overview(@Me() me: CurrentUser, @Query() q: OverviewQuery) {
    const r = this.range(q);
    const compare = q.compare !== 'false';
    const prevRange = compare ? ruleGuard(() => previousRange(r, MAX_RANGE_DAYS)) : null;
    const [cur, prev, bal, lowStock, recentSales, recentPayments] = await Promise.all([
      this.metricsFor(me.orgId, r),
      prevRange ? this.metricsFor(me.orgId, prevRange) : Promise.resolve(null),
      this.balancesAt(me.orgId, r.endUtc),
      this.prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM "Product" WHERE "organizationId" = ${me.orgId} AND quantity <= "reorderLevel"`,
      this.prisma.sale.findMany({
        where: { organizationId: me.orgId, soldAt: { gte: r.startUtc, lt: r.endUtc } },
        select: { id: true, reference: true, status: true, total: true, soldAt: true, customerName: true },
        orderBy: { soldAt: 'desc' },
        take: 10,
      }),
      this.prisma.payment.findMany({
        where: { organizationId: me.orgId, status: 'CONFIRMED', confirmedAt: { gte: r.startUtc, lt: r.endUtc } },
        select: { id: true, method: true, amount: true, confirmedAt: true, saleId: true },
        orderBy: { confirmedAt: 'desc' },
        take: 10,
      }),
    ]);
    const recent = [
      ...recentSales.map((s) => ({ kind: 'SALE' as const, at: s.soldAt, reference: s.reference, status: s.status, amount: money(s.total), customerName: s.customerName ?? null })),
      ...recentPayments.map((p) => ({ kind: 'PAYMENT' as const, at: p.confirmedAt!, reference: p.saleId, status: 'CONFIRMED', amount: money(p.amount), method: p.method })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10);

    const pct = (c: bigint, p: bigint | undefined) => (p === undefined || p === 0n ? null : Number(((c - p) * 10000n) / p) / 100);
    return {
      range: { from: r.from, to: r.to, days: r.days, timezoneOffsetMinutes: r.offsetMin },
      sales: { count: cur.salesCount, total: fromCents(cur.salesCents) },
      collections: { total: fromCents(cur.collectionsCents), note: 'Confirmed customer payments received in the period. Not revenue.' },
      expenses: { total: fromCents(cur.expensesCents), note: 'Active operating expenses in the period.' },
      purchases: { total: fromCents(cur.purchasesCents), note: 'Inventory purchases received in the period. Not an operating expense.' },
      receivablesAtEnd: { total: fromCents(bal.receivablesCents), exact: r.endUtc.getTime() >= Date.now() },
      payablesAtEnd: { total: fromCents(bal.payablesCents), exact: r.endUtc.getTime() >= Date.now() },
      lowStockCount: lowStock[0]?.count ?? 0,
      previous: prev
        ? {
            range: { from: prevRange!.from, to: prevRange!.to },
            salesTotal: fromCents(prev.salesCents),
            salesChangePercent: pct(cur.salesCents, prev.salesCents),
            collectionsTotal: fromCents(prev.collectionsCents),
            expensesTotal: fromCents(prev.expensesCents),
          }
        : null,
      recent,
    };
  }

  @Get('analytics/timeseries') @RequirePermission('analytics:read')
  async timeseries(@Me() me: CurrentUser, @Query() q: SeriesQuery) {
    const unit: Unit = q.granularity ?? 'day';
    const r = this.range(q, MAX_RANGE_DAYS);
    const keys = ruleGuard(() => bucketKeys(r.from, r.to, unit));
    const sums = await this.bucketSums(me.orgId, r, unit);
    const series = keys.map((k) => {
      const v = sums.get(k);
      return {
        bucket: k,
        salesCount: v?.salesCount ?? 0,
        sales: fromCents(v?.sales ?? 0n),
        collections: fromCents(v?.collections ?? 0n),
        expenses: fromCents(v?.expenses ?? 0n),
        purchases: fromCents(v?.purchases ?? 0n),
      };
    });
    return { range: { from: r.from, to: r.to, timezoneOffsetMinutes: r.offsetMin }, granularity: unit, series };
  }

  /** Best-selling products by sales value. Grouped on sale lines, so each line counts once. */
  @Get('analytics/products') @RequirePermission('analytics:read')
  async products(@Me() me: CurrentUser, @Query() q: TopQuery) {
    const r = this.range(q);
    const limit = q.limit ?? 10;
    const groups = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { organizationId: me.orgId, status: { in: SALE_STATUSES }, soldAt: { gte: r.startUtc, lt: r.endUtc } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: limit,
    });
    const ids = groups.map((g) => g.productId);
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids }, organizationId: me.orgId }, select: { id: true, name: true, sku: true } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      range: { from: r.from, to: r.to, timezoneOffsetMinutes: r.offsetMin },
      rankedBy: 'sales value',
      items: groups.map((g, i) => ({
        rank: i + 1,
        productId: g.productId,
        name: byId.get(g.productId)?.name ?? null,
        sku: byId.get(g.productId)?.sku ?? null,
        quantity: g._sum.quantity ?? 0,
        salesValue: money(g._sum.lineTotal),
      })),
    };
  }

  /** Stock levels against persisted reorder thresholds. Quantities only: no money fields, so every role may see it. */
  @Get('analytics/inventory') @RequirePermission('products:read')
  async inventory(@Me() me: CurrentUser, @Query() q: InventoryQuery) {
    const limit = q.limit ?? 20;
    const [totals, low] = await Promise.all([
      this.prisma.$queryRaw<{ products: number; units: number; low: number; out: number }[]>`
        SELECT COUNT(*)::int AS products, COALESCE(SUM(quantity), 0)::int AS units,
               COUNT(*) FILTER (WHERE quantity <= "reorderLevel")::int AS low,
               COUNT(*) FILTER (WHERE quantity = 0)::int AS out
        FROM "Product" WHERE "organizationId" = ${me.orgId}`,
      this.prisma.$queryRaw<{ id: string; name: string; sku: string; quantity: number; reorderLevel: number }[]>`
        SELECT id, name, sku, quantity, "reorderLevel" FROM "Product"
        WHERE "organizationId" = ${me.orgId} AND quantity <= "reorderLevel"
        ORDER BY quantity ASC, name ASC LIMIT ${limit}`,
    ]);
    const t = totals[0] ?? { products: 0, units: 0, low: 0, out: 0 };
    return {
      totals: { products: t.products, units: t.units, lowStock: t.low, outOfStock: t.out },
      lowStock: low,
    };
  }

  /** Customer receivables and supplier payables by party. Current balances, from the same rules as the ledger. */
  @Get('analytics/top-balances') @RequirePermission('reports:read')
  async topBalances(@Me() me: CurrentUser, @Query() q: TopQuery) {
    const limit = q.limit ?? 5;
    const [sales, payments] = await Promise.all([
      this.prisma.sale.findMany({ where: { organizationId: me.orgId, status: { in: SALE_STATUSES } }, select: { id: true, customerId: true, status: true, total: true } }),
      this.prisma.payment.findMany({ where: { organizationId: me.orgId, status: { in: ['CONFIRMED', 'PENDING'] } }, select: { saleId: true, status: true, amount: true } }),
    ]);
    const rec = receivablesByCustomer(
      sales.map((s) => ({ ...s, total: s.total.toFixed(2) })),
      payments.map((p) => ({ saleId: p.saleId, status: p.status, amount: p.amount.toFixed(2) })),
    );
    const customers = rec.rows.filter((r) => r.customerId !== null).slice(0, limit);
    const names = await this.prisma.customer.findMany({ where: { organizationId: me.orgId, id: { in: customers.map((c) => c.customerId!) } }, select: { id: true, name: true } });
    const nameBy = new Map(names.map((n) => [n.id, n.name]));
    return {
      customers: customers.map((c) => ({ customerId: c.customerId, name: nameBy.get(c.customerId!) ?? null, balanceDue: fromCents(c.balanceCents) })),
      totalReceivables: fromCents(rec.grandBalanceCents),
    };
  }

  /** Profit & Loss. Income and cost lines carry an explicit status, so unavailable figures are never shown as zero. */
  @Get('reports/profit-loss') @RequirePermission('reports:read')
  async profitLoss(@Me() me: CurrentUser, @Query() q: SeriesQuery) {
    const unit: Unit = q.granularity ?? 'month';
    const r = this.range(q, MAX_RANGE_DAYS, 30);
    const keys = ruleGuard(() => bucketKeys(r.from, r.to, unit));
    const [totals, endBal, sums] = await Promise.all([
      this.metricsFor(me.orgId, r),
      this.balancesAt(me.orgId, r.endUtc),
      this.bucketSums(me.orgId, r, unit),
    ]);
    const pnl = buildProfitLoss({
      grossSalesCents: totals.salesCents,
      operatingExpensesCents: totals.expensesCents,
      collectionsCents: totals.collectionsCents,
      purchasesCents: totals.purchasesCents,
      receivablesAtEndCents: endBal.receivablesCents,
      payablesAtEndCents: endBal.payablesCents,
      discountsCents: null,
      returnsCents: null,
      cogsCents: null,
    });

    const periods = keys.map((k) => {
      const v = sums.get(k);
      return {
        period: k,
        grossSales: fromCents(v?.sales ?? 0n),
        operatingExpenses: fromCents(v?.expenses ?? 0n),
        collections: fromCents(v?.collections ?? 0n),
        purchases: fromCents(v?.purchases ?? 0n),
        netProfit: null,
      };
    });
    // Reconciliation: the period rows must add up to the period totals computed independently.
    const sum = (f: (v: { sales: bigint; expenses: bigint; collections: bigint; purchases: bigint }) => bigint) =>
      [...sums.values()].reduce((acc, v) => acc + f(v), 0n);
    const reconciled = {
      grossSales: sum((v) => v.sales) === totals.salesCents,
      operatingExpenses: sum((v) => v.expenses) === totals.expensesCents,
      collections: sum((v) => v.collections) === totals.collectionsCents,
      purchases: sum((v) => v.purchases) === totals.purchasesCents,
    };
    return {
      range: { from: r.from, to: r.to, days: r.days, timezoneOffsetMinutes: r.offsetMin },
      granularity: unit,
      totals: {
        lines: pnl.lines,
        memo: pnl.memo,
      },
      periods,
      reconciled,
      notes: PNL_NOTES,
    };
  }
}

