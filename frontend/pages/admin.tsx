import { DragEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Database, HardDrive, RefreshCw, UploadCloud, Users } from "lucide-react";
import {
  AdminUserRecord,
  listAdminUsers,
  updateAdminUserStorageLimit,
  uploadAdminDocuments,
} from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

const ADMIN_TOKEN_STORAGE_KEY = "nexus_admin_token";

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadComment, setUploadComment] = useState("");
  const [limitGb, setLimitGb] = useState("5");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.uid === selectedUid) || null,
    [selectedUid, users]
  );

  const loadUsers = useCallback(async (token = adminToken) => {
    if (!token) return;
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextUsers = await listAdminUsers(token);
      setUsers(nextUsers);
      setSelectedUid((current) => current || nextUsers[0]?.uid || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
    if (storedToken) {
      setAdminToken(storedToken);
      setTokenInput(storedToken);
      void loadUsers(storedToken);
    }
  }, [loadUsers]);

  useEffect(() => {
    if (!selectedUser) return;
    setLimitGb(formatGbInput(selectedUser.storage_limit_bytes));
  }, [selectedUser]);

  async function handleTokenSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) return;
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, cleanToken);
    setAdminToken(cleanToken);
    await loadUsers(cleanToken);
  }

  async function handleSaveLimit() {
    if (!selectedUser) return;
    const parsedGb = Number.parseFloat(limitGb.replace(",", "."));
    if (!Number.isFinite(parsedGb) || parsedGb < 0) {
      setError("Informe um limite válido em GB.");
      return;
    }
    setSavingLimit(true);
    setError("");
    setStatus("");
    try {
      const updated = await updateAdminUserStorageLimit(adminToken, selectedUser.uid, Math.round(parsedGb * 1024 * 1024 * 1024));
      setUsers((current) => current.map((user) => user.uid === updated.uid ? updated : user));
      setStatus("Limite atualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar limite.");
    } finally {
      setSavingLimit(false);
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser || selectedFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setError("");
    setStatus("");
    try {
      const result = await uploadAdminDocuments(adminToken, selectedUser.uid, selectedFiles, uploadComment, setUploadProgress);
      setUsers((current) => current.map((user) => user.uid === result.user.uid ? result.user : user));
      setSelectedFiles([]);
      setUploadComment("");
      setUploadProgress(100);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const message = result.failed_count > 0
        ? `${result.uploaded_count} enviados, ${result.failed_count} falharam: ${result.errors[0]?.detail || "erro no upload"}`
        : `${result.uploaded_count} arquivo(s) enviado(s).`;
      setStatus(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar arquivos.");
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    setSelectedFiles(Array.from(event.dataTransfer.files || []).filter(isAcceptedFile));
  }

  const totalUsed = users.reduce((sum, user) => sum + user.storage_used_bytes, 0);
  const totalLimit = users.reduce((sum, user) => sum + user.storage_limit_bytes, 0);

  return (
    <main className="min-h-screen bg-bg-base px-4 py-6 text-primary md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border-soft bg-bg-surface p-5 shadow-panel md:flex-row md:items-center md:justify-between">
          <div>
            <p className="eyebrow">Nexus Admin</p>
            <h1 className="mt-2 text-3xl font-bold">Controle de armazenamento</h1>
            <p className="mt-1 text-sm text-secondary">Painel administrativo com chave do backend. Não usa login Firebase.</p>
          </div>
          <form onSubmit={handleTokenSubmit} className="flex w-full flex-col gap-2 md:w-[28rem] md:flex-row md:items-end">
            <Input
              label="Chave admin"
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="X-Admin-Token"
            />
            <Button type="submit" isLoading={loading} className="md:mb-0">
              Entrar
            </Button>
          </form>
        </header>

        {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</div>}
        {status && <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success">{status}</div>}

        <section className="grid gap-4 md:grid-cols-3">
          <Metric icon={<Users size={20} />} label="Usuários" value={String(users.length)} />
          <Metric icon={<HardDrive size={20} />} label="Uso total" value={`${formatBytes(totalUsed)} / ${formatBytes(totalLimit)}`} />
          <Metric icon={<Database size={20} />} label="Arquivos e notas" value={String(users.reduce((sum, user) => sum + user.document_count + user.note_count, 0))} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-border-soft bg-bg-surface p-5 shadow-panel">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Usuários</p>
                <p className="mt-1 text-sm text-secondary">Selecione uma conta para ajustar limite e enviar arquivos.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => void loadUsers()} isLoading={loading}>
                <RefreshCw size={16} />
              </Button>
            </div>

            <div className="max-h-[58vh] overflow-auto rounded-xl border border-border-soft">
              <table className="nexus-table">
                <thead className="sticky top-0 bg-bg-surface-strong">
                  <tr>
                    <th>Usuário</th>
                    <th>Uso</th>
                    <th>Limite</th>
                    <th>Itens</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const percent = user.storage_limit_bytes > 0 ? Math.min(100, Math.round((user.storage_used_bytes / user.storage_limit_bytes) * 100)) : 0;
                    return (
                      <tr
                        key={user.uid}
                        className={`cursor-pointer ${selectedUid === user.uid ? "bg-accent/10" : ""}`}
                        onClick={() => setSelectedUid(user.uid)}
                      >
                        <td>
                          <p className="font-semibold">{user.email || user.display_name || user.uid}</p>
                          <p className="max-w-[18rem] truncate text-xs text-muted">{user.uid}</p>
                        </td>
                        <td>
                          <div className="min-w-[9rem]">
                            <div className="progress-track bg-black/20">
                              <div className="progress-bar" style={{ width: `${percent}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-secondary">{formatBytes(user.storage_used_bytes)} ({percent}%)</p>
                          </div>
                        </td>
                        <td className="text-sm text-secondary">{formatBytes(user.storage_limit_bytes)}</td>
                        <td className="text-sm text-secondary">{user.document_count} arquivos / {user.note_count} notas</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-border-soft bg-bg-surface p-5 shadow-panel">
            <p className="eyebrow">Conta selecionada</p>
            {selectedUser ? (
              <div className="mt-4 space-y-5">
                <div>
                  <h2 className="break-all text-xl font-bold">{selectedUser.email || selectedUser.display_name || selectedUser.uid}</h2>
                  <p className="mt-1 break-all text-xs text-muted">{selectedUser.uid}</p>
                </div>

                <div className="rounded-xl border border-border-soft bg-black/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">Armazenamento</span>
                    <span className="text-sm text-accent-strong">{usagePercent(selectedUser)}%</span>
                  </div>
                  <div className="progress-track bg-black/20">
                    <div className="progress-bar" style={{ width: `${usagePercent(selectedUser)}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-secondary">{formatBytes(selectedUser.storage_used_bytes)} de {formatBytes(selectedUser.storage_limit_bytes)}</p>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                  <Input
                    label="Limite em GB"
                    type="number"
                    min="0"
                    step="0.1"
                    value={limitGb}
                    onChange={(event) => setLimitGb(event.target.value)}
                  />
                  <Button type="button" onClick={() => void handleSaveLimit()} isLoading={savingLimit}>
                    Salvar
                  </Button>
                </div>

                <form onSubmit={handleUpload} className="space-y-4">
                  <label
                    className={`drop-zone min-h-[12rem] ${dragging ? "drop-zone-active" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.zip,application/pdf,application/zip"
                      multiple
                      className="hidden"
                      onChange={(event) => setSelectedFiles(Array.from(event.target.files || []).filter(isAcceptedFile))}
                    />
                    <UploadCloud size={42} className="mb-3 text-accent-strong" />
                    <p className="text-center text-sm font-bold">
                      {selectedFiles.length ? `${selectedFiles.length} arquivo(s) selecionado(s)` : "Arraste PDFs ou ZIPs aqui"}
                    </p>
                    <p className="mt-1 text-center text-xs text-secondary">Os arquivos entram na conta selecionada respeitando a cota.</p>
                  </label>

                  {selectedFiles.length > 0 && (
                    <div className="max-h-36 space-y-2 overflow-y-auto rounded-xl border border-border-soft bg-black/10 p-3">
                      {selectedFiles.map((file) => (
                        <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2 truncate">
                            <Archive size={16} className="shrink-0 text-accent" />
                            <span className="truncate">{file.name}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    className="field min-h-[6rem]"
                    value={uploadComment}
                    onChange={(event) => setUploadComment(event.target.value)}
                    placeholder="Comentário opcional para orientar organização e busca."
                  />

                  {uploading && (
                    <div>
                      <div className="progress-track bg-black/20">
                        <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-secondary">Upload {uploadProgress}%</p>
                    </div>
                  )}

                  <Button type="submit" className="w-full" isLoading={uploading} disabled={selectedFiles.length === 0}>
                    Enviar para esta conta
                  </Button>
                </form>
              </div>
            ) : (
              <p className="mt-4 text-sm text-secondary">Informe a chave admin e carregue os usuários.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-soft bg-bg-surface p-4 shadow-panel">
      <div className="mb-2 flex items-center gap-2 text-accent-strong">{icon}<span className="text-xs font-bold uppercase tracking-[0.08em]">{label}</span></div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function usagePercent(user: AdminUserRecord): number {
  return user.storage_limit_bytes > 0 ? Math.min(100, Math.round((user.storage_used_bytes / user.storage_limit_bytes) * 100)) : 0;
}

function formatGbInput(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, "");
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".zip") || file.type === "application/pdf" || file.type.includes("zip");
}
