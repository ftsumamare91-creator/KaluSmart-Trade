"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, etb } from "../../../lib/api";

type ReceiptLine = { productName: string; sku: string | null; quantity: number; unitPrice: string; lineTotal: string };
type Receipt = {
  id: string;
  reference: string;
  status: string;
  soldAt: string;
  customerName: string | null;
  organizationName: string | null;
  total: string;
  paid: string;
  balanceDue: string;
  items: ReceiptLine[];
};
type Payment = { id: string; method: string; status: string; amount: string; providerReference: string | null; createdAt: string };

const METHODS = [
  { value: "CASH", label: "Cash · በጥሬ ገንዘብ" },
  { value: "BANK_TRANSFER", label: "Bank transfer · ባንክ ዝውውር" },
  { value: "TELEBIRR", label: "Telebirr · ቴሌብር" },
];
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting for check · በመጠባበቅ",
  CONFIRMED: "Confirmed · ተረጋግጧል",
  REJECTED: "Rejected · ውድቅ",
};
// Mirrors the server rules in common/permissions.ts. The server still enforces them; this only hides buttons.
const RECORD_ROLES = ["ADMIN", "MANAGER", "EMPLOYEE"];
const CONFIRM_ROLES = ["ADMIN", "ACCOUNTANT"];
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

