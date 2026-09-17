import { z } from "zod";

/**
 * MediaOS — PAYROLL v2 track D phần 2 (S15-PAYROLL-BE-5B · SPEC-11 §15.1 hàng 083–085 · PAY-DEC-019 ·
 * DECISIONS-14 §4): PDF phiếu lương.
 *
 * Luật chung:
 *  1. PDF sinh từ SNAPSHOT (`payslips` + `payslip_items`) — không tính lại.
 *  2. Tệp nằm TẠM trên object storage (`files.is_temporary`) và chỉ giao qua **signed-URL TTL ngắn**; job
 *     `TEMP_FILE_CLEANUP` xoá cả hàng lẫn object khi hết hạn (owner O-3/O-7).
 *  3. `url` là tạm thời — client dùng ngay, KHÔNG lưu.
 *  4. 085 = **lấy-hoặc-tạo** (owner O-4): gọi lại để hỏi trạng thái lô của CHÍNH mình cho kỳ đó.
 */

/** Hạn sống của tệp PDF một phiếu (083/084) trên storage — 15 phút (owner O-7). */
export const PAYSLIP_PDF_FILE_TTL_SEC = 900;
/** Hạn sống của tệp ZIP hàng loạt (085) — 24 giờ (owner O-7). */
export const PAYSLIP_PDF_BATCH_FILE_TTL_SEC = 86_400;
/** Trần số phiếu của một lô PDF (SPEC-11 §19.1) — vượt ⇒ 422 `PAYROLL-ERR-031` `pdf-batch-too-large`. */
export const PAYSLIP_PDF_BATCH_MAX = 2_000;

/** 083 · 084 — một phiếu. */
export const payslipPdfDto = z.object({
  fileId: z.string().uuid(),
  fileName: z.string(),
  /** Signed-URL TTL ngắn — dùng ngay, không lưu. */
  url: z.string().url(),
  /** Hạn của CHÍNH chữ ký trong `url` (ISO). */
  expiresAt: z.string().datetime(),
});
export type PayslipPdfDto = z.infer<typeof payslipPdfDto>;

/** 085 — body. `retry:true` = bỏ lô `Failed` gần nhất và tạo lô mới. */
export const payslipPdfBatchRequestSchema = z
  .object({
    retry: z.boolean().optional(),
  })
  .strict();
export type PayslipPdfBatchRequest = z.infer<typeof payslipPdfBatchRequestSchema>;

export const PAYSLIP_PDF_BATCH_STATUSES = ["Pending", "Uploaded", "Failed"] as const;
export const payslipPdfBatchStatusEnum = z.enum(PAYSLIP_PDF_BATCH_STATUSES);
export type PayslipPdfBatchStatus = z.infer<typeof payslipPdfBatchStatusEnum>;

/**
 * Lý do lô `Failed` (mã máy — FE dịch): sinh lỗi · người yêu cầu mất quyền trước khi sinh · quá trần thời gian
 * chạy · `Pending` quá lâu (worker không nhận — plan BE-5B §0b B3).
 */
export const PAYSLIP_PDF_BATCH_FAILURES = [
  "generation-failed",
  "forbidden",
  "timeout",
  "stale",
] as const;
export const payslipPdfBatchFailureEnum = z.enum(PAYSLIP_PDF_BATCH_FAILURES);
export type PayslipPdfBatchFailure = z.infer<typeof payslipPdfBatchFailureEnum>;

/** `Pending` lâu hơn mốc này ⇒ 085 báo `Failed{stale}` (reaper outbox 5′ + trần chạy 4′ + dư). */
export const PAYSLIP_PDF_BATCH_STALE_SEC = 900;
/** Trần thời gian sinh một lô — dưới mốc reaper 5′ của outbox để không bị claim chồng. */
export const PAYSLIP_PDF_BATCH_RUNTIME_CAP_MS = 240_000;

/**
 * 085 — trạng thái lô. HTTP `202` khi `Pending`, `200` khi `Uploaded`/`Failed`.
 * `url`/`expiresAt` chỉ có khi `Uploaded`; `failure` chỉ có khi `Failed` (mã máy, không chi tiết nội bộ).
 */
export const payslipPdfBatchDto = z.object({
  fileId: z.string().uuid(),
  periodId: z.string().uuid(),
  status: payslipPdfBatchStatusEnum,
  payslipCount: z.number().int().nonnegative(),
  fileName: z.string(),
  createdAt: z.string().datetime(),
  /** Hạn của TỆP trên storage (ISO) — sau mốc này phải gọi 085 lại để sinh lô mới. */
  fileExpiresAt: z.string().datetime(),
  url: z.string().url().optional(),
  expiresAt: z.string().datetime().optional(),
  failure: payslipPdfBatchFailureEnum.optional(),
});
export type PayslipPdfBatchDto = z.infer<typeof payslipPdfBatchDto>;
