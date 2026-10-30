import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesController } from './sales.controller';

const sale = {
  id: 's1',
  organizationId: 'org1',
  reference: 'S-ABC-1234',
  status: 'CONFIRMED',
  total: new Prisma.Decimal('30.00'),
  customerName: 'Abebe',
  soldAt: new Date('2026-10-01T10:00:00Z'),
  items: [
    { quantity: 2, unitPrice: new Prisma.Decimal('10.00'), lineTotal: new Prisma.Decimal('20.00'), product: { name: 'Pen', sku: 'PEN-1' } },
    { quantity: 4, unitPrice: new Prisma.Decimal('2.50'), lineTotal: new Prisma.Decimal('10.00'), product: { name: 'Pad', sku: 'PAD-1' } },
  ],
  payments: [{ amount: new Prisma.Decimal('15.00') }],
};

function make(row: any | null, orgName: string | null = 'kalu Trading PLC') {
  const findFirst = jest.fn(async ({ where }: any) =>
    row && where.id === row.id && where.organizationId === row.organizationId ? row : null);
  const prisma: any = {
    sale: { findFirst, create: jest.fn() },
    organization: { findUnique: jest.fn(async () => (orgName ? { name: orgName } : null)) },
  };
  return { controller: new SalesController(prisma, { record: jest.fn() } as any), prisma, findFirst };
}

const me: any = { id: 'u1', orgId: 'org1', role: 'EMPLOYEE' };

describe('receipt data', () => {
  it('shows the stored lines, totals, paid amount and balance due', async () => {
    const { controller } = make(sale);
    const r: any = await controller.receipt(me, 's1');
    expect(r.reference).toBe('S-ABC-1234');
    expect(r.organizationName).toBe('kalu Trading PLC');
    expect(r.items).toEqual([
      { productName: 'Pen', sku: 'PEN-1', quantity: 2, unitPrice: '10.00', lineTotal: '20.00' },
      { productName: 'Pad', sku: 'PAD-1', quantity: 4, unitPrice: '2.50', lineTotal: '10.00' },
    ]);
    expect(r.total).toBe('30.00');
    expect(r.paid).toBe('15.00');
    expect(r.balanceDue).toBe('15.00');
  });

  it('keeps the historical unit price: the product price is never read', async () => {
    const { controller, findFirst } = make(sale);
    const r: any = await controller.receipt(me, 's1');
    expect(r.items[0].unitPrice).toBe('10.00');
    const productSelect = findFirst.mock.calls[0][0].include.items.include.product.select;
    expect(productSelect).toEqual({ name: true, sku: true });
  });

  it('never shows a negative balance when payments exceed the total', async () => {
    const overpaid = { ...sale, payments: [{ amount: new Prisma.Decimal('50.00') }] };
    const { controller } = make(overpaid);
    const r: any = await controller.receipt(me, 's1');
    expect(r.balanceDue).toBe('0.00');
  });

  it('returns not found for a missing sale', async () => {
    const { controller } = make(null);
    await expect(controller.receipt(me, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not found (not the data) for another tenant, and filters by the caller organization', async () => {
    const { controller, findFirst } = make(sale);
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ADMIN' };
    await expect(controller.receipt(outsider, 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where.organizationId).toBe('org2');
  });

  it('is read-only: it never creates a sale', async () => {
    const { controller, prisma } = make(sale);
    await controller.receipt(me, 's1');
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('handles a missing customer name and a missing organization name without inventing values', async () => {
    const anonymous = { ...sale, customerName: null };
    const { controller } = make(anonymous, null);
    const r: any = await controller.receipt(me, 's1');
    expect(r.customerName).toBeNull();
    expect(r.organizationName).toBeNull();
  });
});
