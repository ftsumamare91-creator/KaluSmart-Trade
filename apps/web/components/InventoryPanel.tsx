
"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { api, etb, newIdempotencyKey } from "../lib/api";
import { canWriteOps } from "../lib/nav-access";

type Product = {
  id: string;
  sku: string;
  name: string;
  unitPrice: string | number;
  quantity: number;
  reorderLevel: number;
};

type ProductDraft = {
  sku: string;
  name: string;
  unitPrice: string;
  reorderLevel: string;
};

type Message = {
  kind: "ok" | "err";
  text: string;
} | null;

const EMPTY_DRAFT: ProductDraft = {
  sku: "",
  name: "",
  unitPrice: "",
  reorderLevel: "5",
};

const MAX_STOCK = 10_000_000;

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function validPrice(value: string): boolean {
  if (value.trim() === "") return false;

  const price = Number(value);

  return (
    Number.isFinite(price) &&
    price >= 0 &&
    Math.round(price * 100) === price * 100
  );
}

function validWholeNumber(
  value: string,
  minimum = 0,
  maximum = MAX_STOCK,
): boolean {
  if (value.trim() === "") return false;

  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number >= minimum &&
    number <= maximum
  );
}

export default function InventoryPanel({
  role,
}: {
  role?: string;
}) {
  const [items, setItems] = useState<Product[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);

  const write = canWriteOps(role);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const result = await api<Product[]>("/products?take=100");

      if (!Array.isArray(result)) {
        throw new Error("The products API returned an invalid response.");
      }

      setItems(result);
      return true;
    } catch (error) {
      setMessage({
        kind: "err",
        text: `Could not load products: ${errorText(error)}`,
      });

      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(
    field: keyof ProductDraft,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function beginEdit(product: Product) {
    setEditingId(product.id);

    setDraft({
      sku: product.sku,
      name: product.name,
      unitPrice: String(product.unitPrice),
      reorderLevel: String(product.reorderLevel),
    });

    setMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setMessage(null);
  }

  function validateDraft(): string | null {
    const sku = draft.sku.trim();
    const name = draft.name.trim();

    if (!sku || sku.length > 40) {
      return "SKU must contain 1–40 characters.";
    }

    if (name.length < 2 || name.length > 120) {
      return "Product name must contain 2–120 characters.";
    }

    if (!validPrice(draft.unitPrice)) {
      return "Enter a valid price with at most 2 decimal places.";
    }

    if (!validWholeNumber(draft.reorderLevel)) {
      return "Reorder level must be a whole number between 0 and 10,000,000.";
    }

    return null;
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!write || !editingId || saving) return;

    const validationError = validateDraft();

    if (validationError) {
      setMessage({ kind: "err", text: validationError });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await api(`/products/${editingId}`, {
        method: "PATCH",
        body: {
          sku: draft.sku.trim(),
          name: draft.name.trim(),
          unitPrice: Number(draft.unitPrice),
          reorderLevel: Number(draft.reorderLevel),
        },
      });

      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      setMessage({
        kind: "ok",
        text: "Product updated successfully.",
      });

      await load();
    } catch (error) {
      setMessage({
        kind: "err",
        text: `Could not update product: ${errorText(error)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!write || saving) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const sku = String(formData.get("sku") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const priceText = String(formData.get("unitPrice") ?? "");
    const quantityText = String(formData.get("quantity") ?? "0");
    const reorderText = String(formData.get("reorderLevel") ?? "5");

    if (!sku || sku.length > 40) {
      setMessage({
        kind: "err",
        text: "SKU must contain 1–40 characters.",
      });
      return;
    }

    if (name.length < 2 || name.length > 120) {
      setMessage({
        kind: "err",
        text: "Product name must contain 2–120 characters.",
      });
      return;
    }

    if (!validPrice(priceText)) {
      setMessage({
        kind: "err",
        text: "Enter a valid price with at most 2 decimal places.",
      });
      return;
    }

    if (!validWholeNumber(quantityText)) {
      setMessage({
        kind: "err",
        text: "Opening stock must be a whole number between 0 and 10,000,000.",
      });
      return;
    }

    if (!validWholeNumber(reorderText)) {
      setMessage({
        kind: "err",
        text: "Reorder level must be a whole number between 0 and 10,000,000.",
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await api("/products", {
        body: {
          sku,
          name,
          unitPrice: Number(priceText),
          quantity: Number(quantityText),
          reorderLevel: Number(reorderText),
        },
      });

      form.reset();

      setMessage({
        kind: "ok",
        text: "Product saved successfully.",
      });

      await load();
    } catch (error) {
      setMessage({
        kind: "err",
        text: `Could not save product: ${errorText(error)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function adjustStock(id: string, delta: number) {
    if (!write || saving || editingId !== null) return;

    setSaving(true);
    setMessage(null);

    try {
      await api(`/products/${id}/adjust`, {
        body: {
          delta,
          reason: "manual",
        },
      });

      setMessage({
        kind: "ok",
        text: "Stock updated successfully.",
      });

      await load();
    } catch (error) {
      setMessage({
        kind: "err",
        text: `Could not update stock: ${errorText(error)}`,
      });

      // Reload because the server may have completed the
      // adjustment even if the response failed.
      await load();
    } finally {
      setSaving(false);
    }
  }

  const [saleLines, setSaleLines] = useState<{ key: number; productId: string; qty: string }[]>([{ key: 1, productId: "", qty: "1" }]);
  const [nextLineKey, setNextLineKey] = useState(2);
  const [saleCustomer, setSaleCustomer] = useState("");
  // One key per sale attempt: a retry after a network error sends the same key, so the sale is not recorded twice.
  const [saleAttemptKey, setSaleAttemptKey] = useState<string | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);

  async function recordSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!write || saving) return;

    const merged = new Map<string, number>();
    for (const line of saleLines) {
      if (!line.productId) {
        setMessage({ kind: "err", text: "Choose a product on every line." });
        return;
      }
      if (!validWholeNumber(line.qty, 1, 100_000)) {
        setMessage({ kind: "err", text: "Every quantity must be a positive whole number." });
        return;
      }
      merged.set(line.productId, (merged.get(line.productId) ?? 0) + Number(line.qty));
    }

    if (merged.size === 0) {
      setMessage({ kind: "err", text: "Please add a product." });
      return;
    }

    const customerName = saleCustomer.trim();
    if (customerName.length > 120) {
      setMessage({ kind: "err", text: "Customer name must not exceed 120 characters." });
      return;
    }

    for (const [productId, quantity] of merged) {
      const product = items.find((item) => item.id === productId);
      if (!product) {
        setMessage({ kind: "err", text: "Product not found. Refresh and try again." });
        return;
      }
      if (product.quantity < quantity) {
        setMessage({ kind: "err", text: `Insufficient stock for ${product.name}. Only ${product.quantity} units are available.` });
        return;
      }
    }

    const key = saleAttemptKey ?? newIdempotencyKey();
    setSaleAttemptKey(key);
    setSaving(true);
    setMessage(null);

    try {
      const sale = await api<{ id?: string; reference?: string; total?: string | number }>("/sales", {
        headers: { "Idempotency-Key": key },
        body: {
          customerName: customerName || undefined,
          items: [...merged].map(([productId, quantity]) => ({ productId, quantity })),
        },
      });

      setSaleAttemptKey(null);
      setLastSaleId(sale.id ?? null);
      setSaleLines([{ key: nextLineKey, productId: "", qty: "1" }]);
      setNextLineKey((k) => k + 1);
      setSaleCustomer("");

      setMessage({
        kind: "ok",
        text: `Sale ${sale.reference ?? "recorded"} · ${etb(sale.total)}`,
      });

      await load();
    } catch (error) {
      setMessage({
        kind: "err",
        text: `Could not record sale: ${errorText(error)}. Press Record sale again to retry safely.`,
      });

      // The API may have committed the sale before a network error. Refresh stock before another attempt.
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {message && (
        <p
          role="status"
          aria-live="polite"
          className={
            message.kind === "ok" ? "ok-msg" : "error-msg"
          }
        >
          {message.text}
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Stock</h2>
            <p>ክምችት · Low-stock items are highlighted</p>
          </div>

          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            {loading ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>

        {loading && items.length === 0 ? (
          <p role="status">Loading products...</p>
        ) : items.length === 0 ? (
          <p className="demo-note">
            No products yet. Add your first product below.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                  {write && <th>Actions</th>}
                </tr>
              </thead>

              <tbody>
                {items.map((product) => (
                  <tr key={product.id}>
                    {editingId === product.id ? (
                      <td colSpan={write ? 5 : 4}>
                        <form onSubmit={saveEdit}>
                          <div className="grid-two">
                            <div className="form-row">
                              <label htmlFor={`sku-${product.id}`}>
                                SKU
                              </label>
                              <input
                                id={`sku-${product.id}`}
                                className="form-input"
                                value={draft.sku}
                                onChange={(event) =>
                                  updateDraft("sku", event.target.value)
                                }
                                maxLength={40}
                                required
                              />
                            </div>

                            <div className="form-row">
                              <label htmlFor={`name-${product.id}`}>
                                Product name
                              </label>
                              <input
                                id={`name-${product.id}`}
                                className="form-input"
                                value={draft.name}
                                onChange={(event) =>
                                  updateDraft("name", event.target.value)
                                }
                                minLength={2}
                                maxLength={120}
                                required
                              />
                            </div>

                            <div className="form-row">
                              <label htmlFor={`price-${product.id}`}>
                                Unit price (ETB)
                              </label>
                              <input
                                id={`price-${product.id}`}
                                className="form-input"
                                type="number"
                                value={draft.unitPrice}
                                onChange={(event) =>
                                  updateDraft(
                                    "unitPrice",
                                    event.target.value,
                                  )
                                }
                                min="0"
                                step="0.01"
                                required
                              />
                            </div>

                            <div className="form-row">
                              <label htmlFor={`reorder-${product.id}`}>
                                Reorder level
                              </label>
                              <input
                                id={`reorder-${product.id}`}
                                className="form-input"
                                type="number"
                                value={draft.reorderLevel}
                                onChange={(event) =>
                                  updateDraft(
                                    "reorderLevel",
                                    event.target.value,
                                  )
                                }
                                min="0"
                                max={MAX_STOCK}
                                step="1"
                                required
                              />
                            </div>
                          </div>

                          <button
                            className="button primary"
                            type="submit"
                            disabled={saving}
                          >
                            {saving ? "Saving..." : "Save changes"}
                          </button>{" "}

                          <button
                            className="button secondary"
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </form>
                      </td>
                    ) : (
                      <>
                        <td>{product.sku}</td>
                        <td>{product.name}</td>
                        <td>{etb(product.unitPrice)}</td>
                        <td>
                          <b
                            style={{
                              color:
                                product.quantity <= product.reorderLevel
                                  ? "#dc2626"
                                  : undefined,
                            }}
                          >
                            {product.quantity}
                          </b>{" "}
                          <small>/ {product.reorderLevel}</small>
                        </td>

                        {write && (
                          <td
                            style={{
                              textAlign: "right",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => beginEdit(product)}
                              disabled={saving || editingId !== null}
                              aria-label={`Edit ${product.name}`}
                            >
                              Edit
                            </button>{" "}

                            <button
                              type="button"
                              className="button secondary"
                              onClick={() =>
                                void adjustStock(product.id, 1)
                              }
                              disabled={saving || editingId !== null}
                              aria-label={`Increase stock for ${product.name}`}
                            >
                              +1
                            </button>{" "}

                            <button
                              type="button"
                              className="button secondary"
                              onClick={() =>
                                void adjustStock(product.id, -1)
                              }
                              disabled={
                                saving ||
                                editingId !== null ||
                                product.quantity <= 0
                              }
                              aria-label={`Decrease stock for ${product.name}`}
                            >
                              −1
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {write && (
        <div className="grid-two" style={{ marginTop: 16 }}>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Add product</h2>
                <p>አዲስ ምርት</p>
              </div>
            </div>

            <form onSubmit={addProduct} style={{ marginTop: 14 }}>
              <div className="form-row">
                <label htmlFor="new-sku">SKU</label>
                <input
                  id="new-sku"
                  className="form-input"
                  name="sku"
                  maxLength={40}
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="new-name">Name · ስም</label>
                <input
                  id="new-name"
                  className="form-input"
                  name="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="new-price">Unit price (ETB)</label>
                <input
                  id="new-price"
                  className="form-input"
                  name="unitPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="new-quantity">Opening stock</label>
                <input
                  id="new-quantity"
                  className="form-input"
                  name="quantity"
                  type="number"
                  min="0"
                  max={MAX_STOCK}
                  step="1"
                  defaultValue="0"
                  required
                />
              </div>

              <div className="form-row">
                <label htmlFor="new-reorder">Reorder level</label>
                <input
                  id="new-reorder"
                  className="form-input"
                  name="reorderLevel"
                  type="number"
                  min="0"
                  max={MAX_STOCK}
                  step="1"
                  defaultValue="5"
                  required
                />
              </div>

              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save product"}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Record a sale</h2>
                <p>ሽያጭ ይመዝግቡ</p>
              </div>
            </div>

            <form onSubmit={recordSale} style={{ marginTop: 14 }}>
              {saleLines.map((line, index) => (
                <div key={line.key} className="form-row" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <label htmlFor={`sale-product-${line.key}`}>Product</label>
                    <select
                      id={`sale-product-${line.key}`}
                      className="form-input"
                      value={line.productId}
                      disabled={saving}
                      onChange={(e) =>
                        setSaleLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, productId: e.target.value } : l)))
                      }
                    >
                      <option value="">Choose a product...</option>
                      {items.map((product) => (
                        <option key={product.id} value={product.id} disabled={product.quantity <= 0}>
                          {product.name} ({product.quantity} left)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <label htmlFor={`sale-qty-${line.key}`}>Quantity</label>
                    <input
                      id={`sale-qty-${line.key}`}
                      className="form-input"
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      value={line.qty}
                      disabled={saving}
                      onChange={(e) =>
                        setSaleLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, qty: e.target.value } : l)))
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={saving || saleLines.length === 1}
                    onClick={() => setSaleLines((lines) => lines.filter((l) => l.key !== line.key))}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="button secondary"
                disabled={saving || saleLines.length >= 100}
                onClick={() => {
                  setSaleLines((lines) => [...lines, { key: nextLineKey, productId: "", qty: "1" }]);
                  setNextLineKey((k) => k + 1);
                }}
                style={{ marginBottom: 12 }}
              >
                + Add product
              </button>

              <div className="form-row">
                <label htmlFor="sale-customer">Customer (optional)</label>
                <input
                  id="sale-customer"
                  className="form-input"
                  maxLength={120}
                  value={saleCustomer}
                  disabled={saving}
                  onChange={(e) => setSaleCustomer(e.target.value)}
                />
              </div>

              {lastSaleId && (
                <p className="demo-note">
                  <a href={`/receipts/${lastSaleId}`} target="_blank" rel="noopener noreferrer">View receipt · ደረሰኝ ይመልከቱ</a>
                </p>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={saving || items.length === 0 || items.every((product) => product.quantity <= 0)}
              >
                {saving ? "Processing..." : "Record sale"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
