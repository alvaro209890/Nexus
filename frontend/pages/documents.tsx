import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  DocumentProcessingDetail,
  DocumentProcessingEvent,
  DocumentRecord,
  downloadDocument,
  getDocumentProcessingDetail,
  listDocuments,
  retryDocumentProcessing,
  uploadDocuments
} from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";
import { Dialog } from "../components/ui/Dialog";
import { DocumentViewerDialog } from "../components/DocumentViewerDialog";
import { Archive, Download, FileText, UploadCloud, AlertCircle, FileCheck2, Loader2, Info, CheckCircle2, RefreshCw, Eye } from "lucide-react";
import { motion, Variants } from "framer-motion";

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const fadeUpRow: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

const ACTIVE_PROCESSING_STATUSES = new Set(["queued", "extracting", "classifying", "indexing"]);

export default function DocumentsPage() {
  const { user, getCurrentToken, authProfile } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadComment, setUploadComment] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [processingDetail, setProcessingDetail] = useState<DocumentProcessingDetail | null>(null);
  const [loadingProcessingDetail, setLoadingProcessingDetail] = useState(false);
  const [retryingId, setRetryingId] = useState("");
  const [viewerDocument, setViewerDocument] = useState<DocumentRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshDocuments = useCallback(async () => {
    try {
      const token = await getCurrentToken();
      const docs = await listDocuments(token);
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  }, [getCurrentToken]);

  const loadProcessingDetail = useCallback(async (documentId: string) => {
    if (!documentId) return;
    setLoadingProcessingDetail(true);
    try {
      const token = await getCurrentToken();
      const detail = await getDocumentProcessingDetail(documentId, token);
      setProcessingDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os detalhes do processamento.");
    } finally {
      setLoadingProcessingDetail(false);
    }
  }, [getCurrentToken]);

  useEffect(() => {
    if (user && authProfile) {
      void refreshDocuments();
    }
  }, [user, authProfile, refreshDocuments]);

  useEffect(() => {
    if (!user || !authProfile) return;
    if (!documents.some((document) => isDocumentProcessing(document))) return;

    const intervalId = window.setInterval(() => {
      void refreshDocuments();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [documents, user, authProfile, refreshDocuments]);

  useEffect(() => {
    if (!selectedDocumentId || !processingDetail?.is_processing) return;

    const intervalId = window.setInterval(() => {
      void loadProcessingDetail(selectedDocumentId);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadProcessingDetail, processingDetail?.is_processing, selectedDocumentId]);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (selectedFiles.length === 0) return;

    const firstValidationError = selectedFiles
      .map((file) => validateFile(file))
      .find((value): value is string => Boolean(value));

    if (firstValidationError) {
      setError(firstValidationError);
      return;
    }

    setIsBusy(true);
    setError("");
    setUploadProgress(0);
    setUploadStatus(
      selectedFiles.length === 1
        ? "Enviando documento. Arquivos maiores podem levar mais tempo."
        : `Enviando ${selectedFiles.length} documentos. O processamento pode levar alguns minutos.`
    );
    try {
      const token = await getCurrentToken();
      const result = await uploadDocuments(selectedFiles, token, uploadComment, setUploadProgress);

      if (result.failed_count > 0) {
        setError(result.errors[0]?.detail || "Falha parcial no envio dos documentos.");
      }

      if (result.uploaded_count > 0) {
        const duplicates = result.results.filter((item) => item.duplicate).length;
        const storedArchives = result.results.filter((item) => item.file_format === "zip" && !item.duplicate).length;
        const queued = result.uploaded_count - duplicates - storedArchives;
        const messages = [];
        if (queued > 0) {
          messages.push(queued === 1 ? "1 documento entrou na fila de processamento." : `${queued} documentos entraram na fila de processamento.`);
        }
        if (storedArchives > 0) {
          messages.push(storedArchives === 1 ? "1 ZIP armazenado no acervo." : `${storedArchives} ZIPs armazenados no acervo.`);
        }
        if (duplicates > 0) {
          messages.push(duplicates === 1 ? "1 duplicado reaproveitado." : `${duplicates} duplicados reaproveitados.`);
        }
        if (result.failed_count > 0) {
          messages.push(result.failed_count === 1 ? "1 arquivo falhou." : `${result.failed_count} arquivos falharam.`);
        }
        setUploadStatus(messages.join(" "));
      } else {
        setUploadStatus("");
      }

      setSelectedFiles([]);
      setUploadComment("");
      setUploadProgress(100);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refreshDocuments();
    } catch (err) {
      setError(mapUploadError(err));
      setUploadStatus("");
      setUploadProgress(0);
    } finally {
      setIsBusy(false);
    }
  }

  function handleFileSelection(files: File[]) {
    setError("");
    setUploadStatus("");
    setUploadProgress(0);
    setSelectedFiles(files);

    if (files.length === 0) return;

    const validationError = files
      .map((file) => validateFile(file))
      .find((value): value is string => Boolean(value));

    if (validationError) {
      setError(validationError);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    handleFileSelection(Array.from(event.dataTransfer.files || []));
  }

  async function openProcessingDetail(document: DocumentRecord) {
    setSelectedDocumentId(document.document_id);
    setProcessingDetail({
      document,
      events: [],
      can_retry: String(document.processing_status || "").toLowerCase() === "failed",
      is_processing: isDocumentProcessing(document),
    });
    await loadProcessingDetail(document.document_id);
  }

  async function handleRetry(document: DocumentRecord) {
    setRetryingId(document.document_id);
    setError("");
    try {
      const token = await getCurrentToken();
      const updated = await retryDocumentProcessing(document.document_id, token);
      setDocuments((current) =>
        current.map((item) => item.document_id === updated.document_id ? updated : item)
      );
      setSelectedDocumentId(updated.document_id);
      await loadProcessingDetail(updated.document_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reenfileirar o documento.");
    } finally {
      setRetryingId("");
    }
  }

  async function handleDownloadStoredFile(document: DocumentRecord) {
    setError("");
    try {
      const token = await getCurrentToken();
      await downloadDocument(document.document_id, token, document.original_name || document.suggested_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar o arquivo.");
    }
  }

  const formatDocName = (name: string) => {
    let clean = name.replace(/_/g, ' ').replace(/\.pdf$/i, '');
    clean = clean.replace(/\b\w/g, l => l.toUpperCase());
    return clean;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Documentos</h1>
        <p className="text-secondary mt-2">Envie PDFs para indexação ou ZIPs para armazenamento no acervo.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassCard className="lg:col-span-1 h-fit">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <p className="eyebrow mb-1 text-accent-strong">Novo documento</p>
              <h2 className="text-xl font-bold">Enviar documentos</h2>
            </div>
            <StatusChip label="PDF 100 MB / ZIP 2 GB" variant="info" />
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            <label
              className={`drop-zone relative overflow-hidden transition-all ${isDragging ? "drop-zone-active border-accent" : "border-border-soft hover:border-accent-strong"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                className="hidden" 
                accept=".pdf,.zip,application/pdf,application/zip"
                multiple
                disabled={isBusy}
                onChange={(event) => {
                  handleFileSelection(Array.from(event.target.files || []));
                }}
              />
              <div className="text-center z-10 flex flex-col items-center">
                {selectedFiles.length > 0 ? (
                  <FileCheck2 className="w-12 h-12 text-success mb-3" />
                ) : (
                  <UploadCloud className="w-12 h-12 text-accent-strong mb-3" />
                )}
                
                <p className="text-sm font-bold text-primary mb-1">
                  {selectedFiles.length === 0
                    ? "Arraste PDFs ou ZIPs ou clique para buscar"
                    : selectedFiles.length === 1
                      ? selectedFiles[0].name
                      : `${selectedFiles.length} arquivos prontos para envio`}
                </p>
                <p className="text-xs text-secondary">
                  Formatos aceitos: PDF para indexar e ZIP para armazenar
                </p>
              </div>
            </label>

            <div className="space-y-1.5">
              <label className="field-label">Comentário para a IA</label>
              <textarea
                className="field min-h-[7rem] resize-y"
                maxLength={4000}
                placeholder="Opcional: explique o projeto, cliente, finalidade, prioridade ou regra de organização. Esse contexto será salvo como memória e usado na classificação."
                value={uploadComment}
                disabled={isBusy}
                onChange={(event) => setUploadComment(event.target.value)}
              />
              <p className="text-xs text-secondary">
                O comentário acompanha todos os arquivos deste envio e fica disponível para busca, chat e organização automática.
              </p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="rounded-xl border border-border-soft bg-bg-surface-strong p-3 text-sm animate-slide-up">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="font-medium text-primary">
                    {selectedFiles.length === 1 ? "Arquivo selecionado" : `${selectedFiles.length} arquivos selecionados`}
                  </span>
                  <span className="text-muted flex-shrink-0">
                    {formatBytes(selectedFiles.reduce((acc, file) => acc + file.size, 0))}
                  </span>
                </div>
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {selectedFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/10 px-3 py-2"
                    >
                      <span className="truncate font-medium text-primary flex items-center gap-2">
                        <FileText size={16} className="text-accent" />
                        {file.name}
                      </span>
                      <span className="text-muted flex-shrink-0">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(isBusy || uploadProgress > 0) && (
              <div className="space-y-3 rounded-xl border border-border-soft bg-bg-surface-strong p-4 animate-slide-up">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-primary flex items-center gap-2">
                    {isBusy && <Loader2 size={16} className="animate-spin text-accent" />}
                    {uploadStatus || "Preparando upload"}
                  </span>
                  <span className="text-accent-strong font-bold">{uploadProgress}%</span>
                </div>
                <div className="progress-track bg-black/20">
                  <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
                <div className="progress-step-list pt-3">
                  <ProgressStep
                    label="Upload seguro"
                    description={
                      selectedFiles.length > 1
                        ? `Transferência em lote de ${selectedFiles.length} arquivos ou pacotes`
                        : "Transferência local para o workspace"
                    }
                    state={uploadProgress >= 100 ? "done" : uploadProgress > 0 ? "active" : "idle"}
                  />
                  <ProgressStep
                    label="Fila e indexação"
                    description="Os arquivos continuam sendo processados após o envio"
                    state={isBusy && uploadProgress >= 100 ? "active" : !isBusy && uploadProgress >= 100 ? "done" : "idle"}
                  />
                </div>
              </div>
            )}

            {uploadStatus && !isBusy && (
              <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-medium text-success flex items-start gap-2 animate-slide-up">
                <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
                <p>{uploadStatus}</p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-medium text-danger flex items-start gap-2 animate-slide-up">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full mt-2" 
              isLoading={isBusy}
              disabled={selectedFiles.length === 0}
            >
              {isBusy ? "Processando..." : selectedFiles.length > 1 ? "Enviar Arquivos" : "Enviar Arquivo"}
            </Button>
          </form>
        </GlassCard>

        <GlassCard className="lg:col-span-2 overflow-hidden flex flex-col h-full !min-h-[30rem] lg:max-h-[calc(100dvh-12rem)]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="eyebrow text-accent-strong">Acervo</p>
              <p className="mt-1 text-sm text-secondary">Arquivos disponíveis na base do Nexus.</p>
            </div>
            <StatusChip label={`${documents.length} itens`} variant="info" />
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto">
            <table className="nexus-table w-full">
              <thead className="sticky top-0 bg-bg-surface-strong/90 backdrop-blur-md z-10">
                <tr>
                  <th className="rounded-tl-lg">Nome do Arquivo</th>
                  <th>Data</th>
                  <th>Etapa</th>
                  <th>Chunks</th>
                  <th>Status</th>
                  <th className="rounded-tr-lg w-44">Ações</th>
                </tr>
              </thead>
              <motion.tbody 
                variants={staggerContainer} 
                initial="hidden" 
                animate="show"
                className="divide-y divide-border-soft"
              >
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 border-none">
                      <div className="empty-state">
                        <Info size={32} className="text-muted mb-2" />
                        <p className="text-base font-semibold">Acervo vazio</p>
                        <p className="max-w-md text-sm text-secondary mx-auto">
                          Faça o upload do seu primeiro PDF ou ZIP ao lado para iniciar o acervo.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <motion.tr 
                      variants={fadeUpRow}
                      layout
                      key={doc.document_id} 
                      className="group cursor-pointer hover:bg-white/5 transition-colors" 
                      onClick={() => void openProcessingDetail(doc)}
                    >
                      <td className="font-medium text-primary px-4 py-3">
                        <div className="flex items-center gap-3">
                          {isZipDocument(doc) ? (
                            <Archive size={16} className="text-muted group-hover:text-accent transition-colors" />
                          ) : (
                            <FileText size={16} className="text-muted group-hover:text-accent transition-colors" />
                          )}
                          <span className="truncate max-w-[200px] md:max-w-[300px] group-hover:text-accent transition-colors" title={doc.original_name}>
                            {formatDocName(doc.suggested_name || doc.original_name)}
                          </span>
                        </div>
                      </td>
                      <td className="text-sm text-secondary px-4 py-3">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                      <td className="min-w-[14rem] px-4 py-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-semibold uppercase tracking-[0.14em] text-secondary">
                              {documentStageLabel(doc)}
                            </span>
                            <span className="font-mono text-muted">{documentProgressValue(doc)}%</span>
                          </div>
                          <div className="progress-track h-2 bg-black/20 rounded-full overflow-hidden">
                            <motion.div 
                               initial={{ width: 0 }}
                               animate={{ width: `${documentProgressValue(doc)}%` }}
                               transition={{ duration: 1 }}
                               className="progress-bar bg-accent h-full" 
                            />
                          </div>
                          {doc.processing_error ? (
                            <p className="text-xs text-danger line-clamp-2">{doc.processing_error}</p>
                          ) : (
                            <p className="text-xs text-secondary">{documentStageDescription(doc)}</p>
                          )}
                        </div>
                      </td>
                      <td className="text-sm text-muted font-mono px-4 py-3">{doc.chunks_indexed}</td>
                      <td className="px-4 py-3">
                        <StatusChip
                          label={documentStatusLabel(doc)}
                          variant={documentStatusVariant(doc)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-border-soft px-2.5 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent hover:bg-accent/10"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openProcessingDetail(doc);
                            }}
                          >
                            <Info size={14} />
                            Detalhes
                          </button>
                          {String(doc.processing_status || "").toLowerCase() === "ready" && isPdfDocument(doc) && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-border-soft px-2.5 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent hover:bg-accent/10"
                              onClick={(event) => {
                                event.stopPropagation();
                                setViewerDocument(doc);
                              }}
                            >
                              <Eye size={14} />
                              Ver PDF
                            </button>
                          )}
                          {String(doc.processing_status || "").toLowerCase() === "ready" && !isPdfDocument(doc) && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-border-soft px-2.5 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent hover:bg-accent/10"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDownloadStoredFile(doc);
                              }}
                            >
                              <Download size={14} />
                              Baixar
                            </button>
                          )}
                          {String(doc.processing_status || "").toLowerCase() === "failed" && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRetry(doc);
                              }}
                            >
                              {retryingId === doc.document_id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </motion.tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      <Dialog
        open={Boolean(selectedDocumentId)}
        title={processingDetail?.document.title || processingDetail?.document.suggested_name || "Processamento do documento"}
        description="Linha do tempo de processamento, erros e ação de retry quando necessário."
        onClose={() => {
          if (retryingId) return;
          setSelectedDocumentId("");
          setProcessingDetail(null);
        }}
        panelClassName="!w-[min(96vw,72rem)]"
        footer={processingDetail ? (
          <>
            {processingDetail.document.processing_status === "ready" && isPdfDocument(processingDetail.document) && (
              <Button variant="secondary" type="button" onClick={() => setViewerDocument(processingDetail.document)}>
                Visualizar PDF
              </Button>
            )}
            {processingDetail.document.processing_status === "ready" && !isPdfDocument(processingDetail.document) && (
              <Button variant="secondary" type="button" onClick={() => void handleDownloadStoredFile(processingDetail.document)}>
                Baixar arquivo
              </Button>
            )}
            {processingDetail.can_retry && (
              <Button
                type="button"
                variant="secondary"
                isLoading={retryingId === processingDetail.document.document_id}
                onClick={() => void handleRetry(processingDetail.document)}
              >
                Tentar novamente
              </Button>
            )}
            <Button variant="ghost" type="button" onClick={() => {
              setSelectedDocumentId("");
              setProcessingDetail(null);
            }}>
              Fechar
            </Button>
          </>
        ) : undefined}
      >
        {loadingProcessingDetail && !processingDetail ? (
          <div className="py-16 text-center text-sm text-slateblue/70">Carregando detalhes do processamento...</div>
        ) : processingDetail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <SummaryField label="Status" value={documentStatusLabel(processingDetail.document)} />
              <SummaryField label="Etapa" value={documentStageLabel(processingDetail.document)} />
              <SummaryField label="Progresso" value={`${documentProgressValue(processingDetail.document)}%`} />
              <SummaryField label="Chunks" value={String(processingDetail.document.chunks_indexed || 0)} />
            </div>

            {processingDetail.document.processing_error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-white">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-danger">Erro atual</p>
                <p className="mt-2">{processingDetail.document.processing_error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.9fr]">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-[rgba(20,25,33,0.72)] p-4">
                <p className="text-sm font-bold text-white">Resumo técnico</p>
                <MetadataLine label="Arquivo" value={processingDetail.document.original_name} />
                {processingDetail.document.source_archive_name && (
                  <MetadataLine label="ZIP origem" value={processingDetail.document.source_archive_name} />
                )}
                {processingDetail.document.zip_entry_path && (
                  <MetadataLine label="Caminho no ZIP" value={processingDetail.document.zip_entry_path} />
                )}
                {processingDetail.document.user_comment && (
                  <MetadataLine label="Comentário IA" value={processingDetail.document.user_comment} />
                )}
                <MetadataLine label="Sugestão" value={processingDetail.document.suggested_name} />
                <MetadataLine label="Caminho" value={processingDetail.document.folder_path || "Meu Disco"} />
                <MetadataLine label="Inicio" value={formatTimestamp(processingDetail.document.processing_started_at)} />
                <MetadataLine label="Fim" value={formatTimestamp(processingDetail.document.processing_completed_at)} />
                <MetadataLine label="Resumo" value={documentStageDescription(processingDetail.document)} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-[rgba(20,25,33,0.72)] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-bold text-white">Timeline do processamento</p>
                  {processingDetail.is_processing && (
                    <span className="text-xs font-semibold text-accent-strong">Atualizando automaticamente</span>
                  )}
                </div>
                <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-2">
                  {processingDetail.events.length === 0 ? (
                    <p className="text-sm text-slateblue/70">Nenhum evento registrado ainda.</p>
                  ) : (
                    processingDetail.events.slice().reverse().map((event) => (
                      <ProcessingEventItem key={event.event_id} event={event} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>

      <DocumentViewerDialog
        open={Boolean(viewerDocument)}
        onClose={() => setViewerDocument(null)}
        documentId={viewerDocument?.document_id}
        title={viewerDocument?.title || viewerDocument?.suggested_name || "Visualizador"}
        originalName={viewerDocument?.original_name || viewerDocument?.suggested_name || "documento.pdf"}
        page={null}
        chunkLabel={null}
        snippet={viewerDocument?.summary}
        folderPath={viewerDocument?.folder_path}
      />
    </div>
  );
}

function ProgressStep({
  label,
  description,
  state
}: {
  label: string;
  description: string;
  state: "idle" | "active" | "done";
}) {
  return (
    <div className={`progress-step ${state === "active" ? "progress-step-active" : ""} ${state === "done" ? "progress-step-done" : ""}`}>
      <span className="progress-step-dot" />
      <div>
        <p className="text-sm font-semibold text-primary">{label}</p>
        <p className="text-xs text-secondary">{description}</p>
      </div>
      <span className="text-[0.65rem] font-bold uppercase tracking-wider text-muted">
        {state === "done" ? "OK" : state === "active" ? "AGORA" : "ESPERA"}
      </span>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(20,25,33,0.72)] px-4 py-3">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function MetadataLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">{label}</p>
      <p className="mt-1 break-all text-sm text-white/90">{value || "--"}</p>
    </div>
  );
}

function ProcessingEventItem({ event }: { event: DocumentProcessingEvent }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${eventToneClasses(event.level)}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em]">
          {eventLabel(event)}
        </span>
        <span className="text-[0.68rem] font-semibold opacity-80">
          {formatTimestamp(event.timestamp)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-white/90">{event.message}</p>
      {typeof event.progress === "number" && (
        <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] opacity-80">
          Progresso {Math.max(0, Math.min(Math.round(event.progress), 100))}%
        </p>
      )}
    </div>
  );
}

function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  const isZip = name.endsWith(".zip") || ["application/zip", "application/x-zip-compressed", "multipart/x-zip"].includes(file.type);

  if (!isPdf && !isZip) {
    return "Envie arquivos em formato PDF ou ZIP.";
  }

  if (isPdf && file.size > 100 * 1024 * 1024) {
    return "O PDF excede o limite de 100 MB.";
  }

  if (isZip && file.size > 2 * 1024 * 1024 * 1024) {
    return "O ZIP excede o limite de 2 GB.";
  }

  return null;
}

function isZipDocument(document: DocumentRecord): boolean {
  const fileFormat = String(document.file_format || "").toLowerCase();
  const originalName = String(document.original_name || document.suggested_name || "").toLowerCase();
  return fileFormat === "zip" || originalName.endsWith(".zip");
}

function isPdfDocument(document: DocumentRecord): boolean {
  return !isZipDocument(document);
}

function mapUploadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Não foi possível enviar o documento.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("network") || message.includes("conexão") || message.includes("conexao")) {
    return "Falha de rede durante o envio. Verifique a conexão.";
  }

  if (message.includes("413") || message.includes("too large")) {
    return "O arquivo é muito grande para o limite configurado no servidor.";
  }

  if (error.message) {
    return error.message;
  }

  return "Ocorreu um erro ao processar o upload.";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isDocumentProcessing(document: DocumentRecord): boolean {
  return ACTIVE_PROCESSING_STATUSES.has(String(document.processing_status || "").toLowerCase());
}

function documentProgressValue(document: DocumentRecord): number {
  const raw = document.processing_progress;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(Math.round(raw), 100));
  }
  return isDocumentProcessing(document) ? 0 : 100;
}

function documentStageLabel(document: DocumentRecord): string {
  if (isZipDocument(document)) {
    return "Armazenado";
  }
  switch (String(document.processing_status || "").toLowerCase()) {
    case "queued":
      return "Na fila";
    case "extracting":
      return "Extraindo";
    case "classifying":
      return "Classificando";
    case "indexing":
      return "Indexando";
    case "failed":
      return "Falhou";
    default:
      return "Pronto";
  }
}

function documentStageDescription(document: DocumentRecord): string {
  if (isZipDocument(document)) {
    return "Arquivo ZIP preservado no workspace, sem extração ou indexação semântica.";
  }
  switch (String(document.processing_status || "").toLowerCase()) {
    case "queued":
      return "Aguardando um worker livre para iniciar a leitura do documento.";
    case "extracting":
      return "Convertendo o documento em texto pesquisável.";
    case "classifying":
      return "Inferindo tipo, domínio, título e pasta de destino.";
    case "indexing":
      return "Gerando chunks, embeddings e indexando no acervo.";
    case "failed":
      return "O processamento parou antes da indexação final.";
    default:
      return document.chunks_indexed > 0
        ? `${document.chunks_indexed} chunks prontos para busca semântica.`
        : "Documento disponível no acervo.";
  }
}

function documentStatusLabel(document: DocumentRecord): string {
  if (isZipDocument(document)) {
    return "Armazenado";
  }
  switch (String(document.processing_status || "").toLowerCase()) {
    case "queued":
      return "Na fila";
    case "extracting":
    case "classifying":
    case "indexing":
      return "Processando";
    case "failed":
      return "Falhou";
    default:
      return "Indexado";
  }
}

function documentStatusVariant(document: DocumentRecord): "info" | "success" | "warning" | "danger" {
  switch (String(document.processing_status || "").toLowerCase()) {
    case "queued":
      return "info";
    case "extracting":
    case "classifying":
    case "indexing":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "success";
  }
}

function eventToneClasses(level: string): string {
  switch (level) {
    case "danger":
      return "border-danger/30 bg-danger/10 text-danger";
    case "warning":
      return "border-amber-300/30 bg-amber-400/10 text-amber-200";
    case "success":
      return "border-emerald-300/30 bg-emerald-400/10 text-emerald-200";
    default:
      return "border-white/10 bg-black/10 text-sky-200";
  }
}

function eventLabel(event: DocumentProcessingEvent): string {
  const stage = String(event.stage || "").toLowerCase();
  if (stage === "queued") return "Fila";
  if (stage === "extracting") return "Extração";
  if (stage === "classifying") return "Classificação";
  if (stage === "indexing") return "Indexação";
  if (stage === "ready") return "Concluído";
  if (stage === "failed") return "Falha";
  return stage || "Evento";
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}
