import { useEffect, useState } from "react";
import { finishInstagramOAuth } from "../../api";

export default function InstagramCallbackPage() {
  const [msg, setMsg] = useState("Processando conexão do Instagram...");

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const errDesc =
          url.searchParams.get("error_description") || url.searchParams.get("error_message");

        if (err) throw new Error(String(errDesc || err));
        if (!code || !state) throw new Error("Callback inválido: code/state ausentes.");

        await finishInstagramOAuth({ code, state });

        setMsg("Instagram conectado! Redirecionando...");
        window.location.href = "/settings/channels";
      } catch (e) {
        setMsg(`Erro ao conectar: ${e?.message || String(e)}`);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Instagram</h2>
      <p style={{ marginTop: 10 }}>{msg}</p>
    </div>
  );
}
