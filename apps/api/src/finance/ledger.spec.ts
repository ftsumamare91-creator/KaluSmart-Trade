import { assertFits, balanceFor, payablesBySupplier, receivablesByCustomer } from './ledger';
import { RuleError } from './rule-error';

describe('customer balance per sale', () => {
  it('counts only CONFIRMED payments as received', () => {
    const b = balanceFor('100.00', [
      { status: 'CONFIRMED', amount: '30.00' },
      { status: 'PENDING', amount: '20.00' },
      { status: 'REJECTED', amount: '50.00' },
      { status: 'FAILED', amount: '50.00' },
    ]);
    expect(b.confirmedCents).toBe(3000n);
    expect(b.pendingCents).toBe(2000n);
    expect(b.balanceCents).toBe(7000n);
  });

  it('partial payments then final settlement reach zero exactly (no float drift)', () => {
    const pay = (n: string) => ({ status: 'CONFIRMED', amount: n });
    expect(balanceFor('0.30', [pay('0.10'), pay('0.20')]).balanceCents).toBe(0n);
    expect(balanceFor('100.00', [pay('33.33'), pay('33.33'), pay('33.34')]).balanceCents).toBe(0n);
  });

  it('reports overpayment separately and never shows a negative balance', () => {
    const b = balanceFor('10.00', [{ status: 'CONFIRMED', amount: '12.50' }]);
    expect(b.balanceCents).toBe(0n);
    expect(b.overpaidCents).toBe(250n);
  });

  it('a new payment must fit the balance after pending amounts are reserved', () => {
    const b = balanceFor('100.00', [{ status: 'PENDING', amount: '80.00' }]);
    expect(() => assertFits(b, '30.00')).toThrow(RuleError);
    expect(() => assertFits(b, '20.00')).not.toThrow();
  });
});

describe('receivables by customer', () => {
  const sales = [
    { id: 's1', customerId: 'c1', status: 'CONFIRMED', total: '100.00' },
    { id: 's2', customerId: 'c1', status: 'PAID', total: '50.00' },
    { id: 's3', customerId: null, status: 'CONFIRMED', total: '20.00' },
    { id: 's4', customerId: 'c2', status: 'CANCELLED', total: '999.00' },
    { id: 's5', customerId: 'c2', status: 'DRAFT', total: '999.00' },
  ];
  const payments = [
    { saleId: 's1', status: 'CONFIRMED', amount: '40.00' },
    { saleId: 's2', status: 'CONFIRMED', amount: '50.00' },
    { saleId: 's3', status: 'PENDING', amount: '20.00' },
  ];

  it('excludes cancelled and draft sales, and groups walk-ins separately', () => {
    const { rows, grandBalanceCents } = receivablesByCustomer(sales, payments);
    const c1 = rows.find((r) => r.customerId === 'c1')!;
    expect(c1.saleCount).toBe(2);
    expect(c1.balanceCents).toBe(6000n); // (100-40) + (50-50)
    const walkIn = rows.find((r) => r.customerId === null)!;
    expect(walkIn.balanceCents).toBe(2000n); // pending does not reduce it
    expect(rows.find((r) => r.customerId === 'c2')).toBeUndefined();
    expect(grandBalanceCents).toBe(8000n);
  });

  it('the grand total equals the sum of every receivable sale balance (reconciliation)', () => {
    const { grandBalanceCents, rows } = receivablesByCustomer(sales, payments);
    expect(rows.reduce((a, r) => a + r.balanceCents, 0n)).toBe(grandBalanceCents);
    expect(grandBalanceCents).toBe(60n * 100n + 0n + 20n * 100n);
  });
});

describe('payables by supplier', () => {
  const purchases = [
    { id: 'p1', supplierId: 'sup1', status: 'RECEIVED', total: '500.00' },
    { id: 'p2', supplierId: 'sup1', status: 'DRAFT', total: '900.00' },
    { id: 'p3', supplierId: 'sup1', status: 'CANCELLED', total: '900.00' },
    { id: 'p4', supplierId: 'sup2', status: 'RECEIVED', total: '75.00' },
  ];
  const payments = [
    { purchaseId: 'p1', status: 'CONFIRMED', amount: '200.00' },
    { purchaseId: 'p1', status: 'PENDING', amount: '100.00' },
    { purchaseId: 'p4', status: 'REJECTED', amount: '75.00' },
  ];

  it('counts only RECEIVED purchases, and only confirmed supplier payments', () => {
    const { rows, grandBalanceCents } = payablesBySupplier(purchases, payments);
    const s1 = rows.find((r) => r.supplierId === 'sup1')!;
    expect(s1.purchaseCount).toBe(1);
    expect(s1.paidCents).toBe(20000n);
    expect(s1.pendingCents).toBe(10000n);
    expect(s1.balanceCents).toBe(30000n);
    expect(rows.find((r) => r.supplierId === 'sup2')!.balanceCents).toBe(7500n);
    expect(grandBalanceCents).toBe(37500n);
  });

  it('a draft or cancelled purchase is never a liability', () => {
    const { rows } = payablesBySupplier([{ id: 'x', supplierId: 'sup9', status: 'DRAFT', total: '10.00' }], []);
    expect(rows).toHaveLength(0);
  });
});
