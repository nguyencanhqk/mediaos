import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { payrollApi } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  isPayrollStateConflict,
  parsePayrollError,
  payrollErrorText,
  type PayrollErrorInfo,
} from "../payroll-errors";
import { renderPaymentBatchWarnings } from "../payment-batch-warnings";

/**
 * S15-PAYROLL-FE-6 — thanh thao tác trên DÒNG của đợt chi trả (PAYROLL-API-069 `markPaidUserIds` ·
 * `removeUserIds`), tách khỏi `PaymentBatchDetailPage` để trang không phình quá ngưỡng đọc được.
 *
 * Cha sở hữu **lựa chọn** (ô tích nằm trong cột của bảng dòng) và **dải thông báo** (dùng chung với
 * 071/072); component này sở hữu **lượt ghi** và **hộp xác nhận**.
 *
 * ⚠️ MỘT mutation cho cả hai thao tác — mỗi PATCH mang ĐÚNG MỘT mảng. BE xử theo thứ tự
 * `status/payDate/note → remove → add → markPaid` trong cùng tx, nên trộn hai mảng là nhận một 409
 * không biết của vế nào.
 *
 * ⚠️ `markPaid` trên dòng đã `paid_at` là **no-op IM LẶNG** ở BE (SQL có `and l.paid_at is null`) và
 * envelope `{id, warnings}` KHÔNG mang số dòng đã đổi ⇒ câu báo thành công của nhánh này KHÔNG được
 * khẳng định số lượng; nó chỉ nói «đã gửi» rồi để bảng đã tải lại tự nói. `remove` thì all-or-nothing
 * (một dòng đã chi ⇒ 409 `line-already-paid`, KHÔNG gỡ dòng nào) nên nêu số người là đúng.
 */
export interface PaymentLineActionsProps {
  batchId: string;
  /** `userId` đang chọn trên trang dòng hiện tại (069 nhận `userId`, không nhận id dòng). */
  selectedUserIds: readonly string[];
  /** Sau MỖI lượt ghi thành công — cha xoá lựa chọn và lùi trang nếu vừa gỡ sạch trang cuối. */
  onWritten: (action: "markPaid" | "remove", count: number) => void;
  /** Đặt dải thông báo của trang. */
  onFeedback: (feedback: { tone: "ok" | "error"; text: string }) => void;
  /** Tải lại chi tiết + dòng + danh sách đợt (prefix `paymentBatches.allOf()`). */
  onRefresh: () => void;
}

export function PaymentLineActions({
  batchId,
  selectedUserIds,
  onWritten,
  onFeedback,
  onRefresh,
}: PaymentLineActionsProps) {
  const { t } = useTranslation("payroll");
  const [action, setAction] = useState<"markPaid" | "remove" | null>(null);
  const count = selectedUserIds.length;

  /**
   * D6 — 404 của 069 nghĩa là «người này không còn dòng sống trong đợt» (bảng đang cũ), KHÔNG phải
   * «không tìm thấy đợt». Đè TẠI CHỖ; sửa `errors.notFound` là đổi chữ 404 của CẢ module PAYROLL.
   */
  const errorText = (info: PayrollErrorInfo): string =>
    info.kind === null && info.status === 404
      ? t("paymentBatchDetail.lineNotFound")
      : payrollErrorText(t, info);

  const mutation = useMutation({
    mutationFn: (vars: { action: "markPaid" | "remove"; userIds: string[] }) =>
      payrollApi.updatePaymentBatch(
        batchId,
        vars.action === "markPaid"
          ? { markPaidUserIds: vars.userIds }
          : { removeUserIds: vars.userIds },
      ),
    onSuccess: (result, vars) => {
      setAction(null);
      onWritten(vars.action, vars.userIds.length);
      onRefresh();
      onFeedback({
        tone: "ok",
        text:
          result.warnings.length > 0
            ? renderPaymentBatchWarnings(t, result.warnings)
            : vars.action === "markPaid"
              ? t("paymentBatchDetail.markPaidDone")
              : t("paymentBatchDetail.removeDone", { count: vars.userIds.length }),
      });
    },
    onError: (error) => {
      const info = parsePayrollError(error);
      onFeedback({ tone: "error", text: errorText(info) });
      // 404 cũng là «bảng đang cũ» ⇒ tải lại, y như nhánh tranh chấp trạng thái.
      if (isPayrollStateConflict(info) || info.status === 404) onRefresh();
    },
  });

  return (
    <>
      {/* D4 — nút khoá khi chưa chọn ai: mảng rỗng là 400 `VALIDATION-ERR-001` KHÔNG mang `kind`
          (contracts `.min(1)`) ⇒ người dùng chỉ thấy «Đã có lỗi xảy ra». */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" data-testid="lines-selected-count">
          {t("paymentBatchDetail.selectedCount", { count })}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={count === 0 || mutation.isPending}
          onClick={() => setAction("markPaid")}
          data-testid="lines-mark-paid"
        >
          {t("paymentBatchDetail.markPaid")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={count === 0 || mutation.isPending}
          onClick={() => setAction("remove")}
          data-testid="lines-remove"
        >
          {t("paymentBatchDetail.removeLines")}
        </Button>
      </div>

      {/* D8 — xác nhận nêu SỐ NGƯỜI, KHÔNG nêu số tiền và không log gì (BẤT BIẾN #3). */}
      <ConfirmDialog
        open={action === "markPaid"}
        title={t("paymentBatchDetail.markPaidTitle")}
        description={t("paymentBatchDetail.markPaidDescription", { count })}
        confirmLabel={t("paymentBatchDetail.markPaid")}
        cancelLabel={t("paymentBatchDetail.cancel")}
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate({ action: "markPaid", userIds: [...selectedUserIds] })}
        onCancel={() => setAction(null)}
      />

      <ConfirmDialog
        open={action === "remove"}
        title={t("paymentBatchDetail.removeTitle")}
        description={t("paymentBatchDetail.removeDescription", { count })}
        confirmLabel={t("paymentBatchDetail.removeLines")}
        cancelLabel={t("paymentBatchDetail.cancel")}
        destructive
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate({ action: "remove", userIds: [...selectedUserIds] })}
        onCancel={() => setAction(null)}
      />
    </>
  );
}
