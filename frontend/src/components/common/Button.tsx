import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  full?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-flame text-[#1a1305] hover:bg-[#f09a52] active:bg-[#d9792f] border border-transparent",
  secondary:
    "bg-white/[0.04] text-warm border border-white/12 hover:bg-white/[0.08] hover:border-white/20",
  ghost: "text-ash hover:text-warm hover:bg-warm/[0.05] border border-transparent",
  outline: "border border-flame/45 text-flame hover:bg-flame/10",
  danger: "border border-bad/50 text-bad hover:bg-bad/12",
};

const sizes: Record<Size, string> = {
  sm: "h-11 px-3 text-[13px] gap-1.5 rounded-lg sm:h-9",
  md: "h-11 px-4 text-[13.5px] gap-2 rounded-lg sm:h-10",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, children, leadingIcon, trailingIcon, full, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer select-none items-center justify-center font-medium transition-[background-color,border-color,color] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        sizes[size],
        full && "w-full",
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});
