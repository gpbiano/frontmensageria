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

  if (channel === "chatbot" || channel === "bot") return "bot";
  if (from === "bot" || msg?.isBot || msg?.fromBot) return "bot";

  if (from === "visitor" || from === "client" || from === "customer" || from === "user") return "client";
  if (from === "agent" || from === "attendant" || from === "human") return "agent";

  if (dir === "in" || dir === "inbound") return "client";
  if (dir === "out" || dir === "outbound") return "agent";

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

function inferMediaType(file) {
  const t = (file?.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "document";
  return "file";
}

export default function ChatPanel({
  conversation,
  messages,
  loadingMessages,
  onSendText,
  onSendMedia, // (opcional) {type, mediaUrl, caption}
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
    conversation?.contact?.name ||
    conversation?.phone ||
    conversation?.contactPhone ||
    "Contato sem nome";

  const headerPhone =
    conversation?.phone ||
    conversation?.contactPhone ||
    conversation?.contact?.phone ||
    "—";

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
    if (!text || !conversation || isClosed || sending) return;

    setSending(true);
    Promise.resolve(onSendText?.(text))
      .finally(() => {
        setSending(false);
        setDraft("");
        setShowEmoji(false);
        textareaRef.current?.focus();
      });
  }

  function handleEmojiClick(emoji) {
    setDraft((prev) => prev + emoji);
    textareaRef.current?.focus();
  }

  function handleStatusChange(e) {
    const newStatus = e.target.value;
    if (!conversation || !onChangeStatus) return;
    if (conversation.status === newStatus) return;

    // ✅ regra: não reabre conversa (histórico é outra tela)
    if (newStatus === "open") return;

    onChangeStatus(conversation.id, newStatus);
  }

  function handleCloseClick() {
    if (!conversation || !onChangeStatus) return;
    if (conversation.status === "closed") return;
    onChangeStatus(conversation.id, "closed");
  }

  function handleKeyDown(e) {
    // Enter envia, Shift+Enter quebra linha
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // dispara submit manualmente
      handleSubmit(e);
    }
  }

  function openFilePicker() {
    if (isClosed) return;
    fileRef.current?.click();
  }

  async function handleFilePicked(e) {
    try {
      const file = e.target.files?.[0];
      if (!file || isClosed) return;

      // limpa input pra permitir enviar o mesmo arquivo duas vezes
      e.target.value = "";

      // Se você ainda não implementou upload, não quebra:
      if (!onSendMedia) {
        alert("Envio de anexo ainda não está habilitado nesta versão.");
        return;
      }

      // ⚠️ Aqui existem duas opções:
      // A) Seu onSendMedia já aceita { file } e faz upload internamente
      // B) Seu onSendMedia espera { type, mediaUrl, caption } (como você comentou)
      //
      // Vou usar a opção B (mediaUrl), assumindo que você já tem um upload em algum lugar.
      // Se ainda não tiver, me manda sua rota de upload que eu encaixo.

      // Placeholder seguro: criar um ObjectURL (funciona no frontend, mas NÃO serve pro WhatsApp)
      // Ideal: você trocar por upload real e usar a URL pública retornada.
      const tempUrl = URL.createObjectURL(file);

      const type = inferMediaType(file);
      const caption = draft.trim() || "";

      setSending(true);
      await onSendMedia({ type, mediaUrl: tempUrl, caption });
      setDraft("");
      setShowEmoji(false);
      textareaRef.current?.focus();
    } catch (err) {
      console.error("Erro ao enviar anexo:", err);
    } finally {
      setSending(false);
    }
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
              {/* ✅ não expõe reabertura */}
              {conversation?.status !== "closed" ? (
                <option value="open">Aberta</option>
              ) : null}
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

        {!loadingMessages &&
          (!normalizedMessages || normalizedMessages.length === 0) && (
            <div className="chat-history-empty">
              Nenhuma mensagem nesta conversa ainda.
            </div>
          )}

        {normalizedMessages.map((msg) => {
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

      {/* COMPOSER */}
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

        {/* Barra esquerda: emoji + anexo */}
        <div className="chat-composer-actions">
          <button
            type="button"
            className="chat-composer-emoji-btn"
            onClick={() => !isClosed && setShowEmoji((v) => !v)}
            disabled={isClosed}
            title="Inserir emoji"
          >
            😊
          </button>

          <button
            type="button"
            className="chat-composer-attach-btn"
            onClick={openFilePicker}
            disabled={isClosed}
            title="Enviar anexo"
          >
            📎
          </button>

          <input
            ref={fileRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFilePicked}
            accept="image/*,video/*,audio/*,application/pdf"
          />
        </div>

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
          onKeyDown={handleKeyDown}
          disabled={isClosed}
          rows={1}
        />

        <button
          type="submit"
          className="chat-composer-send"
          disabled={isClosed || sending || !draft.trim()}
          title="Enviar"
        >
          <span style={{ marginRight: 8 }}>📨</span>
          Enviar
        </button>
      </form>
    </div>
  );
}
