import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/common/Button";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  dense?: boolean;
  caption?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  pageSize = 8,
  dense,
  caption,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sort.dir === "asc" ? av - bv : bv - av;
      }
      return sort.dir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [rows, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    setPage(0);
    setSort((prev) => {
      if (!prev || prev.key !== column.key) return { key: column.key, dir: "asc" };
      if (prev.dir === "asc") return { key: column.key, dir: "desc" };
      return null;
    });
  };

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-[#1b1c1f] to-transparent sm:hidden"
      />
      <div className="max-h-[560px] min-h-[220px] overflow-auto">
        <table className="w-full min-w-[430px] border-collapse text-left sm:min-w-[640px]">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-ash/15 bg-[#1b1c1f]/95 backdrop-blur">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const Icon = !active ? ChevronsUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 whitespace-nowrap bg-[#1b1c1f]/95 px-3 py-1 text-[11.5px] font-medium uppercase tracking-[0.1em] text-ash backdrop-blur sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.12em]",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.hideBelow === "sm" && "hidden sm:table-cell",
                      column.hideBelow === "md" && "hidden md:table-cell",
                      column.hideBelow === "lg" && "hidden lg:table-cell",
                      column.className,
                    )}
                    aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          "inline-flex h-11 items-center gap-1.5 transition hover:text-warm sm:h-auto",
                          active && "text-warm",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <Icon size={11} aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "group border-b border-ash/10 last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-warm/[0.035]",
                )}
              >
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 align-middle text-[12.5px] text-warm/90 sm:px-4 sm:text-[13px]",
                      columnIndex === 0 && "sticky left-0 z-10 bg-[#1b1c1f] group-hover:bg-[#202124]",
                      dense ? "py-2.5" : "py-3.5",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.hideBelow === "sm" && "hidden sm:table-cell",
                      column.hideBelow === "md" && "hidden md:table-cell",
                      column.hideBelow === "lg" && "hidden lg:table-cell",
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? empty : null}

      <p className="border-t border-ash/10 px-3 py-2.5 text-[11.5px] text-dim sm:hidden">
        Swipe the table sideways for more columns →
      </p>

      {sorted.length > pageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ash/12 px-4 py-3">
          <p className="text-[12px] text-ash">
            Showing {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of{" "}
            {sorted.length}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              disabled={safePage === 0}
            >
              Previous
            </Button>
            <span className="px-2 text-[12px] text-ash">
              {safePage + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
