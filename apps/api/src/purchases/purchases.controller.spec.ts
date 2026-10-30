import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchasesController } from './purchases.controller';

const me: any = { id: 'u1', orgId: 'org1', role: 'MANAGER' };

/**
 * In-memory stand-in. It tests the rules and the calls made, not transaction rollback or real
 * row locking. Those need a database test run.
 */
function setup(opts: { status?: string; stock?: Record<string, number>; confirmedPayments?: number; soldOut?: boolean } = {}) {
  const stock: Record<string, number> = { p1: 10, p2: 0, ...(opts.stock ?? {}) };
  const purchase: any = {
    id: 'pu1',
    organizationId: 'org1',
    supplierId: 'sup1',
    status: opts.status ?? 'DRAFT',
    total: new Prisma.Decimal('21.00'),
    items: [
      { productId: 'p1', quantity: 2, unitCost: new Prisma.Decimal('10.00') },
      { productId: 'p2', quantity: 1, unitCost: new Prisma.Decimal('1.00') },
    ],
  };
  const movements: any[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE')) {
        // Stock change: values are [quantity, productId, orgId, quantity]. A reversal subtracts, a receipt adds.
        const qty = v[0] as number;
        const id = v[1] as string;
        const reversal = sql.includes('quantity - ');
        if (reversal && opts.soldOut) return [];
        if (!(id in stock)) return [];
        stock[id] += reversal ? -qty : qty;
        return [{ quantity: stock[id] }];
      }
      return []; // row lock
    }),
    purchase: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === purchase.id && where.organizationId === purchase.organizationId ? purchase : null)),
      findFirstOrThrow: jest.fn(async () => purchase),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== purchase.id || where.organizationId !== 'org1' || !where.status || where.status !== purchase.status) return { count: 0 };
        Object.assign(purchase, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => Object.assign(purchase, data)),
      create: jest.fn(async ({ data }: any) => ({ id: 'pu-new', items: data.items.create, ...data })),
    },
    supplier: { findFirst: jest.fn(async () => ({ id: 'sup1' })) },
    product: { findMany: jest.fn(async ({ where }: any) => where.id.in.filter((id: string) => id in stock).map((id: string) => ({ id }))) },
    stockMovement: { createMany: jest.fn(async ({ data }: any) => movements.push(...data)) },
    supplierPayment: { count: jest.fn(async () => opts.confirmedPayments ?? 0) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(tx)),
    purchase: tx.purchase,
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  return { controller: new PurchasesController(prisma, audit), tx, purchase, stock, movements };
}

const draft = { supplierId: 'sup1', items: [{ productId: 'p1', quantity: 2, unitCost: '10.00' }, { productId: 'p2', quantity: 1, unitCost: '1.00' }] } as any;

describe('purchase drafts', () => {
  it('computes line and purchase totals on the server and does not change stock', async () => {
    const { controller, tx, stock } = setup();
    await controller.create(me, { ...draft, total: '0.01' } as any);
    expect(tx.purchase.create.mock.calls[0][0].data.total.toFixed(2)).toBe('21.00');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(stock.p1).toBe(10);
  });

  it('refuses a product that is not in this organization', async () => {
    const { controller } = setup();
    await expect(controller.create(me, { supplierId: 'sup1', items: [{ productId: 'other-org', quantity: 1, unitCost: '1.00' }] } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a supplier that is not in this organization', async () => {
    const { controller, tx } = setup();
    tx.supplier.findFirst = jest.fn(async () => null);
    await expect(controller.create(me, draft)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a negative or zero unit cost before touching the database', async () => {
    const { controller, tx } = setup();
    await expect(controller.create(me, { supplierId: 'sup1', items: [{ productId: 'p1', quantity: 1, unitCost: '-3.00' }] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });
});

describe('receiving a purchase', () => {
  it('increases stock once, writes one movement per line, and marks it RECEIVED', async () => {
    const { controller, stock, movements, purchase } = setup();
    await controller.receive(me, 'pu1');
    expect(stock).toMatchObject({ p1: 12, p2: 1 });
    expect(movements.map((m) => [m.productId, m.delta, m.reason])).toEqual([['p1', 2, 'PURCHASE_RECEIPT'], ['p2', 1, 'PURCHASE_RECEIPT']]);
    expect(purchase.status).toBe('RECEIVED');
  });

  it('a second receive is refused and does not increase stock again', async () => {
    const { controller, stock } = setup();
    await controller.receive(me, 'pu1');
    await expect(controller.receive(me, 'pu1')).rejects.toBeInstanceOf(BadRequestException);
    expect(stock).toMatchObject({ p1: 12, p2: 1 });
  });

  it("another tenant's purchase is not found", async () => {
    const { controller } = setup();
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ADMIN' };
    await expect(controller.receive(outsider, 'pu1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a cancelled purchase cannot be received', async () => {
    const { controller, stock } = setup({ status: 'CANCELLED' });
    await expect(controller.receive(me, 'pu1')).rejects.toBeInstanceOf(BadRequestException);
    expect(stock.p1).toBe(10);
  });
});

describe('cancelling a purchase', () => {
  it('cancelling a draft changes no stock', async () => {
    const { controller, stock, purchase } = setup();
    await controller.cancel(me, 'pu1', {} as any);
    expect(purchase.status).toBe('CANCELLED');
    expect(stock.p1).toBe(10);
  });

  it('cancelling a received purchase reverses its stock with a reason', async () => {
    const { controller, stock, movements } = setup({ status: 'RECEIVED', stock: { p1: 12, p2: 1 } });
    await controller.cancel(me, 'pu1', { reason: 'supplier returned goods' } as any);
    expect(stock).toMatchObject({ p1: 10, p2: 0 });
    expect(movements.every((m) => m.reason === 'PURCHASE_REVERSAL' && m.delta < 0)).toBe(true);
  });

  it('refuses to reverse stock that has already been sold on', async () => {
    const { controller, purchase } = setup({ status: 'RECEIVED', soldOut: true });
    await expect(controller.cancel(me, 'pu1', { reason: 'supplier returned goods' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(purchase.status).toBe('RECEIVED');
  });

  it('refuses to cancel a received purchase that has a confirmed supplier payment', async () => {
    const { controller, purchase } = setup({ status: 'RECEIVED', confirmedPayments: 1 });
    await expect(controller.cancel(me, 'pu1', { reason: 'mistake' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(purchase.status).toBe('RECEIVED');
  });

  it('requires a reason to cancel a received purchase', async () => {
    const { controller } = setup({ status: 'RECEIVED' });
    await expect(controller.cancel(me, 'pu1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
