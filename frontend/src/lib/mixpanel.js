// frontend/src/lib/mixpanel.js
import mixpanel from "mixpanel-browser";

/**
 * ⚠️ IMPORTANTE
 * Defina no .env:
 * VITE_MIXPANEL_TOKEN=seu_token_aqui
 */

const TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN;
const IS_DEV = import.meta.env.DEV;

let initialized = false;

/**
 * Inicializa o Mixpanel
 * Deve ser chamado UMA vez (main.jsx)
 */
export function mpInit() {
  if (!TOKEN) {
    console.warn("[Mixpanel] Token não definido (VITE_MIXPANEL_TOKEN).");
    return;
  }

  if (initialized) return;

  mixpanel.init(TOKEN, {
    debug: IS_DEV,
    track_pageview: true,
    persistence: "localStorage",
    ignore_dnt: true
  });

  initialized = true;

  console.log("[Mixpanel] Inicializado", {
    env: IS_DEV ? "DEV" : "PROD"
  });
}

/**
 * Identifica usuário logado
 */
export function mpIdentify(user) {
  if (!user || !user.id) return;

  mixpanel.identify(String(user.id));

  mixpanel.people.set({
    $email: user.email,
    $name: user.name,
    user_id: user.id
  });

  console.log("[Mixpanel] identify", {
    id: user.id,
    email: user.email
  });
}

/**
 * Track de eventos
 */
export function mpTrack(event, props = {}) {
  if (!event) return;

  mixpanel.track(event, {
    ...props,
    env: IS_DEV ? "dev" : "prod"
  });

  if (IS_DEV) {
    console.log("[Mixpanel] track:", event, props);
  }
}

/**
 * Reset (logout)
 */
export function mpReset() {
  mixpanel.reset();
  console.log("[Mixpanel] reset");
}
