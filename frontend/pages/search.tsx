import { useState, FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import { SearchResult, searchSemantic } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";
import { HighlightedText } from "../components/ui/HighlightedText";

export default function SearchPage() {
  const { getCurrentToken } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setIsBusy(true);
    setError("");
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Busca</h1>
        <p className="text-slateblue text-sm mt-1.5">Encontre trechos relevantes em toda a base com consultas em linguagem natural.</p>
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
          Sugestoes: &ldquo;clausula de reajuste&rdquo;, &ldquo;cronograma do projeto&rdquo;, &ldquo;documentos sobre LGPD&rdquo;.
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
            <p className="max-w-md text-sm text-slateblue/70">Digite uma consulta para localizar trechos relevantes nos documentos indexados.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {results.map((res, index) => {
            const resultClassification = readMetadataText(res.metadata, "document_type")
              || readMetadataText(res.metadata, "classification")
              || res.classification
              || "";
            const resultLabel = res.suggested_name || readMetadataText(res.metadata, "filename") || "Documento";
            const resultPage = readMetadataText(res.metadata, "page") || "?";
            const resultChunk = readMetadataText(res.metadata, "chunk_index") || String(index);

            return (
            <GlassCard key={index} className="result-card flex flex-col">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="file-folder-icon !h-11 !w-11">
                    <DocumentTypeIcon classification={resultClassification} />
                  </div>
                  <div className="min-w-0">
                    <StatusChip label={resultLabel} variant="info" />
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-slateblue/55">
                      {labelForClassification(resultClassification)}
                    </p>
                  </div>
                </div>
                <span className="rounded-md border border-white/10 bg-[rgba(20,25,33,0.72)] px-2 py-1 text-[0.68rem] font-bold text-slateblue">
                  Score: {((res.score ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              <p className="flex-1 text-sm italic leading-relaxed text-ink/80">
                &ldquo;
                <HighlightedText
                  text={res.snippet.length > 300 ? `${res.snippet.substring(0, 300)}...` : res.snippet}
                  query={query}
                />
                &rdquo;
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-white/40 pt-3 text-[0.6rem] font-bold uppercase text-slateblue/60">
                <span>Página {resultPage}</span>
                <span>Referência: #{resultChunk}</span>
              </div>
            </GlassCard>
          )})}
        </div>
        {results.length === 0 && !isBusy && query.trim() && !error && (
          <div className="rounded-lg border border-white/10 bg-[rgba(20,25,33,0.72)] p-4 text-sm text-slateblue/70">
            Nenhum resultado encontrado para essa consulta. Tente termos mais amplos ou nomes de documentos.
          </div>
        )}
      </div>
    </div>
  );
}

function readMetadataText(metadata: SearchResult["metadata"], key: string): string {
  const value = metadata?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function labelForClassification(classification: string): string {
  const value = classification.trim().toLowerCase();
  if (value.includes("contrat")) return "Contrato";
  if (value.includes("polit")) return "Politica";
  if (value.includes("manual")) return "Manual";
  if (value.includes("termo")) return "Termo";
  return "Documento";
}

function DocumentTypeIcon({ classification }: { classification: string }) {
  const value = classification.trim().toLowerCase();

  if (value.includes("contrat")) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 7h8M8 11h8M8 15h5M7 3h7l5 5v12a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      </svg>
    );
  }

  if (value.includes("polit")) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 6V4m0 2a6 6 0 100 12m0-12a6 6 0 110 12m0 0v2m-4-6h8" />
      </svg>
    );
  }

  if (value.includes("manual")) {
    return (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 4h10a2 2 0 012 2v12a1 1 0 01-1.447.894L12 17l-4.553 1.894A1 1 0 016 18V4z" />
      </svg>
    );
  }

  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 3v5h5M8 13h8M8 17h5" />
    </svg>
  );
}
