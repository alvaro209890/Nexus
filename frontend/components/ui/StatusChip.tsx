interface StatusChipProps {
  label: string;
  variant?: "warning" | "success" | "info" | "danger";
}

export function StatusChip({ label, variant = "warning" }: StatusChipProps) {
  const variantStyles = {
    warning: "bg-warning/10 border-warning/30 text-warning font-semibold",
    success: "bg-success/10 border-success/30 text-success font-semibold",
    info: "bg-accent/10 border-accent/30 text-accent font-semibold",
    danger: "bg-danger/10 border-danger/30 text-danger font-semibold",
  };

  return (
    <div className={`status-chip ${variantStyles[variant]}`}>
      {label}
    </div>
  );
}
