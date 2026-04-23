import { DragEvent, useState, useEffect, FormEvent, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, listDocuments, uploadDocument } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";
import { FileText, UploadCloud, AlertCircle, FileCheck2, Loader2, Info, CheckCircle2 } from "lucide-react";

export default function DocumentsPage() {
  const { user, getCurrentToken, authProfile } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user && authProfile) {
      void (async () => {
        try {
          const token = await getCurrentToken();
          const docs = await listDocuments(token);
          setDocuments(docs);
        } catch (err) {
          console.error("Failed to load documents", err);
        }
      })();
    }
  }, [user, authProfile, getCurrentToken]);

  async function refreshDocuments() {
    try {
      const token = await getCurrentToken();
      const docs = await listDocuments(token);
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile) return;
    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsBusy(true);
    setError("");
    setUploadProgress(0);
    setUploadStatus("Enviando documento. Arquivos maiores podem levar mais tempo.");
    try {
      const token = await getCurrentToken();
      const result = await uploadDocument(selectedFile, token, setUploadProgress);
      setUploadStatus(
        result.duplicate
          ? "Este documento já estava indexado. O registro existente foi reutilizado."
          : "Documento enviado e indexado com sucesso."
      );
      setSelectedFile(null);
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

  function handleFileSelection(file: File | null) {
    setError("");
    setUploadStatus("");
    setUploadProgress(0);
    setSelectedFile(file);

    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0] || null;
    handleFileSelection(file);
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
        <p className="text-secondary mt-2">Envie PDFs, acompanhe o progresso e gerencie o acervo indexado.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassCard className="lg:col-span-1 h-fit">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <p className="eyebrow mb-1 text-accent-strong">Novo documento</p>
              <h2 className="text-xl font-bold">Enviar PDF</h2>
            </div>
            <StatusChip label="Até 25 MB" variant="info" />
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
                accept=".pdf" 
                disabled={isBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  handleFileSelection(file);
                }}
              />
              <div className="text-center z-10 flex flex-col items-center">
                {selectedFile ? (
                  <FileCheck2 className="w-12 h-12 text-success mb-3" />
                ) : (
                  <UploadCloud className="w-12 h-12 text-accent-strong mb-3" />
                )}
                
                <p className="text-sm font-bold text-primary mb-1">
                  {selectedFile ? selectedFile.name : "Arraste um PDF ou clique para buscar"}
                </p>
                <p className="text-xs text-secondary">
                  Formatos aceitos: PDF
                </p>
              </div>
            </label>

            {selectedFile && (
              <div className="rounded-xl border border-border-soft bg-bg-surface-strong p-3 flex items-center justify-between gap-3 text-sm animate-slide-up">
                <span className="truncate font-medium text-primary flex items-center gap-2">
                  <FileText size={16} className="text-accent" />
                  {selectedFile.name}
                </span>
                <span className="text-muted flex-shrink-0">{formatBytes(selectedFile.size)}</span>
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
                    description="Transferência local para o workspace"
                    state={uploadProgress >= 100 ? "done" : uploadProgress > 0 ? "active" : "idle"}
                  />
                  <ProgressStep
                    label="Processamento"
                    description="Leitura e vetorização inteligente"
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
              disabled={!selectedFile}
            >
              {isBusy ? "Processando..." : "Enviar Arquivo"}
            </Button>
          </form>
        </GlassCard>

        <GlassCard className="lg:col-span-2 overflow-hidden flex flex-col h-full !min-h-[30rem]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="eyebrow text-accent-strong">Acervo indexado</p>
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
                  <th>Chunks</th>
                  <th className="rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 border-none">
                      <div className="empty-state">
                        <Info size={32} className="text-muted mb-2" />
                        <p className="text-base font-semibold">Acervo vazio</p>
                        <p className="max-w-md text-sm text-secondary mx-auto">
                          Faça o upload do seu primeiro PDF ao lado para habilitar a busca semântica e o RAG.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.document_id} className="group">
                      <td className="font-medium text-primary">
                        <div className="flex items-center gap-3">
                          <FileText size={16} className="text-muted group-hover:text-accent transition-colors" />
                          <span className="truncate max-w-[200px] md:max-w-[300px]" title={doc.original_name}>
                            {formatDocName(doc.suggested_name || doc.original_name)}
                          </span>
                        </div>
                      </td>
                      <td className="text-sm text-secondary">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                      <td className="text-sm text-muted font-mono">{doc.chunks_indexed}</td>
                      <td>
                        <StatusChip
                          label={doc.chunks_indexed > 0 ? "Indexado" : "Processando"}
                          variant={doc.chunks_indexed > 0 ? "success" : "warning"}
                        />
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

function validateFile(file: File): string | null {
  if (file.type && file.type !== "application/pdf") {
    return "Envie um arquivo em formato PDF.";
  }

  if (file.size > 25 * 1024 * 1024) {
    return "O arquivo excede o limite de 25 MB.";
  }

  return null;
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
    return "O arquivo é muito grande (acima do limite do servidor).";
  }

  return "Ocorreu um erro ao processar o upload.";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
