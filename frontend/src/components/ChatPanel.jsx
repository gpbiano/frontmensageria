// frontend/src/components/ChatPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const EMOJI_PALETTE = [
  "😀","😁","😂","🤣","😊","😍","😘","😎",
  "🙂","😉","🤩","🥳","😇","😅","😢","😭",
  "😡","👍","👎","🙏","👏","💪","✨","🔥",
  "❤️","💚","💙","💛","🧡","🤍","🤝","✅"
];

function inferSender(msg) {
  const from = (msg?.from ?? msg?.sender ?? msg?.role ?? "").toString().toLowerCase();
  const dir = (msg?.direction ?? msg?.dir ?? "").toString().toLowerCase();
  const channel = (msg?.channel ?? msg?.origin ?? msg?.source ?? "").toString().toLowerCase();

  // ✅ prioridade máxima: se o backend separar por "chatbot"
  if (channel === "chatbot" || channel === "bot") return "bot";

  // ✅ flags clássicas do bot
  if (from === "bot" || msg?.isBot || msg?.fromBot) return "bot";

  // ✅ WebChat
  if (from === "visitor" || from === "client" || from === "customer" || from === "user") return "client";
  if (from === "agent" || from === "attendant" || from === "human") return "agent";

  // ✅ direction in/out
  if (dir === "in" || dir === "inbound") return "client";
  if (dir === "out" || dir === "outbound") return "agent";

  // ✅ WhatsApp webhook
  if (typeof msg?.fromMe === "boolean") return msg.fromMe ? "agent" : "client";

  return "client";
}


function formatMessageText(msg) {
  if (msg?.type === "system") {
    return (
      msg?.textPublic ||
      msg?.text ||
      msg?.message ||
      msg?.event ||
      "Atualização do atendimento"
    );
  }

  return (
    msg?.text?.body ??
    msg?.text ??
    msg?.body ??
    msg?.message ??
    msg?.content ??
    msg?.payload?.text ??
    ""
  );
}

