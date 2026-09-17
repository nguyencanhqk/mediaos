import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useAuthStore, useCanExact } from "@mediaos/web-core";
import type { PaymentLineDto } from "@mediaos/contracts";
import {
  Button,
  Checkbox,
  DataTable,
  DetailPageHeader,
  EmptyState,
  TableFooter,
} from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { triggerBlobDownload } from "@/lib/download-blob";
import { PAYROLL_ENGINE_PAIRS, PAYROLL_PAGE_SIZE } from "./constants";
import { canCompletePaymentBatch, paymentBatchHasUnpaidLines } from "./payroll-actions";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PaymentBatchStatusBadge } from "./components/StatusBadges";

/**
 * PAY-SCREEN-013 (S15-PAYROLL-FE-3) — chi tiết đợt chi trả: dòng chi (070) · xuất tệp UNC (071) ·
 * hoàn tất (072).
 *
 * ── QUAN TRỌNG NHẤT Ở MÀN NÀY: 070 GHI `audit_logs` MỖI LƯỢT ĐỌC (SPEC-11 §18.1 B) ─────────────────
 * `linesQuery` chỉ được `enabled` khi (a) người gọi CÓ cặp `view:payment-batch` (`canViewLines`) VÀ
 * (b) khối «Dòng chi trả» THẬT SỰ đang hiển thị cho người dùng — tức đợt đã tải xong
 * (`batchQuery.isSuccess`), không phải lúc trang còn ở khung xương/skeleton hay đã rơi vào trạng thái
 * lỗi (khi đó khối dòng chi không được render, chỉ có `EmptyState`). Bẫy đã ăn ở FE-1: một khối ẨN vẫn
 * gọi query của khối cha ⇒ một hàng audit «đã xem tiền» không hề xảy ra. Nếu sau này màn này tách
 * dòng chi ra tab/accordion gấp lại được, điều kiện `enabled` PHẢI cộng thêm cờ "tab/khối đang mở".
 *
 * ⚠️ Nút xuất tệp UNC (071) đòi ĐỦ BA cặp quyền (D5): `manage:payment-batch` (batchExport) +
 * `export:payroll` (periodExport) + `view-payslip:payslip` (payslipList) — thiếu một trong ba là mời
 * người dùng ăn 403 ở BE.
 *
 * ⚠️ Nút «Hoàn tất» (072) ẩn theo FSM ∩ quyền ∩ four-eyes (D7 `canCompletePaymentBatch`) — KHÔNG ẩn khi
 * còn dòng chưa chi (D8): hộp xác nhận hiện thêm ô «Xác nhận đã chi tất cả» cho ca đó, đặt qua khe
 * `children` của `ConfirmDialog` (thêm ở S15-PAYROLL-DEBT-1).
 */
