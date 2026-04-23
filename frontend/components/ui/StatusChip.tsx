interface StatusChipProps {
  label: string;
  variant?: "warning" | "success" | "info" | "danger";
}

export function StatusChip({ label, variant = "warning" }: StatusChipProps) {
  const variantStyles = {
    warning: "bg-amber-400/10 border-amber-300/30 text-amber-200",
    success: "bg-emerald-400/10 border-emerald-300/30 text-emerald-200",
    info: "bg-sky-400/10 border-sky-300/30 text-sky-200",
    danger: "bg-rose-400/10 border-rose-300/30 text-rose-200",
  };

  return (
    <div className={`status-chip ${variantStyles[variant]}`}>
      {label}
    </div>
  );
}
