import { wouldLeaveNoAdmin } from './admin-rules';

describe('last administrator protection', () => {
  it('blocks demoting or removing the only administrator', () => {
    expect(wouldLeaveNoAdmin('ADMIN', 'MANAGER', 1)).toBe(true);
    expect(wouldLeaveNoAdmin('ADMIN', null, 1)).toBe(true);
  });
  it('allows the change when another administrator exists', () => {
    expect(wouldLeaveNoAdmin('ADMIN', 'MANAGER', 2)).toBe(false);
    expect(wouldLeaveNoAdmin('ADMIN', null, 2)).toBe(false);
  });
  it('never blocks non-admin members or keeping the admin role', () => {
    expect(wouldLeaveNoAdmin('EMPLOYEE', null, 1)).toBe(false);
    expect(wouldLeaveNoAdmin('MANAGER', 'ADMIN', 1)).toBe(false);
    expect(wouldLeaveNoAdmin('ADMIN', 'ADMIN', 1)).toBe(false);
  });
});
