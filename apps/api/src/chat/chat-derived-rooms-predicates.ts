import { sql, type SQL } from "drizzle-orm";

/**
 * S7-CHAT-BE-5 — VỊ TỪ "tập thành viên MONG MUỐN" của phòng dẫn xuất. **Bản sao DUY NHẤT.**
 *
 * Owner chốt 02/08/2026 (SPEC-15 §13.3, khối "Làm rõ"): hook thời-gian-thực và job đối soát PHẢI dùng
 * CÙNG một vị từ. Ở đây điều đó được ép mạnh hơn "cùng hằng số": hook và job chạy **cùng đúng một câu
 * SQL**, chỉ khác bộ lọc thu hẹp (`userId`/`roomId`). Không có đường nào để hai bên trôi khỏi nhau mà
 * typecheck vẫn xanh — thứ đã xảy ra với công thức đếm chưa đọc ở BE-1/BE-2 (vá ở GATE-2).
 *
 * ⚠️ File này KHÔNG ghi gì. Nó chỉ dựng mệnh đề `SELECT (room_id, user_id)`; mọi câu ghi nằm ở
 * `chat-derived-rooms-sync.service.ts` và đều nhúng lại vị từ này NGAY TRONG `WHERE` của chính câu ghi
 * (không đọc trước rồi ghi theo danh sách cũ — xem §3.4 H3 của micro-plan).
 */

/**
 * `org_units.type` được sinh phòng chat — CHỐT chỉ `department` (micro-plan §3.8).
 *
 * 5 loại tồn tại ở DB (`org_units_type_check`): department · division · unit · office · branch. Bốn loại
 * còn lại là node phân cấp của cây tổ chức, thường 0 nhân viên gán trực tiếp ⇒ mở cho chúng là đẻ hàng
 * loạt phòng rỗng. Mở rộng tập này là quyết định sản phẩm của owner, KHÔNG phải tối ưu kỹ thuật.
 *
 * Dùng ở CẢ hai đầu: hook W1/W2 (kiểm `type` trước khi tạo phòng) và Pha 1 SCAN của job.
 */
export const CHAT_ROOM_ELIGIBLE_ORG_UNIT_TYPES = ["department"] as const;

/** `chat_rooms.sync_source` của phòng do hệ thống dẫn xuất — phòng `manual` KHÔNG BAO GIỜ bị job đụng. */
export const CHAT_DERIVED_SYNC_SOURCES = ["department", "project"] as const;

/**
 * Bộ lọc THU HẸP. Cả hai đều tuỳ chọn và cộng dồn:
 *   • `userId` — hook: chỉ tính lại cho ĐÚNG một người vừa bị ghi.
 *   • `roomId` — seed thành viên cho ĐÚNG một phòng vừa tạo (Pha 2).
 * Không truyền gì = toàn tenant (Pha 3 của job).
 */
export interface DerivedMembershipScope {
  userId?: string;
  roomId?: string;
}

/**
 * Hai vế thu hẹp. Viết TƯỜNG MINH bằng `sql` (không `sql.raw` với alias truyền vào): alias là thứ chỉ tồn
 * tại trong chính câu SQL bao quanh, nên nhận nó qua tham số chuỗi biến một lỗi đổi-tên-alias thành
 * `42P01`/`42703` lúc chạy mà typecheck hoàn toàn mù.
 */
function narrow(scope: DerivedMembershipScope): SQL {
  const parts: SQL[] = [];
  if (scope.userId) parts.push(sql`AND ep.user_id = ${scope.userId}::uuid`);
  if (scope.roomId) parts.push(sql`AND r.id = ${scope.roomId}::uuid`);
  return parts.length > 0 ? sql.join(parts, sql` `) : sql``;
}

/**
 * Phòng dẫn xuất ĐANG trong vòng đồng bộ: chưa xoá mềm và chưa lưu trữ.
 *
 * Vế `is_archived = false` xuất hiện ĐỒNG THỜI ở đây và ở phạm vi câu RỜI (`applyLeavesTx`) — cặp đó
 * làm cho lưu trữ phòng = **đóng băng** danh sách thành viên: không ai bị thêm, không ai bị đuổi.
 *
 * Chỉ có ở một vế là đủ để hỏng: nếu phòng archived vắng mặt ở tập mong muốn nhưng vẫn nằm trong phạm vi
 * câu RỜI, thì đóng dự án (W4) sẽ SET `left_at` cho toàn bộ thành viên — và vì `listRoomsForUser` đòi
 * `left_at IS NULL` KỂ CẢ ở danh sách `archived=true`, họ mất luôn đường đọc lại lịch sử dự án đã đóng.
 */
