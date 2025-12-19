// frontend/src/pages/auth/AuthContext.jsx
import React, { createContext, useContext, useMemo, useState } from "react";
import { clearAuth, getAuth, setAuth } from "./authStorage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const initial = getAuth();
  const [token, setToken] = useState(initial.token || "");
  const [user, setUser] = useState(initial.user || null);

  const value = useMemo(() => {
    return {
      token,
      user,
      isAuthenticated: !!token,
      login(payload) {
        // payload esperado do backend: { token, user }
        const nextToken = payload?.token || "";
        const nextUser = payload?.user || null;

        setToken(nextToken);
        setUser(nextUser);
        setAuth({ token: nextToken, user: nextUser });
      },
      logout() {
        setToken("");
        setUser(null);
        clearAuth();
      }
    };
  }, [token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider />");
  return ctx;
}
