// frontend/src/chatbot/ChatbotPage.jsx
import { useState } from "react";
import "../../styles/chatbot.css";


const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "bot_first", // "human_only" | "bot_first" | "human_first"
  scheduleNote: "",
  botIdentity: {
    name: "Assistente GP Labs",
    description:
      "Ajuda clientes com dúvidas sobre WhatsApp Business, campanhas e suporte.",
    tone: "amigavel", // "profissional" | "amigavel" | "tecnico" | "informal"
    formality: "voce", // "voce" | "senhor"
    emojis: "poucos", // "nenhum" | "poucos" | "muitos"
  },
  knowledge: {
    businessInstructions: "",
    websites: ["https://gplabs.com.br"],
    faqText: "",
  },
  routing: {
    maxBotMessages: 3,
    handoffKeywords: ["reclamação", "falar com atendente", "cancelar"],
    onLowConfidence: "handoff", // "handoff" | "ask_rephrase"
    humanScheduleNote: "Atendimento humano de seg a sex, 09h às 18h.",
    handoffMessage:
      "Vou te transferir para um atendente humano agora, tudo bem?",
  },
  messages: {
    welcome:
      "Olá! 👋 Eu sou o assistente virtual da GP Labs. Como posso te ajudar hoje?",
    offline:
      "Estamos fora do horário de atendimento humano, mas posso te ajudar com informações básicas agora mesmo.",
    closing: "Posso te ajudar com mais alguma coisa?",
  },
};

