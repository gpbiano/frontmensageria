// frontend/src/lib/mixpanel.js
import mixpanel from "mixpanel-browser";

/**
 * Define no .env / env da plataforma:
 * VITE_MIXPANEL_TOKEN=xxxx
 */
const TOKEN = (import.meta.env.VITE_MIXPANEL_TOKEN || "").trim();
const IS_DEV = import.meta.env.DEV;

let initialized = false;

function canUse() {
  // Só usa se tiver token e init já tiver rodado
  return Boolean(TOKEN) && initialized && typeof mixpanel?.track === "function";
}

/**
 * Inicializa Mixpanel (chame uma vez no main.jsx)
 */
export function mpInit() {
  if (!TOKEN) {
    console.warn("[Mixpanel] Token ausente: VITE_MIXPANEL_TOKEN (desativado).");
    initialized = false;
    return;
  }

  if (initialized) return;

  try {
    mixpanel.init(TOKEN, {
      debug: IS_DEV,
      track_pageview: true,
      persistence: "localStorage",
      ignore_dnt: true
    });

    initialized = true;

    if (IS_DEV) console.log("[Mixpanel] Inicializado (DEV).");
  } catch (err) {
    initialized = false;
    console.error("[Mixpanel] Falha ao inicializar:", err);
  }
}

/**
 * Identifica usuário logado
 */
export function mpIdentify(user) {
  if (!canUse()) return;
  if (!user || user.id == null) return;

  try {
    mixpanel.identify(String(user.id));
    mixpanel.people?.set?.({
      $email: user.email,
      $name: user.name,
      user_id: user.id
    });
  } catch (err) {
    console.warn("[Mixpanel] identify falhou (ignorado):", err);
  }
}

/**
 * Track de eventos (NUNCA pode quebrar a UI)
 */
export function mpTrack(event, props = {}) {
  if (!canUse()) return;
  if (!event) return;

  try {
    mixpanel.track(event, {
      ...props,
      env: IS_DEV ? "dev" : "prod"
    });
  } catch (err) {
    console.warn("[Mixpanel] track falhou (ignorado):", err);
  }
}

/**
 * Reset no logout
 */
export function mpReset() {
  if (!canUse()) return;

  try {
    mixpanel.reset();
  } catch (err) {
    console.warn("[Mixpanel] reset falhou (ignorado):", err);
  }
}
