import Link from "next/link";
import { FormEvent, ReactNode, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { downloadDocument, SearchResult, searchSemantic } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";
import { HighlightedText } from "../components/ui/HighlightedText";
import { Dialog } from "../components/ui/Dialog";
import { DocumentViewerDialog } from "../components/DocumentViewerDialog";
import { Archive, Download, FileText, NotebookText } from "lucide-react";

export default function SearchPage() {
  const { getCurrentToken } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [viewerResult, setViewerResult] = useState<SearchResult | null>(null);
  const [detailError, setDetailError] = useState("");
  const [downloadingId, setDownloadingId] = useState("");

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setIsBusy(true);
    setError("");
    setDetailError("");
    setSelectedResult(null);
    try {
      const token = await getCurrentToken();
      const searchResults = await searchSemantic(query.trim(), token);
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na busca.");
    } finally {
      setIsBusy(false);
    }
  }

  function handleOpenDetails(result: SearchResult) {
    setDetailError("");
    setSelectedResult(result);
  }

  async function handleDownload(result: SearchResult) {
    if (isNoteResult(result)) return;
    const fallbackName = resolveOriginalName(result) || (isZipResult(result) ? "arquivo.zip" : "documento.pdf");

    setDownloadingId(result.document_id);
    setDetailError("");
    setError("");
    try {
      const token = await getCurrentToken();
      await downloadDocument(result.document_id, token, fallbackName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao baixar o arquivo.";
      setDetailError(message);
      setError(message);
    } finally {
      setDownloadingId("");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Busca</h1>
        <p className="text-slateblue text-sm mt-1.5">Encontre documentos, notas e ZIPs armazenados por nome, pasta, comentário ou conteúdo indexado.</p>
      </header>

      <GlassCard>
        <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
          <Input
            label="Consulta semântica"
            placeholder="Ex.: contrato de suporte, politica de seguranca, termo aditivo 2024"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="px-4"
          />
          <Button type="submit" isLoading={isBusy} className="px-6 min-w-[120px]">
            Pesquisar
          </Button>
        </form>
        <p className="mt-3 text-sm text-slateblue/60">
          Sugestoes: &ldquo;zip financeiro&rdquo;, &ldquo;baixar arquivos do cliente Alfa&rdquo;, &ldquo;clausula de reajuste&rdquo;.
        </p>
      </GlassCard>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">{results.length > 0 ? `Encontrados ${results.length} resultados relevantes` : "Resultados"}</p>
        </div>

        {error && (
          <div className="rounded-lg border border-[rgba(228,149,149,0.3)] bg-[rgba(228,149,149,0.12)] p-3 text-sm font-medium text-white">
            {error}
          </div>
        )}

        {results.length === 0 && !isBusy && !error && !query.trim() && (
          <div className="empty-state">
            <svg className="w-12 h-12 mx-auto mb-3 text-slateblue/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-base font-semibold">Nenhum resultado ainda.</p>
            <p className="max-w-md text-sm text-slateblue/70">Digite uma consulta para localizar trechos relevantes em documentos e notas indexados.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {results.map((res, index) => {
            const resultClassification = resolveClassification(res);
            const resultLabel = resolveDisplayName(res);
            const resultChunk = resolveChunkLabel(res, index);
            const resultFolderPath = resolveFolderPath(res);
            const resultIsNote = isNoteResult(res);
            const resultIsZip = isZipResult(res);

            return (
              <div
                key={`${res.document_id}-${res.chunk_id}-${index}`}
                role="button"
                tabIndex={0}
                className="w-full rounded-[1.25rem] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                onClick={() => handleOpenDetails(res)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleOpenDetails(res);
                  }
                }}
              >
                <GlassCard className="result-card flex h-full flex-col">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="file-folder-icon !h-11 !w-11">
                        <DocumentTypeIcon classification={resultClassification} isNote={resultIsNote} isZip={resultIsZip} />
                      </div>
                      <div className="min-w-0">
                        <StatusChip label={resultLabel} variant="info" />
                        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-slateblue/55">
                          {labelForClassification(resultClassification, resultIsNote)}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-md border border-white/10 bg-[rgba(20,25,33,0.72)] px-2 py-1 text-[0.68rem] font-bold text-slateblue">
                      Score: {((res.score ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>

                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-slateblue/45">
                    {resultIsNote ? "Notas / Base privada" : resultFolderPath ? `Arquivos / ${resultFolderPath}` : "Arquivos / Meu Disco"}
                  </p>

                  <p className="flex-1 text-sm italic leading-relaxed text-ink/80">
                    &ldquo;
                    <HighlightedText
                      text={res.snippet.length > 300 ? `${res.snippet.substring(0, 300)}...` : res.snippet}
                      query={query}
                    />
                    &rdquo;
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/40 pt-3 text-[0.6rem] font-bold uppercase text-slateblue/60">
                    <span>{resultIsNote ? "Nota indexada" : resultIsZip ? "ZIP armazenado" : `Página ${resolvePageLabel(res)}`}</span>
                    <div className="flex items-center gap-2">
                      {!resultIsNote && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[0.65rem] text-slateblue/80 transition-colors hover:border-accent/30 hover:text-white"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDownload(res);
                          }}
                        >
                          <Download size={12} />
                          {resultIsZip ? "Baixar ZIP" : "Baixar"}
                        </button>
                      )}
                      <span>Ref: #{resultChunk}</span>
                    </div>
                  </div>
                </GlassCard>
              </div>
            );
          })}
        </div>
        {results.length === 0 && !isBusy && query.trim() && !error && (
          <div className="rounded-lg border border-white/10 bg-[rgba(20,25,33,0.72)] p-4 text-sm text-slateblue/70">
            Nenhum resultado encontrado para essa consulta. Tente termos mais amplos ou nomes de documentos.
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(selectedResult)}
        title={selectedResult ? resolveDisplayName(selectedResult) : "Detalhes do item"}
        description={selectedResult && isNoteResult(selectedResult)
          ? "Veja os detalhes da nota encontrada e abra o item na aba Notas."
          : selectedResult && isZipResult(selectedResult)
            ? "Veja os detalhes do ZIP encontrado, sua pasta no acervo e baixe o arquivo compactado."
            : "Veja os detalhes do documento encontrado, o caminho em Arquivos e faça o download do PDF."}
        onClose={() => {
          if (downloadingId) return;
          setSelectedResult(null);
          setDetailError("");
        }}
        footer={selectedResult ? (
          <>
            <Link href={buildItemHref(selectedResult)} className="ghost-button">
              {isNoteResult(selectedResult) ? "Abrir em Notas" : "Abrir em Arquivos"}
            </Link>
            <Button variant="ghost" type="button" onClick={() => setSelectedResult(null)} disabled={Boolean(downloadingId)}>
              Fechar
            </Button>
            {!isNoteResult(selectedResult) && (
              <>
                {!isZipResult(selectedResult) && (
                  <Button variant="secondary" type="button" onClick={() => setViewerResult(selectedResult)} disabled={Boolean(downloadingId)}>
                    Visualizar PDF
                  </Button>
                )}
                <Button
                  type="button"
                  isLoading={downloadingId === selectedResult.document_id}
                  onClick={() => void handleDownload(selectedResult)}
                >
                  {isZipResult(selectedResult) ? "Baixar ZIP" : "Baixar PDF"}
                </Button>
              </>
            )}
          </>
        ) : undefined}
      >
        {selectedResult && (
          <div className="space-y-5">
            {detailError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm font-medium text-white">
                {detailError}
              </div>
            )}

            <div className="flex items-start gap-4">
              <div className="file-folder-icon !h-14 !w-14 shrink-0">
                <DocumentTypeIcon
                  classification={resolveClassification(selectedResult)}
                  isNote={isNoteResult(selectedResult)}
                  isZip={isZipResult(selectedResult)}
                />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-tight text-white break-words">
                  {resolveDocumentTitle(selectedResult)}
                </p>
                {!isNoteResult(selectedResult) && (
                  <p className="mt-1 text-sm text-slateblue/75 break-all">
                    {resolveOriginalName(selectedResult)}
                  </p>
                )}
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-slateblue/55">
                  {labelForClassification(resolveClassification(selectedResult), isNoteResult(selectedResult))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailField label="Score">
                {((selectedResult.score ?? 0) * 100).toFixed(1)}%
              </DetailField>
              {isNoteResult(selectedResult) ? (
                <DetailField label="Autor">
                  {readMetadataText(selectedResult.metadata, "author") || "--"}
                </DetailField>
              ) : isZipResult(selectedResult) ? (
                <DetailField label="Tipo">
                  ZIP armazenado
                </DetailField>
              ) : (
                <DetailField label="Página">
                  {resolvePageLabel(selectedResult)}
                </DetailField>
              )}
              <DetailField label="Referência do trecho">
                #{resolveChunkLabel(selectedResult)}
              </DetailField>
              <DetailField label={isNoteResult(selectedResult) ? "Nota ID" : "Documento ID"}>
                <span className="break-all">{selectedResult.document_id}</span>
              </DetailField>
            </div>

            <DetailField label={isNoteResult(selectedResult) ? "Localização" : "Caminho em Arquivos"}>
              <span className="break-all">
                {isNoteResult(selectedResult)
                  ? "Notas / Base privada"
                  : buildAccountFilePath(resolveFolderPath(selectedResult), resolveOriginalName(selectedResult))}
              </span>
            </DetailField>

            {selectedResult.markdown_path && !isNoteResult(selectedResult) && (
              <DetailField label="Caminho do Markdown">
                <span className="break-all">{selectedResult.markdown_path}</span>
              </DetailField>
            )}

            {isZipResult(selectedResult) && readMetadataText(selectedResult.metadata, "user_comment") && (
              <DetailField label="Comentário do upload">
                {readMetadataText(selectedResult.metadata, "user_comment")}
              </DetailField>
            )}

            {isNoteResult(selectedResult) && (
              <DetailField label="Última atualização">
                {readMetadataText(selectedResult.metadata, "updated_at") || "--"}
              </DetailField>
            )}

            <DetailField label="Trecho encontrado">
              <div className="rounded-xl border border-white/10 bg-[rgba(20,25,33,0.72)] p-4 text-sm italic leading-relaxed text-ink/80">
                &ldquo;
                <HighlightedText
                  text={selectedResult.snippet}
                  query={query}
                />
                &rdquo;
              </div>
            </DetailField>
          </div>
        )}
      </Dialog>

      <DocumentViewerDialog
        open={Boolean(viewerResult && !isNoteResult(viewerResult) && !isZipResult(viewerResult))}
        onClose={() => setViewerResult(null)}
        documentId={viewerResult?.document_id}
        title={viewerResult ? resolveDocumentTitle(viewerResult) : "Visualizador"}
        originalName={viewerResult ? resolveOriginalName(viewerResult) : "documento.pdf"}
        page={viewerResult ? resolvePageLabel(viewerResult) : null}
        chunkLabel={viewerResult ? resolveChunkLabel(viewerResult) : null}
        snippet={viewerResult?.snippet}
        folderPath={viewerResult ? resolveFolderPath(viewerResult) : null}
      />
    </div>
  );
}

function isNoteResult(result: SearchResult): boolean {
  return (result.source_kind || readMetadataText(result.metadata, "source_kind")).toLowerCase() === "note";
}

function isZipResult(result: SearchResult): boolean {
  const fileFormat = readMetadataText(result.metadata, "file_format").toLowerCase();
  const originalName = resolveOriginalName(result).toLowerCase();
  return fileFormat === "zip" || originalName.endsWith(".zip");
}

function readMetadataText(metadata: SearchResult["metadata"], key: string): string {
  const value = metadata?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function resolveDisplayName(result: SearchResult): string {
  return result.suggested_name
    || readMetadataText(result.metadata, "suggested_name")
    || readMetadataText(result.metadata, "original_name")
    || "Documento";
}

function resolveDocumentTitle(result: SearchResult): string {
  return readMetadataText(result.metadata, "title") || resolveDisplayName(result);
}

function resolveOriginalName(result: SearchResult): string {
  return readMetadataText(result.metadata, "original_name") || resolveDisplayName(result);
}

function resolveClassification(result: SearchResult): string {
  if (isNoteResult(result)) return "nota";
  return readMetadataText(result.metadata, "document_type")
    || readMetadataText(result.metadata, "classification")
    || result.classification
    || "";
}

function resolvePageLabel(result: SearchResult): string {
  return readMetadataText(result.metadata, "page") || "?";
}

function resolveChunkLabel(result: SearchResult, fallbackIndex?: number): string {
  const metadataChunk = readMetadataText(result.metadata, "chunk_index");
  if (metadataChunk) return metadataChunk;

  const chunkSuffix = result.chunk_id.split(":").pop()?.trim();
  if (chunkSuffix) return chunkSuffix;

  if (typeof fallbackIndex === "number") return String(fallbackIndex);
  return "--";
}

function resolveFolderPath(result: SearchResult): string {
  return readMetadataText(result.metadata, "folder_path");
}

function buildItemHref(result: SearchResult): string {
  if (isNoteResult(result)) {
    const params = new URLSearchParams({ note: result.document_id });
    return `/notes?${params.toString()}`;
  }

  const params = new URLSearchParams();
  const folderPath = resolveFolderPath(result);

  if (folderPath) params.set("path", folderPath);
  if (result.document_id) params.set("document", result.document_id);

  const query = params.toString();
  return query ? `/files?${query}` : "/files";
}

function buildAccountFilePath(folderPath: string, originalName: string): string {
  const cleanFolder = folderPath.trim().replace(/^\/+|\/+$/g, "");
  const cleanName = originalName.trim() || "documento.pdf";
  return cleanFolder ? `Meu Disco / ${cleanFolder} / ${cleanName}` : `Meu Disco / ${cleanName}`;
}

function labelForClassification(classification: string, isNote = false): string {
  if (isNote) return "Nota";
  const value = classification.trim().toLowerCase();
  if (value.includes("arquivo")) return "Arquivo";
  if (value.includes("contrat")) return "Contrato";
  if (value.includes("polit")) return "Politica";
  if (value.includes("manual")) return "Manual";
  if (value.includes("termo")) return "Termo";
  return "Documento";
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">
        {label}
      </p>
      <div className="rounded-xl border border-white/10 bg-[rgba(20,25,33,0.72)] px-3 py-2 text-sm text-white/90">
        {children}
      </div>
    </div>
  );
}

function DocumentTypeIcon({
  classification,
  isNote = false,
  isZip = false,
}: {
  classification: string;
  isNote?: boolean;
  isZip?: boolean;
}) {
  const value = classification.trim().toLowerCase();

  if (isNote) {
    return <NotebookText className="h-5 w-5" />;
  }

  if (isZip) {
    return <Archive className="h-5 w-5" />;
  }

  if (value.includes("contrat")) {
    return <FileText className="h-5 w-5" />;
  }

  if (value.includes("polit")) {
    return <FileText className="h-5 w-5" />;
  }

  if (value.includes("manual")) {
    return <FileText className="h-5 w-5" />;
  }

  return <FileText className="h-5 w-5" />;
}
