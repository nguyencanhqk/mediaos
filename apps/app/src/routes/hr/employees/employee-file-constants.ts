/**
 * Cặp quyền Employee File (hồ sơ đính kèm nhân viên) — S2-FE-HR-9 (UI-HR-SCREEN-015).
 *
 * Cặp seed THẬT (migration 0477_s2_hrempfile1_employee_file_perms.sql, controller thật
 * apps/api/src/employees/employee-file.controller.ts): ('file-view'|'file-upload'|'file-delete',
 * 'employee') — grant hr + company-admin, data_scope Company. Đặt file constant riêng trong thư mục
 * employees/ (KHÔNG sửa ../constants.ts — hot-file dùng chung, tránh đụng lane khác) — cùng kỹ thuật
 * FILE_DOWNLOAD_PAIR ở ../contracts/constants.ts.
 */
export const EMPLOYEE_FILE_ENGINE_PAIRS = {
  VIEW: { action: "file-view", resourceType: "employee" },
  UPLOAD: { action: "file-upload", resourceType: "employee" },
  DELETE: { action: "file-delete", resourceType: "employee" },
} as const;
