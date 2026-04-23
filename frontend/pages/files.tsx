import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, downloadDocument, listDocuments } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";

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
  const [currentPath, setCurrentPath] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([""]));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState("");

  useEffect(() => {
    if (user && authProfile) {
      void (async () => {
        setLoading(true);
        setError("");
        try {
          const token = await getCurrentToken();
          const docs = await listDocuments(token, 500);
          setDocuments(docs);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Falha ao carregar os arquivos.");
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [user, authProfile, getCurrentToken]);

  function selectFolder(path: string) {
    setCurrentPath(path);
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

  async function refreshDocuments() {
    setLoading(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const docs = await listDocuments(token, 500);
      setDocuments(docs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os arquivos.");
    } finally {
      setLoading(false);
    }
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

  const folderMap = buildFolderMap(documents);
  const currentNode = folderMap.get(currentPath) ?? folderMap.get("")!;
  const folderChildren = currentNode.childPaths
    .map((path) => folderMap.get(path))
    .filter((folder): folder is FolderNode => Boolean(folder))
    .filter((folder) => folder.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const visibleFiles = currentNode.files
    .filter((document) => matchesQuery(document, query))
    .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at));
  const breadcrumbs = buildBreadcrumbs(currentPath);
  const totalSize = documents.reduce((sum, document) => sum + getDocumentSize(document), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow mb-1.5">Explorer</p>
          <h1 className="text-2xl font-bold tracking-tight">Gerenciador de Arquivos</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-slateblue">
            Navegue pelas pastas do seu acervo privado, visualize os arquivos organizados pela IA e faça download do PDF original.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <MetricCard label="Arquivos" value={String(documents.length)} help="PDFs no seu espaço" />
          <MetricCard label="Pastas" value={String(Math.max(folderMap.size - 1, 0))} help="Estrutura de pastas" />
          <MetricCard label="Volume" value={formatBytes(totalSize)} help="Total do acervo" />
        </div>
      </header>

      <GlassCard className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slateblue">
            <button
              type="button"
              onClick={() => selectFolder("")}
              className={`rounded-full px-2.5 py-1 transition-colors ${currentPath === "" ? "bg-ink text-white" : "bg-white/70 hover:bg-white"}`}
            >
              Minha unidade
            </button>
            {breadcrumbs.map((crumb) => (
              <div key={crumb.path} className="flex items-center gap-2">
                <span className="text-slateblue/35">/</span>
                <button
                  type="button"
                  onClick={() => selectFolder(crumb.path)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${crumb.path === currentPath ? "bg-ink text-white" : "bg-white/70 hover:bg-white"}`}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field min-w-[240px] !rounded-full !py-2.5"
              placeholder="Filtrar arquivos..."
            />
            <Button variant="secondary" onClick={() => void refreshDocuments()}>
              Atualizar
            </Button>
          </div>
        </div>
      </GlassCard>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-b border-white/50 px-4 py-3">
            <p className="eyebrow">Pastas</p>
            <p className="mt-1.5 text-xs text-slateblue">Estrutura privada do usuário.</p>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-2 py-3">
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

        <div className="space-y-4">
          <GlassCard className="overflow-hidden !p-0">
            <div className="border-b border-white/50 px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="eyebrow">Conteúdo Atual</p>
                  <h2 className="mt-1 text-lg font-bold">
                    {currentPath ? currentNode.name : "Minha unidade"}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusChip label={`${folderChildren.length} Pastas`} variant="info" />
                  <StatusChip label={`${visibleFiles.length} Arquivos`} variant="success" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 border-b border-white/50 p-4 md:grid-cols-2 xl:grid-cols-3">
              {folderChildren.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slateblue/20 bg-white/40 p-4 text-xs text-slateblue/60">
                  Nenhuma subpasta nessa seleção.
                </div>
              ) : (
                folderChildren.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => selectFolder(folder.path)}
                    className="file-folder-card text-left"
                  >
                    <div className="file-folder-icon">
                      <FolderIcon />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-ink">{folder.name}</p>
                      <p className="mt-1 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-slateblue/55">
                        {countNestedFiles(folderMap, folder.path)} arquivos
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="nexus-table">
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Título</th>
                    <th>Classificação</th>
                    <th>Data</th>
                    <th>Tamanho</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={`skeleton-${index}`}>
                        <td colSpan={6}>
                          <div className="h-8 animate-pulse rounded-lg bg-slateblue/5" />
                        </td>
                      </tr>
                    ))
                  ) : visibleFiles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm text-slateblue/50">
                        Nenhum arquivo encontrado nesta pasta.
                      </td>
                    </tr>
                  ) : (
                    visibleFiles.map((document) => (
                      <tr key={document.document_id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="file-row-icon">
                              <PdfIcon />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold">{document.original_name}</p>
                              <p className="truncate text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-slateblue/55">
                                {document.suggested_name}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[200px]">
                          <p className="truncate text-xs font-semibold text-ink/80">{document.title}</p>
                          <p className="mt-1 truncate text-[0.65rem] text-slateblue/60">{document.summary || "Sem resumo disponível."}</p>
                        </td>
                        <td>
                          <StatusChip label={document.classification || "arquivo"} variant="info" />
                        </td>
                        <td className="text-[0.65rem]">{formatDate(document.uploaded_at)}</td>
                        <td className="text-[0.65rem] font-semibold text-slateblue">{formatBytes(getDocumentSize(document))}</td>
                        <td>
                          <Button
                            type="button"
                            variant="secondary"
                            className="!px-3 !py-1.5 text-[0.65rem]"
                            isLoading={downloadingId === document.document_id}
                            onClick={() => void handleDownload(document)}
                          >
                            Baixar
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function buildFolderMap(documents: DocumentRecord[]): Map<string, FolderNode> {
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
          <span className="truncate">{path ? node.name : "Minha unidade"}</span>
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

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="metric-card min-w-[180px]">
      <p className="eyebrow mb-2">{label}</p>
      <p className="font-mono text-3xl font-bold text-ink">{value}</p>
      <p className="mt-3 text-xs font-medium text-slateblue/70">{help}</p>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
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
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 3v5h5M8 14h8M8 18h5" />
    </svg>
  );
}
