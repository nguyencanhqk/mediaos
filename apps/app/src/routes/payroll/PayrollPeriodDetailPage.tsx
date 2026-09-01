import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import {
  payrollApi,
  payrollIdempotencyKey,
  payrollKeys,
  useAuthStore,
  useCanExact,
} from "@mediaos/web-core";
import type { PayrollPeriodLineDto } from "@mediaos/contracts";
import { Button, DataTable, EmptyState, PageHeader } from "@mediaos/ui";
import { triggerBlobDownload } from "../attendance/download-blob";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import {
  canAdjustLines,
  PERIOD_ACTIONS_NEEDING_REASON,
  type PayrollPeriodAction,
} from "./payroll-actions";
import {
  formatPayrollDays,
  formatPayrollMinutes,
  formatPayrollMoney,
  formatPayrollSignedMoney,
  isPayrollMoneyMasked,
  PAYROLL_NUMERIC_CELL_CLASS,
} from "./payroll-format";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PayrollPeriodStatusBadge } from "./components/StatusBadges";
import { PeriodActionBar } from "./components/PeriodActionBar";
import { ReadinessPanel } from "./components/ReadinessPanel";
import { AdjustLineDialog } from "./components/AdjustLineDialog";
import { PeriodPayslipsSection } from "./components/PeriodPayslipsSection";
import { ReasonDialog } from "./components/ReasonDialog";

/**
 * PAY-SCREEN-002 (S13-PAYROLL-FE-1) — chi tiết kỳ lương: bảng lương theo nhân sự + thanh hành động FSM
 * + hộp cảnh báo dữ liệu thiếu + export XLSX.
 *
 * ── BA ĐIỀU DỄ LÀM SAI Ở MÀN NÀY ──────────────────────────────────────────────────────────────────
 *
 * **1. Bảng lương và trang kỳ gác bằng HAI cặp KHÁC NHAU.** Trang mở bằng `('view','payroll-period')`
 * (không nhạy cảm); bảng dòng cần `('view-line','payroll-period')` (**SENSITIVE**, cặp ĐỌC tiền). Đó
 * là quyết định thiết kế #3 của DOC-1: gộp lại thì người chỉ có `approve` phải **duyệt mù**, còn route
 * GHI (`calculate`) buộc phải chở tiền. Nên `enabled` của query dòng theo `useCanExact(view-line)`, và
 * thiếu cặp đó thì hiện khối «không có quyền xem bảng lương» chứ KHÔNG phải trang trắng hay 403 câm.
 *
 * **2. Mọi route GHI trả `PayrollWriteResultDto` — 0 khoá tiền.** Sau mỗi hành động phải invalidate
 * `periods.allOf()` (kỳ + dòng + readiness + summary cùng đổi) rồi ĐỌC LẠI; đừng vá tại chỗ từ kết quả
 * mutation, ở đó không có số.
 *
 * **3. 409 tranh chấp trạng thái ⇒ TẢI LẠI, không chỉ toast** (SPEC-11 §14). Kỳ có thể vừa bị người
 * khác duyệt/từ chối; giữ nguyên màn cũ là để người dùng bấm lại và ăn đúng lỗi đó lần nữa.
 */
