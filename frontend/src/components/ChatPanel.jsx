// frontend/src/components/ChatPanel.jsx
import { useEffect, useRef, useState } from "react";
import MessageRenderer from "./MessageRenderer.jsx";

export default function ChatPanel({
  conversation,
  messages,
  loadingMessages,
  onSendText,
  onSendMedia,
  onChangeStatus
}) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const messagesRef = useRef(null);

  // Auto-scroll para última mensagem
  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    try {
      setIsSending(true);
      await onSendText(text);
      setInput("");
    } catch (err) {
      console.error("Erro ao enviar mensagem de texto:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleAttach = async (type) => {
    setShowAttachMenu(false);

    const mediaUrl = window.prompt(
      "Cole a URL pública da mídia para enviar:"
    );
    if (!mediaUrl) return;

    const caption = window.prompt("Legenda (opcional):") || undefined;

    try {
      await onSendMedia({
        type,
        mediaUrl,
        caption
      });
    } catch (err) {
      console.error("Erro ao enviar mídia:", err);
    }
  };

  const handleCloseConversation = () => {
    if (!conversation) return;
    const confirmClose = window.confirm(
      "Deseja encerrar este atendimento? A conversa irá para o histórico."
    );
    if (!confirmClose) return;
    onChangeStatus(conversation.id, "closed");
  };

  if (!conversation) return null;

  const status = conversation.status || "open";

  return (
    <div className="chat-panel">
      {/* HEADER */}
      <header className="chat-header chat-panel-header">
        <div className="chat-panel-header-left">
          <div className="chat-panel-avatar">
            {conversation.contactName
              ? conversation.contactName.charAt(0).toUpperCase()
              : "U"}
          </div>
          <div>
            <div className="chat-header-name">
              {conversation.contactName || conversation.phone || "Contato"}
            </div>
            <div className="chat-header-phone">{conversation.phone}</div>
          </div>
        </div>

        <div className="chat-panel-header-right">
          <div className="chat-panel-status-wrapper">
            <span>Status:</span>
            <select
              className="chat-status-select"
              value={status}
              onChange={(e) =>
                onChangeStatus(conversation.id, e.target.value)
              }
            >
              <option value="open">Aberta</option>
              <option value="closed">Encerrada</option>
            </select>
          </div>

          {status === "open" && (
            <button
              type="button"
              onClick={handleCloseConversation}
              className="chat-panel-close-btn"
            >
              Encerrar atendimento
            </button>
          )}
        </div>
      </header>

      {/* MENSAGENS */}
      <div ref={messagesRef} className="chat-messages">
        {loadingMessages && (
          <div className="chat-messages-empty">
            Carregando mensagens...
          </div>
        )}

        {!loadingMessages && messages.length === 0 && (
          <div className="chat-messages-empty">
            Nenhuma mensagem nesta conversa ainda.
          </div>
        )}

        {messages.map((msg) => {
          const isOutbound = msg.direction === "out";
          const bubbleClass = isOutbound
            ? "message-bubble-out"
            : "message-bubble-in";

          return (
            <div
              key={msg.id}
              className={
                "message-row " + (isOutbound ? "message-row-out" : "message-row-in")
              }
            >
              <div className={bubbleClass}>
                <MessageRenderer message={msg} outbound={isOutbound} />
                {msg.timestamp && (
                  <div className="message-timestamp">
                    {new Date(msg.timestamp).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* COMPOSER */}
      <form className="chat-composer" onSubmit={handleSubmit}>
        <div className="chat-composer-left">
          <div className="chat-composer-attach-wrapper">
            <button
              type="button"
              onClick={() => setShowAttachMenu((v) => !v)}
              className="chat-composer-icon-btn"
              title="Anexar mídia"
            >
              📎
            </button>

            {showAttachMenu && (
              <div className="attach-menu">
                <button
                  type="button"
                  onClick={() => handleAttach("image")}
                >
                  Imagem
                </button>
                <button
                  type="button"
                  onClick={() => handleAttach("video")}
                >
                  Vídeo
                </button>
                <button
                  type="button"
                  onClick={() => handleAttach("audio")}
                >
                  Áudio
                </button>
                <button
                  type="button"
                  onClick={() => handleAttach("document")}
                >
                  Documento / PDF
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="chat-composer-center">
          <textarea
            className="chat-composer-textarea"
            rows={1}
            placeholder="Digite uma mensagem..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <div className="chat-composer-hint">
            Enter para enviar · Shift + Enter para quebrar linha
          </div>
        </div>

        <div className="chat-composer-right">
          <button
            type="button"
            className="chat-composer-icon-btn"
            title="Gravar áudio (em breve)"
            onClick={() =>
              alert(
                "Gravação de áudio nativa ainda será implementada. Use o botão de anexo para enviar arquivos de áudio."
              )
            }
          >
            🎙️
          </button>

          <button
            type="submit"
            disabled={!input.trim() || isSending || status === "closed"}
            className={
              "chat-composer-send" +
              (input.trim() && !isSending && status === "open"
                ? " chat-composer-send--active"
                : "")
            }
          >
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </form>
    </div>
  );
}

