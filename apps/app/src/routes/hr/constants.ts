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
} as const;

/**
 * Cặp engine tương ứng (action:resourceType) — dùng trực tiếp trong useCan().
 * Khớp với seed DB (mig *_permissions_seed) và PERMISSION_CODE_TO_PAIR trong registry.
 */
export const HR_ENGINE_PAIRS = {
  READ_EMPLOYEE: { action: "read", resourceType: "employee" },
  VIEW_SENSITIVE: { action: "view-sensitive", resourceType: "employee" },
  VIEW_SALARY: { action: "view-salary", resourceType: "employee" },
  CREATE_EMPLOYEE: { action: "create", resourceType: "employee" },
  UPDATE_EMPLOYEE: { action: "update", resourceType: "employee" },
  DELETE_EMPLOYEE: { action: "delete", resourceType: "employee" },
  READ_DEPARTMENT: { action: "read", resourceType: "department" },
  READ_POSITION: { action: "read", resourceType: "position" },
  // job-level / contract-type lookups are gated by manage:master-data on the BE (hr-read.controller).
  MANAGE_MASTER_DATA: { action: "manage", resourceType: "master-data" },
  // S2-FE-HR-4 — cặp seed THẬT mig 0444 (ProfileChangeRequestController):
  //   create:profile-change-request (Own, cả 4 role) · approve:profile-change-request (Company, hr/company-admin).
  // GET :id + POST reject/cancel dùng CÙNG 2 cặp này ở tầng controller — KHÔNG có cặp "view" riêng.
  CREATE_PROFILE_CHANGE_REQUEST: { action: "create", resourceType: "profile-change-request" },
  APPROVE_PROFILE_CHANGE_REQUEST: { action: "approve", resourceType: "profile-change-request" },
} as const;
