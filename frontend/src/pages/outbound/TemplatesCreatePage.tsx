// frontend/src/pages/outbound/TemplatesCreatePage.tsx
import { useMemo, useState, type FormEvent } from "react";
import { createTemplate } from "../../api";
import type { Template, TemplateComponent } from "../../types";
import "../../styles/templates-create.css";

type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

interface EditableButton {
  id: number;
  type: ButtonType;
  text: string;
  url?: string;
  urlExample?: string;
  phoneNumber?: string;
}

type BodyExamples = Record<number, string>;

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const LANGUAGES = [
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "pt_PT", label: "Português (Portugal)" },
  { value: "es_ES", label: "Español (España)" },
  { value: "en_US", label: "English (US)" }
];

function extractOrderedVars(text: string): number[] {
  if (!text) return [];
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  const indices = [...new Set(matches.map((m) => parseInt(m[1], 10)))];
  return indices.sort((a, b) => a - b);
}

function filenameSafe(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

interface TemplatesCreatePageProps {
  onBack?: () => void;
}

export default function TemplatesCreatePage({ onBack }: TemplatesCreatePageProps) {
  // CONFIG GERAL
  const [category, setCategory] = useState<string>("MARKETING");
  const [name, setName] = useState<string>("gplabs_template_");
  const [language, setLanguage] = useState<string>("pt_BR");

  // HEADER
  const [headerEnabled, setHeaderEnabled] = useState(false);
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>("TEXT");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");

  // Header mídia (Meta usa example.header_handle)
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");

  // BODY
  const [bodyText, setBodyText] = useState("Olá {{1}}, sua solicitação está em andamento.");
  const [bodyExamples, setBodyExamples] = useState<BodyExamples>({});

  // FOOTER
  const [footerText, setFooterText] = useState("");

  // BOTÕES
  const [buttons, setButtons] = useState<EditableButton[]>([]);

  // ESTADO GERAL
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const bodyVars = useMemo(() => extractOrderedVars(bodyText), [bodyText]);

  const headerHasVar = useMemo(() => /\{\{\d+\}\}/.test(headerText), [headerText]);

  const showHeaderTextFields = headerEnabled && headerFormat === "TEXT";
  const showHeaderMediaFields = headerEnabled && headerFormat !== "TEXT";

  function handleBodyExampleChange(index: number, value: string) {
    setBodyExamples((prev) => ({
      ...prev,
      [index]: value
    }));
  }

  function addButton(type: ButtonType) {
    setButtons((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        type,
        text:
          type === "QUICK_REPLY"
            ? "Responder"
            : type === "URL"
              ? "Abrir link"
              : "Ligar"
      }
    ]);
  }

  function updateButton(id: number, patch: Partial<EditableButton>) {
    setButtons((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeButton(id: number) {
    setButtons((prev) => prev.filter((b) => b.id !== id));
  }

  function handleAddVariableToBody() {
    const vars = extractOrderedVars(bodyText);
    const next = vars.length === 0 ? 1 : Math.max(...vars) + 1;
    setBodyText((old) => (old ? `${old} {{${next}}}` : `{{${next}}}`));
  }

  function handleBack() {
    if (onBack) onBack();
    else window.history.back();
  }

  function downloadVariablesCsv() {
    // CSV (Excel friendly) com ; e UTF-8
    // Inclui:
    // - header_text var (se header TEXT com var)
    // - body_text vars (sempre que existir)
    const rows: Array<{ scope: string; variable: string; example: string }> = [];

    if (headerEnabled && headerFormat === "TEXT" && headerHasVar) {
      // Meta permite 1 variável no header_text
      rows.push({
        scope: "header_text",
        variable: "{{1}}",
        example: headerExample || ""
      });
    }

    if (bodyVars.length > 0) {
      for (const idx of bodyVars) {
        rows.push({
          scope: "body_text",
          variable: `{{${idx}}}`,
          example: bodyExamples[idx] || ""
        });
      }
    }

    if (rows.length === 0) {
      setError("Nenhuma variável encontrada para exportar. Adicione {{1}}, {{2}}... no corpo (ou no cabeçalho).");
      return;
    }

    const header = ["scope", "variable", "example"].join(";");
    const lines = rows.map((r) => [r.scope, r.variable, String(r.example || "").replace(/\r?\n/g, " ")].join(";"));
    const csv = [header, ...lines].join("\n");

    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `template_variables_${filenameSafe(name || "modelo")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildComponents(): any[] {
    const components: any[] = [];

    // HEADER
    if (headerEnabled) {
      if (headerFormat === "TEXT") {
        if (headerText.trim()) {
          const headerComp: any = {
            type: "HEADER",
            format: "TEXT",
            text: headerText.trim()
          };

          // Exemplo obrigatório se tiver variável no header
          if (headerHasVar && headerExample.trim()) {
            headerComp.example = {
              header_text: [headerExample.trim()]
            };
          }

          components.push(headerComp);
        }
      } else {
        // MEDIA (IMAGE/VIDEO/DOCUMENT)
        const headerComp: any = {
          type: "HEADER",
          format: headerFormat
        };

        // Meta: example.header_handle: [ "https://..." ] (URL pública)
        if (headerMediaUrl.trim()) {
          headerComp.example = {
            header_handle: [headerMediaUrl.trim()]
          };
        }

        components.push(headerComp);
      }
    }

    // BODY – obrigatório
    const bodyComp: any = {
      type: "BODY",
      text: bodyText.trim()
    };

    if (bodyVars.length > 0) {
      const row = bodyVars.map((idx) => bodyExamples[idx] || "");
      bodyComp.example = {
        body_text: [row]
      };
    }

    components.push(bodyComp);

    // FOOTER – opcional
    if (footerText.trim()) {
      components.push({
        type: "FOOTER",
        text: footerText.trim()
      });
    }

    // BOTÕES – opcional
    if (buttons.length > 0) {
      const mappedButtons = buttons.map((b) => {
        if (b.type === "PHONE_NUMBER") {
          return {
            type: "PHONE_NUMBER",
            text: b.text || "Ligar",
            phone_number: b.phoneNumber || ""
          };
        }

        if (b.type === "URL") {
          const btn: any = {
            type: "URL",
            text: b.text || "Abrir link",
            url: b.url || ""
          };
          if (/\{\{\d+\}\}/.test(b.url || "") && b.urlExample) {
            btn.example = [b.urlExample];
          }
          return btn;
        }

        return {
          type: "QUICK_REPLY",
          text: b.text || "Responder"
        };
      });

      components.push({
        type: "BUTTONS",
        buttons: mappedButtons
      });
    }

    return components;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError("Defina um nome para o modelo.");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(name.trim())) {
      setError("O nome do modelo só pode conter letras minúsculas, números e underline (_). Sem espaços.");
      return;
    }

    if (!bodyText.trim()) {
      setError("O corpo da mensagem é obrigatório.");
      return;
    }

    // validações Meta (práticas)
    if (headerEnabled && headerFormat === "TEXT" && headerHasVar && !headerExample.trim()) {
      setError("Cabeçalho com variável exige exemplo (Meta).");
      return;
    }

    if (headerEnabled && headerFormat !== "TEXT" && !headerMediaUrl.trim()) {
      // na prática, Meta exige exemplo pro header mídia no create
      setError("Para cabeçalho com mídia, informe uma URL pública de exemplo do arquivo.");
      return;
    }

    if (bodyVars.length > 0) {
      const missing = bodyVars.filter((idx) => !(bodyExamples[idx] || "").trim());
      if (missing.length > 0) {
        setError(`Preencha exemplos para as variáveis do corpo: ${missing.map((i) => `{{${i}}}`).join(", ")}`);
        return;
      }
    }

    const payload = {
      name: name.trim(),
      category,
      language,
      components: buildComponents()
    };

    try {
      setSaving(true);

      const result = await createTemplate(payload);

      // Não confiar cegamente no formato da resposta
      let templateName = name.trim();
      if (result && typeof result === "object") {
        const r: any = result;
        const maybeName = r.name ?? r.template?.name ?? r.data?.name ?? r.message_template?.name;
        if (typeof maybeName === "string") {
          templateName = maybeName;
        }
      }

      setSuccess(`Modelo "${templateName}" criado/enviado para análise com sucesso!`);

      // limpa apenas estados sensíveis; mantém categoria/idioma/nome
      setHeaderEnabled(false);
      setHeaderFormat("TEXT");
      setHeaderText("");
      setHeaderExample("");
      setHeaderMediaUrl("");

      setFooterText("");
      setButtons([]);
      setBodyExamples({});
    } catch (err: any) {
      console.error("Erro ao criar template:", err);
      setError(err?.message || "Erro ao criar modelo. Verifique os campos e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  // Template "fake" só para preview
  const draftTemplate: Template = {
    id: 0,
    name: name || "seu_template_name",
    category,
    language,
    status: "DRAFT",
    quality: null as any,
    hasFlow: false,
    updatedAt: new Date().toISOString(),
    components: buildComponents()
  } as Template;

  return (
    <div className="templates-create-page">
      {/* Barra de topo */}
      <div className="templates-create-header">
        <div className="step-breadcrumb">
          <span className="step-badge step-badge-active">Configurar modelo</span>
          <span className="step-separator">·</span>
          <span className="step-badge">Editar modelo</span>
          <span className="step-separator">·</span>
          <span className="step-badge">Enviar para análise</span>
        </div>

        <div className="header-actions">
          <button type="button" className="btn-ghost" onClick={handleBack}>
            Voltar
          </button>
        </div>
      </div>

      {/* Layout 2 colunas */}
      <div className="templates-create-main">
        {/* COLUNA ESQUERDA – FORM */}
        <form className="templates-create-form" onSubmit={handleSubmit}>
          {/* CARD: Configurar modelo */}
          <section className="tc-card">
            <h2 className="tc-card-title">Configurar seu modelo</h2>

            <div className="tc-category-row">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={"tc-category-pill" + (category === cat ? " tc-category-pill-active" : "")}
                  onClick={() => setCategory(cat)}
                >
                  {cat === "MARKETING" && "Marketing"}
                  {cat === "UTILITY" && "Utilidade"}
                  {cat === "AUTHENTICATION" && "Autenticação"}
                </button>
              ))}
            </div>
          </section>

          {/* CARD: Nome e idioma */}
          <section className="tc-card">
            <h2 className="tc-card-title">Nome e idioma do modelo</h2>

            <div className="tc-row">
              <div className="tc-field">
                <label>Nome do modelo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: gplabs_confirmacao_pedido"
                />
                <small>
                  Apenas letras minúsculas, números e underline. Ex: <code>gplabs_status_pedido</code>
                </small>
              </div>

              <div className="tc-field tc-field-small">
                <label>Idioma</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* CARD: Conteúdo */}
          <section className="tc-card">
            <h2 className="tc-card-title">Conteúdo</h2>

            {/* HEADER */}
            <div className="tc-block">
              <div className="tc-block-header">
                <label className="tc-checkbox-label">
                  <input
                    type="checkbox"
                    checked={headerEnabled}
                    onChange={(e) => setHeaderEnabled(e.target.checked)}
                  />{" "}
                  Cabeçalho (opcional)
                </label>
              </div>

              {headerEnabled && (
                <div className="tc-block-body">
                  <div className="tc-row">
                    <div className="tc-field tc-field-small">
                      <label>Tipo do cabeçalho</label>
                      <select
                        value={headerFormat}
                        onChange={(e) => setHeaderFormat(e.target.value as HeaderFormat)}
                      >
                        <option value="TEXT">Texto</option>
                        <option value="IMAGE">Imagem</option>
                        <option value="VIDEO">Vídeo</option>
                        <option value="DOCUMENT">Documento</option>
                      </select>
                      <small>
                        Se escolher mídia, a Meta exige um exemplo de arquivo (URL pública).
                      </small>
                    </div>
                  </div>

                  {showHeaderTextFields && (
                    <>
                      <div className="tc-field">
                        <label>Texto do cabeçalho</label>
                        <input
                          type="text"
                          value={headerText}
                          maxLength={60}
                          onChange={(e) => setHeaderText(e.target.value)}
                          placeholder="ex.: Pedido {{1}} confirmado"
                        />
                        <small>
                          Máx. 60 caracteres. Pode ter 1 variável <code>{"{{1}}"}</code>.
                        </small>
                      </div>

                      {headerHasVar && (
                        <div className="tc-field">
                          <label>Exemplo da variável do cabeçalho</label>
                          <input
                            type="text"
                            value={headerExample}
                            onChange={(e) => setHeaderExample(e.target.value)}
                            placeholder="ex.: #12345"
                          />
                          <small>Obrigatório quando o cabeçalho tem variável.</small>
                        </div>
                      )}
                    </>
                  )}

                  {showHeaderMediaFields && (
                    <>
                      <div className="tc-field">
                        <label>URL pública do arquivo (exemplo para a Meta)</label>
                        <input
                          type="text"
                          value={headerMediaUrl}
                          onChange={(e) => setHeaderMediaUrl(e.target.value)}
                          placeholder="https://... (imagem/vídeo/pdf público)"
                        />
                        <small>
                          A Meta usa isso como <code>example.header_handle</code>. Precisa ser acessível publicamente.
                        </small>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* BODY */}
            <div className="tc-block">
              <div className="tc-block-header between">
                <label>Corpo</label>
                <span className="tc-char-counter">{bodyText.length}/1024</span>
              </div>

              <div className="tc-block-body">
                <div className="tc-field">
                  <textarea rows={4} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
                  <div className="tc-toolbar">
                    <div className="tc-toolbar-left">
                      <button type="button" className="tc-toolbar-btn" onClick={handleAddVariableToBody}>
                        + Adicionar variável
                      </button>

                      <button
                        type="button"
                        className="tc-toolbar-btn"
                        onClick={downloadVariablesCsv}
                        title="Baixar CSV para preencher exemplos no Excel"
                      >
                        ⬇ Baixar variáveis (CSV)
                      </button>
                    </div>

                    <div className="tc-toolbar-right">
                      <span className="tc-toolbar-hint">
                        Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> etc.
                      </span>
                    </div>
                  </div>
                </div>

                {bodyVars.length > 0 && (
                  <div className="tc-vars-panel">
                    <p>Exemplos para variáveis (requeridos pela Meta):</p>

                    <div className="tc-vars-grid">
                      {bodyVars.map((idx) => (
                        <div className="tc-field" key={idx}>
                          <label>{`Valor para {{${idx}}}`}</label>
                          <input
                            type="text"
                            value={bodyExamples[idx] || ""}
                            onChange={(e) => handleBodyExampleChange(idx, e.target.value)}
                            placeholder={`Exemplo para {{${idx}}}`}
                          />
                        </div>
                      ))}
                    </div>

                    <small style={{ opacity: 0.85 }}>
                      Dica: você pode baixar o CSV acima, preencher no Excel e depois copiar/colar aqui.
                    </small>
                  </div>
                )}
              </div>
            </div>

            {/* FOOTER */}
            <div className="tc-block">
              <div className="tc-block-header between">
                <label>Rodapé (opcional)</label>
                <span className="tc-char-counter">{footerText.length}/60</span>
              </div>
              <div className="tc-block-body">
                <div className="tc-field">
                  <input
                    type="text"
                    value={footerText}
                    maxLength={60}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="ex.: GP Labs – atendimento automatizado"
                  />
                </div>
              </div>
            </div>

            {/* BOTÕES */}
            <div className="tc-block">
              <div className="tc-block-header between">
                <label>Botões (opcional)</label>
                <div className="tc-buttons-add">
                  <button type="button" className="btn-secondary" onClick={() => addButton("QUICK_REPLY")}>
                    + Personalizado
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => addButton("URL")}>
                    + Acessar site
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => addButton("PHONE_NUMBER")}>
                    + Ligar/WhatsApp
                  </button>
                </div>
              </div>

              {buttons.length === 0 && (
                <p className="tc-helper-text">
                  Crie botões para respostas rápidas, abrir links ou iniciar uma ligação/WhatsApp.
                </p>
              )}

              {buttons.length > 0 && (
                <div className="tc-block-body">
                  {buttons.map((b) => (
                    <div className="tc-button-row" key={b.id}>
                      <div className="tc-field tc-field-small">
                        <label>Tipo</label>
                        <select
                          value={b.type}
                          onChange={(e) => updateButton(b.id, { type: e.target.value as ButtonType })}
                        >
                          <option value="QUICK_REPLY">Personalizado</option>
                          <option value="URL">Acessar site</option>
                          <option value="PHONE_NUMBER">Ligar/WhatsApp</option>
                        </select>
                      </div>

                      <div className="tc-field">
                        <label>Texto do botão</label>
                        <input
                          type="text"
                          maxLength={25}
                          value={b.text}
                          onChange={(e) => updateButton(b.id, { text: e.target.value })}
                          placeholder="ex.: Ver detalhes"
                        />
                      </div>

                      {b.type === "URL" && (
                        <>
                          <div className="tc-field">
                            <label>URL</label>
                            <input
                              type="text"
                              value={b.url || ""}
                              onChange={(e) => updateButton(b.id, { url: e.target.value })}
                              placeholder="https://..."
                            />
                          </div>
                          <div className="tc-field">
                            <label>
                              Exemplo para variável da URL (se usar <code>{"{{1}}"}</code>)
                            </label>
                            <input
                              type="text"
                              value={b.urlExample || ""}
                              onChange={(e) => updateButton(b.id, { urlExample: e.target.value })}
                              placeholder="ex.: summer2025"
                            />
                          </div>
                        </>
                      )}

                      {b.type === "PHONE_NUMBER" && (
                        <div className="tc-field">
                          <label>Número de telefone</label>
                          <input
                            type="text"
                            value={b.phoneNumber || ""}
                            onChange={(e) => updateButton(b.id, { phoneNumber: e.target.value })}
                            placeholder="5511999999999"
                          />
                        </div>
                      )}

                      <button type="button" className="btn-ghost" onClick={() => removeButton(b.id)}>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* FEEDBACK + AÇÕES */}
          {error && <div className="tc-alert tc-alert-error">{error}</div>}
          {success && <div className="tc-alert tc-alert-success">{success}</div>}

          <div className="tc-footer-actions">
            <button type="button" className="btn-secondary" onClick={handleBack} disabled={saving}>
              Voltar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Enviando..." : "Enviar para análise"}
            </button>
          </div>
        </form>

        {/* COLUNA DIREITA – PREVIEW */}
        <TemplateCreatePreview template={draftTemplate} />
      </div>
    </div>
  );
}

/* ============================
   PREVIEW – IGUAL META
============================ */

function TemplateCreatePreview({ template }: { template: Template }) {
  const components = template.components || [];
  const header = findComponent(components, "HEADER");
  const body = findComponent(components, "BODY");
  const footer = findComponent(components, "FOOTER");
  const buttons = findComponent(components, "BUTTONS");

  const headerFormat = (header as any)?.format || "TEXT";

  return (
    <aside className="templates-create-preview">
      <h2 className="tc-card-title">Prévia do modelo</h2>

      <div className="tc-preview-container">
        <div className="tc-wa-card">
          <div className="tc-wa-header" />

          <div className="tc-wa-body">
            <div className="tc-wa-message">
              {header && (
                <div className="tc-wa-header-text">
                  {String(headerFormat).toUpperCase() === "TEXT"
                    ? ((header as any).text || "[Cabeçalho]")
                    : `[${String(headerFormat).toUpperCase()}]`}
                </div>
              )}

              {body && (
                <div className="tc-wa-body-text">
                  {renderBodyText(((body as any).text as string) || "")}
                </div>
              )}

              {footer && (
                <div className="tc-wa-footer-text">
                  {(footer as any).text}
                </div>
              )}

              {buttons && Array.isArray((buttons as any).buttons) && (
                <div className="tc-wa-buttons">
                  {(buttons as any).buttons.map((btn: any, idx: number) => (
                    <button key={idx} className="tc-wa-button">
                      {btn.text || "Botão"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

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
          <span key={i} className="tc-body-var">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}
