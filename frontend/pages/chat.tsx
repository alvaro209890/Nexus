import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  ChatSessionDetail,
  ChatSessionSummary,
  PersistedChatMessage,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
  sendChatMessage
} from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Send, 
  ChevronDown, 
  MessageSquare, 
  User, 
  Bot, 
  Loader2, 
  FileText 
} from "lucide-react";

type ChatReference = {
  document_id?: string;
  title?: string;
  classification?: string;
  suggested_name?: string;
  pdf_path?: string;
  original_name?: string;
};

export default function ChatPage() {
  const { user, authProfile, getCurrentToken } = useAuth();
  const [chatInput, setChatInput] = useState("");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<PersistedChatMessage[]>([]);
  const [references, setReferences] = useState<ChatReference[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isRenamingSession, setIsRenamingSession] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBusy]);

  const loadChatSession = useCallback(async (sessionId: string, existingToken?: string) => {
    setIsLoadingConversation(true);
    setError("");
    try {
      const token = existingToken ?? (await getCurrentToken());
      const detail = await getChatSession(sessionId, token);
      applySessionDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao abrir a conversa.");
    } finally {
      setIsLoadingConversation(false);
    }
  }, [getCurrentToken]);

  useEffect(() => {
    if (user && authProfile) {
      void (async () => {
        setIsLoadingSessions(true);
        setError("");
        try {
          const token = await getCurrentToken();
          let sessionList = await listChatSessions(token);
          if (sessionList.length === 0) {
            const created = await createChatSession(token);
            sessionList = [created];
          }
          setSessions(sessionList);

          const nextSessionId = sessionList[0]?.session_id ?? "";
          if (nextSessionId) {
            await loadChatSession(nextSessionId, token);
          } else {
            setActiveSessionId("");
            setMessages([]);
            setReferences([]);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Falha ao carregar os chats.");
        } finally {
          setIsLoadingSessions(false);
        }
      })();
    }
  }, [user, authProfile, getCurrentToken, loadChatSession]);

  function applySessionDetail(detail: ChatSessionDetail) {
    setActiveSessionId(detail.session_id);
    setMessages(detail.messages);
    setReferences(extractLatestReferences(detail.messages));
    setSessions((current) => {
      const next = [...current];
      const index = next.findIndex((session) => session.session_id === detail.session_id);
      const summary = summarizeDetail(detail);
      if (index >= 0) {
        next[index] = summary;
      } else {
        next.unshift(summary);
      }
      return next.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    });
  }

  async function handleCreateSession() {
    setIsCreatingSession(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const session = await createChatSession(token);
      setSessions((current) => [session, ...current]);
      await loadChatSession(session.session_id, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar novo chat.");
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!window.confirm("Excluir este chat? A memória local desta conversa será removida.")) {
      return;
    }

    setIsDeletingSession(true);
    setError("");
    try {
      const token = await getCurrentToken();
      await deleteChatSession(sessionId, token);
      const remaining = sessions.filter((session) => session.session_id !== sessionId);
      setSessions(remaining);

      if (sessionId === activeSessionId) {
        if (remaining.length > 0) {
          await loadChatSession(remaining[0].session_id, token);
        } else {
          const created = await createChatSession(token);
          setSessions([created]);
          await loadChatSession(created.session_id, token);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir o chat.");
    } finally {
      setIsDeletingSession(false);
    }
  }

  function startRenaming(session: ChatSessionSummary) {
    setEditingSessionId(session.session_id);
    setEditingTitle(session.title);
    setError("");
  }

  function cancelRenaming() {
    setEditingSessionId("");
    setEditingTitle("");
  }

  async function submitRename(sessionId: string) {
    const cleanTitle = editingTitle.trim();
    if (!cleanTitle) {
      setError("Informe um nome válido para a conversa.");
      return;
    }

    setIsRenamingSession(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const updated = await renameChatSession(sessionId, cleanTitle, token);
      setSessions((current) =>
        current
          .map((session) => (session.session_id === updated.session_id ? { ...session, title: updated.title, updated_at: updated.updated_at } : session))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      );
      if (activeSessionId === updated.session_id) {
        setMessages((current) => [...current]);
      }
      cancelRenaming();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao renomear o chat.");
    } finally {
      setIsRenamingSession(false);
    }
  }

  async function handleChat(event: FormEvent) {
    event.preventDefault();
    const cleanMessage = chatInput.trim();
    if (!cleanMessage || isBusy) return;

    let sessionId = activeSessionId;
    setError("");

    try {
      const token = await getCurrentToken();
      if (!sessionId) {
        const session = await createChatSession(token);
        setSessions((current) => [session, ...current]);
        sessionId = session.session_id;
        setActiveSessionId(sessionId);
      }

      const optimisticUserMessage: PersistedChatMessage = {
        role: "user",
        content: cleanMessage,
        timestamp: new Date().toISOString(),
        references: []
      };

      setMessages((current) => [...current, optimisticUserMessage]);
      setChatInput("");
      setIsBusy(true);

      const result = await sendChatMessage(cleanMessage, [], sessionId, token);
      const detail = await getChatSession(result.session_id, token);
      applySessionDetail(detail);

      const refreshedSessions = await listChatSessions(token);
      setSessions(refreshedSessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao processar mensagem.");
    } finally {
      setIsBusy(false);
    }
  }

  const activeSession = sessions.find((session) => session.session_id === activeSessionId) ?? null;

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      form?.requestSubmit();
    }
  }

  const formatDocName = (name: string) => {
    let clean = name.replace(/_/g, ' ').replace(/\.pdf$/i, '');
    clean = clean.replace(/\b\w/g, l => l.toUpperCase());
    return clean;
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between mb-2">
        <div>
          <p className="eyebrow mb-1.5 text-accent-strong">Workspace</p>
          <h1 className="text-3xl font-bold tracking-tight">Chat Inteligente</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary">
            Converse com seus dados de forma contextualizada. Cada sessão mantém sua própria memória e referências baseadas na indexação do Nexus.
          </p>
        </div>

        <div className="flex gap-2.5">
          <Button type="button" isLoading={isCreatingSession} onClick={() => void handleCreateSession()}>
            <Plus size={18} />
            Novo Chat
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm font-medium text-danger animate-slide-up">
          {error}
        </div>
      )}

      <div className="grid h-[calc(100vh-14rem)] min-h-[500px] grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        {/* Sidebar: Historico de chats */}
        <GlassCard className="!p-0 flex flex-col overflow-hidden h-full">
          <div className="border-b border-border-soft bg-bg-surface-strong/50 px-5 py-4 shrink-0">
            <p className="font-bold text-primary flex items-center gap-2">
              <MessageSquare size={16} className="text-accent" />
              Histórico
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {isLoadingSessions ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`session-loading-${index}`} className="h-20 animate-pulse rounded-xl bg-white/5" />
              ))
            ) : (
              sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={`chat-session-card p-3 rounded-xl transition-all cursor-pointer border ${
                    session.session_id === activeSessionId 
                      ? "bg-accent/10 border-accent/30 shadow-inner" 
                      : "bg-transparent border-transparent hover:bg-white/5"
                  }`}
                  onClick={() => {
                    if (editingSessionId !== session.session_id) {
                      void loadChatSession(session.session_id);
                    }
                  }}
                >
                  <div className="min-w-0 flex-1">
                    {editingSessionId === session.session_id ? (
                      <div className="space-y-2" onClick={e => e.stopPropagation()}>
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          className="w-full bg-bg-surface border border-accent/50 rounded-md px-2 py-1 text-sm outline-none focus:border-accent text-primary"
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void submitRename(session.session_id);
                            }
                            if (event.key === "Escape") {
                              cancelRenaming();
                            }
                          }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            className="!py-1 !px-2 !text-xs !rounded-md"
                            isLoading={isRenamingSession}
                            onClick={() => void submitRename(session.session_id)}
                          >
                            Salvar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="!py-1 !px-2 !text-xs !rounded-md"
                            onClick={cancelRenaming}
                            disabled={isRenamingSession}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`truncate text-sm font-bold ${session.session_id === activeSessionId ? "text-accent-strong" : "text-primary"}`}>
                            {session.title}
                          </p>
                          <span className="text-[0.6rem] bg-bg-surface-strong px-1.5 py-0.5 rounded-full text-secondary font-mono">{session.turn_count}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-secondary opacity-80">
                          {session.last_message_preview || "Novo chat pronto..."}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted">
                            {formatDateTime(session.updated_at)}
                          </p>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="p-1 rounded-md text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                              onClick={(e) => { e.stopPropagation(); startRenaming(session); }}
                              disabled={isRenamingSession || isDeletingSession}
                              aria-label="Renomear"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              className="p-1 rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                              onClick={(e) => { e.stopPropagation(); void handleDeleteSession(session.session_id); }}
                              disabled={isDeletingSession}
                              aria-label="Excluir"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        {/* Centro: Chat Area */}
        <GlassCard className="flex flex-col overflow-hidden !p-0 h-full border-border-strong shadow-panel">
          <div className="border-b border-border-soft bg-bg-surface-strong/80 backdrop-blur-md px-6 py-4 shrink-0 flex justify-between items-center z-10">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-primary">{activeSession?.title || "Novo chat"}</h2>
                {activeSession && (
                  <button
                    type="button"
                    className="p-1.5 text-muted hover:text-accent transition-colors"
                    onClick={() => startRenaming(activeSession)}
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-3 text-xs font-medium text-secondary bg-bg-surface px-3 py-1.5 rounded-full border border-border-soft">
              <span>{messages.length} msgs</span>
              <span className="w-px bg-border-soft" />
              <span>{references.length} refs</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar bg-gradient-to-b from-bg-surface/30 to-bg-surface-strong/30">
            {isLoadingConversation ? (
              <div className="space-y-6">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={`message-loading-${index}`} className={`flex ${index % 2 === 0 ? "justify-end" : "justify-start"}`}>
                    <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-white/5" />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-4 animate-fade-in">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 border border-accent/20">
                  <Bot size={32} className="text-accent" />
                </div>
                <h3 className="text-xl font-bold text-primary mb-2">Como posso ajudar?</h3>
                <p className="max-w-sm text-sm text-secondary leading-relaxed">
                  Faça perguntas sobre seus documentos indexados. O Nexus vasculha sua base em segundos e gera respostas com referências exatas.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message, index) => (
                  <div key={`${message.timestamp}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`chat-bubble flex flex-col gap-2 max-w-[85%] ${message.role === "user" ? "chat-user" : "chat-assistant"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`p-1 rounded-md ${message.role === "user" ? "bg-white/20 text-white" : "bg-accent/20 text-accent"}`}>
                          {message.role === "user" ? <User size={12} /> : <Bot size={12} />}
                        </div>
                        <p className="text-[0.65rem] font-bold uppercase tracking-wider opacity-60">
                          {message.role === "user" ? "Você" : "Nexus"}
                        </p>
                        <span className="ml-auto text-[0.65rem] font-medium opacity-50">
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content}
                      </div>
                    </div>
                  </div>
                ))}

                {isBusy && (
                  <div className="flex justify-start">
                    <div className="chat-bubble chat-assistant min-w-[80px]">
                       <div className="flex items-center gap-2 opacity-70">
                         <Loader2 size={16} className="animate-spin" />
                         <span className="text-xs font-medium">Processando...</span>
                       </div>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleChat} className="bg-bg-surface-strong/90 backdrop-blur-md p-4 shrink-0 border-t border-border-soft">
            <div className="relative">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Pergunte algo sobre os documentos..."
                className="w-full bg-bg-surface border border-border-strong rounded-2xl py-3 pl-4 pr-14 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none custom-scrollbar"
                rows={2}
                autoFocus
              />
              <button 
                type="submit" 
                disabled={isBusy || !chatInput.trim()}
                className="absolute right-2 bottom-2 p-2.5 rounded-xl bg-accent text-white hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
            <p className="text-center mt-2 text-[0.65rem] text-muted font-medium">
              A IA pode cometer erros. Considere verificar as referências citadas.
            </p>
          </form>
        </GlassCard>

        {/* Sidebar Direita: Referências */}
        <GlassCard className="!p-0 flex flex-col overflow-hidden h-full hidden xl:flex">
          <div className="border-b border-border-soft bg-bg-surface-strong/50 px-4 py-4 shrink-0">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left group"
              onClick={() => setIsContextOpen((current) => !current)}
            >
              <div>
                <p className="font-bold text-primary flex items-center gap-2">
                  <FileText size={16} className="text-accent" />
                  Referências
                </p>
                <p className="mt-1 text-xs text-secondary opacity-80">
                  Fontes da última resposta
                </p>
              </div>
              <ChevronDown size={16} className={`text-muted group-hover:text-primary transition-transform ${isContextOpen ? "rotate-180" : ""}`} />
            </button>
          </div>

          {isContextOpen && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
            {references.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center opacity-50">
                 <FileText size={24} className="mb-2 text-muted" />
                 <p className="text-xs text-secondary leading-relaxed">
                   As referências aparecerão aqui quando o Nexus consultar seus documentos.
                 </p>
              </div>
            ) : (
              references.map((reference, index) => (
                <div key={`${reference.document_id || "ref"}-${index}`} className="rounded-xl border border-border-soft bg-bg-surface-strong p-3 hover:border-accent/30 transition-colors group">
                  <p className="text-xs font-bold text-primary mb-1 group-hover:text-accent transition-colors" title={reference.original_name || reference.title || reference.suggested_name}>
                    {formatDocName(reference.title || reference.suggested_name || "Documento referenciado")}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded-md bg-white/5 text-secondary border border-white/10">
                      {reference.classification || "PDF"}
                    </span>
                  </div>
                  {/* UUIDs hidden intentionally for cleaner UI */}
                </div>
              ))
            )}
          </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function summarizeDetail(detail: ChatSessionDetail): ChatSessionSummary {
  return {
    session_id: detail.session_id,
    title: detail.title,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    turn_count: detail.turn_count,
    message_count: detail.message_count,
    last_message_preview: detail.last_message_preview
  };
}

function extractLatestReferences(messages: PersistedChatMessage[]): ChatReference[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.references.length === 0) {
      continue;
    }
    return message.references.map((reference) => ({
      document_id: typeof reference.document_id === "string" ? reference.document_id : undefined,
      title: typeof reference.title === "string" ? reference.title : undefined,
      classification: typeof reference.classification === "string" ? reference.classification : undefined,
      suggested_name: typeof reference.suggested_name === "string" ? reference.suggested_name : undefined,
      pdf_path: typeof reference.pdf_path === "string" ? reference.pdf_path : undefined,
      original_name: typeof reference.original_name === "string" ? reference.original_name : undefined,
    }));
  }
  return [];
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}
