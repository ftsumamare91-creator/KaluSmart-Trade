"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, etb } from "../lib/api";
import type { Lang } from "../lib/i18n";
import { CT } from "../lib/catalog-i18n";
import {
  CatalogProduct,
  Category,
  Msg,
  canWriteCatalog,
  catName,
  collectIds,
  findCategory,
} from "../lib/categories";
import { canWriteOps } from "../lib/nav-access";
import CategoryTree from "./CategoryTree";
import ProductForm from "./ProductForm";
import InventoryPanel from "./InventoryPanel";

type Tab = "catalog" | "stock";
type Editing = { product?: CatalogProduct } | null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");

export default function CatalogPanel({ role, lang }: { role?: string; lang: Lang }) {
  const t = CT[lang];
  const [tab, setTab] = useState<Tab>("catalog");
  const [tree, setTree] = useState<Category[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [message, setMessage] = useState<Msg>(null);
  const [loading, setLoading] = useState(false);

  const canManageCategories = canWriteCatalog(role);
  const canEditProducts = canWriteOps(role);

  const loadTree = useCallback(async () => {
    try {
      // Managers receive disabled categories too so they can re-enable them.
      const data = await api<Category[]>(`/categories/tree?includeInactive=${canManageCategories ? "true" : "false"}`);
      setTree(data);
    } catch (e) {
      setMessage({ kind: "err", text: `${t.loadError} ${errorText(e)}` });
    }
  }, [canManageCategories, t.loadError]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await api<CatalogProduct[]>("/products?take=100"));
    } catch (e) {
      setMessage({ kind: "err", text: `${t.loadError} ${errorText(e)}` });
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    void loadTree();
    void loadProducts();
  }, [loadTree, loadProducts]);

  // Selecting a category shows its products and those in every subcategory below it.
  const visibleProducts = useMemo(() => {
    if (!selectedId) return products;
    const node = findCategory(tree, selectedId);
    const ids = node ? collectIds(node) : new Set([selectedId]);
    return products.filter((p) => p.categoryId && ids.has(p.categoryId));
  }, [products, tree, selectedId]);

  const categoryLabel = useCallback(
    (p: CatalogProduct) => {
      if (!p.category) return "—";
      return catName(p.category, lang);
    },
    [lang],
  );

  function onSaved(_saved: CatalogProduct, created: boolean) {
    setEditing(null);
    setMessage({ kind: "ok", text: created ? t.productCreated : t.productSaved });
    void loadProducts();
  }

  function onCategoriesChanged() {
    void loadTree();
  }

  const selectedCategory = selectedId ? findCategory(tree, selectedId) : null;

  return (
    <div className="catalog">
      <div className="catalog-tabs">
        <button type="button" className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>
          {t.catalog}
        </button>
        <button type="button" className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>
          {t.stock}
        </button>
      </div>

      {tab === "stock" ? (
        <InventoryPanel role={role} />
      ) : (
        <>
          {message && <p className={message.kind === "ok" ? "cf-ok" : "cf-error"} role="status">{message.text}</p>}

          <div className="catalog-grid">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t.catalog}</h2>
                </div>
              </div>
              <CategoryTree
                lang={lang}
                tree={tree}
                canWrite={canManageCategories}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChanged={onCategoriesChanged}
                onMessage={setMessage}
              />
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{selectedCategory ? catName(selectedCategory, lang) : t.allProducts}</h2>
                  <p>{visibleProducts.length}</p>
                </div>
                {canEditProducts && (
                  <button type="button" className="button primary" onClick={() => setEditing({})}>
                    {t.newProduct}
                  </button>
                )}
              </div>

              {editing && (
                <ProductForm
                  lang={lang}
                  tree={tree}
                  product={editing.product}
                  initialCategoryId={selectedId}
                  onSaved={onSaved}
                  onCancel={() => setEditing(null)}
                />
              )}

              {loading ? null : visibleProducts.length === 0 ? (
                <p className="cat-empty">{t.noProducts}</p>
              ) : (
                <div className="catalog-table-wrap">
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>{t.columns.sku}</th>
                        <th>{t.columns.name}</th>
                        <th>{t.columns.category}</th>
                        <th>{t.columns.price}</th>
                        <th>{t.columns.stock}</th>
                        <th>{t.columns.expiry}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProducts.map((p) => (
                        <tr key={p.id}>
                          <td>{p.sku}</td>
                          <td>{p.name}</td>
                          <td>{categoryLabel(p)}</td>
                          <td>{etb(p.unitPrice)}</td>
                          <td>
                            <b style={{ color: p.quantity <= p.reorderLevel ? "#dc2626" : undefined }}>{p.quantity}</b>{" "}
                            <small>/ {p.reorderLevel}</small>
                          </td>
                          <td>{p.expiryDate ? p.expiryDate.slice(0, 10) : "—"}</td>
                          <td>
                            {canEditProducts && (
                              <button type="button" className="cat-link" onClick={() => setEditing({ product: p })}>
                                {t.edit}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
