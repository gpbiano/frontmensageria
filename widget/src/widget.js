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
