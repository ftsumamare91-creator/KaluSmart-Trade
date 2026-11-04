'use client';
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, etb, ApiError } from "../../lib/api";
import CustomersPanel from "../../components/CustomersPanel";
import AssistantChat from "../../components/AssistantChat";
import CatalogPanel from "../../components/CatalogPanel";
import DashboardOverview from "../../components/DashboardOverview";
import ProfitLossReport from "../../components/ProfitLossReport";
import DocumentsPanel from "../../components/DocumentsPanel";
import SecurityPanel from "../../components/SecurityPanel";
import ReportExportPanel from "../../components/ReportExportPanel";
import MembersPanel from "../../components/MembersPanel";
import AskTibebDrawer from "../../components/AskTibebDrawer";
import { Bell, CalendarDays, ChevronDown, CircleArrowRight, Download, Ellipsis, Search, Sparkles, TrendingDown, TrendingUp, Users, Wallet, Boxes, ArrowUpRight, Plus, Send, ShieldCheck, Zap, Clock3 } from "lucide-react";
import Sidebar from "../../components/Sidebar";
import { UI, NAV, Lang, LANGS, isLang } from "../../lib/i18n";
const initialMessages = [{role:"assistant", text:"Selam! I’m KaluSmart Trade. Ask me about sales, customers, inventory, or business performance. I can help turn your business data into clear next steps."}];
export default function Home() {
  const [active, setActive] = useState("Overview");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [dark, setDark] = useState(false);
  const t = UI[lang];
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      setAuthLoading(true);
      setAuthError("");

      try {
        const currentUser = await api<any>("/auth/me");
        if (!cancelled) setUser(currentUser);
      } catch (error) {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login");
          return;
        }

        setAuthError(
          error instanceof Error
            ? error.message
            : "Could not verify your session."
        );
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [router]);
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } catch { /* already signed out */ } router.replace("/login"); };
  useEffect(() => {
    try { const saved = localStorage.getItem("kalu-lang"); setLang(isLang(saved) ? saved : "en"); setDark(localStorage.getItem("kalu-theme") === "dark"); } catch { /* preferences are optional */ }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.lang = lang;
    try { localStorage.setItem("kalu-theme", dark ? "dark" : "light"); localStorage.setItem("kalu-lang", lang); } catch { /* ignore */ }
  }, [dark, lang]);
  if (authLoading) {
    return (
      <main className="main" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ textAlign: "center", padding: 32 }}>
          <h2>Verifying your session…</h2>
          <p className="demo-note">Please wait while KaluSmart Trade loads your workspace.</p>
        </section>
      </main>
    );
  }

  if (authError) {
    return (
      <main className="main" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ maxWidth: 480, padding: 32 }}>
          <h2>Unable to load your dashboard</h2>
          <p className="error-msg">{authError}</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Retry
          </button>
          <button className="button secondary" onClick={() => router.replace("/login")}>
            Go to Login
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const pageTitle = active === "Overview" ? t.welcome : (NAV[lang]?.[active] ?? active);
  const moduleText: Record<string,string> = {"Customers / CRM":"Manage customer relationships, interactions, and sales opportunities.","Documents":"Upload receipts and invoices, extract their fields for review, and keep them with your records.","Inventory & Sales":"Track stock, orders, product performance, and sales activity.","Business Intelligence":"Explore revenue, expenses, margin, and business trends.","Workflow Automation":"Create rules that respond to low stock, new orders, and important business events.","Organizations":"Manage business workspaces and tenant-level access.","Security & Audit":"Review roles, permissions, and important activity records.","Settings":"Configure workspace preferences and integrations.","Help & Support":"Guides and support resources."};
  const sendQuestion = async () => {
    if (!question.trim()) return;
    const q = question.trim(); setMessages(m => [...m, {role:"user",text:q}]); setQuestion(""); setDrawerOpen(true);
    try {
      const data = await api<any>("/assistant/ask", { method: "POST", body: { message: q } });
      setMessages(m => [...m, {role:"assistant",text:data.answer || "The AI service returned an empty answer."}]);
    } catch (err) {
      setMessages(m => [...m, {role:"assistant",text:(err as Error).message}]);
    }
  };
  return <div className="app-shell"><Sidebar role={user?.role} userName={user?.name} lang={lang} active={active} onSelect={s=>setActive(s)}/><main className="main">
    <header className="topbar"><div className="crumb">kalu Trading PLC <span>/</span> <b>{NAV[lang]?.[active] ?? active}</b></div><div className="top-actions"><div className="searchbox"><Search size={16}/><input placeholder={t.search} aria-label="Search"/></div><select className="icon-button lang-btn" aria-label={t.language} title={t.language} value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ width: "auto", padding: "0 8px", color: "#66748b", fontSize: 12 }}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select><button className="icon-button ask-kalusmart" aria-label={t.askAi} title={t.askAi} onClick={()=>setDrawerOpen(true)}><Sparkles size={18}/></button><button className="icon-button" aria-label={t.darkMode} title={t.darkMode} onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button><button className="icon-button" aria-label="Notifications"><Bell size={18}/><i/></button><button
        className="button secondary"
        aria-label="Go to Home page"
        onClick={() => router.push("/home")}
      >
        ← Home
      </button>
      <button className="button secondary" onClick={logout}>{t.logout}</button><div className="profile-mini" title={user?.email}>{(user?.name ?? "KA").slice(0, 2).toUpperCase()}</div></div></header>
    <div className="content"><div className="welcome-row"><div><div className="eyebrow"><span className="live-dot"/> YOUR BUSINESS AT A GLANCE</div><h1>{pageTitle}<span className="wave"> ✨</span></h1><p>{active==="Overview"?t.today:moduleText[active] || "Your business workspace at a glance."}</p></div><div className="welcome-actions"></div></div>
    {active==="Overview" ? <DashboardOverview role={user?.role} lang={lang}/> : active==="AI Assistant" ? <AssistantChat lang={lang}/> : active==="Customers / CRM" ? <CustomersPanel role={user?.role}/> : active==="Inventory & Sales" ? <CatalogPanel role={user?.role} lang={lang}/> : active==="Business Intelligence" ? <><ProfitLossReport role={user?.role}/><ReportExportPanel/></> : active==="Documents" ? <DocumentsPanel role={user?.role}/> : active==="Security & Audit" ? <SecurityPanel role={user?.role}/> : active==="Organizations" ? <MembersPanel currentUserId={user?.id}/> : <section className="panel module-placeholder"><div className="module-icon"><ShieldCheck size={30}/></div><h2>{active}</h2><p>{moduleText[active] || "Configure your workspace and preferences."}</p><p className="placeholder-detail">This module is included in the product roadmap and API data model. Connect the corresponding API endpoints and forms before using it with live business records.</p></section>}
    <footer className="footer"><span>© 2026 KaluSmart Trade · ንግድ AI</span><span><i className="live-dot"/> Live workspace data <span className="footer-sep">·</span> Built for Ethiopian SMEs</span></footer>
    <AskTibebDrawer open={drawerOpen && active!=="AI Assistant"} onClose={()=>setDrawerOpen(false)} lang={lang} role={user?.role}/>
    </div></main></div>;
}
