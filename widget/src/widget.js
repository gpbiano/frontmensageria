(function () {
  var current = document.currentScript;
  var src = (current && current.src) ? current.src : "";
  var base = src ? src.split("/").slice(0, -1).join("/") : "";

  var s = document.createElement("script");
  s.src = (base || "") + "/widget.v1.js";
  s.async = true;

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
