/**
 * S1-FND-AUDIT-1 (L3) — AuditService.record() WRITE-SHAPE integration (DB cô lập, app role + RLS THẬT).
 *
 * Unit test (src/events/audit.service.spec.ts) đã phủ shape qua fake-tx (capture-insert). Test này chứng
 * minh record() ghi THẬT qua `withTenant` (app role mediaos_app, FORCE RLS, CHECK Postgres SỐNG):
 *   W1  record() điền ĐỦ 23 cột §8.5 khi caller cung cấp → đọc lại DB khớp (11 cột mig 0438 + cặp mig 0432).
 *   W2  caller chỉ-v1 → mọi cột v2 = NULL, changed_fields = NULL (writer cũ KHÔNG vỡ, backward-compat).
 *   W3  changed_fields tự tính từ old/new ĐÃ MASK (secret 2 vế ⇒ KHÔNG tính là đổi).
 *   W4  enum guard fail-closed TRƯỚC insert: actor_type/sensitivity_level/result_status sai → throw, KHÔNG
 *       chạm CHECK Postgres (0 hàng ghi). data_scope sai → throw (DB KHÔNG CHECK — app là lớp duy nhất).
 *   W5  data_scope hợp lệ (mọi enum {Own,Team,Department,Company,System}) → ghi nguyên (không vỡ).
 *   W6  ghi trong tx withTenant: tx throw → rollback, KHÔNG còn hàng nửa vời (append-only #2 + atomic).
 *
 * Đọc-lại dùng DIRECT pool (superuser, bypass RLS) theo `action` DUY NHẤT — KHÔNG raw-SQL trong tx app.
 * Postgres THẬT cô lập (mediaos_<lane>, CLAUDE §9.5). Auto-skip khi DATABASE_URL chưa set — KHÔNG false-green.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { AuditMaskerService } from "../../src/events/audit-masker.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/** Placeholder vô hại (KHÔNG secret thật) — chỉ để khẳng định bị mask + KHÔNG xuất hiện ở DB. */
const SECRET = "SHOULD_NOT_LEAK_PLACEHOLDER";

/** Đọc 1 hàng audit theo action DUY NHẤT qua DIRECT pool (superuser bypass RLS). */
async function fetchByAction(
  direct: Pool,
  companyId: string,
  action: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await direct.query(`SELECT * FROM audit_logs WHERE company_id = $1 AND action = $2`, [
    companyId,
    action,
  ]);
  return r.rows[0] as Record<string, unknown> | undefined;
}

