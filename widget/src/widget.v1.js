/* GP Labs Web Chat Widget — v1 (fix anti-conflito + auto-recover + close fix + bot ready)
 * Embed via:
 * <script src="https://widget.gplabs.com.br/widget.js"
 *   data-widget-key="wkey_xxx"
 *   data-api-base="https://api.gplabs.com.br"   <-- IMPORTANTE (não deixar cair em localhost)
 *   async></script>
 *
 * Requisitos (backend):
 * - POST   /webchat/session
 * - POST   /webchat/messages
 * - GET    /webchat/conversations/:id/messages?after=<cursor>&limit=50
 * - POST   /webchat/conversations/:id/close
 *
 * FIXES NESTA VERSÃO:
 * ✅ X fecha de verdade (fecha UI + chama /close com fallback de token)
 * ✅ Minimizar não “some” pra sempre (mantém estado e polling)
 * ✅ Bot pronto: greeting passa a ser "system" e mensagens do backend (bot) aparecem como "bot"
 * ✅ Compatível com backend revisado (Authorization Webchat + X-Widget-Key)
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
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
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
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === "string") n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    });
    return n;
  }

  function safeText(str) {
    return String(str == null ? "" : str);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randHex(len) {
    var a = new Uint8Array(len);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a)
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function getOrCreateVisitorId(storageKey) {
    try {
      var existing = localStorage.getItem(storageKey);
      if (existing) return existing;
      var id = "vis_" + Date.now() + "_" + randHex(8);
      localStorage.setItem(storageKey, id);
      return id;
    } catch (e) {
      return "vis_" + Date.now() + "_" + randHex(8);
    }
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(this, args);
      }, ms);
    };
  }

  function isValidWebchatConversationId(id) {
    return !!id && String(id).startsWith("wc_");
  }

  // =============================
  // Config (via data-attributes)
  // =============================
  var script =
    document.currentScript ||
    (function findScript() {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i];
        var src = (s.getAttribute("src") || "").toLowerCase();
        if (src.includes("widget.v1.js") || src.includes("widget.js")) return s;
      }
      return scripts[scripts.length - 1];
    })();

  var WIDGET_KEY = (script && script.dataset && script.dataset.widgetKey) || "";
  if (!WIDGET_KEY) return;

  // ✅ NÃO confiar em "guessBase" (isso te joga pra widget.gplabs.com.br ou pior)
  // ✅ Se não vier data-api-base, cai em localhost apenas para DEV.
  var API_BASE =
    (script && script.dataset && (script.dataset.apiBase || script.dataset.apiBaseUrl)) ||
    window.GP_WEBCHAT_API_BASE ||
    "http://localhost:3010";

  var DEFAULTS = {
    primaryColor: (script && script.dataset && script.dataset.color) || "#34d399",
    position: (script && script.dataset && script.dataset.position) || "right", // right | left
    buttonText: (script && script.dataset && script.dataset.buttonText) || "Ajuda",
    headerTitle: (script && script.dataset && script.dataset.title) || "Atendimento",
    greeting:
      (script && script.dataset && script.dataset.greeting) || "Olá! Como posso ajudar?",
    pollingOpenMs: Number((script && script.dataset && script.dataset.pollingOpenMs) || 2500),
    pollingMinimizedMs: Number(
      (script && script.dataset && script.dataset.pollingMinimizedMs) || 12000
    ),
    maxMessageLen: 2000
  };

  var STORAGE = {
    visitorId: "gpl_webchat_visitor_" + WIDGET_KEY,
    session: "gpl_webchat_session_" + WIDGET_KEY,
    ui: "gpl_webchat_ui_" + WIDGET_KEY
  };

  // =============================
  // State
  // =============================
  var state = {
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

  function clearSessionCache() {
    try {
      localStorage.removeItem(STORAGE.session);
    } catch (e) {}
    state.conversationId = null;
    state.sessionId = null;
    state.webchatToken = null;
    state.lastCursor = null;
  }

  function persistUIState() {
    try {
      localStorage.setItem(
        STORAGE.ui,
        JSON.stringify({
          isOpen: !!state.isOpen,
          isMinimized: !!state.isMinimized
        })
      );
    } catch (e) {}
  }

  function restoreUIState() {
    try {
      var ui = JSON.parse(localStorage.getItem(STORAGE.ui) || "null");
      if (!ui) return;
      state.isOpen = !!ui.isOpen;
      state.isMinimized = !!ui.isMinimized;
    } catch (e) {}
  }

  // =============================
  // Network
  // =============================
  async function api(path, opts) {
    var url = "" + API_BASE + path;
    var headers = Object.assign(
      { "Content-Type": "application/json" },
      (opts && opts.headers) || {}
    );

    // padrão principal
    if (state.webchatToken) {
      headers["Authorization"] = "Webchat " + state.webchatToken;
      // fallback extra (ajuda no /close em setups mais chatos)
      headers["x-webchat-token"] = state.webchatToken;
    }
    headers["X-Widget-Key"] = WIDGET_KEY;

    var res = await fetch(url, {
      method: (opts && opts.method) || "GET",
      headers: headers,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "omit"
    });

    var text = await res.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { raw: text };
    }

    if (!res.ok) {
      var msg = (data && (data.error || data.message)) || "HTTP " + res.status;
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // ✅ tenta de novo automaticamente em casos típicos de sessão velha/conflito
  async function apiWithRecover(path, opts) {
    try {
      return await api(path, opts);
    } catch (e) {
      var st = e && e.status;
      // 401 token inválido / 404 conversa não existe / 409 conversa não é webchat
      if (st === 401 || st === 404 || st === 409) {
        clearSessionCache();
        await createOrResumeSession(true);
        return await api(path, opts);
      }
      throw e;
    }
  }

  async function createOrResumeSession(force) {
    if (!force) {
      try {
        var cached = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
        if (
          cached &&
          cached.conversationId &&
          cached.webchatToken &&
          cached.expiresAt &&
          Date.now() < new Date(cached.expiresAt).getTime()
        ) {
          // ✅ rejeita qualquer conversationId antigo (conv_...) aqui
          if (!isValidWebchatConversationId(cached.conversationId)) {
            clearSessionCache();
          } else {
            state.conversationId = cached.conversationId;
            state.sessionId = cached.sessionId || null;
            state.webchatToken = cached.webchatToken;
            state.lastCursor = cached.lastCursor || null;
            return;
          }
        }
      } catch (e) {}
    }

    var payload = {
      visitorId: state.visitorId,
      pageUrl: location.href,
      referrer: document.referrer || "",
      utm: (function () {
        var p = new URLSearchParams(location.search);
        var utm = {};
        ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
          function (k) {
            var v = p.get(k);
            if (v) utm[k] = v;
          }
        );
        return Object.keys(utm).length ? utm : undefined;
      })()
    };

    var res = await api("/webchat/session", { method: "POST", body: payload });

    // ✅ se backend devolver formato antigo, força reset e falha (pra não poluir)
    if (!isValidWebchatConversationId(res.conversationId) || !res.webchatToken) {
      clearSessionCache();
      throw new Error("Sessão inválida (conversationId/token).");
    }

    state.conversationId = res.conversationId;
    state.sessionId = res.sessionId || null;
    state.webchatToken = res.webchatToken;
    state.isClosed = res.status === "closed";
    state.lastCursor = res.lastCursor || null;

    try {
      var ttlSec = Number(res.expiresInSeconds || 1800);
      var expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
      localStorage.setItem(
        STORAGE.session,
        JSON.stringify({
          conversationId: state.conversationId,
          sessionId: state.sessionId,
          webchatToken: state.webchatToken,
          expiresAt: expiresAt,
          lastCursor: state.lastCursor
        })
      );
    } catch (e) {}
  }

  async function fetchNewMessages() {
    if (!state.conversationId) return;

    var q = new URLSearchParams();
    if (state.lastCursor) q.set("after", state.lastCursor);
    q.set("limit", "50");

    var res = await apiWithRecover(
      "/webchat/conversations/" +
        encodeURIComponent(state.conversationId) +
        "/messages?" +
        q.toString()
    );

    var items = Array.isArray(res && res.items) ? res.items : [];
    if (items.length) {
      items.forEach(function (m) {
        addMessageToUI(m);
      });
      state.lastCursor = res.nextCursor || state.lastCursor;
      persistCursor();
      scrollToBottom(true);
    } else if (res && res.nextCursor) {
      state.lastCursor = res.nextCursor;
      persistCursor();
    }
  }

  function persistCursor() {
    try {
      var cached = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
      if (cached && cached.conversationId === state.conversationId) {
        cached.lastCursor = state.lastCursor;
        localStorage.setItem(STORAGE.session, JSON.stringify(cached));
      }
    } catch (e) {}
  }

  async function sendVisitorMessage(text) {
    var msg = safeText(text).trim();
    if (!msg) return;
    if (msg.length > DEFAULTS.maxMessageLen) {
      throw new Error("Mensagem muito longa (máx " + DEFAULTS.maxMessageLen + " caracteres).");
    }
    if (state.isClosed) throw new Error("Atendimento encerrado.");

    addMessageToUI({
      id: "local_" + Date.now(),
      from: "visitor",
      type: "text",
      text: msg,
      createdAt: nowIso()
    });
    scrollToBottom(true);

    // ✅ NÃO enviar conversationId no body (token já define isso)
    var res = await apiWithRecover("/webchat/messages", {
      method: "POST",
      body: { text: msg }
    });

    if (res && res.nextCursor) {
      state.lastCursor = res.nextCursor;
      persistCursor();
    }

    // ✅ Se o backend devolver bot inline, já renderiza sem esperar polling
    if (res && res.bot && res.bot.message) {
      addMessageToUI(res.bot.message);
      scrollToBottom(true);
      // atualiza cursor se veio
      if (res.bot.message.id) {
        state.lastCursor = res.bot.message.id;
        persistCursor();
      }
    }
  }

  function resetUIConversation() {
    // limpa somente mensagens da UI (não mexe em visitorId)
    state.messages = [];
    state.lastCursor = null;
    // remove todas as mensagens do body, preservando greeting e closed box
    while (bodyEl && bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
    // re-injeta greeting + closed
    bodyEl.appendChild(
      el("div", { className: "gpl-msg system" }, [
        el("div", { className: "b" }, [DEFAULTS.greeting])
      ])
    );
    bodyEl.appendChild(closedEl);
  }

  async function closeByUser() {
    // ✅ fecha UI SEMPRE (independente do backend)
    state.isOpen = false;
    state.isMinimized = false;
    persistUIState();
    setOpenUI(false);
    stopPolling();

    // marca estado local
    state.isClosed = true;
    setClosedUI(true);

    // tenta fechar no backend, mas com fallback via query token (caso header falhe)
    if (state.conversationId) {
      try {
        // fallback extra: token na query
        var t = state.webchatToken ? "?token=" + encodeURIComponent(state.webchatToken) : "";
        await api(
          "/webchat/conversations/" + encodeURIComponent(state.conversationId) + "/close" + t,
          { method: "POST", body: { reason: "user_closed" } }
        );
      } catch (e) {
        // silêncio
      }
    }

    // ✅ ao fechar pelo X, limpa cache pra reabrir virar sessão nova
    clearSessionCache();
    resetUIConversation();
  }

  // =============================
  // UI
  // =============================
  var root = el("div", { id: "gpl-webchat-root" });

  var styles = el("style", null, [
    "\n#gpl-webchat-root { all: initial; }\n\n#gpl-webchat-btn {\n  all: unset;\n  position: fixed;\n  bottom: 18px;\n  " +
      (DEFAULTS.position === "left" ? "left: 18px;" : "right: 18px;") +
      "\n  z-index: 2147483647;\n  cursor: pointer;\n  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;\n}\n#gpl-webchat-btn .bubble {\n  display: inline-flex;\n  align-items: center;\n  gap: 10px;\n  padding: 12px 14px;\n  border-radius: 999px;\n  background: " +
      DEFAULTS.primaryColor +
      ";\n  color: #0b1220;\n  box-shadow: 0 10px 30px rgba(0,0,0,.35);\n  user-select: none;\n}\n\n#gpl-webchat-panel {\n  position: fixed;\n  bottom: 78px;\n  " +
      (DEFAULTS.position === "left" ? "left: 18px;" : "right: 18px;") +
      "\n  width: 340px;\n  max-width: calc(100vw - 36px);\n  height: 440px;\n  max-height: calc(100vh - 120px);\n\n  border-radius: 18px;\n  overflow: hidden;\n  background: #0a0f1c;\n  color: #e5e7eb;\n  box-shadow: 0 20px 60px rgba(0,0,0,.45);\n  z-index: 2147483647;\n\n  display: none;\n  flex-direction: column;\n\n  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;\n}\n\n#gpl-webchat-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 12px;\n  background: rgba(255,255,255,.04);\n  border-bottom: 1px solid rgba(255,255,255,.06);\n  flex: 0 0 auto;\n}\n#gpl-webchat-title { font-size: 14px; font-weight: 600; }\n#gpl-webchat-actions { display: flex; gap: 6px; }\n\n.gpl-icon-btn {\n  all: unset;\n  width: 34px;\n  height: 34px;\n  display: grid;\n  place-items: center;\n  border-radius: 10px;\n  cursor: pointer;\n  color: #e5e7eb;\n}\n.gpl-icon-btn:hover { background: rgba(255,255,255,.06); }\n\n#gpl-webchat-body {\n  padding: 12px;\n  overflow: auto;\n  flex: 1 1 auto;\n}\n\n.gpl-msg { display: flex; margin: 10px 0; }\n.gpl-msg .b {\n  max-width: 85%;\n  padding: 10px 12px;\n  border-radius: 14px;\n  font-size: 13px;\n  line-height: 1.35;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.gpl-msg.visitor { justify-content: flex-end; }\n.gpl-msg.visitor .b {\n  background: " +
      DEFAULTS.primaryColor +
      ";\n  color: #0b1220;\n  border-bottom-right-radius: 6px;\n}\n.gpl-msg.agent .b, .gpl-msg.bot .b, .gpl-msg.system .b {\n  background: rgba(255,255,255,.06);\n  color: #e5e7eb;\n  border-bottom-left-radius: 6px;\n}\n\n#gpl-webchat-footer {\n  flex: 0 0 auto;\n  display: flex;\n  gap: 8px;\n  align-items: center;\n\n  padding: 10px 10px;\n  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));\n\n  border-top: 1px solid rgba(255,255,255,.06);\n  background: rgba(0,0,0,.12);\n  box-sizing: border-box;\n}\n\n#gpl-webchat-input {\n  all: unset;\n  flex: 1;\n  height: 40px;\n  line-height: 40px;\n  padding: 0 12px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.06);\n  color: #e5e7eb;\n  font-size: 13px;\n  box-sizing: border-box;\n}\n\n#gpl-webchat-send {\n  all: unset;\n  cursor: pointer;\n  height: 40px;\n  line-height: 40px;\n  padding: 0 12px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.10);\n  box-sizing: border-box;\n}\n#gpl-webchat-send:hover { background: rgba(255,255,255,.14); }\n\n#gpl-webchat-closed {\n  display: none;\n  padding: 10px 12px;\n  border-radius: 12px;\n  background: rgba(255,255,255,.06);\n  margin-top: 10px;\n  font-size: 12px;\n}\n"
  ]);

  var btn = el("button", { id: "gpl-webchat-btn", type: "button" }, [
    el("span", { className: "bubble" }, [
      el("span", null, ["💬"]),
      el("span", null, [DEFAULTS.buttonText])
    ])
  ]);

  var panel = el("div", { id: "gpl-webchat-panel" }, [
    el("div", { id: "gpl-webchat-header" }, [
      el("div", { id: "gpl-webchat-title" }, [DEFAULTS.headerTitle]),
      el("div", { id: "gpl-webchat-actions" }, [
        el(
          "button",
          {
            className: "gpl-icon-btn",
            title: "Minimizar",
            onClick: function () {
              toggleMinimize();
            }
          },
          ["—"]
        ),
        el(
          "button",
          {
            className: "gpl-icon-btn",
            title: "Fechar",
            onClick: function () {
              closeByUser();
            }
          },
          ["✕"]
        )
      ])
    ]),
    el("div", { id: "gpl-webchat-body" }, [
      el("div", { className: "gpl-msg system" }, [
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
        {
          id: "gpl-webchat-send",
          type: "button",
          onClick: function () {
            handleSend();
          }
        },
        ["Enviar"]
      )
    ])
  ]);

  root.appendChild(styles);
  root.appendChild(btn);
  root.appendChild(panel);
  document.documentElement.appendChild(root);

  var bodyEl = $("#gpl-webchat-body", panel);
  var inputEl = $("#gpl-webchat-input", panel);
  var closedEl = $("#gpl-webchat-closed", panel);
  var sendBtnEl = $("#gpl-webchat-send", panel);

  function setOpenUI(open) {
    panel.style.display = open ? "flex" : "none";
  }

  function setClosedUI(isClosed) {
    state.isClosed = !!isClosed;
    closedEl.style.display = state.isClosed ? "block" : "none";
    inputEl.disabled = state.isClosed;
    sendBtnEl.disabled = state.isClosed;
  }

  function mapFrom(m) {
    // backend oficial: from = client | agent | bot | system
    var f = String(m && (m.from || m.sender || "") || "").toLowerCase();
    if (f === "client") return "visitor";
    if (f === "visitor") return "visitor";
    if (f === "agent") return "agent";
    if (f === "bot") return "bot";
    if (f === "system") return "system";

    // fallback: se veio direction=in assume visitor
    if (String(m && m.direction || "") === "in") return "visitor";
    return "bot";
  }

  function addMessageToUI(m) {
    var from = mapFrom(m);
    var type = m.type || "text";
    if (type !== "text") return;

    // normaliza texto
    var text = m.text || (m.text && m.text.body) || m.body || m.content || m.message || "";
    text = safeText(text);

    if (m.id && state.messages.some(function (x) { return x.id === m.id; })) return;

    state.messages.push({
      id: m.id || ("m_" + Date.now() + "_" + randHex(3)),
      from: from,
      text: text,
      createdAt: m.createdAt
    });

    var row = el("div", { className: "gpl-msg " + from }, [
      el("div", { className: "b" }, [text])
    ]);
    bodyEl.appendChild(row);
  }

  function scrollToBottom(force) {
    var nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 120;
    if (force || nearBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  async function handleSend() {
    var text = inputEl.value;
    inputEl.value = "";
    try {
      await sendVisitorMessage(text);
      schedulePoll(300);
    } catch (e) {
      addMessageToUI({
        id: "err_" + Date.now(),
        from: "bot",
        type: "text",
        text: "Não consegui enviar: " + safeText((e && e.message) || e),
        createdAt: nowIso()
      });
      scrollToBottom(true);
    }
  }

  inputEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      handleSend();
    }
  });

  btn.addEventListener(
    "click",
    debounce(async function () {
      // se estava fechado (por X), ao abrir cria nova sessão
      state.isOpen = !state.isOpen;
      state.isMinimized = false;

      persistUIState();
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
    state.isOpen = !state.isMinimized;

    persistUIState();

    if (state.isMinimized) {
      state.pollInterval = DEFAULTS.pollingMinimizedMs;
      setOpenUI(false);
      // mantém polling leve quando minimizado
      schedulePoll(200);
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
    state.pollTimer = setTimeout(async function () {
      try {
        if (!state.isOpen && !state.isMinimized) return;
        await fetchNewMessages();
      } catch (e) {
        // silêncio
      } finally {
        var hidden = document.hidden;
        var next = hidden ? Math.max(state.pollInterval, 15000) : state.pollInterval;
        schedulePoll(next);
      }
    }, ms);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      state.pollInterval = Math.max(state.pollInterval, 15000);
    } else {
      state.pollInterval = state.isMinimized ? DEFAULTS.pollingMinimizedMs : DEFAULTS.pollingOpenMs;
      if (state.isOpen || state.isMinimized) schedulePoll(100);
    }
  });

  // =============================
  // Bootstrap
  // =============================
  async function ensureReady() {
    if (state.conversationId && state.webchatToken) {
      setClosedUI(state.isClosed);
      return;
    }

    try {
      await createOrResumeSession(false);
      setClosedUI(state.isClosed);
      await fetchNewMessages();
      scrollToBottom(true);
    } catch (e) {
      setClosedUI(false);
      addMessageToUI({
        id: "boot_err_" + Date.now(),
        from: "bot",
        type: "text",
        text: "Não consegui iniciar o chat agora. Tente novamente em instantes.",
        createdAt: nowIso()
      });
      scrollToBottom(true);
    }
  }

  // ✅ já deixa pronto caso venha cache antigo (conv_) e o painel seja aberto
  (function sanitizeCachedSessionOnLoad() {
    try {
      var cached = JSON.parse(localStorage.getItem(STORAGE.session) || "null");
      if (cached && cached.conversationId && !isValidWebchatConversationId(cached.conversationId)) {
        localStorage.removeItem(STORAGE.session);
      }
    } catch (e) {}
  })();

  // ✅ restaura estado de UI (se usuário minimizou antes)
  (function restoreUiOnLoad() {
    restoreUIState();
    // nunca auto-abre por padrão; só respeita minimizado pra manter polling leve se quiser
    if (state.isMinimized) {
      // não mostra painel, mas mantém polling pra receber resposta do bot
      state.pollInterval = DEFAULTS.pollingMinimizedMs;
      schedulePoll(250);
    }
  })();
})();
