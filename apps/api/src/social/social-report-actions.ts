import type { FeedReportActionDto, FeedTargetTypeDto } from "@mediaos/contracts";
import { SOCIAL_REPORT_ACTION_PAIRS } from "./social-route-pairs.const";
import type { SocialActor } from "./social.types";

/**
 * S16-SOCIAL-BE-3A — luật THUẦN của hành động kèm ở `SOCIAL-API-029` (không DB, không DI).
 *
 * Tách khỏi `social-reports.service.ts` để hai bảng dưới đây đo được VÉT CẠN ở unit spec
 * (`social-report-actions.spec.ts`) mà không dựng Nest.
 */

/**
 * D2 — ma trận hành động × loại đích. `satisfies Record<FeedTargetTypeDto, …>` ⇒ thêm một loại đích
 * vào enum contracts mà quên hàng ở đây là TS đỏ.
 *
 * ⚠️ `comment` KHÔNG có `hide_post`: ẩn BÀI vì một bình luận là trừng phạt tác giả bài cho lỗi của
 * người khác. `lock_comments` trên báo cáo bình luận khoá bình luận của BÀI CHA — đó là cách chặn
 * một luồng bình luận đang vượt kiểm soát, và là lý do duy nhất nó có mặt ở hàng này.
 */
export const REPORT_ACTION_MATRIX = {
  post: ["none", "hide_post", "lock_comments", "delete_target"],
  comment: ["none", "lock_comments", "delete_target"],
} as const satisfies Record<FeedTargetTypeDto, readonly FeedReportActionDto[]>;

/** `true` ⇔ `action` hợp lệ cho `targetType` theo ma trận D2. */
export function isReportActionValidForTarget(
  targetType: FeedTargetTypeDto,
  action: FeedReportActionDto,
): boolean {
  return (REPORT_ACTION_MATRIX[targetType] as readonly FeedReportActionDto[]).includes(action);
}

/**
 * D4 — actor có cặp THÊM mà hành động đòi không. ĐỌC `SOCIAL_REPORT_ACTION_PAIRS` (load-bearing),
 * không phải một chuỗi `if` theo tên hành động.
 *
 * Cờ `canManagePosts` đã resolve ở `resolveActor` với SÀN Company (`isCompany()`), nên ở đây không
 * có round-trip quyền nào thêm. Cặp nào ngoài `manage:feed-post` ⇒ `false` (FAIL-CLOSED): một hành
 * động mới khai cặp khác mà quên dạy hàm này thì bị TỪ CHỐI, không lặng lẽ mở.
 */
export function canPerformReportAction(actor: SocialActor, action: FeedReportActionDto): boolean {
  const pair = SOCIAL_REPORT_ACTION_PAIRS[action];
  if (pair === null) return true;
  if (pair.action === "manage" && pair.resourceType === "feed-post") return actor.canManagePosts;
  return false;
}
