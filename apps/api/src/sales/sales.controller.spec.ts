import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesController } from './sales.controller';

const me: any = { id: 'u1', orgId: 'org1', role: 'EMPLOYEE' };

/** In-memory stand-in for the products table. Enough to test the sale rules, not a database test. */
function setup(opts: { stock?: Record<string, number>; existing?: any } = {}) {
  const stock: Record<string, number> = { p1: 50, p2: 5, ...(opts.stock ?? {}) };
  const price: Record<string, Prisma.Decimal> = { p1: new Prisma.Decimal('10.00'), p2: new Prisma.Decimal('2.50') };
  const names: Record<string, string> = { p1: 'Pen', p2: 'Pad' };

  const tx: any = {
    product: {
      findMany: jest.fn(async ({ where }: any) =>
        (where.id.in as string[]).filter((id) => id in stock).map((id) => ({ id, name: names[id], unitPrice: price[id] }))),
    },
    // Tagged template: values are [quantity, productId, orgId, quantity].
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const qty = values[0] as number;
      const id = values[1] as string;
      if (stock[id] >= qty) { stock[id] -= qty; return [{ quantity: stock[id] }]; }
      return [];
    }),
    customer: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'c1' && where.organizationId === 'org1' ? { id: 'c1', name: 'Abebe' } : null)) },
    stockMovement: { createMany: jest.fn(async () => ({ count: 0 })) },
    sale: {
      create: jest.fn(async ({ data }: any) => ({
        id: 's-new',
        reference: data.reference,
        total: data.total,
        customerName: data.customerName,
        items: data.items.create,
      })),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(tx)),
    sale: { findFirst: jest.fn(async () => opts.existing ?? null) },
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  return { controller: new SalesController(prisma, audit), tx, prisma, stock, audit };
}

describe('multi-item sales', () => {
  it('sums repeated product lines and deducts each product once', async () => {
    const { controller, tx, stock } = setup();
    const sale: any = await controller.create(me, { items: [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3 }] } as any);
    expect(tx.sale.create).toHaveBeenCalledTimes(1);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(5);
    expect(stock.p1).toBe(45);
  });

  it('prices every line from the database and totals on the server', async () => {
    const { controller, tx } = setup();
    await controller.create(me, { items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 4 }] } as any);
    const data = tx.sale.create.mock.calls[0][0].data;
    expect(data.total.toFixed(2)).toBe('30.00'); // 2 x 10.00 + 4 x 2.50
  });

  it('rejects the sale and does not create it when one line lacks stock', async () => {
    const { controller, tx } = setup();
    await expect(
      controller.create(me, { items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 6 }] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('rejects unknown products without creating a sale', async () => {
    const { controller, tx } = setup();
    await expect(controller.create(me, { items: [{ productId: 'nope', quantity: 1 }] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });
});

describe('idempotent submission', () => {
  const body = { items: [{ productId: 'p1', quantity: 2 }] };
  const stored = { id: 's0', reference: 'S-OLD', customerName: null, total: new Prisma.Decimal('20'), items: [{ productId: 'p1', quantity: 2 }] };

  it('returns the existing sale for a retry with the same key and does not deduct again', async () => {
    const { controller, tx, stock } = setup({ existing: stored });
    const result: any = await controller.create(me, body as any, 'retry-key-123');
    expect(result.id).toBe('s0');
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(stock.p1).toBe(50);
  });

  it('refuses a reused key for a different request', async () => {
    const { controller } = setup({ existing: stored });
    await expect(
      controller.create(me, { items: [{ productId: 'p2', quantity: 1 }] } as any, 'retry-key-123'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed keys', async () => {
    const { controller } = setup();
    await expect(controller.create(me, body as any, 'bad key!')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(me, body as any, 'short')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the key on the new sale', async () => {
    const { controller, tx } = setup();
    await controller.create(me, body as any, 'fresh-key-9876');
    expect(tx.sale.create.mock.calls[0][0].data.idempotencyKey).toBe('fresh-key-9876');
  });
});
