"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"checking" | "ok" | "failed" | "no-token">("checking");
  const [err, setErr] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resentMsg, setResentMsg] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setState("no-token"); return; }
    api("/auth/verify-email", { body: { token } })
      .then(() => setState("ok"))
      .catch((x) => { setErr((x as Error).message); setState("failed"); });
  }, []);

  // The API answers the same way whether or not the email is registered, so this form cannot reveal accounts.
  const resend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResendBusy(true);
    setResentMsg("");
    try {
      const f = new FormData(e.currentTarget);
      const res = await api<{ message: string }>("/auth/resend-verification", { body: { email: String(f.get("email")) } });
      setResentMsg(res.message);
    } catch (x) {
      setResentMsg((x as Error).message);
    } finally {
      setResendBusy(false);
    }
  };

  const resendForm = (
    <form onSubmit={resend} style={{ marginTop: 14 }}>
      <p className="demo-note">Need a new link? Enter your email. Links expire after 24 hours. · አዲስ ሊንክ ያስፈልግዎታል? ኢሜይልዎን ያስገቡ።</p>
      <div className="form-row"><label>Email</label><input className="form-input" name="email" type="email" autoComplete="email" required /></div>
      <button className="button secondary" disabled={resendBusy} type="submit" style={{ width: "100%" }}>
        {resendBusy ? "…" : "Send a new link · አዲስ ሊንክ ላክ"}
      </button>
      {resentMsg && <p role="status" style={{ marginTop: 8 }}>{resentMsg}</p>}
    </form>
  );

  return (
    <div className="auth-wrap">
      <div className="panel auth-card">
        <h1>Email confirmation · የኢሜይል ማረጋገጫ</h1>
        {state === "checking" && <p>Checking your link…</p>}
        {state === "ok" && <p>Your email is confirmed. <Link href="/login">Sign in · ግባ</Link></p>}
        {state === "failed" && (
          <>
            <p className="error-msg">{err}</p>
            {resendForm}
            <p><Link href="/login">Back to sign in · ወደ መግቢያ</Link></p>
          </>
        )}
        {state === "no-token" && (
          <>
            <p>Check your inbox for the confirmation link. If it did not arrive, request a new one below.</p>
            {resendForm}
            <p><Link href="/login">Back to sign in · ወደ መግቢያ</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
