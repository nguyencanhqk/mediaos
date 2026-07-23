/**
 * S5-GOAL-BE-1 — mã lỗi GOAL (SPEC-10 §12, quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ duy nhất định nghĩa thông điệp ⇒ int-spec assert theo MÃ, không theo câu chữ.
 * Ràng buộc DB (CHECK mig 0504) được PHẢN CHIẾU thành 422 CÓ MÃ ở service — vỡ CHECK = 500 mờ, cấm.
 */
export const GOAL_ERR = {
  /** GOAL-ERR-001 — cấp ↔ neo: đúng 1 cột neo theo cấp, các cột neo khác PHẢI NULL. */
  ANCHOR: (detail: string) => `GOAL-ERR-001: cấp mục tiêu và cột neo không khớp — ${detail}`,
  /** GOAL-ERR-002 — cha không hợp lệ: sai chiều cấp. */
  PARENT_DIRECTION: (detail: string) =>
    `GOAL-ERR-002: mục tiêu cha không hợp lệ (sai chiều cấp) — ${detail}`,
  /** GOAL-ERR-002 — cha không hợp lệ: tạo chu trình trong cây. */
  PARENT_CYCLE:
    "GOAL-ERR-002: mục tiêu cha không hợp lệ — liên kết này tạo chu trình (vòng lặp) trong cây mục tiêu.",
  /** GOAL-ERR-003 — kỳ không hợp lệ. */
  PERIOD: (detail: string) => `GOAL-ERR-003: kỳ mục tiêu không hợp lệ — ${detail}`,
  /** GOAL-ERR-004 — cấp company bị chặn ở MVP (schema đã chừa, bật ở phase sau). */
  LEVEL_COMPANY:
    "GOAL-ERR-004: mục tiêu cấp công ty chưa mở ở phiên bản này — chọn cấp phòng ban/dự án/nhân viên.",
  /** GOAL-ERR-007 — xoá goal còn goal con. */
  HAS_CHILDREN:
    "GOAL-ERR-007: mục tiêu còn mục tiêu con — xoá hoặc di dời mục tiêu con trước (không xoá lan).",
  /** GOAL-ERR-010 — goal nhân viên: employee Active cùng company + owner = employee. */
  EMPLOYEE_GOAL: (detail: string) => `GOAL-ERR-010: mục tiêu nhân viên không hợp lệ — ${detail}`,
  /** GOAL-ERR-011 — weight phải > 0. */
  WEIGHT: "GOAL-ERR-011: trọng số (weight) phải lớn hơn 0.",
  /** GOAL-ERR-012 — progress_mode='project' chỉ hợp lệ với goal cấp dự án. */
  MODE_PROJECT:
    "GOAL-ERR-012: cách đo 'project' chỉ dùng được cho mục tiêu cấp dự án (level='project').",
  /** GOAL-ERR-015 — measure_type='number' + mode manual cần target_value. */
  TARGET_REQUIRED:
    "GOAL-ERR-015: cần nhập chỉ tiêu (target_value) khi cách đo là số và tiến độ nhập tay.",

  /** Không tìm thấy trong CÔNG TY của actor (gồm cả tham chiếu chéo tenant) — KHÔNG lộ tồn tại. */
  NOT_FOUND: "GOAL-ERR-NOT-FOUND: không tìm thấy mục tiêu.",
  REF_NOT_FOUND: (what: string) => `GOAL-ERR-NOT-FOUND: không tìm thấy ${what} trong công ty.`,
  /** Tồn tại trong tenant nhưng NGOÀI phạm vi dữ liệu của actor (minh bạch in-tenant ⇒ 403, không 404). */
  FORBIDDEN: "GOAL-ERR-FORBIDDEN: mục tiêu này nằm ngoài phạm vi dữ liệu của bạn.",
  FORBIDDEN_CREATE:
    "GOAL-ERR-FORBIDDEN: bạn không được tạo/sửa mục tiêu ở phạm vi này (phòng ban/dự án/nhân viên khác).",
  /** Gắn cha là hành vi LIÊN KẾT dữ liệu — chỉ được gắn vào mục tiêu mà actor NHÌN THẤY. */
  FORBIDDEN_PARENT:
    "GOAL-ERR-FORBIDDEN: mục tiêu cha nằm ngoài phạm vi dữ liệu của bạn — không gắn được.",
  /** Actor chưa được liên kết hồ sơ nhân viên ⇒ không suy được người phụ trách. */
  OWNER_UNRESOLVED:
    "GOAL-ERR-010: không xác định được người phụ trách — tài khoản chưa liên kết hồ sơ nhân viên.",
} as const;
