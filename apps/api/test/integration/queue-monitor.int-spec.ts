/**
 * AC-8 — QueueMonitorService + AuditReadService cross-tenant (DB cô lập mediaos_ac8). Service THẬT.
 *
 *  (1) getQueueStatus đếm outbox theo status + dead-letter unresolved/total CHÉO tenant (A+B) qua
 *      withPlatformReadContext; row-cap dead-letter clamp [1..MAX].
 *  (2) MỖI lần đọc cross-tenant GHI operator-action audit (action='operator.queue_read' /
 *      'operator.audit_read') company_id=home operator, object_type='company' (forensic gap=0).
 *  (3) REDACTION: audit row object_type nhạy cảm (salary_profile) → before/after KHÔNG lộ payload trong DTO.
 *  (4) ROW-CAP: listCrossTenant clamp limit > MAX về MAX (chống unbounded §8.3).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AUDIT_PAGE_LIMIT } from "@mediaos/contracts";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { AuditReadService } from "../../src/observability/audit-read.service";
import { QueueMonitorService } from "../../src/observability/queue-monitor.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

async function seedOutbox(
  direct: import("pg").Pool,
  companyId: string,
  status: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO outbox_events (company_id, event_type, payload, status) VALUES ($1,'task.created','{}'::jsonb,$2) RETURNING id`,
    [companyId, status],
  );
  return r.rows[0].id as string;
}

async function seedDeadLetter(
  direct: import("pg").Pool,
  companyId: string,
  eventId: string,
  resolved: boolean,
): Promise<void> {
  await direct.query(
    `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error, resolved_at)
     VALUES ($1,$2,$3,'task.created','{}'::jsonb,'boom',$4)`,
    [companyId, eventId, `c-${randomUUID().slice(0, 6)}`, resolved ? new Date() : null],
  );
}

describe.skipIf(!hasDb)("AC-8 queue-monitor + audit cross-tenant (service)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let operatorId: string;
  let queueMonitor: QueueMonitorService;
  let auditRead: AuditReadService;

  beforeAll(async () => {
    A = await seedCompany(direct, "qmA");
    B = await seedCompany(direct, "qmB");
    operatorId = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);

    // outbox: A pending+done, B failed.
    const aPending = await seedOutbox(direct, A.companyId, "pending");
    await seedOutbox(direct, A.companyId, "done");
    const bFailed = await seedOutbox(direct, B.companyId, "failed");
    // dead-letter: A unresolved, B resolved.
    await seedDeadLetter(direct, A.companyId, aPending, false);
    await seedDeadLetter(direct, B.companyId, bFailed, true);

    // audit nhạy cảm (salary_profile) ở B — phải redact khi operator đọc chéo tenant.
    await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type, after) VALUES ($1,'SalarySet','salary_profile',$2)`,
      [B.companyId, JSON.stringify({ baseSalary: 99000000, bankAccount: "999" })],
    );

    const db = new DatabaseService();
    const opAudit = new OperatorActionAuditService(new AuditService());
    queueMonitor = new QueueMonitorService(db, opAudit);
    auditRead = new AuditReadService(db, opAudit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("(1) getQueueStatus đếm outbox theo status + dead-letter unresolved/total chéo tenant", async () => {
    const res = await queueMonitor.getQueueStatus({ id: operatorId, companyId: A.companyId });
    const byStatus = Object.fromEntries(res.outbox.counts.map((c) => [c.status, c.count]));
    expect(byStatus.pending).toBeGreaterThanOrEqual(1);
    expect(byStatus.done).toBeGreaterThanOrEqual(1);
    expect(byStatus.failed).toBeGreaterThanOrEqual(1);
    expect(res.outbox.total).toBeGreaterThanOrEqual(3);
    expect(res.deadLetter.total).toBeGreaterThanOrEqual(2);
    expect(res.deadLetter.unresolved).toBeGreaterThanOrEqual(1);
    // dead-letter rows KHÔNG có payload thô (chỉ metadata + error).
    for (const row of res.deadLetter.rows) {
      expect(row).not.toHaveProperty("payload");
      expect(typeof row.error).toBe("string");
    }
  });

  it("(2) getQueueStatus GHI operator-action audit (operator.queue_read) company_id=home, object_type=company", async () => {
    await queueMonitor.getQueueStatus({ id: operatorId, companyId: A.companyId });
    const r = await direct.query(
      `SELECT company_id, actor_user_id, object_type FROM audit_logs
        WHERE action='operator.queue_read' AND actor_user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [operatorId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].company_id).toBe(A.companyId);
    expect(r.rows[0].object_type).toBe("company");
  });

  it("(2b) listCrossTenant GHI operator-action audit (operator.audit_read)", async () => {
    await auditRead.listCrossTenant({ id: operatorId, companyId: A.companyId }, { limit: 50, offset: 0 });
    const r = await direct.query(
      `SELECT count(*)::int AS c FROM audit_logs WHERE action='operator.audit_read' AND actor_user_id=$1`,
      [operatorId],
    );
    expect(r.rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it("(3) REDACTION: operator đọc chéo tenant ⇒ salary_profile before/after KHÔNG lộ payload", async () => {
    const res = await auditRead.listCrossTenant(
      { id: operatorId, companyId: A.companyId },
      { objectType: "salary_profile", limit: 50, offset: 0 },
    );
    const salaryRow = res.data.find((r) => r.objectType === "salary_profile");
    expect(salaryRow).toBeDefined();
    expect(JSON.stringify(salaryRow)).not.toContain("99000000");
    expect(JSON.stringify(salaryRow)).not.toContain("bankAccount");
    expect(salaryRow?.after).toEqual({ redacted: true });
  });

  it("(4) ROW-CAP: listCrossTenant clamp limit > MAX về MAX", async () => {
    const res = await auditRead.listCrossTenant(
      { id: operatorId, companyId: A.companyId },
      { limit: (MAX_AUDIT_PAGE_LIMIT + 500) as number, offset: 0 },
    );
    expect(res.meta.limit).toBe(MAX_AUDIT_PAGE_LIMIT);
  });

  it("(4b) listCrossTenant ?companyId filter chỉ trả audit của tenant đó", async () => {
    const res = await auditRead.listCrossTenant(
      { id: operatorId, companyId: A.companyId },
      { companyId: B.companyId, limit: 100, offset: 0 },
    );
    for (const row of res.data) expect(row.companyId).toBe(B.companyId);
  });
});
