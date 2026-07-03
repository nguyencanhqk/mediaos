import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { AuditMaskerService } from "../../src/events/audit-masker.service";
import { HolidaysRepository } from "../../src/foundation/holidays/holidays.repository";
import { HolidaysService } from "../../src/foundation/holidays/holidays.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-FND-BE-6 (L3, crown — audit) — Holiday CONFIG audit-in-tx integration (DB cô lập, app role + RLS + CHECK THẬT).
 *
 *   H1  INSERT audit_logs object_type='public_holiday' qua app role PASS CHECK (mig 0468 UNION add-only).
 *   H2  app role UPDATE & DELETE audit_logs bị DENIED (append-only BẤT BIẾN #2 — mirror audit-logs-appendonly).
 *   H3  HolidaysService.create/update/delete ghi ĐÚNG 1 audit row/action (HOLIDAY_CREATED/UPDATED/DELETED),
 *       objectId=holiday.id, old/new = snapshot cấu hình đã qua masker; delete new_values=null.
 *   H4  rollback CÙNG tx: object_type='public_holiday' audit + business throw → 0 orphan (atomic #2).
 *
 * Gate: hasDb && LANE_DB (DB cô lập theo lane; thiếu LANE_DB → SKIP, KHÔNG chạm 'mediaos' chung —
 * memory: integration-test-lane-db-gate, CLAUDE.md §9.5). Đọc-lại qua DIRECT pool (superuser bypass RLS).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

async function fetchByAction(
  direct: Pool,
  companyId: string,
  action: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await direct.query(
    `SELECT * FROM audit_logs WHERE company_id = $1 AND action = $2 AND object_type = 'public_holiday'`,
    [companyId, action],
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

async function countByAction(direct: Pool, companyId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND action = $2 AND object_type = 'public_holiday'`,
    [companyId, action],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasLaneDb)(
  "S2-FND-BE-6 holiday CONFIG audit-in-tx (app role + RLS + CHECK)",
  () => {
    const direct = directPool();
    const app = appPool();
    const db = new DatabaseService();
    const svc = new HolidaysService(
      db,
      new HolidaysRepository(db),
      new AuditService(new AuditMaskerService()),
    );

    let A: SeededTenant;
    let actor: { id: string; companyId: string };
    let seededAuditId: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "hol-audit");
      const userId = await seedUser(direct, A.companyId, `hol-actor-${A.slug}@test.local`);
      actor = { id: userId, companyId: A.companyId };

      // Seed 1 audit row object_type='public_holiday' qua superuser (bypass grants/RLS) — hàng app role
      // sẽ thử UPDATE/DELETE (kỳ vọng bị từ chối append-only).
      const r = await direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type)
       VALUES ($1, 'seed_holiday_audit', 'public_holiday') RETURNING id`,
        [A.companyId],
      );
      seededAuditId = r.rows[0].id as string;
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
      await app.end();
    });

    /** Chạy fn trong tx của app role với tenant context set (mirror audit-logs-appendonly). */
    async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const r = await fn(c);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }

    // ── H1: CHECK chấp nhận object_type='public_holiday' ───────────────────────────────
    it("H1 — INSERT audit object_type='public_holiday' qua app role PASS CHECK (mig 0468)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO audit_logs (action, object_type)
         VALUES ('holiday_check_probe', 'public_holiday') RETURNING id`,
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    // ── H2: append-only (UPDATE/DELETE denied) ─────────────────────────────────────────
    it("H2 — app role UPDATE audit_logs (public_holiday) bị DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [seededAuditId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("H2 — app role DELETE audit_logs (public_holiday) bị DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM audit_logs WHERE id = $1`, [seededAuditId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    // ── H3: service CRUD ghi đúng 1 audit row/action ───────────────────────────────────
    it("H3 — create/update/delete ghi ĐÚNG 1 audit row/action, old/new masked, delete new=null", async () => {
      const code = `HOL-${randomUUID().slice(0, 8)}`;
      const created = await svc.createHoliday(actor, {
        holidayCode: code,
        name: "Ngày lễ test",
        holidayDate: "2030-01-02",
      });

      // create → 1 dòng HOLIDAY_CREATED, old=null, new=snapshot
      expect(await countByAction(direct, A.companyId, "HOLIDAY_CREATED")).toBe(1);
      const createdRow = await fetchByAction(direct, A.companyId, "HOLIDAY_CREATED");
      expect(createdRow?.["object_id"]).toBe(created.id);
      expect(createdRow?.["action_group"]).toBe("CONFIG");
      expect(createdRow?.["actor_type"]).toBe("User");
      expect(createdRow?.["data_scope"]).toBe("Company");
      expect(createdRow?.["actor_user_id"]).toBe(actor.id);
      expect(createdRow?.["old_values"]).toBeNull();
      expect((createdRow?.["new_values"] as Record<string, unknown>)["holidayCode"]).toBe(code);

      // update → 1 dòng HOLIDAY_UPDATED, old + new present, changed_fields chứa 'name'
      await svc.updateHoliday(actor, created.id, { name: "Ngày lễ đổi tên" });
      expect(await countByAction(direct, A.companyId, "HOLIDAY_UPDATED")).toBe(1);
      const updatedRow = await fetchByAction(direct, A.companyId, "HOLIDAY_UPDATED");
      expect(updatedRow?.["object_id"]).toBe(created.id);
      expect((updatedRow?.["old_values"] as Record<string, unknown>)["name"]).toBe("Ngày lễ test");
      expect((updatedRow?.["new_values"] as Record<string, unknown>)["name"]).toBe(
        "Ngày lễ đổi tên",
      );
      expect(updatedRow?.["changed_fields"]).toContain("name");

      // delete → 1 dòng HOLIDAY_DELETED, old=snapshot, new=null
      await svc.deleteHoliday(actor, created.id);
      expect(await countByAction(direct, A.companyId, "HOLIDAY_DELETED")).toBe(1);
      const deletedRow = await fetchByAction(direct, A.companyId, "HOLIDAY_DELETED");
      expect(deletedRow?.["object_id"]).toBe(created.id);
      expect(deletedRow?.["new_values"]).toBeNull();
      expect((deletedRow?.["old_values"] as Record<string, unknown>)["holidayCode"]).toBe(code);
    });

    // ── H4: atomic rollback — object_type='public_holiday' audit tham gia rollback ──────
    it("H4 — audit public_holiday ghi rồi tx throw → rollback, 0 orphan (atomic #2)", async () => {
      const audit = new AuditService(new AuditMaskerService());
      const action = `HOLIDAY_ROLLBACK_PROBE_${randomUUID().slice(0, 8)}`;
      await expect(
        db.withTenant(A.companyId, async (tx) => {
          await audit.record(tx, {
            action,
            actionGroup: "CONFIG",
            objectType: "public_holiday",
            objectId: randomUUID(),
            actorUserId: actor.id,
            actorType: "User",
            dataScope: "Company",
            sensitivityLevel: "Normal",
            resultStatus: "Success",
            newValues: { holidayCode: "PROBE" },
          });
          throw new Error("business failure after holiday audit");
        }),
      ).rejects.toThrow(/business failure/);
      expect(await countByAction(direct, A.companyId, action)).toBe(0);
    });

    // ── H4b: mutation lỗi (duplicate) → KHÔNG orphan audit HOLIDAY_CREATED thừa ────────
    it("H4b — create trùng (unique violation) → KHÔNG ghi audit HOLIDAY_CREATED cho lần lỗi", async () => {
      const code = `HOL-DUP-${randomUUID().slice(0, 8)}`;
      const first = await svc.createHoliday(actor, {
        holidayCode: code,
        name: "Trùng",
        holidayDate: "2030-03-03",
      });
      // Lần 2 cùng (code, date) → unique violation → ConflictException; audit sau insert nên KHÔNG chạy.
      await expect(
        svc.createHoliday(actor, { holidayCode: code, name: "Trùng 2", holidayDate: "2030-03-03" }),
      ).rejects.toThrow();

      // Chỉ đúng 1 audit HOLIDAY_CREATED cho objectId = first.id (lần lỗi KHÔNG để lại orphan).
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND action = 'HOLIDAY_CREATED' AND object_type = 'public_holiday'
           AND object_id = $2`,
        [A.companyId, first.id],
      );
      expect(r.rows[0].n).toBe(1);
    });
  },
);
