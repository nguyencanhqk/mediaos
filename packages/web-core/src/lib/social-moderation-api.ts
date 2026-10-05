import { z } from "zod";
import {
  type CreateFeedReportDto,
  type FeedReportDto,
  type FeedReportPageDto,
  type ListFeedReportsQueryDto,
} from "@mediaos/contracts";

/**
 * S16-SOCIAL-FE-3 (L1) — KHUNG client KIỂM DUYỆT (`SOCIAL-API-027` · `028` · `029`). Thân hàm ở commit
 * GREEN kế tiếp; khung này chỉ để ca RED đỏ ở dòng `expect` chứ không đỏ vì thiếu file (plan §4).
 */

/** Body của `029` phía client — xem bản hiện thực. */
export interface ResolveFeedReportBody {
  status: "resolved" | "dismissed";
  resolutionNote?: string;
  action?: "none" | "hide_post" | "lock_comments" | "delete_target";
}

export const feedReportCreatedSchema = z.object({});
export type FeedReportCreatedDto = { id: string };

export const socialModerationApi = {
  listReports: (_query?: Partial<ListFeedReportsQueryDto>): Promise<FeedReportPageDto> =>
    Promise.resolve({ data: [], page: 1, limit: 20, total: 0 }),

  resolveReport: (_reportId: string, _body: ResolveFeedReportBody): Promise<FeedReportDto> =>
    Promise.resolve({} as FeedReportDto),

  createReport: (_body: CreateFeedReportDto, _attemptId: string): Promise<FeedReportCreatedDto> =>
    Promise.resolve({} as FeedReportCreatedDto),
};
