import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { payrollPeriodApi } from "@/lib/payroll-period-api";
import { PermissionGate } from "@/components/permission-gate";
import { PayrollPeriodTable } from "@/components/payroll/payroll-period-table";
import { PageHeader } from "@/components/layout/page-header";
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
 *
 * Redesign (Phase 2): chuẩn hoá chrome (PageHeader + toolbar + loading/error) theo house style
 * MISA/Funtime. KHÔNG đổi data/permission/FSM/SoD — giữ nguyên hook query/mutation, PermissionGate,
 * currentUserId, và component bảng (FSM button + SoD do bảng đảm nhận, server là chốt chặn thật).
 */
export function PayrollPeriodsPage() {
  const { t } = useTranslation("payroll");
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
      const msg = err instanceof Error ? err.message : t("periods.approveError");
      setRowErrors((prev) => ({ ...prev, [id]: msg }));
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => payrollPeriodApi.publish(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
    onError: (err, id) => {
      const msg = err instanceof Error ? err.message : t("periods.publishError");
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
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("periods.pageTitle")}
        description={t("periods.pageDescription")}
        icon={CalendarClock}
        actions={
          // manage-payroll-period is non-sensitive → safe to use PermissionGate
          <PermissionGate action="manage-payroll-period" resourceType="payroll_period">
            {/* Tạo kỳ lương: luồng create chưa nối ở lane này (defer) — disable để không no-op im lặng. */}
            <Button size="sm" disabled title={t("periods.createButtonSoon")}>
              {t("periods.createButton")}
            </Button>
          </PermissionGate>
        }
      >
        <div className="space-y-1">
          <label
            htmlFor="period-status-filter"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("periods.filterStatus")}
          </label>
          <Select
            id="period-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as PayrollPeriodStatus | "")}
            className="w-44"
          >
            <option value="">{t("periods.all")}</option>
            {(Object.keys(PERIOD_STATUS_LABELS) as PayrollPeriodStatus[]).map((s) => (
              <option key={s} value={s}>
                {PERIOD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      {isLoading && <p className="text-sm text-muted-foreground">{t("periods.loading")}</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("periods.loadFailed")}
        </p>
      )}
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
