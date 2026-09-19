import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { payrollApi } from "@mediaos/web-core";
import {
  PAYMENT_BATCH_NOTE_MAX,
  paymentBatchEditableStatusEnum,
  type PaymentBatchDto,
  type UpdatePaymentBatchRequest,
} from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { isPayrollStateConflict, parsePayrollError, payrollErrorText } from "../payroll-errors";
import { renderPaymentBatchWarnings } from "../payment-batch-warnings";

/**
 * S15-PAYROLL-FE-7 — sửa ba trường của BẢN THÂN đợt chi trả (PAYROLL-API-069: `status` · `payDate` ·
 * `note`), tách khỏi `PaymentBatchDetailPage` để trang không phình quá ngưỡng đọc được.
 *
 * ⚠️ **Ba trường này đi CHUNG một PATCH** — khác hẳn ba mảng dòng của FE-6 (mỗi mảng một lượt riêng).
 * BE lọc `changedFields = ["status","payDate","note"].filter(k => dto[k] !== undefined)` rồi ghi bằng
 * MỘT câu `updateTx` (`payroll-payment-batches.service.ts:227-246`) ⇒ gộp ba vế là nguyên tử và đúng.
 *
 * ⚠️ **`Completed` KHÔNG BAO GIỜ nằm trong ô chọn trạng thái.** 069 dùng enum RIÊNG
 * `paymentBatchEditableStatusEnum` = `Draft|Ready` (`packages/contracts/src/payroll-disbursement.ts:231`):
 * `Completed` chỉ tới được qua 072 (luật PHỦ + four-eyes + `completed_by/at`), gửi ở đây là 400 và là
 * một đường lách TOÀN BỘ cổng hoàn tất. Danh sách chọn vì vậy sinh THẲNG từ enum của contract, không
 * gõ tay — bảng đổi thì ô chọn đổi theo, không ai chèn tay được giá trị thứ ba vào.
 *
 * ⚠️ **Chỉ gửi trường THẬT SỰ đổi.** Thân rỗng `{}` vẫn qua Zod (mọi trường `.optional()`) và BE vẫn
 * ghi một hàng `audit_logs` `update` với `changedFields: []` ⇒ gửi kèm trường không đổi là bịa một vết
 * audit «đã sửa» và đụng `updated_at` vô cớ. Nút Lưu khoá khi chưa đổi gì.
 *
 * ⚠️ Ô trống ⇒ gửi `null`, KHÔNG phải `""`: `note` là `z.string().trim().max(500)` **không có**
 * `.min(1)` nên chuỗi rỗng là HỢP LỆ và ghi thẳng `''` vào cột — xoá ghi chú phải trả cột về `null`
 * đúng như lúc chưa từng nhập. `payDate` rỗng cũng vậy (cột `pay_date` NULL được).
 *
 * Lỗi chia hai đường, y khuôn `PaymentLineActions`: **tranh chấp trạng thái** (409 — đợt vừa bị người
 * khác hoàn tất) đóng hộp, đẩy chữ ra dải thông báo của TRANG rồi tải lại (hộp sẽ không mở lại được vì
 * `canEditPaymentBatch` hết đúng); mọi lỗi khác ở lại TRONG hộp để người dùng sửa và gửi tiếp.
 */
export interface PaymentBatchEditDialogProps {
  batch: PaymentBatchDto;
  onClose: () => void;
  /** Đặt dải thông báo của trang (dùng chung với 071/072 và thao tác dòng). */
  onFeedback: (feedback: { tone: "ok" | "error"; text: string }) => void;
  /** Tải lại chi tiết + dòng + danh sách đợt (prefix `paymentBatches.allOf()`). */
  onRefresh: () => void;
}

