import mixpanel from "mixpanel-browser";

let _inited = false;
let _enabled = false;

function safeId(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

export function mpInit() {
  if (typeof window === "undefined") return false;
  if (_inited) return _enabled;

  _inited = true;

  const token = String(import.meta.env.VITE_MIXPANEL_TOKEN || "").trim();

  if (!token) {
    _enabled = false;
    console.warn("[Mixpanel] Token ausente: VITE_MIXPANEL_TOKEN (desativado).");
    return false;
  }

  try {
    mixpanel.init(token, {
      debug: Boolean(import.meta.env.DEV),
      persistence: "localStorage",
      ignore_dnt: true,
      ip: false
    });

    _enabled = true;

    // ✅ pra você testar no Console: window.mixpanel.track(...)
    window.mixpanel = mixpanel;

    console.log("[Mixpanel] iniciado.");
    return true;
  } catch (e) {
    _enabled = false;
    console.warn("[Mixpanel] falha ao iniciar:", e);
    return false;
  }
}

export function mpIdentify(user) {
  if (!_enabled) return;

  try {
    const id = safeId(user?.id) || safeId(user?.email);
    if (!id) return;

    mixpanel.identify(id);

    // Propriedades básicas (não quebra se der erro)
    mixpanel.people?.set?.({
      $email: safeId(user?.email) || undefined,
      $name: safeId(user?.name) || undefined
    });
  } catch {
    // silêncio pra nunca derrubar a tela
  }
}

export function mpTrack(eventName, props = {}) {
  if (!_enabled) return;

  try {
    const name = String(eventName || "").trim();
    if (!name) return;

    mixpanel.track(name, { ...props });
  } catch {
    // silêncio
  }
}

export function mpReset() {
  if (!_enabled) return;

  try {
    mixpanel.reset();
  } catch {
    // silêncio
  }
}
