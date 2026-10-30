export type TreeNode<T> = T & { children: TreeNode<T>[] };

/**
 * Turns a flat list of categories into a nested tree.
 * Disabled categories (and everything under them) are hidden unless includeInactive is true.
 */
export function buildCategoryTree<T extends { id: string; parentId: string | null; isActive: boolean }>(
  rows: T[],
  includeInactive = false,
): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] as TreeNode<T>[] });

  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  if (includeInactive) return roots;

  const prune = (list: TreeNode<T>[]): TreeNode<T>[] =>
    list.filter((n) => n.isActive).map((n) => ({ ...n, children: prune(n.children) }));
  return prune(roots);
}
