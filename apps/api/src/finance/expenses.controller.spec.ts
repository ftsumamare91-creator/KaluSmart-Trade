import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpensesController } from './finance.controller';

const me: any = { id: 'u1', orgId: 'org1', role: 'MANAGER' };

function setup() {
  const rows: any[] = [{ id: 'e1', organizationId: 'org1', status: 'ACTIVE', category: 'Rent', description: 'Shop', amount: new Prisma.Decimal('100.00'), paymentMethod: null, reference: null, spentAt: new Date('2026-10-01') }];
  const expense: any = {
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null),
    create: jest.fn(async ({ data }: any) => ({ id: `e${rows.length + 1}`, status: 'ACTIVE', ...data })),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id && r.organizationId === where.organizationId && (where.status === undefined || r.status === where.status));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findMany: jest.fn(async () => rows),
    count: jest.fn(async () => rows.length),
    aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal('100.00') } })),
  };
  const prisma: any = { expense };
  const audit: any = { record: jest.fn(async () => undefined) };
  return { controller: new ExpensesController(prisma, audit), rows, expense, audit };
}

describe('expenses', () => {
  it('rejects a zero or malformed amount before writing', async () => {
    const { controller, expense } = setup();
    await expect(controller.create(me, { category: 'Fuel', description: 'x', amount: '0.00' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(me, { category: 'Fuel', description: 'x', amount: '1.005' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(expense.create).not.toHaveBeenCalled();
  });

  it('a voided expense is not edited and is not voided twice', async () => {
    const { controller, rows } = setup();
    await controller.void(me, 'e1', { reason: 'entered twice' } as any);
    expect(rows[0].status).toBe('VOIDED');
    await expect(controller.void(me, 'e1', { reason: 'again' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.update(me, 'e1', { description: 'changed' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('voiding needs a reason', async () => {
    const { controller, rows } = setup();
    await expect(controller.void(me, 'e1', { reason: 'no' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0].status).toBe('ACTIVE');
  });

  it("another tenant's expense is not found for read, edit, or void", async () => {
    const { controller } = setup();
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ADMIN' };
    await expect(controller.one(outsider, 'e1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update(outsider, 'e1', { description: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.void(outsider, 'e1', { reason: 'nope' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list totals count only active expenses', async () => {
    const { controller, expense } = setup();
    const res: any = await controller.list(me, {} as any);
    expect(res.activeTotal).toBe('100.00');
    expect(expense.findMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('an edit is audited by field name, not by value', async () => {
    const { controller, audit } = setup();
    await controller.update(me, 'e1', { description: 'secret note' } as any);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'expense.update', details: { changed: ['description'] } }));
  });
});
