import { can } from './permissions';

describe('role scope for money data', () => {
  it('EMPLOYEE can sell but cannot read expenses', () => {
    expect(can('EMPLOYEE', 'sales:read')).toBe(true);
    expect(can('EMPLOYEE', 'expenses:read')).toBe(false);
  });
  it('ACCOUNTANT and MANAGER can read expenses', () => {
    expect(can('ACCOUNTANT', 'expenses:read')).toBe(true);
    expect(can('MANAGER', 'expenses:read')).toBe(true);
  });
});
