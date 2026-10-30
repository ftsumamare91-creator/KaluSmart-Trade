/** Mirrors the server permission matrix for navigation. The server still enforces every endpoint. */
const ALL = ["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"];
const ACCESS: Record<string, string[]> = {
  "Overview": ALL,
  "AI Assistant": ALL,
  "Customers / CRM": ALL,
  "Inventory & Sales": ALL,
  "Documents": ALL,
  "Business Intelligence": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "Workflow Automation": ["ADMIN", "MANAGER"],
  "Organizations": ["ADMIN"], // members and roles
  "Security & Audit": ALL, // every user sees their own sessions; the activity log is shown to admins only
  "Settings": ["ADMIN"],
  "Help & Support": ALL,
};
export const canSee = (role: string | undefined, label: string) => !!role && (ACCESS[label] ?? []).includes(role);
export const canWriteOps = (role?: string) => !!role && ["ADMIN", "MANAGER", "EMPLOYEE"].includes(role);
export const canDeleteCustomers = (role?: string) => !!role && ["ADMIN", "MANAGER"].includes(role);
