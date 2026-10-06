/**
 * S16-SOCIAL-FE-3B (L4) — hai lượt ghi NGAY TRÊN HÀNG của màn Thiết lập huy hiệu: «Ngừng dùng»
 * (`SOCIAL-API-051`, DELETE = tắt, không xoá hàng) và «Bật lại» (`SOCIAL-API-050` với ĐÚNG `{ isActive: true }`).
 *
 * Đi qua `useGuardedMutation` (plan D20 · B23): 050 / 051 không `@Idempotent()` ở server và `isPending` tới màn
 * sau một nhịp, nên bấm đúp / Enter giữ phím đều lọt nếu chỉ dựa vào nút `disabled`; yêu cầu treo quá hạn chờ
 * rơi vào `outcomeUnknown` thay vì khoá màn vô hạn. Khoá nhả sau MỌI kết cục — hai hành động này lặp lại được
 * (051 lặp trên huy hiệu đã tắt trả lại chính hàng đó; 050 `{ isActive: true }` lặp không đổi gì thêm).
 *
 * Hook chỉ GỌI và PHÂN LOẠI kết cục thành dữ liệu (`BadgeToggleResult`); việc phải làm với nó — đóng hộp xác
 * nhận, làm mới cache, vẽ dải — là của trang.
 */
import { socialKudosApi } from "@mediaos/web-core";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { useGuardedMutation, type GuardedMutation } from "../../admin/lib/use-guarded-mutation";
import { describeToggleBadgeError } from "./badge-errors";

export type BadgeToggleKind = "deactivate" | "reactivate";

/** Mọi thứ một lượt tắt / bật cần — nằm trong `variables`, thân `mutationFn` không đọc state. */
export interface BadgeToggleVariables {
  kind: BadgeToggleKind;
  badge: KudosBadgeAdminDto;
}

/**
 * Kết cục của một lượt tắt / bật.
 *  · `done`   ⇒ `badge` là hàng SERVER trả; trang làm mới cache.
 *  · `failed` ⇒ `invalidate`: thứ đang thấy đã (hoặc có thể đã) cũ; `retry` có ⇔ gửi lại NGUYÊN lượt đó có
 *    thể thành công.
 */
export type BadgeToggleResult =
  | { kind: "done"; toggle: BadgeToggleKind; badge: KudosBadgeAdminDto }
  | {
      kind: "failed";
      reason: AdminErrorReason;
      invalidate: boolean;
      retry: BadgeToggleVariables | null;
    };

/** Trạng thái `isActive` mà một lượt tắt / bật THÀNH CÔNG phải để lại. */
const isActiveAfter = (kind: BadgeToggleKind): boolean => kind === "reactivate";

function sendToggle({ kind, badge }: BadgeToggleVariables): Promise<KudosBadgeAdminDto> {
  return kind === "deactivate"
    ? socialKudosApi.deactivateBadge(badge.id)
    : socialKudosApi.updateBadge(badge.id, { isActive: true });
}

/**
 * 2xx mà huy hiệu trả về KHÔNG ở trạng thái vừa yêu cầu là hợp đồng bị vi phạm: không biết lượt ghi đã ăn hay
 * chưa ⇒ `outcomeUnknown` (không câu «Đã …», không «Thử lại»), và bảng phải được đọc lại.
 */
function resultOfSuccess(saved: KudosBadgeAdminDto, kind: BadgeToggleKind): BadgeToggleResult {
  return saved.isActive === isActiveAfter(kind)
    ? { kind: "done", toggle: kind, badge: saved }
    : { kind: "failed", reason: "outcomeUnknown", invalidate: true, retry: null };
}

function resultOfError(err: unknown, variables: BadgeToggleVariables): BadgeToggleResult {
  const { reason, invalidate, retryable } = describeToggleBadgeError(err);
  return { kind: "failed", reason, invalidate, retry: retryable ? variables : null };
}

export function useBadgeToggle(
  onResult: (result: BadgeToggleResult) => void,
): GuardedMutation<BadgeToggleVariables> {
  return useGuardedMutation<KudosBadgeAdminDto, BadgeToggleVariables>({
    mutationFn: sendToggle,
    onSuccess: (saved, { kind }) => {
      onResult(resultOfSuccess(saved, kind));
    },
    onError: (err, variables) => {
      onResult(resultOfError(err, variables));
    },
  });
}
