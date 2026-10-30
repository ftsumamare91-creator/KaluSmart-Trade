"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api, API } from "../lib/api";
import { LANGS, isLang, type Lang } from "../lib/i18n";

type AuthMode = "login" | "signup";

type AuthSliderProps = {
  initialMode: AuthMode;
};

const GOOGLE_MESSAGES: Record<string, string> = {
  google_unavailable: "Google sign-in is not configured on this server.",
  google_denied: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired or was interrupted. Please try again.",
  google_unverified: "Google did not confirm this email address.",
  google_failed: "Google sign-in failed. Please try again.",
};


const AUTH_TEXT: Record<Lang, Record<string, string>> = {
  en: {
    language: "Language", welcomeBack: "WELCOME BACK", getStarted: "GET STARTED",
    signIn: "Sign in", createAccount: "Create account",
    loginIntro: "Welcome back! Please enter your details.",
    signupIntro: "Create your account and manage your business.",
    fullName: "Full name", fullNamePlaceholder: "Enter your full name",
    organization: "Organization", organizationPlaceholder: "Your organization name",
    email: "Email address", password: "Password", forgotPassword: "Forgot password?",
    enterPassword: "Enter your password", minPassword: "At least 10 characters",
    hide: "Hide", show: "Show",
    passwordHint: "Use at least 10 characters, including letters and numbers.",
    pleaseWait: "Please wait...", orContinue: "or continue with",
    continueGoogle: "Continue with Google",
    noAccount: "Don't have an account?", alreadyAccount: "Already have an account?",
    signUp: "Sign up", welcome: "Welcome", back: "Back!",
    join: "Join Us", today: "Today!",
    businessLogin: "Your business, inventory and sales — all in one smart place.",
    businessSignup: "Build a smarter business with organized inventory, sales and insights.",
    createAnAccount: "Create an account", backToSignIn: "Back to sign in",
    smartTools: "Smart tools for your business"
  },
  am: {
    language: "ቋንቋ", welcomeBack: "እንኳን ተመለሱ", getStarted: "እንጀምር",
    signIn: "ግባ", createAccount: "መለያ ፍጠር",
    loginIntro: "እንኳን ደህና መጡ። እባክዎ መረጃዎን ያስገቡ።",
    signupIntro: "መለያዎን ይፍጠሩና ንግድዎን ያስተዳድሩ።",
    fullName: "ሙሉ ስም", fullNamePlaceholder: "ሙሉ ስምዎን ያስገቡ",
    organization: "ድርጅት", organizationPlaceholder: "የድርጅትዎ ስም",
    email: "የኢሜይል አድራሻ", password: "የይለፍ ቃል",
    forgotPassword: "የይለፍ ቃል ረሱ?",
    enterPassword: "የይለፍ ቃልዎን ያስገቡ",
    minPassword: "ቢያንስ 10 ቁምፊዎች",
    hide: "ደብቅ", show: "አሳይ",
    passwordHint: "ቢያንስ 10 ቁምፊዎች፣ ፊደሎችና ቁጥሮች ይጠቀሙ።",
    pleaseWait: "እባክዎ ይጠብቁ...", orContinue: "ወይም በዚህ ይቀጥሉ",
    continueGoogle: "በGoogle ይቀጥሉ",
    noAccount: "መለያ የለዎትም?", alreadyAccount: "አስቀድሞ መለያ አለዎት?",
    signUp: "ይመዝገቡ", welcome: "እንኳን ደህና መጡ", back: "ተመለሱ!",
    join: "ይቀላቀሉን", today: "ዛሬ!",
    businessLogin: "ንግድ፣ ክምችትና ሽያጭዎን በአንድ ቦታ ያስተዳድሩ።",
    businessSignup: "ክምችትና ሽያጭዎን በማደራጀት ንግድዎን ያሳድጉ።",
    createAnAccount: "መለያ ፍጠር", backToSignIn: "ወደ መግቢያ ተመለስ",
    smartTools: "ብልህ መሣሪያዎች። የተሻለ ንግድ።"
  },
  om: {
    language: "Afaan", welcomeBack: "BAGA DEEBITAN", getStarted: "HA JALQABNU",
    signIn: "Seeni", createAccount: "Akkaawuntii uumi",
    loginIntro: "Baga nagaan dhuftan! Maaloo odeeffannoo keessan galchaa.",
    signupIntro: "Akkaawuntii uumadhaa, daldala keessanis bulchaa.",
    fullName: "Maqaa guutuu", fullNamePlaceholder: "Maqaa guutuu galchaa",
    organization: "Dhaabbata", organizationPlaceholder: "Maqaa dhaabbata keessanii",
    email: "Teessoo imeelii", password: "Jecha iccitii",
    forgotPassword: "Jecha iccitii dagattanii?",
    enterPassword: "Jecha iccitii galchaa", minPassword: "Yoo xiqqaate arfiilee 10",
    hide: "Dhoksi", show: "Agarsiisi",
    passwordHint: "Arfiilee 10 ol, qubee fi lakkoofsa fayyadamaa.",
    pleaseWait: "Maaloo eegaa...", orContinue: "yookaan itti fufaa",
    continueGoogle: "Google waliin itti fufaa",
    noAccount: "Akkaawuntii hin qabdan?", alreadyAccount: "Akkaawuntii qabduu?",
    signUp: "Galmaa'i", welcome: "Baga nagaan dhuftan", back: "Deebitan!",
    join: "Nu waliin ta'aa", today: "Har'a!",
    businessLogin: "Daldala, kuusaa fi gurgurtaa keessan bakka tokkootti bulchaa.",
    businessSignup: "Kuusaa fi gurgurtaa qindeessuun daldala keessan guddisaa.",
    createAnAccount: "Akkaawuntii uumi", backToSignIn: "Gara seensaatti deebi'i",
    smartTools: "Meeshaalee ogummaa. Daldala fooyya'aa."
  },
  ti: {
    language: "ቋንቋ", welcomeBack: "እንቋዕ ተመሊስኩም", getStarted: "ንጀምር",
    signIn: "እቶ", createAccount: "መለያ ፍጠር",
    loginIntro: "እንቋዕ ብደሓን መጻእኩም። በጃኹም ሓበሬታኹም ኣእትዉ።",
    signupIntro: "መለያ ፍጠሩን ንግድኹም ኣመሓድሩን።",
    fullName: "ምሉእ ስም", fullNamePlaceholder: "ምሉእ ስምኩም ኣእትዉ",
    organization: "ትካል", organizationPlaceholder: "ስም ትካልኩም",
    email: "ኣድራሻ ኢመይል", password: "መሕለፊ ቃል",
    forgotPassword: "መሕለፊ ቃል ረሲዕኩም?",
    enterPassword: "መሕለፊ ቃልኩም ኣእትዉ",
    minPassword: "እንተወሓደ 10 ፊደላት",
    hide: "ሕባእ", show: "ኣርኢ",
    passwordHint: "10 ወይ ካብኡ ንላዕሊ ፊደላት፣ ፊደላትን ቁጽርታትን ተጠቐሙ።",
    pleaseWait: "በጃኹም ተጸበዩ...", orContinue: "ወይ ቀጽሉ",
    continueGoogle: "ብGoogle ቀጽሉ",
    noAccount: "መለያ የብልኩምን?", alreadyAccount: "ድሮ መለያ ኣለኩም?",
    signUp: "ተመዝገቡ", welcome: "እንቋዕ ብደሓን መጻእኩም", back: "ተመሊስኩም!",
    join: "ተጸንበሩና", today: "ሎሚ!",
    businessLogin: "ንግዲ፣ ዕቃን ሽያጥን ኣብ ሓደ ቦታ ኣመሓድሩ።",
    businessSignup: "ዕቃን ሽያጥን ብምውዳብ ንግድኹም ኣማዕብሉ።",
    createAnAccount: "መለያ ፍጠር", backToSignIn: "ናብ መእተዊ ተመለስ",
    smartTools: "ብልሒ መሳርሒታት። ዝሓሸ ንግዲ።"
  }
};
export default function AuthSlider({ initialMode }: AuthSliderProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shakeCount, setShakeCount] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState<Lang>("en");
  const t = AUTH_TEXT[language];

  const isLogin = mode === "login";

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && GOOGLE_MESSAGES[code]) {
      setError(GOOGLE_MESSAGES[code]);
      setShakeCount((n) => n + 1);
    }
  }, []);

  function showError(message: string) {
    setError(message);
    setShakeCount((n) => n + 1);
  }

  function switchMode(nextMode: AuthMode) {
    if (busy) return;

    setError("");
    setShowPassword(false);
    setMode(nextMode);

    window.history.replaceState(
      null,
      "",
      nextMode === "login" ? "/login" : "/signup"
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("እባክዎ ትክክለኛ Email ያስገቡ። Please enter a valid email.");
      return;
    }

    if (!password) {
      showError("እባክዎ Password ያስገቡ። Password is required.");
      return;
    }

    const payload: Record<string, string> = { email, password };

    if (!isLogin) {
      const name = String(formData.get("name") ?? "").trim();
      const organizationName = String(formData.get("org") ?? "").trim();

      if (name.length < 2) {
        showError("Name must be at least 2 characters.");
        return;
      }

      if (organizationName.length < 2) {
        showError("Organization name must be at least 2 characters.");
        return;
      }

      if (
        password.length < 10 ||
        !/[A-Za-z]/.test(password) ||
        !/[0-9]/.test(password)
      ) {
        showError(
          "Password must be at least 10 characters and include letters and numbers."
        );
        return;
      }

      payload.name = name;
      payload.organizationName = organizationName;
    }

    setBusy(true);

    try {
      if (isLogin) {
        await api("/auth/login", { body: payload });
        router.replace("/dashboard");
      } else {
        const result = await api<{ verificationRequired?: boolean }>(
          "/auth/register",
          { body: payload }
        );

        router.replace(
          result?.verificationRequired ? "/verify-email" : "/"
        );
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Authentication failed. Please try again.";

      showError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-wrap auth-slider-wrap">
      <Link
        href="/home"
        aria-label="Back to Home"
        style={{
          position: "fixed",
          top: "18px",
          left: "18px",
          zIndex: 1000,
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 15px",
          borderRadius: "10px",
          background: "#ffffff",
          color: "#173b32",
          border: "1px solid #d9e4df",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "14px",
          boxShadow: "0 4px 14px rgba(0,0,0,0.08)"
        }}
      >
        ← Back to Home
      </Link>
      <section
        className={`auth-split-card ${
          isLogin ? "auth-mode-login" : "auth-mode-signup"
        }`}
      >
        <motion.div
          layout
          className="auth-form-side"
          transition={{
            layout: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              className="auth-form-content"
              initial={{ opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.25 }}
            >
              <div className="auth-language-picker">
                <label htmlFor="auth-language">{t.language}</label>
                <select
                  id="auth-language"
                  value={language}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isLang(next)) {
                      setLanguage(next);
                      window.localStorage.setItem("kalusmart-language", next);
                    }
                  }}
                >
                  {LANGS.map((item) => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div className="auth-brand-mark">
                <span className="auth-brand-icon">K</span>
                <span>KaluSmart <b>Trade</b></span>
              </div>

              <div className="auth-heading">
                <span className="auth-eyebrow">
                  {isLogin ? t.welcomeBack : t.getStarted}
                </span>
                <h1>
                  {isLogin ? t.signIn : t.createAccount}
                  <span className="auth-heading-dot">.</span>
                </h1>
                <p>
                  {isLogin
                    ? t.loginIntro
                    : t.signupIntro}
                </p>
              </div>

              {error && (
                <motion.div
                  key={shakeCount}
                  className="auth-alert"
                  role="alert"
                  initial={{ opacity: 0, y: -5, x: 0 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    x: [0, -8, 8, -6, 6, 0],
                  }}
                  transition={{ duration: 0.38 }}
                >
                  <span className="auth-alert-icon">!</span>
                  <span>{error}</span>
                </motion.div>
              )}

              <form
                className="auth-modern-form"
                onSubmit={submit}
                noValidate
              >
                {!isLogin && (
                  <>
                    <div className="auth-field">
                      <label htmlFor="auth-name">{t.fullName}</label>
                      <input
                        id="auth-name"
                        name="name"
                        type="text"
                        placeholder={t.fullNamePlaceholder}
                        autoComplete="name"
                        required
                        minLength={2}
                      />
                    </div>

                    <div className="auth-field">
                      <label htmlFor="auth-org">
                        {t.organization}
                      </label>
                      <input
                        id="auth-org"
                        name="org"
                        type="text"
                        placeholder={t.organizationPlaceholder}
                        autoComplete="organization"
                        required
                        minLength={2}
                      />
                    </div>
                  </>
                )}

                <div className="auth-field">
                  <label htmlFor="auth-email">{t.email}</label>
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="auth-field">
                  <div className="auth-password-label">
                    <label htmlFor="auth-password">{t.password}</label>
                    {isLogin && (
                      <Link href="/forgot-password">
                        Forgot password?
                      </Link>
                    )}
                  </div>

                  <div className="auth-password-wrap">
                    <input
                      id="auth-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        isLogin
                          ? t.enterPassword
                          : t.minPassword
                      }
                      autoComplete={
                        isLogin ? "current-password" : "new-password"
                      }
                      minLength={isLogin ? undefined : 10}
                      required
                    />
                    <button
                      type="button"
                      className="auth-show-password"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? t.hide : t.show}
                    </button>
                  </div>

                  {!isLogin && (
                    <small className="auth-field-hint">
                      {t.passwordHint}
                    </small>
                  )}
                </div>

                <button
                  className="auth-submit"
                  type="submit"
                  disabled={busy}
                >
                  <span>
                    {busy
                      ? t.pleaseWait
                      : isLogin
                        ? t.signIn
                        : t.createAccount}
                  </span>
                  {!busy && <span aria-hidden="true">→</span>}
                </button>
              </form>

              {isLogin && (
                <>
                  <div className="auth-divider">
                    <span>{t.orContinue}</span>
                  </div>
                  <a
                    className="auth-google-button"
                    href={`${API}/auth/google/start`}
                  >
                    <span className="auth-google-g">G</span>
                    Continue with Google
                  </a>
                </>
              )}

              <p className="auth-switch-note">
                {isLogin
                  ? t.noAccount
                  : t.alreadyAccount}
                <button
                  type="button"
                  onClick={() => switchMode(isLogin ? "signup" : "login")}
                  disabled={busy}
                >
                  {isLogin ? "Sign up" : t.signIn}
                </button>
              </p>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.aside
          layout
          className="auth-welcome-side"
          transition={{
            layout: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
          }}
        >
          <div className="auth-orb auth-orb-one" />
          <div className="auth-orb auth-orb-two" />
          <div className="auth-orb auth-orb-three" />

          <div className="auth-scene-layer" aria-hidden="true">
            <div className="auth-scene-grid" />
            <div className="auth-scene-light-beam auth-scene-light-beam-one" />
            <div className="auth-scene-light-beam auth-scene-light-beam-two" />

            <div className="auth-scene-globe">
              <div className="auth-globe-shine" />
            </div>

            <div className="auth-scene-drone auth-scene-drone-one">
              <span className="auth-drone-body" />
              <span className="auth-drone-arm" />
              <span className="auth-drone-rotor auth-drone-rotor-left" />
              <span className="auth-drone-rotor auth-drone-rotor-right" />
              <span className="auth-drone-light" />
            </div>

            <div className="auth-scene-drone auth-scene-drone-two">
              <span className="auth-drone-body" />
              <span className="auth-drone-arm" />
              <span className="auth-drone-rotor auth-drone-rotor-left" />
              <span className="auth-drone-rotor auth-drone-rotor-right" />
              <span className="auth-drone-light" />
            </div>

            <div className="auth-scene-drone auth-scene-drone-three">
              <span className="auth-drone-body" />
              <span className="auth-drone-arm" />
              <span className="auth-drone-rotor auth-drone-rotor-left" />
              <span className="auth-drone-rotor auth-drone-rotor-right" />
              <span className="auth-drone-light" />
            </div>

            <div className="auth-scene-forklift auth-scene-forklift-one">
              <span className="auth-forklift-mast" />
              <span className="auth-forklift-load" />
              <span className="auth-forklift-cabin" />
              <span className="auth-forklift-wheel auth-forklift-wheel-one" />
              <span className="auth-forklift-wheel auth-forklift-wheel-two" />
            </div>

            <div className="auth-scene-forklift auth-scene-forklift-two">
              <span className="auth-forklift-mast" />
              <span className="auth-forklift-load" />
              <span className="auth-forklift-cabin" />
              <span className="auth-forklift-wheel auth-forklift-wheel-one" />
              <span className="auth-forklift-wheel auth-forklift-wheel-two" />
            </div>
          </div>

          <div className="auth-welcome-content">
            <div className="auth-welcome-logo">K</div>

            <span className="auth-welcome-kicker">
              KALUSMART TRADE · TIBEB AI
            </span>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${mode}-welcome`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                <h2>
                  {isLogin ? (
                    <>{t.welcome}<br /><span>{t.back}</span></>
                  ) : (
                    <>{t.join}<br /><span>{t.today}</span></>
                  )}
                </h2>
                <p>
                  {isLogin
                    ? t.businessLogin
                    : t.businessSignup}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="auth-welcome-line" />

            <button
              type="button"
              className="auth-welcome-button"
              onClick={() => switchMode(isLogin ? "signup" : "login")}
              disabled={busy}
            >
              {isLogin ? t.createAnAccount : t.backToSignIn}
              <span aria-hidden="true"> ↗</span>
            </button>

            <div className="auth-welcome-footer">
              <span className="auth-status-dot" />
              {t.smartTools}
            </div>
          </div>
        </motion.aside>
      </section>

      <p className="auth-page-footer">
        © {new Date().getFullYear()} Kalu Trading PLC · TIBEB AI
      </p>
    </main>
  );
}





