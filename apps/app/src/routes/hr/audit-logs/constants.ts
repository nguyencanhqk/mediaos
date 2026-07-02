/**
 * Hằng dùng cho viewer /hr/audit-logs (S2-FE-HR-6) — lịch sử thay đổi HR.
 *
 * TÁI DÙNG GET /foundation/audit-logs?moduleCode=HR (KHÔNG dựng endpoint mới — hrAuditApi ở
 * @mediaos/web-core). Cổng quyền = cặp ENGINE THẬT ('view','audit-log') seed mig 0340
 * (is_sensitive=true, hiện chỉ grant company-admin) — PIN theo cặp seed, KHÔNG theo mã FE
 * "HR.AUDIT_LOG.VIEW" (bài học drift S1-FND-MODULE: BE gate trên cặp seed thật).
 */
import { HR_ENGINE_PAIRS } from "../constants";

export const HR_AUDIT_LOG_PAGE_SIZE = 25;

/** Chuỗi quyền route-level literal ("view:audit-log") — dùng cho requiredAnyPermissions của RouteMeta. */
export const HR_AUDIT_LOG_VIEW_PERMISSION = `${HR_ENGINE_PAIRS.AUDIT_LOG_VIEW.action}:${HR_ENGINE_PAIRS.AUDIT_LOG_VIEW.resourceType}`;

export const HR_AUDIT_LOGS_QUERY_KEY_ROOT = "hr-audit-logs" as const;
