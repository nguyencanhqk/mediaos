import {
  type CreateKudosBadgeDto,
  feedKudosPageSchema,
  type FeedKudosPageDto,
  kudosBadgeAdminPageSchema,
  type KudosBadgeAdminPageDto,
  kudosBadgeAdminSchema,
  type KudosBadgeAdminDto,
  kudosBadgePageSchema,
  type KudosBadgePageDto,
  kudosRecipientSearchResultSchema,
  type KudosRecipientSearchResultDto,
  type ListKudosBadgesAdminQueryDto,
  type ListKudosQueryDto,
  type UpdateKudosBadgeDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S16-SOCIAL-FE-2C — client VINH DANH (`SOCIAL-API-047` · `048` · `059`). Tách khỏi `social-api.ts` như
 * `social-groups-api.ts` (trần file, CLAUDE.md §5). S16-SOCIAL-FE-3 thêm catalog huy hiệu ở góc nhìn
 * quản trị (`056` · `049` · `050` · `051`) ở cuối object.
 *
 * KHÔNG có hàm tạo: lời vinh danh là `POST /social/posts` `type:'kudos'` (`socialApi.createPost`,
 * route `002`) — không tồn tại route tạo riêng.
 */

/**
 * `048` lấy MỘT trang cỡ trần (`FEED_ADMIN_PAGE_LIMIT_MAX`): catalog seed 5 hàng, ô chọn không lật
 * trang. Cố định ở đây (không phải tham số) để khoá cache `socialKeys.kudos.badges()` là DUY NHẤT —
 * khoá có tham số thì lệnh invalidate khoá-không-tham-số sẽ KHÔNG khớp (so theo phần tử mảng).
 */
export const KUDOS_BADGE_FETCH_LIMIT = 100;

export const socialKudosApi = {
  /**
   * GET /social/kudos (047) — cặp `view:feed`. ⚠️ VẮNG `month` = vinh danh GẦN ĐÂY, KHÔNG phải «tháng
   * này»: màn 009 và widget luôn gửi `month` tường minh (tính theo giờ công ty).
   */
  list: (query?: Partial<ListKudosQueryDto>): Promise<FeedKudosPageDto> =>
    apiFetch(`/social/kudos${buildQueryString(query ?? {})}`, feedKudosPageSchema),

  /**
   * GET /social/kudos/recipients?q= (059) — cặp `create:feed-kudos` (KHÔNG `view:feed`). Chỉ `q`:
   * query `.strict()`, gửi `page`/`limit` là 400. Caller tự kiểm `q` bằng
   * `kudosRecipientSearchQuerySchema` trước khi gọi (≥2 chữ/số — không phải độ dài chuỗi).
   */
  searchRecipients: (q: string): Promise<KudosRecipientSearchResultDto> =>
    apiFetch(`/social/kudos/recipients${buildQueryString({ q })}`, kudosRecipientSearchResultSchema),

  /** GET /social/kudos-badges (048) — cặp `view:feed`, chỉ huy hiệu ĐANG BẬT. */
  listBadges: (): Promise<KudosBadgePageDto> =>
    apiFetch(
      `/social/kudos-badges${buildQueryString({ limit: KUDOS_BADGE_FETCH_LIMIT })}`,
      kudosBadgePageSchema,
    ),

  // ── S16-SOCIAL-FE-3 — catalog huy hiệu ở góc nhìn QUẢN TRỊ: `056` · `049` · `050` · `051` ──────────
  //
  // Cả bốn route gác `manage:feed-kudos` (sàn Company) và trả `kudosBadgeAdminSchema` (CÓ `isActive`).
  // 🔴 Đừng parse bằng `kudosBadgeSchema`/`kudosBadgePageSchema` của 048: schema đó không `.strict()`
  // nên nó KHÔNG ném — nó lặng lẽ bỏ `isActive`, và màn mất đúng cột để vẽ «Ngừng dùng»/«Bật lại».

  /** GET /social/kudos-badges/manage (056) — CẢ huy hiệu đã tắt; OFFSET, `limit` mặc định 50 ở server. */
  listBadgesAdmin: (
    query?: Partial<ListKudosBadgesAdminQueryDto>,
  ): Promise<KudosBadgeAdminPageDto> =>
    apiFetch(
      `/social/kudos-badges/manage${buildQueryString(query ?? {})}`,
      kudosBadgeAdminPageSchema,
    ),

  /**
   * POST /social/kudos-badges (049) — **@Idempotent ở BE**. Khoá = băm của `{ attemptId, body }`, không
   * phải của riêng `body` (plan D20): server giữ phản hồi theo khoá 15 phút, nên khoá suy từ nội dung
   * thuần sẽ phát lại 201 cũ cho ca «tạo → ngừng dùng → tạo lại y hệt» thay vì 409 «mã đã tồn tại».
   * `attemptId` do nơi gọi sinh MỘT lần mỗi lượt mở hộp thoại, giữ nguyên qua các lần thử lại.
   */
  createBadge: (body: CreateKudosBadgeDto, attemptId: string): Promise<KudosBadgeAdminDto> =>
    apiFetch(
      "/social/kudos-badges",
      kudosBadgeAdminSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("social-kudos-badge", { attemptId, body }) },
    ),

  /**
   * PATCH /social/kudos-badges/:badgeId (050) — body `.strict()`, KHÔNG nhận `code` (bất biến ⇒ 400),
   * ít nhất một trường. Bật lại huy hiệu đã tắt = `{ isActive: true }`. Không `@Idempotent()`.
   */
  updateBadge: (badgeId: string, body: UpdateKudosBadgeDto): Promise<KudosBadgeAdminDto> =>
    apiFetch(`/social/kudos-badges/${badgeId}`, kudosBadgeAdminSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * DELETE /social/kudos-badges/:badgeId (051) — TẮT huy hiệu (`isActive:false`), không xoá hàng. Trả
   * HÀNG huy hiệu sau khi tắt, không phải `{ deleted: true }`. Không `@Idempotent()`.
   */
  deactivateBadge: (badgeId: string): Promise<KudosBadgeAdminDto> =>
    apiFetch(`/social/kudos-badges/${badgeId}`, kudosBadgeAdminSchema, { method: "DELETE" }),
};
