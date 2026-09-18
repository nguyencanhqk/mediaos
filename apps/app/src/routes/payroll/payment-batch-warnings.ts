/**
 * S15-PAYROLL-FE-6 — diễn dịch `warnings` của kết quả ghi đợt chi trả (`PaymentBatchWriteResultDto`)
 * thành câu tiếng Việt. Dùng chung cho **067 lập đợt** (`PaymentBatchFormDialog`) và **069 sửa đợt**
 * (`PaymentBatchDetailPage` — thêm người · gỡ dòng · đánh dấu đã chi).
 *
 * Trước WO này hàm sống như closure cục bộ trong `PaymentBatchFormDialog.tsx`; 069 trả **cùng
 * envelope** `{ id, warnings }` nên chép lần hai là bảo đảm hai bản trôi khỏi nhau ngay lần BE thêm
 * slug mới.
 *
 * ⚠️ `warnings` là **SỐ ĐẾM**, KHÔNG phải tiền — hai hình dạng: `<slug>:<n>` (`no-bank-account:3` ·
 * `zero-net:2`) và chuỗi bare `no-eligible-payees`. Slug lạ (BE thêm mà FE chưa biết) ⇒ trả NGUYÊN
 * chuỗi thay vì nuốt: người dùng thấy một chuỗi kỹ thuật còn hơn là mất hẳn cảnh báo.
 */
import type { PayrollTranslate } from "./payroll-errors";

export function renderPaymentBatchWarning(t: PayrollTranslate, warning: string): string {
  if (warning === "no-eligible-payees") return t("paymentBatchForm.noEligiblePayees");
  const [slug, countRaw] = warning.split(":");
  const count = Number(countRaw ?? 0);
  if (slug === "no-bank-account") return t("paymentBatchForm.noBankAccount", { count });
  if (slug === "zero-net") return t("paymentBatchForm.zeroNet", { count });
  return warning;
}

/** Gộp nhiều cảnh báo thành MỘT câu (dùng ở chỗ chỉ có một khe chữ, vd dải feedback của 069). */
export function renderPaymentBatchWarnings(
  t: PayrollTranslate,
  warnings: readonly string[],
): string {
  return warnings.map((w) => renderPaymentBatchWarning(t, w)).join(" · ");
}
