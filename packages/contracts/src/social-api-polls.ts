import { z } from "zod";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";

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