function formatTimestamp(msg) {
  const raw = msg?.timestamp ?? msg?.createdAt ?? msg?.sentAt ?? msg?.updatedAt ?? null;
  if (!raw) return "";

  let date;
  if (typeof raw === "number") date = raw > 10_000_000_000 ? new Date(raw) : new Date(raw * 1000);
  else date = new Date(raw);

  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function ChatPanel({
  conversation,
  messages,
  loadingMessages,
  onSendText,
  onSendMedia, // (ainda não usado)
  onChangeStatus
}) {
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const isClosed = conversation?.status === "closed";

  const headerName =
    conversation?.contactName ||
    conversation?.contact?.name ||
    conversation?.phone ||
    conversation?.contactPhone ||
    "Contato sem nome";

  const headerPhone =
    conversation?.phone ||
    conversation?.contactPhone ||
    conversation?.contact?.phone ||
    "—";

  // evita key instável e evita rerender “doido”
  const normalizedMessages = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    return arr.map((m, idx) => ({
      __key:
        m?.id ||
        m?._id ||
        m?.messageId ||
        m?.waMessageId ||
        m?.timestamp ||
        `${conversation?.id || "c"}_${idx}_${m?.createdAt || ""}`,
      ...m
    }));
  }, [messages, conversation?.id]);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [normalizedMessages, loadingMessages]);

  useEffect(() => {
    setDraft("");
    setShowEmoji(false);
  }, [conversation?.id]);

  function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !conversation || isClosed) return;
    onSendText?.(text);
    setDraft("");
    setShowEmoji(false);
  }

  function handleEmojiClick(emoji) {
    setDraft((prev) => prev + emoji);
    textareaRef.current?.focus();
  }

  function handleStatusChange(e) {
    const newStatus = e.target.value;
    if (!conversation || !onChangeStatus) return;
    if (conversation.status === newStatus) return;
    onChangeStatus(conversation.id, newStatus);
  }

  function handleCloseClick() {
    if (!conversation || !onChangeStatus) return;
    if (conversation.status === "closed") return;
    onChangeStatus(conversation.id, "closed");
  }

  return (
    <div className="chat-panel">
      <header className="chat-panel-header">
        <div className="chat-panel-header-left">
          <div className="chat-panel-avatar">
            {String(headerName).charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="chat-header-name">{headerName}</div>
            <div className="chat-header-phone">{headerPhone}</div>
          </div>
        </div>

        <div className="chat-panel-header-right">
          <div className="chat-panel-status-wrapper">
            <span style={{ fontSize: 12, marginRight: 6 }}>Status:</span>
            <select
              value={conversation?.status || "open"}
              onChange={handleStatusChange}
              disabled={!conversation}
              style={{
                background: "transparent",
                border: "none",
                color: "#e5e7eb",
                fontSize: 12,
                outline: "none",
                cursor: conversation ? "pointer" : "default"
              }}
            >
              <option value="open">Aberta</option>
              <option value="closed">Encerrada</option>
            </select>
          </div>

          {conversation?.status !== "closed" && (
            <button
              type="button"
              className="chat-panel-close-btn"
              onClick={handleCloseClick}
            >
              Encerrar atendimento
            </button>
          )}
        </div>
      </header>

      <div className="chat-messages">
        {loadingMessages && (
          <div className="chat-history-empty">Carregando mensagens...</div>
        )}

        {!loadingMessages && (!normalizedMessages || normalizedMessages.length === 0) && (
          <div className="chat-history-empty">
            Nenhuma mensagem nesta conversa ainda.
          </div>
        )}

        {normalizedMessages.map((msg) => {
          // ✅ Mensagens de sistema (centralizadas)
          if (msg?.type === "system") {
            const text = formatMessageText(msg);
            const ts = formatTimestamp(msg);
            return (
              <div
                key={msg.__key}
                className="message-row"
                style={{ justifyContent: "center" }}
              >
                <div
                  style={{
                    maxWidth: 560,
                    background: "rgba(148,163,184,0.12)",
                    border: "1px solid rgba(148,163,184,0.25)",
                    color: "#e5e7eb",
                    padding: "10px 12px",
                    borderRadius: 14,
                    textAlign: "center"
                  }}
                >
                  <div className="chat-message-text">{text}</div>
                  {ts && (
                    <div
                      className="message-timestamp"
                      style={{ opacity: 0.7, marginTop: 6 }}
                    >
                      {ts}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          const sender = inferSender(msg); // client | agent | bot
          const isInbound = sender === "client";
          const isBot = sender === "bot";

          const rowClass = isInbound
            ? "message-row message-row-in"
            : "message-row message-row-out";
          const bubbleClass = isInbound
            ? "message-bubble-in"
            : "message-bubble-out";

          const text = formatMessageText(msg);
          const ts = formatTimestamp(msg);

          // ✅ Label correto
          const senderLabel = isInbound
            ? (conversation?.contactName || conversation?.phone || "Cliente")
            : (isBot
                ? "🤖 Bot"
                : `👤 ${msg.senderName || msg.byName || msg.agentName || "Atendente"}`);

          return (
            <div key={msg.__key} className={rowClass}>
              <div className={bubbleClass}>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(229,231,235,0.7)",
                    marginBottom: 6
                  }}
                >
                  {senderLabel}
                </div>

                <div className="chat-message-text">
                  {text || "[mensagem sem texto]"}
                </div>

                <div className="message-timestamp">
                  {ts}
                  {isBot ? " · Bot" : (isInbound ? " · Cliente" : " · Humano")}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        {showEmoji && !isClosed && (
          <div className="chat-emoji-picker">
            {EMOJI_PALETTE.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="chat-emoji-item"
                onClick={() => handleEmojiClick(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="chat-composer-emoji-btn"
          onClick={() => !isClosed && setShowEmoji((v) => !v)}
          disabled={isClosed}
          title="Inserir emoji"
        >
          😊
        </button>

        <textarea
          ref={textareaRef}
          className="chat-composer-textarea"
          placeholder={
            isClosed
              ? "Atendimento encerrado. Não é possível enviar novas mensagens."
              : "Digite uma mensagem..."
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isClosed}
          rows={1}
        />

        <button
          type="submit"
          className="chat-composer-send"
          disabled={isClosed || !draft.trim()}
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

