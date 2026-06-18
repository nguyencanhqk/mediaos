/**
 * CS-9 (🔴 CROWN-JEWEL) — CRUD chính sách bảo mật per-company qua SecurityPolicyService + Repository THẬT
 * (Postgres, withTenant + RLS). DB cô lập (LANE_DB=mediaos_cs9).
 *
 * Phủ: upsert 1-hàng/công ty, GET default khi chưa cấu hình, audit before/after, CHỐNG TỰ-KHOÁ (người gọi
 * PATCH luôn vào exempt-list — BẤT BIẾN #4), 2-tenant isolation (RLS không rò chéo).
 */
import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SecurityPolicyRepository } from "../../src/security-policy/security-policy.repository";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { SecurityPolicyEvaluator } from "../../src/security-policy/security-policy-evaluator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

describe.skipIf(!hasDb)("CS-9 SecurityPolicyService CRUD (withTenant + RLS THẬT)", () => {
  let direct: Pool;
  let dbsvc: DatabaseService;
  let service: SecurityPolicyService;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    direct = directPool();
    dbsvc = new DatabaseService();
    const repo = new SecurityPolicyRepository(dbsvc);
    service = new SecurityPolicyService(dbsvc, repo, new SecurityPolicyEvaluator(), new AuditService());

    A = await seedCompany(direct, "cs9a");
    B = await seedCompany(direct, "cs9b");
    companyIds.push(A.companyId, B.companyId);
    adminA = await seedUser(direct, A.companyId, `admin-${randomUUID().slice(0, 8)}@cs9a.local`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  it("GET trả DEFAULT (không 404) khi chưa cấu hình", async () => {
    const dto = await service.getPolicy(B.companyId);
    expect(dto.ipRestrictionEnabled).toBe(false);
    expect(dto.allowlistCidrs).toEqual([]);
    expect(dto.twoFactorEnforced).toBeNull();
    expect(dto.updatedAt).toBeNull();
  });

  it("PATCH upsert tạo hàng + đọc lại đúng (1 hàng/công ty)", async () => {
    const dto = await service.updatePolicy(
      A.companyId,
      {
        ipRestrictionEnabled: true,
        allowlistCidrs: ["203.0.113.0/24"],
        twoFactorEnforced: true,
        autoLogoutMinutes: 30,
      },
      adminA,
    );
    expect(dto.ipRestrictionEnabled).toBe(true);
    expect(dto.allowlistCidrs).toEqual(["203.0.113.0/24"]);
    expect(dto.twoFactorEnforced).toBe(true);
    expect(dto.autoLogoutMinutes).toBe(30);
    expect(dto.updatedAt).not.toBeNull();

    // 1 hàng/công ty (UNIQUE company_id) — không tạo hàng thứ 2.
    const count = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS n FROM company_security_policies WHERE company_id = ${A.companyId}`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it("PATCH thứ 2 partial-update GIỮ cột không gửi (upsert merge)", async () => {
    // Mới chỉ đổi timeWindows; ip-config từ test trước phải còn nguyên.
    const dto = await service.updatePolicy(
      A.companyId,
      { timeRestrictionEnabled: true, timeWindows: [{ day: 1, start: "08:00", end: "17:00" }] },
      adminA,
    );
    expect(dto.timeRestrictionEnabled).toBe(true);
    expect(dto.timeWindows).toEqual([{ day: 1, start: "08:00", end: "17:00" }]);
    // GIỮ cấu hình IP cũ (không bị reset về default).
    expect(dto.ipRestrictionEnabled).toBe(true);
    expect(dto.allowlistCidrs).toEqual(["203.0.113.0/24"]);
  });

  it("CHỐNG TỰ-KHOÁ: người gọi PATCH luôn nằm trong exemptUserIds (BẤT BIẾN #4)", async () => {
    const dto = await service.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"], exemptUserIds: [] },
      adminA,
    );
    // Dù client gửi exemptUserIds:[] (cố tình xoá), service ÉP thêm chính actor → admin không tự khoá.
    expect(dto.exemptUserIds).toContain(adminA);
  });

  it("ghi audit security_policy (before/after) trong tx", async () => {
    await service.updatePolicy(A.companyId, { autoLogoutMinutes: 45 }, adminA);
    const audit = await dbsvc.withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT action, object_type FROM audit_logs WHERE company_id = ${A.companyId} AND object_type = 'security_policy' ORDER BY created_at DESC LIMIT 1`,
      );
      return r.rows[0] as { action: string; object_type: string } | undefined;
    });
    expect(audit?.object_type).toBe("security_policy");
    expect(audit?.action).toBe("security_policy.updated");
  });

  it("2-tenant ISOLATION: policy của A KHÔNG rò sang B", async () => {
    // B chưa cấu hình → vẫn DEFAULT dù A đã set nhiều thứ (RLS lọc company_id).
    const dtoB = await service.getPolicy(B.companyId);
    expect(dtoB.ipRestrictionEnabled).toBe(false);
    expect(dtoB.allowlistCidrs).toEqual([]);
    expect(dtoB.autoLogoutMinutes).toBeNull();
  });
});
