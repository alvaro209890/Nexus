import { useState, FormEvent, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { ChatTurn, SearchResult, sendChatMessage } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

export default function ChatPage() {
  const { user, getCurrentToken } = useAuth();
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [references, setReferences] = useState<SearchResult[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      const storageKey = `nexus_session_id:${user.uid}`;
      let id = window.localStorage.getItem(storageKey);
      if (!id) {
        id = `nexus-${user.uid}-${crypto.randomUUID()}`;
        window.localStorage.setItem(storageKey, id);
      }
      setSessionId(id);
    }
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  async function handleChat(event: FormEvent) {
    event.preventDefault();
    const cleanMessage = chatInput.trim();
    if (!cleanMessage || isBusy) return;

    const nextHistory: ChatTurn[] = [
      ...chatHistory,
      { role: "user", content: cleanMessage }
    ];
    
    setChatHistory(nextHistory);
    setChatInput("");
    setIsBusy(true);
    setError("");
    
    try {
      const token = await getCurrentToken();
      const result = await sendChatMessage(
        cleanMessage,
        chatHistory,
        sessionId,
        token
      );
      
      setChatHistory([
        ...nextHistory,
        { role: "assistant", content: result.answer }
      ]);
      setReferences(result.references);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao processar mensagem.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <header className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight">IA Chat Assistente</h1>
        <p className="text-slateblue mt-2">Converse com seu repositório de documentos usando inteligência artificial.</p>
      </header>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Chat Area */}
        <GlassCard className="lg:col-span-3 flex flex-col p-0 overflow-hidden relative border-white/60">
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {chatHistory.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
                <div className="w-16 h-16 bg-slateblue/10 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-xl font-bold italic text-slateblue">Aguardando início do diálogo...</p>
                <p className="text-sm mt-2 max-w-sm">Pergunte qualquer coisa sobre os documentos indexados no seu repositório Nexus.</p>
              </div>
            )}

            {chatHistory.map((turn, i) => (
              <div 
                key={i} 
                className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`chat-bubble shadow-sm ${turn.role === "user" ? "chat-user" : "chat-assistant"}`}>
                  <p className="text-sm font-bold opacity-50 mb-1 uppercase tracking-tighter">
                    {turn.role === "user" ? "Operador" : "Nexus IA"}
                  </p>
                  {turn.content}
                </div>
              </div>
            ))}
            
            {isBusy && (
              <div className="flex justify-start">
                <div className="chat-assistant chat-bubble shadow-sm animate-pulse">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-slateblue/40 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 bg-slateblue/40 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 bg-slateblue/40 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                </div>
              </div>
            )}
            
            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-600 text-xs font-bold border border-red-100">
                ERRO: {error}
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          <form onSubmit={handleChat} className="p-6 bg-white/40 border-t border-white/60">
            <div className="flex gap-3">
              <Input 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Digite sua pergunta para a IA..."
                className="!rounded-2xl"
                autoFocus
              />
              <Button type="submit" isLoading={isBusy} className="!rounded-2xl px-6">
                Enviar
              </Button>
            </div>
          </form>
        </GlassCard>

        {/* References Sidebar */}
        <div className="hidden lg:flex flex-col space-y-4 overflow-hidden">
          <p className="eyebrow px-2">Referências do Contexto</p>
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
            {references.length === 0 ? (
              <p className="text-[0.65rem] text-slateblue/50 italic px-2">As referências utilizadas para gerar a resposta aparecerão aqui.</p>
            ) : (
              references.map((ref, idx) => (
                <div key={idx} className="p-3 glass-panel rounded-xl text-[0.7rem] border-white/40">
                  <p className="font-bold text-slateblue mb-1 truncate">{ref.suggested_name || ref.metadata?.filename || "Documento"}</p>
                  <p className="text-ink/70 line-clamp-4 leading-relaxed italic">&ldquo;{ref.snippet}&rdquo;</p>
                  <p className="mt-2 text-[0.6rem] font-extrabold uppercase tracking-widest text-amberline">Score: {((ref.score ?? 0) * 100).toFixed(0)}%</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
