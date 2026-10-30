/** Single source of truth for who may do what. Enforced server-side on every endpoint. */
export const ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

const ALL: Role[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'];

export const PERMISSIONS = {
  'customers:read': ALL,
  'customers:write': ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  'customers:delete': ['ADMIN', 'MANAGER'],
  'categories:read': ALL,
  'categories:write': ['ADMIN', 'MANAGER'],
  'products:read': ALL,
  'products:write': ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  'sales:read': ALL,
  'sales:write': ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  'payments:write': ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  'payments:confirm': ['ADMIN', 'ACCOUNTANT'],
  'expenses:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'expenses:write': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'expenses:void': ['ADMIN', 'MANAGER'],
  'suppliers:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'suppliers:write': ['ADMIN', 'MANAGER'],
  'purchases:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'purchases:write': ['ADMIN', 'MANAGER'],
  'purchases:receive': ['ADMIN', 'MANAGER'],
  'ledger:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'payables:write': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'analytics:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'reports:read': ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
  'users:manage': ['ADMIN'],
  'audit:read': ['ADMIN'],
  'documents:read': ALL,
  'documents:write': ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'],
  'documents:review': ['ADMIN', 'ACCOUNTANT'],
  'documents:delete': ['ADMIN', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: string, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly string[]).includes(role);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
}
