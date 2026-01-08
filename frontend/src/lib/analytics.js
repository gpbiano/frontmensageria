// frontend/src/lib/analytics.js
import { mpTrack } from "./mixpanel";

let _lastPageKey = "";

export function trackPage({ main, sub }) {
  const page = `${main} > ${sub}`;
  const key = page;

  // evita spammar page_view por renders
  if (key === _lastPageKey) return;
  _lastPageKey = key;

  mpTrack("page_view", { page, main, sub });
}

export function trackClick(name, props) {
  mpTrack(name, props);
}

export function trackError(name, err, props = {}) {
  const reason = String(err?.message || err || "").slice(0, 180) || "unknown";
  mpTrack(name, { ...props, reason });
}
