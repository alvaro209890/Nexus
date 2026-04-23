import { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = "", ...props }: InputProps) {
  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && <span className="eyebrow ml-1">{label}</span>}
      <input 
        className={`field ${error ? "border-red-500" : ""} ${className}`} 
        {...props} 
      />
      {error && <span className="text-xs text-red-500 ml-1">{error}</span>}
    </div>
  );
}
