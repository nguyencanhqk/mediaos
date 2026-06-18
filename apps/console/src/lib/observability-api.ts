import {
  auditLogListResponseSchema,
  type AuditLogListResponse,
  type AuditLogQuery,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Observability API client cho apps/console (Hệ thống — tenant plane).
 *
 * Chỉ expose endpoint TENANT SELF:
 *   GET /tenant/audit  (view:audit-log — server ép RLS + withTenant(JWT.companyId))
 *
 * KHÔNG expose platform/operator endpoint (apps/admin lo phần đó).
 */

function buildAuditQuery(q: Partial<AuditLogQuery>): string {
  const qs = new URLSearchParams();
  if (q.action) qs.set("action", q.action);
  if (q.objectType) qs.set("objectType", q.objectType);
  if (q.objectId) qs.set("objectId", q.objectId);
  if (q.actorUserId) qs.set("actorUserId", q.actorUserId);
  if (q.dateFrom) qs.set("dateFrom", q.dateFrom);
  if (q.dateTo) qs.set("dateTo", q.dateTo);
  if (q.limit != null) qs.set("limit", String(q.limit));
  if (q.offset != null) qs.set("offset", String(q.offset));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const observabilityApi = {
  /** Audit của tenant mình (company-admin, view:audit-log). */
  listTenantAudit: (q: Partial<AuditLogQuery> = {}): Promise<AuditLogListResponse> =>
    apiFetch(`/tenant/audit${buildAuditQuery(q)}`, auditLogListResponseSchema),
};
