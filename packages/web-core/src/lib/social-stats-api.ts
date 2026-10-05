import { type FeedEngagementResponseDto } from "@mediaos/contracts";
import type { ApiBlobResult } from "./api-client";

/**
 * S16-SOCIAL-FE-3 (L1) — KHUNG client THỐNG KÊ TƯƠNG TÁC (`SOCIAL-API-052` · `053`). Thân hàm ở commit
 * GREEN kế tiếp (plan §4 — quy tắc stub-trước).
 */

/** Tham số của `052`/`053` phía client — xem bản hiện thực. */
export interface FeedEngagementParams {
  from?: string;
  to?: string;
  orgUnitId?: string;
}

export const socialStatsApi = {
  engagement: (_query?: FeedEngagementParams): Promise<FeedEngagementResponseDto> =>
    Promise.resolve({} as FeedEngagementResponseDto),

  exportEngagement: (_query?: FeedEngagementParams): Promise<ApiBlobResult> =>
    Promise.resolve({} as ApiBlobResult),
};
