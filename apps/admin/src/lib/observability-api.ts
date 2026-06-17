import {
  auditLogListResponseSchema,
  queueStatusResponseSchema,
  type AuditLogListResponse,
  type AuditLogQuery,
  type QueueStatusResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * AC-8 Observability API client (audit viewer + queue monitor).
 *
 * Map 1-1 vào AuditReadController + QueueMonitorController:
 *   - GET /tenant/audit               (tenant self — view:audit-log)
 *   - GET /admin/platform/audit       (operator cross-tenant — view:platform-audit + step-up)
 *   - GET /admin/platform/queue       (operator cross-tenant — view:platform-audit + step-up)
 *
 * `apiFetch` tự gắn Bearer + gỡ envelope + Zod-parse. Permission server ép; FE chỉ gate UI.
 */

function buildAuditQuery(q: Partial<AuditLogQuery>): string {
  const qs = new URLSearchParams();
  if (q.action) qs.set("action", q.action);
  if (q.objectType) qs.set("objectType", q.objectType);
  if (q.objectId) qs.set("objectId", q.objectId);
  if (q.actorUserId) qs.set("actorUserId", q.actorUserId);
  if (q.companyId) qs.set("companyId", q.companyId);
  if (q.dateFrom) qs.set("dateFrom", q.dateFrom);
  if (q.dateTo) qs.set("dateTo", q.dateTo);
  if (q.limit != null) qs.set("limit", String(q.limit));
  if (q.offset != null) qs.set("offset", String(q.offset));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const observabilityApi = {
  /** Audit của TENANT mình (company-admin). */
  listTenantAudit: (q: Partial<AuditLogQuery> = {}): Promise<AuditLogListResponse> =>
    apiFetch(`/tenant/audit${buildAuditQuery(q)}`, auditLogListResponseSchema),

  /** Audit CHÉO tenant (operator, optional ?companyId). */
  listPlatformAudit: (q: Partial<AuditLogQuery> = {}): Promise<AuditLogListResponse> =>
    apiFetch(`/admin/platform/audit${buildAuditQuery(q)}`, auditLogListResponseSchema),

  /** Queue monitor cross-tenant (operator). */
  getQueueStatus: (limit?: number): Promise<QueueStatusResponse> =>
    apiFetch(
      `/admin/platform/queue${limit != null ? `?limit=${limit}` : ""}`,
      queueStatusResponseSchema,
    ),
};
