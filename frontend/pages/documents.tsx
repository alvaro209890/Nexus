import { useState, useEffect, FormEvent } from "react";
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

    setIsBusy(true);
    setError("");
    setUploadStatus("Processando documento...");
    try {
      const token = await getCurrentToken();
      const result = await uploadDocument(selectedFile, token);
      setUploadStatus(
        result.duplicate
          ? "Documento já existia. Registro recuperado."
          : `Documento indexado com sucesso.`
      );
      setSelectedFile(null);
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload.");
      setUploadStatus("");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Gerenciamento de Arquivos</h1>
        <p className="text-slateblue mt-2">Envie e organize seus documentos para análise de IA.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Upload Section */}
        <GlassCard className="lg:col-span-1">
          <p className="eyebrow mb-4">Novo Documento</p>
          <form onSubmit={handleUpload} className="space-y-4">
            <label className="drop-zone">
              <input 
                type="file" 
                className="hidden" 
                accept=".pdf" 
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <div className="text-center">
                <svg className="w-10 h-10 mx-auto mb-3 text-slateblue/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-bold">{selectedFile ? selectedFile.name : "Clique para selecionar PDF"}</p>
                <p className="text-[0.65rem] text-slateblue/60 mt-1 uppercase tracking-wider">Apenas arquivos .pdf</p>
              </div>
            </label>

            {uploadStatus && (
              <div className="p-3 rounded-xl bg-amberline/10 border border-amberline/20 text-xs font-semibold text-amber-900">
                {uploadStatus}
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              isLoading={isBusy}
              disabled={!selectedFile}
            >
              Iniciar Indexação
            </Button>
          </form>
        </GlassCard>

        {/* Documents List */}
        <GlassCard className="lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <p className="eyebrow">Arquivos Indexados</p>
            <StatusChip label={`${documents.length} Documentos`} variant="info" />
          </div>

          <div className="overflow-x-auto -mx-6">
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
                    <td colSpan={4} className="text-center py-12 text-slateblue/50 italic">
                      Nenhum documento encontrado no arquivo.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.document_id}>
                      <td className="font-bold">{doc.suggested_name || doc.original_name}</td>
                      <td className="text-xs">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                      <td>{doc.chunks_indexed}</td>
                      <td>
                        <StatusChip 
                          label={doc.classification || "PDF"} 
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
