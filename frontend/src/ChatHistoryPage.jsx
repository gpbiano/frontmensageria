// frontend/src/ChatHistoryPage.jsx
import { useEffect, useMemo, useState, useCallback } from "react";

const API_BASE = "https://bot.gphparticipacoes.com.br";

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newMessage, setNewMessage] = useState("");

  // =====================================
  // Helpers de fetch
  // =====================================

  const fetchConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);

      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") {
        params.append("status", statusFilter);
      }

      const res = await fetch(`${API_BASE}/conversations?${params.toString()}`);

      if (!res.ok) {
        console.error("Erro ao buscar conversas:", await res.text());
        return;
      }

      const data = await res.json();
      setConversations(data || []);

      // se ainda não há conversa selecionada, seleciona a primeira
      if (!selectedConversationId && data && data.length > 0) {
        setSelectedConversationId(data[0].id);
      }
    } catch (err) {
      console.error("Erro ao buscar conversas:", err);
    } finally {
      setLoadingConversations(false);
    }
  }, [statusFilter, selectedConversationId]);

  const fetchMessages = useCallback(
    async (conversationId) => {
      if (!conversationId) return;

      try {
        setLoadingMessages(true);
        const res = await fetch(
          `${API_BASE}/conversations/${conversationId}/messages`
        );

        if (!res.ok) {
          console.error("Erro ao buscar mensagens:", await res.text());
          return;
        }

        const data = await res.json();
        setMessages(data || []);
      } catch (err) {
        console.error("Erro ao buscar mensagens:", err);
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  // =====================================
  // Effects
  // =====================================

  // Carrega conversas na entrada e quando o filtro de status muda
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Carrega mensagens quando muda a conversa selecionada
  useEffect(() => {
    if (selectedConversationId) {
      fetchMessages(selectedConversationId);
    }
  }, [selectedConversationId, fetchMessages]);

  // (Opcional) polling leve para atualizar mensagens a cada X segundos
  useEffect(() => {
    if (!selectedConversationId) return;

    const interval = setInterval(() => {
      fetchMessages(selectedConversationId);
    }, 5000); // 5s

    return () => clearInterval(interval);
  }, [selectedConversationId, fetchMessages]);

  // =====================================
  // Ações
  // =====================================

  const handleSelectConversation = (id) => {
    setSelectedConversationId(id);
    // zera mensagens locais até carregar as novas
    setMessages([]);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversationId) return;

    try {
      const res = await fetch(
        `${API_BASE}/conversations/${selectedConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: newMessage })
        }
      );

      if (!res.ok) {
        console.error("Erro ao enviar mensagem:", await res.text());
        return;
      }

      const createdMessage = await res.json();

      // adiciona a mensagem imediatamente no chat
      setMessages((prev) => [...prev, createdMessage]);

      // limpa campo
      setNewMessage("");
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
    }
  };

  const handleChangeStatus = async (conversationId, newStatus) => {
    try {
      const res = await fetch(
        `${API_BASE}/conversations/${conversationId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus })
        }
      );

      if (!res.ok) {
        console.error("Erro ao alterar status:", await res.text());
        return;
      }

      const updated = await res.json();

      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch (err) {
      console.error("Erro ao alterar status:", err);
    }
  };

  // =====================================
  // Listas filtradas
  // =====================================

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      const matchStatus =
        statusFilter === "all" || c.status === statusFilter;

      const matchTerm =
        !term ||
        (c.contactName && c.contactName.toLowerCase().includes(term)) ||
        (c.phone && c.phone.toLowerCase().includes(term)) ||
        (c.lastMessage &&
          c.lastMessage.toLowerCase().includes(term));

      return matchStatus && matchTerm;
    });
  }, [conversations, searchTerm, statusFilter]);

  // =====================================
  // Render
  // =====================================

  return (
    <div className="flex h-full bg-slate-50">
      {/* Lista de conversas */}
      <aside className="w-1/3 border-r border-slate-200 flex flex-col">
        <div className="p-3 border-b border-slate-200 bg-white">
          <div className="font-semibold mb-2">Conversas</div>
          <div className="flex gap-2 mb-2">
            <input
              className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
              placeholder="Buscar por nome, telefone ou mensagem..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 text-sm">
            <select
              className="border border-slate-300 rounded px-2 py-1 flex-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="open">Abertas</option>
              <option value="closed">Encerradas</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loadingConversations && (
            <div className="p-3 text-sm text-slate-500">
              Carregando conversas...
            </div>
          )}

          {!loadingConversations && filteredConversations.length === 0 && (
            <div className="p-3 text-sm text-slate-500">
              Nenhuma conversa encontrada.
            </div>
          )}

          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-100 transition ${
                conv.id === selectedConversationId ? "bg-slate-200" : ""
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <div className="font-medium text-sm">
                  {conv.contactName || conv.phone}
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${
                    conv.status === "open"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {conv.status === "open" ? "Aberta" : "Encerrada"}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-1">
                {conv.phone}
              </div>
              <div className="text-xs text-slate-600 line-clamp-2">
                {conv.lastMessage || <em>Sem mensagens ainda</em>}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Painel de mensagens */}
      <section className="flex-1 flex flex-col">
        {selectedConversationId ? (
          <>
            {/* Cabeçalho da conversa */}
            <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between">
              <div>
                {(() => {
                  const conv = conversations.find(
                    (c) => c.id === selectedConversationId
                  );
                  if (!conv) return null;
                  return (
                    <>
                      <div className="font-semibold text-sm">
                        {conv.contactName || conv.phone}
                      </div>
                      <div className="text-xs text-slate-500">
                        {conv.phone}
                      </div>
                    </>
                  );
                })()}
              </div>

              {(() => {
                const conv = conversations.find(
                  (c) => c.id === selectedConversationId
                );
                if (!conv) return null;
                return (
                  <div className="flex items-center gap-2 text-xs">
                    <span>Status:</span>
                    <select
                      className="border border-slate-300 rounded px-2 py-1 text-xs"
                      value={conv.status}
                      onChange={(e) =>
                        handleChangeStatus(conv.id, e.target.value)
                      }
                    >
                      <option value="open">Aberta</option>
                      <option value="closed">Encerrada</option>
                    </select>
                  </div>
                );
              })()}
            </div>

            {/* Histórico de mensagens */}
            <div className="flex-1 overflow-auto p-4 space-y-2 bg-slate-50">
              {loadingMessages && (
                <div className="text-sm text-slate-500">
                  Carregando mensagens...
                </div>
              )}

              {!loadingMessages && messages.length === 0 && (
                <div className="text-sm text-slate-500">
                  Nenhuma mensagem nesta conversa ainda.
                </div>
              )}

              {messages.map((msg) => {
                const isOutbound = msg.direction === "out";
                const isText = msg.type === "text";

                return (
                  <div
                    key={msg.id}
                    className={`flex ${
                      isOutbound ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        isOutbound
                          ? "bg-emerald-500 text-white"
                          : "bg-white text-slate-900 border border-slate-200"
                      }`}
                    >
                      {isText && <div>{msg.text}</div>}
                      {!isText && (
                        <div>
                          <div className="font-semibold mb-1">
                            [{msg.type}]
                          </div>
                          {msg.text && (
                            <div className="text-xs opacity-90">
                              {msg.text}
                            </div>
                          )}
                          {msg.mediaUrl && (
                            <a
                              href={msg.mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs underline mt-1 block"
                            >
                              Abrir mídia
                            </a>
                          )}
                        </div>
                      )}

                      {msg.timestamp && (
                        <div className="mt-1 text-[10px] opacity-70 text-right">
                          {new Date(msg.timestamp).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input de envio */}
            <form
              className="p-3 border-t border-slate-200 bg-white flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
            >
              <input
                className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="Digite uma mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
              <button
                type="submit"
                className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
              >
                Enviar
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
            Selecione uma conversa na coluna à esquerda.
          </div>
        )}
      </section>
    </div>
  );
}