import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { feedPosts } from "../db/schema/social";
import { visibleGroupPostExists } from "./social-group-predicates";
// ⚠️ `import type` — CHỈ kiểu, bị xoá lúc biên dịch ⇒ file này KHÔNG có cạnh runtime nào ngược về lớp service.
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-3C (D9) — vế **AUDIENCE** của vị từ «bài này actor ĐƯỢC THẤY», tách khỏi
 * `SocialAccessService.visiblePostCondition` thành HÀM THUẦN.
 *
 * ┌─ VÌ SAO TÁCH, VÀ VÌ SAO KHÔNG CHÉP ────────────────────────────────────────────────────────────┐
 * │ Thùng rác (`SOCIAL-API-057`) cần ĐÚNG câu hỏi audience này để CHE tác giả/nhóm/đơn vị/trích đoạn  │
 * │ của bài đã xoá — nhưng KHÔNG được dùng cả `visiblePostCondition` (vế (a) `deleted_at IS NULL` loại │
 * │ sạch mọi hàng thùng rác). Chép vế audience sang repository thùng rác là đẻ bản luật THỨ HAI, và     │
 * │ bản chép sẽ trôi khỏi bản gốc ở lần sửa nhánh `group` kế tiếp — đúng lớp lỗi                        │
 * │ `read-path-gate-pair-must-match-download-pair`: cửa thùng rác rộng hơn cửa màn hình ⇒ `manage:`     │
 * │ `feed-post` đọc được tác giả/nội dung bài nhóm kín qua đường vòng.                                  │
 * │ Nên: MỘT hàm, hai hộ tiêu thụ. `visiblePostCondition` = `deleted_at IS NULL` ∧ status ∧ HÀM NÀY.    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Bốn nhánh OR — bỏ nhánh nào cũng là một lỗ đã có tên:
 *   • `company` — mọi người.
 *   • `org_unit` — CHỈ khi `org_unit_id` ∈ tập của viewer (đúng-BẰNG, không cây con — BE-1 D13). Tập rỗng ⇒
 *     nhánh không được thêm (fail-closed, KHÔNG BAO GIỜ match-all).
 *   • `group` — nhóm CÒN SỐNG và (public HOẶC viewer là thành viên `active`) qua `visibleGroupPostExists`
 *     (BE-2A D3). EXISTS tương quan TRONG CÂU, bám `t.groupId` theo tham số — KHÔNG `feedPosts.groupId` (M-g).
 *     `manage:feed-group` CỐ Ý không có mặt (D9-ii): thấy NHÓM khác với đọc được BÀI trong nhóm.
 *   • tác giả — luôn thấy bài của chính mình ở mọi audience (kể cả đơn vị vừa rời, nhóm đã rời).
 *
 * ⚠️ Vị từ này phục vụ cổng MÀN HÌNH, cổng ĐƯỜNG TẢI (`SocialFileResolver` qua `visiblePostCondition`) VÀ
 * cổng che của thùng rác — nới một nhánh là nới cả ba.
 *
 * ⚠️ `t` cho phép dùng lại khi `feed_posts` mang alias. KHÔNG truyền cột trần — quên alias ở một JOIN là vị
 * từ bám nhầm bảng.
 */
export function audienceCondition(
  viewer: SocialViewerContext,
  t: typeof feedPosts = feedPosts,
): SQL {
  const audienceOr: SQL[] = [eq(t.audience, "company")];
  if (viewer.orgUnitIds.length > 0) {
    audienceOr.push(
      and(eq(t.audience, "org_unit"), inArray(t.orgUnitId, [...viewer.orgUnitIds])) ?? sql`false`,
    );
  }
  audienceOr.push(
    and(
      eq(t.audience, "group"),
      visibleGroupPostExists(viewer.companyId, t.groupId, viewer.actorUserId),
    ) ?? sql`false`,
  );
  // Tác giả luôn thấy bài của chính mình — kể cả `org_unit` của đơn vị họ vừa rời, kể cả `group`.
  audienceOr.push(eq(t.authorUserId, viewer.actorUserId));
  return or(...audienceOr) ?? sql`false`;
}
