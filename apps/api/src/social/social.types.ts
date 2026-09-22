import type { DataScope } from "@mediaos/contracts";
import type { SocialRouteKey } from "./social-route-pairs.const";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard). */
export interface SocialRequestUser {
  id: string;
  companyId: string;
}

/**
 * S16-SOCIAL-BE-1 — ngữ cảnh của actor, resolve ĐÚNG MỘT LẦN mỗi request ở
 * `SocialAccessService.resolveActor(user, routeKey)` rồi truyền xuống repository/mapper
 * (khuôn `RecruitActor` — memory `reused-method-must-be-actor-scoped`).
 *
 * ⚠️ MỌI trường ở đây là **quyết định đã chốt của request hiện tại**, KHÔNG phải gợi ý. Repository
 * dựng vị từ SQL TỪ các trường này; tính lại ở tầng dưới là đẻ nguồn sự thật thứ hai.
 */
export interface SocialActor extends SocialViewerContext {
  routeKey: SocialRouteKey;
  /** Scope của cặp route đang phục vụ (đã assert ≠ null + qua sàn Company ở tầng 2). */
  routeScope: DataScope;
  /** Có `manage:feed-news` — tạo bài `type='news'` (002) và đổi `pinned` (006). */
  canManageNews: boolean;
}

/**
 * Phần NGỮ CẢNH XEM — đúng những gì `visiblePostCondition` cần và không hơn.
 *
 * ┌─ VÌ SAO TÁCH KHỎI `SocialActor` ───────────────────────────────────────────────────────────────┐
 * │ `FilePolicyService` hỏi "người này tải được tệp đính kèm của bài X không?" qua một              │
 * │ `FilePermissionInput` **không có `routeKey`** — nó không đi qua route SOCIAL nào (đường tải là   │
 * │ route của FOUNDATION Files). Nếu vị từ visibility chỉ nhận `SocialActor` đầy đủ, resolver buộc   │
 * │ phải bịa một `routeKey` hoặc **tự viết lại vị từ** — và bản viết lại đó sẽ trôi khỏi bản gốc.    │
 * │ Đó đúng là lớp lỗi `read-path-gate-pair-must-match-download-pair`: cổng MÀN HÌNH và cổng ĐƯỜNG   │
 * │ TẢI nói hai chuyện khác nhau, bài kín đọc được qua "cửa tệp" dù "cửa bài" đã khoá.               │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export interface SocialViewerContext {
  actorUserId: string;
  companyId: string;
  /**
   * Có `manage:feed-post` — mở CẢ HAI thứ, và chúng đi liền nhau có chủ ý:
   *   • đọc được bài `hidden` của người khác (`assertPostVisible`, bộ lọc `status` của 001);
   *   • sửa/xoá nội dung của người khác (004/005/016/017).
   * Tách làm hai cờ sẽ đẻ ra vai "sửa được bài mà không nhìn thấy nó".
   */
  canManagePosts: boolean;
  /**
   * `org_unit_id` của chính actor ∪ mọi đơn vị actor đứng đầu — vế `audience='org_unit'`.
   *
   * ⚠️ **KHÔNG suy diễn cây con** (plan §2 D13, owner ký 21/09/2026): người ở đơn vị CHA KHÔNG đọc
   * được bài của đơn vị CON. Hạ tầng truy vấn đệ quy trên cây `org_units` chưa tồn tại, và một phép
   * xấp xỉ ở tầng service sẽ nới phạm vi hiển thị của nội dung theo cách không ai đo được.
   *
   * RỖNG là hợp lệ và có nghĩa: actor không thuộc đơn vị nào ⇒ 0 bài `org_unit` nào thấy được
   * (fail-closed, KHÔNG BAO GIỜ match-all).
   */
  orgUnitIds: readonly string[];
}

/** Hàng bài tối thiểu mà `assertPostVisible` trả — đủ cho mọi quyết định ghi ở tầng trên. */
export interface SocialPostAccess {
  id: string;
  authorUserId: string;
  type: string;
  audience: string;
  orgUnitId: string | null;
  groupId: string | null;
  status: string;
  pinned: boolean;
  commentsLocked: boolean;
  requiresAck: boolean;
  likeCount: number;
  commentCount: number;
}

/** Hàng bình luận tối thiểu + bài cha (đã qua cùng một cổng visibility). */
export interface SocialCommentAccess {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorUserId: string;
  likeCount: number;
  post: SocialPostAccess;
}

/**
 * Kết quả `assertTargetVisible` — đích đã qua cổng visibility, KÈM audience/status của bài CHA.
 *
 * Hai trường `postAudience`/`postStatus` có mặt ở đây để người gọi thu hẹp FAN-OUT WS (D21) mà
 * KHÔNG phải truy vấn lại bài: room `co:{c}:feed` là room CẢ CÔNG TY, nên phát sự kiện của bài
 * `org_unit`/`hidden` vào đó là rò đúng thứ mà REST trả 404.
 */
export interface SocialTargetAccess {
  postId: string;
  authorUserId: string;
  postAudience: string;
  postStatus: string;
}

/** Đích đa hình của `feed_reactions` / `feed_mentions` (và `feed_reports` ở BE-1B). */
export type SocialTargetType = "post" | "comment";
