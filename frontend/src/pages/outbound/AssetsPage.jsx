// frontend/src/pages/outbound/AssetsPage.jsx
import { useEffect, useState } from "react";
import "../../styles/assets.css";

import {
  fetchMediaLibrary, // ✅ nome correto da API
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
      const res = await fetchMediaLibrary();
      setAssets(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error(e);
      setErr("Erro ao carregar arquivos.");
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
      loadAssets();
    } catch (e) {
      alert("Erro ao enviar arquivo.");
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Deseja remover este arquivo?")) return;

    try {
      await deleteAsset(id);
      loadAssets();
    } catch (e) {
      alert("Erro ao excluir arquivo.");
    }
  }

  function copyLink(url) {
    navigator.clipboard.writeText(url);
    alert("Link copiado!");
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
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name || a.label || "-"}</td>
                    <td>{a.type}</td>
                    <td>
                      {a.size
                        ? `${(a.size / 1024).toFixed(1)} KB`
                        : "-"}
                    </td>
                    <td className="mono">
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {a.url}
                      </a>
                    </td>
                    <td className="actions">
                      <button onClick={() => copyLink(a.url)}>Copiar</button>
                      <button
                        className="danger"
                        onClick={() => handleDelete(a.id)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
