// frontend/src/pages/outbound/AssetsPage.jsx
import { useEffect, useState } from "react";
import "../../styles/assets.css";

import {
  fetchAssets, // ✅ usa o export real da API (evita erro de "não exporta")
  uploadAsset,
  deleteAsset
} from "../../api";

export default function AssetsPage() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function loadAssets() {
    setLoading(true);
    setErr("");

    try {
      const res = await fetchAssets();
      setAssets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error(e);
      setErr("Erro ao carregar arquivos.");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, []);

  async function handleUpload(file) {
    if (!file) return;

    try {
      await uploadAsset(file);
      await loadAssets();
    } catch (e) {
      console.error(e);
      alert("Erro ao enviar arquivo.");
    }
  }

  async function handleDelete(id) {
    if (!id) return;
    if (!window.confirm("Deseja remover este arquivo?")) return;

    try {
      await deleteAsset(id);
      await loadAssets();
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir arquivo.");
    }
  }

  async function copyLink(url) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado!");
    } catch (e) {
      console.error(e);
      alert("Não foi possível copiar o link.");
    }
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "-";
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  return (
    <div className="assets-page">
      <div className="assets-header">
        <h1>Arquivos</h1>

        <label className="assets-upload-btn">
          + Carregar novo ativo
          <input
            type="file"
            hidden
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
        </label>
      </div>

      {loading ? (
        <div className="card">Carregando arquivos…</div>
      ) : err ? (
        <div className="card error">{err}</div>
      ) : (
        <div className="card">
          {assets.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Nenhum arquivo enviado ainda.</div>
          ) : (
            <table className="assets-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Tamanho</th>
                  <th>URL</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const name = a.name || a.label || a.filename || "-";
                  const type = a.type || a.mimeType || "-";
                  const size = a.size ?? a.bytes ?? null;
                  const url = a.url || a.publicUrl || a.link || "";

                  return (
                    <tr key={a.id ?? url ?? name}>
                      <td>{name}</td>
                      <td>{type}</td>
                      <td>{formatSize(size)}</td>
                      <td className="mono">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="actions">
                        <button onClick={() => copyLink(url)} disabled={!url}>
                          Copiar
                        </button>
                        <button
                          className="danger"
                          onClick={() => handleDelete(a.id)}
                          disabled={!a.id}
                          title={!a.id ? "Item sem id para excluir" : "Excluir"}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
