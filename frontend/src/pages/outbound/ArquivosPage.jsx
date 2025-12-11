// frontend/src/outbound/ArquivosPage.jsx
import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

export default function ArquivosPage() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);

  // ===========================
  // LOAD
  // ===========================
  async function loadAssets() {
    try {
      setLoading(true);
      setError("");

      const resp = await fetch(`${API_BASE}/outbound/assets`);
      if (!resp.ok) {
        throw new Error("Erro ao carregar arquivos");
      }

      const data = await resp.json();
      setAssets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError("Não foi possível carregar os arquivos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, []);

  // ===========================
  // UPLOAD
  // ===========================
  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    if (!selected) {
      setFile(null);
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      alert("Arquivo maior que 1 MB. Escolha um arquivo menor.");
      e.target.value = "";
      setFile(null);
      return;
    }

    setFile(selected);
  }

  async function handleUpload(e) {
    e.preventDefault();

    if (!file) {
      alert("Selecione um arquivo para enviar.");
      return;
    }

    try {
      setUploading(true);
      setError("");

      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/outbound/assets`, {
        method: "POST",
        body: formData
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        console.error("Erro ao fazer upload", data);
        throw new Error(data.error || "Erro ao enviar arquivo");
      }

      const saved = await resp.json();
      // adiciona no topo da lista
      setAssets((prev) => [saved, ...(prev || [])]);
      setFile(null);
      (document.getElementById("file-input") || {}).value = "";

      alert("Arquivo enviado com sucesso ✅");
    } catch (err) {
      console.error(err);
      setError(err.message || "Erro ao enviar arquivo.");
      alert("Erro ao enviar arquivo.");
    } finally {
      setUploading(false);
    }
  }

  // ===========================
  // DELETE
  // ===========================
  async function handleDelete(id) {
    if (!window.confirm("Tem certeza que deseja apagar este arquivo?")) {
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/outbound/assets/${id}`, {
        method: "DELETE"
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        console.error("Erro ao apagar arquivo", data);
        throw new Error(data.error || "Erro ao apagar arquivo");
      }

      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error(err);
      alert("Erro ao apagar arquivo.");
    }
  }

  // helper pra montar URL absoluta
  function getPublicUrl(asset) {
    if (!asset?.url) return "-";
    const base = API_BASE.replace(/\/$/, "");
    return `${base}${asset.url}`;
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(iso) {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  // ===========================
  // RENDER
  // ===========================
  return (
    <div className="page arquivos-page">
      <header className="page-header">
        <div>
          <h1>Arquivos</h1>
          <p className="page-subtitle">
            Biblioteca de arquivos utilizados em campanhas (imagens, PDFs,
            vídeos, etc.). Envie arquivos de até 1 MB e use a URL gerada nas
            mensagens da sua conta GP Labs.
          </p>
        </div>
      </header>

      <section className="card upload-card">
        <h2>Enviar novo arquivo</h2>
        <p className="card-subtitle">
          Você pode arrastar e soltar o arquivo ou escolher do seu dispositivo.
          Tamanho máximo: <strong>1 MB</strong>. Formatos comuns aceitos:
          imagens (JPG, PNG), documentos (PDF) e vídeos leves (MP4).
        </p>

        <form className="upload-form" onSubmit={handleUpload}>
          <div className="upload-row">
            <input id="file-input" type="file" onChange={handleFileChange} />
            <button
              type="submit"
              className="primary-btn"
              disabled={uploading}
            >
              {uploading ? "Enviando..." : "Carregar arquivo"}
            </button>
          </div>
          {file && (
            <p className="upload-hint">
              Selecionado: <strong>{file.name}</strong> (
              {formatSize(file.size)})
            </p>
          )}
        </form>
      </section>

      <section className="card assets-table-card">
        <h2>Arquivos já enviados</h2>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p>Carregando arquivos...</p>
        ) : !assets || assets.length === 0 ? (
          <p className="empty-text">
            Nenhum arquivo enviado ainda. Use o formulário acima para subir sua
            primeira mídia.
          </p>
        ) : (
          <table className="templates-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Tamanho</th>
                <th>Data de upload</th>
                <th>URL</th>
                <th className="col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const url = getPublicUrl(asset);
                return (
                  <tr key={asset.id}>
                    <td>{asset.name}</td>
                    <td>{asset.type || "-"}</td>
                    <td>{formatSize(asset.size)}</td>
                    <td>{formatDate(asset.uploadedAt)}</td>
                    <td>
                      {url === "-" ? (
                        "-"
                      ) : (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="link-small"
                        >
                          Abrir
                        </a>
                      )}
                    </td>
                    <td className="col-acoes">
                      <button
                        type="button"
                        className="icon-table-btn danger"
                        title="Excluir"
                        onClick={() => handleDelete(asset.id)}
                      >
                        🗑️
                      </button>
                    </td>
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
