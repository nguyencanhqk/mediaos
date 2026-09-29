import { z } from "zod";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";
import { feedPollStatusSchema } from "./social";

/**
 * S16-SOCIAL-BE-2B-1 — DTO của `SOCIAL-API-040..044` (BÌNH CHỌN).
 *
 * File RIÊNG thay vì nhét vào `social-api.ts` (470 dòng): cùng lý do BE-2A tách
 * `social-api-groups.ts`. Loại bài `poll` thì vẫn khai ở `createFeedPostSchema` — nó là payload của
 * route `002`, không phải của cụm này.
 *
 * 🔴 **Không schema nào ở đây ép luật NGHIỆP VỤ.** «2–10 lựa chọn» (`SOCIAL-ERR-018`), «poll còn
 * mở» (`016`), «đã bỏ phiếu» (`017`), «lựa chọn thuộc đúng bình chọn» — tất cả ném Ở SERVICE. Zod
 * từ chối ⇒ **400 vô danh** và mã lỗi của SPEC-16 §12 không bao giờ tới được người dùng.
 */

/** `040` — phân trang theo TRANG, khuôn `listFeedGroupsQuerySchema` của `030`. */
export const listPollsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    /** Vắng = cả hai trạng thái. */
    status: z.enum(["open", "closed"]).optional(),
  })
  .strict();
export type ListPollsQueryDto = z.infer<typeof listPollsQuerySchema>;

/**
 * `041` — bỏ/đổi phiếu.
 *
 * ⚠️ `optionIds` là MẢNG kể cả với bình chọn một-lựa-chọn: đổi hình dạng payload theo cờ
 * `multipleChoice` buộc FE phải biết cờ đó TRƯỚC khi gửi, và làm route có hai hợp đồng.
 * «Gửi nhiều lựa chọn cho bình chọn một-lựa-chọn» là lỗi NGHIỆP VỤ (409 `SOCIAL-ERR-017`), không
 * phải lỗi hình dạng.
 *
 * ⚠️ **Không `.min(1)`**: mảng rỗng ở đây có nghĩa rõ ràng — không chọn gì — và đường đúng để diễn
 * đạt nó là `042` (rút phiếu). Nếu ép `.min(1)` thì một FE gửi `[]` nhận 400 vô danh thay vì được
 * dẫn tới route đúng. Service xử lý `[]` như một lượt rút phiếu, idempotent.
 */
export const votePollSchema = z
  .object({
    optionIds: z.array(z.string().uuid()).max(10),
  })
  .strict();
export type VotePollDto = z.infer<typeof votePollSchema>;

// ─────────────── S16-SOCIAL-FE-2 — RESPONSE của `040..044` (plan D1) ───────────────
//
// Trước FE-2 các hình dạng này CHỈ sống trong service BE (`social-polls.service.ts`), nên FE không có
// gì để parse. Service giờ khai kiểu trả về bằng CHÍNH các DTO dưới đây (plan D2, type-only) ⇒ lệch
// một trường là TS đỏ lúc build ở `apps/api`, không phải ZodError lúc chạy ở trình duyệt.

/** Một lựa chọn kèm số phiếu. KHÔNG có danh sách cử tri — kể cả với bình chọn công khai. */
export const feedPollOptionResultSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  voteCount: z.number().int().min(0),
});
export type FeedPollOptionResultDto = z.infer<typeof feedPollOptionResultSchema>;

/**
 * `041` (bỏ/đổi phiếu) · `042` (rút phiếu) · `043` (kết quả) · `044` (đóng tay) — MỘT hình dạng cho
 * cả bốn (`SocialPollsService.readResultsTx`), nên FE ghi thẳng kết quả mutation vào cache của `043`.
 *
 * 🔴 **Không trường nào chở danh tính cử tri** (SOC-DEC-009 — ẩn danh thì `user_id` không bao giờ ra
 * khỏi server, kể cả với `company-admin`). `myVote` là phiếu của CHÍNH người gọi. Thêm `voters` /
 * `userIds` vào đây là mở đúng đường rò mà bất biến đó cấm.
 *
 * `totalVoters` = số NGƯỜI đã bỏ phiếu (không phải tổng phiếu) — mẫu số của thanh %.
 */
export const feedPollResultsSchema = z.object({
  pollId: z.string().uuid(),
  postId: z.string().uuid(),
  question: z.string(),
  status: feedPollStatusSchema,
  multipleChoice: z.boolean(),
  isAnonymous: z.boolean(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  totalVoters: z.number().int().min(0),
  myVote: z.array(z.string().uuid()),
  options: z.array(feedPollOptionResultSchema),
});
export type FeedPollResultsDto = z.infer<typeof feedPollResultsSchema>;

/**
 * Một dòng của `040`. ⚠️ KHÔNG có `multipleChoice` và KHÔNG có số phiếu — danh sách chỉ đủ để mở bài;
 * khối bỏ phiếu đầy đủ đọc `043` theo `postId`.
 */
export const feedPollListItemSchema = z.object({
  pollId: z.string().uuid(),
  postId: z.string().uuid(),
  question: z.string(),
  status: feedPollStatusSchema,
  isAnonymous: z.boolean(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  closedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedPollListItemDto = z.infer<typeof feedPollListItemSchema>;

/** `040` — envelope OFFSET `{data,page,limit,total}` (khuôn `feedGroupPageSchema`, KHÔNG `paginated()`). */
export const feedPollPageSchema = z.object({
  data: z.array(feedPollListItemSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type FeedPollPageDto = z.infer<typeof feedPollPageSchema>;
