(function () {
  var current = document.currentScript;
  var src = current && current.src ? current.src : "";
  var base = src ? src.split("/").slice(0, -1).join("/") : "";

  // ✅ cache-bust automático:
  // - se o script embed tiver ?v=123, repassa para o widget.v1.js
  // - senão usa um fallback simples (data-build ou timestamp)
  var v = "";
  try {
    var u = new URL(src, window.location.href);
    v = u.searchParams.get("v") || "";
  } catch (e) {}

  if (!v && current) {
    v = current.getAttribute("data-build") || "";
  }
  if (!v) {
    v = String(Date.now()); // fallback: sempre força (ótimo pra DEV; em prod use data-build)
  }

  var s = document.createElement("script");
  s.src = (base || "") + "/widget.v1.js?v=" + encodeURIComponent(v);
  s.async = true;

  // repassa todos os data-* pro widget
  if (current) {
    for (var i = 0; i < current.attributes.length; i++) {
      var a = current.attributes[i];
      if (a && a.name && a.name.indexOf("data-") === 0) {
        s.setAttribute(a.name, a.value);
      }
    }
  }

  document.head.appendChild(s);
})();
