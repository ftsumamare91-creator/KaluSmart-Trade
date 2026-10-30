import type { Lang } from "./i18n";

export type Category = {
  id: string;
  parentId: string | null;
  slug: string;
  nameAm: string;
  nameEn: string | null;
  nameOm?: string | null;
  nameTi?: string | null;
  isActive: boolean;
  sortOrder: number;
  children?: Category[];
};

export type CategoryNames = {
  nameAm: string;
  nameEn?: string | null;
  nameOm?: string | null;
  nameTi?: string | null;
};

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  unitPrice: string | number;
  quantity: number;
  reorderLevel: number;
  categoryId: string | null;
  imageUrl?: string | null;
  model3dUrl?: string | null;
  manufacturer?: string | null;
  manufacturerAddress?: string | null;
  qualityGrade?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  category?: (CategoryNames & { id: string; slug: string }) | null;
};

/** Mirrors the server: ADMIN and MANAGER manage categories. */
export const canWriteCatalog = (role?: string) => !!role && ["ADMIN", "MANAGER"].includes(role);

/**
 * The name in the chosen language. If that language has no name yet, fall back to English, then Amharic.
 * Product names are single-language for now, so they are not covered here.
 */
export const catName = (c: CategoryNames, lang: Lang): string => {
  const own =
    lang === "am" ? c.nameAm :
    lang === "om" ? c.nameOm :
    lang === "ti" ? c.nameTi :
    c.nameEn;
  return own || c.nameEn || c.nameAm;
};

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function findCategory(tree: Category[], id: string): Category | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const hit = node.children ? findCategory(node.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** The category and every category below it. */
export function collectIds(node: Category, into = new Set<string>()): Set<string> {
  into.add(node.id);
  (node.children ?? []).forEach((c) => collectIds(c, into));
  return into;
}

export type PickerOption = { id: string; label: string; leaf: boolean };

/**
 * Flattens the active tree into picker options with full breadcrumb labels.
 * Only leaves (categories with no active children) are meant to be selectable for products.
 */
export function flattenForPicker(tree: Category[], lang: Lang): PickerOption[] {
  const out: PickerOption[] = [];
  const walk = (nodes: Category[], trail: string[]) => {
    for (const n of nodes) {
      if (!n.isActive) continue;
      const path = [...trail, catName(n, lang)];
      const kids = (n.children ?? []).filter((c) => c.isActive);
      out.push({ id: n.id, label: path.join(" › "), leaf: kids.length === 0 });
      walk(kids, path);
    }
  };
  walk(tree, []);
  return out;
}

export type Msg = { kind: "ok" | "err"; text: string } | null;
