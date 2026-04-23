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
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Busca Semântica</h1>
        <p className="text-slateblue mt-2">Localize informações precisas em toda a sua base de documentos.</p>
      </header>

      <GlassCard>
        <form onSubmit={handleSearch} className="flex gap-4">
          <Input 
            placeholder="O que você está procurando hoje? Ex: 'contratos de tecnologia' ou 'prazos de entrega'..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="!rounded-full px-6"
          />
          <Button type="submit" isLoading={isBusy} className="px-8 min-w-[140px]">
            Pesquisar
          </Button>
        </form>
      </GlassCard>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="eyebrow">{results.length > 0 ? `Encontrados ${results.length} resultados relevantes` : "Resultados"}</p>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-semibold text-sm">
            {error}
          </div>
        )}

        {results.length === 0 && !isBusy && !error && (
          <div className="text-center py-20 bg-white/30 rounded-[2rem] border border-dashed border-slateblue/20">
            <svg className="w-16 h-16 mx-auto mb-4 text-slateblue/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-slateblue/60 font-medium italic">Aguardando entrada para consulta vetorial...</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {results.map((res, index) => (
            <GlassCard key={index} className="result-card flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <StatusChip label={res.suggested_name || res.metadata?.filename || "Documento"} variant="info" />
                <span className="text-[0.6rem] font-bold text-slateblue uppercase tracking-widest bg-white/50 px-2 py-1 rounded-md border border-white/60">
                  Score: {((res.score ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink/80 italic flex-1">
                &ldquo;{res.snippet.length > 300 ? res.snippet.substring(0, 300) + "..." : res.snippet}&rdquo;
              </p>
              <div className="mt-4 pt-4 border-t border-white/40 flex justify-between items-center text-[0.65rem] font-bold text-slateblue/60 uppercase">
                <span>Página {res.metadata?.page || "?"}</span>
                <span>Referência: #{res.metadata?.chunk_index || index}</span>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
