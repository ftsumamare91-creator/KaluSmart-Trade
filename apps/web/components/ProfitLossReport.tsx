"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { addDaysYmd, money, rangeProblem, ymdOf } from "../lib/date-range";

type Granularity = "day" | "week" | "month" | "quarter" | "year";

/**
 * Profit & Loss. Every line comes from the server with its status. Lines the application cannot verify
 * are shown as "Not available" with the reason, never as zero or an estimate.
 */
export default function ProfitLossReport({ role }: { role?: string }) {
  const allowed = !!role && ["ADMIN", "MANAGER", "ACCOUNTANT"].includes(role);
  const [from, setFrom] = useState(() => addDaysYmd(ymdOf(new Date()), -364));
  const [to, setTo] = useState(() => ymdOf(new Date()));
  const [gran, setGran] = useState<Granularity>("month");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const problem = rangeProblem(from, to);

  const load = async () => {
    if (problem || !allowed) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<any>(`/reports/profit-loss?from=${from}&to=${to}&granularity=${gran}`));
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError ? e.message : "The report could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, gran, allowed]);

  if (!allowed) return <section className="panel module-placeholder"><h2>Profit &amp; Loss</h2><p>Your role does not include financial reports.</p></section>;

  return (
    <div className="pnl-report">
      <section className="panel range-panel" aria-label="Report period">
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Group by <select value={gran} onChange={(e) => setGran(e.target.value as Granularity)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></label>
        <button type="button" className="button secondary" onClick={load} disabled={!!problem || loading}>{loading ? "Loading…" : "Refresh"}</button>
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </section>

      {error && <div className="api-error" role="alert"><b>Report unavailable.</b> <span>{error}</span> <button type="button" className="button secondary" onClick={load}>Retry</button></div>}
      {!error && loading && !data && <div className="skeleton-block" aria-busy="true">Loading report…</div>}

      {data && (
        <>
          <section className="panel">
            <div className="panel-head"><div><h2>Profit &amp; loss</h2><p>{data.range.from} to {data.range.to} (inclusive) · management summary</p></div></div>
            <table className="pnl-table">
              <thead><tr><th scope="col">Line</th><th scope="col" className="num">Amount</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {data.totals.lines.map((l: any) => (
                  <tr key={l.key} className={l.status === "UNAVAILABLE" ? "unavailable" : undefined}>
                    <th scope="row">{l.label}</th>
                    <td className="num">{l.status === "UNAVAILABLE" ? <span className="pill">Not available</span> : money(l.amount)}</td>
                    <td>{l.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div className="panel-head"><div><h2>Memo items</h2><p>Shown for context. None of these is revenue or expense.</p></div></div>
            <table className="pnl-table">
              <tbody>
                {data.totals.memo.map((m: any) => (
                  <tr key={m.key}><th scope="row">{m.label}</th><td className="num">{money(m.amount)}</td><td>{m.note}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div className="panel-head"><div><h2>By period</h2><p>{data.periods.length} {data.granularity}{data.periods.length === 1 ? "" : "s"}</p></div></div>
            {data.periods.every((p: any) => p.grossSales === "0.00" && p.operatingExpenses === "0.00" && p.collections === "0.00" && p.purchases === "0.00") ? (
              <div className="empty-state">No sales, expenses, payments or purchases in this period.</div>
            ) : (
              <table className="pnl-table">
                <thead><tr><th scope="col">Period starting</th><th scope="col" className="num">Gross sales</th><th scope="col" className="num">Operating expenses</th><th scope="col" className="num">Collections</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Net profit</th></tr></thead>
                <tbody>
                  {data.periods.map((p: any) => (
                    <tr key={p.period}><th scope="row">{p.period}</th><td className="num">{money(p.grossSales)}</td><td className="num">{money(p.operatingExpenses)}</td><td className="num">{money(p.collections)}</td><td className="num">{money(p.purchases)}</td><td className="num"><span className="pill">Not available</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small-note">Consistency check: {Object.entries(data.reconciled).every(([, ok]) => ok) ? "period rows match the totals" : "period rows do not match the totals; do not rely on this report"}.</p>
          </section>

          <section className="panel">
            <h2>How to read this report</h2>
            <ul>{data.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
          </section>
        </>
      )}
    </div>
  );
}