export function PaymentBatchEditDialog({
  batch,
  onClose,
  onFeedback,
  onRefresh,
}: PaymentBatchEditDialogProps) {
  const { t } = useTranslation("payroll");

  // Hộp được cha render CÓ ĐIỀU KIỆN ⇒ mỗi lượt mở là một lượt mount mới, state dưới đây tự lấy lại
  // giá trị đang có của đợt. KHÔNG re-sync theo query khi hộp đang mở: người dùng đang gõ dở
  // (bài học S15-PAYROLL-FE-2 — trang soạn cục bộ không đồng bộ mù theo dữ liệu nền).
  const [status, setStatus] = useState<string>(batch.status);
  const [payDate, setPayDate] = useState<string>(batch.payDate ?? "");
  const [note, setNote] = useState<string>(batch.note ?? "");
  const [errorText, setErrorText] = useState<string | null>(null);

  /**
   * Diff so với đợt đang có. `safeParse` thay cho ép kiểu: đợt `Completed` không mở được hộp này
   * (cổng `canEditPaymentBatch` ở trang cha), nhưng nếu có lọt thì trạng thái KHÔNG được gửi đi —
   * fail-closed, không cast bừa một giá trị mà BE sẽ từ chối.
   */
  const parsedStatus = paymentBatchEditableStatusEnum.safeParse(status);
  const nextStatus = parsedStatus.success ? parsedStatus.data : null;
  const nextPayDate = payDate === "" ? null : payDate;
  const nextNote = note.trim() === "" ? null : note.trim();

  const patch: UpdatePaymentBatchRequest = {
    ...(nextStatus !== null && nextStatus !== batch.status ? { status: nextStatus } : {}),
    ...(nextPayDate !== batch.payDate ? { payDate: nextPayDate } : {}),
    ...(nextNote !== batch.note ? { note: nextNote } : {}),
  };
  const isDirty = Object.keys(patch).length > 0;

  const mutation = useMutation({
    mutationFn: () => payrollApi.updatePaymentBatch(batch.id, patch),
    // Xoá chữ lỗi của lượt TRƯỚC ngay khi bắt đầu lượt mới: để lại thì người vừa sửa xong trường sai
    // bấm Lưu lần hai vẫn đọc đúng câu lỗi cũ suốt lúc chờ, tưởng là lượt mới cũng hỏng.
    onMutate: () => setErrorText(null),
    onSuccess: (result) => {
      onRefresh();
      // D8 — đường này không sinh warning (BE chỉ gán `warnings` ở nhánh `addUserIds`), nhưng mảng
      // server trả về không bị nuốt im lặng nếu luật đó đổi.
      onFeedback({
        tone: "ok",
        text:
          result.warnings.length > 0
            ? renderPaymentBatchWarnings(t, result.warnings)
            : t("paymentBatchEdit.saved"),
      });
      onClose();
    },
    onError: (error) => {
      const info = parsePayrollError(error);
      /**
       * 404 ở đây = **ĐỢT** không còn (`findTx` rỗng — `service.ts:223`), khác hẳn 404 của FE-6
       * (người không còn dòng sống trong đợt) ⇒ chữ riêng, KHÔNG mượn `lineNotFound` của màn dòng.
       * Đè TẠI CHỖ vì `payrollErrorI18nKey` tra theo `kind → code → generic` và KHÔNG đọc `status`:
       * để nguyên thì một đợt vừa bị xoá hiện ra «Có lỗi xảy ra, vui lòng thử lại» — mời người dùng
       * bấm lại mãi. Không thêm `kind` mới (census `PAYROLL_ERROR_KINDS` assert đẳng thức với BE).
       */
      const isGone = info.kind === null && info.status === 404;
      const text = isGone ? t("paymentBatchEdit.batchNotFound") : payrollErrorText(t, info);
      // Đợt đã đổi ở nơi khác (409) hoặc không còn (404): form cục bộ hết nghĩa ⇒ đẩy chữ ra dải
      // thông báo của trang rồi tải lại; trang tự quyết còn cho sửa nữa hay không.
      if (isGone || isPayrollStateConflict(info)) {
        onFeedback({ tone: "error", text });
        onRefresh();
        onClose();
        return;
      }
      setErrorText(text);
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("paymentBatchEdit.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("paymentBatchDetail.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!isDirty || mutation.isPending}
            data-testid="batch-edit-submit"
          >
            {t("paymentBatchEdit.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("paymentBatchEdit.statusLabel")}</span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="batch-edit-status"
          >
            {/* Nguồn = enum của contract ⇒ `Completed` không thể lọt vào danh sách chọn. */}
            {paymentBatchEditableStatusEnum.options.map((s) => (
              <option key={s} value={s}>
                {t(`paymentBatchStatus.${s}`)}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("paymentBatchEdit.statusHint")}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("paymentBatchEdit.payDateLabel")}</span>
          <Input
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            data-testid="batch-edit-pay-date"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("paymentBatchEdit.payDateHint")}
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("paymentBatchEdit.noteLabel")}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={PAYMENT_BATCH_NOTE_MAX}
            data-testid="batch-edit-note"
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("paymentBatchEdit.noteHint")}
          </span>
        </label>

        {errorText && (
          <p className="text-sm text-danger" role="alert" data-testid="batch-edit-error">
            {errorText}
          </p>
        )}
      </div>
    </Dialog>
  );
}
