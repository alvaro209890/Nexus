import { useState, FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import { SearchResult, searchSemantic } from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { StatusChip } from "../components/ui/StatusChip";

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
          {results.map((res, index) => (
            <GlassCard key={index} className="result-card flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <StatusChip label={res.suggested_name || res.metadata?.filename || "Documento"} variant="info" />
                <span className="rounded-md border border-white/10 bg-[rgba(20,25,33,0.72)] px-2 py-1 text-[0.68rem] font-bold text-slateblue">
                  Score: {((res.score ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink/80 italic flex-1">
                &ldquo;{res.snippet.length > 300 ? res.snippet.substring(0, 300) + "..." : res.snippet}&rdquo;
              </p>
              <div className="mt-3 pt-3 border-t border-white/40 flex justify-between items-center text-[0.6rem] font-bold text-slateblue/60 uppercase">
                <span>Página {res.metadata?.page || "?"}</span>
                <span>Referência: #{res.metadata?.chunk_index || index}</span>
              </div>
            </GlassCard>
          ))}
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
