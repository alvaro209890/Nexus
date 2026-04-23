interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
}

export function HighlightedText({ text, query, className = "" }: HighlightedTextProps) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return <span className={className}>{text}</span>;
  }

  const uniqueTerms = Array.from(
    new Set(
      cleanQuery
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  );

  if (uniqueTerms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const pattern = new RegExp(`(${uniqueTerms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        uniqueTerms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
          <mark key={`${part}-${index}`} className="highlight-mark">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </span>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
