
"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDown,
  Camera,
  Copy,
  Download,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import type { Lang } from "../lib/i18n";
import { AI_TEXT } from "../lib/assistant-i18n";
import { API } from "../lib/api";
import VoiceInput from "./VoiceInput";

const AI = process.env.NEXT_PUBLIC_AI_URL || "http://localhost:8000";
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf,.docx,.xlsx,.csv,.txt,.md";

type Attachment = {
  name: string;
  mime: string;
  data: string;
  preview?: string;
};

type Message = {
  role: "user" | "assistant";
  text: string;
  atts?: { name: string; preview?: string }[];
  provider?: string;
  model?: string;
  mode?: string;
  feedback?: "like" | "dislike";
};

type Health = {
  ok: boolean;
  text: string;
} | null;

type HistoryMessage = {
  role: string;
  content: string;
};

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export default function AssistantChat({ lang }: { lang: Lang }) {
  const t = AI_TEXT[lang];

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  async function checkHealth() {
    try {
      const response = await fetch(`${AI}/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data.provider_configured) {
        setHealth({
          ok: true,
          text: `${data.provider} · ${data.model}`,
        });
      } else {
        setHealth({ ok: false, text: t.noModel });
      }
    } catch {
      setHealth({ ok: false, text: t.offline });
    }
  }

  useEffect(() => {
    void checkHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      msgs.forEach((message) => {
        message.atts?.forEach((attachment) => {
          if (attachment.preview?.startsWith("blob:")) {
            URL.revokeObjectURL(attachment.preview);
          }
        });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFiles(list: FileList | null) {
    if (!list) return;

    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        alert(t.tooLarge(file.name));
        continue;
      }

      try {
        const data = await toBase64(file);
        const preview = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;

        setAtts((current) => [
          ...current,
          {
            name: file.name,
            mime: file.type || "application/octet-stream",
            data,
            preview,
          },
        ]);
      } catch {
        alert(`Could not read file: ${file.name}`);
      }
    }

    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  async function send(
    overrideText?: string,
    historyOverride?: HistoryMessage[],
    replaceFromIndex?: number,
  ) {
    const text = (overrideText ?? input).trim();

    if ((!text && atts.length === 0) || busy) return;

    const currentAttachments = atts;

    const sent: Message = {
      role: "user",
      text,
      atts: currentAttachments.map((attachment) => ({
        name: attachment.name,
        preview: attachment.preview,
      })),
    };

    const previousMessages =
      replaceFromIndex !== undefined
        ? msgs.slice(0, replaceFromIndex)
        : msgs;

    const history =
      historyOverride ??
      previousMessages.slice(-10).map((message) => ({
        role: message.role,
        content: message.text,
      }));

    const payload = {
      message: text,
      language: lang,
      history,
      attachments: currentAttachments.map((attachment) => ({
        name: attachment.name,
        mime: attachment.mime,
        data_base64: attachment.data,
      })),
    };

    setMsgs((current) =>
      replaceFromIndex !== undefined
        ? [...current.slice(0, replaceFromIndex), sent]
        : [...current, sent],
    );

    setInput("");
    setAtts([]);
    setBusy(true);
    setMenuIndex(null);
    setEditingIndex(null);

    try {
      const response = await fetch(`${API}/assistant/ask`, {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.detail || `HTTP ${response.status}`);
      }

      setMsgs((current) => [
        ...current,
        {
          role: "assistant",
          text: data.answer ?? "The AI returned an empty response.",
          provider: data.provider,
          model: data.model,
          mode: data.mode,
        },
      ]);
    } catch (error) {
      const reason =
        error instanceof TypeError
          ? t.cannotReach
          : error instanceof Error
            ? error.message
            : "An unexpected error occurred.";

      setMsgs((current) => [
        ...current,
        {
          role: "assistant",
          text: reason,
          mode: "error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }

      throw new Error("Clipboard API unavailable");
    } catch {
      const area = document.createElement("textarea");

      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";

      document.body.appendChild(area);
      area.select();

      const copied = document.execCommand("copy");
      area.remove();

      if (!copied) {
        alert("Copy failed. Please copy the text manually.");
      }
    }
  }

  function downloadAnswer(text: string, index: number) {
    const blob = new Blob([text], {
      type: "text/markdown;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `kalusmart-trade-answer-${index + 1}.md`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function shareText(text: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "KaluSmart Trade",
          text,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    }

    await copyText(text);
    alert("Sharing is unavailable. The text was copied instead.");
  }

  function readAloud(text: string, index: number) {
    if (!("speechSynthesis" in window)) {
      alert("Text-to-speech is not supported by this browser.");
      return;
    }

    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang =
      lang === "am"
        ? "am-ET"
        : lang === "om"
          ? "om-ET"
          : lang === "ti"
            ? "ti-ET"
            : "en";

    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);

    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  }

  function setFeedback(index: number, feedback: "like" | "dislike") {
    setMsgs((current) =>
      current.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              feedback:
                message.feedback === feedback ? undefined : feedback,
            }
          : message,
      ),
    );
  }

  function editQuestion(index: number) {
    if (busy) return;

    const question = msgs[index];

    if (!question || question.role !== "user") return;

    setInput(question.text);
    setEditingIndex(index);
    setMenuIndex(null);

    // Existing attachments cannot be reconstructed from display metadata.
    setAtts([]);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setInput("");
  }

  function regenerate(index: number) {
    if (busy) return;

    const answer = msgs[index];

    if (!answer || answer.role !== "assistant") return;

    let userIndex = index - 1;

    while (userIndex >= 0 && msgs[userIndex].role !== "user") {
      userIndex--;
    }

    if (userIndex < 0) return;

    const question = msgs[userIndex];

    const previousHistory = msgs
      .slice(0, userIndex)
      .slice(-10)
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));

    void send(question.text, previousHistory, userIndex);
  }

  function scrollToLatest() {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });

    setShowScrollDown(false);
  }

  const actionButtonStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    border: "1px solid transparent",
    borderRadius: 7,
    padding: "6px 8px",
    background: "transparent",
    color: "var(--muted, #9ca3af)",
    cursor: "pointer",
    fontSize: 12,
  };

  return (
    <section className="panel assistant-panel">
      <div className="assistant-head">
        <div className="assistant-logo">
          <img
            src="/images/kalu-emblem-globe.png"
            alt="KaluSmart Trade"
            width={42}
            height={42}
            className="rounded-xl object-cover"
          />
        </div>

        <div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>

        <span
          className="online-pill"
          style={
            health && !health.ok
              ? { background: "#fdecec", color: "#b42318" }
              : undefined
          }
        >
          {health ? `● ${health.text}` : "…"}
        </span>
      </div>

      {health && !health.ok && (
        <p className="error-msg" style={{ marginTop: 12 }}>
          {t.noteLabel}
          {health.text}.{" "}
          <button className="text-link" onClick={() => void checkHealth()}>
            {t.checkAgain}
          </button>
        </p>
      )}

      <div
        ref={chatScrollRef}
        className="chat-messages"
        onScroll={() => {
          const element = chatScrollRef.current;

          if (!element) return;

          const distanceFromBottom =
            element.scrollHeight -
            element.scrollTop -
            element.clientHeight;

          setShowScrollDown(distanceFromBottom > 120);
        }}
        style={{ position: "relative" }}
      >
        {msgs.length === 0 && (
          <div className="chat-message assistant">
            <div className="chat-avatar">T</div>
            <div className="chat-bubble">{t.welcome}</div>
          </div>
        )}

        {msgs.map((message, index) => (
          <div
            key={index}
            className={`chat-message ${message.role}`}
          >
            <div className="chat-avatar">
              {message.role === "assistant" ? "T" : "KA"}
            </div>

            <div className="chat-bubble">
              {message.atts?.map((attachment, attachmentIndex) => (
                <span key={attachmentIndex} className="att-chip">
                  {attachment.preview ? (
                    <img
                      src={attachment.preview}
                      alt=""
                      className="att-thumb"
                    />
                  ) : (
                    "📄"
                  )}{" "}
                  {attachment.name}
                </span>
              ))}

              {message.text && (
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {message.text}
                </div>
              )}

              {/* Actions beneath the USER'S QUESTION */}
              {message.role === "user" && (
                <div
                  className="user-message-actions"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 3,
                    marginTop: 8,
                    borderTop: "1px solid var(--border, #273449)",
                    paddingTop: 6,
                  }}
                >
                  <button
                    type="button"
                    title="Copy question"
                    aria-label="Copy question"
                    style={actionButtonStyle}
                    onClick={() => void copyText(message.text)}
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    type="button"
                    title="Share question"
                    aria-label="Share question"
                    style={actionButtonStyle}
                    onClick={() => void shareText(message.text)}
                  >
                    <Share2 size={15} />
                  </button>

                  <button
                    type="button"
                    title="Edit question"
                    aria-label="Edit question"
                    style={actionButtonStyle}
                    disabled={busy}
                    onClick={() => editQuestion(index)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              )}

              {message.role === "assistant" &&
                message.mode !== "error" &&
                message.provider &&
                message.model && (
                  <small className="demo-note">
                    {message.provider} · {message.model}
                  </small>
                )}

              {/* Actions beneath the AI ANSWER */}
              {message.role === "assistant" && message.text && (
                <div
                  className="assistant-message-actions"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 3,
                    marginTop: 10,
                    borderTop: "1px solid var(--border, #273449)",
                    paddingTop: 7,
                  }}
                >
                  <button
                    type="button"
                    style={actionButtonStyle}
                    title="Copy answer"
                    aria-label="Copy answer"
                    onClick={() => void copyText(message.text)}
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    type="button"
                    style={{
                      ...actionButtonStyle,
                      color:
                        message.feedback === "like"
                          ? "#16a34a"
                          : actionButtonStyle.color,
                    }}
                    title="Helpful answer"
                    aria-label="Like answer"
                    aria-pressed={message.feedback === "like"}
                    onClick={() => setFeedback(index, "like")}
                  >
                    <ThumbsUp size={15} />
                  </button>

                  <button
                    type="button"
                    style={{
                      ...actionButtonStyle,
                      color:
                        message.feedback === "dislike"
                          ? "#dc2626"
                          : actionButtonStyle.color,
                    }}
                    title="Not helpful"
                    aria-label="Dislike answer"
                    aria-pressed={message.feedback === "dislike"}
                    onClick={() => setFeedback(index, "dislike")}
                  >
                    <ThumbsDown size={15} />
                  </button>

                  <button
                    type="button"
                    style={actionButtonStyle}
                    title={
                      speakingIndex === index
                        ? "Stop reading"
                        : "Read aloud"
                    }
                    aria-label={
                      speakingIndex === index
                        ? "Stop reading"
                        : "Read aloud"
                    }
                    onClick={() => readAloud(message.text, index)}
                  >
                    {speakingIndex === index ? (
                      <VolumeX size={15} />
                    ) : (
                      <Volume2 size={15} />
                    )}
                  </button>

                  <button
                    type="button"
                    style={actionButtonStyle}
                    title="Share answer"
                    aria-label="Share answer"
                    onClick={() => void shareText(message.text)}
                  >
                    <Share2 size={15} />
                  </button>

                  <button
                    type="button"
                    style={{
                      ...actionButtonStyle,
                      opacity: busy ? 0.5 : 1,
                    }}
                    title="Regenerate answer"
                    aria-label="Regenerate answer"
                    disabled={busy}
                    onClick={() => regenerate(index)}
                  >
                    <RefreshCw size={15} />
                  </button>

                  <button
                    type="button"
                    style={actionButtonStyle}
                    title="Download answer"
                    aria-label="Download answer"
                    onClick={() => downloadAnswer(message.text, index)}
                  >
                    <Download size={15} />
                  </button>

                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      style={actionButtonStyle}
                      title="More options"
                      aria-label="More options"
                      aria-expanded={menuIndex === index}
                      onClick={() =>
                        setMenuIndex(
                          menuIndex === index ? null : index,
                        )
                      }
                    >
                      <MoreHorizontal size={17} />
                    </button>

                    {menuIndex === index && (
                      <div
                        role="menu"
                        style={{
                          position: "absolute",
                          right: 0,
                          bottom: "100%",
                          zIndex: 20,
                          minWidth: 180,
                          padding: 5,
                          borderRadius: 9,
                          border: "1px solid var(--border, #334155)",
                          background: "var(--panel, #111827)",
                          boxShadow: "0 8px 24px rgba(0,0,0,.25)",
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          style={{
                            ...actionButtonStyle,
                            width: "100%",
                            justifyContent: "flex-start",
                          }}
                          onClick={() => {
                            downloadAnswer(message.text, index);
                            setMenuIndex(null);
                          }}
                        >
                          <Download size={14} />
                          Download as Markdown
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          style={{
                            ...actionButtonStyle,
                            width: "100%",
                            justifyContent: "flex-start",
                          }}
                          onClick={() => {
                            void copyText(message.text);
                            setMenuIndex(null);
                          }}
                        >
                          <Copy size={14} />
                          Copy answer
                        </button>
                      </div>
                    )}
                  </div>

                  {message.feedback && (
                    <small
                      style={{
                        color:
                          message.feedback === "like"
                            ? "#16a34a"
                            : "#dc2626",
                      }}
                    >
                      {message.feedback === "like"
                        ? "Thanks for your feedback"
                        : "Feedback noted"}
                    </small>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="chat-message assistant">
            <div className="chat-avatar">T</div>
            <div className="chat-bubble">{t.thinking}</div>
          </div>
        )}

        {/* Floating down-arrow: scroll to the latest message */}
        {showScrollDown && (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Scroll to latest message"
            title="Go to latest message"
            style={{
              position: "sticky",
              bottom: 10,
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 42,
              height: 42,
              borderRadius: "50%",
              border: "1px solid var(--border, #334155)",
              background: "var(--panel, #111827)",
              color: "var(--foreground, #fff)",
              boxShadow: "0 3px 12px rgba(0,0,0,.25)",
              cursor: "pointer",
              zIndex: 10,
            }}
          >
            <ArrowDown size={20} />
          </button>
        )}

        <div ref={endRef} />
      </div>

      {msgs.length === 0 && (
        <div className="suggestion-row">
          {t.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setInput(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {editingIndex !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 0",
          }}
        >
          <small>Editing your question</small>
          <button
            type="button"
            onClick={cancelEdit}
            style={actionButtonStyle}
          >
            <X size={14} />
            Cancel edit
          </button>
        </div>
      )}

      {atts.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {atts.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="att-chip"
            >
              {attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt=""
                  className="att-thumb"
                />
              ) : (
                "📄"
              )}{" "}
              {attachment.name}

              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => {
                  if (attachment.preview) {
                    URL.revokeObjectURL(attachment.preview);
                  }

                  setAtts((current) =>
                    current.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  );
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat-input">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => void addFiles(event.target.files)}
        />

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => void addFiles(event.target.files)}
        />

        <button
          type="button"
          className="icon-button"
          aria-label={t.attach}
          title={t.attach}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={16} />
        </button>

        <button
          type="button"
          className="icon-button"
          aria-label={t.camera}
          title={t.camera}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={16} />
        </button>

        <VoiceInput
          lang={lang}
          disabled={busy}
          onTranscript={(text) => setInput((current) => (current ? `${current} ${text}` : text))}
          labels={{
            start: "Speak your question",
            stop: "Stop listening",
            unsupported: "Voice input is not supported by this browser.",
            denied: "Microphone permission was denied.",
            error: "Voice input failed. Try again or type your question.",
            notice: "Listening… tap to stop",
          }}
        />

        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={t.placeholder}
          aria-label={t.question}
        />

        <button
          type="button"
          className="button primary"
          onClick={() => void send()}
          disabled={busy || (!input.trim() && atts.length === 0)}
        >
          <Send size={16} />
          {t.send}
        </button>
      </div>

      <small className="demo-note">{t.disclaimer}</small>
    </section>
  );
}
