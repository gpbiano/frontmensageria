(function () {
  var current = document.currentScript;
  var src = (current && current.src) ? current.src : "";
  var base = src ? src.split("?")[0].split("/").slice(0, -1).join("/") : "";

  // ✅ repassa o mesmo ?v=... (ou qualquer query) do widget.js para o widget.v1.js
  var qs = "";
  var qIndex = src.indexOf("?");
  if (qIndex >= 0) qs = src.slice(qIndex); // inclui "?"

  var s = document.createElement("script");
  s.src = (base || "") + "/widget.v1.js" + qs;
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
