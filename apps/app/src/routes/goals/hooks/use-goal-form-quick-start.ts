/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — tín hiệu cho mặc định thông minh của `/goals/new`.
 *
 * Nguồn DUY NHẤT là `/auth/me` đã có: phạm vi `create:goal` lấy từ store phiên (`scopes`, ghi lúc đăng
 * nhập — cùng cách S20-GOAL-LISTURL-1 đọc `view:goal`), hồ sơ của mình qua cache `authKeys.me()` dùng
 * chung với danh sách mục tiêu và trang hồ sơ. Không endpoint mới. Phạm vi chỉ là TÍN HIỆU ẩn/hiện ô;
 * server vẫn ép phạm vi ở POST /goals.
 */
import { useQuery } from "@tanstack/react-query";
import { authApi, authKeys, useAuthStore } from "@mediaos/web-core";
import { GOAL_ENGINE_PAIRS } from "../constants";
import { isCreateGoalOwnOnly } from "../goal-form-defaults";

const CREATE_GOAL_PAIR_KEY = `${GOAL_ENGINE_PAIRS.CREATE.action}:${GOAL_ENGINE_PAIRS.CREATE.resourceType}`;
const ME_STALE_MS = 300_000;

export interface GoalFormQuickStart {
  /** `create:goal` chỉ có Own ⇒ form ẩn Cấp + Chủ thể. */
  readonly ownOnly: boolean;
  /** `employee.id` của chính mình; null khi chưa có hồ sơ, đang tải hoặc lỗi. */
  readonly selfEmployeeId: string | null;
  /** `/auth/me` đã trả lời (thành công hoặc lỗi) — phân biệt «đang tải» với «không có hồ sơ». */
  readonly selfSettled: boolean;
}

/** `enabled=false` (form SỬA) ⇒ không gọi `/auth/me`. */
export function useGoalFormQuickStart(enabled: boolean): GoalFormQuickStart {
  const createScopes = useAuthStore((s) => s.scopes[CREATE_GOAL_PAIR_KEY]);
  const meQuery = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(),
    enabled,
    staleTime: ME_STALE_MS,
  });
  return {
    ownOnly: isCreateGoalOwnOnly(createScopes),
    selfEmployeeId: meQuery.data?.employee?.id ?? null,
    selfSettled: meQuery.isSuccess || meQuery.isError,
  };
}
