/**
 * S2-AUTH-USEROPS-1 — bộ chạy thao tác HÀNG LOẠT cho /system/users.
 *
 * Chạy TUẦN TỰ từng item qua endpoint đơn sẵn có (mỗi item server tự audit + tự enforce permission/
 * self-guard — client CHỈ là tiện ích UX, KHÔNG phải chốt chặn). Partial-failure rõ ràng: item lỗi
 * KHÔNG chặn item sau; kết quả gom về {ok, failed[]} để render từng dòng.
 *
 * Pure helper (không React) → unit-test trực tiếp.
 */
import type { AuthUserDto } from "@mediaos/contracts";

export type BulkUserAction = "lock" | "unlock" | "delete" | "restore";

export interface BulkItemFailure {
  email: string;
  message: string;
}

export interface BulkRunResult {
  ok: number;
  failed: BulkItemFailure[];
  /** Số item bị LOẠI trước khi chạy (self-row / trạng thái không hợp lệ) — hiển thị cho người dùng. */
  skipped: number;
}

/**
 * Lọc target hợp lệ cho 1 action:
 *  - self-row LUÔN bị loại (server cũng chặn 400 — đây chỉ là UX, tránh lỗi ồn).
 *  - lock: chỉ user CHƯA khóa (server 400 ALREADY_LOCKED với row đã khóa).
 *  - unlock: chỉ user ĐANG khóa.
 *  - delete/restore: mọi row (trừ self với delete).
 */
export function eligibleTargets(
  users: readonly AuthUserDto[],
  action: BulkUserAction,
  currentUserId: string | undefined,
): { targets: AuthUserDto[]; skipped: number } {
  const targets = users.filter((u) => {
    if (action !== "restore" && u.id === currentUserId) return false;
    if (action === "lock") return u.status !== "locked";
    if (action === "unlock") return u.status === "locked";
    return true;
  });
  return { targets, skipped: users.length - targets.length };
}

/**
 * Chạy tuần tự `run` trên từng target; lỗi per-item được bắt và gom (KHÔNG throw xuyên vòng lặp).
 * `onProgress(done, total)` để render tiến độ.
 */
export async function runBulkSequential(
  targets: readonly AuthUserDto[],
  run: (user: AuthUserDto) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<Omit<BulkRunResult, "skipped">> {
  let ok = 0;
  const failed: BulkItemFailure[] = [];
  let done = 0;
  for (const user of targets) {
    try {
      await run(user);
      ok += 1;
    } catch (err: unknown) {
      failed.push({ email: user.email, message: errorMessage(err) });
    }
    done += 1;
    onProgress?.(done, targets.length);
  }
  return { ok, failed };
}

/** Rút message an toàn từ unknown error (KHÔNG dump object — tránh lộ chi tiết kỹ thuật). */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Lỗi không xác định";
}
