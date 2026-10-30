/**
 * Which Ask TIBEB AI topics each role may ask about. This only decides what the panel describes.
 * The API checks each tool's permission on every request, so a wrong entry here cannot expose data.
 * Keep this list in step with TOOL_SPECS in apps/api/src/assistant/assistant-tools.ts.
 */
const FINANCE_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT'];
const ALL_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'];

export const ASSISTANT_TOPICS: { key: string; label: string; roles: string[] }[] = [
  { key: 'sales_summary', label: 'Sales', roles: ALL_ROLES },
  { key: 'low_stock', label: 'Low stock', roles: ALL_ROLES },
  { key: 'top_products', label: 'Best-selling products', roles: FINANCE_ROLES },
  { key: 'collections', label: 'Payment collections', roles: FINANCE_ROLES },
  { key: 'expenses', label: 'Expenses', roles: FINANCE_ROLES },
  { key: 'receivables', label: 'Customer balances', roles: FINANCE_ROLES },
  { key: 'payables', label: 'Supplier balances', roles: FINANCE_ROLES },
  { key: 'profit_loss', label: 'Profit & Loss', roles: FINANCE_ROLES },
];

/** Topic labels the signed-in role may ask about. Empty until the role is known. */
export function assistantTopics(role?: string | null): string[] {
  if (!role) return [];
  return ASSISTANT_TOPICS.filter((t) => t.roles.includes(role)).map((t) => t.label);
}
