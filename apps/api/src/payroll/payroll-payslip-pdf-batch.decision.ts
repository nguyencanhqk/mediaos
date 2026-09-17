import {
  PAYSLIP_PDF_BATCH_FAILURES,
  PAYSLIP_PDF_BATCH_STALE_SEC,
  type PayslipPdfBatchFailure,
} from "@mediaos/contracts";

/**
 * S15-PAYROLL-BE-5B — quyết định của 085 «lấy-hoặc-tạo» (owner O-4), tách thành hàm THUẦN để unit phủ đủ bảng.
 *
 * | lô sống gần nhất                          | retry | kết quả          |
 * | ----------------------------------------- | ----- | ---------------- |
 * | không có / vân tay khác                   | *     | create           |
 * | Uploaded                                  | *     | uploaded (200)   |
 * | Pending, chưa quá STALE                   | *     | pending (202)    |
 * | Pending quá STALE                         | false | failed `stale`   |
 * | Failed                                    | false | failed `<lý do>` |
 * | Pending quá STALE / Failed                | true  | create           |
 */

export interface BatchCandidate {
  uploadStatus: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export type BatchDecision =
  | { kind: "create" }
  | { kind: "uploaded" }
  | { kind: "pending" }
  | { kind: "failed"; failure: PayslipPdfBatchFailure };

const FAILURES: ReadonlySet<string> = new Set(PAYSLIP_PDF_BATCH_FAILURES);

/** Lý do lưu trong metadata ngoài danh sách đóng ⇒ quy về `generation-failed` (không lộ chuỗi nội bộ). */
export function toBatchFailure(raw: unknown): PayslipPdfBatchFailure {
  return typeof raw === "string" && FAILURES.has(raw)
    ? (raw as PayslipPdfBatchFailure)
    : "generation-failed";
}

export function decideBatch(
  live: BatchCandidate | null,
  fingerprint: string,
  retry: boolean,
  now: Date,
): BatchDecision {
  if (!live || live.metadata.fingerprint !== fingerprint) return { kind: "create" };
  if (live.uploadStatus === "Uploaded") return { kind: "uploaded" };
  if (live.uploadStatus === "Pending") {
    const ageSec = (now.getTime() - live.createdAt.getTime()) / 1000;
    if (ageSec <= PAYSLIP_PDF_BATCH_STALE_SEC) return { kind: "pending" };
    return retry ? { kind: "create" } : { kind: "failed", failure: "stale" };
  }
  if (live.uploadStatus === "Failed") {
    return retry
      ? { kind: "create" }
      : { kind: "failed", failure: toBatchFailure(live.metadata.failure) };
  }
  // Trạng thái khác (Deleted không lọt được vì câu tìm lọc deleted_at) ⇒ coi như không có lô dùng được.
  return { kind: "create" };
}
