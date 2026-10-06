import type { z } from "zod";
import {
  type feedEngagementQuerySchema,
  feedEngagementResponseSchema,
  type FeedEngagementResponseDto,
} from "@mediaos/contracts";
import { apiFetch, apiFetchBlob, type ApiBlobResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S16-SOCIAL-FE-3 — client THỐNG KÊ TƯƠNG TÁC (`SOCIAL-API-052` · `053`), mirror `SocialStatsController`
 * (`apps/api/src/social/social-stats.controller.ts`).
 *
 * Hai route CÙNG cặp `view:feed-report` (phạm vi theo đơn vị do server ép) ⇒ ai xem được số liệu thì
 * tải được tệp; không có cổng riêng cho nút Xuất.
 */

/**
 * Tham số của `052`/`053` ở phía GỬI: kiểu ĐẦU VÀO của `feedEngagementQuerySchema`. `from`/`to` phải
 * đi CÙNG nhau (lẻ một vế là 400); vắng cả hai ⇒ server lấy 8 tuần tới hết tuần hiện tại theo múi giờ
 * công ty. `orgUnitId` ngoài phạm vi người xem ⇒ 403 `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE`.
 */
export type FeedEngagementParams = z.input<typeof feedEngagementQuerySchema>;

export const socialStatsApi = {
  /** GET /social/stats/engagement (052) — `{ range, units, rows, weekTotals }`, không phân trang. */
  engagement: (query?: FeedEngagementParams): Promise<FeedEngagementResponseDto> =>
    apiFetch(
      `/social/stats/engagement${buildQueryString(query ?? {})}`,
      feedEngagementResponseSchema,
    ),

  /**
   * GET /social/stats/engagement/export (053) — tệp XLSX.
   *
   * 🔴 Đi `apiFetchBlob`, KHÔNG `apiFetch`: `apiFetch` đọc thân như JSON và làm hỏng tệp nhị phân. Lỗi
   * (403/400…) vẫn ném `ApiError` như thường vì server chỉ đặt header XLSX ở đường thành công.
   *
   * ⚠️ `filename` có thể là `null`: API không khai `exposedHeaders` cho `Content-Disposition` nên trình
   * duyệt giấu header đó khi gọi khác origin — nơi gọi PHẢI có tên dự phòng đuôi `.xlsx`.
   */
  exportEngagement: (query?: FeedEngagementParams): Promise<ApiBlobResult> =>
    apiFetchBlob(`/social/stats/engagement/export${buildQueryString(query ?? {})}`),
};
