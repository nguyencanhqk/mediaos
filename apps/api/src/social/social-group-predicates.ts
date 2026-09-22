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
 * ⚠️ `groupIdExpr`/`userIdExpr` là **biểu thức SQL của người gọi** — một bên là CỘT còn bên kia là
 * tham số, tuỳ đường: `visiblePostCondition` truyền CỘT `feed_posts.group_id` + user literal; hai
 * repository tập-người truyền group literal + CỘT `employee_profiles.user_id`.
 * EXISTS tương quan TRONG CÂU, KHÔNG resolve mảng id trước: tập nhóm đổi liên tục nên không chặn
 * trước được như `orgUnitIds`, và một mảng đọc ở tx khác là TOCTOU.
 */
export function activeGroupMemberExists(
  companyId: string,
  groupIdExpr: SQL | unknown,
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
       AND gm.group_id = ${groupIdExpr}
       AND gm.user_id = ${userIdExpr}
       AND gm.status = 'active'
  )`;
}

/**
 * Vị từ "actor ĐƯỢC ĐỌC bài thuộc nhóm G" — dùng ở **`visiblePostCondition`** (D3), và CHỈ ở đó.
 *
 * ┌─ 🔴 VÌ SAO KHÔNG DÙNG CHUNG `activeGroupMemberExists` ─────────────────────────────────────────┐
 * │ Hai câu hỏi KHÁC NHAU, và gộp lại là sai ở cả hai chiều:                                        │
 * │   • ĐỌC (đây)  = thành viên `active` **HOẶC nhóm `public`** — SPEC-16 §3.4 chỉ giới hạn nhóm    │
 * │     KÍN; bắt phải là thành viên mới đọc được bài nhóm public là chặn nhầm (ca G4).              │
 * │   • TẬP NGƯỜI (`activeGroupMemberExists`) = **chỉ thành viên `active`** — người nhận NOTI-031,  │
 * │     danh sách "chưa đọc", mention. Dùng vị từ ĐỌC ở đó thì một tin trong nhóm public sẽ báo cho │
 * │     CẢ CÔNG TY và liệt cả công ty là "chưa đọc".                                                │
 * │ Cùng một `EXISTS` cho cả hai là cách chắc chắn nhất để một trong hai lỗi đó lọt qua review.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Vế `g.deleted_at IS NULL` có ở CẢ HAI nhánh (D13): nhóm public đã xoá mềm KHÔNG được tiếp tục phát
 * bài ra cả công ty.
 */
export function visibleGroupPostExists(
  companyId: string,
  groupIdExpr: SQL | unknown,
  userIdExpr: SQL | unknown,
): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM ${feedGroups} g
     WHERE g.company_id = ${companyId}
       AND g.id = ${groupIdExpr}
       AND g.deleted_at IS NULL
       AND (
         g.visibility = 'public'
         OR EXISTS (
           SELECT 1 FROM ${feedGroupMembers} gm
            WHERE gm.company_id = g.company_id
              AND gm.group_id = g.id
              AND gm.user_id = ${userIdExpr}
              AND gm.status = 'active'
         )
       )
  )`;
}
