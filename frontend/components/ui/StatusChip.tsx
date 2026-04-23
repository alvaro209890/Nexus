interface StatusChipProps {
  label: string;
  variant?: "warning" | "success" | "info";
}

export function StatusChip({ label, variant = "warning" }: StatusChipProps) {
  const variantStyles = {
    warning: "bg-amber-100/50 border-amber-200 text-amber-900",
    success: "bg-emerald-100/50 border-emerald-200 text-emerald-900",
    info: "bg-blue-100/50 border-blue-200 text-blue-900",
  };

  return (
    <div className={`status-chip ${variantStyles[variant]}`}>
      {label}
    </div>
  );
}
