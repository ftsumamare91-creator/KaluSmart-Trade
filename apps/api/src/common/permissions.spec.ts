import { can, PERMISSIONS } from './permissions';

describe('permission matrix', () => {
  it('only admins manage users and read audit', () => {
    expect(can('ADMIN', 'users:manage')).toBe(true);
    expect(can('MANAGER', 'users:manage')).toBe(false);
    expect(can('ACCOUNTANT', 'audit:read')).toBe(false);
  });
  it('employees can sell but cannot see expenses', () => {
    expect(can('EMPLOYEE', 'sales:write')).toBe(true);
    expect(can('EMPLOYEE', 'expenses:read')).toBe(false);
  });
  it('accountants record expenses but cannot delete customers', () => {
    expect(can('ACCOUNTANT', 'expenses:write')).toBe(true);
    expect(can('ACCOUNTANT', 'customers:delete')).toBe(false);
  });
  it('unknown roles get nothing', () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can('GUEST', p)).toBe(false);
  });
});
