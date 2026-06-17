/**
 * AC-9 db-ops break-glass SoD (DB cô lập mediaos_ac9) — RED-first deny-path, mirror break-glass-grant.service.
 *
 * Chứng minh SoD ÉP 3 tầng (UNIQUE + CHECK + service COUNT DISTINCT):
 *   (a) tự-duyệt → 403 (ForbiddenException);
 *   (b) duyệt-trùng (cùng approver) → 409 (UNIQUE 23505);
 *   (c) <2 approver KHÁC NHAU → KHÔNG flip 'active' (vẫn pending);
 *   (d) ≥2 distinct approver → flip 'active';
 *   (e) grant expired → 410 (GoneException) khi approve;
 *   (f) revoked → 410/409.
 *
 * Bảng db_ops_* GLOBAL no-RLS operator-scoped (target_tenant_id, KHÔNG company_id) ⇒ KHÔNG withTenant cho
 * grant FSM. Permission gate: operator có manage:db-ops (grant tường minh mig 0345) ⇒ ALLOW.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { DbOpsGrantService } from "../../src/db-ops/db-ops-grant.service";
import { DbOpsGrantRepository } from "../../src/db-ops/db-ops-grant.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole, type SeededTenant } from "../helpers/seed";

const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

async function cleanupDbOps(direct: import("pg").Pool, grantIds: string[]): Promise<void> {
  if (grantIds.length === 0) return;
  await direct.query("DELETE FROM db_ops_grant_approvals WHERE grant_id = ANY($1::uuid[])", [
    grantIds,
  ]);
  await direct.query("DELETE FROM db_ops_grants WHERE id = ANY($1::uuid[])", [grantIds]);
}

describe.skipIf(!hasDb)("AC-9 db-ops break-glass SoD", () => {
  const direct = directPool();
  let A: SeededTenant;
  let op1: { id: string; companyId: string };
  let op2id: string;
  let op3id: string;
  let service: DbOpsGrantService;
  const createdGrants: string[] = [];

  beforeAll(async () => {
    A = await seedCompany(direct, "ac9sod");
    const u1 = await seedUser(direct, A.companyId, `op1-${randomUUID().slice(0, 8)}@a.test`);
    op1 = { id: u1, companyId: A.companyId };
    await seedUserRole(direct, u1, PLATFORM_ADMIN_ROLE, A.companyId);
    op2id = await seedUser(direct, A.companyId, `op2-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, op2id, PLATFORM_ADMIN_ROLE, A.companyId);
    op3id = await seedUser(direct, A.companyId, `op3-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, op3id, PLATFORM_ADMIN_ROLE, A.companyId);

    const db = new DatabaseService();
    const permission = new PermissionService(new PermissionRepository(db));
    service = new DbOpsGrantService(
      db,
      new DbOpsGrantRepository(),
      permission,
      new OperatorActionAuditService(new AuditService()),
    );
  });

  afterAll(async () => {
    await cleanupDbOps(direct, createdGrants);
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  async function makeGrant(targetTenantId: string | null = null): Promise<string> {
    const dto = await service.requestGrant(op1, {
      targetTenantId,
      reason: `incident ${randomUUID().slice(0, 6)}`,
      ttlSeconds: 3600,
    });
    createdGrants.push(dto.id);
    return dto.id;
  }

  it("(a) requester tự-duyệt → 403", async () => {
    const id = await makeGrant(A.companyId);
    await expect(service.approveGrant(op1, id)).rejects.toMatchObject({ status: 403 });
  });

  it("(b) duyệt-trùng (cùng approver) → 409", async () => {
    const id = await makeGrant(A.companyId);
    await service.approveGrant({ id: op2id, companyId: A.companyId }, id);
    await expect(
      service.approveGrant({ id: op2id, companyId: A.companyId }, id),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("(c) 1 approver → KHÔNG flip 'active' (vẫn pending)", async () => {
    const id = await makeGrant(A.companyId);
    const dto = await service.approveGrant({ id: op2id, companyId: A.companyId }, id);
    expect(dto.status).toBe("pending");
    expect(dto.approvalCount).toBe(1);
  });

  it("(d) ≥2 distinct approver → flip 'active'", async () => {
    const id = await makeGrant(A.companyId);
    await service.approveGrant({ id: op2id, companyId: A.companyId }, id);
    const dto = await service.approveGrant({ id: op3id, companyId: A.companyId }, id);
    expect(dto.status).toBe("active");
    expect(dto.approvalCount).toBeGreaterThanOrEqual(2);
  });

  it("(e) grant expired → 410 khi approve", async () => {
    const id = await makeGrant(A.companyId);
    // Force-expire qua direct (bypass app column-grant; test-only). Đẩy CẢ created_at lùi xa hơn để giữ
    // CHECK expires_at > created_at (grant không thể "born expired"; chỉ già đi theo thời gian thực).
    await direct.query(
      "UPDATE db_ops_grants SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    await expect(
      service.approveGrant({ id: op2id, companyId: A.companyId }, id),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("(f) revoked grant → KHÔNG approve được (410)", async () => {
    const id = await makeGrant(A.companyId);
    await service.revokeGrant(op1, id);
    await expect(
      service.approveGrant({ id: op2id, companyId: A.companyId }, id),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("(g) revoke 2 lần → 409", async () => {
    const id = await makeGrant(A.companyId);
    await service.revokeGrant(op1, id);
    await expect(service.revokeGrant(op1, id)).rejects.toMatchObject({ status: 409 });
  });

  it("(h) deny-audit (self-approval) ghi NGOÀI tx (audit_logs có row operator.db_grant_denied)", async () => {
    const id = await makeGrant(A.companyId);
    await expect(service.approveGrant(op1, id)).rejects.toMatchObject({ status: 403 });
    const { rows } = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action = 'operator.db_grant_denied' AND object_id = $1",
      [id],
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(1);
  });
});
