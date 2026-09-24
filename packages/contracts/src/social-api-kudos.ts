import { z } from "zod";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";

/**
 * S16-SOCIAL-BE-2B-2 — DTO của `SOCIAL-API-047..048` (VINH DANH · CATALOG HUY HIỆU).
 *
 * Nhánh `type='kudos'` của route `002` khai ở `createFeedPostSchema` (payload của `002`). Ba route
 * CRUD catalog `049..051` thuộc **BE-3**, không ở đây.
 *
 * 🔴 Luật nghiệp vụ ném Ở SERVICE, không ở Zod: huy hiệu không có/đã tắt (`SOCIAL-ERR-022`), người
 * nhận trùng tác giả, trần 10 người nhận, `isOfficial` thiếu `manage:feed-kudos`. Zod chỉ gác HÌNH
 * DẠNG.
 */

/**
 * Tháng cần xem, dạng `YYYY-MM`.
 *
 * ┌─ VÌ SAO MỘT TRƯỜNG `YYYY-MM`, KHÔNG PHẢI CẶP `month` + `year` ─────────────────────────────────┐
 * │ Cặp rời sinh ra bốn tổ hợp mà ba trong số đó phải tự đặt luật: chỉ `month`, chỉ `year`, cả hai, │
 * │ không cái nào. Luật chéo đó rơi vào `superRefine` ⇒ FE gửi thiếu một nửa nhận **400 vô danh**.  │
 * │ Một trường thì hoặc có hoặc không, và regex nói đủ nghĩa.                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Biên tháng tính theo **múi giờ CÔNG TY** (`companies.timezone`), không theo UTC — xem
 * `social-kudos.repository.ts#listKudosTx`. Lệch 7 giờ ở VN nghĩa là một lời vinh danh đăng 03:00
 * ngày 1 sẽ rơi vào tháng TRƯỚC nếu cắt biên bằng UTC.
 */
export const kudosMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "tháng phải có dạng YYYY-MM");
export type KudosMonthDto = z.infer<typeof kudosMonthSchema>;

/** `047` — phân trang theo TRANG (API-19 §6.4). Vắng `month` = vinh danh GẦN ĐÂY (mới nhất trước). */
export const listKudosQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    month: kudosMonthSchema.optional(),
  })
  .strict();
export type ListKudosQueryDto = z.infer<typeof listKudosQuerySchema>;

/**
 * `048` — catalog huy hiệu ĐANG BẬT.
 *
 * ⚠️ KHÔNG có tham số `isActive`: route này trả đúng tập `is_active = true` và không nhận lệnh khác.
 * Mở một cờ cho phép xem huy hiệu đã tắt là mở một nửa của `049..051` (BE-3, cặp `manage:feed-kudos`)
 * qua một route chỉ gác `view:feed`.
 */
export const listKudosBadgesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(50),
  })
  .strict();
export type ListKudosBadgesQueryDto = z.infer<typeof listKudosBadgesQuerySchema>;
