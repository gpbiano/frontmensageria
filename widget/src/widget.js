(function () {
  var current = document.currentScript;
  if (!current) return;

  var src = current.getAttribute("src") || "";
  var base = "";
  try {
    var u = new URL(src, window.location.href);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.split("/").slice(0, -1).join("/") + "/";
    base = u.toString().replace(/\/$/, "");
  } catch (e) {
    base = src ? src.split("?")[0].split("#")[0].split("/").slice(0, -1).join("/") : "";
  }

  var s = document.createElement("script");
  s.src = (base || "") + "/widget.v1.js?v=1";
  s.async = true;

  for (var i = 0; i < current.attributes.length; i++) {
    var a = current.attributes[i];
    if (a && a.name && a.name.indexOf("data-") === 0) {
      s.setAttribute(a.name, a.value);
    }
  }

  document.head.appendChild(s);
})();
