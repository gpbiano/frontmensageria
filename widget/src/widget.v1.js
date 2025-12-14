/* GP Labs Web Chat Widget — v1
 * Embed via:
 * <script src="https://widget.gplabs.com.br/widget.js" data-widget-key="wkey_xxx" async></script>
 *
 * Requisitos (backend):
 * - POST   /webchat/session
 * - POST   /webchat/messages
 * - GET    /webchat/conversations/:id/messages?after=<cursor>&limit=50
 * - POST   /webchat/conversations/:id/close
 *
 * Segurança (esperada no backend):
 * - valida widgetKey + Origin allowlist
 * - retorna webchatToken assinado (expira)
 */

(function () {
  "use strict";

  // Evita duplicar se injetar duas vezes
  if (document.getElementById("gpl-webchat-root")) return;

  // =============================
  // Helpers
  // =============================
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.assign(n.style, attrs[k]);
        } else if (k === "className") {
          n.className = attrs[k];
        } else if (k.startsWith("on") && typeof attrs[k] === "function") {
          n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
          n.setAttribute(k, String(attrs[k]));
        }
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      if (typeof c === "string") n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    });
    return n;
  }

  function safeText(str) {
    return String(str ?? "");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randHex(len) {
    const a = new Uint8Array(len);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getOrCreateVisitorId(storageKey) {
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing) return existing;
      const id = `vis_${Date.now()}_${randHex(8)}`;
      localStorage.setItem(storageKey, id);
      return id;
    } catch {
      return `vis_${Date.now()}_${randHex(8)}`;
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // =============================
  // Config (via data-attributes)
  // =============================
  const script =
    document.currentScript ||
    (function findScript() {
      const scripts = document.getElementsByTagName("script");
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i];
        const src = (s.getAttribute("src") || "").toLowerCase();
        if (src.includes("widget.v1.js")) return s;
      }
      return scripts[scripts.length - 1];
    })();

  const WIDGET_KEY = script?.dataset?.widgetKey || "";
  if (!WIDGET_KEY) return;

  const API_BASE =
    script?.dataset?.apiBase ||
    (function guessBase() {
      try {
        const u = new URL(script.src);
        return `${u.protocol}//${u.host}`;
      } catch {
        return "";
      }
    })();

  const DEFAULTS = {
    primaryColor: script?.dataset?.color || "#34d399",
    position: script?.dataset?.position || "right", // right | left
    buttonText: script?.dataset?.buttonText || "Ajuda",
    headerTitle: script?.dataset?.title || "Atendimento",
    greeting: script?.dataset?.greeting || "Olá! Como posso ajudar?",
    pollingOpenMs: Number(script?.dataset?.pollingOpenMs || 2500),
    pollingMinimizedMs: Number(script?.dataset?.pollingMinimizedMs || 12000),
    maxMessageLen: 2000
  };

  const STORAGE = {
    visitorId: `gpl_webchat_visitor_${WIDGET_KEY}`,
    session: `gpl_webchat_session_${WIDGET_KEY}`
  };

  // =============================
  // State
  // =============================
  const state = {
    visitorId: getOrCreateVisitorId(STORAGE.visitorId),
    conversationId: null,
    sessionId: null,
    webchatToken: null,

    isOpen: false,
    isMinimized: false,
    isClosed: false,

    lastCursor: null,
    messages: [],

    pollTimer: null,
    pollInterval: DEFAULTS.pollingMinimizedMs
  };

  // =============================
  // Network
  // =============================
  async function api(path, opts) {
    const url = `${API_BASE}${path}`;
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts?.headers || {}
    );

    if (state.webchatToken) {
      headers["Authorization"] = `Webchat ${state.webchatToken}`;
    }
    headers["X-Widget-Key"] = WIDGET_KEY;

    const res = await fetch(url, {
      method: opts?.method || "GET",
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      credentials: "omit"
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function createOrResumeSession() {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
      if (
        cached &&
        cached.conversationId &&
        cached.webchatToken &&
        cached.expiresAt &&
        Date.now() < new Date(cached.expiresAt).getTime()
      ) {
        state.conversationId = cached.conversationId;
        state.sessionId = cached.sessionId || null;
        state.webchatToken = cached.webchatToken;
        state.lastCursor = cached.lastCursor || null;
        return;
      }
    } catch {}

    const payload = {
      visitorId: state.visitorId,
      pageUrl: location.href,
      referrer: document.referrer || "",
      utm: (function () {
        const p = new URLSearchParams(location.search);
        const utm = {};
        ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
          (k) => {
            const v = p.get(k);
            if (v) utm[k] = v;
          }
        );
        return Object.keys(utm).length ? utm : undefined;
      })()
    };

    const res = await api("/webchat/session", { method: "POST", body: payload });

    state.conversationId = res.conversationId;
    state.sessionId = res.sessionId || null;
    state.webchatToken = res.webchatToken;
    state.isClosed = res.status === "closed";
    state.lastCursor = res.lastCursor || null;

    try {
      const ttlSec = Number(res.expiresInSeconds || 1800);
      const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
      localStorage.setItem(
        STORAGE.session,
        JSON.stringify({
          conversationId: state.conversationId,
          sessionId: state.sessionId,
          webchatToken: state.webchatToken,
          expiresAt,
          lastCursor: state.lastCursor
        })
      );
    } catch {}
  }

  async function fetchNewMessages() {
    if (!state.conversationId) return;

    const q = new URLSearchParams();
    if (state.lastCursor) q.set("after", state.lastCursor);
    q.set("limit", "50");

    const res = await api(
      `/webchat/conversations/${encodeURIComponent(
        state.conversationId
      )}/messages?${q.toString()}`
    );

    const items = Array.isArray(res.items) ? res.items : [];
    if (items.length) {
      items.forEach((m) => addMessageToUI(m));
      state.lastCursor = res.nextCursor || state.lastCursor;
      persistCursor();
      scrollToBottom(true);
    } else if (res.nextCursor) {
      state.lastCursor = res.nextCursor;
      persistCursor();
    }
  }

  function persistCursor() {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
      if (cached && cached.conversationId === state.conversationId) {
        cached.lastCursor = state.lastCursor;
        localStorage.setItem(STORAGE.session, JSON.stringify(cached));
      }
    } catch {}
  }

  async function sendVisitorMessage(text) {
    const msg = safeText(text).trim();
    if (!msg) return;
    if (msg.length > DEFAULTS.maxMessageLen) {
      throw new Error(
        `Mensagem muito longa (máx ${DEFAULTS.maxMessageLen} caracteres).`
      );
    }
    if (state.isClosed) throw new Error("Atendimento encerrado.");

    addMessageToUI({
      id: `local_${Date.now()}`,
      from: "visitor",
      type: "text",
      text: msg,
      createdAt: nowIso()
    });
    scrollToBottom(true);

    const res = await api("/webchat/messages", {
      method: "POST",
      body: { conversationId: state.conversationId, text: msg }
    });

    if (res?.nextCursor) {
      state.lastCursor = res.nextCursor;
      persistCursor();
    }
  }

  async function closeByUser() {
    if (!state.conversationId) return;

    try {
      await api(
        `/webchat/conversations/${encodeURIComponent(state.conversationId)}/close`,
        { method: "POST", body: { reason: "user_closed" } }
      );
    } catch {}

    state.isClosed = true;
    setClosedUI(true);
    stopPolling();

    // ✅ recomendação: se fechou pelo X, limpa cache pra reabrir virar sessão nova
    try {
      localStorage.removeItem(STORAGE.session);
    } catch {}
  }

  // =============================
  // UI
  // =============================
  const root = el("div", { id: "gpl-webchat-root" });

  const styles = el("style", null, [
    `
#gpl-webchat-root { all: initial; }

#gpl-webchat-btn {
  all: unset;
  position: fixed;
  bottom: 18px;
  ${DEFAULTS.position === "left" ? "left: 18px;" : "right: 18px;"}
  z-index: 2147483647;
  cursor: pointer;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}
#gpl-webchat-btn .bubble {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 999px;
  background: ${DEFAULTS.primaryColor};
  color: #0b1220;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
  user-select: none;
}

#gpl-webchat-panel {
  position: fixed;
  bottom: 78px;
  ${DEFAULTS.position === "left" ? "left: 18px;" : "right: 18px;"}
  width: 340px;
  max-width: calc(100vw - 36px);
  height: 440px;
  max-height: calc(100vh - 120px);

  border-radius: 18px;
  overflow: hidden;
  background: #0a0f1c;
  color: #e5e7eb;
  box-shadow: 0 20px 60px rgba(0,0,0,.45);
  z-index: 2147483647;

  display: none;            /* ao abrir -> flex */
  flex-direction: column;

  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}

#gpl-webchat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px;
  background: rgba(255,255,255,.04);
  border-bottom: 1px solid rgba(255,255,255,.06);
  flex: 0 0 auto;
}
#gpl-webchat-title { font-size: 14px; font-weight: 600; }
#gpl-webchat-actions { display: flex; gap: 6px; }

.gpl-icon-btn {
  all: unset;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  cursor: pointer;
  color: #e5e7eb;
}
.gpl-icon-btn:hover { background: rgba(255,255,255,.06); }

#gpl-webchat-body {
  padding: 12px;
  overflow: auto;
  flex: 1 1 auto;
}

.gpl-msg { display: flex; margin: 10px 0; }
.gpl-msg .b {
  max-width: 85%;
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
.gpl-msg.visitor { justify-content: flex-end; }
.gpl-msg.visitor .b {
  background: ${DEFAULTS.primaryColor};
  color: #0b1220;
  border-bottom-right-radius: 6px;
}
.gpl-msg.agent .b, .gpl-msg.bot .b {
  background: rgba(255,255,255,.06);
  color: #e5e7eb;
  border-bottom-left-radius: 6px;
}

#gpl-webchat-footer {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: center;

  padding: 10px 10px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));

  border-top: 1px solid rgba(255,255,255,.06);
  background: rgba(0,0,0,.12);
  box-sizing: border-box;
}

#gpl-webchat-input {
  all: unset;
  flex: 1;
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.06);
  color: #e5e7eb;
  font-size: 13px;
  box-sizing: border-box;
}

#gpl-webchat-send {
  all: unset;
  cursor: pointer;
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.10);
  box-sizing: border-box;
}
#gpl-webchat-send:hover { background: rgba(255,255,255,.14); }

#gpl-webchat-closed {
  display: none;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.06);
  margin-top: 10px;
  font-size: 12px;
}
`
  ]);

  const btn = el("button", { id: "gpl-webchat-btn", type: "button" }, [
    el("span", { className: "bubble" }, [
      el("span", null, ["💬"]),
      el("span", null, [DEFAULTS.buttonText])
    ])
  ]);

  const panel = el("div", { id: "gpl-webchat-panel" }, [
    el("div", { id: "gpl-webchat-header" }, [
      el("div", { id: "gpl-webchat-title" }, [DEFAULTS.headerTitle]),
      el("div", { id: "gpl-webchat-actions" }, [
        el(
          "button",
          { className: "gpl-icon-btn", title: "Minimizar", onClick: () => toggleMinimize() },
          ["—"]
        ),
        el(
          "button",
          { className: "gpl-icon-btn", title: "Encerrar atendimento", onClick: () => closeByUser() },
          ["✕"]
        )
      ])
    ]),
    el("div", { id: "gpl-webchat-body" }, [
      el("div", { className: "gpl-msg bot" }, [
        el("div", { className: "b" }, [DEFAULTS.greeting])
      ]),
      el("div", { id: "gpl-webchat-closed" }, [
        "Atendimento encerrado. Se precisar, abra o chat novamente para iniciar uma nova sessão."
      ])
    ]),
    el("div", { id: "gpl-webchat-footer" }, [
      el("input", {
        id: "gpl-webchat-input",
        placeholder: "Digite sua mensagem…",
        autocomplete: "off"
      }),
      el(
        "button",
        { id: "gpl-webchat-send", type: "button", onClick: () => handleSend() },
        ["Enviar"]
      )
    ])
  ]);

  root.appendChild(styles);
  root.appendChild(btn);
  root.appendChild(panel);
  document.documentElement.appendChild(root);

  const bodyEl = $("#gpl-webchat-body", panel);
  const inputEl = $("#gpl-webchat-input", panel);
  const closedEl = $("#gpl-webchat-closed", panel);
  const sendBtnEl = $("#gpl-webchat-send", panel);

  function setOpenUI(open) {
    panel.style.display = open ? "flex" : "none";
  }

  function setClosedUI(isClosed) {
    state.isClosed = !!isClosed;
    closedEl.style.display = state.isClosed ? "block" : "none";
    inputEl.disabled = state.isClosed;
    sendBtnEl.disabled = state.isClosed;
  }

  function addMessageToUI(m) {
    const from = m.from || m.sender || "bot";
    const type = m.type || "text";
    if (type !== "text") return;

    if (m.id && state.messages.some((x) => x.id === m.id)) return;
    state.messages.push({
      id: m.id,
      from,
      text: m.text,
      createdAt: m.createdAt
    });

    const row = el("div", { className: `gpl-msg ${from}` }, [
      el("div", { className: "b" }, [safeText(m.text)])
    ]);
    bodyEl.appendChild(row);
  }

  function scrollToBottom(force) {
    const nearBottom =
      bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 120;
    if (force || nearBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  async function handleSend() {
    const text = inputEl.value;
    inputEl.value = "";
    try {
      await sendVisitorMessage(text);
      schedulePoll(300);
    } catch (e) {
      addMessageToUI({
        id: `err_${Date.now()}`,
        from: "bot",
        type: "text",
        text: `Não consegui enviar: ${safeText(e.message || e)}`,
        createdAt: nowIso()
      });
      scrollToBottom(true);
    }
  }

  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      handleSend();
    }
  });

  btn.addEventListener(
    "click",
    debounce(async () => {
      state.isOpen = !state.isOpen;
      setOpenUI(state.isOpen);

      if (state.isOpen) {
        await ensureReady();
        startPolling();
        scrollToBottom(true);
      } else {
        stopPolling();
      }
    }, 150)
  );

  function toggleMinimize() {
    state.isMinimized = !state.isMinimized;
    if (state.isMinimized) {
      state.pollInterval = DEFAULTS.pollingMinimizedMs;
      setOpenUI(false);
    } else {
      state.pollInterval = DEFAULTS.pollingOpenMs;
      setOpenUI(true);
      schedulePoll(100);
    }
  }

  // =============================
  // Polling control
  // =============================
  function startPolling() {
    state.pollInterval = DEFAULTS.pollingOpenMs;
    stopPolling();
    schedulePoll(0);
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function schedulePoll(ms) {
    stopPolling();
    state.pollTimer = setTimeout(async () => {
      try {
        if (!state.isOpen && !state.isMinimized) return;
        await fetchNewMessages();
      } catch {
        // silêncio
      } finally {
        const hidden = document.hidden;
        const next = hidden ? Math.max(state.pollInterval, 15000) : state.pollInterval;
        schedulePoll(next);
      }
    }, ms);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.pollInterval = Math.max(state.pollInterval, 15000);
    } else {
      state.pollInterval = state.isMinimized
        ? DEFAULTS.pollingMinimizedMs
        : DEFAULTS.pollingOpenMs;
      if (state.isOpen || state.isMinimized) schedulePoll(100);
    }
  });

  // =============================
  // Bootstrap
  // =============================
  async function ensureReady() {
    if (state.conversationId && state.webchatToken) return;
    try {
      await createOrResumeSession();
      setClosedUI(state.isClosed);
      await fetchNewMessages();
      scrollToBottom(true);
    } catch {
      setClosedUI(false);
      addMessageToUI({
        id: `boot_err_${Date.now()}`,
        from: "bot",
        type: "text",
        text: "Não consegui iniciar o chat agora. Tente novamente em instantes.",
        createdAt: nowIso()
      });
      scrollToBottom(true);
    }
  }
})();
