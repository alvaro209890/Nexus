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
      <header className="flex justify-between items-end">
        <div>
          <p className="eyebrow mb-1">Visão Geral do Sistema</p>
          <h1 className="text-2xl font-bold tracking-tight">
            Bem-vindo, <span className="text-slateblue">{user?.displayName || user?.email?.split("@")[0] || "Operador"}</span>
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-widest text-slateblue/60">Status do Nexus</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-bold">Ambiente Sincronizado</span>
          </div>
        </div>
      </header>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <GlassCard className="!bg-ink text-white">
          <p className="eyebrow !text-white/40 mb-2">Total de Documentos</p>
          <p className="text-3xl font-bold font-mono">{loading ? "..." : documents.length}</p>
          <p className="text-xs mt-4 text-white/50 font-medium">Arquivos PDF processados na nuvem</p>
        </GlassCard>
        
        <GlassCard>
          <p className="eyebrow mb-2">Conhecimento Indexado</p>
          <p className="text-3xl font-bold font-mono text-slateblue">{loading ? "..." : totalChunks}</p>
          <p className="text-xs mt-4 text-slateblue/60 font-medium">Vetores (chunks) prontos para RAG</p>
        </GlassCard>

        <GlassCard>
          <p className="eyebrow mb-2">Sessão Ativa</p>
          <p className="text-lg font-bold mt-2 truncate">{authProfile?.display_name || authProfile?.email || "Sessão privada"}</p>
          <div className="mt-5">
             <StatusChip label="Privado" variant="success" />
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="space-y-4">
          <p className="eyebrow">Ações Rápidas</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/documents" className="quick-card group">
              <div className="flex flex-col h-full justify-between">
                <svg className="w-5 h-5 text-slateblue group-hover:text-amberline transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>Upload de Documentos</span>
              </div>
            </Link>
            <Link href="/files" className="quick-card group">
              <div className="flex flex-col h-full justify-between">
                <svg className="w-5 h-5 text-slateblue group-hover:text-amberline transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span>Explorar Arquivos</span>
              </div>
            </Link>
            <Link href="/chat" className="quick-card group sm:col-span-2">
              <div className="flex flex-col h-full justify-between">
                <svg className="w-5 h-5 text-slateblue group-hover:text-amberline transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span>Consultar Assistente IA</span>
              </div>
            </Link>
          </div>

          <GlassCard className="mt-5 !p-5 bg-amberline/5 border-amberline/20">
            <h3 className="font-bold text-amber-900 mb-2">Como utilizar o Nexus?</h3>
            <p className="text-sm text-amber-900/70 leading-relaxed">
              1. Comece enviando seus arquivos PDF na aba <b>Documentos</b>.<br/>
              2. Aguarde a indexação (processamento vetorial).<br/>
              3. Use o <b>Chat IA</b> para fazer perguntas complexas baseadas nos seus dados ou a <b>Busca Semântica</b> para encontrar trechos específicos.
            </p>
          </GlassCard>
        </div>

        {/* Recent Activity */}
        <GlassCard className="overflow-hidden">
          <div className="flex justify-between items-center mb-5">
             <p className="eyebrow">Atividade Recente</p>
             <Link href="/documents" className="text-[0.6rem] font-bold text-slateblue hover:text-ink transition-colors uppercase tracking-widest">Ver Todos</Link>
          </div>
          
          <div className="space-y-2.5">
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-10 bg-slateblue/5 animate-pulse rounded-lg" />)}
              </div>
            ) : recentDocs.length === 0 ? (
              <p className="text-center py-8 text-slateblue/50 italic text-sm">Nenhuma atividade registrada.</p>
            ) : (
              recentDocs.map(doc => (
                <div key={doc.document_id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/50 transition-colors border border-transparent hover:border-white/60">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-slateblue/10 rounded flex items-center justify-center">
                       <svg className="w-3.5 h-3.5 text-slateblue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                       </svg>
                    </div>
                    <div>
                      <p className="text-xs font-bold truncate max-w-[160px]">{doc.suggested_name || doc.original_name}</p>
                      <p className="text-[0.55rem] text-slateblue/60 uppercase font-bold">{new Date(doc.uploaded_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <StatusChip label={doc.classification || "PDF"} variant="info" />
                </div>
              ))
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