/** Đếm audit của 1 tenant theo action (xác minh có/không ghi). */
async function countByAction(direct: Pool, companyId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND action = $2`,
    [companyId, action],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasDb)("S1-FND-AUDIT-1 AuditService.record() write-shape (app role + RLS)", () => {
  const db = new DatabaseService();
  const svc = new AuditService(new AuditMaskerService());
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "aws");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── W1: full 23-col shape ────────────────────────────────────────────────────────
  it("W1 — điền ĐỦ 23 cột §8.5 khi caller cung cấp (đọc lại DB khớp)", async () => {
    const action = `WS-full-${randomUUID().slice(0, 8)}`;
    const empId = randomUUID();
    const entId = randomUUID();
    await db.withTenant(A.companyId, (tx) =>
      svc.record(tx, {
        action,
        objectType: "employee",
        objectId: entId,
        moduleCode: "HR",
        entityType: "employee",
        entityId: entId,
        actorType: "User",
        sensitivityLevel: "Sensitive",
        resultStatus: "Success",
        requestId: "req-1",
        correlationId: "corr-1",
        ipAddress: "10.0.0.1",
        actorEmployeeId: empId,
        actionGroup: "data",
        entityIdText: "EMP-001",
        entityCode: "EMP-001",
        permissionCode: "HR.EMPLOYEE.VIEW",
        dataScope: "Company",
        deviceInfo: { browser: "chrome", os: "win" },
        diffSummary: "name changed",
        errorMessage: "ok",
        metadata: { reason: "test" },
        oldValues: { name: "a" },
        newValues: { name: "b" },
      }),
    );

    const row = await fetchByAction(direct, A.companyId, action);
    expect(row, "hàng audit phải tồn tại sau commit").toBeTruthy();
    const r = row as Record<string, unknown>;
    expect(r["module_code"]).toBe("HR");
    expect(r["entity_type"]).toBe("employee");
    expect(r["actor_type"]).toBe("User");
    expect(r["sensitivity_level"]).toBe("Sensitive");
    expect(r["result_status"]).toBe("Success");
    expect(r["request_id"]).toBe("req-1");
    expect(r["correlation_id"]).toBe("corr-1");
    expect(r["ip_address"]).toBe("10.0.0.1");
    expect(r["actor_employee_id"]).toBe(empId);
    expect(r["action_group"]).toBe("data");
    expect(r["entity_id_text"]).toBe("EMP-001");
    expect(r["entity_code"]).toBe("EMP-001");
    expect(r["permission_code"]).toBe("HR.EMPLOYEE.VIEW");
    expect(r["data_scope"]).toBe("Company");
    expect(r["device_info"]).toEqual({ browser: "chrome", os: "win" });
    expect(r["diff_summary"]).toBe("name changed");
    expect(r["error_message"]).toBe("ok");
    expect(r["metadata"]).toEqual({ reason: "test" });
    expect(r["changed_fields"]).toEqual(["name"]);
  });

  // ── W2: backward-compat (v1-only caller) ──────────────────────────────────────────
  it("W2 — caller chỉ-v1 → mọi cột v2 = NULL, changed_fields = NULL", async () => {
    const action = `WS-v1-${randomUUID().slice(0, 8)}`;
    await db.withTenant(A.companyId, (tx) =>
      svc.record(tx, { action, objectType: "user", before: { a: 1 } }),
    );
    const row = await fetchByAction(direct, A.companyId, action);
    expect(row).toBeTruthy();
    const r = row as Record<string, unknown>;
    for (const col of [
      "module_code",
      "entity_type",
      "actor_type",
      "data_scope",
      "device_info",
      "metadata",
      "changed_fields",
      "old_values",
      "new_values",
      "action_group",
      "permission_code",
    ]) {
      expect(r[col], `${col} phải NULL`).toBeNull();
    }
  });

  // ── W3: changed_fields từ giá trị ĐÃ MASK ─────────────────────────────────────────
  it("W3 — changed_fields tính từ old/new ĐÃ MASK (token đổi 2 vế ⇒ KHÔNG tính là đổi)", async () => {
    const action = `WS-mask-${randomUUID().slice(0, 8)}`;
    await db.withTenant(A.companyId, (tx) =>
      svc.record(tx, {
        action,
        objectType: "user",
        entityType: "user",
        oldValues: { token: `${SECRET}-OLD`, name: "a" },
        newValues: { token: `${SECRET}-NEW`, name: "b" },
      }),
    );
    const row = await fetchByAction(direct, A.companyId, action);
    expect(row).toBeTruthy();
    const r = row as Record<string, unknown>;
    // token bị mask "***" hai vế → KHÔNG nằm trong changed_fields; chỉ 'name' đổi.
    expect(r["changed_fields"]).toEqual(["name"]);
    expect(JSON.stringify(r["old_values"])).not.toContain(SECRET);
    expect(JSON.stringify(r["new_values"])).not.toContain(SECRET);
    expect((r["old_values"] as Record<string, unknown>)["token"]).toBe("***");
  });

  // ── W4: enum guard fail-closed (KHÔNG vỡ CHECK Postgres) ──────────────────────────
  it("W4 — actor_type ngoài enum → throw, 0 hàng ghi (KHÔNG chạm CHECK Postgres)", async () => {
    const action = `WS-bad-actor-${randomUUID().slice(0, 8)}`;
    await expect(
      db.withTenant(A.companyId, (tx) =>
        svc.record(tx, { action, objectType: "user", actorType: "Robot" }),
      ),
    ).rejects.toThrow(/actor_type/i);
    expect(await countByAction(direct, A.companyId, action)).toBe(0);
  });

  it("W4 — data_scope ngoài enum → throw, 0 hàng ghi (app là lớp duy nhất ép — DB KHÔNG CHECK)", async () => {
    const action = `WS-bad-scope-${randomUUID().slice(0, 8)}`;
    await expect(
      db.withTenant(A.companyId, (tx) =>
        svc.record(tx, { action, objectType: "user", dataScope: "Galaxy" }),
      ),
    ).rejects.toThrow(/data_scope/i);
    expect(await countByAction(direct, A.companyId, action)).toBe(0);
  });

  // ── W5: every valid data_scope writes through ─────────────────────────────────────
  it.each(["Own", "Team", "Department", "Company", "System"])(
    "W5 — data_scope hợp lệ '%s' ghi nguyên (không vỡ)",
    async (scope) => {
      const action = `WS-scope-${scope}-${randomUUID().slice(0, 8)}`;
      await db.withTenant(A.companyId, (tx) =>
        svc.record(tx, { action, objectType: "user", dataScope: scope }),
      );
      const row = await fetchByAction(direct, A.companyId, action);
      expect(row).toBeTruthy();
      expect((row as Record<string, unknown>)["data_scope"]).toBe(scope);
    },
  );

  // ── W6: atomic rollback (audit + business change cùng commit/rollback) ─────────────
  it("W6 — tx throw SAU record() → rollback, KHÔNG còn hàng audit nửa vời (atomic #2)", async () => {
    const action = `WS-rollback-${randomUUID().slice(0, 8)}`;
    await expect(
      db.withTenant(A.companyId, async (tx) => {
        await svc.record(tx, { action, objectType: "user" });
        throw new Error("business failure after audit");
      }),
    ).rejects.toThrow(/business failure/);
    // record() đã insert NHƯNG tx rollback ⇒ DB KHÔNG có hàng (audit không ghi nửa vời).
    expect(await countByAction(direct, A.companyId, action)).toBe(0);
  });
});
