import { Injectable, Logger } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Range } from '../analytics/analytics-rules';
import { buildProfitLoss } from '../analytics/profit-loss';
import { fromCents, toCents } from '../finance/money';
import { payablesBySupplier, receivablesByCustomer } from '../finance/ledger';
import {
  AssistantPlan,
  compareLabel,
  etb,
  LIST_LIMIT,
  permittedTools,
  safeText,
  ToolName,
  ToolResult,
  TOOL_SPECS,
} from './assistant-tools';

/** Sales that count as revenue. The same rule the dashboard and P&L use. */
const SALE_STATUSES: SaleStatus[] = [SaleStatus.CONFIRMED, SaleStatus.PAID];
const UNAVAILABLE_LINE = 'This figure could not be retrieved right now. Do not estimate it.';

/**
 * Runs the allowlisted, read-only business queries for Ask TIBEB AI.
 *
 * Every query is scoped to `orgId`, which the controller takes from the authenticated session, never from the
 * request. Each tool is also re-checked against the caller's role here, so a missing check in the controller
 * cannot expose a restricted figure. A failing query returns an explicit "unavailable" result, not a guess.
 */
@Injectable()
export class AssistantDataService {
  private readonly log = new Logger('AssistantData');

  constructor(private prisma: PrismaService) {}

  async run(orgId: string, role: string, plan: AssistantPlan): Promise<{ results: ToolResult[]; denied: ToolName[] }> {
    const { allowed, denied } = permittedTools(role, plan.tools);
    const results: ToolResult[] = [];
    for (const tool of allowed) {
      try {
        results.push(await this.runTool(tool, orgId, plan));
      } catch (err) {
        // Log the tool name and error class only: never the query text, names or amounts.
        this.log.warn(`tool ${tool} failed: ${(err as Error)?.name ?? 'Error'}`);
        results.push(this.unavailable(tool, plan));
      }
    }
    return { results, denied };
  }

  private unavailable(tool: ToolName, plan: AssistantPlan): ToolResult {
    return {
      tool,
      label: TOOL_SPECS[tool].label,
      period: null,
      currency: 'ETB',
      recordCount: null,
      lines: [UNAVAILABLE_LINE],
      source: 'unavailable',
      unavailable: true,
    };
  }

  private periodOf(r: Range, label: string) {
    return { from: r.from, to: r.to, days: r.days, label };
  }

  private runTool(tool: ToolName, orgId: string, plan: AssistantPlan): Promise<ToolResult> {
    switch (tool) {
      case 'sales_summary':
        return this.salesSummary(orgId, plan);
      case 'top_products':
        return this.topProducts(orgId, plan);
      case 'low_stock':
        return this.lowStock(orgId);
      case 'collections':
        return this.collections(orgId, plan);
      case 'expenses':
        return this.expenses(orgId, plan);
      case 'receivables':
        return this.receivables(orgId);
      case 'payables':
        return this.payables(orgId);
      case 'profit_loss':
        return this.profitLoss(orgId, plan.period.range, plan.period.label);
    }
  }

  private async salesFor(orgId: string, r: Range) {
    const agg = await this.prisma.sale.aggregate({
      where: { organizationId: orgId, status: { in: SALE_STATUSES }, soldAt: { gte: r.startUtc, lt: r.endUtc } },
      _sum: { total: true },
      _count: true,
    });
    return { count: agg._count, total: agg._sum.total?.toFixed(2) ?? '0.00' };
  }

  private async salesSummary(orgId: string, plan: AssistantPlan): Promise<ToolResult> {
    const r = plan.period.range;
    const cur = await this.salesFor(orgId, r);
    const lines = [`Confirmed and paid sales: ${cur.count} invoices, total ${etb(cur.total)}.`];
    if (plan.compareRanges) {
      const comparisons: { c: Range; s: { count: number; total: string } }[] = [];
      for (const c of plan.compareRanges) {
        const s = await this.salesFor(orgId, c);
        comparisons.push({ c, s });
        lines.push(`Comparison period ${c.from} to ${c.to}: ${s.count} invoices, total ${etb(s.total)}.`);
      }
      if (comparisons.length === 2) {
        // Two calendar months: the later month compared with the earlier one.
        lines.push(`Change from the first month to the second: ${compareLabel(comparisons[0].s.total, comparisons[1].s.total)}.`);
      } else if (comparisons.length === 1) {
        lines.push(`Change against the previous period: ${compareLabel(comparisons[0].s.total, cur.total)}.`);
      }
    }
    return {
      tool: 'sales_summary',
      label: TOOL_SPECS.sales_summary.label,
      period: this.periodOf(r, plan.period.label),
      currency: 'ETB',
      recordCount: cur.count,
      lines,
      source: 'Sale records with status CONFIRMED or PAID, by sale date. Cancelled and draft sales are excluded.',
      unavailable: false,
    };
  }

