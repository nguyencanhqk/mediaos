/**
 * S20-GOAL-BULKACTIVATE-1 (US-GOAL-QL-11) — chạy lô «Kích hoạt» THUẦN (không React, không gọi API trực
 * tiếp): bên gọi truyền hàm kích hoạt MỘT mục (hook chung `useGoalStatusMutation` — mỗi mục một
 * `PATCH /goals/:id {status:'Active'}`, BE validate + ghi audit từng cái).
 *
 * Báo theo dòng, ba nhóm rời nhau, theo đúng thứ tự đầu vào:
 *  - `activated`   — server ĐÃ trả thành công (chỉ nhóm này được đếm là thành công).
 *  - `rejected`    — server trả lời từ chối (403 ngoài phạm vi, 422 đã chốt…): hook đã trả dòng về Nháp,
 *                    lý do lấy từ lỗi theo mã.
 *  - `unprocessed` — chưa có câu trả lời của server: lỗi kết nối, hoặc chưa kịp gửi vì lô đã dừng.
 *
 * Lỗi kết nối (hoặc phiên hết hạn) ⇒ DỪNG gửi mục mới; các mục đang bay vẫn được chờ và xếp nhóm theo
 * câu trả lời thật. Không có câu trả lời thì không bao giờ tính là thành công.
 */
import { ApiError, type ApiErrorKind } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";

/** Số PATCH chạy song song tối đa trong một lô. */
export const GOAL_BULK_ACTIVATE_CONCURRENCY = 3;

/** Lỗi của các loại này áp cho MỌI mục còn lại ⇒ dừng lô thay vì gửi tiếp vô ích. */
const HALTING_KINDS: ReadonlySet<ApiErrorKind> = new Set([
  "NETWORK",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
]);

/** Kết quả một lần kích hoạt (hình của `GoalStatusSettled`, không cần mục tiêu đã lưu). */
export type GoalBulkSettled =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

export interface GoalBulkRejection {
  readonly goalId: string;
  readonly error: unknown;
}

export interface GoalBulkActivateResult {
  readonly activated: readonly string[];
  readonly rejected: readonly GoalBulkRejection[];
  readonly unprocessed: readonly string[];
}

export interface GoalBulkActivateOptions {
  readonly concurrency?: number;
  /** Gọi sau mỗi mục có kết quả, với số mục đã xong. */
  readonly onProgress?: (settledCount: number) => void;
}

type RowOutcome =
  | { kind: "activated" }
  | { kind: "rejected"; error: unknown }
  | { kind: "unprocessed" };

/** Không có câu trả lời của server: lỗi không phải ApiError (fetch hỏng) hoặc ApiError loại NETWORK. */
export function isConnectionLost(error: unknown): boolean {
  return !(error instanceof ApiError) || error.kind === "NETWORK";
}

function haltsBatch(error: unknown): boolean {
  return isConnectionLost(error) || (error instanceof ApiError && HALTING_KINDS.has(error.kind));
}

function outcomeOf(settled: GoalBulkSettled): RowOutcome {
  if (settled.ok) return { kind: "activated" };
  return isConnectionLost(settled.error)
    ? { kind: "unprocessed" }
    : { kind: "rejected", error: settled.error };
}

/** Chỉ mục Draft của lựa chọn (chọn lẫn trạng thái ⇒ mục khác giữ nguyên, không gửi). */
export function draftGoalIds(
  rows: readonly Pick<GoalCoreResponseDto, "id" | "status">[],
): string[] {
  return rows.filter((row) => row.status === "Draft").map((row) => row.id);
}

/** Kích hoạt từng mục, tối đa `concurrency` mục cùng lúc; mỗi mục ĐÚNG một lần (id trùng bị gộp). */
export async function runGoalBulkActivate(
  goalIds: readonly string[],
  activate: (goalId: string) => Promise<GoalBulkSettled>,
  options: GoalBulkActivateOptions = {},
): Promise<GoalBulkActivateResult> {
  const queue = [...new Set(goalIds)];
  const limit = Math.max(
    1,
    Math.min(options.concurrency ?? GOAL_BULK_ACTIVATE_CONCURRENCY, queue.length),
  );
  const outcomes = new Map<string, RowOutcome>();
  let nextIndex = 0;
  let halted = false;

  const worker = async (): Promise<void> => {
    while (!halted && nextIndex < queue.length) {
      const goalId = queue[nextIndex] as string;
      nextIndex += 1;
      // Hợp đồng là KHÔNG ném; nếu vẫn ném thì coi như không có câu trả lời (không bao giờ là thành công).
      const settled = await activate(goalId).catch(
        (error: unknown): GoalBulkSettled => ({ ok: false, error }),
      );
      outcomes.set(goalId, outcomeOf(settled));
      if (!settled.ok && haltsBatch(settled.error)) halted = true;
      options.onProgress?.(outcomes.size);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));

  const kindOf = (goalId: string) => outcomes.get(goalId)?.kind ?? "unprocessed";
  return {
    activated: queue.filter((goalId) => kindOf(goalId) === "activated"),
    rejected: queue.flatMap((goalId) => {
      const outcome = outcomes.get(goalId);
      return outcome?.kind === "rejected" ? [{ goalId, error: outcome.error }] : [];
    }),
    unprocessed: queue.filter((goalId) => kindOf(goalId) === "unprocessed"),
  };
}

export interface GoalBulkToast {
  readonly variant: "success" | "warning" | "error";
  readonly message: string;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Toast tổng kết một lô. Chỉ «success» khi MỌI mục được server xác nhận. */
export function bulkActivateToast(
  result: GoalBulkActivateResult,
  reasonOf: (error: unknown) => string,
  t: Translate,
): GoalBulkToast {
  const ok = result.activated.length;
  const failed = result.rejected.length;
  const unprocessed = result.unprocessed.length;
  if (failed === 0 && unprocessed === 0) {
    return { variant: "success", message: t("bulkActivate.toast.allDone", { count: ok }) };
  }
  const variant = ok > 0 ? "warning" : "error";
  if (unprocessed > 0) {
    return { variant, message: t("bulkActivate.toast.unprocessed", { ok, failed, unprocessed }) };
  }
  const reason = [...new Set(result.rejected.map((r) => reasonOf(r.error)))].join("; ");
  return { variant, message: t("bulkActivate.toast.partial", { ok, failed, reason }) };
}
