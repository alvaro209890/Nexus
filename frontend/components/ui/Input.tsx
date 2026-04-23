import { InputHTMLAttributes, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = "", ...props }: InputProps) {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}
      <input 
        id={inputId}
        className={`field ${error ? "border-red-500" : ""} ${className}`} 
        aria-invalid={Boolean(error)}
        {...props} 
      />
      {error && <span className="ml-1 text-sm text-red-300">{error}</span>}
    </div>
  );
}
