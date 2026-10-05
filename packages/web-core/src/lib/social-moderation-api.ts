import { z } from "zod";
import {
  type CreateFeedReportDto,
  feedReportPageSchema,
  type FeedReportPageDto,
  feedReportSchema,
  type FeedReportDto,
  type ListFeedReportsQueryDto,
  type resolveFeedReportSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S16-SOCIAL-FE-3 — client KIỂM DUYỆT (`SOCIAL-API-027` · `028` · `029`), mirror `SocialReportsController`
 * (`apps/api/src/social/social-b.controllers.ts`). Tách khỏi `social-api.ts` như `social-groups-api.ts`
 * (trần file, CLAUDE.md §5).
 *
 * Ba route, BA cặp quyền khác nhau — đừng suy cặp này từ cặp kia:
 *  - `027` tạo báo cáo: `view:feed` (ai xem được bảng tin đều báo cáo được).
 *  - `028` đọc hàng đợi: `view:feed-report`, phạm vi `Department` — quản lý chỉ thấy báo cáo về bài thuộc
 *    đơn vị mình và KHÔNG thấy người báo cáo (`reporter: null`, server che).
 *  - `029` kết thúc báo cáo: `manage:feed-report` (sàn Company); `action ≠ none` đòi THÊM
 *    `manage:feed-post` ở tầng 2.
 *
 * Bài đang ẩn KHÔNG có route riêng: đọc bằng `socialApi.listFeed({ status: "hidden" })` (001), hiện lại
 * bằng `socialApi.moderatePost(id, { hidden: false })` (006).
 */

/**
 * Body của `029` ở phía GỬI: kiểu ĐẦU VÀO của `resolveFeedReportSchema` — `action` tuỳ chọn (vắng ⇒
 * server lấy `none`). `ResolveFeedReportDto` của contracts là kiểu ĐẦU RA (sau `.default`) nên bắt buộc
 * `action`; dùng nó ở đây sẽ ép client luôn gửi khoá `action`, kể cả khi «Bỏ qua».
 */
export type ResolveFeedReportBody = z.input<typeof resolveFeedReportSchema>;

/**
 * Phản hồi của `027` — `{ id }`. Khai TẠI ĐÂY chứ không ở contracts vì service trả literal này thẳng
 * (`social-reports.service.ts#create`), không qua schema contracts nào (khuôn `feedDeletedResultSchema`).
 */
export const feedReportCreatedSchema = z.object({ id: z.string().uuid() });
export type FeedReportCreatedDto = z.infer<typeof feedReportCreatedSchema>;

export const socialModerationApi = {
  /**
   * GET /social/reports (028) — hàng đợi kiểm duyệt, phân trang OFFSET `{ data, page, limit, total }`.
   *
   * Query `.strict()` ở server: chỉ `status` · `page` · `limit`. Vắng `status` = MỌI trạng thái — muốn
   * «Tất cả» thì BỎ khoá, không gửi `status=all` (400).
   */
  listReports: (query?: Partial<ListFeedReportsQueryDto>): Promise<FeedReportPageDto> =>
    apiFetch(`/social/reports${buildQueryString(query ?? {})}`, feedReportPageSchema),

  /**
   * PATCH /social/reports/:reportId (029) — kết thúc MỘT báo cáo, trả báo cáo sau khi đổi.
   *
   * ⚠️ KHÔNG `@Idempotent()` ở server ⇒ không gửi khoá. Bấm đúp sinh 409 `SOCIAL-ERR-021` («đã có người
   * xử lý») cho chính lượt của mình — nút gửi phải `disabled` khi đang gửi (plan D20).
   */
  resolveReport: (reportId: string, body: ResolveFeedReportBody): Promise<FeedReportDto> =>
    apiFetch(`/social/reports/${reportId}`, feedReportSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /social/reports (027) — báo cáo một bài/bình luận. **@Idempotent ở BE** ⇒ bắt buộc gửi khoá.
   *
   * 🔴 Khoá = băm của `{ attemptId, body }`, KHÔNG phải của riêng `body` (plan D20). Server giữ phản hồi
   * theo khoá 15 phút; khoá suy từ nội dung thuần sẽ PHÁT LẠI phản hồi cũ cho ca «báo cáo → kiểm duyệt
   * bỏ qua → báo cáo lại y hệt»: giao diện báo «đã gửi» trong khi không có báo cáo mới nào được tạo.
   *
   * `attemptId` do nơi gọi sinh MỘT lần cho mỗi lượt mở hộp thoại và giữ nguyên qua các lần thử lại
   * trong lượt đó: thử lại ⇒ cùng khoá (không tạo báo cáo thứ hai); mở lại hộp thoại ⇒ khoá mới.
   */
  createReport: (body: CreateFeedReportDto, attemptId: string): Promise<FeedReportCreatedDto> =>
    apiFetch(
      "/social/reports",
      feedReportCreatedSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("social-report", { attemptId, body }) },
    ),
};
