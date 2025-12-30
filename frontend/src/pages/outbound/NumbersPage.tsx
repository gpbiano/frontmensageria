// frontend/src/pages/outbound/NumbersPage.tsx

import { useEffect, useState } from "react";
import { fetchNumbers, syncNumbers } from "../../api";
import "../../styles/outbound.css";

type BackendNumber = {
  id?: string;
  tenantId?: string;

  // vindo do backend
  phoneE164?: string;
  provider?: string;
  isActive?: boolean;
  metadata?: any;
  createdAt?: string;
  updatedAt?: string;

  // compat (caso já exista no seu types antigo)
  name?: string;
  displayNumber?: string;
  quality?: string;
  limitPerDay?: number;
  connected?: boolean;
};

type NormalizedNumber = {
  key: string;
  name: string;
  displayNumber: string;
  quality: string | null;
  limitPerDay: number | null;
  connected: boolean;
  updatedAt: string;
};

export default function NumbersPage() {
  const [numbers, setNumbers] = useState<NormalizedNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  function toPtBrDate(iso?: string) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR");
  }

  function normalize(list: BackendNumber[]): NormalizedNumber[] {
    return list.map((n, idx) => {
      const md = n?.metadata || {};

      const phone =
        md.displayPhoneNumber ||
        md.display_phone_number ||
        n.displayNumber ||
        n.phoneE164 ||
        "—";

      const name =
        md.verifiedName ||
        md.verified_name ||
        md.displayPhoneNumber ||
        n.name ||
        phone;

      const quality =
        md.qualityRating ||
        md.quality_rating ||
        n.quality ||
        null;

      const connected =
        typeof n.connected === "boolean"
          ? n.connected
          : Boolean(n.isActive);

      const key =
        n.id ||
        n.phoneE164 ||
        md.metaPhoneNumberId ||
        `${phone}_${idx}`;

      return {
        key,
        name,
        displayNumber: phone,
        quality: quality ? String(quality) : null,
        limitPerDay: typeof n.limitPerDay === "number" ? n.limitPerDay : null,
        connected,
        updatedAt: toPtBrDate(n.updatedAt)
      };
    });
  }

  async function load() {
    setLoading(true);
    try {
      const res: any = await fetchNumbers();

      // ✅ backend pode retornar array direto OU { items } OU { numbers }
      const list: BackendNumber[] =
        Array.isArray(res)
          ? res
          : Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.numbers)
          ? res.numbers
          : [];

      setNumbers(normalize(list));
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
                <tr key={n.key}>
                  <td className="cell-bold">{n.name}</td>
                  <td>WhatsApp</td>
                  <td>{n.displayNumber}</td>
                  <td>
                    {n.quality ? (
                      <>
                        <span className={`quality-dot ${n.quality.toLowerCase()}`} />
                        {n.quality}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{n.limitPerDay ? `${n.limitPerDay} / 24hs` : "—"}</td>
                  <td className={n.connected ? "status-ok" : "status-error"}>
                    {n.connected ? "Conectado" : "Desconectado"}
                  </td>
                  <td>{n.updatedAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
