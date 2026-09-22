import { sql, type SQL } from "drizzle-orm";
import { feedGroupMembers, feedGroups } from "../db/schema/social";

/**
 * S16-SOCIAL-BE-2A (D3/D13/D14) — vị từ "user X là thành viên ĐANG HOẠT ĐỘNG của nhóm G", dựng
 * MỘT LẦN cho mọi đường dùng.
 *
 * ┌─ VÌ SAO LÀ MODULE HÀM THUẦN, KHÔNG PHẢI METHOD CỦA SERVICE ────────────────────────────────────┐
 * │ Bốn hộ tiêu thụ nằm ở ba tầng khác nhau và KHÔNG import được nhau:                              │
 * │   • `SocialAccessService.visiblePostCondition` (D3 — cổng MÀN HÌNH **và** cổng ĐƯỜNG TẢI)       │
 * │   • `SocialNewsRepository.unackedEmployeesFor` / `.audienceUserIds` (D14-1/2)                   │
 * │   • `resolveMentions` — hàm THUẦN, không có DI (D14-3)                                          │
 * │ Chép vị từ sang từng chỗ là đúng cái đã sinh ra lớp lỗi `read-path-gate-pair-must-match-        │
 * │ download-pair`: bốn bản sao rồi bốn lần trôi khỏi nhau, và chỉ một bản lỏng là rò bài nhóm kín. │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * BA vế, AND với nhau — bỏ vế nào cũng là một lỗ đã có tên:
 *   (a) `m.status='active'` — hàng `pending` là **yêu cầu chờ duyệt**, chưa phải thành viên. Thiếu vế
 *       này thì cứ bấm "xin vào" là đọc được bài nhóm kín.
 *   (b) `g.deleted_at IS NULL` (D13) — nhóm xoá mềm KHÔNG còn là audience của ai. Thiếu vế này thì
 *       sau `034`, thành viên cũ vẫn đăng/đọc/được-nhắc trong nhóm đã xoá, và nhóm public đã xoá vẫn
 *       phát bài cho cả công ty.
 *   (c) `m.company_id = g.company_id` — vế tenant đi CÙNG câu (RLS+FORCE đã ép, nhưng vị từ này còn
 *       được dùng trong các câu JOIN mà người đọc không nhìn thấy `withTenant` ở gần).
 *
 * ⚠️ `userIdExpr` là **biểu thức SQL của người gọi** (cột `employee_profiles.user_id`, `users.id`,
 * hay tham số) — EXISTS tương quan TRONG CÂU, KHÔNG resolve mảng id trước: tập nhóm đổi liên tục nên
 * không chặn trước được như `orgUnitIds`, và một mảng đọc ở tx khác là TOCTOU.
 */
export function activeGroupMemberExists(
  companyId: string,
  groupId: string,
  userIdExpr: SQL | unknown,
): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM ${feedGroupMembers} gm
      JOIN ${feedGroups} g
        ON g.company_id = gm.company_id
       AND g.id = gm.group_id
       AND g.deleted_at IS NULL
     WHERE gm.company_id = ${companyId}
       AND gm.group_id = ${groupId}
       AND gm.user_id = ${userIdExpr}
       AND gm.status = 'active'
  )`;
}
