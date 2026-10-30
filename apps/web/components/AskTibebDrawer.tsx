"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import AssistantChat from "./AssistantChat";
import type { Lang } from "../lib/i18n";
import { assistantTopics } from "../lib/assistant-capabilities";

const TEXT = {
  en: { title: "Ask TIBEB AI", reset: "New conversation", close: "Close Ask TIBEB AI", can: "You can ask about" },
  am: { title: "TIBEB AIን ይጠይቁ", reset: "አዲስ ውይይት", close: "TIBEB AIን ዝጋ", can: "መጠየቅ የሚችሉት" },
  om: { title: "TIBEB AI gaafadhu", reset: "Haasa'a haaraa", close: "TIBEB AI cufi", can: "Waa'ee kana gaafachuu dandeessa" },
  ti: { title: "TIBEB AI ሕተት", reset: "ሓድሽ ዝርርብ", close: "TIBEB AI ዕጸው", can: "ብዛዕባ እዚ ክትሓትት ትኽእል" },
} satisfies Record<Lang, { title: string; reset: string; close: string; can: string }>;

type Props = {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  role?: string | null;
};

/**
 * The one global Ask TIBEB AI panel. It sits beside the current page, so the page and the user's place in it
 * stay as they were. The chat stays mounted while the panel is closed, so the conversation survives closing.
 * "New conversation" remounts the chat, which clears its in-memory history.
 */
export default function AskTibebDrawer({ open, onClose, lang, role }: Props) {
  const [chatKey, setChatKey] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const text = TEXT[lang];
  const topics = assistantTopics(role);

  // Focus moves into the panel on open and returns to the button that opened it on close.
  useEffect(() => {
    if (open && !wasOpen.current) {
      trigger.current = document.activeElement as HTMLElement | null;
      panelRef.current?.focus();
    }
    if (!open && wasOpen.current) trigger.current?.focus?.();
    wasOpen.current = open;
  }, [open]);

  // Escape closes the panel from anywhere on the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby="ask-tibeb-title"
      className="ask-drawer"
      hidden={!open}
    >
      <header className="ask-drawer-head">
        <div className="ask-drawer-title">
          <h2 id="ask-tibeb-title">{text.title}</h2>
          {topics.length > 0 && (
            <p className="ask-drawer-sub">
              {text.can}: {topics.join(", ")}
            </p>
          )}
        </div>
        <div className="ask-drawer-actions">
          <button type="button" className="icon-button" aria-label={text.reset} title={text.reset} onClick={() => setChatKey((k) => k + 1)}>
            <RefreshCw size={16} />
          </button>
          <button type="button" className="icon-button" aria-label={text.close} title={text.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="ask-drawer-body">
        <AssistantChat key={chatKey} lang={lang} />
      </div>
    </section>
  );
}
