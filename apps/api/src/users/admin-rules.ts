/**
 * Decides whether a membership change would leave the organization without an administrator.
 * Pure function so the rule can be tested without a database.
 */
export function wouldLeaveNoAdmin(
  currentRole: string,
  nextRole: string | null, // null means the membership is being removed
  adminCount: number, // administrators in the organization, including this member
): boolean {
  if (currentRole !== 'ADMIN') return false;
  if (nextRole === 'ADMIN') return false;
  return adminCount <= 1;
}