const ROOM_OPEN = sql`r.deleted_at IS NULL AND r.is_archived = false`;

/**
 * (A) Phòng `department`: người đủ điều kiện = hồ sơ nhân viên ĐANG LÀM VIỆC, chưa xoá mềm, CÓ tài khoản,
 * và `org_unit_id` trỏ đúng org_unit của phòng.
 *
 * `user_id IS NOT NULL` không phải điều kiện thêm mà là điều kiện vốn đã ngầm định: `chat_room_members`
 * khoá theo `user_id`, không theo `employee_id` — nhân viên chưa có tài khoản KHÔNG có gì để thêm vào
 * phòng. Viết ra để nhịp đọc sau không phải suy luận lại (micro-plan rev 3 B1).
 */
export function desiredDepartmentPairsSql(companyId: string, scope: DerivedMembershipScope): SQL {
  return sql`
    SELECT r.id AS room_id, ep.user_id AS user_id
    FROM employee_profiles ep
    JOIN chat_rooms r
      ON r.company_id = ep.company_id
     AND r.org_unit_id = ep.org_unit_id
    WHERE ep.company_id = ${companyId}::uuid
      AND r.company_id = ${companyId}::uuid
      AND r.sync_source = 'department'
      AND ${ROOM_OPEN}
      AND ep.status = 'active'
      AND ep.deleted_at IS NULL
      AND ep.user_id IS NOT NULL
      ${narrow(scope)}
  `;
}

/**
 * (B) Phòng `project`: thành viên dự án ĐANG hoạt động **và** người đó còn đang làm việc.
 *
 * Hai vế, không phải một:
 *   • `project_members.member_status = 'Active' AND deleted_at IS NULL` — khuôn CHUẨN đã dùng ở
 *     `ProjectsRepository.buildScopeExists`; `member_status IS NULL` (hàng legacy trước mig 0478) KHÔNG
 *     được coi là Active — nhất quán với phần còn lại của hệ (panel TASK cũng không thấy họ là active).
 *   • JOIN `employee_profiles` đòi `status='active' AND deleted_at IS NULL` — **vế rev 2 bỏ sót**.
 *     `project_members` không biết gì về việc người đó đã nghỉ việc hay chưa: `changeStatus` không chạm
 *     bảng đó, nên thiếu vế này thì nhịp job kế tiếp **join lại người vừa nghỉ việc** vào phòng dự án,
 *     trong khi phòng phòng-ban đã đuổi họ đúng — hỏng-một-nửa, khó thấy nhất (micro-plan rev 3 B1).
 *
 * Nối `chat_room_members.user_id` qua `ep.user_id` (KHÔNG qua `project_members.user_id` legacy): danh
 * tính chat phải đến từ CÙNG nguồn với vế (A), nếu không hai phòng của cùng một người có thể mang hai
 * user khác nhau khi dữ liệu legacy lệch.
 */
export function desiredProjectPairsSql(companyId: string, scope: DerivedMembershipScope): SQL {
  return sql`
    SELECT r.id AS room_id, ep.user_id AS user_id
    FROM project_members pm
    JOIN employee_profiles ep
      ON ep.company_id = pm.company_id
     AND ep.id = pm.employee_id
    JOIN chat_rooms r
      ON r.company_id = pm.company_id
     AND r.ref_id = pm.project_id
    WHERE pm.company_id = ${companyId}::uuid
      AND ep.company_id = ${companyId}::uuid
      AND r.company_id = ${companyId}::uuid
      AND r.sync_source = 'project'
      AND ${ROOM_OPEN}
      AND pm.member_status = 'Active'
      AND pm.deleted_at IS NULL
      AND ep.status = 'active'
      AND ep.deleted_at IS NULL
      AND ep.user_id IS NOT NULL
      ${narrow(scope)}
  `;
}

/**
 * (A) ∪ (B) — tập `(room_id, user_id)` mong muốn của MỌI phòng dẫn xuất trong phạm vi `scope`.
 *
 * `UNION` (không `UNION ALL`): một người có thể vừa ở phòng ban vừa ở dự án, nhưng cùng một cặp
 * (room_id,user_id) không được xuất hiện hai lần — trùng lặp sẽ làm `ON CONFLICT DO UPDATE` của câu
 * INSERT gặp "cardinality violation" (Postgres cấm cùng một hàng đích bị đụng hai lần trong một câu).
 */
export function desiredDerivedPairsSql(companyId: string, scope: DerivedMembershipScope): SQL {
  return sql`(
    ${desiredDepartmentPairsSql(companyId, scope)}
    UNION
    ${desiredProjectPairsSql(companyId, scope)}
  )`;
}