  private async topProducts(orgId: string, plan: AssistantPlan): Promise<ToolResult> {
    const r = plan.period.range;
    const grouped = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { organizationId: orgId, status: { in: SALE_STATUSES }, soldAt: { gte: r.startUtc, lt: r.endUtc } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: LIST_LIMIT,
    });
    const ids = grouped.map((g) => g.productId);
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(products.map((p) => [p.id, p.name]));
    const lines = grouped.length
      ? [
          `Ranked by units sold, top ${grouped.length}:`,
          ...grouped.map((g, i) => `${i + 1}. ${safeText(names.get(g.productId) ?? 'Unnamed product')}: ${g._sum.quantity ?? 0} units, sales value ${etb(g._sum.lineTotal?.toFixed(2))}.`),
        ]
      : ['No confirmed or paid sales in this period.'];
    return {
      tool: 'top_products',
      label: TOOL_SPECS.top_products.label,
      period: this.periodOf(r, plan.period.label),
      currency: 'ETB',
      recordCount: grouped.length,
      lines,
      source: 'Sale lines of confirmed and paid sales dated in the period.',
      unavailable: false,
    };
  }

  private async lowStock(orgId: string): Promise<ToolResult> {
    const [count] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "Product" WHERE "organizationId" = ${orgId} AND quantity <= "reorderLevel"`;
    const items = await this.prisma.$queryRaw<{ name: string; quantity: number; reorderLevel: number }[]>`
      SELECT name, quantity, "reorderLevel" FROM "Product"
      WHERE "organizationId" = ${orgId} AND quantity <= "reorderLevel" ORDER BY quantity ASC LIMIT 10`;
    const total = count?.count ?? 0;
    const lines = [`Products at or below their reorder level: ${total}.`];
    for (const p of items) lines.push(`${safeText(p.name)}: ${p.quantity} left (reorder at ${p.reorderLevel}).`);
    if (total > items.length) lines.push(`${total - items.length} more not listed.`);
    return {
      tool: 'low_stock',
      label: TOOL_SPECS.low_stock.label,
      period: null,
      currency: 'ETB',
      recordCount: total,
      lines,
      source: 'Current product quantities and reorder levels (not period-bound).',
      unavailable: false,
    };
  }

  private async collections(orgId: string, plan: AssistantPlan): Promise<ToolResult> {
    const r = plan.period.range;
    const agg = await this.prisma.payment.aggregate({
      where: { organizationId: orgId, status: 'CONFIRMED', confirmedAt: { gte: r.startUtc, lt: r.endUtc } },
      _sum: { amount: true },
      _count: true,
    });
    return {
      tool: 'collections',
      label: TOOL_SPECS.collections.label,
      period: this.periodOf(r, plan.period.label),
      currency: 'ETB',
      recordCount: agg._count,
      lines: [
        `Confirmed payments by confirmation date: ${agg._count} payments, total ${etb(agg._sum.amount?.toFixed(2))}.`,
        'Pending, rejected and failed payments are not included. Collections are cash received and can differ from sales in the same period.',
      ],
      source: 'Payment records with status CONFIRMED.',
      unavailable: false,
    };
  }

  private async expenses(orgId: string, plan: AssistantPlan): Promise<ToolResult> {
    const r = plan.period.range;
    const where = { organizationId: orgId, status: 'ACTIVE' as const, spentAt: { gte: r.startUtc, lt: r.endUtc } };
    const [agg, byCategory] = await Promise.all([
      this.prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
      this.prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: LIST_LIMIT }),
    ]);
    const lines = [`Active expenses: ${agg._count} records, total ${etb(agg._sum.amount?.toFixed(2))}.`];
    if (byCategory.length) {
      lines.push('Largest categories:');
      for (const c of byCategory) lines.push(`${safeText(c.category)}: ${etb(c._sum.amount?.toFixed(2))}.`);
    }
    return {
      tool: 'expenses',
      label: TOOL_SPECS.expenses.label,
      period: this.periodOf(r, plan.period.label),
      currency: 'ETB',
      recordCount: agg._count,
      lines,
      source: 'Active operating expense records dated in the period. Voided expenses and inventory purchases are excluded.',
      unavailable: false,
    };
  }

  /** Receivables as of today, from confirmed or paid sales minus confirmed payments. */
  private async receivableLedger(orgId: string) {
    const sales = await this.prisma.sale.findMany({
      where: { organizationId: orgId, status: { in: SALE_STATUSES } },
      select: { id: true, customerId: true, status: true, total: true },
    });
    const payments = await this.prisma.payment.findMany({
      where: { organizationId: orgId, status: 'CONFIRMED' },
      select: { saleId: true, status: true, amount: true },
    });
    return receivablesByCustomer(
      sales.map((s) => ({ id: s.id, customerId: s.customerId, status: s.status, total: s.total.toFixed(2) })),
      payments.map((p) => ({ saleId: p.saleId, status: p.status, amount: p.amount.toFixed(2) })),
    );
  }

  private async receivables(orgId: string): Promise<ToolResult> {
    const ledger = await this.receivableLedger(orgId);
    const owing = ledger.rows.filter((row) => row.balanceCents > 0n);
    const named = owing.filter((row) => row.customerId);
    const customers = named.length
      ? await this.prisma.customer.findMany({
          where: { organizationId: orgId, id: { in: named.map((row) => row.customerId as string) } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(customers.map((c) => [c.id, c.name]));
    const lines = [`Sales with an unpaid balance: ${owing.reduce((n, row) => n + row.saleCount, 0)}. Total outstanding: ${etb(fromCents(ledger.grandBalanceCents))}.`];
    const top = owing.slice(0, LIST_LIMIT);
    if (top.length) lines.push('Largest balances:');
    for (const row of top) {
      const who = row.customerId ? safeText(names.get(row.customerId) ?? 'Customer') : 'Walk-in sales (no named customer)';
      lines.push(`${who}: ${etb(fromCents(row.balanceCents))}.`);
    }
    return {
      tool: 'receivables',
      label: TOOL_SPECS.receivables.label,
      period: null,
      currency: 'ETB',
      recordCount: owing.length,
      lines,
      source: 'Confirmed and paid sales minus confirmed payments, grouped by customer. Balances are as of today.',
      unavailable: false,
    };
  }

  /** Payables as of today, from received purchases minus confirmed supplier payments. */
  private async payableLedger(orgId: string) {
    const purchases = await this.prisma.purchase.findMany({
      where: { organizationId: orgId, status: 'RECEIVED' },
      select: { id: true, supplierId: true, status: true, total: true },
    });
    const payments = await this.prisma.supplierPayment.findMany({
      where: { organizationId: orgId, status: 'CONFIRMED' },
      select: { purchaseId: true, status: true, amount: true },
    });
    return payablesBySupplier(
      purchases.map((p) => ({ id: p.id, supplierId: p.supplierId, status: p.status, total: p.total.toFixed(2) })),
      payments.map((p) => ({ purchaseId: p.purchaseId, status: p.status, amount: p.amount.toFixed(2) })),
    );
  }

  private async payables(orgId: string): Promise<ToolResult> {
    const ledger = await this.payableLedger(orgId);
    const owed = ledger.rows.filter((row) => row.balanceCents > 0n);
    const suppliers = owed.length
      ? await this.prisma.supplier.findMany({
          where: { organizationId: orgId, id: { in: owed.map((row) => row.supplierId) } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    const lines = [`Suppliers owed money: ${owed.length}. Total payable: ${etb(fromCents(ledger.grandBalanceCents))}.`];
    const top = owed.slice(0, LIST_LIMIT);
    if (top.length) lines.push('Largest balances:');
    for (const row of top) lines.push(`${safeText(names.get(row.supplierId) ?? 'Supplier')}: ${etb(fromCents(row.balanceCents))}.`);
    return {
      tool: 'payables',
      label: TOOL_SPECS.payables.label,
      period: null,
      currency: 'ETB',
      recordCount: owed.length,
      lines,
      source: 'Received purchases minus confirmed supplier payments, grouped by supplier. Balances are as of today.',
      unavailable: false,
    };
  }

  private async profitLoss(orgId: string, r: Range, label: string): Promise<ToolResult> {
    const [sales, expenses, collections, purchases, receivables, payables] = await Promise.all([
      this.salesFor(orgId, r),
      this.prisma.expense.aggregate({
        where: { organizationId: orgId, status: 'ACTIVE', spentAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { organizationId: orgId, status: 'CONFIRMED', confirmedAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { amount: true },
      }),
      this.prisma.purchase.aggregate({
        where: { organizationId: orgId, status: 'RECEIVED', receivedAt: { gte: r.startUtc, lt: r.endUtc } },
        _sum: { total: true },
      }),
      this.receivableLedger(orgId),
      this.payableLedger(orgId),
    ]);

    // Cost of goods sold is not recorded per sale, so gross and net profit are reported as unavailable.
    const pnl = buildProfitLoss({
      grossSalesCents: toCents(sales.total),
      operatingExpensesCents: toCents(expenses._sum.amount?.toFixed(2) ?? '0.00'),
      collectionsCents: toCents(collections._sum.amount?.toFixed(2) ?? '0.00'),
      purchasesCents: toCents(purchases._sum.total?.toFixed(2) ?? '0.00'),
      receivablesAtEndCents: receivables.grandBalanceCents,
      payablesAtEndCents: payables.grandBalanceCents,
      discountsCents: null,
      returnsCents: null,
      cogsCents: null,
    });

    const lines: string[] = [];
    for (const line of pnl.lines) {
      lines.push(line.amount === null ? `${line.label}: unavailable. ${line.note ?? ''}`.trim() : `${line.label}: ${etb(line.amount)}.`);
    }
    for (const m of pnl.memo) {
      lines.push(`${m.label}: ${m.amount === null ? 'unavailable' : etb(m.amount)}. ${m.note ?? ''}`.trim());
    }
    lines.push('Receivables and payables are balances as of today, not at the end of the period.');
    return {
      tool: 'profit_loss',
      label: TOOL_SPECS.profit_loss.label,
      period: this.periodOf(r, label),
      currency: 'ETB',
      recordCount: sales.count,
      lines,
      source: 'Sales, active expenses, confirmed collections, received purchases and balances. Cost of goods sold is not recorded, so gross and net profit are unavailable.',
      unavailable: false,
    };
  }
}


