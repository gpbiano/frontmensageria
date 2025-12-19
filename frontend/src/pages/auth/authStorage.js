// frontend/src/pages/auth/authStorage.js

const KEY = "gp_auth";

export function getAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { token: "", user: null };
    const parsed = JSON.parse(raw);
    return {
      token: parsed?.token || "",
      user: parsed?.user || null
    };
  } catch {
    return { token: "", user: null };
  }
}

export function setAuth({ token, user }) {
  localStorage.setItem(KEY, JSON.stringify({ token, user }));
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}
