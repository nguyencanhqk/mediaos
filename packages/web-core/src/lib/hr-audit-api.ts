import {
  auditLogListResponseSchema,
  type AuditLogListResponse,
  type AuditLogQuery,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * HR Audit Logs API client — S2-FE-HR-6.
 *
 * TÁI DÙNG endpoint chung GET /foundation/audit-logs (apps/api/src/foundation/audit/audit.controller.ts,
 * AuditQueryService) — KHÔNG dựng endpoint mới. Gate: view:audit-log (cặp seed THẬT mig 0340,
 * is_sensitive=true, grant company-admin). Lọc theo module HR qua `moduleCode=HR` (DB-08 §8.5 filter,
 * packages/contracts/src/observability.ts). before/after/oldValues/newValues ĐÃ redact phía server
 * (BẤT BIẾN #3) — client CHỈ render field DTO trả về, KHÔNG tự suy field bị ẩn.
 */

const HR_MODULE_CODE = "HR" as const;

export type HrAuditLogQuery = Omit<Partial<AuditLogQuery>, "moduleCode">;

export const hrAuditApi = {
  /** GET /foundation/audit-logs?moduleCode=HR — lịch sử thay đổi HR (phân trang offset/limit + total). */
  listHrAuditLogs: (query: HrAuditLogQuery = {}): Promise<AuditLogListResponse> => {
    const qs = buildQueryString({ ...query, moduleCode: HR_MODULE_CODE });
    return apiFetch(`/foundation/audit-logs${qs}`, auditLogListResponseSchema);
  },
};
