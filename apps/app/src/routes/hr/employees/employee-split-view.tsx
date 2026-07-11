import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HrEmployeeListItem } from "@mediaos/contracts";
import { Avatar, Input, Skeleton, EmptyState, cn } from "@mediaos/ui";
import { EmployeeProfilePanel } from "./employee-profile-panel";

/**
 * HR-PROFILE-UI-1 — "dạng chi tiết": danh sách nhân viên bên trái + panel hồ sơ bên phải.
 * items = trang dữ liệu hiện tại từ server (đã scope/mask); ô tìm bên trái lọc CLIENT trong trang.
 */
interface EmployeeSplitViewProps {
  items: HrEmployeeListItem[];
  isLoading: boolean;
  onEdit?: (employeeId: string) => void;
  onOpenFull?: (employeeId: string) => void;
}

export function EmployeeSplitView({
  items,
  isLoading,
  onEdit,
  onOpenFull,
}: EmployeeSplitViewProps) {
  const { t } = useTranslation("hr");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return items;
    return items.filter((it) =>
      [it.fullName, it.employeeCode, it.email, it.positionName]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term)),
    );
  }, [items, filter]);

  // Chọn mặc định dòng đầu của trang khi selection hiện tại không còn trong dữ liệu.
  const effectiveId =
    selectedId && filtered.some((it) => it.id === selectedId)
      ? selectedId
      : (filtered[0]?.id ?? null);

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
      {/* Danh sách trái */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border p-3">
          <Input
            placeholder={t("employees.search")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("employees.empty.title")}
            </p>
          ) : (
            filtered.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedId(it.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-0",
                  effectiveId === it.id ? "bg-brand-muted/60" : "hover:bg-muted/50",
                )}
              >
                <Avatar size="sm" name={it.fullName} src={it.avatarUrl} />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm font-semibold uppercase",
                      effectiveId === it.id ? "text-brand" : "text-foreground",
                    )}
                  >
                    {it.fullName ?? "—"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {it.positionName ?? it.email ?? "—"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Panel phải */}
      {effectiveId ? (
        <EmployeeProfilePanel employeeId={effectiveId} onEdit={onEdit} onOpenFull={onOpenFull} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6">
          <EmptyState
            title={t("employees.empty.title")}
            description={t("employees.empty.description")}
          />
        </div>
      )}
    </div>
  );
}
