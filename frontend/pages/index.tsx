import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, listDocuments } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { motion, Variants } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  Database,
  FileText,
  FolderTree,
  HardDrive,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

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
      return;
    }

    if (!user) {
      setLoading(false);
    }
  }, [user, authProfile, getCurrentToken]);

  const totalChunks = documents.reduce((acc, doc) => acc + (doc.chunks_indexed || 0), 0);
  const recentDocs = documents.slice(0, 5);
  const displayName = authProfile?.display_name || user?.displayName || authProfile?.email?.split("@")[0] || user?.email?.split("@")[0] || "Operador";
  const displayEmail = authProfile?.email || user?.email || "--";
  const providerText = authProfile?.provider_ids?.length ? authProfile.provider_ids.map(formatProvider).join(", ") : "--";
  const storageUsed = authProfile?.storage_used_bytes || 0;
  const storageLimit = authProfile?.storage_limit_bytes || 0;
  const storagePercent = storageLimit > 0 ? Math.min(100, Math.round((storageUsed / storageLimit) * 100)) : 0;

  const formatDocName = (name: string) => {
    let clean = name.replace(/_/g, " ").replace(/\.pdf$/i, "");
    clean = clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
    return clean.length > 40 ? clean.substring(0, 40) + "..." : clean;
  };

  return (
    <motion.div 
      variants={staggerContainer} 
      initial="hidden" 
      animate="show" 
      className="space-y-8 pb-8"
    >
      <motion.header variants={fadeUpItem} className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-gradient-to-r from-accent/10 via-bg-surface-strong/50 to-transparent p-6 rounded-3xl border border-border-soft overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/20 blur-[100px] rounded-full pointer-events-none" />
        <div className="relative z-10">
          <p className="eyebrow mb-2 text-accent-strong">Painel Geral</p>
          <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">
            Olá, <span className="text-white">{displayName}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-secondary">
            Acompanhe seus documentos, status de indexação e dados da sessão em um único lugar.
          </p>
        </div>
        <div className="relative z-10 rounded-2xl border border-border-strong bg-surface-strong/80 px-4 py-3 flex flex-col gap-2 shadow-panel backdrop-blur-md">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Status do Sistema</p>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-success" />
            <span className="text-sm font-semibold text-primary">Ambiente sincronizado</span>
          </div>
        </div>
      </motion.header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          <motion.div variants={staggerContainer} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div variants={fadeUpItem} className="h-full">
              <GlassCard className="flex flex-col gap-2 h-full relative overflow-hidden group border-border-soft hover:border-accent/30 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-center gap-2 mb-2 text-muted relative z-10">
                  <FileText size={18} className="text-accent" />
                  <p className="text-xs font-bold uppercase tracking-wider">Documentos</p>
                </div>
                <p className="text-4xl font-display font-bold relative z-10">{loading ? "..." : documents.length}</p>
                <p className="text-sm text-secondary mt-auto pt-4 border-t border-border-soft relative z-10">Arquivos na base</p>
              </GlassCard>
            </motion.div>

            <motion.div variants={fadeUpItem} className="h-full">
              <GlassCard className="flex flex-col gap-2 h-full relative overflow-hidden group border-border-soft hover:border-accent/30 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-center gap-2 mb-2 text-muted relative z-10">
                  <Database size={18} className="text-accent" />
                  <p className="text-xs font-bold uppercase tracking-wider">Base Indexada</p>
                </div>
                <p className="text-4xl font-display font-bold text-accent-strong relative z-10">{loading ? "..." : totalChunks}</p>
                <p className="text-sm text-secondary mt-auto pt-4 border-t border-border-soft relative z-10">Trechos semânticos</p>
              </GlassCard>
            </motion.div>

            <motion.div variants={fadeUpItem} className="h-full">
              <GlassCard className="flex flex-col gap-2 h-full relative overflow-hidden group border-border-soft hover:border-accent/30 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-center gap-2 mb-2 text-muted relative z-10">
                  <ShieldCheck size={18} className="text-accent" />
                  <p className="text-xs font-bold uppercase tracking-wider">Sessão</p>
                </div>
                <p className="text-lg font-bold leading-snug truncate relative z-10" title={displayEmail}>
                  {displayEmail}
                </p>
                <div className="mt-auto pt-3 border-t border-border-soft relative z-10">
                  <StatusChip label="Isolamento Ativo" variant="success" />
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>

          <motion.div variants={fadeUpItem}>
            <GlassCard className="overflow-hidden relative border-border-soft hover:border-accent/20 transition-colors">
              <div className="absolute top-0 right-0 w-96 h-96 bg-accent/5 blur-[100px] pointer-events-none rounded-full" />
              <div className="mb-6 relative z-10">
                <p className="eyebrow text-accent-strong">Ações Rápidas</p>
                <p className="mt-1 text-sm text-secondary">Acesse as principais funcionalidades do Nexus.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative z-10">
                <Link href="/documents" className="block group">
                  <div className="bg-bg-surface border border-border-soft rounded-2xl p-5 h-full transition-all duration-300 hover:border-accent/40 hover:bg-white/5 hover:shadow-lift hover:-translate-y-1">
                    <div className="h-12 w-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                      <Upload size={24} />
                    </div>
                    <p className="font-bold text-lg mb-1">Upload</p>
                    <p className="text-sm text-secondary">Adicione PDFs e ZIPs à base.</p>
                  </div>
                </Link>

                <Link href="/files" className="block group">
                  <div className="bg-bg-surface border border-border-soft rounded-2xl p-5 h-full transition-all duration-300 hover:border-accent/40 hover:bg-white/5 hover:shadow-lift hover:-translate-y-1">
                    <div className="h-12 w-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                      <FolderTree size={24} />
                    </div>
                    <p className="font-bold text-lg mb-1">Arquivos</p>
                    <p className="text-sm text-secondary">Explore o acervo organizado.</p>
                  </div>
                </Link>

                <Link href="/chat" className="block group">
                  <div className="bg-bg-surface border border-border-soft rounded-2xl p-5 h-full transition-all duration-300 hover:border-accent/40 hover:bg-white/5 hover:shadow-lift hover:-translate-y-1">
                    <div className="h-12 w-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                      <MessageSquare size={24} />
                    </div>
                    <p className="font-bold text-lg mb-1">Chat RAG</p>
                    <p className="text-sm text-secondary">Converse com os seus dados.</p>
                  </div>
                </Link>
              </div>
            </GlassCard>
          </motion.div>
        </div>

        <motion.div variants={staggerContainer} className="space-y-6">
          <motion.div variants={fadeUpItem}>
            <GlassCard className="space-y-5 border-border-soft">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow text-accent-strong">Dados do usuário</p>
                  <p className="mt-1 text-sm text-secondary">Perfil sincronizado pelo backend.</p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <UserRound size={22} />
                </div>
              </div>

              <div className="space-y-3">
                <UserDataRow icon={<UserRound size={16} />} label="Nome" value={displayName} />
                <UserDataRow icon={<ShieldCheck size={16} />} label="E-mail" value={displayEmail} />
                <UserDataRow icon={<KeyRound size={16} />} label="UID" value={authProfile?.uid || "--"} monospace />
                <UserDataRow icon={<ShieldCheck size={16} />} label="Provedor" value={providerText} />
                <UserDataRow icon={<Clock size={16} />} label="Criado em" value={formatDateTime(authProfile?.created_at)} />
                <UserDataRow icon={<Clock size={16} />} label="Último login" value={formatDateTime(authProfile?.last_login_at)} />
                <UserDataRow icon={<Database size={16} />} label="Coleção vetorial" value={authProfile?.collection_name || "--"} monospace />
                
                <div className="rounded-xl border border-border-soft bg-black/20 p-4 transition-colors hover:bg-black/30">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-muted">
                      <HardDrive size={16} className="text-accent" />
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em]">Armazenamento</p>
                    </div>
                    <span className="text-xs font-bold text-accent-strong bg-accent/10 px-2 py-0.5 rounded-md">{storagePercent}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }} 
                      animate={{ width: `${storagePercent}%` }} 
                      transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                      className="h-full bg-accent relative"
                    >
                      <div className="absolute inset-0 bg-white/20 w-full h-full animate-pulse" />
                    </motion.div>
                  </div>
                  <p className="mt-2.5 text-sm font-semibold text-primary">
                    {formatBytes(storageUsed)} <span className="text-muted font-normal">de {formatBytes(storageLimit)}</span>
                  </p>
                </div>
                
                <UserDataRow icon={<HardDrive size={16} />} label="Workspace" value={shortenPath(authProfile?.user_root)} />
                <UserDataRow icon={<HardDrive size={16} />} label="Memória" value={shortenPath(authProfile?.memory_dir)} />
              </div>
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUpItem} className="h-full">
            <GlassCard className="flex flex-col h-full min-h-[24rem] border-border-soft">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2 text-accent-strong">
                  <Clock size={18} />
                  <p className="eyebrow m-0">Atividade Recente</p>
                </div>
                <Link href="/documents" className="text-xs font-bold text-accent hover:text-accent-strong transition-colors hover:underline">Ver tudo</Link>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((item) => <div key={item} className="h-14 bg-white/5 animate-pulse rounded-xl" />)}
                  </div>
                ) : recentDocs.length === 0 ? (
                  <div className="empty-state border border-dashed border-border-soft rounded-2xl h-full flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-16 h-16 bg-bg-surface rounded-full flex items-center justify-center mb-4">
                      <FileText size={24} className="text-muted" />
                    </div>
                    <p className="text-base font-semibold">Nenhum documento</p>
                    <p className="text-sm text-secondary mt-1 max-w-[200px]">Envie um PDF ou ZIP para começar a povoar sua base.</p>
                  </div>
                ) : (
                  recentDocs.map((doc, i) => (
                    <motion.div 
                      key={doc.document_id} 
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center justify-between rounded-xl border border-border-soft bg-bg-surface-strong p-3 transition-colors hover:border-accent/40 hover:bg-white/5 group cursor-pointer"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-bg-surface text-accent border border-border-soft group-hover:bg-accent/10 transition-colors">
                          <FileText size={18} />
                        </div>
                        <div className="overflow-hidden">
                          <p className="truncate text-sm font-semibold group-hover:text-accent transition-colors" title={doc.suggested_name || doc.original_name}>
                            {formatDocName(doc.suggested_name || doc.original_name)}
                          </p>
                          <p className="text-[0.68rem] font-medium text-muted mt-0.5">{new Date(doc.uploaded_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function UserDataRow({
  icon,
  label,
  value,
  monospace = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-black/20 px-4 py-3 transition-colors hover:bg-black/30">
      <div className="mb-1.5 flex items-center gap-2 text-muted">
        {icon}
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-secondary">{label}</p>
      </div>
      <p className={`break-all text-sm font-semibold text-primary ${monospace ? "font-mono text-[0.8rem]" : ""}`} title={value}>
        {value || "--"}
      </p>
    </div>
  );
}

function formatProvider(providerId: string): string {
  if (providerId === "password") return "E-mail e senha";
  if (providerId === "google.com") return "Google";
  return providerId;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortenPath(value?: string | null): string {
  if (!value) return "--";
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= 4) return value;
  return `.../${parts.slice(-4).join("/")}`;
}
