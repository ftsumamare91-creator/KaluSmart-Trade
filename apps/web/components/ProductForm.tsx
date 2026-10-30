"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError, deleteMedia, isUploaded, mediaSrc, uploadMedia } from "../lib/api";
import { Category, CatalogProduct, flattenForPicker } from "../lib/categories";
import type { Lang } from "../lib/i18n";
import { CT } from "../lib/catalog-i18n";

type Props = {
  lang: Lang;
  tree: Category[];
  product?: CatalogProduct;
  initialCategoryId?: string | null;
  onSaved: (product: CatalogProduct, created: boolean) => void;
  onCancel: () => void;
};

type Draft = Record<
  | "sku" | "name" | "description" | "unitPrice" | "quantity" | "reorderLevel" | "categoryId"
  | "imageUrl" | "model3dUrl" | "manufacturer" | "manufacturerAddress" | "qualityGrade"
  | "productionDate" | "expiryDate",
  string
>;

type MediaKind = "image" | "model3d";

// Must match the API limits in apps/api/src/uploads/media.ts
const MEDIA: Record<MediaKind, { field: "imageUrl" | "model3dUrl"; accept: string; max: number }> = {
  image: { field: "imageUrl", accept: "image/jpeg,image/png,image/webp", max: 5 * 1024 * 1024 },
  model3d: { field: "model3dUrl", accept: ".glb,model/gltf-binary", max: 50 * 1024 * 1024 },
};

const isoDay = (v?: string | null) => (v ? v.slice(0, 10) : "");
const WHOLE = /^\d+$/;

function initialDraft(p?: CatalogProduct, categoryId?: string | null): Draft {
  return {
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    unitPrice: p ? String(p.unitPrice) : "",
    quantity: "",
    reorderLevel: p ? String(p.reorderLevel) : "5",
    categoryId: p?.categoryId ?? categoryId ?? "",
    imageUrl: p?.imageUrl ?? "",
    model3dUrl: p?.model3dUrl ?? "",
    manufacturer: p?.manufacturer ?? "",
    manufacturerAddress: p?.manufacturerAddress ?? "",
    qualityGrade: p?.qualityGrade ?? "",
    productionDate: isoDay(p?.productionDate),
    expiryDate: isoDay(p?.expiryDate),
  };
}

const messageOf = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Unexpected error");

