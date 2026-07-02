/**
 * Hằng quyền + hằng dùng chung cho module Hợp đồng nhân viên — S2-FE-HR-7.
 * Cặp engine (action:resourceType) khớp ĐÚNG apps/api/src/employees/contract.controller.ts:
 *   view:contract (đọc, data-scope Own/Team/Company) · manage:contract (create/update/delete/link-file,
 *   Company-only — employee/manager KHÔNG có grant).
 */
export const CONTRACT_ENGINE_PAIRS = {
  VIEW: { action: "view", resourceType: "contract" },
  MANAGE: { action: "manage", resourceType: "contract" },
} as const;

/** download:foundation-file — dùng để tải file hợp đồng qua download-url TTL-ngắn (KHÔNG lộ storage_path). */
export const FILE_DOWNLOAD_PAIR = { action: "download", resourceType: "foundation-file" } as const;

export const CONTRACT_PATHS = {
  LIST: "/hr/contracts",
  EMPLOYEE_CONTRACTS: (employeeId: string) => `/hr/employees/${employeeId}/contracts`,
} as const;

/** Trạng thái hợp đồng — DB-03 §7.7 (contractStatusEnum). */
export const CONTRACT_STATUSES = ["Draft", "Active", "Expired", "Terminated", "Cancelled"] as const;

/** Ngưỡng mặc định cảnh báo sắp hết hạn khi lọc "expiringOnly" trên FE (server có cấu hình riêng). */
export const CONTRACT_EXPIRING_WITHIN_DAYS_DEFAULT = 30;

export const CONTRACT_PAGE_SIZE = 20;
