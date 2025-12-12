import { useEffect, useMemo, useState } from "react";
import {
  createOptOut,
  deleteOptOut,
  downloadOptOutExport,
  fetchOptOut,
  fetchOptOutWhatsAppContacts,
  importOptOutCSV
} from "../../api";
import type { OptOutSource, WhatsAppContactLite } from "../../types";
import "../../styles/optout.css";

const SOURCES: Array<{ label: string; value: "" | OptOutSource }> = [
  { label: "Todas", value: "" },
  { label: "Manual", value: "manual" },
  { label: "CSV", value: "csv" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Flow", value: "flow" },
  { label: "Webhook", value: "webhook" }
];

function safeArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export default function OptOutPage() {
  const [tab, setTab] = useState<"list" | "manual" | "csv" | "wa">("list");

  // filtros
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // listagem
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // manual
  const [mPhone, setMPhone] = useState("");
  const [mName, setMName] = useState("");
  const [mReason, setMReason] = useState("");

  // csv
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any>(null);

  // wa contacts
  const [waSearch, setWaSearch] = useState("");
  const [waLoading, setWaLoading] = useState(false);
  const [waContacts, setWaContacts] = useState<WhatsAppContactLite[]>([]);
  const [waError, setWaError] = useState("");

  const filtersKey = useMemo(
    () => JSON.stringify({ page, limit, search, source, from, to }),
    [page, limit, search, source, from, to]
  );

  async function loadList() {
    setLoading(true);
    setError("");

    try {
      const res: any = await fetchOptOut({ page, limit, search, source, from, to });

      // ✅ compatibilidade: backend pode devolver "data" ou "items"
      const list = safeArray(res?.data ?? res?.items ?? res);
      const totalCount = Number(res?.total ?? (Array.isArray(res) ? res.length : 0)) || 0;

      setItems(list);
      setTotal(totalCount);

      // se backend devolver page/limit, mantém sincronizado
      if (typeof res?.page === "number") setPage(res.page);
      if (typeof res?.limit === "number") setLimit(res.limit);
    } catch (e: any) {
      setItems([]);
      setTotal(0);
      setError(e?.message || "Erro ao carregar opt-out.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  async function handleDelete(id: string) {
    if (!confirm("Deseja remover este opt-out?")) return;
    try {
      await deleteOptOut(id);
      await loadList();
    } catch (e: any) {
      alert(e?.message || "Erro ao deletar.");
    }
  }

  async function handleCreateManual() {
    setError("");
    try {
      await createOptOut({
        phone: mPhone,
        name: mName || null,
        reason: mReason || null,
        source: "manual"
      });

      setMPhone("");
      setMName("");
      setMReason("");
      setTab("list");
      await loadList();
    } catch (e: any) {
      alert(e?.message || "Erro ao criar opt-out.");
    }
  }

  async function handleImportCSV() {
    if (!csvFile) return;
    setError("");
    setImportResult(null);

    try {
      const res = await importOptOutCSV(csvFile);
      setImportResult(res);
      await loadList();
    } catch (e: any) {
      alert(e?.message || "Erro ao importar CSV.");
    }
  }

  async function handleExport() {
    try {
      await downloadOptOutExport({ search, source, from, to });
    } catch (e: any) {
      alert(e?.message || "Erro ao baixar CSV.");
    }
  }

  async function loadWaContacts() {
    setWaLoading(true);
    setWaError("");

    try {
      const res: any = await fetchOptOutWhatsAppContacts(waSearch);

      // ✅ compatibilidade: pode vir res.items ou res.data ou array puro
      const list = safeArray<WhatsAppContactLite>(res?.items ?? res?.data ?? res);
      setWaContacts(list);
    } catch (e: any) {
      setWaContacts([]);
      setWaError(e?.message || "Erro ao carregar contatos.");
    } finally {
      setWaLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "wa") loadWaContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function addFromWA(c: WhatsAppContactLite) {
    try {
      await createOptOut({
        phone: c.phone,
        name: c.name,
        reason: "user_request",
        source: "whatsapp",
        sourceRef: "whatsapp_contacts"
      });

      await loadWaContacts();
      await loadList();
      alert("Opt-out criado ✅");
    } catch (e: any) {
      alert(e?.message || "Erro ao criar opt-out.");
    }
  }

  const safeLimit = Number(limit) > 0 ? Number(limit) : 25;
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / safeLimit));

  return (
    <div className="page optout-page">
      <div className="page-header">
        <div>
          <h1>Opt-Out</h1>
          <div className="page-subtitle">
            Gerencie contatos que não devem receber campanhas ou mensagens.
          </div>
        </div>

        <div className="header-actions">
          <button className="btn" onClick={() => setTab("manual")}>
            + Adicionar
          </button>
          <button className="btn" onClick={() => setTab("csv")}>
            Importar CSV
          </button>
          <button className="btn" onClick={() => setTab("wa")}>
            Contatos WhatsApp
          </button>
        </div>
      </div>

      <div className="tabs">
        <button
          className={tab === "list" ? "tab active" : "tab"}
          onClick={() => setTab("list")}
        >
          Lista
        </button>
        <button
          className={tab === "manual" ? "tab active" : "tab"}
          onClick={() => setTab("manual")}
        >
          Manual
        </button>
        <button
          className={tab === "csv" ? "tab active" : "tab"}
          onClick={() => setTab("csv")}
        >
          CSV
        </button>
        <button
          className={tab === "wa" ? "tab active" : "tab"}
          onClick={() => setTab("wa")}
        >
          WhatsApp
        </button>
      </div>

      {tab === "list" && (
        <>
          <div className="card filters">
            <div className="field">
              <label>Buscar</label>
              <input
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                placeholder="Telefone, nome, motivo..."
              />
            </div>

            <div className="field">
              <label>Origem</label>
              <select
                value={source}
                onChange={(e) => {
                  setPage(1);
                  setSource(e.target.value);
                }}
              >
                {SOURCES.map((s) => (
                  <option key={s.label} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>De</label>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
              />
            </div>

            <div className="field">
              <label>Até</label>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
              />
            </div>

            <div className="field actions">
              <label>&nbsp;</label>
              <button className="btn secondary" onClick={handleExport}>
                Baixar report (CSV)
              </button>
            </div>
          </div>

          {error && <div className="alert error">{error}</div>}

          <div className="card table-card">
            <div className="table-head">
              <div className="table-title">
                Registros: <b>{Number(total) || 0}</b>
              </div>

              <div className="pager">
                <select
                  value={limit}
                  onChange={(e) => {
                    setPage(1);
                    setLimit(Number(e.target.value));
                  }}
                >
                  {[10, 25, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}/página
                    </option>
                  ))}
                </select>

                <button
                  className="btn ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ←
                </button>
                <div className="page-indicator">
                  {page} / {totalPages}
                </div>
                <button
                  className="btn ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  →
                </button>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Telefone</th>
                  <th>Nome</th>
                  <th>Origem</th>
                  <th>Motivo</th>
                  <th>Criado em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Carregando...
                    </td>
                  </tr>
                ) : safeArray(items).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Nenhum registro.
                    </td>
                  </tr>
                ) : (
                  safeArray(items).map((it: any) => (
                    <tr key={it.id}>
                      <td className="mono">{it.phone}</td>
                      <td>{it.name || "—"}</td>
                      <td>
                        <span className="pill">{it.source}</span>
                        {it.sourceRef ? (
                          <span className="pill subtle">{it.sourceRef}</span>
                        ) : null}
                      </td>
                      <td>{it.reason || "—"}</td>
                      <td className="mono">
                        {it.createdAt ? new Date(it.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="right">
                        <button
                          className="btn danger ghost"
                          onClick={() => handleDelete(it.id)}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "manual" && (
        <div className="card form-card">
          <h2>Adicionar Opt-Out</h2>

          <div className="grid">
            <div className="field">
              <label>Telefone</label>
              <input
                value={mPhone}
                onChange={(e) => setMPhone(e.target.value)}
                placeholder="Ex: 64999989978"
              />
            </div>

            <div className="field">
              <label>Nome (opcional)</label>
              <input
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                placeholder="Cliente"
              />
            </div>

            <div className="field full">
              <label>Motivo (opcional)</label>
              <input
                value={mReason}
                onChange={(e) => setMReason(e.target.value)}
                placeholder="Ex: solicitou parar"
              />
            </div>
          </div>

          <div className="row">
            <button className="btn secondary" onClick={() => setTab("list")}>
              Cancelar
            </button>
            <button className="btn" onClick={handleCreateManual} disabled={!mPhone.trim()}>
              Salvar
            </button>
          </div>
        </div>
      )}

      {tab === "csv" && (
        <div className="card form-card">
          <h2>Importar CSV</h2>
          <div className="muted">
            Colunas aceitas: <b>phone</b>/<b>telefone</b>/<b>numero</b> e opcional{" "}
            <b>name</b>/<b>nome</b>, <b>reason</b>/<b>motivo</b>.
          </div>

          <div className="row">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            />
            <button className="btn" onClick={handleImportCSV} disabled={!csvFile}>
              Importar
            </button>
          </div>

          {importResult && (
            <div className="alert ok">
              Importação concluída ✅ Inseridos: <b>{importResult.inserted}</b> — Duplicados:{" "}
              <b>{importResult.skipped_duplicates}</b> — Inválidos: <b>{importResult.invalid}</b>
            </div>
          )}

          {importResult?.invalidRows?.length ? (
            <div className="card inner">
              <h3>Linhas inválidas</h3>
              <ul className="small">
                {importResult.invalidRows.slice(0, 30).map((r: any) => (
                  <li key={`${r.row}-${r.value}`}>
                    Linha {r.row}: <span className="mono">{String(r.value)}</span> ({r.error})
                  </li>
                ))}
              </ul>
              {importResult.invalidRows.length > 30 ? (
                <div className="muted">Mostrando 30 de {importResult.invalidRows.length}…</div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {tab === "wa" && (
        <div className="card form-card">
          <h2>Contatos do WhatsApp</h2>
          <div className="row">
            <input
              value={waSearch}
              onChange={(e) => setWaSearch(e.target.value)}
              placeholder="Buscar por telefone ou nome..."
            />
            <button className="btn secondary" onClick={loadWaContacts}>
              Buscar
            </button>
          </div>

          {waError && <div className="alert error">{waError}</div>}

          <div className="card inner">
            {waLoading ? (
              <div className="muted">Carregando...</div>
            ) : waContacts.length === 0 ? (
              <div className="muted">
                Nenhum contato disponível (ou todos já estão em opt-out).
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Telefone</th>
                    <th>Nome</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {waContacts.map((c) => (
                    <tr key={c.phone}>
                      <td className="mono">{c.phone}</td>
                      <td>{c.name || "—"}</td>
                      <td className="right">
                        <button className="btn" onClick={() => addFromWA(c)}>
                          Adicionar Opt-Out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

