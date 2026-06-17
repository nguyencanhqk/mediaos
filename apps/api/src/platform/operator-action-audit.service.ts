import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";

/** Args for an operator (platform-admin) action against a target tenant. */
export interface OperatorActionEntry {
  /** The platform-admin user performing the action (audit actor). */
  operatorId: string;
  /** The tenant the action targets — the audit row MUST land with company_id = this tenant. */
  targetTenantId: string;
  /** Action label, e.g. 'operator.company_suspended'. */
  action: string;
  /** Optional object pointer (e.g. the company id). Reuses object_type='company'. */
  objectId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * OperatorActionAuditService (🔒 AC-0b) — thin seam to record an operator action against a target tenant.
 *
 * Reuses AuditService.record INSIDE the caller's `withTenant(targetTenantId)` tx (rollback-safe: the audit
 * row commits/rolls back with the write). Because the tx GUC is set to the target tenant, the audit row's
 * company_id DEFAULT resolves to the TARGET — so the row lands with company_id = targetTenantId and
 * actor_user_id = operatorId (forensic answer to "which operator touched which tenant").
 *
 * Reuses object_type='company' (NO audit object_type CHECK / schema change). The caller MUST already be
 * inside `db.withTenant(targetTenantId, tx => ...)` — this service does NOT open its own tx (so it stays
 * atomic with the mutation it audits).
 */
@Injectable()
export class OperatorActionAuditService {
  constructor(private readonly audit: AuditService) {}

  /** Record an operator action. Call INSIDE `withTenant(entry.targetTenantId)` (atomic with the write). */
  async recordOperatorAction(tx: TenantTx, entry: OperatorActionEntry): Promise<void> {
    await this.audit.record(tx, {
      action: entry.action,
      objectType: "company",
      objectId: entry.objectId ?? entry.targetTenantId,
      actorUserId: entry.operatorId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      userAgent: entry.userAgent,
    });
  }
}
