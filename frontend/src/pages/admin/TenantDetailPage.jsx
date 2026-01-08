import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchTenant, updateTenant } from "../../api/admin.js";
import "../../styles/admin.css";

export default function TenantDetailPage() {
  const nav = useNavigate();
  const { id: rawId } = useParams();

  const id = useMemo(() => String(rawId || "").trim(), [rawId]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

  // ✅ se vier /admin/cadastros/:id (literal) ou id inválido, volta
  useEffect(() => {
    if (!id || id === "id" || id === ":id" || id.includes(":")) {
      nav("/admin/cadastros", { replace: true });
    }
  }, [id, nav]);

  async function load() {
    if (!id || id === "id" || id === ":id" || id.includes(":")) return;

    setErr("");
    setOk("");
    setLoading(true);
    try {
      const resp = await fetchTenant(id);
      const data = resp?.data || resp || {};
      const t = data?.tenant || data;

      setName(String(t?.name || ""));
      setSlug(String(t?.slug || ""));
      setIsActive(t?.isActive !== false);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Falha ao carregar tenant.";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSave(e) {
    e.preventDefault();
    setErr("");
    setOk("");

    const cleanName = name.trim();
    const cleanSlug = slug.trim();

    if (!cleanName) return setErr("Informe o nome do tenant.");
    if (!id) return setErr("ID inválido.");

    setSaving(true);
    try {
      const payload = {
        name: cleanName,
        slug: cleanSlug ? cleanSlug : undefined,
        isActive: Boolean(isActive)
      };

      await updateTenant(id, payload);
      setOk("Salvo com sucesso ✅");
    } catch (e2) {
      const msg =
        e2?.response?.data?.error ||
        e2?.response?.data?.message ||
        e2?.message ||
        "Falha ao salvar.";
      setErr(String(msg));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="admin-header-row">
        <h1 className="admin-h1">Editar Empresa</h1>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={() => nav("/admin/cadastros")}>
            Voltar
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      {ok && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {ok}
        </div>
      )}

      {loading ? (
        <div className="admin-badge">Carregando...</div>
      ) : (
        <form className="admin-form" onSubmit={onSave}>
          <div>
            <label className="admin-label">Nome do tenant</label>
            <input className="admin-field" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="admin-label">Slug</label>
            <input className="admin-field" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>

          <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
            <label className="admin-label" style={{ margin: 0 }}>
              Ativo
            </label>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          </div>

          <div className="full admin-row" style={{ gap: 8 }}>
            <button className="admin-primary" disabled={saving} type="submit">
              {saving ? "Salvando..." : "Salvar"}
            </button>

            <button className="admin-link" type="button" onClick={() => load()} disabled={saving}>
              Recarregar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
