'use client';
import { useState } from "react";
import { NAV, Lang } from "../lib/i18n";
import { canSee } from "../lib/nav-access";
import { Activity, BarChart3, Bot, Boxes, Building2, ChevronLeft, CircleHelp, ClipboardList, FileText, LayoutDashboard, Settings, ShieldCheck, Users, Workflow } from "lucide-react";
const nav = [
  ["Overview", LayoutDashboard], ["AI Assistant", Bot], ["Customers / CRM", Users], ["Inventory & Sales", Boxes], ["Documents", FileText],
  ["Business Intelligence", BarChart3], ["Workflow Automation", Workflow], ["Organizations", Building2], ["Security & Audit", ShieldCheck]
] as const;
export default function Sidebar({ active, onSelect, lang = "en", role, userName }: { active: string; onSelect: (s: string) => void; lang?: Lang; role?: string; userName?: string }) {
  const L = (s: string) => NAV[lang]?.[s] ?? s;
  const [collapsed, setCollapsed] = useState(false);
  return <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
    <div className="brand"><img src="/images/kalu-k-mark.png" alt="kalu KaluSmart Trade logo" className="brand-logo float-3d" width={38} height={38} />{!collapsed && <div><b>KaluSmart <span>AI</span></b><small>ንግድ · BUSINESS INTELLIGENCE</small></div>}</div>
    <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"><ChevronLeft size={16}/></button>
    <div className="workspace"><div className="workspace-avatar">K</div>{!collapsed && <div><b>kalu Trading PLC</b><small>Business workspace</small></div>}</div>
    <small className="nav-label">{!collapsed && "WORKSPACE"}</small>
    <nav>{nav.filter(([label]) => canSee(role, label)).map(([label, Icon]) => <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => onSelect(label)} title={collapsed ? label : undefined}><Icon size={18}/>{!collapsed && <span>{L(label)}</span>}{!collapsed && label === "AI Assistant" && <i>AI</i>}</button>)}</nav>
    <div className="sidebar-bottom">{canSee(role, "Settings") && <button className="nav-item" onClick={() => onSelect("Settings")}><Settings size={18}/>{!collapsed && <span>{L("Settings")}</span>}</button>}<button className="nav-item" onClick={() => onSelect("Help & Support")}><CircleHelp size={18}/>{!collapsed && <span>{L("Help & Support")}</span>}</button><div className="user-card"><div className="user-avatar">KA</div>{!collapsed && <div><b>{userName ?? "—"}</b><small>{role ?? ""}</small></div>}</div></div>
  </aside>;
}

