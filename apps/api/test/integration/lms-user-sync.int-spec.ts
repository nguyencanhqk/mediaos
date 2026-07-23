/**
 * S5-LMS-BE-1 — auto-sync tài khoản MediaOS→LMS. Postgres THẬT, DB CÔ LẬP (cần mig 0509 cho audit type
 * 'lms_sync' — nhánh off DB-1). Producer + Job dựng TRỰC TIẾP với DatabaseService/AuditService/OutboxService
 * THẬT (KHÔNG mock DB) ⇒ query resolve + RLS + outbox insert + audit CHECK/enum chạy thật.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated test/integration/**.
 *
 * Phủ (plan §4) — trọng tâm CROWN: cô lập tenant (BẤT BIẾN #1) + rollback cùng-tx + audit summary không PII:
 *   I1  producer enqueue eventType riêng payload {email,active} (active suy từ user×profile status).
 *   I4  userId null → 0 event.  I11 user không hồ sơ → 0 event.
 *   I8  thiếu LMS_COMPANY_ID → producer/job tắt sạch.
 *   I9  job reconcile: quét đúng users, POST mang name, audit 'lms_sync' actorType Job ĐẾM (không email list).
 *   I10 ISOLATION 2-tenant: company B (≠ LMS_COMPANY_ID) — producer + job KHÔNG enqueue/POST/audit.
 *   I12 rollback: enqueue trong tx rồi tx throw → outbox event BIẾN MẤT (chứng minh transactional outbox).
 *
 * Wire-in HrWriteService.changeStatus / AuthUsersService.lock-unlock (gọi producer đúng chỗ, đúng tenant,
 * SAU mutation) verify qua: unit-arg test (hr-write.service.spec / bridge/producer spec) + e2e boot DI
 * (health.e2e) + FULL gate review. Ở đây khoá HỢP ĐỒNG DB của producer/job.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { LmsSyncProducer } from "../../src/integrations/lms/lms-sync-producer.service";
import { LmsUserSyncJobHandler } from "../../src/integrations/lms/lms-user-sync.job-handler";
import type { LmsSyncUser } from "../../src/integrations/lms/lms-http-client.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;
const TOKEN = ["test-lms-sync-token", "int-only-not-a-real-secret-pad-32ch"].join("-");
const BASE = "https://lms.example.test";
const EVENT = "hr.employee_status_changed";

async function insertProfile(direct: Pool, companyId: string, userId: string, status = "active") {
  await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, $3)`,
    [companyId, userId, status],
  );
}

describe.skipIf(!runIsolatedDb)("S5-LMS-BE-1 · auto-sync MediaOS→LMS (DB cô lập)", () => {
  let direct: Pool;
  let app: Pool;
  let db: DatabaseService;
  let A: SeededTenant; // LMS-company
  let B: SeededTenant; // company khác (không sync)
  let userA1: string; // active + hồ sơ active
  let userA2: string; // active + KHÔNG hồ sơ (admin-like)
  let userB1: string; // company B + hồ sơ
  const companyIds: string[] = [];
  const savedEnv = {
    co: process.env.LMS_COMPANY_ID,
    base: process.env.LMS_BASE_URL,
    token: process.env.LMS_SYNC_TOKEN,
  };

  beforeAll(async () => {
    direct = directPool();
    app = appPool();
    A = await seedCompany(direct, "lmsA");
    B = await seedCompany(direct, "lmsB");
    companyIds.push(A.companyId, B.companyId);
    userA1 = await seedUser(direct, A.companyId, "a1@lms.test", "x".repeat(60));
    await direct.query(`UPDATE users SET full_name='Nhan Vien A1' WHERE id=$1`, [userA1]);
    await insertProfile(direct, A.companyId, userA1, "active");
    userA2 = await seedUser(direct, A.companyId, "a2@lms.test", "x".repeat(60)); // no profile
    userB1 = await seedUser(direct, B.companyId, "b1@lms.test", "x".repeat(60));
    await insertProfile(direct, B.companyId, userB1, "active");
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await app.end();
    await direct.end();
  });

  beforeEach(async () => {
    // Producer/job đọc LMS_COMPANY_ID lúc CONSTRUCT → set env TRƯỚC khi new (mirror singleton boot).
    process.env.LMS_COMPANY_ID = A.companyId;
    process.env.LMS_BASE_URL = BASE;
    process.env.LMS_SYNC_TOKEN = TOKEN;
    db = new DatabaseService();
    // slate outbox sạch cho 2 company test.
    await direct.query(`DELETE FROM outbox_events WHERE company_id = ANY($1::uuid[])`, [
      [A.companyId, B.companyId],
    ]);
  });
  afterEach(() => {
    process.env.LMS_COMPANY_ID = savedEnv.co;
    process.env.LMS_BASE_URL = savedEnv.base;
    process.env.LMS_SYNC_TOKEN = savedEnv.token;
  });

  const makeProducer = () => new LmsSyncProducer(new OutboxService());
  const makeJob = (http: {
    isEnabled: () => boolean;
    syncUsers: (u: LmsSyncUser[]) => Promise<void>;
  }) => new LmsUserSyncJobHandler(db, new AuditService(), http as never);

  async function outboxEvents(companyId: string): Promise<{ payload: Record<string, unknown> }[]> {
    const r = await direct.query(
      `SELECT payload FROM outbox_events WHERE company_id=$1 AND event_type=$2 ORDER BY created_at`,
      [companyId, EVENT],
    );
    return r.rows;
  }

  // ── Producer (real query + gate + outbox) ──
  it("I1: producer enqueue eventType riêng + payload {email,active} (user active + hồ sơ active)", async () => {
    await db.withTenant(A.companyId, (tx) => makeProducer().enqueueSync(tx, A.companyId, userA1));
    const rows = await outboxEvents(A.companyId);
    expect(rows.length).toBe(1);
    expect(rows[0].payload).toMatchObject({
      email: "a1@lms.test",
      active: true,
      name: "Nhan Vien A1",
    });
  });

  it("I1b: hồ sơ resigned → active:false", async () => {
    await direct.query(`UPDATE employee_profiles SET status='resigned' WHERE user_id=$1`, [userA1]);
    await db.withTenant(A.companyId, (tx) => makeProducer().enqueueSync(tx, A.companyId, userA1));
    expect((await outboxEvents(A.companyId))[0].payload).toMatchObject({ active: false });
    await direct.query(`UPDATE employee_profiles SET status='active' WHERE user_id=$1`, [userA1]);
  });

  it("I4: userId null → 0 event", async () => {
    await db.withTenant(A.companyId, (tx) => makeProducer().enqueueSync(tx, A.companyId, null));
    expect((await outboxEvents(A.companyId)).length).toBe(0);
  });

  it("I11: user KHÔNG hồ sơ (admin-like) → 0 event", async () => {
    await db.withTenant(A.companyId, (tx) => makeProducer().enqueueSync(tx, A.companyId, userA2));
    expect((await outboxEvents(A.companyId)).length).toBe(0);
  });

  it("I8: thiếu LMS_COMPANY_ID → producer tắt (0 event)", async () => {
    delete process.env.LMS_COMPANY_ID;
    await db.withTenant(A.companyId, (tx) => makeProducer().enqueueSync(tx, A.companyId, userA1));
    expect((await outboxEvents(A.companyId)).length).toBe(0);
  });

  it("I10-producer: ISOLATION — enqueue cho company B (≠ LMS) → 0 event (không rò email sang LMS)", async () => {
    await db.withTenant(B.companyId, (tx) => makeProducer().enqueueSync(tx, B.companyId, userB1));
    expect((await outboxEvents(B.companyId)).length).toBe(0);
  });

  it("I12: rollback cùng-tx — enqueue rồi tx throw → outbox event BIẾN MẤT", async () => {
    await expect(
      db.withTenant(A.companyId, async (tx) => {
        await makeProducer().enqueueSync(tx, A.companyId, userA1);
        throw new Error("rollback nghiệp vụ");
      }),
    ).rejects.toThrow(/rollback/);
    expect((await outboxEvents(A.companyId)).length).toBe(0);
  });

  // ── Job (real reconcile query + audit) ──
  async function auditSummaries(companyId: string) {
    const r = await direct.query(
      `SELECT actor_type, metadata FROM audit_logs WHERE object_type='lms_sync' AND company_id=$1`,
      [companyId],
    );
    return r.rows as { actor_type: string; metadata: Record<string, unknown> }[];
  }

  it("I9: job reconcile — POST mang name, audit lms_sync actorType Job ĐẾM (không email list)", async () => {
    const syncUsers = vi.fn().mockResolvedValue(undefined);
    const res = await makeJob({ isEnabled: () => true, syncUsers }).run({ companyId: A.companyId });

    expect(res.total).toBe(1); // chỉ userA1 có hồ sơ (userA2 không hồ sơ → ngoài phạm vi)
    const sent = syncUsers.mock.calls[0][0];
    expect(sent).toEqual([{ email: "a1@lms.test", name: "Nhan Vien A1", active: true }]);

    const audits = await auditSummaries(A.companyId);
    expect(audits.length).toBe(1);
    expect(audits[0].actor_type).toBe("Job");
    expect(audits[0].metadata).toMatchObject({ total: 1, ok: 1, fail: 0 });
    expect(JSON.stringify(audits[0].metadata)).not.toContain("a1@lms.test"); // ĐẾM, không email
  });

  it("I10-job: ISOLATION — job cho company B → total:0, KHÔNG POST, KHÔNG audit", async () => {
    const syncUsers = vi.fn().mockResolvedValue(undefined);
    const res = await makeJob({ isEnabled: () => true, syncUsers }).run({ companyId: B.companyId });
    expect(res).toEqual({ total: 0, success: 0, failed: 0 });
    expect(syncUsers).not.toHaveBeenCalled();
    expect((await auditSummaries(B.companyId)).length).toBe(0);
  });

  it("I8-job: disabled (http.isEnabled=false) → total:0, KHÔNG POST/audit", async () => {
    const syncUsers = vi.fn().mockResolvedValue(undefined);
    const res = await makeJob({ isEnabled: () => false, syncUsers }).run({
      companyId: A.companyId,
    });
    expect(res.total).toBe(0);
    expect(syncUsers).not.toHaveBeenCalled();
  });
});
