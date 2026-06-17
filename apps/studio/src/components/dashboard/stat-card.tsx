interface StatCardProps {
  label: string;
  value: number | string;
  /** Optional colour ring: "blue" | "green" | "red" | "yellow" | "gray" */
  accent?: "blue" | "green" | "red" | "yellow" | "gray";
  /** Small descriptive sub-text shown below the value. */
  sub?: string;
}

const ACCENT_CLASS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-amber-600 dark:text-amber-400",
  gray: "text-muted-foreground",
};

/**
 * Reusable statistic card for dashboard role-views.
 * Intentionally dumb — receives pre-computed values from parent.
 */
export function StatCard({ label, value, accent = "blue", sub }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${ACCENT_CLASS[accent]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
