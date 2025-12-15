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
  if (t === "image/webp") return "sticker";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "document";
  return "file";
}

// ======================================================
// HELPERS – DETECTAR E EXTRAIR MÍDIA DO MSG
// ======================================================
function getMsgType(msg) {
  const t = String(msg?.type || "").toLowerCase();
  if (t) return t;

  if (msg?.payload?.location || msg?.location) return "location";
  if (msg?.payload?.sticker || msg?.sticker) return "sticker";
  if (msg?.payload?.audio || msg?.audio) return "audio";
  if (msg?.payload?.image || msg?.image) return "image";
  if (msg?.payload?.video || msg?.video) return "video";
  if (msg?.payload?.document || msg?.document) return "document";

  const mime =
    msg?.payload?.mimeType ||
    msg?.payload?.audio?.mimeType ||
    msg?.payload?.image?.mimeType ||
    msg?.payload?.video?.mimeType ||
    msg?.payload?.document?.mimeType ||
    msg?.mimeType ||
    "";
  if (String(mime).toLowerCase() === "image/webp") return "sticker";

  return "text";
}

function getAnyLink(msg) {
  return (
    msg?.mediaUrl ||
    msg?.url ||
    msg?.link ||
    msg?.payload?.mediaUrl ||
    msg?.payload?.link ||
    msg?.payload?.url ||
    msg?.payload?.audioUrl ||
    msg?.payload?.imageUrl ||
    msg?.payload?.videoUrl ||
    msg?.payload?.documentUrl ||
    msg?.payload?.audio?.link ||
    msg?.payload?.audio?.url ||
    msg?.payload?.image?.link ||
    msg?.payload?.image?.url ||
    msg?.payload?.video?.link ||
    msg?.payload?.video?.url ||
    msg?.payload?.document?.link ||
    msg?.payload?.document?.url ||
    msg?.payload?.sticker?.link ||
    msg?.payload?.sticker?.url ||
    null
  );
}

function getLocation(msg) {
  const loc =
    msg?.payload?.location ||
    msg?.location ||
    msg?.payload?.loc ||
    null;

  if (!loc) return null;

  const lat = Number(loc.latitude ?? loc.lat);
  const lng = Number(loc.longitude ?? loc.lng ?? loc.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    latitude: lat,
    longitude: lng,
    name: loc.name,
    address: loc.address
  };
}

function mapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
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

  // ✅ gravação
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

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
  // SEND TEXT
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

  // ======================================================
  // SEND FILE (anexo)
  // ======================================================
  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || isClosed || !onSendMedia) return;

    const type = inferMediaType(file);
    const caption = draft.trim();

    setSending(true);
    try {
      await onSendMedia({
        type,
        caption,
        file,                // ✅ arquivo real
        mimeType: file.type
      });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  // ======================================================
  // 🎙️ GRAVAÇÃO (microfone)
  // ======================================================
  function pickBestAudioMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(c)) return c;
    }
    return ""; // deixa o browser decidir
  }

  async function startRecording() {
    if (isClosed || sending || recording) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      alert("Seu navegador não suporta gravação de áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickBestAudioMime();

      recordChunksRef.current = [];
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      rec.onstop = async () => {
        // para as tracks do microfone
        stream.getTracks().forEach((t) => t.stop());

        const chunks = recordChunksRef.current;
        recordChunksRef.current = [];

        if (!chunks.length) return;

        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });

        // gera um File pra reutilizar o pipeline (upload + send)
        const ext = (blob.type.includes("ogg") ? "ogg" : "webm");
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: blob.type });

        setSending(true);
        try {
          await onSendMedia?.({
            type: "audio",
            caption: "",       // voice note normalmente sem legenda
            file,
            mimeType: file.type
          });
        } finally {
          setSending(false);
          setRecordSecs(0);
        }
      };

      recorderRef.current = rec;

      rec.start(250);
      setRecording(true);
      setRecordSecs(0);

      clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        setRecordSecs((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error("Erro ao iniciar gravação:", e);
      alert("Não foi possível acessar o microfone. Verifique permissões do navegador.");
    }
  }

  function stopRecording() {
    if (!recording) return;

    setRecording(false);
    clearInterval(recordTimerRef.current);

    const rec = recorderRef.current;
    recorderRef.current = null;

    try {
      if (rec && rec.state !== "inactive") rec.stop();
    } catch (e) {
      console.warn("Falha ao parar gravação:", e);
    }
  }

  useEffect(() => {
    return () => {
      clearInterval(recordTimerRef.current);
      try {
        const rec = recorderRef.current;
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {}
    };
  }, []);

  // ======================================================
  // RENDER HELPERS
  // ======================================================
  function renderMedia(msg) {
    const type = getMsgType(msg);
    const link = getAnyLink(msg);
    const loc = type === "location" ? getLocation(msg) : null;

    if (type === "location") {
      if (!loc) {
        return (
          <div className="chat-message-text">
            📍 <em>Localização recebida, mas sem coordenadas disponíveis.</em>
          </div>
        );
      }
      return (
        <div className="chat-message-text">
          <div style={{ display: "grid", gap: 6 }}>
            <div>📍 <strong>Localização</strong></div>
            <div>{loc.latitude}, {loc.longitude}{loc.name ? ` — ${loc.name}` : ""}</div>
            {loc.address ? <div style={{ opacity: 0.85 }}>{loc.address}</div> : null}
            <div>
              <a href={mapsLink(loc.latitude, loc.longitude)} target="_blank" rel="noreferrer">
                Abrir no Google Maps
              </a>
            </div>
          </div>
        </div>
      );
    }

    if (type === "audio") {
      return (
        <div className="chat-message-text">
          {link ? (
            <audio controls src={link} style={{ width: "100%" }} />
          ) : (
            <em>🔊 Áudio (sem link de mídia ainda)</em>
          )}
        </div>
      );
    }

    if (type === "sticker") {
      return (
        <div className="chat-message-text">
          {link ? (
            <img
              src={link}
              alt="Sticker"
              style={{ maxWidth: 220, height: "auto", borderRadius: 12, display: "block" }}
            />
          ) : (
            <em>🧩 Figurinha (sem link de mídia ainda)</em>
          )}
        </div>
      );
    }

    if (type === "image") {
      return (
        <div className="chat-message-text">
          {link ? (
            <img
              src={link}
              alt="Imagem"
              style={{ maxWidth: 320, height: "auto", borderRadius: 12, display: "block" }}
            />
          ) : (
            <em>🖼️ Imagem (sem link de mídia ainda)</em>
          )}
        </div>
      );
    }

    if (type === "video") {
      return (
        <div className="chat-message-text">
          {link ? (
            <video controls src={link} style={{ maxWidth: 360, width: "100%", borderRadius: 12 }} />
          ) : (
            <em>🎬 Vídeo (sem link de mídia ainda)</em>
          )}
        </div>
      );
    }

    if (type === "document" || type === "file") {
      return (
        <div className="chat-message-text">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer">
              📄 Abrir arquivo
            </a>
          ) : (
            <em>📄 Arquivo (sem link de mídia ainda)</em>
          )}
        </div>
      );
    }

    return null;
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

          const msgType = getMsgType(msg);
          const hasMedia =
            ["image","video","audio","document","file","sticker","location"].includes(msgType);

          return (
            <div key={msg.__key}>
              {showHumanMarker && (
                <div className="chat-audit-marker human">👤 Atendimento humano iniciado</div>
              )}

              {isSystem && <div className="chat-audit-marker system">{text}</div>}

              {!isSystem && (
                <div className={"message-row " + (isClient ? "message-row-in" : "message-row-out")}>
                  <div className="message-bubble">
                    <div className="message-author">
                      {isBot && "🤖 Bot"}
                      {isAgent && "👤 Humano"}
                      {isClient && "Cliente"}
                    </div>

                    {hasMedia ? renderMedia(msg) : null}

                    {text && String(text).trim() ? (
                      <div className="chat-message-text">{text}</div>
                    ) : (
                      !hasMedia && <div className="chat-message-text">[mensagem sem texto]</div>
                    )}

                    <div className="message-timestamp">{ts}</div>
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
              <button key={e} type="button" onClick={() => setDraft((d) => d + e)}>
                {e}
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={() => !isClosed && setShowEmoji((v) => !v)}>
          😊
        </button>

        <button type="button" onClick={() => fileRef.current?.click()}>
          📎
        </button>

        {/* 🎙️ Microfone: segure para gravar */}
        <button
          type="button"
          disabled={isClosed || sending}
          onMouseDown={(e) => { e.preventDefault(); startRecording(); }}
          onMouseUp={(e) => { e.preventDefault(); stopRecording(); }}
          onMouseLeave={(e) => { e.preventDefault(); stopRecording(); }}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          title={recording ? `Gravando… ${recordSecs}s (solte para enviar)` : "Segure para gravar áudio"}
          style={{
            opacity: recording ? 1 : 0.9,
            transform: recording ? "scale(1.03)" : "none"
          }}
        >
          {recording ? `🎙️ ${recordSecs}s` : "🎙️"}
        </button>

        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={handleFilePicked}
          accept="image/*,image/webp,video/*,audio/*,application/pdf"
        />

        <textarea
          ref={textareaRef}
          value={draft}
          disabled={isClosed || sending || recording}
          placeholder={recording ? "Gravando… solte o 🎙️ para enviar" : isClosed ? "Atendimento encerrado." : "Digite uma mensagem..."}
          onChange={(e) => setDraft(e.target.value)}
        />

        <button type="submit" disabled={isClosed || sending || recording || !draft.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