export default function ProductForm({ lang, tree, product, initialCategoryId, onSaved, onCancel }: Props) {
  const t = CT[lang];
  const editing = !!product;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(product, initialCategoryId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New products: files are chosen now and uploaded right after the product is created.
  const [pending, setPending] = useState<Partial<Record<MediaKind, File>>>({});
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  // Edit mode: uploads and removals happen immediately, on the saved product.
  const [mediaBusy, setMediaBusy] = useState<MediaKind | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);

  const options = useMemo(() => flattenForPicker(tree, lang), [tree, lang]);
  // Keep a product's current category visible even if it has been disabled since.
  const currentMissing = draft.categoryId && !options.some((o) => o.id === draft.categoryId);

  const set = (field: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  function validate(): string | null {
    if (!draft.sku.trim() || !draft.name.trim() || draft.unitPrice.trim() === "") return t.required;
    const price = Number(draft.unitPrice);
    if (!Number.isFinite(price) || price < 0) return t.invalidPrice;
    if (!WHOLE.test(draft.reorderLevel)) return t.invalidReorder;
    if (!editing && draft.quantity.trim() !== "" && !WHOLE.test(draft.quantity)) return t.invalidQuantity;
    if (!draft.categoryId) return t.categoryNeeded;
    const leaf = options.find((o) => o.id === draft.categoryId)?.leaf;
    if (leaf === false) return t.categoryNeeded;
    if (draft.productionDate && draft.expiryDate && draft.expiryDate <= draft.productionDate) return t.expiryAfter;
    return null;
  }

  function chooseFile(kind: MediaKind, file: File | null) {
    setMediaError(null);
    if (!file) return;
    if (file.size > MEDIA[kind].max) {
      setMediaError(t.fileTooLarge);
      return;
    }
    if (editing) {
      void uploadNow(kind, file);
      return;
    }
    setPending((p) => ({ ...p, [kind]: file }));
    if (kind === "image") setPendingPreview(URL.createObjectURL(file));
  }

  async function uploadNow(kind: MediaKind, file: File) {
    setMediaBusy(kind);
    try {
      const saved = await uploadMedia<CatalogProduct>(product!.id, kind, file);
      setDraft((d) => ({ ...d, [MEDIA[kind].field]: saved[MEDIA[kind].field] ?? "" }));
    } catch (e) {
      setMediaError(messageOf(e));
    } finally {
      setMediaBusy(null);
    }
  }

  async function removeNow(kind: MediaKind) {
    setMediaError(null);
    if (!editing) {
      setPending((p) => ({ ...p, [kind]: undefined }));
      if (kind === "image") setPendingPreview(null);
      return;
    }
    setMediaBusy(kind);
    try {
      await deleteMedia(product!.id, kind);
      setDraft((d) => ({ ...d, [MEDIA[kind].field]: "" }));
    } catch (e) {
      setMediaError(messageOf(e));
    } finally {
      setMediaBusy(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);

    // Empty text means "not provided" on create, and "clear it" on edit.
    const text = (v: string) => (v.trim() === "" ? (editing ? null : undefined) : v.trim());
    const day = (v: string) => (v === "" ? (editing ? null : undefined) : v);
    // Uploaded files are already stored on the server; leave them alone here.
    const link = (v: string) => (isUploaded(v) ? undefined : text(v));

    const body: Record<string, unknown> = {
      sku: draft.sku.trim(),
      name: draft.name.trim(),
      unitPrice: Number(draft.unitPrice),
      reorderLevel: Number(draft.reorderLevel),
      categoryId: draft.categoryId,
      description: text(draft.description),
      imageUrl: link(draft.imageUrl),
      model3dUrl: link(draft.model3dUrl),
      manufacturer: text(draft.manufacturer),
      manufacturerAddress: text(draft.manufacturerAddress),
      qualityGrade: text(draft.qualityGrade),
      productionDate: day(draft.productionDate),
      expiryDate: day(draft.expiryDate),
    };
    if (!editing && draft.quantity.trim() !== "") body.quantity = Number(draft.quantity);

    try {
      let latest = editing
        ? await api<CatalogProduct>(`/products/${product!.id}`, { method: "PATCH", body })
        : await api<CatalogProduct>("/products", { body });

      const failures: string[] = [];
      if (!editing) {
        for (const kind of ["image", "model3d"] as MediaKind[]) {
          const file = pending[kind];
          if (!file) continue;
          try {
            latest = await uploadMedia<CatalogProduct>(latest.id, kind, file);
          } catch (e) {
            failures.push(`${file.name}: ${messageOf(e)}`);
          }
        }
      }
      if (failures.length) window.alert(`${t.mediaFailed}\n${failures.join("\n")}`);
      onSaved(latest, !editing);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  function mediaBlock(kind: MediaKind) {
    const cfg = MEDIA[kind];
    const url = draft[cfg.field];
    const file = pending[kind];
    const uploaded = isUploaded(url);
    const busy = mediaBusy === kind;
    const title = kind === "image" ? t.imageFile : t.modelFile;
    const hint = kind === "image" ? t.imageHint : t.modelHint;
    const preview = kind === "image" ? (file ? pendingPreview : url ? mediaSrc(url) : null) : null;

    return (
      <div key={kind} className="cf-media">
        <strong>{title}</strong>
        <small className="cf-hint">{hint}</small>
        {preview && (
          <img src={preview} alt="" style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 6, marginTop: 6 }} />
        )}
        {kind === "model3d" && uploaded && (
          <a href={mediaSrc(url)} target="_blank" rel="noreferrer">{t.openModel}</a>
        )}
        {file && <small className="cf-hint">{t.willUpload}: {file.name}</small>}
        {uploaded && !file && <small className="cf-hint">{t.uploaded}</small>}

        <div className="cf-actions" style={{ justifyContent: "flex-start" }}>
          <label className="button secondary" style={{ cursor: busy ? "wait" : "pointer" }}>
            {busy ? t.uploading : t.chooseFile}
            <input
              type="file"
              accept={cfg.accept}
              hidden
              disabled={busy}
              onChange={(e) => {
                chooseFile(kind, e.target.files?.[0] ?? null);
                e.target.value = ""; // allow picking the same file again
              }}
            />
          </label>
          {(uploaded || file) && (
            <button type="button" className="button secondary" disabled={busy} onClick={() => void removeNow(kind)}>
              {t.removeFile}
            </button>
          )}
        </div>

        {!uploaded && !file && (
          <label>
            {t.externalLink}
            <input
              type="url"
              value={url}
              onChange={(e) => set(cfg.field)(e.target.value)}
              maxLength={500}
            />
          </label>
        )}
      </div>
    );
  }

  return (
    <form className="cf-form" onSubmit={submit}>
      <div className="cf-head">
        <h3>{editing ? t.editProduct : t.newProduct}</h3>
      </div>

      <div className="cf-grid">
        <label>
          {t.sku}*
          <input value={draft.sku} onChange={(e) => set("sku")(e.target.value)} maxLength={40} required />
        </label>
        <label>
          {t.name}*
          <input value={draft.name} onChange={(e) => set("name")(e.target.value)} maxLength={120} required />
        </label>

        <label className="cf-wide">
          {t.category}*
          <select value={draft.categoryId} onChange={(e) => set("categoryId")(e.target.value)} required>
            <option value="">{t.chooseCategory}</option>
            {currentMissing && <option value={draft.categoryId}>{t.disabled}</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id} disabled={!o.leaf}>
                {o.label}
              </option>
            ))}
          </select>
          <small className="cf-hint">{t.leafHint}</small>
        </label>

        <label>
          {t.unitPrice}*
          <input type="number" min="0" step="0.01" value={draft.unitPrice} onChange={(e) => set("unitPrice")(e.target.value)} required />
        </label>
        <label>
          {t.reorderLevel}
          <input type="number" min="0" step="1" value={draft.reorderLevel} onChange={(e) => set("reorderLevel")(e.target.value)} />
        </label>

        {!editing && (
          <label>
            {t.quantity}
            <input type="number" min="0" step="1" value={draft.quantity} onChange={(e) => set("quantity")(e.target.value)} />
            <small className="cf-hint">{t.quantityHint}</small>
          </label>
        )}

        <label className="cf-wide">
          {t.description}
          <textarea rows={2} value={draft.description} onChange={(e) => set("description")(e.target.value)} maxLength={1000} />
        </label>

        <label>
          {t.manufacturer}
          <input value={draft.manufacturer} onChange={(e) => set("manufacturer")(e.target.value)} maxLength={160} />
        </label>
        <label>
          {t.manufacturerAddress}
          <input value={draft.manufacturerAddress} onChange={(e) => set("manufacturerAddress")(e.target.value)} maxLength={300} />
        </label>
        <label>
          {t.qualityGrade}
          <input value={draft.qualityGrade} onChange={(e) => set("qualityGrade")(e.target.value)} maxLength={60} />
        </label>
        <div />

        <label>
          {t.productionDate}
          <input type="date" value={draft.productionDate} onChange={(e) => set("productionDate")(e.target.value)} />
        </label>
        <label>
          {t.expiryDate}
          <input type="date" value={draft.expiryDate} min={draft.productionDate || undefined} onChange={(e) => set("expiryDate")(e.target.value)} />
        </label>

        {mediaBlock("image")}
        {mediaBlock("model3d")}
      </div>

      {editing && <small className="cf-hint">{t.clearHint}</small>}
      {mediaError && <p className="cf-error" role="alert">{mediaError}</p>}
      {error && <p className="cf-error" role="alert">{error}</p>}

      <div className="cf-actions">
        <button type="submit" className="button primary" disabled={saving || mediaBusy !== null}>
          {saving ? t.saving : t.save}
        </button>
        <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
