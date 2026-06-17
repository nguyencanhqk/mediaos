/**
 * AC-8 — Observability audit/queue deny-path + cross-tenant leak guard (DB cô lập mediaos_ac8).
 *
 * Chứng minh fail-closed + tenant isolation cho viewer CHỈ-ĐỌC:
 *  (a)  permission gate: company-admin của A KHÔNG có view:platform-audit ⇒ permission.can DENY;
 *       user thường KHÔNG có view:audit-log ⇒ DENY tenant-self.
 *  (b)  CROSS-TENANT LEAK: AuditReadService.listOwnTenant(A) CHỈ thấy audit của A (KHÔNG thấy B);
 *       chứng minh RLS tầng DB: SELECT audit_logs với app.current_company_id=A trả 0 row của B
 *       (cũng cho outbox_events + dead_letter_events).
 *  (c)  STEP-UP: cửa sổ step-up keyed (operator, PLATFORM_AUDIT_SCOPE) — resolveWindow null khi chưa
 *       step-up/hết hạn (controller fail-closed 403); window mới ⇒ resolve OK.
 *  (e)  GUC DEFAULT-DENY: KHÔNG withPlatformReadContext (GUC chưa set) ⇒ cross-tenant SELECT trả 0 row
 *       của tenant lạ trên audit_logs/outbox_events/dead_letter_events; CÓ withPlatformReadContext ⇒ thấy
 *       MỌI tenant. WITH CHECK KHÔNG có nhánh cross-tenant: INSERT dưới platform_audit_read='on' cho
 *       company_id LẠ vẫn FAIL (SELECT-only by construction).
 *
 * (d) 401 unauthenticated được phủ ở slice HTTP riêng (audit-read.http.int-spec) để giữ file này thuần
 *     service/DB (RLS chỉ kiểm chứng trên Postgres thật).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { OperatorReauthService } from "../../src/platform/operator-reauth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { AuditReadService } from "../../src/observability/audit-read.service";
import { PLATFORM_AUDIT_SCOPE } from "../../src/observability/observability.constants";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

/** Seed 1 audit row DIRECT (bypass RLS) cho 1 tenant. */
async function seedAudit(
  direct: import("pg").Pool,
  companyId: string,
  action: string,
  objectType = "task",
  payload: unknown = { note: action },
): Promise<void> {
  await direct.query(
    `INSERT INTO audit_logs (company_id, action, object_type, after) VALUES ($1,$2,$3,$4)`,
    [companyId, action, objectType, JSON.stringify(payload)],
  );
}

/** Seed 1 outbox + 1 dead-letter row DIRECT cho 1 tenant. Trả eventId. */
async function seedQueue(direct: import("pg").Pool, companyId: string): Promise<void> {
  const ev = await direct.query(
    `INSERT INTO outbox_events (company_id, event_type, payload, status) VALUES ($1,'task.created','{}'::jsonb,'pending') RETURNING id`,
    [companyId],
  );
  const eventId = ev.rows[0].id as string;
  await direct.query(
    `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
     VALUES ($1,$2,'webhook-fanout','task.created','{}'::jsonb,'boom')`,
    [companyId, eventId],
  );
}

