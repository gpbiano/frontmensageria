// frontend/src/pages/outbound/TemplatesPage.tsx
import { useEffect, useState } from "react";
import type { Template, TemplateComponent } from "../../types";
import { fetchTemplates, syncTemplates } from "../../api";
import TemplatesCreatePage from "./TemplatesCreatePage";
import "../../styles/outbound.css";

/* ======================================
   MAPAS PT-BR
====================================== */

const CATEGORY_PTBR: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação"
};

const STATUS_PTBR: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado"
};

function formatDateBR(dateString?: string) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

type TemplatesViewMode = "list" | "create";

/* ======================================
   PÁGINA
====================================== */

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [mode, setMode] = useState<TemplatesViewMode>("list");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchTemplates();
      setTemplates(data || []);

      if (!selected && data && data.length > 0) {
        setSelected(data[0]);
      }
    } catch (err) {
      console.error("Erro ao carregar templates:", err);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncTemplates();
      await load();
    } catch (err) {
      console.error("Erro ao sincronizar:", err);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================== MODO CRIAÇÃO ==================
  if (mode === "create") {
    return (
      <div className="page-full">
        <TemplatesCreatePage onBack={() => setMode("list")} />
      </div>
    );
  }

  // ================== MODO LISTA ==================
  return (
    <div className="page-content templates-layout">
      <div className="page-header">
        <h1>Templates</h1>
        <p className="page-subtitle">
          Espelho dos templates aprovados na sua conta WhatsApp Business.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn-primary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "Sincronizando..." : "Sincronizar com WhatsApp"}
          </button>

          <button
            className="btn-secondary"
            type="button"
            onClick={() => setMode("create")}
          >
            Criar modelo
          </button>
        </div>
      </div>

      <div className="templates-columns">
        {/* LISTA */}
        <div className="templates-table-card">
          <table className="templates-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Idioma</th>
                <th>Status</th>
                <th>Qualidade</th>
                <th>Flow</th>
                <th>Atualizado em</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="loading-cell">
                    Carregando templates...
                  </td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Nenhum template encontrado.
                  </td>
                </tr>
              ) : (
                templates.map((tpl) => {
                  const isActive = selected?.id === tpl.id;
                  return (
                    <tr
                      key={tpl.id}
                      className={
                        "templates-row" + (isActive ? " templates-row-active" : "")
                      }
                      onClick={() => setSelected(tpl)}
                    >
                      <td className="cell-bold">{tpl.name}</td>
                      <td>{CATEGORY_PTBR[tpl.category || ""] || "—"}</td>
                      <td>{tpl.language?.toUpperCase() || "—"}</td>
                      <td>{STATUS_PTBR[tpl.status || ""] || "—"}</td>
                      <td>{tpl.quality || "—"}</td>
                      <td>{tpl.hasFlow ? "Sim" : "—"}</td>
                      <td>{formatDateBR(tpl.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PREVIEW */}
        <div className="template-preview-card">
          {selected ? (
            <TemplatePreview template={selected} />
          ) : (
            <div className="page-placeholder">
              <h3 style={{ marginBottom: 8 }}>Pré-visualização</h3>
              <p>Selecione um template ou clique em “Criar modelo”.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================================
   PREVIEW – CARTÃO WHATSAPP
====================================== */

function TemplatePreview({ template }: { template: Template }) {
  const components = template.components || [];
  const header = findComponent(components, "HEADER");
  const body = findComponent(components, "BODY");
  const footer = findComponent(components, "FOOTER");
  const buttons = findComponent(components, "BUTTONS");

  const categoria = CATEGORY_PTBR[template.category || ""] || "—";
  const status = STATUS_PTBR[template.status || ""] || "—";
  const idioma = template.language?.toUpperCase() || "—";

  return (
    <div className="template-preview">
      <div className="template-preview-header">
        <h3>{template.name}</h3>

        <div className="template-badges">
          <span className="pill pill-soft">{categoria}</span>
          <span className="pill pill-soft">{idioma}</span>
          <span className="pill pill-status">{status}</span>
        </div>
      </div>

      <div className="phone-preview">
        <div className="phone-header">WhatsApp</div>
        <div className="phone-screen">
          <div className="phone-bubble phone-bubble-template">
            {header && (
              <div className="phone-header-section">
                {(header as any).text ||
                  (header as any).format === "IMAGE"
                  ? "[Imagem]"
                  : (header as any).format === "DOCUMENT"
                  ? "[Documento]"
                  : (header as any).format === "VIDEO"
                  ? "[Vídeo]"
                  : "[Cabeçalho]"}
              </div>
            )}

            {body && (
              <div className="phone-body-section">
                {renderBodyText(((body as any).text as string) || "")}
              </div>
            )}

            {footer && (
              <div className="phone-footer-section">
                {(footer as any).text}
              </div>
            )}

            {buttons && Array.isArray((buttons as any).buttons) && (
              <div className="phone-buttons">
                {(buttons as any).buttons.map((btn: any, idx: number) => (
                  <button key={idx} className="phone-button">
                    {btn.text || "Botão"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ======================================
   HELPERS
====================================== */

function findComponent(
  components: TemplateComponent[],
  type: string
): TemplateComponent | undefined {
  return components.find(
    (c) => c.type && c.type.toUpperCase() === type.toUpperCase()
  );
}

function renderBodyText(text: string) {
  const parts = text.split(/(\{\{\d+\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{\{\d+\}\}$/.test(p) ? (
          <span key={i} className="body-variable">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}
