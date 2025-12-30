// frontend/src/pages/outbound/TemplatesPage.tsx

import { useEffect, useMemo, useState } from "react";
import { fetchTemplates, syncTemplates } from "../../api";
import TemplatesCreatePage from "./TemplatesCreatePage";
import "../../styles/outbound.css";

type TemplatesViewMode = "list" | "create";

/**
 * ✅ Backend hoje retorna algo como:
 * {
 *   id, tenantId, channel: "whatsapp",
 *   name, language: null,
 *   status: "draft" | ...,
 *   content: null | {...},
 *   metadata: null | {...},
 *   createdAt, updatedAt
 * }
 *
 * Então a gente normaliza pra UI não depender de fields que não existem no schema.
 */
type BackendTemplate = {
  id?: string;
  tenantId?: string;
  channel?: string;

  name?: string;
  language?: string | null;
  status?: string | null;

  // pode vir null no schema atual
  content?: any;
  metadata?: any;

  createdAt?: string;
  updatedAt?: string;

  // compat (caso seu types antigo tenha isso)
  category?: string;
  quality?: string;
  components?: any[];
  hasFlow?: boolean;
};

type NormalizedTemplate = {
  id: string;
  name: string;

  category: string | null;
  language: string | null;
  status: string | null;
  quality: string | null;
  hasFlow: boolean;

  components: any[];
  updatedAt?: string;
  raw: BackendTemplate;
};

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
  PAUSED: "Pausado",
  DRAFT: "Rascunho"
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

function normUpper(v?: string | null) {
  const s = String(v || "").trim();
  return s ? s.toUpperCase() : "";
}

function safeId(tpl: BackendTemplate, idx: number) {
  return String(tpl?.id || tpl?.name || `tpl_${idx}`);
}

function normalizeTemplates(list: BackendTemplate[]): NormalizedTemplate[] {
  return list.map((tpl, idx) => {
    const md = tpl?.metadata || {};
    const ct = tpl?.content || {};

    const name = String(tpl?.name || md?.name || "").trim() || `template_${idx + 1}`;

    const language =
      tpl?.language ??
      ct?.language ??
      md?.language ??
      null;

    const statusRaw =
      tpl?.status ??
      ct?.status ??
      md?.status ??
      null;

    // 🔥 importante: UI deve aceitar "draft" (backend está salvando assim)
    const status = statusRaw ? normUpper(String(statusRaw)) : null;

    const categoryRaw =
      tpl?.category ??
      ct?.category ??
      md?.category ??
      null;

    const category = categoryRaw ? normUpper(String(categoryRaw)) : null;

    // quality pode vir como objeto ou string dependendo do Graph
    const qualityRaw =
      ct?.quality ??
      ct?.qualityScore ??
      md?.quality ??
      md?.quality_score ??
      null;

    const quality =
      typeof qualityRaw === "string"
        ? qualityRaw
        : qualityRaw?.quality_score || qualityRaw?.quality || null;

    // componentes podem estar em content.components ou metadata.raw.components
    const components =
      (Array.isArray(ct?.components) && ct.components) ||
      (Array.isArray(md?.raw?.components) && md.raw.components) ||
      (Array.isArray(tpl?.components) && tpl.components) ||
      [];

    // Flow: se tiver "FLOW" em qualquer componente, ou se tiver campo hasFlow
    const hasFlow =
      Boolean(tpl?.hasFlow) ||
      components.some((c: any) => String(c?.type || "").toUpperCase() === "FLOW");

    return {
      id: safeId(tpl, idx),
      name,
      category,
      language: language ? String(language) : null,
      status,
      quality: quality ? String(quality) : null,
      hasFlow,
      components,
      updatedAt: tpl?.updatedAt || tpl?.createdAt,
      raw: tpl
    };
  });
}

/* ======================================
   PÁGINA
====================================== */

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<NormalizedTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<TemplatesViewMode>("list");

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId]
  );

  async function load() {
    setLoading(true);
    try {
      const res: any = await fetchTemplates();

      const list: BackendTemplate[] =
        Array.isArray(res)
          ? res
          : Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.templates)
          ? res.templates
          : [];

      const normalized = normalizeTemplates(list);
      setTemplates(normalized);

      if (!selectedId && normalized.length > 0) {
        setSelectedId(normalized[0].id);
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
          Espelho dos templates da sua conta WhatsApp Business.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? "Sincronizando..." : "Sincronizar com WhatsApp"}
          </button>

          <button className="btn-secondary" type="button" onClick={() => setMode("create")}>
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
                  const categoryLabel =
                    tpl.category ? CATEGORY_PTBR[tpl.category] || tpl.category : "—";
                  const languageLabel = tpl.language ? tpl.language.toUpperCase() : "—";
                  const statusLabel =
                    tpl.status ? STATUS_PTBR[tpl.status] || tpl.status : "—";

                  return (
                    <tr
                      key={tpl.id}
                      className={"templates-row" + (isActive ? " templates-row-active" : "")}
                      onClick={() => setSelectedId(tpl.id)}
                    >
                      <td className="cell-bold">{tpl.name}</td>
                      <td>{categoryLabel || "—"}</td>
                      <td>{languageLabel}</td>
                      <td>{statusLabel}</td>
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

function TemplatePreview({ template }: { template: NormalizedTemplate }) {
  const components = template.components || [];
  const header = findComponent(components, "HEADER");
  const body = findComponent(components, "BODY");
  const footer = findComponent(components, "FOOTER");
  const buttons = findComponent(components, "BUTTONS");

  const categoria = template.category ? CATEGORY_PTBR[template.category] || template.category : "—";
  const status = template.status ? STATUS_PTBR[template.status] || template.status : "—";
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
                {((header as any).text && String((header as any).text)) ||
                (String((header as any).format || "").toUpperCase() === "IMAGE")
                  ? "[Imagem]"
                  : String((header as any).format || "").toUpperCase() === "DOCUMENT"
                  ? "[Documento]"
                  : String((header as any).format || "").toUpperCase() === "VIDEO"
                  ? "[Vídeo]"
                  : "[Cabeçalho]"}
              </div>
            )}

            {body && (
              <div className="phone-body-section">
                {renderBodyText(String((body as any).text || ""))}
              </div>
            )}

            {footer && (
              <div className="phone-footer-section">{String((footer as any).text || "")}</div>
            )}

            {buttons && Array.isArray((buttons as any).buttons) && (
              <div className="phone-buttons">
                {(buttons as any).buttons.map((btn: any, idx: number) => (
                  <button key={idx} className="phone-button">
                    {btn?.text || "Botão"}
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

function findComponent(components: any[], type: string) {
  return components.find(
    (c) => c?.type && String(c.type).toUpperCase() === type.toUpperCase()
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
