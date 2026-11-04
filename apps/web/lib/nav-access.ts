/** Mirrors the server permission matrix for navigation. The server still enforces every endpoint. */
const ALL = ["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"];

const ACCESS: Record<string, string[]> = {
  "Overview": ALL,
  "AI Assistant": ALL,
  "Customers / CRM": ALL,
  "Customers/ CRM": ALL,
  "Inventory & Sales": ALL,
  "Documents": ALL,
  "Business Intelligence": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "Workflow Automation": ["ADMIN", "MANAGER"],
  "Organizations": ["ADMIN"],
  "Security & Audit": ALL,
  "Settings": ["ADMIN"],
  "Help & Support": ALL,
};

export const canSee = (role: string | undefined, label: string) => {
  const allowed = ACCESS[label] ?? [];

  // While /auth/me is loading, show only navigation shared by every role.
  if (!role) {
    return ALL.every((r) => allowed.includes(r));
  }

  return allowed.includes(role);
};

export const canWriteOps = (role?: string) =>
  !!role && ["ADMIN", "MANAGER", "EMPLOYEE"].includes(role);

export const canDeleteCustomers = (role?: string) =>
  !!role && ["ADMIN", "MANAGER"].includes(role);
