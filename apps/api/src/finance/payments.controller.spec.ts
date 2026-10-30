import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsController, summarize } from './payments.controller';
import { unavailableAdapter } from './payment-verification';

const D = (v: string) => new Prisma.Decimal(v);
const me: any = { id: 'u1', orgId: 'org1', role: 'ACCOUNTANT' };

function make(opts: { payments?: any[]; createError?: unknown; total?: string; saleStatus?: string } = {}) {
  const sale = { id: 's1', organizationId: 'org1', status: opts.saleStatus ?? 'CONFIRMED', total: D(opts.total ?? '30.00') };
  const store: { payments: any[]; attempts: any[] } = {
    payments: (opts.payments ?? []).map((p, i) => ({ id: p.id ?? `p${i + 1}`, saleId: 's1', organizationId: 'org1', method: 'CASH', ...p })),
    attempts: [],
  };
  const byId = (where: any) => store.payments.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null;
  const prisma: any = {
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(prisma)),
    sale: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === sale.id && where.organizationId === sale.organizationId ? sale : null)),
      findFirstOrThrow: jest.fn(async ({ where }: any) => {
        if (where.organizationId !== sale.organizationId) throw new Error('not found');
        return sale;
      }),
      update: jest.fn(async () => ({})),
    },
    payment: {
      findMany: jest.fn(async ({ where }: any) => store.payments.filter((p) => p.saleId === where.saleId && p.organizationId === where.organizationId)),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.providerTransactionId !== undefined) {
          return (
            store.payments.find(
              (p) => p.providerTransactionId === where.providerTransactionId && p.organizationId === where.organizationId && p.id !== where.NOT?.id,
            ) ?? null
          );
        }
        return byId(where);
      }),
      findFirstOrThrow: jest.fn(async ({ where }: any) => {
        const row = byId(where);
        if (!row) throw new Error('not found');
        return row;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (opts.createError) throw opts.createError;
        const row = { id: `p${store.payments.length + 1}`, ...data, status: 'PENDING' };
        store.payments.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = store.payments.find((p) => p.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = store.payments.find((p) => p.id === where.id && p.organizationId === where.organizationId && p.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    paymentVerificationAttempt: {
      create: jest.fn(async ({ data }: any) => {
        store.attempts.push(data);
        return data;
      }),
      findMany: jest.fn(async ({ where }: any) => store.attempts.filter((a) => a.paymentId === where.paymentId && a.organizationId === where.organizationId)),
    },
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  const controller = new PaymentsController(prisma, audit);
  return { controller, prisma, store, audit };
}

const cash = (amount: string) => ({ method: 'CASH', amount } as any);

describe('balance rules', () => {
  it('counts only confirmed payments as received; pending is reserved; rejected is ignored', () => {
    const s = summarize(D('30.00'), [
      { status: 'CONFIRMED', amount: D('10.00') },
      { status: 'PENDING', amount: D('5.00') },
      { status: 'REJECTED', amount: D('50.00') },
    ]);
    expect(s.view).toEqual({ total: '30.00', confirmed: '10.00', pending: '5.00', balanceDue: '20.00' });
  });

  it('never reports a negative balance', () => {
    expect(summarize(D('30.00'), [{ status: 'CONFIRMED', amount: D('45.00') }]).view.balanceDue).toBe('0.00');
  });

  it('uses integer cents, so 0.10 + 0.20 is exactly 0.30', () => {
    const s = summarize(D('0.30'), [{ status: 'CONFIRMED', amount: D('0.10') }, { status: 'CONFIRMED', amount: D('0.20') }]);
    expect(s.view.balanceDue).toBe('0.00');
  });
});

describe('recording a payment', () => {
  const me2: any = { id: 'u2', orgId: 'org1', role: 'EMPLOYEE' };

  it('accepts a full payment when nothing else is recorded', async () => {
    const { controller, prisma } = make();
    await controller.record(me2, 's1', cash('30.00'));
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('accepts partial payments until the balance is covered', async () => {
    const { controller, store } = make({ payments: [{ status: 'CONFIRMED', amount: D('10.00') }] });
    await controller.record(me2, 's1', cash('20.00'));
    expect(store.payments).toHaveLength(2);
  });

  it('refuses an amount above the balance due', async () => {
    const { controller, prisma } = make({ payments: [{ status: 'CONFIRMED', amount: D('25.00') }] });
    await expect(controller.record(me2, 's1', cash('10.00'))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('counts pending payments against the balance so they cannot over-promise', async () => {
    const { controller, prisma } = make({ payments: [{ status: 'PENDING', amount: D('25.00') }] });
    await expect(controller.record(me2, 's1', cash('10.00'))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('allows a new payment after a rejected one', async () => {
    const { controller, prisma } = make({ payments: [{ status: 'REJECTED', amount: D('25.00') }] });
    await controller.record(me2, 's1', cash('30.00'));
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('refuses zero', async () => {
    const { controller } = make();
    await expect(controller.record(me2, 's1', cash('0.00'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reference for bank transfer and Telebirr', async () => {
    const { controller } = make();
    await expect(controller.record(me2, 's1', { method: 'TELEBIRR', amount: '5.00' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('turns a duplicate receipt reference into a 400, not a 500', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' });
    const { controller } = make({ createError: dup });
    await expect(controller.record(me2, 's1', { method: 'BANK_TRANSFER', amount: '5.00', providerReference: 'REF-1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes an audit entry on success', async () => {
    const { controller, audit } = make();
    await controller.record(me2, 's1', cash('5.00'));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.record' }));
  });

  it('refuses another tenant\'s sale', async () => {
    const { controller, prisma } = make();
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'EMPLOYEE' };
    await expect(controller.record(outsider, 's1', cash('5.00'))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

describe('confirming a payment', () => {
  it('confirms a payment that fits, and marks the sale PAID when fully covered', async () => {
    const { controller, prisma } = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    await controller.confirm(me, 'p1');
    expect(prisma.sale.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAID' } }));
  });

  it('refuses a confirmation that would exceed the total, and leaves the payment pending', async () => {
    const { controller, prisma } = make({
      payments: [
        { id: 'p0', status: 'CONFIRMED', amount: D('20.00') },
        { id: 'p1', status: 'PENDING', amount: D('15.00') },
      ],
    });
    await expect(controller.confirm(me, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('cannot confirm a payment twice', async () => {
    const { controller } = make({ payments: [{ id: 'p1', status: 'CONFIRMED', amount: D('5.00') }] });
    await expect(controller.confirm(me, 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a missing payment is not found', async () => {
    const { controller } = make();
    await expect(controller.confirm(me, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('balance endpoint', () => {
  it('reports pending separately from confirmed', async () => {
    const { controller } = make({ payments: [{ status: 'PENDING', amount: D('10.00') }] });
    const view: any = await controller.balance({ id: 'u1', orgId: 'org1', role: 'EMPLOYEE' } as any, 's1');
    expect(view).toEqual({ total: '30.00', confirmed: '0.00', pending: '10.00', balanceDue: '30.00' });
  });
});

describe('manual review (accountant or admin)', () => {
  it('records a manual confirmation as MANUAL with an auditable attempt, and never as provider verification', async () => {
    const { controller, store } = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    const row = await controller.confirm(me, 'p1');
    expect((row as any).verificationMethod).toBe('MANUAL');
    expect((row as any).verifiedAmount).toBeUndefined();
    expect(store.attempts).toEqual([expect.objectContaining({ kind: 'MANUAL_REVIEW', outcome: 'VERIFIED', requestedById: 'u1' })]);
  });

  it('a second manual confirmation of the same payment is refused and adds no attempt (idempotent)', async () => {
    const { controller, store } = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    await controller.confirm(me, 'p1');
    await expect(controller.confirm(me, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(store.attempts).toHaveLength(1);
  });

  it('a rejection is recorded as an auditable manual decision and leaves the payment REJECTED', async () => {
    const { controller, store } = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    const row: any = await controller.reject(me, 'p1');
    expect(row.status).toBe('REJECTED');
    expect(store.attempts).toEqual([expect.objectContaining({ kind: 'MANUAL_REVIEW', outcome: 'REJECTED' })]);
  });

  it('does not let a decided payment be rejected after the fact', async () => {
    const { controller } = make({ payments: [{ id: 'p1', status: 'CONFIRMED', amount: D('30.00') }] });
    await expect(controller.reject(me, 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses another tenant's payment", async () => {
    const { controller } = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ACCOUNTANT' };
    await expect(controller.confirm(outsider, 'p1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.reject(outsider, 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('provider verification', () => {
  const tele = { id: 'p1', method: 'TELEBIRR', status: 'PENDING', amount: D('30.00'), providerReference: 'TX123456' };
  const ok = (over: any = {}) => ({ kind: 'VERIFIED', transactionId: 'PROV-9001', amount: '30.00', currency: 'ETB', ...over });
  const withAdapter = (ctrl: any, lookup: () => Promise<any>) => {
    ctrl.adapters = { TELEBIRR: { method: 'TELEBIRR', configured: true, lookup }, BANK_TRANSFER: unavailableAdapter('BANK_TRANSFER', false, 'PROVIDER_NOT_CONFIGURED') };
  };

  it('confirms only on a provider VERIFIED answer, records PROVIDER, the provider ID and the verified amount', async () => {
    const h = make({ payments: [tele] });
    withAdapter(h.controller, async () => ok());
    const res: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(res.outcome).toBe('VERIFIED');
    expect(res.payment).toMatchObject({ status: 'CONFIRMED', verificationMethod: 'PROVIDER', providerTransactionId: 'PROV-9001', verifiedCurrency: 'ETB' });
    expect(h.store.attempts).toEqual([expect.objectContaining({ kind: 'PROVIDER_CHECK', outcome: 'VERIFIED' })]);
    expect(h.prisma.sale.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PAID' } }));
  });

  it('a repeated check of a provider-verified payment is idempotent and does not call the provider again', async () => {
    const h = make({ payments: [tele] });
    const lookup = jest.fn(async () => ok());
    withAdapter(h.controller, lookup);
    await h.controller.verifyWithProvider(me, 'p1');
    const again: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(again.outcome).toBe('VERIFIED');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(h.store.attempts).toHaveLength(1);
  });

  it('a provider timeout or outage never verifies, and leaves the payment PENDING with an attempt', async () => {
    const h = make({ payments: [tele] });
    withAdapter(h.controller, async () => {
      throw new Error('socket hang up');
    });
    const res: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(res).toMatchObject({ outcome: 'UNAVAILABLE', errorCode: 'PROVIDER_ERROR' });
    expect(h.store.payments[0].status).toBe('PENDING');
    expect(h.store.payments[0].verificationMethod).toBeUndefined();
    expect(h.store.attempts[0]).toMatchObject({ outcome: 'UNAVAILABLE', errorCode: 'PROVIDER_ERROR' });
  });

  it('an amount mismatch fails the payment; it does not count as received', async () => {
    const h = make({ payments: [tele] });
    withAdapter(h.controller, async () => ok({ amount: '20.00' }));
    const res: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(res).toMatchObject({ outcome: 'FAILED', errorCode: 'AMOUNT_MISMATCH' });
    expect(h.store.payments[0].status).toBe('FAILED');
    expect(summarize(D('30.00'), h.store.payments).view.confirmed).toBe('0.00');
  });

  it('one provider transaction cannot credit two payments (duplicate is refused and recorded)', async () => {
    const h = make({
      payments: [
        { id: 'p0', method: 'TELEBIRR', status: 'CONFIRMED', amount: D('10.00'), providerTransactionId: 'PROV-9001', verificationMethod: 'PROVIDER' },
        { ...tele, amount: D('10.00') },
      ],
      total: '30.00',
    });
    withAdapter(h.controller, async () => ok({ amount: '10.00' }));
    const res: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(res).toMatchObject({ outcome: 'FAILED', errorCode: 'DUPLICATE_TRANSACTION' });
    expect(h.store.payments.find((p) => p.id === 'p1').status).toBe('FAILED');
  });

  it('cash has no provider and cannot be checked', async () => {
    const h = make({ payments: [{ id: 'p1', method: 'CASH', status: 'PENDING', amount: D('30.00') }] });
    await expect(h.controller.verifyWithProvider(me, 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an unconfigured provider leaves the payment for manual review', async () => {
    const h = make({ payments: [tele] });
    h.controller.adapters = { TELEBIRR: unavailableAdapter('TELEBIRR', false, 'PROVIDER_NOT_CONFIGURED'), BANK_TRANSFER: unavailableAdapter('BANK_TRANSFER', false, 'PROVIDER_NOT_CONFIGURED') };
    const res: any = await h.controller.verifyWithProvider(me, 'p1');
    expect(res).toMatchObject({ outcome: 'UNAVAILABLE', errorCode: 'PROVIDER_NOT_CONFIGURED' });
    expect(h.store.payments[0].status).toBe('PENDING');
  });

  it("refuses another tenant's payment", async () => {
    const h = make({ payments: [tele] });
    withAdapter(h.controller, async () => ok());
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ADMIN' };
    await expect(h.controller.verifyWithProvider(outsider, 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.store.attempts).toHaveLength(0);
  });
});

describe('verification history', () => {
  it('lists attempts for the payment in the caller organization only', async () => {
    const h = make({ payments: [{ id: 'p1', status: 'PENDING', amount: D('30.00') }] });
    await h.controller.reject(me, 'p1');
    const list: any = await h.controller.attempts(me, 'p1');
    expect(list).toHaveLength(1);
    const outsider: any = { id: 'u9', orgId: 'org2', role: 'ADMIN' };
    await expect(h.controller.attempts(outsider, 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
