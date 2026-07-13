/**
 * Hằng quyền module HR — S2-FE-HR-1.
 * Cấu trúc: HR.RESOURCE.ACTION (SPEC-03 §8.1 + CLAUDE.md §5 quy ước mã).
 * Sử dụng trong useCan(action, resourceType) qua PERMISSION_CODE_TO_PAIR.
 * KHÔNG dùng chuỗi inline / so sánh role trực tiếp.
 */
export const HR_PERMS = {
  EMPLOYEE: {
    VIEW: "HR.EMPLOYEE.VIEW",
    VIEW_SENSITIVE: "HR.EMPLOYEE.VIEW_SENSITIVE",
    CREATE: "HR.EMPLOYEE.CREATE",
    UPDATE: "HR.EMPLOYEE.UPDATE",
    CHANGE_STATUS: "HR.EMPLOYEE.CHANGE_STATUS",
    DELETE: "HR.EMPLOYEE.DELETE",
    EXPORT: "HR.EMPLOYEE.EXPORT",
    FILE_VIEW: "HR.EMPLOYEE.FILE_VIEW",
    FILE_UPLOAD: "HR.EMPLOYEE.FILE_UPLOAD",
    FILE_DELETE: "HR.EMPLOYEE.FILE_DELETE",
  },
  DEPARTMENT: {
    VIEW: "HR.DEPARTMENT.VIEW",
    CREATE: "HR.DEPARTMENT.CREATE",
    UPDATE: "HR.DEPARTMENT.UPDATE",
    DELETE: "HR.DEPARTMENT.DELETE",
  },
  POSITION: {
    VIEW: "HR.POSITION.VIEW",
    CREATE: "HR.POSITION.CREATE",
    UPDATE: "HR.POSITION.UPDATE",
    DELETE: "HR.POSITION.DELETE",
  },
  CONTRACT: {
    VIEW: "HR.CONTRACT.VIEW",
    CREATE: "HR.CONTRACT.CREATE",
    UPDATE: "HR.CONTRACT.UPDATE",
    DELETE: "HR.CONTRACT.DELETE",
  },
  AUDIT_LOG: {
    VIEW: "HR.AUDIT_LOG.VIEW",
  },
  PROFILE_CHANGE_REQUEST: {
    CREATE: "HR.PROFILE_CHANGE_REQUEST.CREATE",
    VIEW_OWN: "HR.PROFILE_CHANGE_REQUEST.VIEW_OWN",
    VIEW: "HR.PROFILE_CHANGE_REQUEST.VIEW",
    APPROVE: "HR.PROFILE_CHANGE_REQUEST.APPROVE",
    REJECT: "HR.PROFILE_CHANGE_REQUEST.REJECT",
    CANCEL_OWN: "HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN",
  },
  // S2-FE-HR-8 — /hr/settings/employee-code (cấu hình mã NV). Cặp seed THẬT mig 0459.
  EMPLOYEE_CODE_CONFIG: {
    VIEW: "HR.EMPLOYEE_CODE_CONFIG.VIEW",
    UPDATE: "HR.EMPLOYEE_CODE_CONFIG.UPDATE",
  },
} as const;

/**
 * Cặp engine tương ứng (action:resourceType) — dùng trực tiếp trong useCan().
 * Khớp với seed DB (mig *_permissions_seed) và PERMISSION_CODE_TO_PAIR trong registry.
 */
export const HR_ENGINE_PAIRS = {
  READ_EMPLOYEE: { action: "read", resourceType: "employee" },
  VIEW_SENSITIVE: { action: "view-sensitive", resourceType: "employee" },
  VIEW_SALARY: { action: "view-salary", resourceType: "employee" },
  // HR-IDENTITY-READ-1 — CCCD/CMND (SPEC-03 §14.18 "Giấy tờ"), HIGHER sensitivity than view-sensitive.
  // Cặp seed THẬT mig 0494 (view-identity:employee, is_sensitive=true, grant employee/Own · hr/Company ·
  // company-admin/Company — KHÔNG manager). PHẢI dùng useCanExact (không useCan) — pair nhạy cảm, tránh
  // *:* wildcard fall-through permit trong khi BE vẫn 403 (allowlisted-cap trả literal key nên Exact khớp).
  VIEW_IDENTITY: { action: "view-identity", resourceType: "employee" },
  CREATE_EMPLOYEE: { action: "create", resourceType: "employee" },
  UPDATE_EMPLOYEE: { action: "update", resourceType: "employee" },
  DELETE_EMPLOYEE: { action: "delete", resourceType: "employee" },
  READ_DEPARTMENT: { action: "read", resourceType: "department" },
  READ_POSITION: { action: "read", resourceType: "position" },
  // job-level / contract-type lookups are gated by manage:master-data on the BE (hr-read.controller).
  MANAGE_MASTER_DATA: { action: "manage", resourceType: "master-data" },
  // S2-FE-HR-6 — /hr/org-chart đọc GET /org/units/tree (BE để READ mở, KHÔNG PermissionGuard riêng —
  // xem org.controller.ts). FE gate hiển thị bằng CÙNG cặp "phòng ban" (read:department, seed mig
  // 0444/0005) để nhất quán trong module HR — KHÔNG bịa cặp "org-chart"/"org_unit" chưa seed.
  ORG_CHART_VIEW: { action: "read", resourceType: "department" },
  // /hr/audit-logs tái dùng GET /foundation/audit-logs?moduleCode=HR — cặp seed THẬT mig 0340
  // (view:audit-log, is_sensitive=true, hiện chỉ grant company-admin). PIN theo cặp seed (bài học
  // drift S1-FND-MODULE) — KHÔNG dùng nhãn "HR.AUDIT_LOG.VIEW" làm cổng-cứng (chưa có pair riêng).
  AUDIT_LOG_VIEW: { action: "view", resourceType: "audit-log" },
  // S2-FE-HR-8 — /hr/settings/employee-code. Cặp seed THẬT mig 0459 (view/update:employee-code-config,
  // is_sensitive=false, grant hr + company-admin, data_scope=Company) + mig 0445 (preview:employee-code,
  // cùng nhóm grant). Controller thật: apps/api/src/employees/employee-code-config.controller.ts.
  VIEW_EMPLOYEE_CODE_CONFIG: { action: "view", resourceType: "employee-code-config" },
  UPDATE_EMPLOYEE_CODE_CONFIG: { action: "update", resourceType: "employee-code-config" },
  PREVIEW_EMPLOYEE_CODE: { action: "preview", resourceType: "employee-code" },
  // S2-FE-HR-4 — cặp seed THẬT mig 0444 (ProfileChangeRequestController):
  //   create:profile-change-request (Own, cả 4 role) · approve:profile-change-request (Company, hr/company-admin).
  // GET :id + POST reject/cancel dùng CÙNG 2 cặp này ở tầng controller — KHÔNG có cặp "view" riêng.
  CREATE_PROFILE_CHANGE_REQUEST: { action: "create", resourceType: "profile-change-request" },
  APPROVE_PROFILE_CHANGE_REQUEST: { action: "approve", resourceType: "profile-change-request" },
} as const;
