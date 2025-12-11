// src/outbound/MediaLibrary.jsx
import { useEffect, useState } from "react";
import {
  fetchMediaLibrary,
  createMediaItem,
} from "../api";

const MEDIA_TYPES = ["image", "video", "document", "audio"];

export default function MediaLibrary() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [label, setLabel] = useState("");
  const [type, setType] = useState("image");
  const [url, setUrl] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchMediaLibrary();
      setItems(data || []);
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar biblioteca de mídia");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!label || !url) {
      alert("Nome e URL são obrigatórios");
      return;
    }

    try {
      const created = await createMediaItem({ label, type, url });
      setItems((prev) => [created, ...prev]);
      setLabel("");
      setUrl("");
      setType("image");
    } catch (err) {
      console.error(err);
      alert("Erro ao cadastrar mídia");
    }
  }

  return (
    <div className="outbound-section">
      <h2>Biblioteca de Mídia</h2>

      <form className="form-grid" onSubmit={handleCreate}>
        <div>
          <label>Nome interno</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Banner promoção ovos férteis"
          />
        </div>

        <div>
          <label>Tipo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {MEDIA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="form-full">
          <label>URL pública da mídia</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://exemplo.com/arquivo.jpg"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            Cadastrar mídia
          </button>
        </div>
      </form>

      <div className="section-header">
        <h3>Arquivos cadastrados</h3>
        {loading && <span>Carregando...</span>}
      </div>

      {items.length === 0 ? (
        <p>Nenhuma mídia cadastrada ainda.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>URL</th>
              <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td>{m.label}</td>
                <td>{m.type}</td>
                <td>
                  <a href={m.url} target="_blank" rel="noreferrer">
                    Abrir
                  </a>
                </td>
                <td>
                  {m.createdAt
                    ? new Date(m.createdAt).toLocaleString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
