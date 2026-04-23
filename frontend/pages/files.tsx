import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createFolder, DocumentRecord, downloadDocument, FolderRecord, listDocuments, listFolders } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";

type FolderNode = {
  path: string;
  name: string;
  parentPath: string | null;
  childPaths: string[];
  files: DocumentRecord[];
};

export default function FilesPage() {
  const { user, authProfile, getCurrentToken } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([""]));
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "size">("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const [docs, availableFolders] = await Promise.all([
        listDocuments(token, 500),
        listFolders(token)
      ]);
      setDocuments(docs);
      setFolders(availableFolders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os arquivos.");
    } finally {
      setLoading(false);
    }
  }, [getCurrentToken]);

  useEffect(() => {
    if (user && authProfile) {
      void loadData();
    }
  }, [user, authProfile, loadData]);

  function selectFolder(path: string) {
    setCurrentPath(path);
    setSelectedDocId(null);
    setExpandedPaths((current) => {
      const next = new Set(current);
      next.add("");
      for (const crumb of buildBreadcrumbs(path)) {
        next.add(crumb.path);
      }
      return next;
    });
  }

  function toggleFolder(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      next.add("");
      return next;
    });
  }

  async function handleDownload(document: DocumentRecord) {
    setDownloadingId(document.document_id);
    setError("");
    try {
      const token = await getCurrentToken();
      await downloadDocument(document.document_id, token, document.original_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao baixar o arquivo.");
    } finally {
      setDownloadingId("");
    }
  }

  async function handleCreateFolder() {
    const cleanFolderName = folderName.trim();
    if (!cleanFolderName) {
      setError("Informe um nome para a nova pasta.");
      return;
    }

    setCreatingFolder(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const createdFolder = await createFolder(cleanFolderName, currentPath, token);
      setFolders((current) => {
        const existing = current.some((folder) => folder.path === createdFolder.path);
        return existing ? current : [...current, createdFolder].sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
      });
      selectFolder(createdFolder.path);
      setFolderName("");
      setIsFolderDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel criar a pasta.");
    } finally {
      setCreatingFolder(false);
    }
  }

  const folderMap = useMemo(() => buildFolderMap(documents, folders), [documents, folders]);
  const currentNode = folderMap.get(currentPath) ?? folderMap.get("")!;
  
  const folderChildren = useMemo(() => {
    return currentNode.childPaths
      .map((path) => folderMap.get(path))
      .filter((folder): folder is FolderNode => Boolean(folder))
      .filter((folder) => folder.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [currentNode, folderMap, query]);

  const visibleFiles = useMemo(() => {
    const filtered = currentNode.files.filter((document) => matchesQuery(document, query));
    return filtered.sort((left, right) => {
      if (sortBy === "name") {
        return left.original_name.localeCompare(right.original_name, "pt-BR");
      }
      if (sortBy === "size") {
        return getDocumentSize(right) - getDocumentSize(left);
      }
      return right.uploaded_at.localeCompare(left.uploaded_at);
    });
  }, [currentNode, query, sortBy]);

  const selectedDoc = useMemo(() => {
    return documents.find(d => d.document_id === selectedDocId) || null;
  }, [documents, selectedDocId]);

  const breadcrumbs = buildBreadcrumbs(currentPath);
  const totalSize = documents.reduce((sum, document) => sum + getDocumentSize(document), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow mb-1.5 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Explorer
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Gerenciador de Arquivos</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slateblue leading-relaxed">
            Navegue pelo repositório privado estruturado pela IA. Visualize metadados, resumos e baixe originais.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Arquivos" value={String(documents.length)} icon={<DocsIcon />} />
          <MetricCard label="Pastas" value={String(Math.max(folderMap.size - 1, 0))} icon={<FolderIcon />} />
          <MetricCard label="Volume" value={formatBytes(totalSize)} icon={<StorageIcon />} />
        </div>
      </header>

      <GlassCard className="!p-4 border-white/60">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                className="!py-2 !px-4 !text-sm"
                isLoading={creatingFolder}
                onClick={() => setIsFolderDialogOpen(true)}
              >
                <FolderAddIcon />
                Nova pasta
              </Button>
              <Link href="/documents" className="primary-button !py-2 !px-4 !text-sm">
                <UploadIcon />
                Upload
              </Link>
            </div>

            <label className="text-xs text-slateblue/60">
              <span className="mb-1 block">Ordenar por</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as "recent" | "name" | "size")}
                className="field !min-h-[2.6rem] !py-2"
              >
                <option value="recent">Mais recentes</option>
                <option value="name">Nome</option>
                <option value="size">Tamanho</option>
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Breadcrumbs
              items={breadcrumbs.map((crumb) => ({ label: crumb.label, value: crumb.path }))}
              currentValue={currentPath}
              onSelect={selectFolder}
            />

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:min-w-[280px]">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="field !rounded-xl !py-3 !pl-10 !text-sm"
                  placeholder="Filtrar por nome, autor, tag ou pasta"
                />
                <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slateblue/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <Button
                variant="secondary"
                className="!py-2 !px-4 !text-sm"
                onClick={() => void loadData()}
                aria-label="Atualizar lista de arquivos"
              >
                <RefreshIcon />
                Atualizar
              </Button>
            </div>
          </div>
        </div>
      </GlassCard>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
             </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-red-800 uppercase tracking-wider">Erro de Operação</p>
            <p className="text-sm font-medium text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Sidebar: Folder Tree */}
        <GlassCard className="!p-0 overflow-hidden flex flex-col h-[65vh] border-white/50">
          <div className="border-b border-white/10 bg-slate-950/30 px-4 py-3">
            <p className="eyebrow flex items-center justify-between">
              Diretório
              <FolderTreeIcon />
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-4 custom-scrollbar">
            <FolderTree
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              nodes={folderMap}
              onSelect={selectFolder}
              onToggle={toggleFolder}
              path=""
            />
          </div>
        </GlassCard>

        {/* Main: Content Grid/Table */}
        <div className="space-y-4 min-w-0">
          <GlassCard className="overflow-hidden !p-0 h-[65vh] flex flex-col border-white/50">
            <div className="border-b border-white/10 bg-slate-950/30 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="eyebrow truncate">Contexto: {currentPath || "Raiz"}</p>
              </div>
              <div className="flex gap-2">
                <StatusChip label={`${folderChildren.length} pastas`} variant="info" />
                <StatusChip label={`${visibleFiles.length} arquivos`} variant="success" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* Subfolders Grid */}
              {folderChildren.length > 0 && (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-b border-white/40 bg-white/10">
                  {folderChildren.map((folder) => (
                    <button
                      key={folder.path}
                      type="button"
                      onClick={() => selectFolder(folder.path)}
                      className="file-folder-card group"
                    >
                      <div className="file-folder-icon group-hover:scale-105 transition-transform shadow-sm">
                        <FolderIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ink group-hover:text-amberline transition-colors">{folder.name}</p>
                        <p className="mt-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-slateblue/40 flex items-center gap-1">
                          <DocsIcon className="w-2.5 h-2.5" />
                          {countNestedFiles(folderMap, folder.path)} itens
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Files Table */}
              <div className="min-w-full">
                <table className="nexus-table !border-0">
                  <thead className="sticky top-0 bg-slate-950/90 backdrop-blur-sm z-10 border-b border-white/10">
                    <tr>
                      <th className="w-12 text-center">Icon</th>
                      <th>Arquivo / Metadados</th>
                      <th className="w-24 text-right">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {loading ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <tr key={`skeleton-${index}`}>
                          <td colSpan={3} className="px-4 py-4">
                            <div className="h-10 animate-pulse rounded-lg bg-slateblue/5" />
                          </td>
                        </tr>
                      ))
                    ) : visibleFiles.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8">
                          <div className="empty-state mx-4 !min-h-[14rem]">
                            <EmptyFolderIcon />
                            <p className="text-base font-semibold">Nenhum arquivo encontrado.</p>
                            <p className="max-w-sm text-sm text-slateblue/70">
                              Tente mudar o filtro, voltar para outra pasta ou enviar novos documentos.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      visibleFiles.map((document) => (
                        <tr 
                          key={document.document_id}
                          onClick={() => setSelectedDocId(document.document_id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedDocId(document.document_id);
                            }
                          }}
                          tabIndex={0}
                          className={`cursor-pointer transition-all ${selectedDocId === document.document_id ? "bg-amberline/5 border-l-2 border-l-amberline shadow-inner" : "hover:bg-white/40"}`}
                        >
                          <td className="text-center">
                            <div className={`mx-auto w-8 h-8 rounded-lg flex items-center justify-center ${selectedDocId === document.document_id ? "bg-amberline/20 text-amber-800" : "bg-slateblue/5 text-slateblue/50"}`}>
                              <PdfIcon />
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-ink">{document.original_name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="max-w-[150px] truncate text-[0.7rem] font-bold text-slateblue/60">{document.suggested_name}</span>
                                <span className="rounded-md border border-white/10 bg-slate-800/80 px-1.5 py-0.5 text-[0.68rem] font-bold text-slateblue/60">{document.classification || "PDF"}</span>
                              </div>
                            </div>
                          </td>
                          <td className="text-right px-4">
                            <p className="text-[0.76rem] font-bold text-slateblue/50">{formatDate(document.uploaded_at)}</p>
                            <p className="mt-1 text-[0.68rem] font-extrabold uppercase text-slateblue/60">{formatBytes(getDocumentSize(document))}</p>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Detail Panel: Document Info */}
        <div className="hidden xl:block">
           <GlassCard className="h-[65vh] flex flex-col p-0 overflow-hidden border-white/50 sticky top-0">
              {selectedDoc ? (
                <>
                  <div className="border-b border-white/60 bg-[rgba(126,178,214,0.1)] px-5 py-4 shrink-0">
                    <p className="eyebrow mb-1">Ficha tecnica</p>
                    <h3 className="text-sm font-bold text-ink line-clamp-2 leading-tight">{selectedDoc.original_name}</h3>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar bg-slate-950/20">
                    <div>
                      <p className="eyebrow !text-[0.6rem] mb-2 opacity-60">Título Identificado</p>
                      <p className="text-xs font-bold text-ink leading-relaxed">{selectedDoc.title || "Sem título detectado"}</p>
                    </div>

                    {selectedDoc.summary && (
                      <div>
                        <p className="eyebrow !text-[0.6rem] mb-2 opacity-60">Resumo Gerencial</p>
                        <div className="p-3 rounded-xl bg-slate-800/70 border border-white/10 text-[0.7rem] text-ink/80 italic leading-relaxed shadow-sm">
                          &quot;{selectedDoc.summary}&quot;
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="eyebrow !text-[0.6rem] mb-1.5 opacity-60">Autor / Origem</p>
                        <p className="text-xs font-bold text-slateblue truncate">{selectedDoc.author || "Nao informado"}</p>
                      </div>
                      <div>
                        <p className="eyebrow !text-[0.6rem] mb-1.5 opacity-60">Ano Base</p>
                        <p className="text-xs font-bold text-slateblue">{selectedDoc.year || "--"}</p>
                      </div>
                    </div>

                    {selectedDoc.tags && selectedDoc.tags.length > 0 && (
                      <div>
                        <p className="eyebrow !text-[0.6rem] mb-2 opacity-60">Segmentação & Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedDoc.tags.map((tag, i) => (
                            <span key={i} className="text-[0.6rem] px-2 py-0.5 rounded-full bg-slateblue/10 border border-slateblue/20 text-slateblue font-bold hover:bg-slateblue/20 transition-colors">#{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedDoc.technologies && selectedDoc.technologies.length > 0 && (
                      <div>
                        <p className="eyebrow !text-[0.6rem] mb-2 opacity-60">Tópicos Relacionados</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedDoc.technologies.map((tech, i) => (
                            <span key={i} className="text-[0.6rem] px-2 py-0.5 rounded-md bg-ink/5 border border-ink/10 text-ink/60 font-semibold">{tech}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-slate-950/40 border-t border-white/10 shrink-0">
                    <Button 
                      className="w-full !rounded-xl !py-3 flex items-center justify-center gap-2"
                      isLoading={downloadingId === selectedDoc.document_id}
                      onClick={() => handleDownload(selectedDoc)}
                    >
                      <DownloadIcon />
                      Baixar PDF Original
                    </Button>
                    <p className="mt-2 text-center text-[0.62rem] font-bold uppercase tracking-[0.08em] text-slateblue/40">Download protegido</p>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-60">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slateblue/10">
                    <InfoIcon className="w-8 h-8 text-slateblue" />
                  </div>
                  <p className="text-sm font-bold text-slateblue">Selecione um arquivo para ver detalhes, resumo e metadados.</p>
                </div>
              )}
           </GlassCard>
        </div>
      </div>

      <Dialog
        open={isFolderDialogOpen}
        title="Criar nova pasta"
        description="Organize documentos em um diretório lógico sem sair do fluxo principal."
        onClose={() => {
          if (creatingFolder) return;
          setIsFolderDialogOpen(false);
          setFolderName("");
        }}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setIsFolderDialogOpen(false)} disabled={creatingFolder}>
              Cancelar
            </Button>
            <Button type="button" isLoading={creatingFolder} onClick={() => void handleCreateFolder()}>
              Criar pasta
            </Button>
          </>
        }
      >
        <Input
          label="Nome da pasta"
          placeholder="Ex.: contratos, politicas, fiscal/2026"
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          autoFocus
        />
      </Dialog>
    </div>
  );
}

function buildFolderMap(documents: DocumentRecord[], storedFolders: FolderRecord[]): Map<string, FolderNode> {
  const folders = new Map<string, FolderNode>();

  function ensureFolder(path: string): FolderNode {
    const existing = folders.get(path);
    if (existing) return existing;

    const parts = path.split("/").filter(Boolean);
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : parts.length === 1 ? "" : null;
    const node: FolderNode = {
      path,
      name: parts[parts.length - 1] || "Minha unidade",
      parentPath,
      childPaths: [],
      files: []
    };
    folders.set(path, node);

    if (parentPath !== null) {
      const parent = ensureFolder(parentPath);
      if (!parent.childPaths.includes(path)) {
        parent.childPaths.push(path);
      }
    }

    return node;
  }

  ensureFolder("");

  for (const folder of storedFolders) {
    const parts = folder.path.split("/").filter(Boolean);
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      ensureFolder(currentPath);
    }
  }

  for (const document of documents) {
    const parts = document.folder_path.split("/").filter(Boolean);
    let currentPath = "";
    if (parts.length === 0) {
      ensureFolder("").files.push(document);
      continue;
    }
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      ensureFolder(currentPath);
    }
    ensureFolder(currentPath).files.push(document);
  }

  return folders;
}

function countNestedFiles(folderMap: Map<string, FolderNode>, path: string): number {
  const folder = folderMap.get(path);
  if (!folder) return 0;
  let total = folder.files.length;
  for (const childPath of folder.childPaths) {
    total += countNestedFiles(folderMap, childPath);
  }
  return total;
}

function buildBreadcrumbs(path: string): Array<{ path: string; label: string }> {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join("/")
  }));
}

function matchesQuery(document: DocumentRecord, query: string): boolean {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  const haystack = [
    document.original_name,
    document.suggested_name,
    document.title,
    document.classification,
    document.folder_path,
    document.summary,
    document.project,
    document.author,
    document.tags.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(cleanQuery);
}

function getDocumentSize(document: DocumentRecord): number {
  if (typeof document.size_bytes === "number" && Number.isFinite(document.size_bytes)) {
    return document.size_bytes;
  }
  return Math.max(document.chunks_indexed * 1800, 48_000);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function FolderTree({
  currentPath,
  expandedPaths,
  nodes,
  onSelect,
  onToggle,
  path
}: {
  currentPath: string;
  expandedPaths: Set<string>;
  nodes: Map<string, FolderNode>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  path: string;
}) {
  const node = nodes.get(path);
  if (!node) return null;

  const children = node.childPaths
    .map((childPath) => nodes.get(childPath))
    .filter((folder): folder is FolderNode => Boolean(folder))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const isExpanded = expandedPaths.has(path);
  const hasChildren = children.length > 0;
  const nestedCount = countNestedFiles(nodes, path);

  return (
    <div className={path ? "ml-3 border-l border-white/45 pl-3" : ""}>
      <div className={`folder-tree-item ${currentPath === path ? "folder-tree-item-active" : ""}`}>
        <button
          type="button"
          onClick={() => hasChildren && onToggle(path)}
          className={`folder-toggle ${isExpanded ? "folder-toggle-open" : ""}`}
          aria-label={isExpanded ? "Recolher pasta" : "Expandir pasta"}
          disabled={!hasChildren}
        >
          {hasChildren ? <ChevronIcon /> : <span className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(path)}
          className="folder-tree-label"
        >
          <FolderIcon />
          <span className="truncate">{path ? node.name : "Unidade"}</span>
          <span className="folder-tree-count">{nestedCount}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="mt-1 space-y-1">
          {children.map((child) => (
            <FolderTree
              key={child.path}
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              nodes={nodes}
              onSelect={onSelect}
              onToggle={onToggle}
              path={child.path}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric-card !p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800/70 shadow-inner flex items-center justify-center text-slateblue/60 shrink-0">
         {icon}
      </div>
      <div className="min-w-0">
        <p className="eyebrow !text-[0.55rem] mb-0.5 opacity-60">{label}</p>
        <p className="font-mono text-lg font-bold text-ink leading-none">{value}</p>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function FolderTreeIcon() {
  return (
    <svg className="h-3.5 w-3.5 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 3v5h5M8 14h8M8 18h5" />
    </svg>
  );
}

function DocsIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 10h16M4 14h16" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function FolderAddIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v12m6-6H6M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 4v9m0 0l-3-3m3 3l3-3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function EmptyFolderIcon() {
  return (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 11v4m-2-2h4" />
    </svg>
  );
}
