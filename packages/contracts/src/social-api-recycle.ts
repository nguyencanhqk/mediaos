import { z } from "zod";
import { feedAudienceSchema, feedPostTypeSchema } from "./social";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";

/**
 * S16-SOCIAL-BE-3C — DTO thùng rác bài viết: `SOCIAL-API-057` (`GET /recycle-bin/feed-posts`) và `058`
 * (`POST /recycle-bin/feed-posts/{post_id}/restore`). Plan `docs/plans/S16-SOCIAL-BE-3C.md` §1 D10/D12.
 *
 * Cùng luật tách file của `./social-api-b`: import NGƯỢC (enum + hằng trần) và **KHÔNG re-export** tên nào của
 * file khác — trùng tên ở hai star-export là lỗi mơ hồ lúc build.
 *
 * DTO đọc KHÔNG chở `userId` nào — kể cả người xoá (`deleted_by`): màn thùng rác chỉ cần biết «tác giả tự
 * xoá hay không» (`deletedByAuthor`), không cần biết AI xoá. Danh tính tác giả = `employeeId` + tên, và bị CHE
 * (`author: null`) khi bài nằm ngoài audience của người xem (D10) — hàng VẪN được liệt kê để HR khôi phục
 * theo yêu cầu.
 */

/** Trần trích đoạn nội dung trong thùng rác — đủ để nhận ra bài, không phải bản sao bài. */
export const FEED_RECYCLE_EXCERPT_MAX = 200;

/** Status mà một bài đã xoá có thể quay về — tập ĐÓNG của `restoreStatusSql()` (D4). */
export const feedRestorableStatusSchema = z.enum(["published", "hidden"]);
export type FeedRestorableStatusDto = z.infer<typeof feedRestorableStatusSchema>;

/**
 * `SOCIAL-API-057` — query. Phân trang OFFSET (màn QUẢN TRỊ — người dùng cần nhảy trang + thấy TỔNG, đúng
 * ngoại lệ SPEC-16 NFR chừa cho offset). `.strict()` — khoá lạ ⇒ 400.
 */
export const feedRecycleBinQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type FeedRecycleBinQueryDto = z.infer<typeof feedRecycleBinQuerySchema>;

/** Tác giả của bài trong thùng rác — `null` ở cấp item khi bài ngoài audience người xem (D10). */
export const feedRecycleBinAuthorSchema = z.object({
  /** `null` khi tác giả không có (hoặc không còn) hồ sơ nhân sự trong công ty. */
  employeeId: z.string().uuid().nullable(),
  fullName: z.string().nullable(),
});
export type FeedRecycleBinAuthorDto = z.infer<typeof feedRecycleBinAuthorSchema>;

/**
 * Một hàng thùng rác — tập khoá ĐÓNG (int-spec A6 assert bằng `toEqual` trên tập khoá).
 *
 * Bốn trường CHE theo vị từ audience (D10): `author` · `groupId` · `orgUnitId` · `bodyExcerpt` — `null` khi
 * người xem không thấy được bài nếu nó còn sống. `author` và `bodyExcerpt` còn `null` khi status cũ là `hidden`
 * (hoặc không rõ — legacy) mà người xem không có `manage:feed-post` và không phải tác giả. Các trường còn lại
 * luôn có mặt. ⚠️ `bodyExcerpt: null` KHÔNG phân biệt «bị che» với «bài không có body» (poll/kudos) — FE
 * không được suy «bị che» từ riêng giá trị này.
 */
export const feedRecycleBinItemSchema = z.object({
  id: z.string().uuid(),
  type: feedPostTypeSchema,
  audience: feedAudienceSchema,
  groupId: z.string().uuid().nullable(),
  /** Nhóm của bài đã bị xoá mềm ⇒ `058` trả 409 `RESTORE_GROUP_DELETED` (D12). */
  groupDeleted: z.boolean(),
  orgUnitId: z.string().uuid().nullable(),
  author: feedRecycleBinAuthorSchema.nullable(),
  /**
   * ≤ `FEED_RECYCLE_EXCERPT_MAX` KÝ TỰ (cắt ở SQL bằng `left()`). CỐ Ý không `.max()` — khuôn `bodyExcerpt` của
   * hàng đợi báo cáo: `left()` đếm ký tự Postgres, Zod đếm đơn vị UTF-16 ⇒ trích đoạn nhiều emoji vượt `.max`
   * ⇒ ZodError ở FE dù server đúng.
   */
  bodyExcerpt: z.string().nullable(),
  /** Status ngay trước khi xoá; `null` = hàng xoá trước mig 0589 (legacy). */
  statusBeforeDelete: feedRestorableStatusSchema.nullable(),
  /** Status mà `058` SẼ cho ra — CÙNG hàm SQL với câu khôi phục (`restoreStatusSql`, D4). */
  restoreAs: feedRestorableStatusSchema,
  deletedAt: z.string().datetime({ offset: true }),
  /** `deleted_by = author_user_id` — tác giả tự xoá ⇒ `restoreAs` luôn `hidden` (O4). */
  deletedByAuthor: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedRecycleBinItemDto = z.infer<typeof feedRecycleBinItemSchema>;

/** Trang OFFSET — `ORDER BY deleted_at DESC, id DESC`. */
export const feedRecycleBinPageSchema = z.object({
  data: z.array(feedRecycleBinItemSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FeedRecycleBinPageDto = z.infer<typeof feedRecycleBinPageSchema>;

/** `SOCIAL-API-058` — kết quả khôi phục: status SAU khôi phục (D4). */
export const feedPostRestoreResultSchema = z.object({
  id: z.string().uuid(),
  status: feedRestorableStatusSchema,
});
export type FeedPostRestoreResultDto = z.infer<typeof feedPostRestoreResultSchema>;
