type BreadcrumbItem = {
  label: string;
  value: string;
};

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  rootLabel?: string;
  currentValue: string;
  onSelect: (value: string) => void;
  className?: string;
}

export function Breadcrumbs({
  items,
  rootLabel = "Raiz",
  currentValue,
  onSelect,
  className = ""
}: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={`breadcrumb-list ${className}`.trim()}>
      <button
        type="button"
        onClick={() => onSelect("")}
        className={`breadcrumb-pill ${currentValue === "" ? "breadcrumb-pill-active" : ""}`}
      >
        {rootLabel}
      </button>
      {items.map((item) => (
        <div key={item.value} className="breadcrumb-item">
          <span className="breadcrumb-separator" aria-hidden="true">
            <ChevronRightIcon />
          </span>
          <button
            type="button"
            onClick={() => onSelect(item.value)}
            className={`breadcrumb-pill ${currentValue === item.value ? "breadcrumb-pill-active" : ""}`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </nav>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
    </svg>
  );
}