export function PaymentBatchDetailPage({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const people = usePayrollPeople();

  const canManageBatch = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchComplete.action,
    PAYROLL_ENGINE_PAIRS.batchComplete.resourceType,
  );
  const canViewLines = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchLines.action,
    PAYROLL_ENGINE_PAIRS.batchLines.resourceType,
  );
  const canBatchExport = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchExport.action,
    PAYROLL_ENGINE_PAIRS.batchExport.resourceType,
  );
  const canPeriodExport = useCanExact(
    PAYROLL_ENGINE_PAIRS.periodExport.action,
    PAYROLL_ENGINE_PAIRS.periodExport.resourceType,
  );
  const canPayslipView = useCanExact(
    PAYROLL_ENGINE_PAIRS.payslipList.action,
    PAYROLL_ENGINE_PAIRS.payslipList.resourceType,
  );
  // D5 — nút UNC đòi ĐỦ BA cặp, thiếu một là mời người dùng ăn 403 ở BE.
  const canExportUnc = canBatchExport && canPeriodExport && canPayslipView;

  const [linePage, setLinePage] = useState(1);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [confirmAllPaid, setConfirmAllPaid] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const batchQuery = useQuery({
    queryKey: payrollKeys.paymentBatches.detail(batchId),
    queryFn: () => payrollApi.getPaymentBatch(batchId),
  });

  const lineParams = useMemo(() => ({ page: linePage, per_page: PAYROLL_PAGE_SIZE }), [linePage]);
  const linesQuery = useQuery({
    queryKey: payrollKeys.paymentBatches.lines(batchId, lineParams),
    queryFn: () => payrollApi.listPaymentLines(batchId, lineParams),
    // Xem docblock đầu file: audit MỖI LƯỢT ⇒ chỉ tải khi CÓ quyền và khối dòng chi THẬT SỰ hiển thị
    // (đợt đã tải xong, không phải lúc còn loading/error).
    enabled: canViewLines && batchQuery.isSuccess,
  });

  const batch = batchQuery.data ?? null;
  const lines = linesQuery.data?.data ?? [];
  const lineTotal = linesQuery.data?.pagination?.total;

  const refreshAll = () =>
    queryClient.invalidateQueries({ queryKey: payrollKeys.paymentBatches.allOf() });

  const exportMutation = useMutation({
    mutationFn: () => payrollApi.exportPaymentBatch(batchId),
    onSuccess: (res) => {
      triggerBlobDownload(res.blob, res.filename ?? `unc-${batch?.code ?? batchId}.xlsx`);
    },
    onError: (error) =>
      setFeedback({ tone: "error", text: t(payrollErrorI18nKey(parsePayrollError(error))) }),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      payrollApi.completePaymentBatch(batchId, confirmAllPaid ? { confirmAllPaid: true } : {}),
    onSuccess: (result) => {
      setCompleteOpen(false);
      setConfirmAllPaid(false);
      void refreshAll();
      // `periodStatus === "Published"` KHÔNG phải lỗi — luật PHỦ (D-8 của plan): kỳ chỉ chuyển `Paid`
      // khi lượt hoàn tất này làm phủ đủ mọi đợt của kỳ.
      setFeedback({
        tone: "ok",
        text:
          result.periodStatus === "Paid"
            ? t("paymentBatchDetail.periodNowPaid")
            : t("paymentBatchDetail.periodStillPublished", { count: result.unpaidPayees }),
      });
    },
    onError: (error) => {
      const info = parsePayrollError(error);
      setFeedback({ tone: "error", text: t(payrollErrorI18nKey(info)) });
      if (isPayrollStateConflict(info)) void refreshAll();
    },
  });

  const columns = useMemo<ColumnDef<PaymentLineDto>[]>(
    () => [
      {
        id: "user",
        header: t("paymentBatchDetail.columns.employee"),
        cell: ({ row }) => displayUserRef(row.original.userId, people),
      },
      {
        id: "net",
        header: t("paymentBatchDetail.columns.net"),
        cell: ({ row }) => (
          <span className={PAYROLL_NUMERIC_CELL_CLASS}>{formatPayrollMoney(row.original.net)}</span>
        ),
      },
      {
        id: "bankAccount",
        header: t("paymentBatchDetail.columns.bankAccount"),
        // 🔴 Số tài khoản ĐẦY ĐỦ KHÔNG BAO GIỜ có trong DTO — chỉ 4 số cuối (§18.1 A). Đường DUY NHẤT
        // số đầy đủ rời server là tệp UNC (071), không phải màn hình này.
        cell: ({ row }) =>
          row.original.bankAccountLast4 ? `•••• ${row.original.bankAccountLast4}` : "—",
      },
      {
        id: "bankName",
        header: t("paymentBatchDetail.columns.bankName"),
        cell: ({ row }) => row.original.bankName ?? "—",
      },
      {
        id: "accountHolder",
        header: t("paymentBatchDetail.columns.accountHolder"),
        cell: ({ row }) => row.original.accountHolder ?? "—",
      },
      {
        id: "paidAt",
        header: t("paymentBatchDetail.columns.paidAt"),
        cell: ({ row }) => row.original.paidAt ?? "—",
      },
    ],
    [t, people],
  );

  if (batchQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("states.loading")}</div>;
  }
  if (batchQuery.isError || batch === null) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void batchQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  const canComplete = canCompletePaymentBatch(batch, canManageBatch, currentUserId);
  const hasUnpaid = paymentBatchHasUnpaidLines(batch);
  const unpaidCount = batch.lineCount - batch.paidLineCount;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        onBack={onBack}
        backLabel={t("paymentBatchDetail.back")}
        title={batch.code}
        status={<PaymentBatchStatusBadge status={batch.status} />}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t(`paymentBatchMethod.${batch.method}`)}</span>
            {batch.payDate && <span>{batch.payDate}</span>}
          </div>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={batchQuery.isFetching || linesQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("states.retry")}
          </Button>
        }
        overflowItems={
          canExportUnc
            ? [
                {
                  key: "export",
                  label: t("paymentBatchDetail.export"),
                  onSelect: () => exportMutation.mutate(),
                  disabled: exportMutation.isPending,
                },
              ]
            : []
        }
      />

      {/* D5 — nút xuất ẩn khi thiếu MỘT TRONG BA cặp; câu này giải thích lý do thay vì để người dùng
          đoán tại sao menu ⋯ rỗng. */}
      {!canExportUnc && (
        <p className="text-sm text-muted-foreground">
          {t("paymentBatchDetail.exportNoPermission")}
        </p>
      )}

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

      {canComplete && (
        <div>
          <Button size="sm" onClick={() => setCompleteOpen(true)}>
            {t("paymentBatchDetail.complete")}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("paymentBatchDetail.linesTitle")}
        </h2>
        {!canViewLines ? (
          <EmptyState title={t("paymentBatchDetail.linesNoPermission")} />
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
            <DataTable
              columns={columns}
              data={lines}
              isLoading={linesQuery.isLoading}
              pageSize={PAYROLL_PAGE_SIZE}
              pinFirstColumn
              emptyState={<EmptyState title={t("paymentBatchDetail.linesEmpty")} />}
              footer={
                <TableFooter
                  page={linePage}
                  pageSize={PAYROLL_PAGE_SIZE}
                  total={lineTotal}
                  disabled={linesQuery.isFetching}
                  onPageChange={setLinePage}
                />
              }
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={completeOpen}
        title={t("paymentBatchDetail.completeTitle")}
        description={t("paymentBatchDetail.completeDescription")}
        confirmLabel={t("paymentBatchDetail.completeSubmit")}
        cancelLabel={t("paymentBatchDetail.cancel")}
        busy={completeMutation.isPending}
        onConfirm={() => completeMutation.mutate()}
        onCancel={() => setCompleteOpen(false)}
      >
        {/* D8 — còn dòng chưa chi KHÔNG chặn nút; hộp xác nhận hiện thêm ô tick này thay vào đó. */}
        {hasUnpaid ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirmAllPaid}
              onChange={(e) => setConfirmAllPaid(e.target.checked)}
            />
            <span>{t("paymentBatchDetail.confirmAllPaid", { count: unpaidCount })}</span>
          </label>
        ) : undefined}
      </ConfirmDialog>
    </div>
  );
}
