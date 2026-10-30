"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError, API } from "../lib/api";

type Fields = {
  supplierName: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  currency: string | null;
  subtotal: string | null;
  tax: string | null;
  discount: string | null;
  total: string | null;
  paymentReference: string | null;
  items: { description: string | null; quantity: string | null; unitPrice: string | null; lineTotal: string | null }[];
};

type Doc = {
  id: string;
  title: string;
  mimeType: string;
  category: string;
  status: "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED" | "REVIEW_REQUIRED";
  sizeBytes: number | null;
  extractedFields: Fields | null;
  processingError: string | null;
  reviewDecision: string | null;
  createdAt: string;
};

type ListResponse = { items: Doc[]; total: number; page: number; pageSize: number };

const CATEGORIES = ["RECEIPT", "INVOICE", "CONTRACT", "OTHER"];
const STATUSES = ["UPLOADED", "PROCESSING", "REVIEW_REQUIRED", "COMPLETED", "FAILED"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt,.md";
const MAX_MB = 10;
const PAGE_SIZE = 20;

// Mirrors the server rules in common/permissions.ts. The server still enforces every endpoint.
const ROLE_CAN_REVIEW = ["ADMIN", "ACCOUNTANT"];
const ROLE_CAN_ARCHIVE = ["ADMIN", "MANAGER"];

const STATUS_TEXT: Record<Doc["status"], string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing…",
  REVIEW_REQUIRED: "Needs review (unverified)",
  COMPLETED: "Confirmed by reviewer",
  FAILED: "Failed",
};

const emptyFields: Fields = {
  supplierName: null, documentNumber: null, documentDate: null, currency: null,
  subtotal: null, tax: null, discount: null, total: null, paymentReference: null, items: [],
};

