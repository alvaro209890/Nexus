import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, listDocuments } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";

export default function DashboardPage() {
  const { user, authProfile, getCurrentToken } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && authProfile) {
      void (async () => {
        try {
          const token = await getCurrentToken();
          const docs = await listDocuments(token, 50);
          setDocuments(docs);
        } catch (err) {
          console.error("Failed to load dashboard metrics", err);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [user, authProfile, getCurrentToken]);

  const totalChunks = documents.reduce((acc, doc) => acc + (doc.chunks_indexed || 0), 0);
  const recentDocs = documents.slice(0, 5);

  return (
    <div className="space-y-6">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="eyebrow mb-1">Painel Geral</p>
          <h1 className="text-3xl font-bold tracking-tight">
            Ola, <span className="text-white">{user?.displayName || user?.email?.split("@")[0] || "Operador"}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slateblue/70">
            Acompanhe documentos, indexacao e acessos recentes em um unico lugar.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[rgba(26,31,39,0.9)] px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-slateblue/60">Status do Nexus</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--success)]"></div>
            <span className="text-sm font-semibold">Ambiente sincronizado</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <GlassCard className="!bg-[rgba(26,31,39,0.96)]">
              <p className="eyebrow mb-2">Documentos</p>
              <p className="text-3xl font-bold font-mono">{loading ? "..." : documents.length}</p>
              <p className="mt-3 text-sm text-slateblue/70">Arquivos prontos para consulta.</p>
            </GlassCard>

            <GlassCard>
              <p className="eyebrow mb-2">Conhecimento indexado</p>
              <p className="text-3xl font-bold font-mono text-white">{loading ? "..." : totalChunks}</p>
              <p className="mt-3 text-sm text-slateblue/70">Trechos disponiveis para busca e chat.</p>
            </GlassCard>

            <GlassCard>
              <p className="eyebrow mb-2">Sessao ativa</p>
              <p className="mt-1 text-base font-bold leading-snug">{authProfile?.display_name || authProfile?.email || "Sessao privada"}</p>
              <div className="mt-4">
                <StatusChip label="Privada" variant="success" />
              </div>
            </GlassCard>
          </div>

          <GlassCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Acoes rapidas</p>
                <p className="mt-1 text-sm text-slateblue/70">Comece pelas tarefas mais comuns.</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Link href="/documents" className="quick-card group">
                <div className="flex h-full flex-col justify-between gap-4">
                  <QuickActionIcon type="upload" />
                  <div>
                    <p className="font-bold">Enviar documentos</p>
                    <p className="mt-1 text-sm text-slateblue/70">Adicione PDFs e acompanhe a indexacao.</p>
                  </div>
                </div>
              </Link>
              <Link href="/files" className="quick-card group">
                <div className="flex h-full flex-col justify-between gap-4">
                  <QuickActionIcon type="files" />
                  <div>
                    <p className="font-bold">Explorar arquivos</p>
                    <p className="mt-1 text-sm text-slateblue/70">Navegue por pastas, filtros e metadados.</p>
                  </div>
                </div>
              </Link>
              <Link href="/chat" className="quick-card group">
                <div className="flex h-full flex-col justify-between gap-4">
                  <QuickActionIcon type="chat" />
                  <div>
                    <p className="font-bold">Abrir chat</p>
                    <p className="mt-1 text-sm text-slateblue/70">Pergunte sobre sua base com contexto.</p>
                  </div>
                </div>
              </Link>
            </div>
          </GlassCard>
        </div>
        
        <GlassCard className="overflow-hidden">
          <div className="flex justify-between items-center mb-5">
             <p className="eyebrow">Atividade recente</p>
             <Link href="/documents" className="text-[0.75rem] font-bold text-slateblue hover:text-white transition-colors">Ver tudo</Link>
          </div>
          
          <div className="space-y-2.5">
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-10 bg-slateblue/5 animate-pulse rounded-lg" />)}
              </div>
            ) : recentDocs.length === 0 ? (
              <div className="empty-state !min-h-[12rem]">
                <p className="text-base font-semibold">Nenhum documento indexado ainda.</p>
                <p className="max-w-sm text-sm text-slateblue/70">Envie o primeiro PDF para começar a busca, o chat e a organizacao automatica.</p>
              </div>
            ) : (
              recentDocs.map(doc => (
                <div key={doc.document_id} className="flex items-center justify-between rounded-xl border border-transparent p-3 transition-colors hover:border-white/10 hover:bg-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(126,178,214,0.12)]">
                       <svg className="w-3.5 h-3.5 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                       </svg>
                    </div>
                    <div>
                      <p className="max-w-[220px] truncate text-sm font-bold">{doc.suggested_name || doc.original_name}</p>
                      <p className="text-[0.72rem] text-slateblue/60">{new Date(doc.uploaded_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <StatusChip label={doc.classification || "PDF"} variant="info" />
                </div>
              ))
            )}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="border-[rgba(126,178,214,0.18)] bg-[rgba(126,178,214,0.08)]">
        <h3 className="text-lg font-bold">Como seguir</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slateblue/70">
          Primeiro envie seus PDFs em Documentos. Depois acompanhe a organizacao em Arquivos e use Busca ou Chat para encontrar respostas com contexto.
        </p>
      </GlassCard>
    </div>
  );
}

function QuickActionIcon({ type }: { type: "upload" | "files" | "chat" }) {
  const icons = {
    upload: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
    files: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
    chat: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
  };

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(126,178,214,0.12)] text-white">
      <svg className="h-5 w-5 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={icons[type]} />
      </svg>
    </div>
  );
}
