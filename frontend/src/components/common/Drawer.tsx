import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="overlay-enter fixed inset-0 z-[75] flex justify-end bg-black/60 backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "panel-enter relative flex h-full w-full flex-col border-l border-ash/20 bg-[#171717] shadow-[-30px_0_80px_-40px_rgba(0,0,0,0.9)]",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ash/12 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-warm">{title}</h2>
            {description ? <p className="mt-1 text-[12.5px] leading-5 text-ash">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1.5 text-ash transition hover:bg-warm/[0.06] hover:text-warm"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-ash/12 bg-[#121213] px-5 py-3.5 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
