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
  ChevronRight, 
  MessageSquare, 
  Bot, 
  Loader2, 
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Info
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
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      
      // Auto-open references if there are any
      const refs = extractLatestReferences(detail.messages);
      if (refs.length > 0) {
        setIsContextOpen(true);
      } else {
        setIsContextOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao abrir a conversa.");
    } finally {
      setIsLoadingConversation(false);
      // Focus input when chat loads
      setTimeout(() => textareaRef.current?.focus(), 100);
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
    const newRefs = extractLatestReferences(detail.messages);
    setReferences(newRefs);
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
      
      const newRefs = extractLatestReferences(detail.messages);
      if (newRefs.length > 0) {
        setIsContextOpen(true);
      }

      const refreshedSessions = await listChatSessions(token);
      setSessions(refreshedSessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao processar mensagem.");
    } finally {
      setIsBusy(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
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
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in -mx-4 -mt-4 px-4 pt-4 pb-4">
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 mb-4 text-sm font-medium text-danger animate-slide-up flex items-center gap-2">
          <Info size={16} />
          {error}
        </div>
      )}

      <div className="flex gap-6 h-full min-h-0 overflow-hidden">
        {/* SIDEBAR: Histórico de Chats */}
        <div className="w-64 flex flex-col gap-4 shrink-0 h-full overflow-hidden">
          <Button 
            type="button" 
            variant="primary" 
            className="w-full justify-start !py-3 shadow-md"
            isLoading={isCreatingSession} 
            onClick={() => void handleCreateSession()}
          >
            <Plus size={18} className="mr-2" />
            Novo Chat
          </Button>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            <p className="text-xs font-bold uppercase tracking-wider text-muted mb-3 mt-2 px-1">
              Recentes
            </p>
            {isLoadingSessions ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`session-loading-${index}`} className="h-12 animate-pulse rounded-lg bg-white/5" />
              ))
            ) : (
              sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={`group flex flex-col rounded-lg transition-colors cursor-pointer border border-transparent ${
                    session.session_id === activeSessionId 
                      ? "bg-accent/15 text-accent-strong border-accent/20" 
                      : "hover:bg-white/5 text-primary"
                  }`}
                  onClick={() => {
                    if (editingSessionId !== session.session_id) {
                      void loadChatSession(session.session_id);
                    }
                  }}
                >
                  <div className="p-2.5">
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
                          <Button type="button" className="!py-1 !px-2 !text-xs !rounded-md" isLoading={isRenamingSession} onClick={() => void submitRename(session.session_id)}>Salvar</Button>
                          <Button type="button" variant="ghost" className="!py-1 !px-2 !text-xs !rounded-md" onClick={cancelRenaming} disabled={isRenamingSession}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 overflow-hidden">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <MessageSquare size={14} className={session.session_id === activeSessionId ? "text-accent" : "text-muted"} />
                          <p className="truncate text-sm font-medium">{session.title}</p>
                        </div>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="p-1 rounded text-muted hover:text-accent hover:bg-white/10 transition-colors"
                            onClick={(e) => { e.stopPropagation(); startRenaming(session); }}
                            title="Renomear"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            type="button"
                            className="p-1 rounded text-muted hover:text-danger hover:bg-white/10 transition-colors"
                            onClick={(e) => { e.stopPropagation(); void handleDeleteSession(session.session_id); }}
                            disabled={isDeletingSession}
                            title="Excluir"
                          >
                            {isDeletingSession && activeSessionId === session.session_id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* CENTRO: Área de Chat Principal */}
        <GlassCard className="flex-1 flex flex-col h-full !p-0 overflow-hidden border-border-strong shadow-panel relative">
          
          {/* Header do Chat */}
          <div className="border-b border-border-soft bg-bg-surface-strong/80 backdrop-blur-md px-6 py-4 shrink-0 flex justify-between items-center z-10">
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                {activeSession?.title || "Nova Conversa"}
              </h2>
              <p className="text-xs text-secondary opacity-80 mt-0.5">Memória local isolada e protegida</p>
            </div>
            
            <button
              onClick={() => setIsContextOpen(!isContextOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                isContextOpen ? "bg-accent/10 border-accent/30 text-accent-strong" : "bg-bg-surface border-border-soft text-secondary hover:text-primary hover:border-border-strong"
              }`}
              title="Alternar Referências"
            >
               {isContextOpen ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
               <span className="text-xs font-bold">{references.length} Refs</span>
            </button>
          </div>

          {/* Histórico de Mensagens */}
          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar bg-bg-surface/30">
            <div className="max-w-4xl mx-auto w-full">
              {isLoadingConversation ? (
                <div className="flex items-center justify-center h-full opacity-50">
                   <Loader2 size={32} className="animate-spin text-accent" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in my-20">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-soft to-bg-surface-strong border border-accent/20 shadow-lg">
                    <Bot size={40} className="text-accent" />
                  </div>
                  <h3 className="text-2xl font-bold text-primary mb-3">Olá, {user?.displayName?.split(" ")[0] || "Operador"}!</h3>
                  <p className="max-w-md text-base text-secondary leading-relaxed">
                    Eu sou o Nexus. Posso buscar informações exatas nos seus documentos e fornecer respostas baseadas no contexto seguro do seu repositório.
                  </p>
                </div>
              ) : (
                <div className="space-y-8 pb-4">
                  {messages.map((message, index) => (
                    <div key={`${message.timestamp}-${index}`} className="flex flex-col">
                      
                      {/* USER MESSAGE */}
                      {message.role === "user" && (
                        <div className="flex justify-end w-full animate-fade-in">
                          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-accent/15 border border-accent/20 p-4 text-primary shadow-sm text-[0.9rem] leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </div>
                        </div>
                      )}

                      {/* ASSISTANT MESSAGE */}
                      {message.role === "assistant" && (
                        <div className="flex justify-start w-full animate-fade-in mt-2">
                           <div className="flex items-start gap-4 max-w-[95%]">
                              <div className="w-8 h-8 rounded-lg bg-bg-surface-strong border border-border-soft flex items-center justify-center shrink-0 mt-1 shadow-sm text-accent">
                                <Bot size={18} />
                              </div>
                              <div className="flex flex-col gap-1 min-w-0">
                                <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">Nexus IA</p>
                                <div className="text-[0.925rem] leading-relaxed text-primary whitespace-pre-wrap">
                                  {message.content}
                                </div>
                              </div>
                           </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {isBusy && (
                    <div className="flex justify-start w-full animate-fade-in mt-2">
                      <div className="flex items-start gap-4 max-w-[95%]">
                          <div className="w-8 h-8 rounded-lg bg-bg-surface-strong border border-border-soft flex items-center justify-center shrink-0 mt-1 shadow-sm text-accent">
                            <Bot size={18} />
                          </div>
                          <div className="flex flex-col gap-1 min-w-0 justify-center">
                            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">Nexus IA</p>
                            <div className="flex items-center gap-2 text-secondary text-sm mt-1">
                              <span className="flex gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
                              </span>
                            </div>
                          </div>
                      </div>
                    </div>
                  )}
                  <div ref={scrollRef} className="h-4" />
                </div>
              )}
            </div>
          </div>

          {/* Input Box Area */}
          <div className="bg-bg-surface/80 backdrop-blur-xl p-4 shrink-0 border-t border-border-soft relative z-10">
            <div className="max-w-4xl mx-auto">
              <form onSubmit={handleChat} className="relative group">
                <textarea
                  ref={textareaRef}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Pergunte sobre contratos, regras, resumos..."
                  className="w-full bg-bg-surface-strong border border-border-strong rounded-2xl py-4 pl-5 pr-14 text-[0.95rem] text-primary placeholder-muted focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-all resize-none custom-scrollbar shadow-inner"
                  rows={2}
                  autoFocus
                />
                <button 
                  type="submit" 
                  disabled={isBusy || !chatInput.trim()}
                  className="absolute right-3 bottom-3 p-2.5 rounded-xl bg-accent text-white hover:bg-accent-strong hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed transition-all shadow-md"
                >
                  {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="ml-0.5" />}
                </button>
              </form>
              <p className="text-center mt-3 text-[0.65rem] text-muted font-medium">
                Respostas geradas por IA. Considere checar o painel de referências.
              </p>
            </div>
          </div>
        </GlassCard>

        {/* RIGHT SIDEBAR: Referências */}
        {isContextOpen && (
          <GlassCard className="w-80 shrink-0 flex flex-col !p-0 overflow-hidden border-border-strong animate-fade-in relative z-20 shadow-xl">
            <div className="border-b border-border-soft bg-bg-surface-strong/80 px-5 py-4 shrink-0 flex items-center justify-between">
              <div>
                <p className="font-bold text-primary flex items-center gap-2">
                  <FileText size={16} className="text-accent" />
                  Fontes do Contexto
                </p>
                <p className="mt-0.5 text-[0.65rem] text-secondary">Documentos utilizados na última resposta</p>
              </div>
              <button 
                onClick={() => setIsContextOpen(false)} 
                className="text-muted hover:text-primary p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                title="Fechar Painel"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar bg-bg-surface-strong/30">
              {references.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center opacity-50">
                   <FileText size={24} className="mb-2 text-muted" />
                   <p className="text-xs text-secondary leading-relaxed">
                     Nenhuma fonte utilizada no momento. Faça uma pergunta para buscar na base.
                   </p>
                </div>
              ) : (
                references.map((reference, index) => (
                  <div key={`${reference.document_id || "ref"}-${index}`} className="rounded-xl border border-border-soft bg-bg-surface p-3 hover:border-accent/40 transition-colors group">
                    <p className="text-xs font-bold text-primary leading-snug mb-2 group-hover:text-accent transition-colors" title={reference.original_name || reference.title || reference.suggested_name}>
                      {formatDocName(reference.title || reference.suggested_name || "Documento referenciado")}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20">
                        {reference.classification || "DOCUMENTO"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        )}
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
