"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { addDaysYmd, money, rangeProblem, ymdOf } from "../lib/date-range";
import { dashboardText as dt } from "../lib/dashboard-i18n";

/** Roles allowed to see money figures. Mirrors the server permission matrix; the server enforces it too. */
const FINANCE_ROLES = ["ADMIN", "MANAGER", "ACCOUNTANT"];

type Load<T> = { status: "loading" | "ok" | "error"; data?: T; error?: string };
type Granularity = "day" | "week" | "month";
const PRESETS: { label: string; days: number }[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Could not load this section. Check your connection and try again.");

function Section({ title, state, onRetry, children, empty, lang = "en" }: { title: string; state: Load<any>; onRetry: () => void; children?: ReactNode; empty?: boolean; lang?: string }) {
  if (state.status === "loading" && !state.data) return <div className="skeleton-block" aria-busy="true" aria-label={`${title} loading`}>{dt(lang, "Loading")} {title.toLowerCase()}…</div>;
  if (state.status === "error") {
    return (
      <div className="api-error" role="alert">
        <b>{title} {dt(lang, "Unavailable").toLowerCase()}.</b> <span>{state.error}</span>
        <button type="button" className="button secondary" onClick={onRetry}>{dt(lang, "Retry")}</button>
      </div>
    );
  }
  if (empty) return <div className="empty-state">No records for this period.</div>;
  return <>{children}</>;
}

/** Bars for sales and collections. Drawn only from API values; an all-zero series shows the empty state instead. */
function SeriesChart({ series, lang = "en" }: { series: { bucket: string; sales: string; collections: string }[]; lang?: string }) {
  const max = Math.max(0, ...series.flatMap((s) => [Number(s.sales), Number(s.collections)]));
  const w = 640;
  const h = 200;
  const step = series.length ? w / series.length : w;
  return (
    <div className="series-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Sales and collections for ${series.length} periods`} preserveAspectRatio="none" style={{ width: "100%", height: 200 }}>
        {series.map((s, i) => {
          const sh = max ? (Number(s.sales) / max) * (h - 10) : 0;
          const ch = max ? (Number(s.collections) / max) * (h - 10) : 0;
          return (
            <g key={s.bucket}>
              <rect x={i * step + step * 0.1} y={h - sh} width={step * 0.38} height={sh} fill="#1689d4"><title>{`${s.bucket} sales ${money(s.sales)}`}</title></rect>
              <rect x={i * step + step * 0.5} y={h - ch} width={step * 0.38} height={ch} fill="#2f9e6b"><title>{`${s.bucket} collections ${money(s.collections)}`}</title></rect>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend"><span><i className="legend-revenue" /> Sales</span><span><i className="legend-collect" /> Collections</span></div>
      <div className="x-labels"><span>{series[0]?.bucket}</span><span>{series[series.length - 1]?.bucket}</span></div>
      <table className="sr-only"><caption>Sales and collections by period</caption><tbody>{series.map((s) => <tr key={s.bucket}><th>{s.bucket}</th><td>{money(s.sales)}</td><td>{money(s.collections)}</td></tr>)}</tbody></table>
    </div>
  );
}

export default function DashboardOverview({ role, lang = "en" }: { role?: string; lang?: string }) {
  const finance = !!role && FINANCE_ROLES.includes(role);
  const [from, setFrom] = useState(() => addDaysYmd(ymdOf(new Date()), -29));
  const [to, setTo] = useState(() => ymdOf(new Date()));
  const [gran, setGran] = useState<Granularity>("day");
  const [states, setStates] = useState<Record<string, Load<any>>>({});
  const problem = rangeProblem(from, to);

  const endpoints = useMemo(() => {
    const qs = `from=${from}&to=${to}`;
    const list: [string, string][] = [
      ["inventory", "/analytics/inventory?limit=5"],
      ["products", `/analytics/products?${qs}&limit=5`],
    ];
    if (finance) {
      list.push(["overview", `/analytics/overview?${qs}`], ["series", `/analytics/timeseries?${qs}&granularity=${gran}`], ["customers", "/analytics/top-balances?limit=5"], ["suppliers", "/ledger/payables"]);
    }
    return list;
  }, [from, to, gran, finance]);

  const loadOne = useCallback(async (key: string, path: string) => {
    setStates((s) => ({ ...s, [key]: { status: "loading", data: s[key]?.data } }));
    try {
      const data = await api<any>(path);
      setStates((s) => ({ ...s, [key]: { status: "ok", data } }));
    } catch (e) {
      setStates((s) => ({ ...s, [key]: { status: "error", error: errText(e) } }));
    }
  }, []);

  const loadAll = useCallback(() => {
    if (problem) return;
    endpoints.forEach(([k, p]) => loadOne(k, p));
  }, [endpoints, loadOne, problem]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const ov = states.overview;
  const ser = states.series;
  const kpi = (label: string, value?: string, note?: string) => (
    <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span></div><div className="stat-value">{value ?? "—"}</div>{note && <div className="stat-bottom"><span>{note}</span></div>}</article>
  );

  return (
    <div className="dashboard-live">
      <section className="panel range-panel" aria-label={dt(lang, "Reporting period")}>
        <div className="range-presets">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="button secondary" onClick={() => { setTo(ymdOf(new Date())); setFrom(addDaysYmd(ymdOf(new Date()), -(p.days - 1))); }}>{p.label}</button>
          ))}
        </div>
        <label>{dt(lang, "From")} <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{dt(lang, "To")} <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {finance && <label>{dt(lang, "Group by")} <select value={gran} onChange={(e) => setGran(e.target.value as Granularity)}><option value="day">{dt(lang, "Day")}</option><option value="week">{dt(lang, "Week")}</option><option value="month">{dt(lang, "Month")}</option></select></label>}
        <button type="button" className="button secondary" onClick={loadAll} disabled={!!problem}>{dt(lang, "Refresh")}</button>
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </section>

      {finance && (
        <section className="stats-grid" aria-label={dt(lang, "Key figures")}>
          <Section lang={lang} title={dt(lang, "Key figures")} state={ov ?? { status: "loading" }} onRetry={() => loadOne("overview", endpoints.find(([k]) => k === "overview")![1])}>
            {ov?.data && <>
              {kpi(dt(lang, "Sales"), money(ov.data.sales.total), `${ov.data.sales.count} sales`)}
              {kpi(dt(lang, "Collections (cash received)"), money(ov.data.collections.total), dt(lang, "Not revenue"))}
              {kpi(dt(lang, "Operating expenses"), money(ov.data.expenses.total), dt(lang, "Active expenses"))}
              {kpi(dt(lang, "Inventory purchases"), money(ov.data.purchases.total), dt(lang, "Not an operating expense"))}
              {kpi(dt(lang, "Customers owe"), money(ov.data.receivablesAtEnd.total), ov.data.receivablesAtEnd.exact ? dt(lang, "At end of period") : dt(lang, "At end of period (historical, approximate)"))}
              {kpi(dt(lang, "You owe suppliers"), money(ov.data.payablesAtEnd.total), ov.data.payablesAtEnd.exact ? dt(lang, "At end of period") : dt(lang, "At end of period (historical, approximate)"))}
              {ov.data.previous && kpi(dt(lang, "Sales vs previous period"), ov.data.previous.salesChangePercent === null ? "—" : `${ov.data.previous.salesChangePercent > 0 ? "+" : ""}${ov.data.previous.salesChangePercent.toFixed(1)}%`, `Previous: ${money(ov.data.previous.salesTotal)}`)}
            </>}
          </Section>
        </section>
      )}

      {finance && (
        <section className="dashboard-grid">
          <article className="panel revenue-panel">
            <div className="panel-head"><div><h2>{dt(lang, "Sales and collections")}</h2><p>{dt(lang, "From recorded sales and confirmed payments")}</p></div></div>
            <Section lang={lang} title={dt(lang, "Chart")} state={ser ?? { status: "loading" }} onRetry={() => loadOne("series", endpoints.find(([k]) => k === "series")![1])} empty={!!ser?.data && !ser.data.series.some((s: any) => Number(s.sales) > 0 || Number(s.collections) > 0)}>
              {ser?.data && <SeriesChart lang={lang} series={ser.data.series} />}
            </Section>
          </article>
          <article className="panel">
            <div className="panel-head"><div><h2>{dt(lang, "Recent transactions")}</h2><p>Latest sales and confirmed payments in this period</p></div></div>
            <Section lang={lang} title={dt(lang, "Recent transactions")} state={ov ?? { status: "loading" }} onRetry={() => loadOne("overview", endpoints.find(([k]) => k === "overview")![1])} empty={!!ov?.data && ov.data.recent.length === 0}>
              <ul className="activity-list">
                {ov?.data?.recent.map((t: any, i: number) => (
                  <li className="activity" key={`${t.kind}-${i}`}>
                    <div className="activity-copy"><b>{t.kind === "SALE" ? `Sale ${t.reference}` : dt(lang, "Payment confirmed")}</b><small>{t.kind === "SALE" ? t.customerName ?? dt(lang, "Walk-in") : `${t.method} · sale ${t.reference}`}</small><span>{new Date(t.at).toLocaleString()}</span></div>
                    <div className="activity-amount">{money(t.amount)}</div>
                  </li>
                ))}
              </ul>
            </Section>
          </article>
        </section>
      )}

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-head"><div><h2>{dt(lang, "Best-selling products")}</h2><p>{dt(lang, "Ranked by sales value in this period")}</p></div></div>
          <Section lang={lang} title={dt(lang, "Best-selling products")} state={states.products ?? { status: "loading" }} onRetry={() => loadOne("products", endpoints.find(([k]) => k === "products")![1])} empty={!!states.products?.data && states.products.data.items.length === 0}>
            <ol className="rank-list">
              {states.products?.data?.items.map((p: any) => (
                <li key={p.productId}><b>{p.name ?? dt(lang, "Deleted product")}</b> <small>{p.quantity} {dt(lang, "sold")}{finance ? ` · ${money(p.salesValue)}` : ""}</small></li>
              ))}
            </ol>
          </Section>
        </article>
        <article className="panel">
          <div className="panel-head"><div><h2>{dt(lang, "Low stock")}</h2><p>{states.inventory?.data ? `${states.inventory.data.totals.lowStock} at or below reorder level · ${states.inventory.data.totals.outOfStock} out of stock` : dt(lang, "Stock against reorder levels")}</p></div></div>
          <Section lang={lang} title={dt(lang, "Low stock")} state={states.inventory ?? { status: "loading" }} onRetry={() => loadOne("inventory", "/analytics/inventory?limit=5")} empty={!!states.inventory?.data && states.inventory.data.lowStock.length === 0}>
            <ul className="rank-list">
              {states.inventory?.data?.lowStock.map((p: any) => <li key={p.id}><b>{p.name}</b> <small>{p.quantity} {dt(lang, "left")} · {dt(lang, "reorder at")} {p.reorderLevel} · {p.sku}</small></li>)}
            </ul>
          </Section>
        </article>
      </section>

      {finance && (
        <section className="dashboard-grid">
          <article className="panel">
            <div className="panel-head"><div><h2>{dt(lang, "Customers who owe")}</h2><p>{dt(lang, "Largest balances, as of today")}</p></div></div>
            <Section lang={lang} title={dt(lang, "Customer balances")} state={states.customers ?? { status: "loading" }} onRetry={() => loadOne("customers", "/analytics/top-balances?limit=5")} empty={!!states.customers?.data && states.customers.data.customers.length === 0}>
              <ul className="rank-list">{states.customers?.data?.customers.map((c: any) => <li key={c.customerId}><b>{c.name ?? "Customer"}</b> <small>{money(c.balanceDue)}</small></li>)}</ul>
            </Section>
          </article>
          <article className="panel">
            <div className="panel-head"><div><h2>{dt(lang, "Suppliers you owe")}</h2><p>{dt(lang, "Received purchases not yet fully paid, as of today")}</p></div></div>
            <Section lang={lang} title={dt(lang, "Supplier balances")} state={states.suppliers ?? { status: "loading" }} onRetry={() => loadOne("suppliers", "/ledger/payables")} empty={!!states.suppliers?.data && states.suppliers.data.rows.length === 0}>
              <ul className="rank-list">{states.suppliers?.data?.rows.slice(0, 5).map((s: any) => <li key={s.supplierId}><b>{s.supplierName ?? "Supplier"}</b> <small>{money(s.balanceDue)}</small></li>)}</ul>
            </Section>
          </article>
        </section>
      )}
    </div>
  );
}

