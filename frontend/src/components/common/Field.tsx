import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const baseField =
  "w-full rounded-xl border border-ash/18 bg-[#141416] px-3.5 py-2.5 text-sm text-warm placeholder:text-ash/60 transition focus:border-flame/55 focus:outline-none focus:ring-2 focus:ring-flame/20 disabled:opacity-50";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
  required?: boolean;
}

export function Field({ label, hint, error, children, className, required }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[12px] font-medium text-ash">
        {label}
        {required ? <span className="ml-1 text-flame">*</span> : null}
      </label>
      {children(id, describedBy)}
      {hint && !error ? (
        <p id={hintId} className="text-[11px] leading-4 text-dim">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[11px] leading-4 text-[#e08a5f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(baseField, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(baseField, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(baseField, "min-h-24 resize-y", className)} {...props} />;
  },
);
