// frontend/src/outbound/NumbersPage.jsx
import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function NumbersPage() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [error, setError] = useState("");

  async function loadNumbers() {
    try {
      setLoading(true);
      setError("");

      const resp = await fetch(`${API_BASE}/outbound/numbers`);
      if (!resp.ok) {
        throw new Error("Erro ao carregar números");
      }

      const data = await resp.json();

      // backend devolve { numbers: [...], lastSyncAt: "..." }
      setNumbers(Array.isArray(data.numbers) ? data.numbers : []);
      setLastSyncAt(data.lastSyncAt || null);
    } catch (err) {
      console.error(err);
      setError("Não foi possível carregar os números. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      setError("");

      const resp = await fetch(`${API_BASE}/outbound/numbers/sync`, {
        method: "POST"
      });

      if (!resp.ok) {
        throw new Error("Erro ao sincronizar com a Meta");
      }

      await resp.json(); // não precisa do conteúdo agora
      await loadNumbers();
      alert("Números sincronizados com sucesso ✅");
    } catch (err) {
      console.error(err);
      setError("Erro ao sincronizar com a Meta. Veja o console para detalhes.");
      alert("Erro ao sincronizar com a Meta.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadNumbers();
  }, []);

  return (
    <div className="page numbers-page">
      <header className="page-header">
        <div>
          <h1>Números</h1>
          <p className="page-subtitle">
            Gestão dos números utilizados para disparo de campanhas WhatsApp.
          </p>
          {lastSyncAt && (
            <p className="page-meta">
              Última sincronização com a Meta:{" "}
              {new Date(lastSyncAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>

        <button
          className="primary-btn"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? "Sincronizando..." : "Sincronizar com a Meta"}
        </button>
      </header>

      <section className="numbers-card">
        <h2>Números conectados à conta WhatsApp</h2>
        <p className="numbers-subtitle">
          Lista espelhada da conta do WhatsApp Business (Meta). Use o botão
          acima para sincronizar as informações em tempo real.
        </p>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p>Carregando números...</p>
        ) : numbers.length === 0 ? (
          <p className="empty-text">
            Nenhum número cadastrado ainda. Clique em{" "}
            <strong>“Sincronizar com a Meta”</strong> para buscar os números da
            sua conta WhatsApp Business.
          </p>
        ) : (
          <table className="numbers-table">
            <thead>
              <tr>
                <th>Nome verificado</th>
                <th>Número</th>
                <th>Qualidade</th>
                <th>Status de verificação</th>
              </tr>
            </thead>
           <tbody>
  {numbers.map((n) => {
    const quality = (n.qualityRating || "").toLowerCase();

    return (
      <tr key={n.id}>
        <td>{n.verifiedName || "-"}</td>
        <td>{n.displayPhoneNumber}</td>
        <td>
          <span
            className={`quality-pill ${
              quality ? `quality-${quality}` : ""
            }`}
          >
            {n.qualityRating || "-"}
          </span>
        </td>
        <td>{n.codeVerificationStatus || "-"}</td>
      </tr>
    );
  })}
</tbody>

          </table>
        )}
      </section>
    </div>
  );
}

