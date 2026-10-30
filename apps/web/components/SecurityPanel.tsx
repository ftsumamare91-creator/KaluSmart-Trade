"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

type Session = { id: string; createdAt: string; expiresAt: string; current: boolean };
type AuditEvent = { id: string; action: string; entityType: string; entityId: string | null; userId: string | null; createdAt: string };

/** Shows only what the server records. The API stores no IP or device data, so none is shown here. */
export default function SecurityPanel({ role }: { role?: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = role === "ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<Session[]>("/auth/sessions");
      setSessions(s);
      if (isAdmin) setEvents(await api<AuditEvent[]>("/audit?limit=100"));
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (session: Session) => {
    const msg = session.current
      ? "This is your current session. You will be signed out. Continue?"
      : "Sign out this session?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await api<{ signedOutCurrent: boolean }>(`/auth/sessions/${encodeURIComponent(session.id)}/revoke`, { method: "POST" });
      if (r.signedOutCurrent) { window.location.href = "/login"; return; }
      setNotice({ kind: "ok", text: "Session signed out." });
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof ApiError ? err.message : (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const revokeOthers = async () => {
    if (!window.confirm("Sign out all your other sessions?")) return;
    setBusy(true);
    try {
      const r = await api<{ revoked: number }>("/auth/sessions/revoke-others", { method: "POST" });
      setNotice({ kind: "ok", text: `${r.revoked} other session(s) signed out.` });
      await load();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel" aria-labelledby="sessions-title">
        <h2 id="sessions-title">My sessions · የእኔ ክፍለ ጊዜዎች</h2>
        <p className="demo-note">Sessions that are still active on this account. Signing out a session stops it from being used.</p>
        {notice && <p role={notice.kind === "err" ? "alert" : "status"}>{notice.text}</p>}
        {loading ? <p>Loading…</p> : sessions.length === 0 ? <p>No active sessions.</p> : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Started</th><th>Expires</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.createdAt).toLocaleString()}</td>
                      <td>{new Date(s.expiresAt).toLocaleString()}</td>
                      <td>{s.current ? "This device · ይህ መሣሪያ" : "Active"}</td>
                      <td><button className="button secondary" disabled={busy} onClick={() => revoke(s)}>Sign out</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sessions.length > 1 && (
              <button className="button secondary" style={{ marginTop: 10 }} disabled={busy} onClick={revokeOthers}>
                Sign out all other sessions
              </button>
            )}
          </>
        )}
      </section>

      {isAdmin ? (
        <section className="panel" aria-labelledby="audit-title">
          <h2 id="audit-title">Activity log · የእንቅስቃሴ መዝገብ</h2>
          <p className="demo-note">The 100 most recent recorded events for this organization. Events are read-only here.</p>
          {loading ? <p>Loading…</p> : events.length === 0 ? <p>No activity recorded yet.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Actor (user id)</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.createdAt).toLocaleString()}</td>
                      <td>{e.action}</td>
                      <td>{e.entityType}{e.entityId ? ` · ${e.entityId.slice(0, 12)}…` : ""}</td>
                      <td>{e.userId ? `${e.userId.slice(0, 12)}…` : "system"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="panel"><p className="demo-note">The activity log is available to organization administrators.</p></section>
      )}
    </div>
  );
}
