/**
 * S2-AUTH-PERMUX-1 — nhãn tiếng Việt cho cặp quyền (action, resource_type).
 *
 * CHỈ là hiển thị (UI-sugar): map phủ module MVP (AUTH·HR·ATT·LEAVE·FOUNDATION·TASK·NOTI·DASH);
 * cặp ngoài map (kể cả resource parked media/finance/payroll) FALLBACK mã thô — KHÔNG che mã seed
 * (UI luôn kèm mã thô để trace về migration/spec, tránh drift nhãn↔seed).
 */

const RESOURCE_LABELS: Record<string, string> = {
  // AUTH
  user: "Người dùng",
  role: "Vai trò",
  permission: "Quyền",
  "api-key": "Khóa API",
  me: "Tài khoản của tôi",
  // HR
  employee: "Hồ sơ nhân viên",
  "employee-code": "Mã nhân viên",
  "employee-code-config": "Cấu hình mã nhân viên",
  department: "Phòng ban",
  org_unit: "Đơn vị tổ chức",
  position: "Chức danh",
  team: "Đội nhóm",
  contract: "Hợp đồng lao động",
  "profile-change-request": "Yêu cầu sửa hồ sơ",
  "master-data": "Dữ liệu nền HR",
  employee_report: "Báo cáo nhân sự",
  // ATT
  attendance: "Chấm công",
  adjustment: "Điều chỉnh công",
  "attendance-rule": "Quy tắc chấm công",
  "attendance-audit-log": "Nhật ký chấm công",
  attendance_report: "Báo cáo chấm công",
  shift: "Ca làm việc",
  "shift-assignment": "Phân ca",
  "remote-request": "Yêu cầu làm từ xa",
  // LEAVE
  leave: "Nghỉ phép",
  "leave-type": "Loại nghỉ phép",
  "leave-policy": "Chính sách nghỉ phép",
  "leave-balance": "Số dư phép",
  "leave-calendar": "Lịch nghỉ",
  "leave-file": "Tệp đính kèm nghỉ phép",
  "leave-audit-log": "Nhật ký nghỉ phép",
  // TASK
  task: "Công việc",
  project: "Dự án",
  project_state: "Trạng thái dự án",
  comment: "Bình luận",
  label: "Nhãn",
  step: "Bước công việc",
  "approval-request": "Yêu cầu phê duyệt",
  // NOTI / DASH
  notification: "Thông báo",
  notification_preference: "Tùy chọn thông báo",
  notification_rule: "Quy tắc thông báo",
  dashboard: "Dashboard",
  // FOUNDATION / SYSTEM
  company: "Công ty",
  "foundation-company": "Hồ sơ công ty",
  "foundation-setting": "Cấu hình hệ thống",
  "foundation-holiday": "Ngày nghỉ lễ",
  "foundation-file": "Tệp tin",
  "foundation-file-access-log": "Nhật ký truy cập tệp",
  "foundation-audit-log": "Audit log",
  "foundation-module": "Danh mục module",
  "foundation-retention": "Chính sách lưu trữ",
  "foundation-sequence": "Bộ đếm mã",
  "foundation-seed": "Trạng thái seed",
  "foundation-job": "Tác vụ hệ thống",
  "module-toggle": "Bật/tắt module",
  "system-module": "Module hệ thống",
  "audit-log": "Audit log",
  branding: "Nhận diện thương hiệu",
  webhook: "Webhook",
};

const ACTION_LABELS: Record<string, string> = {
  view: "Xem",
  "view-own": "Xem của mình",
  "view-team": "Xem của đội",
  "view-company": "Xem toàn công ty",
  "view-detail": "Xem chi tiết",
  "view-sensitive": "Xem dữ liệu nhạy cảm",
  "view-salary": "Xem lương",
  read: "Đọc",
  create: "Tạo",
  "create-own": "Tự tạo (của mình)",
  update: "Sửa",
  "update-draft": "Sửa bản nháp",
  delete: "Xóa",
  "delete-user": "Xóa người dùng",
  "delete-employee": "Xóa hồ sơ nhân viên",
  approve: "Phê duyệt",
  reject: "Từ chối",
  cancel: "Hủy",
  "cancel-own": "Tự hủy (của mình)",
  "cancel-any": "Hủy bất kỳ",
  submit: "Gửi duyệt",
  assign: "Gán",
  "assign-role": "Gán vai trò",
  revoke: "Thu hồi",
  invite: "Mời",
  lock: "Khóa",
  unlock: "Mở khóa",
  suspend: "Đình chỉ",
  restore: "Khôi phục",
  export: "Xuất dữ liệu",
  import: "Nhập dữ liệu",
  download: "Tải xuống",
  upload: "Tải lên",
  manage: "Quản trị",
  config: "Cấu hình",
  "change-status": "Đổi trạng thái",
  "change-role": "Đổi vai trò",
  "check-in": "Chấm công vào",
  "check-out": "Chấm công ra",
  adjust: "Điều chỉnh",
  "adjust-direct": "Điều chỉnh trực tiếp",
  "reset-2fa": "Đặt lại 2FA",
  "grant-object-permission": "Cấp quyền theo đối tượng",
  link: "Liên kết",
  unlink: "Gỡ liên kết",
  preview: "Xem trước",
  publish: "Công bố",
  run: "Chạy",
  mark_read: "Đánh dấu đã đọc",
  comment: "Bình luận",
  "system-manage": "Quản trị hệ thống",
};

const SCOPE_LABELS: Record<string, string> = {
  Own: "Bản thân",
  Team: "Đội",
  Department: "Phòng ban",
  Company: "Công ty",
  System: "Hệ thống",
};

export function labelResource(resourceType: string): string {
  return RESOURCE_LABELS[resourceType] ?? resourceType;
}

export function labelAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function labelScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

/** Có nhãn tiếng Việt thật (khác mã thô) không — UI dùng để quyết định hiện mã kèm hay không. */
export function hasResourceLabel(resourceType: string): boolean {
  return resourceType in RESOURCE_LABELS;
}
