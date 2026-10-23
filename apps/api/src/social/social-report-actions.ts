import {
  REPORT_ACTION_MATRIX,
  type FeedReportActionDto,
  type FeedTargetTypeDto,
} from "@mediaos/contracts";
import { SOCIAL_REPORT_ACTION_PAIRS } from "./social-route-pairs.const";
import type { SocialActor } from "./social.types";

/**
 * S16-SOCIAL-BE-3A — luật THUẦN của hành động kèm ở `SOCIAL-API-029` (không DB, không DI).
 *
 * Tách khỏi `social-reports.service.ts` để luật ma trận D2 và bảng cặp D4 dưới đây đo được VÉT CẠN ở
 * unit spec (`social-report-actions.spec.ts`) mà không dựng Nest.
 */

/**
 * `true` ⇔ `action` hợp lệ cho `targetType` theo ma trận D2. Ma trận là `REPORT_ACTION_MATRIX` của
 * `@mediaos/contracts` (S16-SOCIAL-REPORTMATRIX-1) — FE đọc CHÍNH hằng đó, không có bản chép tay.
 */
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
