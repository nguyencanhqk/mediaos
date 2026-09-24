import { z } from "zod";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";
import { FEED_NOTE_MAX } from "./social-api";
import { feedIdeaStatusSchema } from "./social";

/**
 * S16-SOCIAL-BE-2B-2 — DTO của `SOCIAL-API-045..046` (SÁNG KIẾN).
 *
 * File RIÊNG thay vì nhét vào `social-api.ts` (470 dòng) — cùng lý do BE-2A tách
 * `social-api-groups.ts` và BE-2B-1 tách `social-api-polls.ts`. Nhánh `type='idea'` của route `002`
 * thì vẫn khai ở `createFeedPostSchema`: nó là payload của `002`, không phải của cụm này.
 *
 * 🔴 **Không schema nào ở đây ép luật NGHIỆP VỤ.** Thứ tự chuyển trạng thái (`SOCIAL-ERR-019`), quyền
 * `approve:feed-idea` (`SOCIAL-ERR-020`), «từ chối bắt buộc có lý do» — tất cả ném Ở SERVICE. Zod từ
 * chối ⇒ **400 vô danh** và mã lỗi của SPEC-16 §12 không bao giờ tới được người dùng
 * (`packages/contracts/src/social-api.ts:309-310`).
 */

/** `045` — phân trang theo TRANG (API-19 §6.4), khuôn `listPollsQuerySchema` của `040`. */
export const listIdeasQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    /** Vắng = cả 4 trạng thái. Lọc theo TẬP giá trị của `chk_feed_ideas_status`. */
    status: feedIdeaStatusSchema.optional(),
  })
  .strict();
export type ListIdeasQueryDto = z.infer<typeof listIdeasQuerySchema>;

/**
 * Trạng thái ĐÍCH hợp lệ của một lượt xét duyệt `046`.
 *
 * 🔴 **`submitted` KHÔNG có mặt, và đó không phải sơ suất**: nó không là ĐÍCH của cạnh nào trong FSM
 * 3 cạnh (`social-idea-fsm.ts`). Để nó ở đây thì mọi request `{status:'submitted'}` đi tới service
 * chỉ để ăn 409 — một mã lỗi nghiệp vụ trả cho một giá trị mà hợp đồng lẽ ra tuyên bố là vô nghĩa.
 * Hệ quả ĐO ĐƯỢC: 4 ô cột `to='submitted'` của ma trận FSM **không tới được qua HTTP** — chúng vẫn
 * được vét cạn ở tầng unit (`social-idea-fsm.spec.ts` I-1) vì FSM là hàm công khai.
 */
export const feedIdeaReviewTargetSchema = z.enum(["under_review", "accepted", "rejected"]);
export type FeedIdeaReviewTargetDto = z.infer<typeof feedIdeaReviewTargetSchema>;

/**
 * `046` — `PATCH /social/posts/{post_id}/idea/review`.
 *
 * ⚠️ `.pick()`-style allowlist ĐÚNG 2 trường, rồi `.strict()`. **CẤM `.extend(feedIdeaCoreSchema)`**:
 * schema lõi đó mang `status`/`reviewedBy`/`reviewedAt`/`reviewNote`, nên `.extend()` biến body này
 * thành **TỰ DUYỆT** — tác giả gửi `{status:'accepted', reviewedBy:<mình>, reviewedAt:now}` là bỏ qua
 * hẳn cặp `approve:feed-idea` (`packages/contracts/src/social.ts:282-286`).
 *
 * ⚠️ **`reviewNote` KHÔNG có `.min(1)`, có chủ đích.** Luật «`rejected` bắt buộc lý do» là
 * `chk_feed_ideas_reject_note` (`length(btrim(review_note)) > 0`) và phải ném **422 có mã** ở service.
 * `.min(1)` ở đây cho `"   "` LỌT (một ký tự trắng vẫn min 1 ký tự… trước khi `.trim()` chạy) và đồng
 * thời biến ca «từ chối mà không ghi lý do» thành 400 vô danh. `.trim()` đứng trước `.max()` nên
 * `"   "` vào tới service là chuỗi RỖNG — đúng hình dạng service cần để ném 422.
 */
export const reviewFeedIdeaSchema = z
  .object({
    status: feedIdeaReviewTargetSchema,
    reviewNote: z.string().trim().max(FEED_NOTE_MAX).optional(),
  })
  .strict();
export type ReviewFeedIdeaDto = z.infer<typeof reviewFeedIdeaSchema>;
