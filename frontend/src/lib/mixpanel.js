import mixpanel from "mixpanel-browser";

const TOKEN = (import.meta.env.VITE_MIXPANEL_TOKEN || "").trim();
const ENABLED = String(import.meta.env.VITE_MIXPANEL_ENABLED || "true") === "true";

let inited = false;

export function mpInit() {
  if (!ENABLED) return;
  if (!TOKEN) return;
  if (inited) return;

  mixpanel.init(TOKEN, {
    debug: import.meta.env.DEV,
    ignore_dnt: true, // se você quiser respeitar DNT, troque pra false
    persistence: "localStorage",
  });

  inited = true;
}

export function mpTrack(event, props = {}) {
  if (!ENABLED || !TOKEN) return;
  mpInit();
  try {
    mixpanel.track(event, props);
  } catch {}
}

export function mpIdentify(userId, props = {}) {
  if (!ENABLED || !TOKEN) return;
  mpInit();
  try {
    mixpanel.identify(String(userId));
    if (props && Object.keys(props).length) {
      mixpanel.people.set(props);
    }
  } catch {}
}

export function mpReset() {
  if (!ENABLED || !TOKEN) return;
  mpInit();
  try {
    mixpanel.reset();
  } catch {}
}
