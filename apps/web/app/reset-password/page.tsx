"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get("token") ?? ""); }, []);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await api("/auth/reset-password", { body: { token, password: String(f.get("password")) } });
      setDone(true);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={submit}>
        <h1>New password · አዲስ የይለፍ ቃል</h1>
        {err && <p className="error-msg">{err}</p>}
        {done ? (
          <p>Your password was changed and all old sessions were signed out. <Link href="/login">Sign in · ግባ</Link></p>
        ) : !token ? (
          <p>This page needs the link from your email. <Link href="/forgot-password">Request a new link</Link></p>
        ) : (
          <>
            <div className="form-row"><label>New password (10+ characters, letters and numbers)</label><input className="form-input" name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
            <button className="button primary" disabled={busy} type="submit" style={{ width: "100%" }}>{busy ? "…" : "Set new password"}</button>
          </>
        )}
      </form>
    </div>
  );
}
