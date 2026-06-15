/**
 * NOTI-002 — Integration tests: mandatory notification rule enforcement.
 *
 * M1: sau mig 0054, INSERT notification_rule mandatory=true cho company A;
 *     UPSERT notification_preferences(enabled=false) cho type mandatory → bị chặn ở service
 *     → 0 row enabled=false tồn tại.
 * M2: 2-tenant isolation: mandatory rule của B KHÔNG thấy khi query A
 *     (company_id + RLS giữ nguyên).
 * M3: app role vẫn KHÔNG UPDATE/DELETE notification_rules (append-only sau khi thêm cột mandatory).
 *
 * Chạy với LANE_DB=mediaos_noti002 (DB cô lập — CLAUDE.md §9.6).
 * Tự skip nếu !hasDb.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../../src/db/db.service";
import { NotificationPreferencesRepository } from "../../src/notifications/notification-preferences.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";

describe.skipIf(!hasDb)("NOTI-002 mandatory notification rule — integration", () => {
  const direct = directPool();
  let A: { companyId: string; slug: string };
  let B: { companyId: string; slug: string };
  let userA: string;
  let db: DatabaseService;
  let prefRepo: NotificationPreferencesRepository;

  beforeAll(async () => {
    A = await seedCompany(direct, "noti-mand-a");
    B = await seedCompany(direct, "noti-mand-b");
    userA = await seedUser(direct, A.companyId, `user-a-${randomUUID()}@test.com`);

    db = new DatabaseService();
    prefRepo = new NotificationPreferencesRepository(db);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ── M1: mandatory rule → service blocks opt-out ──────────────────────────────

  it("M1: INSERT mandatory=true rule for A; UPSERT pref(enabled=false) bị chặn → 0 row enabled=false", async () => {
    // Seed mandatory rule qua direct (admin/seed path — app role không UPDATE)
    await direct.query(
      `INSERT INTO notification_rules (company_id, notification_type, enabled, mandatory, config)
       VALUES ($1, 'general', true, true, '{}')
       ON CONFLICT (company_id, notification_type)
       DO UPDATE SET mandatory = true`,
      [A.companyId],
    );

    // Attempt opt-out qua service → PHẢI throw BadRequestException
    await expect(prefRepo.upsert(A.companyId, userA, "general", false)).rejects.toThrow(
      BadRequestException,
    );
    await expect(prefRepo.upsert(A.companyId, userA, "general", false)).rejects.toThrow(
      "mandatory notification cannot be disabled",
    );

    // Verify: không có row enabled=false trong DB
    const res = await direct.query(
      `SELECT enabled FROM notification_preferences
       WHERE company_id = $1 AND user_id = $2 AND notification_type = 'general'`,
      [A.companyId, userA],
    );
    const falseRows = (res.rows as { enabled: boolean }[]).filter((r) => r.enabled === false);
    expect(falseRows).toHaveLength(0);
  });

  it("M1b: bật lại (enabled=true) với mandatory rule → OK", async () => {
    await expect(prefRepo.upsert(A.companyId, userA, "general", true)).resolves.toBeDefined();
  });

  // ── M2: 2-tenant isolation ───────────────────────────────────────────────────

  it("M2: mandatory rule của B KHÔNG thấy khi query A (SELECT 0 row)", async () => {
    // Seed mandatory rule cho B qua direct
    await direct.query(
      `INSERT INTO notification_rules (company_id, notification_type, enabled, mandatory, config)
       VALUES ($1, 'task_assigned', true, true, '{}')
       ON CONFLICT (company_id, notification_type)
       DO UPDATE SET mandatory = true`,
      [B.companyId],
    );

    // Khi upsert từ A cho type task_assigned → KHÔNG throw
    // vì A chưa có mandatory rule cho task_assigned (rule của B không thấy được)
    await expect(
      prefRepo.upsert(A.companyId, userA, "task_assigned", false),
    ).resolves.toBeDefined();
  });

  // ── M3: app role vẫn KHÔNG UPDATE/DELETE notification_rules ─────────────────

  it("M3: app role KHÔNG thể UPDATE notification_rules (append-only giữ nguyên sau khi thêm cột mandatory)", async () => {
    // Tạo rule qua direct
    const ruleRes = await direct.query(
      `INSERT INTO notification_rules (company_id, notification_type, enabled, mandatory, config)
       VALUES ($1, 'mentioned', true, false, '{}')
       ON CONFLICT (company_id, notification_type) DO UPDATE SET enabled = true
       RETURNING id`,
      [A.companyId],
    );
    const ruleId = ruleRes.rows[0].id as string;

    // Attempt UPDATE qua app role (withTenant uses app role connection)
    await expect(
      db.withTenant(A.companyId, (tx) =>
        tx.execute(sql`UPDATE notification_rules SET mandatory = true WHERE id = ${ruleId}`),
      ),
    ).rejects.toThrow();

    // Attempt DELETE qua app role
    await expect(
      db.withTenant(A.companyId, (tx) =>
        tx.execute(sql`DELETE FROM notification_rules WHERE id = ${ruleId}`),
      ),
    ).rejects.toThrow();
  });
});