export function PayrollPeriodDetailPage({
  periodId,
  onBack,
  onOpenPayslip,
}: {
  periodId: string;
  onBack: () => void;
  onOpenPayslip: (payslipId: string) => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const people = usePayrollPeople();

  const canViewLines = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodLines.action,
    PAYROLL_ENGINE_PAIRS.periodLines.resourceType,
  );
  const canAdjust = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodAdjustLine.action,
    PAYROLL_ENGINE_PAIRS.periodAdjustLine.resourceType,
  );
  const canExportPair = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodExport.action,
    PAYROLL_ENGINE_PAIRS.periodExport.resourceType,
  );
  // §18: export đòi CẢ HAI cặp. Hiện nút khi chỉ có `export:payroll` là mời người dùng ăn 403.
  const canExport = canExportPair && canViewLines;

  const [linePage, setLinePage] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<PayrollPeriodLineDto | null>(null);
  const [reasonAction, setReasonAction] = useState<PayrollPeriodAction | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const periodQuery = useQuery({
    queryKey: payrollKeys.periods.detail(periodId),
    queryFn: () => payrollApi.getPeriod(periodId),
  });

  const lineParams = useMemo(() => ({ page: linePage, per_page: PAYROLL_PAGE_SIZE }), [linePage]);
  const linesQuery = useQuery({
    queryKey: payrollKeys.periods.lines(periodId, lineParams),
    queryFn: () => payrollApi.listLines(periodId, lineParams),
    enabled: canViewLines,
  });

  const period = periodQuery.data ?? null;
  const lines = linesQuery.data?.data ?? [];
  const lineTotal = linesQuery.data?.pagination?.total ?? lines.length;
  const lineLastPage = Math.max(1, Math.ceil(lineTotal / PAYROLL_PAGE_SIZE));
  const moneyMasked = lines.length > 0 && lines.every((l) => isPayrollMoneyMasked(l));

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: payrollKeys.periods.allOf() });

  const actionMutation = useMutation({
    mutationFn: async (input: { action: PayrollPeriodAction; reason?: string }) => {
      const { action, reason } = input;
      // Khoá idempotency neo theo KỲ + mốc `updatedAt` đang thấy: bấm đúp là một lần chạy; còn tính lại
      // CỐ Ý sau khi sửa dữ liệu thì `updatedAt` đã khác ⇒ khoá khác ⇒ chạy thật.
      const salt = period?.updatedAt ?? null;
      switch (action) {
        case "collect":
          return payrollApi.collectPeriod(periodId);
        case "calculate":
          return payrollApi.calculatePeriod(
            periodId,
            payrollIdempotencyKey("calculate", periodId, salt),
          );
        case "submit":
          return payrollApi.submitPeriod(periodId);
        case "approve":
          return payrollApi.approvePeriod(periodId);
        case "reject":
          return payrollApi.rejectPeriod(periodId, { reason: reason ?? "" });
        case "generate-payslips":
          return payrollApi.generatePayslips(
            periodId,
            payrollIdempotencyKey("generate-payslips", periodId, salt),
          );
        case "publish":
          return payrollApi.publishPeriod(periodId);
        case "lock":
          return payrollApi.lockPeriod(periodId);
        case "reopen":
          return payrollApi.reopenPeriod(periodId, { reason: reason ?? "" });
      }
    },
    onSuccess: (result, input) => {
      void refreshAll();
      setReasonAction(null);
      setFeedback({
        tone: "ok",
        // `warnings` của route GHI là mảng CHUỖI tóm tắt (khác hình dạng với readiness) — hiện nguyên văn
        // để băng «N dòng có điều chỉnh tay được giữ lại» sau khi tính lại không biến mất (SPEC-11 §14).
        text:
          result && result.warnings.length > 0
            ? result.warnings.join(" · ")
            : t(`actions.done.${input.action}`, { count: result?.affectedLines ?? 0 }),
      });
    },
    onError: (error) => {
      const info = parsePayrollError(error);
      setFeedback({ tone: "error", text: t(payrollErrorI18nKey(info)) });
      if (isPayrollStateConflict(info)) void refreshAll();
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => payrollApi.exportPeriod(periodId),
    onSuccess: (res) => {
      triggerBlobDownload(
        res.blob,
        res.filename ?? `payroll-${period?.periodMonth ?? periodId}.xlsx`,
      );
    },
    onError: (error) =>
      setFeedback({ tone: "error", text: t(payrollErrorI18nKey(parsePayrollError(error))) }),
  });

  const runAction = (action: PayrollPeriodAction) => {
    setFeedback(null);
    if (PERIOD_ACTIONS_NEEDING_REASON.has(action)) {
      setReasonAction(action);
      return;
    }
    actionMutation.mutate({ action });
  };

  const columns = useMemo<ColumnDef<PayrollPeriodLineDto>[]>(
    () => [
      {
        id: "user",
        header: t("lines.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      {
        id: "days",
        header: t("lines.columns.days"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollDays(row.original.presentDays)} /{" "}
            {formatPayrollDays(row.original.workDays)}
          </span>
        ),
      },
      {
        id: "unpaid",
        header: t("lines.columns.unpaidLeave"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollDays(row.original.unpaidLeaveDays)}
          </span>
        ),
      },
      {
        id: "late",
        header: t("lines.columns.lateMinutes"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMinutes(row.original.lateMinutes)}
          </span>
        ),
      },
      {
        id: "gross",
        header: t("lines.columns.gross"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.gross)}
          </span>
        ),
      },
      {
        id: "deduction",
        header: t("lines.columns.deduction"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollMoney(row.original.deductionAmount)}
          </span>
        ),
      },
      {
        id: "adjustment",
        header: t("lines.columns.adjustment"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>
            {formatPayrollSignedMoney(row.original.adjustmentAmount)}
          </span>
        ),
      },
      {
        id: "net",
        header: t("lines.columns.net"),
        cell: ({ row }) => (
          <span className={`${PAYROLL_NUMERIC_CELL_CLASS} font-medium`}>
            {formatPayrollMoney(row.original.net)}
          </span>
        ),
      },
    ],
    [t, people],
  );

  if (periodQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("states.loading")}</div>;
  }
  if (periodQuery.isError || period === null) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void periodQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  const adjustable = canAdjustLines(period, canAdjust);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("periodDetail.title", { month: period.periodMonth })}
        description={t("periodDetail.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-2 size-4" />
              {t("actions.back")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={periodQuery.isFetching || linesQuery.isFetching}
            >
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                <Download className="mr-2 size-4" />
                {t("periodDetail.export")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <PayrollPeriodStatusBadge status={period.status} />
        {period.payDate && (
          <span className="text-sm text-muted-foreground">
            {t("periodDetail.payDate", { date: period.payDate })}
          </span>
        )}
        {period.note && <span className="text-sm text-muted-foreground">{period.note}</span>}
      </div>

      <PeriodActionBar
        period={period}
        currentUserId={currentUserId}
        pendingAction={actionMutation.isPending ? (actionMutation.variables?.action ?? null) : null}
        onAction={runAction}
      />

      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.tone === "ok"
              ? "border-success/40 bg-success-muted/40"
              : "border-danger/40 bg-danger-muted/40"
          }`}
          role="status"
        >
          {feedback.text}
        </div>
      )}

      <ReadinessPanel periodId={periodId} />

      {!canViewLines ? (
        <EmptyState title={t("lines.noPermission")} />
      ) : linesQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void linesQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : (
        <>
          {moneyMasked && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              {t("lines.moneyMasked")}
            </div>
          )}
          <DataTable
            columns={columns}
            data={lines}
            isLoading={linesQuery.isLoading}
            pageSize={PAYROLL_PAGE_SIZE}
            onRowClick={adjustable ? (row) => setAdjustTarget(row) : undefined}
            emptyState={<EmptyState title={t("lines.empty")} />}
          />
          {lineLastPage > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                {linePage} / {lineLastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={linePage <= 1 || linesQuery.isFetching}
                onClick={() => setLinePage((p) => Math.max(1, p - 1))}
              >
                ‹
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={linePage >= lineLastPage || linesQuery.isFetching}
                onClick={() => setLinePage((p) => Math.min(lineLastPage, p + 1))}
              >
                ›
              </Button>
            </div>
          )}
        </>
      )}

      {period.payslipsGeneratedAt !== null && (
        <PeriodPayslipsSection
          periodId={periodId}
          people={people}
          onOpenPayslip={onOpenPayslip}
        />
      )}

      <AdjustLineDialog
        open={adjustTarget !== null}
        onClose={() => setAdjustTarget(null)}
        periodId={periodId}
        line={adjustTarget}
      />

      <ReasonDialog
        open={reasonAction !== null}
        onClose={() => setReasonAction(null)}
        onSubmit={(reason) => {
          if (reasonAction) actionMutation.mutate({ action: reasonAction, reason });
        }}
        title={reasonAction ? t(`actions.period.${reasonAction}`) : ""}
        description={reasonAction === "reopen" ? t("actions.reopenWarning") : undefined}
        submitLabel={t("actions.confirm")}
        isPending={actionMutation.isPending}
        errorMessage={feedback?.tone === "error" ? feedback.text : null}
      />
    </div>
  );
}
