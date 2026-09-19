import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  canCompletePaymentBatch,
  canEditPaymentBatch,
  paymentBatchHasUnpaidLines,
} from "./payroll-actions";
import { formatPayrollMoney, PAYROLL_NUMERIC_CELL_CLASS } from "./payroll-format";
import { isPayrollStateConflict, parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PaymentBatchStatusBadge } from "./components/StatusBadges";
import { PaymentBatchAddPayeesDialog } from "./components/PaymentBatchAddPayeesDialog";
import { PaymentBatchEditDialog } from "./components/PaymentBatchEditDialog";
import { PaymentLineActions } from "./components/PaymentLineActions";

/** Mảng rỗng DÙNG CHUNG — `?? []` sinh tham chiếu mới mỗi lượt render, làm memo/effect dưới chạy hoài. */
const NO_LINES: PaymentLineDto[] = [];

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
 *
 * ── S15-PAYROLL-FE-6 — THAO TÁC TRÊN DÒNG (069 `markPaidUserIds`/`removeUserIds`/`addUserIds`) ────
 * Ba luật BE quyết định hình dạng UI ở đây, ghi lại để không ai «sửa cho tiện» rồi vỡ:
 *
 *   1. **Đợt `Completed` là chỉ-đọc** (`assertNotCompleted` ⇒ 409 027 `batch-already-completed`) ⇒
 *      không cột chọn, không thanh thao tác, không nút thêm người. `canEditPaymentBatch` lo vế này.
 *   2. **`removeUserIds` ALL-OR-NOTHING**: chỉ một dòng trong lượt đã `paid_at` là CẢ LƯỢT bị từ chối
 *      (409 027 `line-already-paid`, không gỡ dòng nào) ⇒ ô chọn của dòng đã chi phải `disabled`, và
 *      chữ lỗi phải nói rõ «cả lượt bị từ chối» chứ không để người dùng tưởng gỡ được một phần.
 *   3. **`markPaidUserIds` no-op IM LẶNG trên dòng đã chi** (SQL có `and l.paid_at is null` —
 *      `payroll-payment-batches.repository.ts:383-390`) và envelope `{id, warnings}` KHÔNG mang số dòng
 *      đã đổi ⇒ FE **không được khẳng định số lượng** sau lượt gửi; nó `refreshAll()` và để bảng tự nói.
 *
 * ⚠️ Mỗi nút gửi ĐÚNG MỘT mảng trong một PATCH — BE xử theo thứ tự `status/payDate/note → remove → add
 * → markPaid` trong cùng tx, trộn hai mảng là một 409 không biết của vế nào.
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
  // D1 — khoá RIÊNG `batchUpdate` (069) dù giá trị cặp trùng `batchComplete`: census wiring đọc
  // theo KHOÁ để biết màn này có gác đúng route 069 hay không, không đọc theo giá trị.
  const canUpdateBatch = useCanExact(
    PAYROLL_ENGINE_PAIRS.batchUpdate.action,
    PAYROLL_ENGINE_PAIRS.batchUpdate.resourceType,
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
  /** Lựa chọn theo **`userId`** — 069 nhận `userId`, KHÔNG nhận id của dòng. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  /** S15-PAYROLL-FE-7 — hộp sửa `status`/`payDate`/`note` của chính đợt (069, ba vế đi chung một PATCH). */
  const [editOpen, setEditOpen] = useState(false);
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
  const lines = linesQuery.data?.data ?? NO_LINES;
  const lineTotal = linesQuery.data?.pagination?.total;

  // D7 — CỐ Ý không invalidate `payslips`: phiếu không đổi vì lượt này, và mỗi lượt đọc phiếu (029) là
  // một hàng audit tiền. Prefix `allOf()` đã phủ cả nhánh `lines` của đợt.
  const refreshAll = () =>
    queryClient.invalidateQueries({ queryKey: payrollKeys.paymentBatches.allOf() });

  // D2 — thao tác trên dòng cần CẢ hai: quyền ghi 069 ∩ FSM (đợt chưa `Completed`) ∩ quyền đọc dòng
  // (thiếu `view:payment-batch` thì bảng dòng không tải ⇒ không có gì để chọn).
  const canEditBatch = batch !== null && canEditPaymentBatch(batch, canUpdateBatch);
  const canEditLines = canEditBatch && canViewLines;
  // Nút «Thêm người» KHÔNG cần `canViewLines` (không chọn từ bảng dòng) nhưng CẦN cặp đọc phiếu 029.
  const canAddPayees = canEditBatch && canPayslipView;

  /** `userId` của các dòng CHỌN ĐƯỢC trên trang hiện tại — dòng đã `paid_at` không gỡ/đánh dấu lại được. */
  const selectableUserIds = useMemo(
    () => lines.filter((l) => l.paidAt === null).map((l) => l.userId),
    [lines],
  );
  const allPageSelected =
    selectableUserIds.length > 0 && selectableUserIds.every((id) => selected.has(id));
  /** `userId` đã có dòng sống trên TRANG hiện tại — lọc trước cho picker (tiện nghi, không phải cổng). */
  const userIdsOnPage = useMemo(() => new Set(lines.map((l) => l.userId)), [lines]);
  const selectedUserIds = useMemo(() => Array.from(selected), [selected]);

  const toggleOne = useCallback((userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);
  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of selectableUserIds) {
        if (allPageSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [selectableUserIds, allPageSelected]);

  // Giữ `userId` của trang/đợt cũ thì lượt sau gửi lên người không còn dòng ở đây ⇒ 404 cả lượt.
  useEffect(() => {
    setSelected(new Set());
  }, [linePage, batchId]);

  /**
   * 🔴 ĐỐI SOÁT lựa chọn với tập CHỌN-ĐƯỢC sau mỗi lượt tải lại — KHÔNG có bước này thì một lượt 409
   * là cụt đường vĩnh viễn: người khác vừa đánh dấu đã chi (hoặc gỡ) một dòng ta đang chọn ⇒ nhánh lỗi
   * `refreshAll()` nhưng `userId` đó NẰM LẠI trong `selected`; ô tích của nó giờ `disabled` nên không
   * bỏ chọn tay được, «chọn cả trang» cũng chỉ duyệt dòng chưa chi nên không với tới. Mọi lượt gửi sau
   * đều kéo theo id chết ⇒ `removeUserIds` (all-or-nothing) hỏng CẢ nhóm, mãi tới khi người dùng đổi
   * trang hoặc rời màn. Trả lại `prev` khi không đổi để React bỏ qua lượt render thừa.
   */
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(selectableUserIds);
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableUserIds]);

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
      // D3 — `DataTable` KHÔNG có row-selection sẵn ⇒ cột chọn tự vẽ, chỉ mọc khi được sửa dòng.
      // ⚠️ `selected`/`toggle*` PHẢI nằm trong deps của memo này, nếu không ô tích đứng im vì closure
      // cũ (lint KHÔNG bắt lỗi này vì deps vẫn "đủ" theo mắt nó).
      ...(canEditLines
        ? [
            {
              id: "select",
              header: () => (
                <Checkbox
                  checked={allPageSelected}
                  disabled={selectableUserIds.length === 0}
                  onChange={toggleAllOnPage}
                  aria-label={t("paymentBatchDetail.selectAllPage")}
                  data-testid="line-select-page"
                />
              ),
              cell: ({ row }) => {
                // Dòng đã chi: không gỡ được (409 `line-already-paid` cho CẢ lượt) và đánh dấu lại là
                // no-op im lặng ⇒ khoá ô tích thay vì để người dùng chọn rồi ăn lỗi cả nhóm.
                const paid = row.original.paidAt !== null;
                return (
                  <Checkbox
                    checked={selected.has(row.original.userId)}
                    disabled={paid}
                    onChange={() => toggleOne(row.original.userId)}
                    aria-label={displayUserRef(row.original.userId, people)}
                    data-testid={`line-select-${row.original.userId}`}
                  />
                );
              },
            } satisfies ColumnDef<PaymentLineDto>,
          ]
        : []),
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
    [
      t,
      people,
      canEditLines,
      selected,
      allPageSelected,
      selectableUserIds,
      toggleAllOnPage,
      toggleOne,
    ],
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
        // Menu ⋯ tự ẩn khi mảng rỗng ⇒ người không có quyền nào trong hai quyền này không thấy cả nút.
        overflowItems={[
          // FE-7 — sửa đầu đợt CHỈ cần `manage:payment-batch` ∩ đợt chưa `Completed`: nó không đọc
          // dòng chi (`view:payment-batch`) và không đụng phiếu (029) nên không kéo theo hàng audit nào.
          ...(canEditBatch
            ? [
                {
                  key: "edit",
                  label: t("paymentBatchDetail.edit"),
                  onSelect: () => setEditOpen(true),
                },
              ]
            : []),
          ...(canExportUnc
            ? [
                {
                  key: "export",
                  label: t("paymentBatchDetail.export"),
                  onSelect: () => exportMutation.mutate(),
                  disabled: exportMutation.isPending,
                },
              ]
            : []),
        ]}
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

      {(canComplete || canAddPayees) && (
        <div className="flex flex-wrap items-center gap-2">
          {canComplete && (
            <Button size="sm" onClick={() => setCompleteOpen(true)}>
              {t("paymentBatchDetail.complete")}
            </Button>
          )}
          {canAddPayees && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
              data-testid="lines-add-payees"
            >
              {t("paymentBatchDetail.addPayees")}
            </Button>
          )}
        </div>
      )}

      {/* Thiếu `view-payslip:payslip` ⇒ nút «Thêm người» ẩn (picker lấy ứng viên từ 029) — nói lý do
          thay vì để người có quyền sửa đợt tự hỏi vì sao thiếu nút. */}
      {canEditBatch && !canPayslipView && (
        <p className="text-sm text-muted-foreground">
          {t("paymentBatchDetail.addPayeesNoPermission")}
        </p>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("paymentBatchDetail.linesTitle")}
        </h2>

        {canEditLines && (
          <PaymentLineActions
            batchId={batchId}
            selectedUserIds={selectedUserIds}
            onFeedback={setFeedback}
            onRefresh={() => void refreshAll()}
            onWritten={(action, count) => {
              setSelected(new Set());
              // Gỡ sạch dòng của trang cuối ⇒ trang đó biến mất; đứng lại đó là bảng rỗng vĩnh viễn.
              // So với `lines.length` (CẢ dòng đã chi) chứ KHÔNG phải `selectableUserIds.length`:
              // `count` không bao giờ vượt số dòng chưa chi, nên điều kiện chỉ đúng khi trang không
              // còn dòng đã chi nào và vừa bị gỡ hết — tức trang thật sự rỗng. Đổi sang tập chọn-được
              // là lùi trang oan mỗi khi trang còn dòng đã chi ở lại.
              if (action === "remove" && linePage > 1 && count >= lines.length) {
                setLinePage((p) => Math.max(1, p - 1));
              }
            }}
          />
        )}

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

      {/* FE-7 — render CÓ ĐIỀU KIỆN: mỗi lượt mở là một lượt mount mới ⇒ form lấy lại giá trị đang có
          của đợt mà không cần effect đồng bộ. `canEditBatch` nằm trong điều kiện nên nếu lượt tải lại
          cho thấy đợt vừa bị người khác hoàn tất thì hộp tự biến mất thay vì cho gõ rồi ăn 409. */}
      {editOpen && canEditBatch && (
        <PaymentBatchEditDialog
          batch={batch}
          onClose={() => setEditOpen(false)}
          onFeedback={setFeedback}
          onRefresh={() => void refreshAll()}
        />
      )}

      {/* Render CÓ ĐIỀU KIỆN: 029 ghi một hàng audit mỗi lượt gọi ⇒ hộp đóng thì hook trong đó không
          chạy và server không hề bị hỏi (xem docblock của dialog). */}
      {addOpen && canAddPayees && (
        <PaymentBatchAddPayeesDialog
          batchId={batchId}
          payrollPeriodId={batch.payrollPeriodId}
          existingUserIds={userIdsOnPage}
          people={people}
          onClose={() => setAddOpen(false)}
          onAdded={() => void refreshAll()}
        />
      )}
    </div>
  );
}
