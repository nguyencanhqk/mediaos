/**
 * Hằng dùng cho viewer Audit log (S2-FE-FND-2 · SYSTEM-SCREEN-AUDIT-LOGS/`system.audit-logs`).
 *
 * CỔNG QUYỀN: cặp ENGINE THỰC ('view','audit-log') — seed mig 0340 (is_sensitive=true, grant
 * company-admin). Đây LÀ CÙNG cặp mà AuditController thật sự @RequirePermission — KHÔNG dùng
 * `view:foundation-audit-log` (cặp seed ở mig 0435 nhưng KHÔNG controller nào enforce; dùng nhầm sẽ
 * tạo hố FE-cho-phép/BE-403, bài học drift S1-FND-MODULE). Nguồn cặp = packages/contracts AUTH_AUDIT_LOG
 * (dùng chung BE+FE, đã dùng bởi system/login-logs).
 *
 * Route `system.audit-logs` đã có sẵn trong ROUTE_REGISTRY (web-core) — component này THAY
 * ModulePlaceholder (router.tsx `systemAuditLogsRoute`), KHÔNG cần RouteMeta cục bộ mới.
 */
import { AUTH_AUDIT_LOG, AUTH_LOG_PAGE_SIZE_DEFAULT } from "@mediaos/contracts";

/** Cặp engine gate trang (dùng useCan(action, resourceType) — khớp thẳng capabilities map). */
export const AUDIT_LOG_VIEW = {
  action: AUTH_AUDIT_LOG.VIEW.action,
  resourceType: AUTH_AUDIT_LOG.RESOURCE,
} as const;

/** Số dòng mỗi trang (dùng chung mặc định với auth-logs — offset/limit ở BE audit dùng limit riêng). */
export const AUDIT_LOG_PAGE_SIZE = AUTH_LOG_PAGE_SIZE_DEFAULT;

/** Query keys (React Query). */
export const AUDIT_LOGS_QUERY_KEY = ["system", "audit-logs"] as const;
export const AUDIT_LOG_DETAIL_QUERY_KEY = ["system", "audit-logs", "detail"] as const;

/** Đường dẫn route (đã đăng ký sẵn trong ROUTE_REGISTRY web-core). */
export const AUDIT_LOGS_PATH = "/system/audit-logs";
export function auditLogDetailPath(id: string): string {
  return `/system/audit-logs/${id}`;
}

/** Endpoint API thật (API-09 FOUNDATION — AuditController Company scope). */
export const AUDIT_LOGS_API = "/foundation/audit-logs";
export function auditLogDetailApi(id: string): string {
  return `/foundation/audit-logs/${id}`;
}
