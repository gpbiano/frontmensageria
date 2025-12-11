// frontend/src/components/ChatPanel.jsx
import { useEffect, useRef, useState } from "react";

// Paleta simples de emojis para o atendente
const EMOJI_PALETTE = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🙂", "😉", "🤩", "🥳", "😇", "😅", "😢", "😭",
  "😡", "👍", "👎", "🙏", "👏", "💪", "✨", "🔥",
  "❤️", "💚", "💙", "💛", "🧡", "🤍", "🤝", "✅"
];

/**
 * Painel principal do chat (coluna central)
 *
 * Props:
 * - conversation: objeto da conversa selecionada
 * - messages: array de mensagens
 * - loadingMessages: boolean
 * - onSendText(text: string)
 * - onSendMedia({ type, mediaUrl, caption })
 * - onChangeStatus(conversationId, newStatus)
 */
export default function ChatPanel({
  conversation,
  messages,
  loadingMessages,
  onSendText,
  onSendMedia, // reservado pro futuro
  onChangeStatus
}) {
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const isClosed = conversation?.status === "closed";

  // Auto-scroll para a última mensagem
  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loadingMessages]);

  // Ao trocar de conversa: limpa rascunho e fecha emojis
  useEffect(() => {
    setDraft("");
    setShowEmoji(false);
  }, [conversation?.id]);

  // Helpers de formatação -------------------------
  function formatMessageText(msg) {
    return (
      msg?.text?.body ??
      msg?.text ??
      msg?.body ??
      msg?.message ??
      msg?.content ??
      ""
    );
  }

  function formatTimestamp(msg) {
    const raw =
      msg.timestamp ??
      msg.createdAt ??
      msg.sentAt ??
      msg.updatedAt ??
      null;

    if (!raw) return "";

    let date;
    if (typeof raw === "number") {
      // segundos vs ms
      date = raw > 10_000_000_000 ? new Date(raw) : new Date(raw * 1000);
    } else {
      date = new Date(raw);
    }

    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  }

  // Ações ----------------------------------------
  function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !conversation || isClosed) return;
    if (onSendText) {
      onSendText(text);
    }
    setDraft("");
    setShowEmoji(false);
  }

  function handleEmojiClick(emoji) {
    setDraft((prev) => prev + emoji);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
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

  const headerName =
    conversation?.contactName ||
    conversation?.phone ||
    "Contato sem nome";
  const headerPhone = conversation?.phone || "—";

  // Render ---------------------------------------
  return (
    <div className="chat-panel">
      {/* HEADER DO CHAT */}
      <header className="chat-panel-header">
        <div className="chat-panel-header-left">
          <div className="chat-panel-avatar">
            {headerName.toString().charAt(0).toUpperCase()}
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
                cursor: "pointer"
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

      {/* LISTA DE MENSAGENS */}
      <div className="chat-messages">
        {loadingMessages && (
          <div className="chat-history-empty">
            Carregando mensagens...
          </div>
        )}

        {!loadingMessages && (!messages || messages.length === 0) && (
          <div className="chat-history-empty">
            Nenhuma mensagem nesta conversa ainda.
          </div>
        )}

        {messages?.map((msg) => {
          const key = msg.id || msg._id || msg.timestamp;
          const isInbound = msg.direction === "in";
          const isBot = msg.isBot || msg.fromBot;

          const rowClass = isInbound
            ? "message-row message-row-in"
            : "message-row message-row-out";
          const bubbleClass = isInbound
            ? "message-bubble-in"
            : "message-bubble-out";

          const text = formatMessageText(msg);
          const ts = formatTimestamp(msg);

          return (
            <div key={key} className={rowClass}>
              <div className={bubbleClass}>
                <div className="chat-message-text">
                  {text || "[mensagem sem texto]"}
                </div>
                <div className="message-timestamp">
                  {ts}
                  {isBot ? " · Bot" : " · Humano"}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* COMPOSER / INPUT */}
      <form className="chat-composer" onSubmit={handleSubmit}>
        {/* Emoji picker flutuando acima do input */}
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

        {/* Botão de emoji */}
        <button
          type="button"
          className="chat-composer-emoji-btn"
          onClick={() => !isClosed && setShowEmoji((v) => !v)}
          disabled={isClosed}
          title="Inserir emoji"
        >
          😊
        </button>

        {/* Textarea */}
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

        {/* Botão enviar */}
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