export default function ChatbotPage() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  function update(path, value) {
    // helper simples: update(["botIdentity","name"], "Novo nome")
    setSettings((prev) => {
      const clone = structuredClone(prev);
      let ref = clone;
      for (let i = 0; i < path.length - 1; i++) {
        ref = ref[path[i]];
      }
      ref[path[path.length - 1]] = value;
      return clone;
    });
  }

  async function handleSave() {
    try {
      setSaving(true);

      // Aqui no futuro você chama sua API:
      // await fetch("/api/chatbot/settings", { method: "PUT", body: JSON.stringify(settings), ... })

      console.log("💾 Salvando configurações do chatbot:", settings);
      alert("Configurações do chatbot salvas (mock). Depois ligamos na API 🙂");
    } catch (err) {
      console.error("Erro ao salvar configurações do chatbot", err);
      alert("Erro ao salvar configurações. Veja o console para detalhes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="chatbot-page">
      {/* Header principal */}
      <header className="chatbot-header">
        <div>
          <h1>Chatbot – Assistente Virtual</h1>
          <p>
            Configure o comportamento do assistente de IA: status, tom de voz,
            fontes de conhecimento e regras de transferência para humano.
          </p>
        </div>
        <button
          className="chatbot-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Salvando..." : "Salvar configurações"}
        </button>
      </header>

      <div className="chatbot-grid">
        {/* COLUNA ESQUERDA */}
        <div className="chatbot-column">
          {/* STATUS */}
          <section className="chatbot-card">
            <h2>Status do chatbot</h2>
            <p className="chatbot-card-subtitle">
              Defina se o bot está ativo e como ele participa do atendimento.
            </p>

            <div className="chatbot-field-row inline">
              <label className="chatbot-switch-label">
                <span>Chatbot ativo</span>
                <label className="chatbot-switch">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => update(["enabled"], e.target.checked)}
                  />
                  <span className="chatbot-switch-slider" />
                </label>
              </label>
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="mode">Modo de operação</label>
              <select
                id="mode"
                className="chatbot-select"
                value={settings.mode}
                onChange={(e) => update(["mode"], e.target.value)}
              >
                <option value="human_only">Somente humano</option>
                <option value="bot_first">
                  Bot primeiro, com transferência para humano
                </option>
                <option value="human_first">
                  Humano primeiro, com apoio do bot
                </option>
              </select>
              <small className="chatbot-help">
                Esse modo será usado pelo rules engine para decidir se responde
                com IA ou encaminha direto ao atendente.
              </small>
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="scheduleNote">Horário de funcionamento</label>
              <input
                id="scheduleNote"
                type="text"
                className="chatbot-input"
                placeholder="Ex.: Usar bot fora do horário comercial (18h–08h)"
                value={settings.scheduleNote}
                onChange={(e) =>
                  update(["scheduleNote"], e.target.value)
                }
              />
            </div>
          </section>

          {/* IDENTIDADE / TOM DE VOZ */}
          <section className="chatbot-card">
            <h2>Identidade e tom de voz</h2>
            <p className="chatbot-card-subtitle">
              Personalize a forma como o assistente se apresenta e conversa com
              seus clientes.
            </p>

            <div className="chatbot-field-row">
              <label htmlFor="bot-name">Nome do bot</label>
              <input
                id="bot-name"
                type="text"
                className="chatbot-input"
                value={settings.botIdentity.name}
                onChange={(e) =>
                  update(["botIdentity", "name"], e.target.value)
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="bot-desc">Descrição curta</label>
              <textarea
                id="bot-desc"
                className="chatbot-textarea"
                rows={3}
                placeholder="Ex.: Assistente virtual especializado em dúvidas sobre pedidos, prazos e status de entrega."
                value={settings.botIdentity.description}
                onChange={(e) =>
                  update(["botIdentity", "description"], e.target.value)
                }
              />
            </div>

            <div className="chatbot-field-row two-columns">
              <div>
                <label htmlFor="tone">Tom de voz</label>
                <select
                  id="tone"
                  className="chatbot-select"
                  value={settings.botIdentity.tone}
                  onChange={(e) =>
                    update(["botIdentity", "tone"], e.target.value)
                  }
                >
                  <option value="profissional">Profissional e objetivo</option>
                  <option value="amigavel">Amigável e próximo</option>
                  <option value="tecnico">Técnico / especialista</option>
                  <option value="informal">Informal (respeitoso)</option>
                </select>
              </div>

              <div>
                <label htmlFor="formality">Formalidade</label>
                <select
                  id="formality"
                  className="chatbot-select"
                  value={settings.botIdentity.formality}
                  onChange={(e) =>
                    update(["botIdentity", "formality"], e.target.value)
                  }
                >
                  <option value="voce">Falar usando "você"</option>
                  <option value="senhor">Mais formal – Sr./Sra.</option>
                </select>
              </div>
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="emojis">Uso de emojis</label>
              <select
                id="emojis"
                className="chatbot-select"
                value={settings.botIdentity.emojis}
                onChange={(e) =>
                  update(["botIdentity", "emojis"], e.target.value)
                }
              >
                <option value="nenhum">Sem emojis</option>
                <option value="poucos">Poucos emojis</option>
                <option value="muitos">Mais descontraído (mais emojis)</option>
              </select>
            </div>
          </section>

          {/* MENSAGENS AUTOMÁTICAS */}
          <section className="chatbot-card">
            <h2>Mensagens automáticas</h2>
            <p className="chatbot-card-subtitle">
              Textos usados em boas-vindas, fora de horário e encerramento.
            </p>

            <div className="chatbot-field-row">
              <label htmlFor="msg-welcome">Boas-vindas</label>
              <textarea
                id="msg-welcome"
                className="chatbot-textarea"
                rows={2}
                value={settings.messages.welcome}
                onChange={(e) =>
                  update(["messages", "welcome"], e.target.value)
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="msg-offline">Fora do horário</label>
              <textarea
                id="msg-offline"
                className="chatbot-textarea"
                rows={2}
                value={settings.messages.offline}
                onChange={(e) =>
                  update(["messages", "offline"], e.target.value)
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="msg-closing">Encerramento</label>
              <textarea
                id="msg-closing"
                className="chatbot-textarea"
                rows={2}
                value={settings.messages.closing}
                onChange={(e) =>
                  update(["messages", "closing"], e.target.value)
                }
              />
            </div>
          </section>
        </div>

        {/* COLUNA DIREITA */}
        <div className="chatbot-column">
          {/* FONTES DE CONHECIMENTO */}
          <section className="chatbot-card">
            <h2>Fontes de conhecimento</h2>
            <p className="chatbot-card-subtitle">
              Conteúdo que o bot usa como base para responder os clientes.
            </p>

            <div className="chatbot-field-row">
              <label htmlFor="business-instructions">
                Instruções principais do negócio
              </label>
              <textarea
                id="business-instructions"
                className="chatbot-textarea"
                rows={4}
                placeholder="Explique sua empresa, produtos, políticas de atendimento, prazos, etc."
                value={settings.knowledge.businessInstructions}
                onChange={(e) =>
                  update(
                    ["knowledge", "businessInstructions"],
                    e.target.value
                  )
                }
              />
              <small className="chatbot-help">
                Esse texto é sempre enviado no prompt como contexto fixo do
                assistente.
              </small>
            </div>

            <div className="chatbot-field-row">
              <label>Sites oficiais</label>
              <textarea
                className="chatbot-textarea"
                rows={3}
                placeholder={`Uma URL por linha. Ex:\nhttps://gplabs.com.br\nhttps://criatorioperes.com`}
                value={settings.knowledge.websites.join("\n")}
                onChange={(e) =>
                  update(
                    ["knowledge", "websites"],
                    e.target.value
                      .split("\n")
                      .map((url) => url.trim())
                      .filter(Boolean)
                  )
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="faq-text">FAQ / respostas prontas</label>
              <textarea
                id="faq-text"
                className="chatbot-textarea"
                rows={4}
                placeholder={`Cole aqui perguntas e respostas importantes.\nEx.: \nP: Qual o prazo de entrega?\nR: Normalmente de 3 a 5 dias úteis...`}
                value={settings.knowledge.faqText}
                onChange={(e) =>
                  update(["knowledge", "faqText"], e.target.value)
                }
              />
            </div>
          </section>

          {/* REGRAS DE TRANSFERÊNCIA */}
          <section className="chatbot-card">
            <h2>Regras de transferência para humano</h2>
            <p className="chatbot-card-subtitle">
              Controle quando o bot deve parar de responder e chamar um
              atendente.
            </p>

            <div className="chatbot-field-row two-columns">
              <div>
                <label htmlFor="max-bot-msgs">
                  Máximo de respostas do bot (sequência)
                </label>
                <input
                  id="max-bot-msgs"
                  type="number"
                  min={1}
                  className="chatbot-input"
                  value={settings.routing.maxBotMessages}
                  onChange={(e) =>
                    update(
                      ["routing", "maxBotMessages"],
                      Number(e.target.value || 1)
                    )
                  }
                />
              </div>

              <div>
                <label htmlFor="low-confidence">Quando o bot não souber</label>
                <select
                  id="low-confidence"
                  className="chatbot-select"
                  value={settings.routing.onLowConfidence}
                  onChange={(e) =>
                    update(["routing", "onLowConfidence"], e.target.value)
                  }
                >
                  <option value="handoff">
                    Transferir para humano imediatamente
                  </option>
                  <option value="ask_rephrase">
                    Pedir para o cliente reformular
                  </option>
                </select>
              </div>
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="handoff-keywords">
                Palavras-chave que forçam transferência
              </label>
              <textarea
                id="handoff-keywords"
                className="chatbot-textarea"
                rows={2}
                placeholder="Uma palavra ou expressão por linha. Ex.: reclamação, falar com atendente, cancelar..."
                value={settings.routing.handoffKeywords.join("\n")}
                onChange={(e) =>
                  update(
                    ["routing", "handoffKeywords"],
                    e.target.value
                      .split("\n")
                      .map((k) => k.trim())
                      .filter(Boolean)
                  )
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="human-schedule">
                Horário do atendimento humano
              </label>
              <input
                id="human-schedule"
                type="text"
                className="chatbot-input"
                value={settings.routing.humanScheduleNote}
                onChange={(e) =>
                  update(["routing", "humanScheduleNote"], e.target.value)
                }
              />
            </div>

            <div className="chatbot-field-row">
              <label htmlFor="handoff-message">
                Mensagem ao transferir para humano
              </label>
              <textarea
                id="handoff-message"
                className="chatbot-textarea"
                rows={2}
                value={settings.routing.handoffMessage}
                onChange={(e) =>
                  update(["routing", "handoffMessage"], e.target.value)
                }
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
