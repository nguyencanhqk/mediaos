/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — tín hiệu cho mặc định thông minh của `/goals/new`.
 *
 * Nguồn DUY NHẤT là lượt `/auth/me` lúc khởi động (`bootstrapSession` ghi vào store phiên): phạm vi
 * `create:goal` (`scopes` — cùng cách S20-GOAL-LISTURL-1 đọc `view:goal`) và hồ sơ của mình
 * (`user.employee`). Mở form KHÔNG gọi thêm request nào. Phạm vi chỉ là TÍN HIỆU ẩn/hiện ô; server vẫn ép
 * phạm vi ở POST /goals.
 */
import { useAuthStore } from "@mediaos/web-core";
import { GOAL_ENGINE_PAIRS } from "../constants";
import { isCreateGoalOwnOnly } from "../goal-form-defaults";

const CREATE_GOAL_PAIR_KEY = `${GOAL_ENGINE_PAIRS.CREATE.action}:${GOAL_ENGINE_PAIRS.CREATE.resourceType}`;

export interface GoalFormQuickStart {
  /** `create:goal` chỉ có Own ⇒ form ẩn Cấp + Chủ thể. */
  readonly ownOnly: boolean;
  /** `employee.id` của chính mình; null khi chưa có hồ sơ, đang tải hoặc lỗi. */
  readonly selfEmployeeId: string | null;
  /** Phiên đã có hồ sơ `/auth/me` — phân biệt «chưa có phiên» với «không có hồ sơ». */
  readonly selfSettled: boolean;
}

/** `enabled=false` (form SỬA) ⇒ không neo chính mình. */
export function useGoalFormQuickStart(enabled: boolean): GoalFormQuickStart {
  const createScopes = useAuthStore((s) => s.scopes[CREATE_GOAL_PAIR_KEY]);
  const user = useAuthStore((s) => s.user);
  return {
    ownOnly: isCreateGoalOwnOnly(createScopes),
    selfEmployeeId: enabled ? (user?.employee?.id ?? null) : null,
    selfSettled: enabled && user !== null,
  };
}