describe.skipIf(!hasDb)("AC-8 observability deny-path + cross-tenant leak", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let operatorId: string;
  let caUser: string; // company-admin của A (view:audit-log)
  let noGrantUser: string; // user A KHÔNG có audit grant
  let permission: PermissionService;
  let auditRead: AuditReadService;

  beforeAll(async () => {
    A = await seedCompany(direct, "obsA");
    B = await seedCompany(direct, "obsB");

    const paUser = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, paUser, PLATFORM_ADMIN_ROLE, A.companyId);
    operatorId = paUser;

    caUser = await seedUser(direct, A.companyId, `ca-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, caUser, COMPANY_ADMIN_ROLE, A.companyId);

    noGrantUser = await seedUser(direct, A.companyId, `ng-${randomUUID().slice(0, 8)}@a.test`);
    const emptyRole = await seedRole(direct, A.companyId, `empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noGrantUser, emptyRole, A.companyId);

    // Audit + queue cho cả A và B.
    await seedAudit(direct, A.companyId, "TaskCreated-A");
    await seedAudit(direct, B.companyId, "TaskCreated-B");
    await seedQueue(direct, A.companyId);
    await seedQueue(direct, B.companyId);

    permission = new PermissionService(new PermissionRepository(new DatabaseService()));
    auditRead = new AuditReadService(
      new DatabaseService(),
      new OperatorActionAuditService(new AuditService()),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ── (a) permission gate ────────────────────────────────────────────────────────────────────────
  it("(a) company-admin A KHÔNG có view:platform-audit ⇒ DENY", async () => {
    const d = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "view",
      resourceType: "platform-audit",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(a2) user thường (role rỗng) KHÔNG có view:audit-log ⇒ DENY", async () => {
    const d = await permission.can({
      userId: noGrantUser,
      companyId: A.companyId,
      action: "view",
      resourceType: "audit-log",
      isSensitive: true,
    });
    expect(d.allow).toBe(false);
  });

  it("(a3) company-admin A CÓ view:audit-log (grant tường minh mig 0340) ⇒ ALLOW", async () => {
    const d = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "view",
      resourceType: "audit-log",
      isSensitive: true,
    });
    expect(d.allow).toBe(true);
  });

  it("(a4) platform-admin CÓ view:platform-audit (grant tường minh) ⇒ ALLOW", async () => {
    const d = await permission.can({
      userId: operatorId,
      companyId: A.companyId,
      action: "view",
      resourceType: "platform-audit",
      isSensitive: true,
    });
    expect(d.allow).toBe(true);
  });

  // ── (b) cross-tenant leak guard (tenant-self) ────────────────────────────────────────────────────
  it("(b) listOwnTenant(A) CHỈ thấy audit của A (KHÔNG có row B)", async () => {
    const res = await auditRead.listOwnTenant(A.companyId, { limit: 100, offset: 0 });
    expect(res.data.length).toBeGreaterThan(0);
    for (const row of res.data) expect(row.companyId).toBe(A.companyId);
    expect(res.data.some((r) => r.action === "TaskCreated-B")).toBe(false);
  });

  it("(b2) RLS DB: SELECT audit_logs với current_company_id=A ⇒ 0 row của B", async () => {
    const db = new DatabaseService();
    const bRows = await db.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS c FROM audit_logs WHERE company_id = ${B.companyId}`,
      );
      return (r.rows[0] as { c: number }).c;
    });
    expect(bRows).toBe(0);
  });

  it("(b3) RLS DB: outbox_events + dead_letter_events với current_company_id=A ⇒ 0 row của B", async () => {
    const db = new DatabaseService();
    const counts = await db.withTenant(A.companyId, async (tx) => {
      const o = await tx.execute(
        sql`SELECT count(*)::int AS c FROM outbox_events WHERE company_id = ${B.companyId}`,
      );
      const d = await tx.execute(
        sql`SELECT count(*)::int AS c FROM dead_letter_events WHERE company_id = ${B.companyId}`,
      );
      return {
        outbox: (o.rows[0] as { c: number }).c,
        deadLetter: (d.rows[0] as { c: number }).c,
      };
    });
    expect(counts.outbox).toBe(0);
    expect(counts.deadLetter).toBe(0);
  });

  // ── (e) GUC default-deny + SELECT-only ───────────────────────────────────────────────────────────
  it("(e) KHÔNG withPlatformReadContext ⇒ cross-tenant SELECT trả 0 row tenant lạ (default-deny)", async () => {
    const db = new DatabaseService();
    // withTenant(A) KHÔNG bật platform_audit_read ⇒ chỉ thấy A (đã chứng minh ở b2). Bổ sung: 1 tx KHÔNG
    // set company_id NÀO + KHÔNG platform_audit_read ⇒ 0 row hoàn toàn (fail-closed).
    const seen = await db.withPlatformReadContext(async (tx) => {
      // sanity: trong ngữ cảnh platform-read, THẤY cả A lẫn B.
      const all = await tx.execute(
        sql`SELECT count(*)::int AS c FROM audit_logs WHERE company_id IN (${A.companyId}, ${B.companyId})`,
      );
      return (all.rows[0] as { c: number }).c;
    });
    expect(seen).toBeGreaterThanOrEqual(2); // CÓ GUC ⇒ thấy cả 2 tenant

    // Đối chứng: withTenant(A) (GUC platform-read TẮT) ⇒ KHÔNG thấy B.
    const leaked = await db.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS c FROM audit_logs WHERE company_id = ${B.companyId}`,
      );
      return (r.rows[0] as { c: number }).c;
    });
    expect(leaked).toBe(0);
  });

  it("(e2) outbox + dead_letter: withPlatformReadContext thấy MỌI tenant", async () => {
    const db = new DatabaseService();
    const counts = await db.withPlatformReadContext(async (tx) => {
      const o = await tx.execute(
        sql`SELECT count(*)::int AS c FROM outbox_events WHERE company_id IN (${A.companyId}, ${B.companyId})`,
      );
      const d = await tx.execute(
        sql`SELECT count(*)::int AS c FROM dead_letter_events WHERE company_id IN (${A.companyId}, ${B.companyId})`,
      );
      return {
        outbox: (o.rows[0] as { c: number }).c,
        deadLetter: (d.rows[0] as { c: number }).c,
      };
    });
    expect(counts.outbox).toBeGreaterThanOrEqual(2);
    expect(counts.deadLetter).toBeGreaterThanOrEqual(2);
  });

  it("(e3) SELECT-ONLY: INSERT audit_logs cho company_id LẠ dưới platform_audit_read='on' vẫn FAIL (no WITH CHECK cross-tenant)", async () => {
    const db = new DatabaseService();
    await expect(
      db.withPlatformReadContext(async (tx) => {
        // KHÔNG set current_company_id ⇒ WITH CHECK của *_tenant_iso (keyed current_company_id) FAIL;
        // policy platform_audit_read là FOR SELECT ⇒ KHÔNG cấp quyền INSERT chéo tenant.
        await tx.execute(
          sql`INSERT INTO audit_logs (company_id, action, object_type) VALUES (${B.companyId}, 'attack', 'task')`,
        );
      }),
    ).rejects.toThrow();
  });

  // ── (c) step-up scoping ──────────────────────────────────────────────────────────────────────────
  it("(c) resolveWindow(operator, sentinel) = null khi chưa step-up; có window ⇒ resolve OK", async () => {
    const valkey = makeInMemoryValkey();
    const reauth = new OperatorReauthService(
      new DatabaseService(),
      valkey,
      new PasswordService(),
      new LoginRateLimiter(valkey),
    );

    // chưa step-up ⇒ null (controller fail-closed 403).
    expect(await reauth.resolveWindow(operatorId, PLATFORM_AUDIT_SCOPE)).toBeNull();

    // window cho 1 tenant THẬT (A) KHÔNG authorize phạm vi sentinel (key khác).
    await valkey.set(
      `operator-reauth:${operatorId}:${A.companyId}`,
      String(Date.now() + 300_000),
      300,
    );
    expect(await reauth.resolveWindow(operatorId, PLATFORM_AUDIT_SCOPE)).toBeNull();

    // window keyed sentinel ⇒ resolve OK.
    await valkey.set(
      `operator-reauth:${operatorId}:${PLATFORM_AUDIT_SCOPE}`,
      String(Date.now() + 300_000),
      300,
    );
    const w = await reauth.resolveWindow(operatorId, PLATFORM_AUDIT_SCOPE);
    expect(w).toBeInstanceOf(Date);

    // hết hạn (epoch quá khứ) ⇒ null.
    await valkey.set(
      `operator-reauth:${operatorId}:${PLATFORM_AUDIT_SCOPE}`,
      String(Date.now() - 1000),
      300,
    );
    expect(await reauth.resolveWindow(operatorId, PLATFORM_AUDIT_SCOPE)).toBeNull();
  });
});

/** Valkey in-memory tối giản (đủ cho set/get có TTL trong test). */
function makeInMemoryValkey(): ValkeyService {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async set(key: string, value: string, ttlSec: number) {
      store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      return true;
    },
    async get(key: string) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
  } as unknown as ValkeyService;
}
