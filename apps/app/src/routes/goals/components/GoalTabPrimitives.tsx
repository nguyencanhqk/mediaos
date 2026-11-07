import type { ReactNode } from "react";

/**
 * S5-GOAL-FE-2 — primitives dùng chung cho các tab của màn chi tiết mục tiêu. Tách khỏi
 * GoalDetailPage.tsx khi CheckinsTab/LinkedTasksTab ra file riêng (giữ trần 800 dòng/file,
 * CLAUDE.md §5) — hành vi GIỮ NGUYÊN so với bản inline ở FE-1.
 */

/** Bảng đơn giản dùng chung cho các tab (không phân trang phía client — server đã cắt trang). */
export function SimpleTable({
  head,
  children,
  columnWidths,
}: {
  head: ReactNode[];
  children: ReactNode;
  /** Lớp độ rộng theo cột (vd "w-32") ⇒ bảng table-fixed, nhiều bảng cạnh nhau thẳng cột. */
  columnWidths?: readonly string[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className={columnWidths ? "w-full table-fixed" : "w-full"}>
        <thead className="bg-muted/50">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${columnWidths?.[i] ?? ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TabSkeleton() {
  return (
    <div className="space-y-2 py-3">
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="h-9 w-11/12 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function TabError({ message }: { message: string }) {
  return (
    <p className="py-6 text-center text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
