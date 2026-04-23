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

type ChatReference = {
  document_id?: string;
  title?: string;
  classification?: string;
  suggested_name?: string;
  pdf_path?: string;
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow mb-1.5">Workspace</p>
          <h1 className="text-2xl font-bold tracking-tight">Chats com Memória Persistente</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slateblue">
            Cada conversa mantém seu próprio contexto, histórico e memória local dentro do espaço privado do usuário autenticado.
          </p>
        </div>

        <div className="flex gap-2.5">
          <Button type="button" variant="primary" isLoading={isCreatingSession} onClick={() => void handleCreateSession()}>
            <PlusIcon />
            Nova conversa
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-[rgba(228,149,149,0.3)] bg-[rgba(228,149,149,0.12)] p-3 text-sm font-medium text-white">
          {error}
        </div>
      )}

      <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)_240px]">
        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-b border-white/50 px-4 py-3">
            <p className="eyebrow">Conversas</p>
            <p className="mt-1.5 text-xs text-slateblue">
              Chats salvos localmente no diretório privado do usuário.
            </p>
          </div>

          <div className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2">
            {isLoadingSessions ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`session-loading-${index}`} className="h-20 animate-pulse rounded-lg bg-slateblue/5" />
              ))
            ) : (
              sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={`chat-session-card ${session.session_id === activeSessionId ? "chat-session-card-active" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    {editingSessionId === session.session_id ? (
                      <div className="space-y-2">
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          className="chat-session-inline-edit"
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
                            className="!min-h-[2.35rem] !px-3 !text-sm"
                            isLoading={isRenamingSession}
                            onClick={() => void submitRename(session.session_id)}
                          >
                            Salvar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="!min-h-[2.35rem] !px-3 !text-sm"
                            onClick={cancelRenaming}
                            disabled={isRenamingSession}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void loadChatSession(session.session_id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-xs font-bold">{session.title}</p>
                          <span className="chat-session-badge">{session.turn_count}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[0.78rem] leading-relaxed text-slateblue/75">
                          {session.last_message_preview || "Chat pronto para iniciar."}
                        </p>
                        <p className="mt-2.5 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-slateblue/45">
                          Atualizado em {formatDateTime(session.updated_at)}
                        </p>
                      </button>
                    )}
                  </div>
                  <div className="chat-session-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => startRenaming(session)}
                      disabled={isRenamingSession || isDeletingSession}
                      aria-label={`Renomear chat ${session.title}`}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="chat-session-delete"
                      onClick={() => void handleDeleteSession(session.session_id)}
                      disabled={isDeletingSession}
                      aria-label={`Excluir chat ${session.title}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col overflow-hidden !p-0">
          <div className="border-b border-white/50 px-4 py-3">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="eyebrow">Conversa Ativa</p>
                <div className="mt-1 flex items-center gap-2">
                  <h2 className="text-lg font-bold">{activeSession?.title || "Novo chat"}</h2>
                  {activeSession && (
                    <button
                      type="button"
                      className="icon-button !p-2"
                      onClick={() => startRenaming(activeSession)}
                      aria-label="Renomear conversa ativa"
                    >
                      <EditIcon />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="chat-session-meta">{messages.length} msg</span>
                <span className="chat-session-meta">{references.length} ref</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoadingConversation ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`message-loading-${index}`} className="h-16 animate-pulse rounded-lg bg-slateblue/5" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center opacity-50">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slateblue/10">
                  <ChatOrbIcon />
                </div>
                <p className="text-lg font-bold italic text-slateblue">Este chat ainda está vazio.</p>
                <p className="mt-1.5 max-w-md text-xs text-slateblue/80">
                  Inicie uma nova conversa. O histórico, a memória e as referências deste chat serão salvos localmente para este usuário.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={`${message.timestamp}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`chat-bubble shadow-sm ${message.role === "user" ? "chat-user" : "chat-assistant"}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] opacity-55">
                          {message.role === "user" ? "Operador" : "Nexus IA"}
                        </p>
                        <p className="text-[0.6rem] font-semibold opacity-45">
                          {formatTime(message.timestamp)}
                        </p>
                      </div>
                      <p className="whitespace-pre-wrap text-[0.825rem] leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                ))}

                {isBusy && (
                  <div className="flex justify-start">
                    <div className="chat-assistant chat-bubble shadow-sm animate-pulse">
                      <div className="flex gap-1">
                        <div className="h-1 w-1 animate-bounce rounded-full bg-slateblue/40" />
                        <div className="h-1 w-1 animate-bounce rounded-full bg-slateblue/40 [animation-delay:0.2s]" />
                        <div className="h-1 w-1 animate-bounce rounded-full bg-slateblue/40 [animation-delay:0.4s]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleChat} className="border-t border-white/60 bg-white/5 p-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ex.: resuma os contratos ativos, liste riscos do projeto, compare as clausulas de renovacao"
                className="field min-h-[120px] resize-y !rounded-xl"
                autoFocus
              />
              <Button type="submit" isLoading={isBusy} className="!rounded-lg px-4">
                {!isBusy && <SendIcon />}
                Enviar
              </Button>
            </div>
            <p className="mt-2 text-xs text-slateblue/60">Enter envia a mensagem. Shift + Enter adiciona nova linha.</p>
          </form>
        </GlassCard>

        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-b border-white/50 px-4 py-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setIsContextOpen((current) => !current)}
            >
              <div>
                <p className="eyebrow">Contexto e referencias</p>
                <p className="mt-1.5 text-[0.7rem] text-slateblue">
                  Referencias usadas na ultima resposta.
                </p>
              </div>
              <span className={`transition-transform ${isContextOpen ? "rotate-180" : ""}`}>
                <ChevronDownIcon />
              </span>
            </button>
          </div>

          {isContextOpen && (
          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
            {references.length === 0 ? (
              <p className="px-1 text-[0.7rem] italic text-slateblue/55">
                As referencias aparecem aqui quando a IA usa documentos na resposta.
              </p>
            ) : (
              references.map((reference, index) => (
                <div key={`${reference.document_id || "ref"}-${index}`} className="rounded-lg border border-white/10 bg-[rgba(20,25,33,0.72)] p-3 text-[0.76rem]">
                  <p className="font-bold text-slateblue">
                    {reference.title || reference.suggested_name || "Documento referenciado"}
                  </p>
                  <p className="mt-1.5 text-ink/70">
                    {reference.classification || "sem classificacao"}
                  </p>
                  {reference.document_id && (
                    <p className="mt-2 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-700">
                      ID {reference.document_id}
                    </p>
                  )}
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
      pdf_path: typeof reference.pdf_path === "string" ? reference.pdf_path : undefined
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

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
    </svg>
  );
}

function ChatOrbIcon() {
  return (
    <svg className="h-8 w-8 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 20h4l10-10-4-4L4 16v4zM13 7l4 4" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M22 2L11 13" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
