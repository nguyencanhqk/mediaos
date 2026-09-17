import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  payrollApi,
  payrollIdempotencyKey,
  payrollKeys,
  useAuthStore,
  useCanExact,
} from "@mediaos/web-core";
import type { PayrollPeriodLineDto } from "@mediaos/contracts";
import {
  Button,
  DetailPageHeader,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { triggerBlobDownload } from "@/lib/download-blob";
import { PAYROLL_ENGINE_PAIRS, type PayrollPeriodTab } from "./constants";
import {
  canAdjustLines,
  PERIOD_ACTIONS_NEEDING_REASON,
  type PayrollPeriodAction,
} from "./payroll-actions";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { usePayrollPeople } from "./use-payroll-people";
import { PayrollPeriodStatusBadge } from "./components/StatusBadges";
import { PeriodActionBar } from "./components/PeriodActionBar";
import { ReadinessPanel } from "./components/ReadinessPanel";
import { AdjustLineDialog } from "./components/AdjustLineDialog";
import { AdjustmentImportDialog } from "./components/AdjustmentImportDialog";
import { PeriodPayslipsSection } from "./components/PeriodPayslipsSection";
import { ReasonDialog } from "./components/ReasonDialog";
import { PeriodTimesheetTab } from "./components/PeriodTimesheetTab";
import { PeriodLinesSection } from "./components/PeriodLinesSection";
import { PeriodTemplateBlock } from "./components/PeriodTemplateBlock";

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
 *
 * ── S15-PAYROLL-FE-1 — dải tab «Bảng lương / Bảng công» ─────────────────────────────────────────
 * PAY-SCREEN-008 «Bảng công kỳ» là TAB của màn này (UI-07 §21.8 v1.1a), mỗi tab một route để deep-link:
 * `/payroll/periods/:id` (lines) · `/payroll/periods/:id/timesheet`. `tab` do ROUTER quyết, đổi tab =
 * điều hướng (`onTabChange`) — không giữ state tab trong page để URL luôn nói đúng đang xem gì. Tab
 * «Bảng công» chỉ hiện khi có `view-line` (cùng cặp với 043); route timesheet cũng gate cặp đó.
 */
export function PayrollPeriodDetailPage({
  periodId,
  onBack,
  onOpenPayslip,
  tab = "lines",
  onTabChange,
}: {
  periodId: string;
  onBack: () => void;
  onOpenPayslip: (payslipId: string) => void;
  tab?: PayrollPeriodTab;
  onTabChange: (tab: PayrollPeriodTab) => void;
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
  // S15-PAYROLL-FE-3 — 076 nạp thu nhập/khấu trừ khác cho CHÍNH kỳ này (route `payroll-periods/:id/
  // import-adjustments`), nên lối vào sống ở màn chi tiết kỳ chứ không phải màn danh sách. Cặp gác là
  // cặp CŨ `manage:bonus-penalty` — 076/077 ghi vào `bonus_penalties`, không cấp cặp mới.
  const canImportAdjustments = useCanExact(
    PAYROLL_ENGINE_PAIRS.importAdjustments.action,
    PAYROLL_ENGINE_PAIRS.importAdjustments.resourceType,
  );

  const [adjustTarget, setAdjustTarget] = useState<PayrollPeriodLineDto | null>(null);
  const [reasonAction, setReasonAction] = useState<PayrollPeriodAction | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const periodQuery = useQuery({
    queryKey: payrollKeys.periods.detail(periodId),
    queryFn: () => payrollApi.getPeriod(periodId),
  });

  const period = periodQuery.data ?? null;

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
      {/* UI-07 §13.7 — màn chi tiết dùng `DetailPageHeader` THAY `PageHeader`: ← · tiêu đề + chip
          trạng thái · dòng phụ · hành động chính · ⋯. «Xuất XLSX» xuống menu `⋯` (hành động phụ,
          và nó CHỈ hiện khi có cặp `export:payroll` — menu rỗng thì cả nút `⋯` tự ẩn). */}
      <DetailPageHeader
        onBack={onBack}
        title={t("periodDetail.title", { month: period.periodMonth })}
        status={<PayrollPeriodStatusBadge status={period.status} />}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t("periodDetail.description")}</span>
            {period.payDate && <span>{t("periodDetail.payDate", { date: period.payDate })}</span>}
            {period.note && <span>{period.note}</span>}
          </div>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={periodQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("states.retry")}
          </Button>
        }
        overflowItems={[
          ...(canExport
            ? [
                {
                  key: "export",
                  label: t("periodDetail.export"),
                  onSelect: () => exportMutation.mutate(),
                  disabled: exportMutation.isPending,
                },
              ]
            : []),
          ...(canImportAdjustments
            ? [
                {
                  key: "import-adjustments",
                  label: t("adjustmentImport.title"),
                  onSelect: () => setImportOpen(true),
                },
              ]
            : []),
        ]}
      />

      {/* Chỉ mount khi có cặp ghi — dialog tự nó không phải cổng, nhưng dựng nó cho vai không bao giờ mở
          được là treo một mutation 403 sẵn trong cây. */}
      {canImportAdjustments && (
        <AdjustmentImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          periodId={periodId}
          periodMonth={period.periodMonth}
        />
      )}

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

      <PeriodTemplateBlock period={period} onChanged={() => void refreshAll()} />

      <ReadinessPanel periodId={periodId} />

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PayrollPeriodTab)}>
        <TabsList>
          <TabsTrigger value="lines">{t("periodTabs.lines")}</TabsTrigger>
          {canViewLines && <TabsTrigger value="timesheet">{t("periodTabs.timesheet")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="timesheet" className="space-y-4 pt-4">
          <PeriodTimesheetTab period={period} people={people} />
        </TabsContent>

        <TabsContent value="lines" className="space-y-6 pt-4">
          <PeriodLinesSection
            period={period}
            people={people}
            canViewLines={canViewLines}
            active={tab === "lines"}
            adjustable={adjustable}
            onAdjust={setAdjustTarget}
          />

          {period.payslipsGeneratedAt !== null && (
            <PeriodPayslipsSection
              periodId={periodId}
              people={people}
              onOpenPayslip={onOpenPayslip}
            />
          )}
        </TabsContent>
      </Tabs>

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
