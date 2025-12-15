// frontend/src/components/ChatPanel.jsx
// frontend/src/components/ChatPanel.jsx
import "../styles/chat-composer.css";

import { useEffect, useMemo, useRef, useState } from "react";

const EMOJI_PALETTE = [
  "😀","😁","😂","🤣","😊","😍","😘","😎",
  "🙂","😉","🤩","🥳","😇","😅","😢","😭",
  "😡","👍","👎","🙏","👏","💪","✨","🔥",
  "❤️","💚","💙","💛","🧡","🤍","🤝","✅"
];

// ======================================================
// HELPERS – IDENTIDADE / TEXTO / DATA
// ======================================================
function inferSender(msg) {
  const from = String(msg?.from ?? msg?.sender ?? msg?.role ?? "").toLowerCase();
  const dir = String(msg?.direction ?? msg?.dir ?? "").toLowerCase();
  const channel = String(msg?.channel ?? msg?.source ?? "").toLowerCase();

  if (from === "bot" || msg?.isBot || msg?.fromBot || channel === "bot") return "bot";
  if (from === "agent" || from === "human" || from === "attendant") return "agent";
  if (from === "system" || msg?.isSystem) return "system";

  if (dir === "in") return "client";
  if (dir === "out") return "agent";

  return "client";
}

function formatMessageText(msg) {
  return (
    msg?.text?.body ??
    msg?.text ??
    msg?.body ??
    msg?.message ??
    msg?.content ??
    msg?.payload?.text ??
    msg?.event ??
    ""
  );
}

function formatTimestamp(msg) {
  const raw = msg?.createdAt ?? msg?.timestamp ?? msg?.sentAt ?? null;
  if (!raw) return "";
  const d = typeof raw === "number" ? new Date(raw) : new Date(raw);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function inferMediaType(file) {
  const t = (file?.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "document";
  return "file";
}

// ======================================================
// COMPONENT
// ======================================================
export default function ChatPanel({
  conversation,
  messages,
  loadingMessages,
  onSendText,
  onSendMedia,
  onChangeStatus
}) {
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);

  const isClosed = conversation?.status === "closed";

  const headerName =
    conversation?.contactName ||
    conversation?.phone ||
    "Contato";

  const normalizedMessages = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    return arr.map((m, idx) => ({
      __key: m?.id || `${conversation?.id}_${idx}`,
      ...m
    }));
  }, [messages, conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [normalizedMessages, loadingMessages]);

  useEffect(() => {
    setDraft("");
    setShowEmoji(false);
  }, [conversation?.id]);

  // ======================================================
  // SEND
  // ======================================================
  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isClosed || sending) return;

    setSending(true);
    try {
      await onSendText?.(text);
      setDraft("");
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  }

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || isClosed || !onSendMedia) return;

    const type = inferMediaType(file);
    const mediaUrl = URL.createObjectURL(file);
    const caption = draft.trim();

    setSending(true);
    try {
      await onSendMedia({ type, mediaUrl, caption });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  // ======================================================
  // RENDER
  // ======================================================
  let humanMarkerShown = false;

  return (
    <div className="chat-panel">
      {/* HEADER */}
      <header className="chat-panel-header">
        <div>
          <strong>{headerName}</strong>
        </div>

        <div>
          {conversation?.status !== "closed" && (
            <button onClick={() => onChangeStatus?.(conversation.id, "closed")}>
              Encerrar
            </button>
          )}
        </div>
      </header>

      {/* MESSAGES */}
      <div className="chat-messages">
        {loadingMessages && <div className="chat-history-empty">Carregando…</div>}

        {!loadingMessages && normalizedMessages.length === 0 && (
          <div className="chat-history-empty">Nenhuma mensagem ainda.</div>
        )}

        {normalizedMessages.map((msg) => {
          const sender = inferSender(msg);
          const text = formatMessageText(msg);
          const ts = formatTimestamp(msg);

          const isBot = sender === "bot";
          const isAgent = sender === "agent";
          const isClient = sender === "client";
          const isSystem = sender === "system";

          const showHumanMarker = isAgent && !humanMarkerShown;
          if (showHumanMarker) humanMarkerShown = true;

          return (
            <div key={msg.__key}>
              {/* 🔔 MARCADOR HUMANO */}
              {showHumanMarker && (
                <div className="chat-audit-marker human">
                  👤 Atendimento humano iniciado
                </div>
              )}

              {/* 🔔 SISTEMA */}
              {isSystem && (
                <div className="chat-audit-marker system">
                  {text}
                </div>
              )}

              {/* 💬 MENSAGEM */}
              {!isSystem && (
                <div
                  className={
                    "message-row " +
                    (isClient ? "message-row-in" : "message-row-out")
                  }
                >
                  <div className="message-bubble">
                    <div className="message-author">
                      {isBot && "🤖 Bot"}
                      {isAgent && "👤 Humano"}
                      {isClient && "Cliente"}
                    </div>

                    <div className="chat-message-text">
                      {text || "[mensagem sem texto]"}
                    </div>

                    <div className="message-timestamp">
                      {ts}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* COMPOSER */}
      <form className="chat-composer" onSubmit={handleSubmit}>
        {!isClosed && showEmoji && (
          <div className="chat-emoji-picker">
            {EMOJI_PALETTE.map((e) => (
              <button key={e} type="button" onClick={() => setDraft(d => d + e)}>
                {e}
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={() => !isClosed && setShowEmoji(v => !v)}>
          😊
        </button>

        <button type="button" onClick={() => fileRef.current?.click()}>
          📎
        </button>

        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={handleFilePicked}
          accept="image/*,video/*,audio/*,application/pdf"
        />

        <textarea
          ref={textareaRef}
          value={draft}
          disabled={isClosed}
          placeholder={
            isClosed
              ? "Atendimento encerrado."
              : "Digite uma mensagem..."
          }
          onChange={(e) => setDraft(e.target.value)}
        />

        <button type="submit" disabled={isClosed || sending || !draft.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
