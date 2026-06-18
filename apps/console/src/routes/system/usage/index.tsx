import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, BarChart2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { UserLastLoginDto, UsageQuery } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import { Button, DataTable, EmptyState } from "@mediaos/ui";
import { usageApi } from "@/lib/usage-api";

/**
 * CS-7 — Tình hình sử dụng (console, tenant self, /system/usage).
 *
 * Gate: view:usage (resource_type='company', is_sensitive=false, mig 0370).
 * FE hiển thị: StatCard tổng quan + bảng người dùng + lọc thời gian + xuất CSV.
 * i18n: raw vi strings (acceptable fallback per CS-7 spec).
 */

// ── StatCard (local copy — mirror apps/studio, tránh phụ thuộc chéo package) ──
interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "blue" | "green" | "red" | "yellow" | "gray";
  sub?: string;
}

const ACCENT_CLASS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
  yellow: "text-amber-600 dark:text-amber-400",
  gray: "text-muted-foreground",
};

function StatCard({ label, value, accent = "blue", sub }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${ACCENT_CLASS[accent]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Filter state ──────────────────────────────────────────────────────────────

interface FilterState {
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTER: FilterState = { dateFrom: "", dateTo: "" };

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportUsersCsv(users: UserLastLoginDto[], dateFrom: string, dateTo: string): void {
  const header = ["Tên", "Email", "Đơn vị", "Lần cuối đăng nhập"];
  const rows = users.map((u) => [
    u.fullName ?? "",
    u.email,
    u.departmentName ?? "",
    u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("vi-VN") : "Chưa đăng nhập",
  ]);

  const periodNote = dateFrom || dateTo
    ? `# Khoảng thời gian: ${dateFrom || "..."} đến ${dateTo || "..."}\n`
    : "";

  const csvContent =
    periodNote +
    [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tinh-hinh-su-dung-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Main page component ───────────────────────────────────────────────────────

export function UsagePage() {
  const canView = useCan("view", "usage");

  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);

  const queryArgs = useMemo<Partial<UsageQuery>>(() => {
    const q: Partial<UsageQuery> = {};
    if (applied.dateFrom) q.dateFrom = new Date(applied.dateFrom).toISOString();
    if (applied.dateTo) q.dateTo = new Date(applied.dateTo + "T23:59:59").toISOString();
    return q;
  }, [applied]);

  const query = useQuery({
    queryKey: ["console:usage", queryArgs],
    queryFn: () => usageApi.getTenantUsage(queryArgs),
    enabled: canView,
  });

  const columns: ColumnDef<UserLastLoginDto>[] = useMemo(
    () => [
      {
        accessorKey: "fullName",
        header: "Tên",
        cell: ({ row }) => <span>{row.original.fullName ?? "—"}</span>,
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
      },
      {
        accessorKey: "departmentName",
        header: "Đơn vị",
        cell: ({ row }) => <span>{row.original.departmentName ?? "—"}</span>,
      },
      {
        accessorKey: "lastLoginAt",
        header: "Lần cuối đăng nhập",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {row.original.lastLoginAt
              ? new Date(row.original.lastLoginAt).toLocaleString("vi-VN")
              : <span className="text-muted-foreground italic">Chưa đăng nhập</span>}
          </span>
        ),
      },
    ],
    [],
  );

  const handleExport = useCallback(() => {
    const users = query.data?.users ?? [];
    exportUsersCsv(users, applied.dateFrom, applied.dateTo);
  }, [query.data, applied]);

  function applyFilter() {
    setApplied(draft);
  }

  function clearFilter() {
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={BarChart2}
          title="Không có quyền"
          description="Bạn cần quyền 'Xem tình hình sử dụng' để truy cập trang này."
        />
      </div>
    );
  }

  const data = query.data;
  const users = data?.users ?? [];
  const isEmpty = !query.isLoading && !query.isError && users.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Tình hình sử dụng</h1>
          <p className="text-sm text-muted-foreground">
            Tổng hợp số liệu sử dụng hệ thống của công ty.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={!data || users.length === 0}
        >
          <Download className="mr-1.5 h-4 w-4" />
          Xuất khẩu CSV
        </Button>
      </header>

      {/* Time range filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span>Từ ngày</span>
          <input
            type="date"
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>Đến ngày</span>
          <input
            type="date"
            className="rounded border border-border px-2 py-1 text-sm"
            value={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={applyFilter}>
            Áp dụng
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilter}>
            Xóa
          </Button>
        </div>
      </div>

      {/* StatCards */}
      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-muted" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Lượt đăng nhập" value={data.loginCount} accent="blue" />
          <StatCard label="Người dùng hoạt động" value={data.activeUserCount} accent="green" />
          <StatCard label="Việc đã tạo" value={data.tasksCreated} accent="yellow" />
          <StatCard label="Việc hoàn thành" value={data.tasksCompleted} accent="green" />
        </div>
      ) : null}

      {/* Error */}
      {query.isError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <p className="text-sm text-destructive">Không thể tải dữ liệu. Vui lòng thử lại.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        </div>
      )}

      {/* User table */}
      {isEmpty ? (
        <EmptyState
          icon={BarChart2}
          title="Chưa có dữ liệu"
          description="Chưa có người dùng nào trong khoảng thời gian đã chọn."
        />
      ) : (
        <DataTable
          columns={columns}
          data={users}
          isLoading={query.isLoading}
        />
      )}
    </div>
  );
}
