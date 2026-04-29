import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, listDocuments } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
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
    <div className="space-y-8 animate-fade-in">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-gradient-to-r from-accent-soft to-transparent p-6 rounded-2xl border border-border-soft">
        <div>
          <p className="eyebrow mb-2 text-accent-strong">Painel Geral</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Olá, <span className="text-white">{displayName}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-secondary">
            Acompanhe seus documentos, status de indexação e dados da sessão em um único lugar.
          </p>
        </div>
        <div className="rounded-xl border border-border-strong bg-[rgba(39,39,42,0.9)] px-4 py-3 flex flex-col gap-2 shadow-panel backdrop-blur-md">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Status do Sistema</p>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-success" />
            <span className="text-sm font-semibold text-primary">Ambiente sincronizado</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard className="flex flex-col gap-2 !bg-gradient-to-br from-[rgba(39,39,42,0.9)] to-[rgba(24,24,27,0.7)]">
              <div className="flex items-center gap-2 mb-2 text-muted">
                <FileText size={18} />
                <p className="text-xs font-bold uppercase tracking-wider">Documentos</p>
              </div>
              <p className="text-4xl font-bold">{loading ? "..." : documents.length}</p>
              <p className="text-sm text-secondary mt-auto pt-2 border-t border-border-soft">Arquivos na base</p>
            </GlassCard>

            <GlassCard className="flex flex-col gap-2 !bg-gradient-to-br from-[rgba(39,39,42,0.9)] to-[rgba(24,24,27,0.7)]">
              <div className="flex items-center gap-2 mb-2 text-muted">
                <Database size={18} />
                <p className="text-xs font-bold uppercase tracking-wider">Base Indexada</p>
              </div>
              <p className="text-4xl font-bold text-accent-strong">{loading ? "..." : totalChunks}</p>
              <p className="text-sm text-secondary mt-auto pt-2 border-t border-border-soft">Trechos semânticos</p>
            </GlassCard>

            <GlassCard className="flex flex-col gap-2 !bg-gradient-to-br from-[rgba(39,39,42,0.9)] to-[rgba(24,24,27,0.7)]">
              <div className="flex items-center gap-2 mb-2 text-muted">
                <ShieldCheck size={18} />
                <p className="text-xs font-bold uppercase tracking-wider">Sessão</p>
              </div>
              <p className="text-lg font-bold leading-snug truncate" title={displayEmail}>
                {displayEmail}
              </p>
              <div className="mt-auto pt-2 border-t border-border-soft">
                <StatusChip label="Isolamento Ativo" variant="success" />
              </div>
            </GlassCard>
          </div>

          <GlassCard>
            <div className="mb-6">
              <p className="eyebrow text-accent-strong">Ações Rápidas</p>
              <p className="mt-1 text-sm text-secondary">Acesse as principais funcionalidades do Nexus.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link href="/documents" className="quick-card group !min-h-[9rem]">
                <div className="h-12 w-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                  <Upload size={24} />
                </div>
                <p className="font-bold text-lg mb-1">Upload</p>
                <p className="text-sm text-secondary">Adicione PDFs e ZIPs à base.</p>
              </Link>

              <Link href="/files" className="quick-card group !min-h-[9rem]">
                <div className="h-12 w-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                  <FolderTree size={24} />
                </div>
                <p className="font-bold text-lg mb-1">Arquivos</p>
                <p className="text-sm text-secondary">Explore o acervo organizado.</p>
              </Link>

              <Link href="/chat" className="quick-card group !min-h-[9rem]">
                <div className="h-12 w-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                  <MessageSquare size={24} />
                </div>
                <p className="font-bold text-lg mb-1">Chat RAG</p>
                <p className="text-sm text-secondary">Converse com os seus dados.</p>
              </Link>
            </div>
          </GlassCard>
        </div>

        <div className="space-y-6">
          <GlassCard className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow text-accent-strong">Dados do usuário</p>
                <p className="mt-1 text-sm text-secondary">Perfil sincronizado pelo backend.</p>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
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
              <div className="rounded-xl border border-border-soft bg-[rgba(0,0,0,0.12)] px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-muted">
                    <HardDrive size={16} />
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em]">Armazenamento</p>
                  </div>
                  <span className="text-xs font-bold text-accent-strong">{storagePercent}%</span>
                </div>
                <div className="progress-track bg-black/20">
                  <div className="progress-bar" style={{ width: `${storagePercent}%` }} />
                </div>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {formatBytes(storageUsed)} de {formatBytes(storageLimit)}
                </p>
              </div>
              <UserDataRow icon={<HardDrive size={16} />} label="Workspace" value={shortenPath(authProfile?.user_root)} />
              <UserDataRow icon={<HardDrive size={16} />} label="Memória" value={shortenPath(authProfile?.memory_dir)} />
            </div>
          </GlassCard>

          <GlassCard className="flex flex-col h-full !min-h-[24rem]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2 text-accent-strong">
                <Clock size={18} />
                <p className="eyebrow m-0">Atividade Recente</p>
              </div>
              <Link href="/documents" className="text-xs font-bold text-accent hover:text-accent-strong transition-colors">Ver tudo</Link>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((item) => <div key={item} className="h-14 bg-white/5 animate-pulse rounded-xl" />)}
                </div>
              ) : recentDocs.length === 0 ? (
                <div className="empty-state !min-h-[16rem]">
                  <FileText size={32} className="text-muted mb-2" />
                  <p className="text-base font-semibold">Nenhum documento.</p>
                  <p className="text-sm text-secondary">Envie um PDF ou ZIP para começar.</p>
                </div>
              ) : (
                recentDocs.map((doc) => (
                  <div key={doc.document_id} className="flex items-center justify-between rounded-xl border border-border-soft p-3 transition-colors hover:border-border-strong hover:bg-white/5 group">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                        <FileText size={18} />
                      </div>
                      <div className="overflow-hidden">
                        <p className="truncate text-sm font-bold group-hover:text-accent-strong transition-colors" title={doc.suggested_name || doc.original_name}>
                          {formatDocName(doc.suggested_name || doc.original_name)}
                        </p>
                        <p className="text-xs text-muted mt-0.5">{new Date(doc.uploaded_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
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
    <div className="rounded-xl border border-border-soft bg-[rgba(0,0,0,0.12)] px-3 py-3">
      <div className="mb-1 flex items-center gap-2 text-muted">
        {icon}
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em]">{label}</p>
      </div>
      <p className={`break-all text-sm font-semibold text-primary ${monospace ? "font-mono" : ""}`} title={value}>
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
