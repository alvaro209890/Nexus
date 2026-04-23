import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase";
import {
  ChatTurn,
  DocumentRecord,
  SearchResult,
  UploadResponse,
  listDocuments,
  searchSemantic,
  sendChatMessage,
  uploadDocument
} from "../lib/api";

type BusyState = "upload" | "search" | "chat" | null;

const quickPrompts = [
  "Resuma os principais pontos dos documentos recentes",
  "Quais documentos falam sobre tecnologia?",
  "Liste riscos, prazos ou obrigacoes encontrados",
  "Compare os documentos mais relevantes"
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatReferences, setChatReferences] = useState<SearchResult[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [sessionId, setSessionId] = useState("default");
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthChecked(true);
      return;
    }

    return onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      setAuthChecked(true);
      if (!currentUser) void router.replace("/login");
    });
  }, [router]);

  useEffect(() => {
    const savedSession = window.localStorage.getItem("nexus_session_id");
    if (savedSession) {
      setSessionId(savedSession);
      return;
    }

    const nextSession = `nexus-${crypto.randomUUID()}`;
    window.localStorage.setItem("nexus_session_id", nextSession);
    setSessionId(nextSession);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshDocuments();
  }, [user]);

  const displayName = useMemo(() => {
    return user?.displayName || user?.email || "Operador Nexus";
  }, [user]);

  const indexedChunks = documents.reduce((total, document) => total + document.chunks_indexed, 0);
  const lastClassification = uploadResult?.classification || documents[0]?.classification || "aguardando";

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;

    setBusy("upload");
    setError("");
    setUploadStatus("Extraindo texto, classificando e indexando o PDF...");
    try {
      const result = await uploadDocument(selectedFile);
      setUploadResult(result);
      setUploadStatus(
        result.duplicate
          ? "Documento ja existia na memoria. Registro recuperado."
          : `Documento indexado com ${result.chunks_indexed} chunk(s).`
      );
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload.");
      setUploadStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;

    setBusy("search");
    setError("");
    try {
      setSearchResults(await searchSemantic(query.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na busca.");
    } finally {
      setBusy(null);
    }
  }

  async function submitChatMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;

    const nextHistory: ChatTurn[] = [
      ...chatHistory,
      { role: "user", content: cleanMessage }
    ];
    setChatHistory(nextHistory);
    setChatInput("");
    setBusy("chat");
    setError("");
    try {
      const result = await sendChatMessage(cleanMessage, chatHistory, sessionId);
      setChatHistory([
        ...nextHistory,
        { role: "assistant", content: result.answer }
      ]);
      setChatReferences(result.references);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no chat.");
    } finally {
      setBusy(null);
    }
  }

  async function handleChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitChatMessage(chatInput);
  }

  async function handleLogout() {
    if (firebaseAuth) await signOut(firebaseAuth);
    await router.replace("/login");
  }

  async function refreshDocuments() {
    try {
      setDocuments(await listDocuments());
    } catch (err) {
      console.warn("Could not load documents", err);
    }
  }

  if (!authChecked) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="glass-panel rounded-[2rem] p-8 text-center">
          <div className="mx-auto mb-5 h-12 w-12 animate-pulse rounded-2xl bg-amberline" />
          <p className="font-display text-2xl font-bold">Carregando Nexus</p>
          <p className="mt-2 text-sm text-slateblue">Preparando a central documental.</p>
        </div>
      </main>
    );
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="min-h-screen p-8">
        <div className="glass-panel mx-auto max-w-2xl rounded-[2rem] p-8">
          <p className="eyebrow">Configuracao</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Firebase nao configurado</h1>
          <p className="mt-4 text-slateblue">
            Crie `frontend/.env.local` com as variaveis Firebase antes de usar o dashboard.
          </p>
        </div>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen px-4 py-5 md:px-7">
      <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[18rem_1fr]">
        <aside className="glass-panel sticky top-5 hidden h-[calc(100vh-2.5rem)] rounded-[2rem] p-5 xl:flex xl:flex-col">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ink font-display text-xl font-bold text-white">
              N
            </div>
            <div>
              <p className="font-display text-xl font-bold">Nexus</p>
              <p className="text-xs uppercase tracking-[0.22em] text-slateblue">Archive OS</p>
            </div>
          </div>

          <nav className="mt-10 space-y-2 text-sm font-bold">
            <a className="nav-pill nav-pill-active" href="#upload">Upload</a>
            <a className="nav-pill" href="#search">Busca semantica</a>
            <a className="nav-pill" href="#chat">Chat RAG</a>
          </nav>

          <div className="mt-auto rounded-[1.5rem] bg-ink p-5 text-white">
            <p className="text-xs uppercase tracking-[0.24em] text-white/50">Sessao</p>
            <p className="mt-3 break-words font-semibold">{displayName}</p>
            <button
              className="mt-5 w-full rounded-full bg-white px-4 py-2 text-sm font-bold text-ink"
              type="button"
              onClick={handleLogout}
            >
              Sair
            </button>
          </div>
        </aside>

        <section className="space-y-5">
          <header className="hero-panel relative overflow-hidden rounded-[2.2rem] p-6 md:p-8">
            <div className="relative z-10 max-w-4xl">
              <p className="eyebrow">Central Nexus</p>
              <h1 className="mt-4 font-display text-4xl font-bold leading-[0.98] md:text-7xl">
                Transforme PDFs em memoria pesquisavel.
              </h1>
              <p className="mt-5 max-w-2xl text-base text-slateblue md:text-lg">
                Envie documentos, extraia metadados com Groq, indexe conteudo no ChromaDB e consulte tudo por linguagem natural.
              </p>
            </div>
            <div className="relative z-10 mt-8 grid gap-3 md:grid-cols-3">
              <MetricCard label="Ultima classe" value={lastClassification} />
              <MetricCard label="Chunks indexados" value={String(indexedChunks)} />
              <MetricCard label="Memoria documental" value={String(documents.length)} />
            </div>
            <div className="orb orb-one" />
            <div className="orb orb-two" />
          </header>

          {error && (
            <div className="rounded-[1.25rem] border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="space-y-5">
              <form id="upload" className="panel-card" onSubmit={handleUpload}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">01 / Ingestao</p>
                    <h2 className="mt-3 font-display text-3xl font-bold">Upload inteligente</h2>
                  </div>
                  <span className="status-chip">PDF</span>
                </div>
                <p className="mt-3 text-sm text-slateblue">
                  O arquivo original fica em `~/Downloads/BD_NEXUS`, com Markdown e vetores associados ao mesmo documento.
                </p>

                <label className="drop-zone mt-6">
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                  <span className="font-display text-xl font-bold">
                    {selectedFile ? selectedFile.name : "Solte ou selecione um PDF"}
                  </span>
                  <span className="mt-2 text-sm text-slateblue">
                    Docling extrai o conteudo e o Nexus prepara a indexacao semantica.
                  </span>
                </label>

                <button
                  className="primary-button mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
                  type="submit"
                  disabled={!selectedFile || busy === "upload"}
                >
                  {busy === "upload" ? "Processando documento..." : "Enviar e indexar"}
                </button>

                {uploadStatus && <p className="mt-4 text-sm font-semibold text-moss">{uploadStatus}</p>}
                {uploadResult && (
                  <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/70 p-4 text-sm">
                    {uploadResult.duplicate && <p><strong>Status:</strong> documento duplicado</p>}
                    <p><strong>Classificacao:</strong> {uploadResult.classification}</p>
                    <p><strong>Nome sugerido:</strong> {uploadResult.suggested_name}</p>
                    <p className="break-all"><strong>Markdown:</strong> {uploadResult.markdown_path}</p>
                  </div>
                )}
              </form>

              <form id="search" className="panel-card" onSubmit={handleSearch}>
                <p className="eyebrow">02 / Recuperacao</p>
                <h2 className="mt-3 font-display text-3xl font-bold">Busca semantica</h2>
                <p className="mt-3 text-sm text-slateblue">
                  Pesquise pelo sentido da pergunta, nao apenas por palavra exata.
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <input
                    className="field"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ex: documentos sobre contrato e prazo"
                  />
                  <button className="primary-button sm:w-36" type="submit" disabled={busy === "search"}>
                    {busy === "search" ? "Buscando" : "Buscar"}
                  </button>
                </div>
              </form>

              <section className="panel-card">
                <p className="eyebrow">Memoria</p>
                <h2 className="mt-3 font-display text-3xl font-bold">Documentos recentes</h2>
                <div className="mt-4 space-y-3">
                  {documents.length === 0 && (
                    <EmptyState
                      title="Memoria vazia"
                      message="Envie um PDF para criar o primeiro registro persistente."
                    />
                  )}
                  {documents.slice(0, 4).map((document) => (
                    <article key={document.document_id} className="result-card">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="status-chip">{document.classification}</span>
                        <span className="text-xs font-bold text-slateblue">{document.year}</span>
                      </div>
                      <h3 className="mt-2 font-display text-lg font-bold">{document.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-slateblue">
                        {document.summary || document.suggested_name}
                      </p>
                      <p className="mt-2 text-xs text-slateblue/80">
                        {document.chunks_indexed} chunk(s) na memoria
                      </p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel-card">
                <p className="eyebrow">Atalhos de raciocinio</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      className="quick-card"
                      type="button"
                      onClick={() => setChatInput(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-5">
              <section className="panel-card min-h-[23rem]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="eyebrow">Resultados</p>
                    <h2 className="mt-3 font-display text-3xl font-bold">Documentos encontrados</h2>
                  </div>
                  <span className="status-chip">{searchResults.length} item(ns)</span>
                </div>

                <div className="mt-5 space-y-3">
                  {searchResults.length === 0 && (
                    <EmptyState
                      title="Nenhum resultado carregado"
                      message="Faca uma busca semantica ou envie um PDF para popular a base."
                    />
                  )}
                  {searchResults.map((result) => (
                    <article key={result.chunk_id} className="result-card">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="status-chip">{result.classification || "documento"}</span>
                        {result.score !== null && (
                          <span className="text-xs font-bold text-slateblue">
                            score {(result.score * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 font-display text-xl font-bold">
                        {result.metadata.title || result.suggested_name || "Documento sem titulo"}
                      </h3>
                      <p className="mt-2 line-clamp-4 text-sm leading-6 text-slateblue">
                        {result.snippet}
                      </p>
                      {result.markdown_path && (
                        <p className="mt-3 break-all text-xs text-slateblue/80">
                          {result.markdown_path}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              <section id="chat" className="panel-card">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="eyebrow">03 / Sintese</p>
                    <h2 className="mt-3 font-display text-3xl font-bold">Chat RAG</h2>
                    <p className="mt-2 break-all text-xs text-slateblue">
                      Sessao de memoria: {sessionId}
                    </p>
                  </div>
                  <span className="status-chip">{busy === "chat" ? "pensando" : "online"}</span>
                </div>

                <div className="mt-5 max-h-[30rem] space-y-3 overflow-y-auto rounded-[1.5rem] bg-ink/5 p-3">
                  {chatHistory.length === 0 && (
                    <EmptyState
                      title="Converse com a base"
                      message="O Nexus usa os documentos mais relevantes como contexto antes de responder."
                    />
                  )}
                  {chatHistory.map((turn, index) => (
                    <div
                      key={`${turn.role}-${index}`}
                      className={`chat-bubble ${turn.role === "user" ? "chat-user" : "chat-assistant"}`}
                    >
                      {turn.content}
                    </div>
                  ))}
                </div>

                <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleChat}>
                  <input
                    className="field"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Pergunte ao Nexus..."
                  />
                  <button className="primary-button sm:w-36" type="submit" disabled={busy === "chat"}>
                    Enviar
                  </button>
                </form>

                {chatReferences.length > 0 && (
                  <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/70 p-4">
                    <p className="eyebrow">Referencias usadas</p>
                    <div className="mt-3 space-y-2">
                      {chatReferences.map((reference) => (
                        <p key={reference.chunk_id} className="text-sm font-semibold">
                          {reference.metadata.title || reference.suggested_name || reference.document_id}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-slateblue">{label}</p>
      <p className="mt-2 truncate font-display text-2xl font-bold">{value}</p>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-ink/15 bg-white/50 p-6 text-center">
      <p className="font-display text-xl font-bold">{title}</p>
      <p className="mt-2 text-sm text-slateblue">{message}</p>
    </div>
  );
}
