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
    "bg-flame text-[#1a1305] hover:bg-[#f09a52] active:bg-[#d9792f] border border-transparent shadow-[0_10px_24px_-16px_rgba(231,137,60,0.9)]",
  secondary:
    "bg-warm/[0.08] text-warm border border-ash/22 hover:bg-warm/[0.12] hover:border-ash/34",
  ghost: "text-ash hover:text-warm hover:bg-warm/[0.05] border border-transparent",
  outline: "border border-flame/45 text-flame hover:bg-flame/10",
  danger: "border border-[#c4633a]/50 text-[#e08a5f] hover:bg-[#c4633a]/12",
};

const sizes: Record<Size, string> = {
  sm: "h-11 px-3 text-[13px] gap-1.5 rounded-lg sm:h-9",
  md: "h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, children, leadingIcon, trailingIcon, full, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer select-none items-center justify-center font-medium transition-[background-color,border-color,color,transform] duration-200",
        "disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.985]",
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