export default function ReceiptPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const saleId = encodeURIComponent(params.id);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reload = async () => {
    const [r, list] = await Promise.all([
      api<Receipt>(`/sales/${saleId}`),
      api<Payment[]>(`/sales/${saleId}/payments`),
    ]);
    setReceipt(r);
    setPayments(list);
  };

  useEffect(() => {
    let cancelled = false;
    api<{ role: string }>("/auth/me")
      .then((me) => { if (!cancelled) setRole(me.role); })
      .catch(() => undefined);
    reload()
      .then(() => { if (!cancelled) setState("ready"); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) { router.replace("/login"); return; }
        setError((e as Error).message);
        setState("error");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, router]);

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = amount.trim();
    if (!AMOUNT.test(value) || Number(value) <= 0) {
      setNotice({ kind: "err", text: "Enter an amount greater than zero, with at most two decimals." });
      return;
    }
    if (method !== "CASH" && !reference.trim()) {
      setNotice({ kind: "err", text: "Enter the receipt or transaction reference for this payment method." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api(`/sales/${saleId}/payments`, {
        body: { method, amount: value, providerReference: reference.trim() || undefined },
      });
      setAmount("");
      setReference("");
      setNotice({ kind: "ok", text: "Payment recorded. It counts once an accountant confirms it." });
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function decide(paymentId: string, action: "confirm" | "reject") {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api(`/payments/${encodeURIComponent(paymentId)}/${action}`, { method: "POST" });
      setNotice({ kind: "ok", text: action === "confirm" ? "Payment confirmed." : "Payment rejected." });
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div className="auth-wrap"><p>Loading receipt… · ደረሰኙ በመጫን ላይ ነው</p></div>;
  }
  if (state === "error" || !receipt) {
    return (
      <div className="auth-wrap">
        <p className="error-msg">{error || "Receipt not found."}</p>
        <p><Link href="/">Back · ተመለስ</Link></p>
      </div>
    );
  }

  const canRecord = role !== null && RECORD_ROLES.includes(role);
  const canConfirm = role !== null && CONFIRM_ROLES.includes(role);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
        <Link href="/">Back · ተመለስ</Link>
        <button className="button primary" type="button" onClick={() => window.print()}>
          Print or save as PDF · አትም / PDF
        </button>
      </div>

      <article className="panel receipt-sheet" style={{ padding: 24 }}>
        {receipt.organizationName && <h1 style={{ margin: 0 }}>{receipt.organizationName}</h1>}
        <h2 style={{ margin: "6px 0 14px" }}>Receipt · ደረሰኝ</h2>

        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", margin: 0 }}>
          <dt>Receipt no. · ቁጥር</dt><dd style={{ margin: 0 }}>{receipt.reference}</dd>
          <dt>Date · ቀን</dt><dd style={{ margin: 0 }}>{new Date(receipt.soldAt).toLocaleString()}</dd>
          <dt>Status · ሁኔታ</dt><dd style={{ margin: 0 }}>{receipt.status}</dd>
          {receipt.customerName && (<><dt>Customer · ደንበኛ</dt><dd style={{ margin: 0 }}>{receipt.customerName}</dd></>)}
        </dl>

        <div style={{ overflowX: "auto", marginTop: 18 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccd" }}>
                <th scope="col">Product · ምርት</th>
                <th scope="col" style={{ textAlign: "right" }}>Qty · ብዛት</th>
                <th scope="col" style={{ textAlign: "right" }}>Unit price · ዋጋ</th>
                <th scope="col" style={{ textAlign: "right" }}>Total · ድምር</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((line, index) => (
                <tr key={index} style={{ borderBottom: "1px solid #eee" }}>
                  <td>
                    {line.productName}
                    {line.sku && <small style={{ display: "block", color: "#667" }}>{line.sku}</small>}
                  </td>
                  <td style={{ textAlign: "right" }}>{line.quantity}</td>
                  <td style={{ textAlign: "right" }}>{etb(line.unitPrice)}</td>
                  <td style={{ textAlign: "right" }}>{etb(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, marginLeft: "auto", maxWidth: 320 }}>
          <p style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}><span>Total · ጠቅላላ</span><b>{etb(receipt.total)}</b></p>
          <p style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}><span>Paid (confirmed) · የተረጋገጠ ክፍያ</span><span>{etb(receipt.paid)}</span></p>
          <p style={{ display: "flex", justifyContent: "space-between", margin: "4px 0" }}><span>Balance due · ቀሪ</span><span>{etb(receipt.balanceDue)}</span></p>
        </div>

        <p style={{ marginTop: 24, color: "#667", fontSize: 12 }}>Thank you · እናመሰግናለን</p>
      </article>

      <section className="panel no-print" style={{ marginTop: 16, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Payments · ክፍያዎች</h2>

        {notice && <p className={notice.kind === "ok" ? "demo-note" : "error-msg"} role="status">{notice.text}</p>}

        {payments.length === 0 ? (
          <p className="demo-note">No payments yet · ገና ክፍያ አልተመዘገበም</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ccd" }}>
                  <th scope="col">Date · ቀን</th>
                  <th scope="col">Method · ዘዴ</th>
                  <th scope="col">Reference · ማጣቀሻ</th>
                  <th scope="col" style={{ textAlign: "right" }}>Amount · መጠን</th>
                  <th scope="col">Status · ሁኔታ</th>
                  {canConfirm && <th scope="col">Action · እርምጃ</th>}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                    <td>{METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td>
                    <td>{p.providerReference ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{etb(p.amount)}</td>
                    <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                    {canConfirm && (
                      <td>
                        {p.status === "PENDING" && (
                          <>
                            <button className="button primary" type="button" disabled={busy} onClick={() => decide(p.id, "confirm")}>Confirm</button>{" "}
                            <button className="button secondary" type="button" disabled={busy} onClick={() => decide(p.id, "reject")}>Reject</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canRecord && receipt.status !== "PAID" && receipt.status !== "CANCELLED" && (
          <form onSubmit={recordPayment} style={{ marginTop: 18 }}>
            <h3 style={{ margin: "0 0 8px" }}>Record a payment · ክፍያ ይመዝግቡ</h3>
            <div className="form-row">
              <label htmlFor="pay-method">Method · ዘዴ</label>
              <select id="pay-method" className="form-input" value={method} disabled={busy} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="pay-amount">Amount · መጠን</label>
              <input id="pay-amount" className="form-input" inputMode="decimal" placeholder="0.00" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
            </div>
            {method !== "CASH" && (
              <div className="form-row">
                <label htmlFor="pay-ref">Receipt or transaction reference · ማጣቀሻ</label>
                <input id="pay-ref" className="form-input" maxLength={80} value={reference} disabled={busy} onChange={(e) => setReference(e.target.value)} />
                <small className="demo-note">Entered by hand. It is not checked automatically; an accountant confirms it against the receipt.</small>
              </div>
            )}
            <button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment · መዝግብ"}</button>
          </form>
        )}
      </section>
    </div>
  );
}
