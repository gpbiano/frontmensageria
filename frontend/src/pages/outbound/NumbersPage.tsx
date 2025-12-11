// frontend/src/pages/outbound/NumbersPage.tsx

import { useEffect, useState } from "react";
import { fetchNumbers, syncNumbers } from "../../api";
import type { PhoneNumberRecord } from "../../types";
import "../../styles/outbound.css";

export default function NumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumberRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchNumbers();
      setNumbers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Erro ao carregar números:", err);
      setNumbers([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncNumbers();
      await load();
    } catch (err) {
      console.error("Erro ao sincronizar números:", err);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Números</h1>
        <p className="page-subtitle">
          Gerencie os números conectados à sua conta WhatsApp Business.
        </p>

        <button
          className="btn-primary"
          onClick={handleSync}
          disabled={syncing}
          style={{ marginTop: "12px" }}
        >
          {syncing ? "Sincronizando..." : "Sincronizar com WhatsApp"}
        </button>
      </div>

      <div className="numbers-table-card">
        <table className="numbers-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Canal</th>
              <th>Número</th>
              <th>Qualidade</th>
              <th>Limite de mensagens</th>
              <th>Status</th>
              <th>Última atualização</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="loading-cell">
                  Carregando números...
                </td>
              </tr>
            ) : numbers.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  Nenhum número encontrado.
                </td>
              </tr>
            ) : (
              numbers.map((n) => (
                <tr key={n.displayNumber || n.name}>
                  <td className="cell-bold">{n.name}</td>
                  <td>WhatsApp</td>
                  <td>{n.displayNumber}</td>
                  <td>
                    <span
                      className={`quality-dot ${
                        n.quality ? n.quality.toLowerCase() : ""
                      }`}
                    />
                    {n.quality}
                  </td>
                  <td>
                    {n.limitPerDay
                      ? `${n.limitPerDay} / 24hs`
                      : "–"}
                  </td>
                  <td className={n.connected ? "status-ok" : "status-error"}>
                    {n.connected ? "Conectado" : "Desconectado"}
                  </td>
                  <td>{n.updatedAt || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
