"use client";
import { useState } from "react";
import { API, ApiError } from "../lib/api";

/**
 * CSV downloads of existing records. Excel opens these files directly.
 * PDF and .xlsx export are not offered: they need a library that has not been approved yet.
 */
const REPORTS = [
  { value: "sales", label: "Sales (confirmed and paid) · ሽያጭ", dated: true },
  { value: "expenses", label: "Expenses · ወጪዎች", dated: true },
  { value: "inventory", label: "Stock levels · የዕቃ ሁኔታ", dated: false },
];

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);

export default function ReportExportPanel() {
  const [type, setType] = useState("sales");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const selected = REPORTS.find((r) => r.value === type)!;

  const download = async () => {
    setNotice(null);
    if (selected.dated && from > to) {
      setNotice({ kind: "err", text: "The start date must not be after the end date." });
      return;
    }
    setBusy(true);
    try {
      const params = selected.dated ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "";
      const res = await fetch(`${API}/reports/export/${encodeURIComponent(type)}${params}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, Array.isArray(data.message) ? data.message.join(", ") : data.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (res.headers.get("content-disposition") ?? "").match(/filename="([^"]+)"/)?.[1] ?? `${type}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ kind: "ok", text: "Download started. Open the file in Excel." });
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="export-title" style={{ marginTop: 16 }}>
      <h2 id="export-title">Export to Excel (CSV) · ወደ Excel ላክ</h2>
      <p className="demo-note">Downloads the records behind this report as a CSV file. Limit: 10,000 rows and 366 days.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Report</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {REPORTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {selected.dated && (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        <button className="button primary" onClick={download} disabled={busy}>
          {busy ? "Preparing…" : "Download CSV"}
        </button>
      </div>
      {notice && <p role={notice.kind === "err" ? "alert" : "status"} style={{ marginTop: 10 }}>{notice.text}</p>}
    </section>
  );
}
