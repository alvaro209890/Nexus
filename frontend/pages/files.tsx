import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { createFolder, deleteDocument, DocumentRecord, downloadDocument, FolderRecord, listDocuments, listFolders } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { Breadcrumbs } from "../components/ui/Breadcrumbs";
import { 
  Folder, 
  FolderTree as FolderTreeIconLucide, 
  ChevronRight, 
  FileText, 
  RefreshCw, 
  FolderPlus, 
  Upload, 
  Download, 
  Info, 
  FolderX,
  X,
  MoreVertical,
  Search,
  File,
  Trash2
} from "lucide-react";

type FolderNode = {
  path: string;
  name: string;
  parentPath: string | null;
  childPaths: string[];
  files: DocumentRecord[];
};

export default function FilesPage() {
  const router = useRouter();
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
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState("");
  const appliedRouteSelectionRef = useRef(false);

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

  const selectFolder = useCallback((path: string) => {
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
  }, []);

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

  async function handleDeleteDocument(document: DocumentRecord) {
    setDeletingDocId(document.document_id);
    setError("");
    try {
      const token = await getCurrentToken();
      await deleteDocument(document.document_id, token);
      setDocuments((current) => current.filter((item) => item.document_id !== document.document_id));
      if (selectedDocId === document.document_id) {
        setSelectedDocId(null);
        setShowDetails(false);
      }
      setIsDeleteDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel excluir o arquivo.");
    } finally {
      setDeletingDocId("");
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

  useEffect(() => {
    if (!router.isReady || loading || appliedRouteSelectionRef.current) {
      return;
    }

    const requestedPath = typeof router.query.path === "string" ? router.query.path : "";
    const requestedDocumentId = typeof router.query.document === "string" ? router.query.document : "";

    if (!requestedPath && !requestedDocumentId) {
      appliedRouteSelectionRef.current = true;
      return;
    }

    const requestedDocument = requestedDocumentId
      ? documents.find((document) => document.document_id === requestedDocumentId) || null
      : null;
    const nextPath = requestedPath || requestedDocument?.folder_path || "";

    if (!nextPath || folderMap.has(nextPath)) {
      selectFolder(nextPath);
    }

    if (requestedDocument) {
      setSelectedDocId(requestedDocument.document_id);
      setShowDetails(true);
    }

    appliedRouteSelectionRef.current = true;
  }, [documents, folderMap, loading, router.isReady, router.query.document, router.query.path, selectFolder]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in -mx-4 -mt-4 px-4 pt-4 pb-4">
      
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 mb-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-danger/20 flex items-center justify-center text-danger shrink-0">
             <Info size={16} />
          </div>
          <div>
            <p className="text-sm font-bold text-danger leading-tight">{error}</p>
          </div>
        </div>
      )}

      <div className="flex gap-6 h-full min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className="w-64 flex flex-col gap-6 shrink-0 h-full overflow-hidden">
          {/* Main Actions */}
          <div className="flex flex-col gap-3">
             <Button
                variant="primary"
                className="w-full justify-start !py-3 shadow-md"
                onClick={() => setIsFolderDialogOpen(true)}
              >
                <FolderPlus size={18} className="mr-2" />
                Nova Pasta
              </Button>
              <Link href="/documents" className="w-full">
                <Button variant="secondary" className="w-full justify-start !py-3">
                  <Upload size={18} className="mr-2" />
                  Upload de Arquivo
                </Button>
              </Link>
          </div>

          {/* Tree Navigation */}
          <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
               <FolderTreeIconLucide size={14} />
               Diretórios
            </p>
            <FolderTree
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              nodes={folderMap}
              onSelect={selectFolder}
              onToggle={toggleFolder}
              path=""
            />
          </div>
        </div>

        {/* MAIN CONTENT */}
        <GlassCard className="flex-1 flex flex-col h-full !p-0 overflow-hidden border-border-strong shadow-panel relative">
          
          {/* Header */}
          <div className="border-b border-border-soft bg-bg-surface-strong/80 backdrop-blur-md px-6 py-4 shrink-0 flex flex-col gap-4 z-10">
            <div className="flex items-center justify-between">
              <Breadcrumbs
                items={breadcrumbs.map((crumb) => ({ label: crumb.label, value: crumb.path }))}
                currentValue={currentPath}
                onSelect={selectFolder}
                className="text-2xl font-bold"
              />

              <div className="flex items-center gap-3">
                 <Button
                    variant="ghost"
                    className="!py-2 !px-3"
                    onClick={() => void loadData()}
                    title="Atualizar"
                  >
                    <RefreshCw size={16} />
                  </Button>
                  <Button
                    variant={showDetails ? "secondary" : "ghost"}
                    className="!py-2 !px-3"
                    onClick={() => setShowDetails(!showDetails)}
                    title="Ver detalhes"
                  >
                    <Info size={16} />
                  </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full bg-bg-surface border border-border-strong rounded-full py-2 pl-10 pr-4 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                  placeholder="Pesquisar nesta pasta..."
                />
              </div>

              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as "recent" | "name" | "size")}
                className="bg-transparent text-sm text-secondary font-medium outline-none cursor-pointer hover:text-primary transition-colors border-none"
              >
                <option value="recent">Mais recentes</option>
                <option value="name">Nome</option>
                <option value="size">Tamanho</option>
              </select>
            </div>
          </div>

          {/* Files and Folders View */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-8 bg-gradient-to-b from-bg-surface/30 to-bg-surface-strong/30">
            
            {/* Folders Section */}
            {folderChildren.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-secondary mb-3">Pastas</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {folderChildren.map((folder) => (
                    <button
                      key={folder.path}
                      onClick={() => selectFolder(folder.path)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border-soft bg-bg-surface-strong hover:bg-white/5 hover:border-accent/40 transition-all text-left group"
                    >
                      <Folder size={24} className="text-muted group-hover:text-accent transition-colors" />
                      <span className="truncate text-sm font-medium text-primary flex-1">{folder.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Files Section */}
            <section>
               <h3 className="text-sm font-bold text-secondary mb-3">Arquivos</h3>
               {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div key={`skeleton-${index}`} className="h-14 animate-pulse rounded-xl bg-white/5" />
                    ))}
                  </div>
                ) : visibleFiles.length === 0 ? (
                  <div className="empty-state border border-dashed border-border-soft rounded-2xl h-48 bg-bg-surface-strong/50">
                    <FolderX size={40} className="text-muted mb-3" />
                    <p className="text-base font-semibold">Nenhum arquivo encontrado.</p>
                    <p className="text-sm text-secondary mt-1">Navegue para outra pasta ou faça um upload.</p>
                  </div>
                ) : (
                  <div className="border border-border-soft rounded-xl overflow-hidden bg-bg-surface-strong">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-bg-surface/50 border-b border-border-soft text-xs text-muted font-bold tracking-wider uppercase">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Nome</th>
                          <th className="px-4 py-3 font-semibold">Data</th>
                          <th className="px-4 py-3 font-semibold text-right">Tamanho</th>
                          <th className="px-4 py-3 w-24"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-soft">
                        {visibleFiles.map((document) => (
                          <tr 
                            key={document.document_id}
                            onClick={() => {
                               setSelectedDocId(document.document_id);
                               setShowDetails(true);
                            }}
                            className={`group cursor-pointer transition-colors ${selectedDocId === document.document_id ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-white/5"}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <FileText size={20} className={selectedDocId === document.document_id ? "text-accent" : "text-muted group-hover:text-primary"} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-primary group-hover:text-accent-strong transition-colors" title={document.original_name}>
                                    {formatDisplayFilename(document)}
                                  </p>
                                  {document.classification && (
                                    <p className="text-[0.65rem] text-secondary mt-0.5 inline-block border border-border-soft rounded-md px-1.5 py-0.5 bg-bg-surface">
                                      {document.classification}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-secondary">{formatDate(document.uploaded_at)}</td>
                            <td className="px-4 py-3 text-secondary text-right font-mono text-xs">{formatBytes(getDocumentSize(document))}</td>
                            <td className="px-4 py-3 text-right">
                               <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                     className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                                     onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(document);
                                     }}
                                     title="Baixar Arquivo"
                                  >
                                     {downloadingId === document.document_id ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                                  </button>
                                  <button
                                     className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                                     onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedDocId(document.document_id);
                                        setIsDeleteDialogOpen(true);
                                     }}
                                     title="Excluir Arquivo"
                                  >
                                     {deletingDocId === document.document_id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                  </button>
                                  <button 
                                     className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-white/10 transition-colors"
                                     onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedDocId(document.document_id);
                                        setShowDetails(true);
                                     }}
                                     title="Ver Detalhes"
                                  >
                                     <MoreVertical size={16} />
                                  </button>
                               </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </section>

          </div>
        </GlassCard>

        {/* RIGHT SIDEBAR (DETAILS) */}
        {showDetails && (
          <GlassCard className="w-80 shrink-0 flex flex-col !p-0 overflow-hidden border-border-strong animate-fade-in relative z-20 shadow-xl">
             <div className="border-b border-border-soft bg-bg-surface-strong/80 px-4 py-4 shrink-0 flex items-center justify-between">
                <p className="font-bold text-primary flex items-center gap-2">
                   <Info size={16} className="text-accent" />
                   Ficha Técnica
                </p>
                <button onClick={() => setShowDetails(false)} className="text-muted hover:text-primary p-1 rounded-md hover:bg-white/5 transition-colors">
                   <X size={16} />
                </button>
             </div>

             <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-bg-surface-strong/30">
               {selectedDoc ? (
                 <>
                   <div>
                      <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4 mx-auto text-accent">
                         <File size={32} />
                      </div>
                      <h3 className="text-center font-bold text-primary mb-1 break-words">{formatDisplayFilename(selectedDoc)}</h3>
                      <p className="text-center text-xs text-secondary break-words">{selectedDoc.original_name}</p>
                   </div>

                   <hr className="border-border-soft" />

                   <div>
                     <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1">Título Detectado</p>
                     <p className="text-sm font-medium text-primary leading-relaxed">{selectedDoc.title || "--"}</p>
                   </div>

                   {selectedDoc.summary && (
                     <div>
                       <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1">Resumo Executivo</p>
                       <div className="p-3 rounded-xl bg-bg-surface border border-border-soft text-xs text-secondary italic leading-relaxed">
                         &quot;{selectedDoc.summary}&quot;
                       </div>
                     </div>
                   )}

                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1">Autor</p>
                       <p className="text-xs font-medium text-primary truncate">{selectedDoc.author || "--"}</p>
                     </div>
                     <div>
                       <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1">Ano Ref.</p>
                       <p className="text-xs font-medium text-primary">{selectedDoc.year || "--"}</p>
                     </div>
                   </div>

                   {selectedDoc.tags && selectedDoc.tags.length > 0 && (
                     <div>
                       <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-2">Tags Inteligentes</p>
                       <div className="flex flex-wrap gap-1.5">
                         {selectedDoc.tags.map((tag, i) => (
                           <span key={i} className="text-[0.65rem] px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent font-medium">#{tag}</span>
                         ))}
                       </div>
                     </div>
                   )}

                   <div className="pt-4 mt-auto space-y-3">
                     <Button 
                       className="w-full !rounded-xl"
                       isLoading={downloadingId === selectedDoc.document_id}
                       onClick={() => handleDownload(selectedDoc)}
                     >
                       <Download size={16} className="mr-2" />
                       Fazer Download
                     </Button>
                     <Button
                       variant="ghost"
                       className="w-full !rounded-xl !text-danger hover:!bg-danger/10"
                       isLoading={deletingDocId === selectedDoc.document_id}
                       onClick={() => setIsDeleteDialogOpen(true)}
                     >
                       <Trash2 size={16} className="mr-2" />
                       Excluir Arquivo
                     </Button>
                   </div>
                 </>
               ) : (
                 <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
                   <Info size={32} className="mb-3 text-muted" />
                   <p className="text-sm font-bold text-primary">Nenhum arquivo selecionado</p>
                   <p className="text-xs text-secondary mt-1 max-w-[200px]">Clique em um arquivo na lista para ver seus detalhes e resumo estruturado.</p>
                 </div>
               )}
             </div>
          </GlassCard>
        )}
      </div>

      <Dialog
        open={isFolderDialogOpen}
        title="Criar nova pasta"
        description="Organize documentos no diretório atual."
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
          placeholder="Ex.: Projetos 2026, Contratos..."
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          autoFocus
        />
      </Dialog>

      <Dialog
        open={isDeleteDialogOpen}
        title="Excluir arquivo"
        description="Essa ação remove o PDF, o texto indexado, os vetores do banco e as anotações associadas ao arquivo."
        onClose={() => {
          if (deletingDocId) return;
          setIsDeleteDialogOpen(false);
        }}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setIsDeleteDialogOpen(false)} disabled={Boolean(deletingDocId)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              isLoading={Boolean(selectedDoc && deletingDocId === selectedDoc.document_id)}
              onClick={() => selectedDoc && void handleDeleteDocument(selectedDoc)}
              disabled={!selectedDoc}
            >
              Excluir definitivamente
            </Button>
          </>
        }
      >
        {selectedDoc ? (
          <div className="space-y-3 text-sm text-secondary">
            <p>
              Arquivo selecionado: <span className="font-semibold text-primary">{formatDisplayFilename(selectedDoc)}</span>
            </p>
            <p>Depois da exclusão, o documento deixa de aparecer na busca, no chat e no gerenciador de arquivos.</p>
          </div>
        ) : (
          <p className="text-sm text-secondary">Selecione um arquivo antes de excluir.</p>
        )}
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
      name: parts[parts.length - 1] || "Meu Disco",
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

function formatDisplayFilename(document: DocumentRecord): string {
  const originalName = document.original_name || "documento.pdf";
  const extensionMatch = originalName.match(/(\.[A-Za-z0-9]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "";
  const stem = extension ? originalName.slice(0, -extension.length) : originalName;
  const normalizedStem = stem
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${normalizedStem}${extension}`;
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

  return (
    <div className={path ? "ml-3 border-l border-border-soft pl-2" : ""}>
      <div className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg transition-colors group ${currentPath === path ? "bg-accent/10 text-accent-strong" : "hover:bg-white/5 text-primary"}`}>
        <button
          type="button"
          onClick={() => hasChildren && onToggle(path)}
          className={`p-0.5 rounded-md text-muted hover:text-primary transition-transform ${isExpanded ? "rotate-90" : ""}`}
          aria-label={isExpanded ? "Recolher pasta" : "Expandir pasta"}
          disabled={!hasChildren}
        >
          {hasChildren ? <ChevronRight size={14} /> : <span className="w-[14px] h-[14px] block" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(path)}
          className="flex flex-1 items-center gap-2 overflow-hidden text-sm"
        >
          <Folder size={16} className={currentPath === path ? "text-accent" : "text-muted group-hover:text-secondary"} />
          <span className="truncate font-medium">{path ? node.name : "Meu Disco"}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="mt-1 space-y-0.5">
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
