import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  ChatSessionDetail,
  ChatSessionSummary,
  PersistedChatMessage,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage
} from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Input } from "../components/ui/Input";
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
          <Button type="button" variant="secondary" isLoading={isCreatingSession} onClick={() => void handleCreateSession()}>
            Novo chat
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
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
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void loadChatSession(session.session_id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-bold">{session.title}</p>
                      <span className="chat-session-badge">{session.turn_count}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[0.7rem] leading-relaxed text-slateblue/75">
                      {session.last_message_preview || "Chat pronto para iniciar."}
                    </p>
                    <p className="mt-2.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-slateblue/45">
                      Atualizado em {formatDateTime(session.updated_at)}
                    </p>
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
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col overflow-hidden !p-0">
          <div className="border-b border-white/50 px-4 py-3">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="eyebrow">Conversa Ativa</p>
                <h2 className="mt-1 text-lg font-bold">{activeSession?.title || "Novo chat"}</h2>
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

          <form onSubmit={handleChat} className="border-t border-white/60 bg-white/40 p-4">
            <div className="flex gap-2.5">
              <Input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Digite sua pergunta..."
                className="!rounded-lg"
                autoFocus
              />
              <Button type="submit" isLoading={isBusy} className="!rounded-lg px-4">
                Enviar
              </Button>
            </div>
          </form>
        </GlassCard>

        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-b border-white/50 px-4 py-3">
            <p className="eyebrow">Contexto e Referências</p>
            <p className="mt-1.5 text-[0.7rem] text-slateblue">
              Referências usadas na última resposta.
            </p>
          </div>

          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
            {references.length === 0 ? (
              <p className="px-1 text-[0.7rem] italic text-slateblue/55">
                Referências aparecerão aqui quando a IA utilizar documentos.
              </p>
            ) : (
              references.map((reference, index) => (
                <div key={`${reference.document_id || "ref"}-${index}`} className="rounded-lg border border-white/40 bg-white/60 p-3 text-[0.7rem]">
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
