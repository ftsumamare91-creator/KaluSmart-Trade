import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalyticsController } from './analytics.controller';

const me: any = { id: 'u1', orgId: 'org1', role: 'MANAGER' };

/** Records every where-clause so tests can check tenant scoping. Not a database test. */
function setup() {
  const calls: { model: string; where: any }[] = [];
  const agg = (model: string) => jest.fn(async (args: any) => {
    calls.push({ model, where: args.where });
    return { _sum: { total: new Prisma.Decimal('0'), amount: new Prisma.Decimal('0'), total2: null }, _count: { _all: 0 } };
  });
  const prisma: any = {
    sale: { aggregate: agg('sale'), findMany: jest.fn(async (args: any) => { calls.push({ model: 'sale', where: args.where }); return []; }) },
    payment: { aggregate: agg('payment'), findMany: jest.fn(async (args: any) => { calls.push({ model: 'payment', where: args.where }); return []; }) },
    expense: { aggregate: agg('expense') },
    purchase: { aggregate: agg('purchase') },
    saleItem: { groupBy: jest.fn(async (args: any) => { calls.push({ model: 'saleItem', where: args.where }); return []; }) },
    product: { findMany: jest.fn(async () => []) },
    customer: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ model: 'raw', where: { org: values[0], sql: strings.join('?') } });
      return [];
    }),
  };
  return { controller: new AnalyticsController(prisma), calls };
}

describe('analytics API', () => {
  it('scopes every aggregate to the caller organization', async () => {
    const { controller, calls } = setup();
    await controller.overview(me, { from: '2026-10-01', to: '2026-10-31' } as any);
    const orgScoped = calls.filter((c) => c.model !== 'raw').every((c) => c.where.organizationId === 'org1');
    expect(orgScoped).toBe(true);
    expect(calls.filter((c) => c.model === 'raw').every((c) => c.where.org === 'org1')).toBe(true);
  });

  it('best-selling products are grouped on sale lines within the tenant', async () => {
    const { controller, calls } = setup();
    await controller.products(me, { from: '2026-10-01', to: '2026-10-31' } as any);
    const g = calls.find((c) => c.model === 'saleItem')!;
    expect(g.where.sale.organizationId).toBe('org1');
  });

  it('refuses an impossible date and an oversized range before querying', async () => {
    const { controller, calls } = setup();
    await expect(controller.overview(me, { from: '2026-02-30' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.timeseries(me, { from: '2020-01-01', to: '2026-10-01', granularity: 'day' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('an end date before the start date is refused', async () => {
    const { controller } = setup();
    await expect(controller.profitLoss(me, { from: '2026-10-10', to: '2026-10-01' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('empty data returns genuine zeros, not invented figures', async () => {
    const { controller } = setup();
    const res: any = await controller.overview(me, { from: '2026-10-01', to: '2026-10-07' } as any);
    expect(res.sales).toEqual({ count: 0, total: '0.00' });
    expect(res.recent).toEqual([]);
  });

  it('the profit & loss report marks profit unavailable when no cost basis exists', async () => {
    const { controller } = setup();
    const res: any = await controller.profitLoss(me, { from: '2026-10-01', to: '2026-10-31', granularity: 'month' } as any);
    const np = res.totals.lines.find((l: any) => l.key === 'netProfit');
    expect(np.status).toBe('UNAVAILABLE');
    expect(np.amount).toBeNull();
    expect(res.periods[0].netProfit).toBeNull();
  });
});
