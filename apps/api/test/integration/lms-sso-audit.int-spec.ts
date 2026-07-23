/**
 * S5-LMS-BE-2 — audit-in-tx cho mint link SSO (trả nợ #253). Postgres THẬT, DB CÔ LẬP (cần mig 0509
 * mở CHECK object_type 'lms_sso' — stacked trên S5-LMS-DB-1). AuditService + DatabaseService THẬT
 * (KHÔNG mock) ⇒ enum-guard fail-closed + CHECK + FK + RLS đều chạy thật (memory
 * reviewers-pass-real-bugs). RED-before-GREEN.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated test/integration/**.
 *
 * Phủ (plan §3):
 *   I1 mint OK → đúng 1 row audit_logs objectType=lms_sso, action=sso_link_minted, objectId UUID,
 *      actorUserId=user.id, company_id=company (AuditService THẬT ⇒ enum 'User'/'Success' được validate).
 *   I2 row KHÔNG chứa token/chữ ký/LMS_SSO_SECRET trong before/after/old/new/metadata.
 *   I3 objectId (jti trong audit) == jti trong URL trả về.
 *   I4 gọi 2 lần → 2 row, objectId khác nhau (jti một-lần).
 *   I5 FAIL-CLOSED THẬT: audit.record vỡ FK (actorUserId lạ) → mintSsoLink reject + 0 row (rollback) +
 *      url KHÔNG trả (crown deny-path của WO).
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { LmsSsoService, type SsoMintUser } from "../../src/integrations/lms/lms-sso.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

// Ghép chuỗi + KHÔNG literal high-entropy → tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const SECRET = ["test-lms-sso-secret", "int-spec-only-not-a-real-secret-padding-32"].join("-");
const BASE_URL = "https://lms.example.test";

/** jti (UUID) từ URL mint để đối chiếu với objectId trong audit. */
function jtiFromUrl(url: string): string {
  const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
  const payloadB64 = token.split(".")[0];
  return (JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { jti: string }).jti;
}

describe.skipIf(!runIsolatedDb)("S5-LMS-BE-2 · audit mint SSO (lms_sso) — DB cô lập", () => {
  let direct: Pool;
  let svc: LmsSsoService;
  let tenant: SeededTenant;
  let userId: string;
  const companyIds: string[] = [];
  const savedEnv = { secret: process.env.LMS_SSO_SECRET, base: process.env.LMS_BASE_URL };

  beforeAll(async () => {
    direct = directPool();
    tenant = await seedCompany(direct, "lmssso");
    companyIds.push(tenant.companyId);
    userId = await seedUser(direct, tenant.companyId, "sso-user@example.test", "x".repeat(60));
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  beforeEach(() => {
    // Service đọc env LÚC CONSTRUCT (field initializer, mirror singleton Nest boot sau khi env sẵn) ⇒
    // set env TRƯỚC rồi mới new. AuditService/DatabaseService đọc pool từ DATABASE_URL (LANE_DB). KHÔNG mock.
    process.env.LMS_SSO_SECRET = SECRET;
    process.env.LMS_BASE_URL = BASE_URL;
    svc = new LmsSsoService(new DatabaseService(), new AuditService());
  });
  afterEach(() => {
    process.env.LMS_SSO_SECRET = savedEnv.secret;
    process.env.LMS_BASE_URL = savedEnv.base;
  });

  /** Đọc mọi audit_logs lms_sso của tenant (direct role — RLS bypass để verify). */
  async function auditRows(): Promise<
    {
      object_id: string;
      action: string;
      actor_user_id: string;
      company_id: string;
      before: unknown;
      after: unknown;
      old_values: unknown;
      new_values: unknown;
      metadata: unknown;
    }[]
  > {
    const r = await direct.query(
      `SELECT object_id, action, actor_user_id, company_id, before, after, old_values, new_values, metadata
         FROM audit_logs WHERE object_type='lms_sso' AND company_id=$1 ORDER BY created_at`,
      [tenant.companyId],
    );
    return r.rows;
  }

  const user = (): SsoMintUser => ({
    id: userId,
    companyId: tenant.companyId,
    email: "SSO-User@Example.test",
  });

  it("I1: mint OK → đúng 1 row lms_sso/sso_link_minted, objectId UUID, actor+tenant đúng", async () => {
    const { url } = await svc.mintSsoLink(user());
    expect(url.startsWith(`${BASE_URL}/api/auth/sso?token=`)).toBe(true);

    const rows = await auditRows();
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("sso_link_minted");
    expect(rows[0].actor_user_id).toBe(userId);
    expect(rows[0].company_id).toBe(tenant.companyId);
    expect(rows[0].object_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("I2: row KHÔNG chứa token/chữ ký/secret (bất biến #3)", async () => {
    const { url } = await svc.mintSsoLink(user());
    const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
    const rows = await auditRows();
    const last = rows[rows.length - 1];
    const blob = JSON.stringify([
      last.before,
      last.after,
      last.old_values,
      last.new_values,
      last.metadata,
    ]);
    expect(blob).not.toContain(token);
    expect(blob).not.toContain(SECRET);
    // 5 cột dữ liệu đều rỗng (payload audit tối thiểu — D5).
    expect([last.before, last.after, last.old_values, last.new_values, last.metadata]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("I3: objectId == jti trong URL trả về", async () => {
    const { url } = await svc.mintSsoLink(user());
    const rows = await auditRows();
    expect(rows[rows.length - 1].object_id).toBe(jtiFromUrl(url));
  });

  it("I4: 2 lần mint → 2 row, objectId (jti) khác nhau", async () => {
    const before = (await auditRows()).length;
    await svc.mintSsoLink(user());
    await svc.mintSsoLink(user());
    const rows = await auditRows();
    expect(rows.length).toBe(before + 2);
    const jtis = new Set(rows.map((r) => r.object_id));
    expect(jtis.size).toBe(rows.length); // tất cả jti duy nhất
  });

  it("I5: FAIL-CLOSED — audit vỡ FK (actorUserId lạ) → reject + 0 row mới + url KHÔNG trả", async () => {
    const before = (await auditRows()).length;
    const ghostUser: SsoMintUser = {
      id: randomUUID(), // KHÔNG tồn tại trong users → audit_logs.actor_user_id FK vỡ
      companyId: tenant.companyId,
      email: "ghost@example.test",
    };
    await expect(svc.mintSsoLink(ghostUser)).rejects.toThrow();
    // rollback: không có row nào được ghi (audit-before-return ⇒ token cũng chưa từng ra ngoài).
    expect((await auditRows()).length).toBe(before);
  });
});
