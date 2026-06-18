import { notInArray, type SQL } from "drizzle-orm";
import { roles } from "../db/schema";

/**
 * Operator-audience system roles — KHÔNG được gán/liệt kê trong tenant plane (chống leo thang đặc quyền).
 *
 * Bối cảnh (CS-2, plan-review HIGH): role `platform-admin` (id …f0, mig 0230) có company_id IS NULL nên
 * RLS bảng `roles` (mig 0005) LỘ nó cho MỌI tenant. Nhưng user giữ role này login phát token aud='operator'
 * (AuthService.PLATFORM_ADMIN_ROLE_ID) → control-plane chéo tenant. Nếu một tenant-admin gán được role này
 * cho user, user đó leo thang RA NGOÀI tenant. Vì vậy phải LOẠI TRỪ role operator khỏi:
 *   - findAssignableRole (permission-admin.repository) — validate trước khi gán role / object-grant role-subject.
 *   - listRoles (org.repository) — danh mục GET /org/roles mà UI render thành lựa chọn.
 *
 * Nguồn sự thật DUY NHẤT cho "role nào = operator audience": khớp đúng tập role id mà AuthService dùng để
 * phát aud='operator'. Thêm role operator mới ⇒ thêm id vào MẢNG này (đồng bộ với AuthService).
 */
export const OPERATOR_ROLE_IDS: readonly string[] = [
  // platform-admin (mig 0230) — god-mode control plane, aud='operator'.
  "00000000-0000-0000-0000-0000000000f0",
];

/**
 * Drizzle predicate: roles.id KHÔNG thuộc tập operator-role. Dùng trong WHERE của mọi truy vấn role mà
 * tenant plane đọc/validate được (KHÔNG để tenant chạm role aud='operator').
 */
export function notOperatorRole(): SQL {
  // notInArray cần mảng mutable → sao chép từ hằng readonly.
  return notInArray(roles.id, [...OPERATOR_ROLE_IDS]);
}