const fmtSize = (n: number | null) => (n === null ? "—" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function DocumentsPanel({ role }: { role?: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("RECEIPT");
  const [reviewing, setReviewing] = useState<Doc | null>(null);
  const [draft, setDraft] = useState<Fields>(emptyFields);

  const canReview = !!role && ROLE_CAN_REVIEW.includes(role);
  const canArchive = !!role && ROLE_CAN_ARCHIVE.includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), take: String(PAGE_SIZE) });
      if (q.trim()) params.set("q", q.trim().slice(0, 100));
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      const data = await api<ListResponse>(`/documents?${params.toString()}`);
      setDocs(data.items);
      setTotal(data.total);
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [page, q, category, status]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) { setNotice({ kind: "err", text: "Choose a file first." }); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setNotice({ kind: "err", text: `File is larger than ${MAX_MB} MB.` }); return; }
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", uploadCategory);
      const res = await fetch(`${API}/documents`, { method: "POST", credentials: "include", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setNotice({ kind: "err", text: "This file was already uploaded. It is in the list below." });
      } else if (!res.ok) {
        setNotice({ kind: "err", text: Array.isArray(data.message) ? data.message.join(", ") : data.message || `HTTP ${res.status}` });
      } else {
        setNotice({ kind: "ok", text: `Uploaded “${data.title}”. Run “Extract” to read its fields.` });
        input.value = "";
        setPage(1);
        await load();
      }
    } catch {
      setNotice({ kind: "err", text: "Upload failed. Check the connection and try again." });
    } finally {
      setUploading(false);
    }
  };

  const download = async (doc: Doc) => {
    try {
      const res = await fetch(`${API}/documents/${doc.id}/download`, { credentials: "include" });
      if (!res.ok) throw new ApiError(res.status, `Download failed (HTTP ${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    }
  };

  const analyze = async (doc: Doc) => {
    setBusyId(doc.id);
    setNotice(null);
    try {
      const updated = await api<Doc>(`/documents/${doc.id}/analyze`, { method: "POST" });
      if (updated.status === "FAILED") {
        setNotice({ kind: "err", text: updated.processingError || "Extraction failed." });
      } else {
        setNotice({ kind: "ok", text: "Fields extracted. They are unverified until a reviewer confirms them." });
      }
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const openReview = (doc: Doc) => {
    setReviewing(doc);
    setDraft({ ...emptyFields, ...(doc.extractedFields ?? {}), items: doc.extractedFields?.items ?? [] });
  };

  const decide = async (decision: "CONFIRM" | "REJECT") => {
    if (!reviewing) return;
    setBusyId(reviewing.id);
    try {
      await api(`/documents/${reviewing.id}/review`, { method: "POST", body: { decision, fields: draft } });
      setNotice({
        kind: "ok",
        text: decision === "CONFIRM"
          ? "Reviewed and confirmed. This does not create a sale, expense or purchase; record those in their own workflow."
          : "Extraction rejected.",
      });
      setReviewing(null);
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const archive = async (doc: Doc) => {
    if (!window.confirm(`Archive “${doc.title}”? The file is kept for audit and can be found again by an administrator.`)) return;
    setBusyId(doc.id);
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      setNotice({ kind: "ok", text: "Archived." });
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const setItem = (i: number, key: keyof Fields["items"][number], value: string) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, [key]: value || null } : it)) }));
  const setField = (key: keyof Omit<Fields, "items">, value: string) =>
    setDraft((d) => ({ ...d, [key]: value || null }));

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Content search: looks inside extracted fields as well as titles. Results are unverified extracted values.
  const [contentQ, setContentQ] = useState("");
  const [contentHits, setContentHits] = useState<{ id: string; title: string; matchedIn: string[]; snippet: string | null }[] | null>(null);
  const [contentNote, setContentNote] = useState("");
  const searchContent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContentNote("");
    try {
      const data = await api<{ results: any[]; truncated: boolean }>(`/documents/search?q=${encodeURIComponent(contentQ)}`);
      setContentHits(data.results);
      setContentNote(data.truncated ? "Only the 500 newest documents were searched." : "");
    } catch (err) {
      setContentHits(null);
      setNotice({ kind: "err", text: (err as Error).message });
    }
  };

  return (
    <section className="panel" aria-labelledby="documents-title">
      <div className="panel-head">
        <div>
          <h2 id="documents-title">Documents</h2>
          <small>Receipts, invoices and contracts. Extracted values are unverified until a reviewer confirms them.</small>
        </div>
      </div>

      <form onSubmit={upload} className="doc-upload" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <input type="file" name="file" accept={ACCEPT} aria-label="Document file" />
        <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} aria-label="Document category">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="button primary" type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</button>
        <small style={{ alignSelf: "center" }}>PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV, TXT, MD · up to {MAX_MB} MB</small>
      </form>

      <form onSubmit={searchContent} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={contentQ} onChange={(e) => setContentQ(e.target.value)} placeholder="Search inside documents (supplier, number, item)" aria-label="Search inside documents" />
        <button className="button secondary" type="submit" disabled={contentQ.trim().length < 2}>Search contents</button>
        {contentHits !== null && <button className="button secondary" type="button" onClick={() => { setContentHits(null); setContentQ(""); }}>Clear</button>}
      </form>
      {contentHits !== null && (
        <div className="panel" style={{ marginBottom: 12 }} aria-live="polite">
          <strong>{contentHits.length} result(s)</strong>{contentNote && <small> · {contentNote}</small>}
          {contentHits.length === 0 ? <p>No document contains this text.</p> : (
            <ul>
              {contentHits.map((h) => (
                <li key={h.id}>
                  <b>{h.title}</b> — matched in {h.matchedIn.join(", ")}{h.snippet ? <> · <i>{h.snippet}</i></> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search by name"
          aria-label="Search documents"
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Filter by category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s as Doc["status"]]}</option>)}
        </select>
      </div>

      {notice && <p role={notice.kind === "err" ? "alert" : "status"} className={notice.kind === "err" ? "demo-note" : ""}>{notice.text}</p>}

      {loading ? <p>Loading…</p> : docs.length === 0 ? (
        <p>No documents yet. Upload a receipt or invoice to start.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Category</th><th>Status</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.title}</td>
                  <td>{doc.category}</td>
                  <td>{STATUS_TEXT[doc.status]}{doc.processingError ? ` — ${doc.processingError}` : ""}</td>
                  <td>{fmtSize(doc.sizeBytes)}</td>
                  <td>{new Date(doc.createdAt).toLocaleDateString()}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="button secondary" onClick={() => download(doc)} disabled={busyId === doc.id}>Download</button>
                    {(doc.status === "UPLOADED" || doc.status === "FAILED") && (
                      <button className="button secondary" onClick={() => analyze(doc)} disabled={busyId === doc.id}>Extract</button>
                    )}
                    {doc.status === "REVIEW_REQUIRED" && canReview && (
                      <button className="button primary" onClick={() => openReview(doc)}>Review</button>
                    )}
                    {doc.status === "REVIEW_REQUIRED" && !canReview && <small>Waiting for an accountant</small>}
                    {canArchive && doc.status !== "PROCESSING" && (
                      <button className="button secondary" onClick={() => archive(doc)} disabled={busyId === doc.id}>Archive</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button className="button secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</button>
        <small>Page {page} of {pages} · {total} documents</small>
        <button className="button secondary" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>Next</button>
      </div>

      {reviewing && (
        <div role="dialog" aria-modal="true" aria-label="Review extracted fields" className="panel" style={{ marginTop: 16 }}>
          <h3>Review: {reviewing.title}</h3>
          <p className="demo-note">These values were read by AI and are unverified. Check them against the document, correct them, then confirm. Confirming does not create any sale, expense or purchase.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {([
              ["supplierName", "Supplier / merchant"],
              ["documentNumber", "Document number"],
              ["documentDate", "Date (YYYY-MM-DD)"],
              ["currency", "Currency (e.g. ETB)"],
              ["subtotal", "Subtotal"],
              ["tax", "Tax"],
              ["discount", "Discount"],
              ["total", "Total"],
              ["paymentReference", "Payment reference"],
            ] as [keyof Omit<Fields, "items">, string][]).map(([key, label]) => (
              <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>{label}</span>
                <input value={(draft[key] as string) ?? ""} onChange={(e) => setField(key, e.target.value)} />
              </label>
            ))}
          </div>

          <h4 style={{ marginTop: 12 }}>Items</h4>
          {draft.items.length === 0 && <p>No line items were found. Add none, or correct the totals above.</p>}
          {draft.items.map((it, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
              <input aria-label={`Item ${i + 1} description`} value={it.description ?? ""} onChange={(e) => setItem(i, "description", e.target.value)} />
              <input aria-label={`Item ${i + 1} quantity`} value={it.quantity ?? ""} onChange={(e) => setItem(i, "quantity", e.target.value)} />
              <input aria-label={`Item ${i + 1} unit price`} value={it.unitPrice ?? ""} onChange={(e) => setItem(i, "unitPrice", e.target.value)} />
              <input aria-label={`Item ${i + 1} line total`} value={it.lineTotal ?? ""} onChange={(e) => setItem(i, "lineTotal", e.target.value)} />
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="button primary" onClick={() => decide("CONFIRM")} disabled={busyId === reviewing.id}>Confirm extraction</button>
            <button className="button secondary" onClick={() => decide("REJECT")} disabled={busyId === reviewing.id}>Reject</button>
            <button className="button secondary" onClick={() => setReviewing(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
