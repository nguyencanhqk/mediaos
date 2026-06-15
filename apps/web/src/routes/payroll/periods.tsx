import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { payrollPeriodApi } from "@/lib/payroll-period-api";
import { PermissionGate } from "@/components/permission-gate";
import { PayrollPeriodTable } from "@/components/payroll/payroll-period-table";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PERIOD_STATUS_LABELS } from "@/components/payroll/period-constants";
import { useAuthStore } from "@/stores/auth";

/**
 * PayrollPeriodsPage (G12-FE) — /payroll/periods.
 *
 * BẤT BIẾN:
 *  - approve/publish/view-payslip là isSensitive → KHÔNG có trong /me capabilities (G3-5).
 *    Dùng PermissionGate cho manage-payroll-period (create, non-sensitive) chỉ.
 *    Nút Duyệt/Phát hành render OPTIMISTIC — server là chốt chặn thật (fail-closed).
 *  - SoD hiển thị FE chỉ để cảnh báo, server vẫn từ chối nếu vi phạm.
 *  - Lỗi từ server (403, 422) map ra message hiện trên row (không crash page).
 */
export function PayrollPeriodsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<PayrollPeriodStatus | "">("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Read userId from auth store for SoD check.
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["payroll-periods", { status }],
    queryFn: () => payrollPeriodApi.list(status ? { status } : undefined),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => payrollPeriodApi.approve(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
    onError: (err, id) => {
      const msg = err instanceof Error ? err.message : "Duyệt thất bại.";
      setRowErrors((prev) => ({ ...prev, [id]: msg }));
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => payrollPeriodApi.publish(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
    onError: (err, id) => {
      const msg = err instanceof Error ? err.message : "Phát hành thất bại.";
      setRowErrors((prev) => ({ ...prev, [id]: msg }));
    },
  });

  const handleApprove = (id: string) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    approveMutation.mutate(id);
  };

  const handlePublish = (id: string) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    publishMutation.mutate(id);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Kỳ lương</h1>
        {/* manage-payroll-period is non-sensitive → safe to use PermissionGate */}
        <PermissionGate action="manage-payroll-period" resourceType="payroll_period">
          <Button size="sm">Tạo kỳ lương</Button>
        </PermissionGate>
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Trạng thái</label>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as PayrollPeriodStatus | "")}
          className="w-44"
        >
          <option value="">Tất cả</option>
          {(Object.keys(PERIOD_STATUS_LABELS) as PayrollPeriodStatus[]).map((s) => (
            <option key={s} value={s}>
              {PERIOD_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải kỳ lương…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được danh sách kỳ lương.</p>}
      {!isLoading && !isError && (
        <PayrollPeriodTable
          rows={rows}
          currentUserId={currentUserId}
          onApprove={handleApprove}
          onPublish={handlePublish}
          errors={rowErrors}
        />
      )}
    </div>
  );
}
