import { DragEvent, useState, useEffect, FormEvent, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { DocumentRecord, listDocuments, uploadDocument } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";

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
          ? "Este documento ja estava indexado. O registro existente foi reutilizado."
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Documentos</h1>
        <p className="text-slateblue text-sm mt-1.5">Envie PDFs, acompanhe o progresso e gerencie o acervo indexado.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <GlassCard className="lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow mb-2">Novo documento</p>
              <h2 className="text-lg font-bold">Enviar PDF</h2>
            </div>
            <StatusChip label="PDF ate 25 MB" variant="info" />
          </div>

          <form onSubmit={handleUpload} className="space-y-3">
            <label
              className={`drop-zone ${isDragging ? "drop-zone-active" : ""}`}
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
              <div className="text-center">
                <svg className="w-8 h-8 mx-auto mb-2 text-slateblue/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-bold">{selectedFile ? selectedFile.name : "Arraste um PDF aqui ou clique para selecionar"}</p>
                <p className="mt-2 text-[0.75rem] text-slateblue/60">Formatos permitidos: PDF. Tamanho maximo: 25 MB.</p>
              </div>
            </label>

            {selectedFile && (
              <div className="rounded-xl border border-white/10 bg-[rgba(20,25,33,0.7)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{selectedFile.name}</span>
                  <span className="text-slateblue/60">{formatBytes(selectedFile.size)}</span>
                </div>
              </div>
            )}

            {(isBusy || uploadProgress > 0) && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-[rgba(20,25,33,0.72)] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{uploadStatus || "Preparando upload"}</span>
                  <span className="text-slateblue/60">{uploadProgress}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
                <div className="progress-step-list pt-2">
                  <ProgressStep
                    label="Upload do arquivo"
                    description="Transferencia local do PDF para o workspace seguro."
                    state={uploadProgress >= 100 ? "done" : uploadProgress > 0 ? "active" : "idle"}
                  />
                  <ProgressStep
                    label="Processamento"
                    description="Leitura do conteúdo e preparação dos metadados."
                    state={isBusy && uploadProgress >= 100 ? "active" : !isBusy && uploadProgress >= 100 ? "done" : "idle"}
                  />
                  <ProgressStep
                    label="Indexação concluída"
                    description="Documento pronto para busca, chat e organização."
                    state={!isBusy && uploadProgress >= 100 ? "done" : "idle"}
                  />
                </div>
              </div>
            )}

            {uploadStatus && (
              <div className="rounded-lg border border-[rgba(126,178,214,0.2)] bg-[rgba(126,178,214,0.1)] p-3 text-[0.82rem] font-medium text-white">
                {uploadStatus}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[rgba(228,149,149,0.3)] bg-[rgba(228,149,149,0.12)] p-3 text-[0.82rem] font-medium text-white">
                {error}
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              isLoading={isBusy}
              disabled={!selectedFile}
            >
              Enviar documento
            </Button>
          </form>
        </GlassCard>

        <GlassCard className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="eyebrow">Acervo indexado</p>
              <p className="mt-1 text-sm text-slateblue/70">Arquivos disponiveis para busca, chat e exploracao.</p>
            </div>
            <StatusChip label={`${documents.length} documentos`} variant="info" />
          </div>

          <div className="overflow-x-auto -mx-5">
            <table className="nexus-table">
              <thead>
                <tr>
                  <th>Nome do Arquivo</th>
                  <th>Data</th>
                  <th>Chunks</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8">
                      <div className="empty-state mx-5">
                        <p className="text-base font-semibold">Nenhum arquivo indexado ainda.</p>
                        <p className="max-w-md text-sm text-slateblue/70">
                          Envie seu primeiro PDF para habilitar organizacao automatica, busca contextual e respostas no chat.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.document_id}>
                      <td className="font-bold">{doc.suggested_name || doc.original_name}</td>
                      <td className="text-[0.8rem]">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                      <td>{doc.chunks_indexed}</td>
                      <td>
                        <StatusChip
                          label={doc.chunks_indexed > 0 ? `${doc.classification || "PDF"} • indexado` : `${doc.classification || "PDF"} • processando`}
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
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-slateblue/70">{description}</p>
      </div>
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slateblue/60">
        {state === "done" ? "ok" : state === "active" ? "em curso" : "aguardando"}
      </span>
    </div>
  );
}

function validateFile(file: File): string | null {
  if (file.type && file.type !== "application/pdf") {
    return "Envie um arquivo em PDF.";
  }

  if (file.size > 25 * 1024 * 1024) {
    return "O arquivo excede o limite de 25 MB. Escolha um PDF menor.";
  }

  return null;
}

function mapUploadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Nao foi possivel enviar o documento. Tente novamente.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("network") || message.includes("conexao")) {
    return "Falha de conexao durante o envio. Verifique a rede e tente novamente.";
  }

  if (message.includes("413") || message.includes("too large")) {
    return "O arquivo e maior do que o permitido. Envie um PDF menor.";
  }

  return "Nao foi possivel concluir o upload agora. Tente novamente em instantes.";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
