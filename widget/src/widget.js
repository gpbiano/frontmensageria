(function () {
  var current = document.currentScript;
  if (!current) return;

  // --------------------------------------------------
  // 🧹 LIMPEZA DEFENSIVA (ANTI CONFLITO)
  // Remove qualquer estado antigo NÃO-webchat
  // --------------------------------------------------
  try {
    var cid =
      localStorage.getItem("conversationId") ||
      localStorage.getItem("wc_conversationId");

    if (cid && !String(cid).startsWith("wc_")) {
      localStorage.removeItem("conversationId");
      localStorage.removeItem("wc_conversationId");
      localStorage.removeItem("webchatToken");
      localStorage.removeItem("wc_token");
    }
  } catch (e) {
    // silent
  }

  // --------------------------------------------------
  // ✅ Tenant context (para sites fora de *.cliente.gplabs.com.br)
  // O backend exige tenant no /webchat/* quando o host não define tenant.
  // --------------------------------------------------
  var tenantSlug = (current.getAttribute("data-tenant-slug") || "").trim();
  var tenantId = (current.getAttribute("data-tenant-id") || "").trim();

  // Se quiser fallback automático via data-widget-tenant também:
  if (!tenantSlug) tenantSlug = (current.getAttribute("data-widget-tenant") || "").trim();

  // Só aplica patch se tiver algum tenant definido
  if (tenantSlug || tenantId) {
    try {
      var originalFetch = window.fetch;
      if (typeof originalFetch === "function" && !window.__gplabsWebchatFetchPatched) {
        window.__gplabsWebchatFetchPatched = true;

        window.fetch = function (input, init) {
          try {
            var url = "";
            if (typeof input === "string") url = input;
            else if (input && input.url) url = input.url;

            // intercepta apenas chamadas do webchat
            // cobre /webchat/* e /br/webchat/*
            var isWebchat =
              url.indexOf("/webchat/") !== -1 ||
              url.indexOf("/webchat") !== -1 ||
              url.indexOf("/br/webchat/") !== -1 ||
              url.indexOf("/br/webchat") !== -1;

            if (isWebchat) {
              init = init || {};

              // Normaliza headers
              // (pode ser Headers, array ou objeto)
              var headers = init.headers;

              // Se input for Request, pode ter headers próprios
              // (não vamos reescrever Request; só completamos init.headers)
              var hObj = {};

              // Extrai headers existentes
              if (headers) {
                if (typeof Headers !== "undefined" && headers instanceof Headers) {
                  headers.forEach(function (v, k) {
                    hObj[k] = v;
                  });
                } else if (Array.isArray(headers)) {
                  for (var i = 0; i < headers.length; i++) {
                    var pair = headers[i];
                    if (pair && pair.length >= 2) hObj[String(pair[0])] = String(pair[1]);
                  }
                } else if (typeof headers === "object") {
                  for (var k in headers) hObj[k] = headers[k];
                }
              }

              // Injeta tenant headers (somente se ainda não vierem)
              // Backend: recomenda-se aceitar x-tenant-slug / x-tenant-id
              if (tenantSlug && !hObj["X-Tenant-Slug"] && !hObj["x-tenant-slug"]) {
                hObj["X-Tenant-Slug"] = tenantSlug;
              }
              if (tenantId && !hObj["X-Tenant-Id"] && !hObj["x-tenant-id"]) {
                hObj["X-Tenant-Id"] = tenantId;
              }

              init.headers = hObj;
            }
          } catch (e) {
            // silent
          }

          return originalFetch.call(this, input, init);
        };
      }
    } catch (e) {
      // silent
    }
  }

  // --------------------------------------------------
  // Resolve base URL do widget
  // --------------------------------------------------
  var src = current.getAttribute("src") || "";
  var base = "";

  try {
    var u = new URL(src, window.location.href);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.split("/").slice(0, -1).join("/") + "/";
    base = u.toString().replace(/\/$/, "");
  } catch (e) {
    base = src
      ? src
          .split("?")[0]
          .split("#")[0]
          .split("/")
          .slice(0, -1)
          .join("/")
      : "";
  }

  // --------------------------------------------------
  // Carrega versão real do widget
  // --------------------------------------------------
  var s = document.createElement("script");
  s.src = (base || "") + "/widget.v1.js?v=1";
  s.async = true;

  // repassa atributos data-*
  for (var i = 0; i < current.attributes.length; i++) {
    var a = current.attributes[i];
    if (a && a.name && a.name.indexOf("data-") === 0) {
      s.setAttribute(a.name, a.value);
    }
  }

  document.head.appendChild(s);
})();
