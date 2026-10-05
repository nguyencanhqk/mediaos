import {
  type CreateKudosBadgeDto,
  feedKudosPageSchema,
  type FeedKudosPageDto,
  type KudosBadgeAdminDto,
  type KudosBadgeAdminPageDto,
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

/**
 * S16-SOCIAL-FE-2C — client VINH DANH (`SOCIAL-API-047` · `048` · `059`). Tách khỏi `social-api.ts` như
 * `social-groups-api.ts` (trần file, CLAUDE.md §5).
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

  // ── S16-SOCIAL-FE-3 (L1) — KHUNG huy hiệu quản trị `056` · `049` · `050` · `051`; thân ở commit GREEN ──

  listBadgesAdmin: (
    _query?: Partial<ListKudosBadgesAdminQueryDto>,
  ): Promise<KudosBadgeAdminPageDto> => Promise.resolve({ data: [], page: 1, limit: 50, total: 0 }),

  createBadge: (_body: CreateKudosBadgeDto, _attemptId: string): Promise<KudosBadgeAdminDto> =>
    Promise.resolve({} as KudosBadgeAdminDto),

  updateBadge: (_badgeId: string, _body: UpdateKudosBadgeDto): Promise<KudosBadgeAdminDto> =>
    Promise.resolve({} as KudosBadgeAdminDto),

  deactivateBadge: (_badgeId: string): Promise<KudosBadgeAdminDto> =>
    Promise.resolve({} as KudosBadgeAdminDto),
};
