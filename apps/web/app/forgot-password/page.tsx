"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await api("/auth/forgot-password", { body: { email: String(f.get("email")) } });
      setDone(true);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={submit}>
        <h1>Reset password · የይለፍ ቃል ዳግም ማስጀመር</h1>
        {err && <p className="error-msg">{err}</p>}
        {done ? (
          <p>If an account exists for this email, a reset link has been sent. The link expires in 30 minutes.</p>
        ) : (
          <>
            <div className="form-row"><label>Email</label><input className="form-input" name="email" type="email" autoComplete="email" required /></div>
            <button className="button primary" disabled={busy} type="submit" style={{ width: "100%" }}>{busy ? "…" : "Send reset link"}</button>
          </>
        )}
        <p className="demo-note" style={{ marginTop: 14 }}><Link href="/login">Back to sign in · ወደ መግቢያ</Link></p>
      </form>
    </div>
  );
}
