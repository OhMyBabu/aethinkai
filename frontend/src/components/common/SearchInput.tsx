import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Caret-safe search field.
 *
 * Keeps its own buffer and only mirrors external resets, so a parent that
 * re-renders (filters, fetches, count-up animations) never rewrites the value
 * mid-typing and throw the caret to the end.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastExternal = useRef(value);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setLocal(value);
    }
  }, [value]);

  /** Immediate local update, deferred propagation: typing never waits on a
   *  table re-render, and the parent cannot fight the caret. */
  const emit = (next: string, immediate = false) => {
    lastExternal.current = next;
    setLocal(next);
    if (timer.current) window.clearTimeout(timer.current);
    if (immediate) {
      onChange(next);
      return;
    }
    timer.current = window.setTimeout(() => onChange(next), 140);
  };

  return (
    <div className={cn("relative", className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ash" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={local}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => emit(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-ash/22 bg-panel pl-9 pr-9 text-sm text-warm outline-none transition placeholder:text-ash/60 focus:border-flame/55 focus:ring-2 focus:ring-flame/20 sm:h-10"
      />
      {local ? (
        <button
          type="button"
          onClick={() => {
            emit("", true);
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-ash transition hover:text-warm"
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}
