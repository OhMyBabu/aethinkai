import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastVariant = "success" | "info" | "warning";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (title: string, options?: { description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastApi["toast"]>(
    (title, options) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setItems((prev) => [
        ...prev.slice(-3),
        { id, title, description: options?.description, variant: options?.variant ?? "success" },
      ]);
      window.setTimeout(() => dismiss(id), 4600);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:pr-6"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const Icon = icons[item.variant];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]",
                  "border-white/10 bg-[#1B1B1C] text-warm",
                )}
                role="status"
              >
                <Icon
                  size={18}
                  className={cn(
                    "mt-0.5 shrink-0",
                    item.variant === "success" && "text-flame",
                    item.variant === "info" && "text-ash",
                    item.variant === "warning" && "text-burnt",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-5">{item.title}</p>
                  {item.description ? (
                    <p className="mt-0.5 text-xs leading-5 text-ash">{item.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="-mr-1 -mt-1 rounded-md p-1 text-ash transition hover:text-warm"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
