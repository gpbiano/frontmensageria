// src/outbound/TemplatesPage.jsx
import { useEffect, useState } from "react";
import {
  fetchTemplates,
  createTemplate,
  fetchMediaLibrary,
} from "../api";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("text"); // text | media
  const [mediaId, setMediaId] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        fetchTemplates(),
        fetchMediaLibrary(),
      ]);
      setTemplates(t || []);
      setMedia(m || []);
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar templates/mídias");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name || !body) {
      alert("Nome e corpo são obrigatórios");
      return;
    }

    try {
      const payload = { name, body, type };
      if (type === "media" && mediaId) {
        payload.mediaId = Number(mediaId);
      }

      const created = await createTemplate(payload);
      setTemplates((prev) => [created, ...prev]);
      setName("");
      setBody("");
      setType("text");
      setMediaId("");
    } catch (err) {
      console.error(err);
      alert("Erro ao criar template");
    }
  }

  return (
    <div className="outbound-section">
      <h2>Templates de Mensagem</h2>

      <form className="form-grid" onSubmit={handleCreate}>
        <div>
          <label>Nome do template</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Boas-vindas padrão"
          />
        </div>

        <div>
          <label>Tipo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="text">Texto</option>
            <option value="media">Mídia + texto</option>
          </select>
        </div>

        {type === "media" && (
          <div>
            <label>Mídia vinculada</label>
            <select
              value={mediaId}
              onChange={(e) => setMediaId(e.target.value)}
            >
              <option value="">Selecione uma mídia</option>
              {media.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.type}] {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-full">
          <label>
            Corpo da mensagem{" "}
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              (pode usar placeholders, ex.: {"{{nome}}"})
            </span>
          </label>
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Olá {{nome}}, seja bem-vindo(a) ao Criatório Peres!"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            Criar template
          </button>
        </div>
      </form>

      <div className="section-header">
        <h3>Lista de templates</h3>
        {loading && <span>Carregando...</span>}
      </div>

      {templates.length === 0 ? (
        <p>Nenhum template cadastrado ainda.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Mídia</th>
              <th>Prévia</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const m =
                t.type === "media" && t.mediaId
                  ? media.find((mm) => mm.id === t.mediaId)
                  : undefined;
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.type}</td>
                  <td>{m ? `[${m.type}] ${m.label}` : "-"}</td>
                  <td>
                    <code>{t.body}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
