import { ReactNode, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDocumentObjectUrl, downloadDocument } from "../lib/api";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

type DocumentViewerDialogProps = {
  open: boolean;
  onClose: () => void;
  documentId?: string | null;
  title: string;
  originalName: string;
  page?: string | number | null;
  chunkLabel?: string | number | null;
  snippet?: string | null;
  folderPath?: string | null;
  pdfPath?: string | null;
  extraActions?: ReactNode;
};

export function DocumentViewerDialog({
  open,
  onClose,
  documentId,
  title,
  originalName,
  page,
  chunkLabel,
  snippet,
  folderPath,
  pdfPath,
  extraActions,
}: DocumentViewerDialogProps) {
  const { getCurrentToken } = useAuth();
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !documentId) {
      setPreviewUrl((currentUrl) => {
        if (currentUrl) window.URL.revokeObjectURL(currentUrl);
        return "";
      });
      setError("");
      return;
    }

    let isMounted = true;
    let nextUrl = "";

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const token = await getCurrentToken();
        const { url } = await createDocumentObjectUrl(documentId, token, originalName || "documento.pdf");
        nextUrl = url;
        if (!isMounted) {
          window.URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrl((currentUrl) => {
          if (currentUrl) window.URL.revokeObjectURL(currentUrl);
          return url;
        });
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar o PDF.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      if (nextUrl) window.URL.revokeObjectURL(nextUrl);
    };
  }, [documentId, getCurrentToken, open, originalName]);

  async function handleDownload() {
    if (!documentId) return;
    setDownloading(true);
    setError("");
    try {
      const token = await getCurrentToken();
      await downloadDocument(documentId, token, originalName || "documento.pdf");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar o PDF.");
    } finally {
      setDownloading(false);
    }
  }

  const normalizedPage = useMemo(() => {
    if (typeof page === "number" && Number.isFinite(page) && page > 0) return Math.floor(page);
    if (typeof page === "string") {
      const parsed = Number.parseInt(page, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  }, [page]);

  const iframeSrc = useMemo(() => {
    if (!previewUrl) return "";
    return normalizedPage ? `${previewUrl}#page=${normalizedPage}` : previewUrl;
  }, [normalizedPage, previewUrl]);

  return (
    <Dialog
      open={open}
      title={title || originalName || "Visualizador"}
      description="Visualização interna do PDF com contexto do trecho referenciado."
      onClose={onClose}
      panelClassName="!w-[min(96vw,78rem)]"
      contentClassName="!p-0"
      footer={(
        <>
          {extraActions}
          <Button variant="ghost" type="button" onClick={onClose} disabled={downloading}>
            Fechar
          </Button>
          <Button type="button" isLoading={downloading} onClick={() => void handleDownload()} disabled={!documentId}>
            Baixar PDF
          </Button>
        </>
      )}
    >
      <div className="grid min-h-[72vh] grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr]">
        <div className="border-b border-white/10 bg-[rgba(20,25,33,0.82)] p-5 lg:border-b-0 lg:border-r">
          <div className="space-y-4">
            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-white">
                {error}
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">Arquivo</p>
              <p className="break-words text-sm text-white/90">{originalName || "--"}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <InfoField label="Página" value={normalizedPage ? String(normalizedPage) : "--"} />
              <InfoField label="Chunk" value={chunkLabel ? String(chunkLabel) : "--"} />
            </div>

            <div className="space-y-1">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">Caminho em Arquivos</p>
              <p className="break-all text-xs text-slateblue/80">
                {folderPath ? `Arquivos / ${folderPath}` : "Arquivos / Meu Disco"}
              </p>
            </div>

            {pdfPath && (
              <div className="space-y-1">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">Caminho físico</p>
                <p className="break-all text-xs text-slateblue/80">{pdfPath}</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">Trecho citado</p>
              <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm italic leading-relaxed text-white/85">
                {snippet?.trim() ? `“${snippet.trim()}”` : "Nenhum trecho textual foi salvo para esta referência."}
              </div>
            </div>
          </div>
        </div>

        <div className="relative min-h-[60vh] bg-zinc-950">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slateblue/70">
              Carregando PDF...
            </div>
          ) : iframeSrc ? (
            <iframe
              title={title || originalName || "PDF"}
              src={iframeSrc}
              className="h-full min-h-[60vh] w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slateblue/70">
              Não foi possível renderizar o PDF internamente.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slateblue/55">{label}</p>
      <p className="mt-1 text-sm text-white/90">{value}</p>
    </div>
  );
}
