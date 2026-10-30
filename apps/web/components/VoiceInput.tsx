"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

/**
 * Speech-to-text using the browser's built-in recogniser (Web Speech API). No audio is recorded or uploaded
 * by this app: listening starts only after the user presses the button, and the transcript is returned to the
 * text box for review before anything is sent. Browsers send recognition audio to their own speech service;
 * this is shown to the user below the button.
 */

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const LANG_TAG: Record<string, string> = { en: "en-US", am: "am-ET", om: "om-ET", ti: "ti-ET" };

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function VoiceInput({
  lang,
  onTranscript,
  disabled,
  labels,
}: {
  lang: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
  labels: { start: string; stop: string; unsupported: string; denied: string; error: string; notice: string };
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recRef = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recRef.current?.stop();
  }, []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setMessage(labels.unsupported);
      return;
    }
    setMessage("");
    const rec = new Ctor();
    rec.lang = LANG_TAG[lang] ?? "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>)
        .map((r: any) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      // The transcript goes into the text box only; the user reviews and presses Send.
      if (text) onTranscript(text.slice(0, 4000));
    };
    rec.onerror = (e: any) => {
      const code = e?.error;
      setMessage(code === "not-allowed" || code === "service-not-allowed" ? labels.denied : labels.error);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setMessage(labels.error);
    }
  };

  if (!supported) {
    return <small className="demo-note">{labels.unsupported}</small>;
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="icon-button"
        aria-label={listening ? labels.stop : labels.start}
        aria-pressed={listening}
        title={listening ? labels.stop : labels.start}
        onClick={toggle}
        disabled={disabled}
      >
        {listening ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
      {listening && <small role="status">{labels.notice}</small>}
      {message && <small role="alert">{message}</small>}
    </span>
  );
}
