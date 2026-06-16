import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G16-1b — security_alerts (append-only) tenant isolation + emit semantics.
 *  - emit ghi 1 row + 1 audit 'security_alert' cùng tx (atomic).
 *  - detail KHÔNG chứa secret (sanitize loại khoá nhạy cảm).
 *  - cross-tenant A/B: ngữ cảnh tenant A KHÔNG thấy alert tenant B (RLS).
 *  - append-only: app role KHÔNG có UPDATE/DELETE grant (DB chặn).
 */
describe.skipIf(!hasDb)("G16-1b security_alerts — emit + tenant isolation", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let svc: SecurityAlertService;

  beforeAll(async () => {
    const db = new DatabaseService();
    svc = new SecurityAlertService(db, new AuditService());
    A = await seedCompany(direct, "secA");
    B = await seedCompany(direct, "secB");
    userA = await seedUser(direct, A.companyId, `secA-${randomUUID().slice(0, 8)}@x.test`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("emit ghi security_alerts row + audit 'security_alert' cùng tx", async () => {
    const ok = await svc.emit(A.companyId, {
      alertType: "repeated_reauth_failure",
      severity: "high",
      subject: userA,
      subjectUserId: userA,
      detail: { context: "2fa_challenge", ip: "1.2.3.4" },
    });
    expect(ok).toBe(true);

    const alerts = await direct.query(
      "SELECT alert_type, severity, subject, detail FROM security_alerts WHERE company_id = $1",
      [A.companyId],
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].alert_type).toBe("repeated_reauth_failure");
    expect(alerts.rows[0].severity).toBe("high");

    const audit = await direct.query(
      "SELECT 1 FROM audit_logs WHERE company_id = $1 AND object_type = 'security_alert'",
      [A.companyId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("sanitize: khoá nhạy cảm trong detail bị loại (KHÔNG ghi secret/password/code)", async () => {
    await svc.emit(A.companyId, {
      alertType: "anomalous_login",
      subject: userA,
      // các khoá này PHẢI bị strip — defense-in-depth chống rò vô ý.
      detail: { password: "p", secret: "s", otp: "123456", reason: "new_device", count: 3 },
    });
    const row = await direct.query(
      "SELECT detail FROM security_alerts WHERE company_id = $1 AND alert_type = 'anomalous_login'",
      [A.companyId],
    );
    const detail = row.rows[0].detail as Record<string, unknown>;
    expect(detail).not.toHaveProperty("password");
    expect(detail).not.toHaveProperty("secret");
    expect(detail).not.toHaveProperty("otp");
    expect(detail.reason).toBe("new_device");
    expect(detail.count).toBe(3);
  });

  it("tenant isolation: alert của A KHÔNG thấy từ ngữ cảnh tenant B (RLS)", async () => {
    const db = new DatabaseService();
    // Ghi alert cho A rồi đọc qua app-path withTenant(B) → 0 row (RLS lọc chéo tenant).
    await svc.emit(A.companyId, { alertType: "anomalous_login", subject: userA });
    const seenFromB = await db.withTenant(B.companyId, async (tx) => {
      const rows = await tx.execute(
        // raw count qua app role — RLS ép company_id = current tenant (B) → 0 hàng của A.
        "SELECT count(*)::int AS n FROM security_alerts" as never,
      );
      return (rows.rows[0] as { n: number }).n;
    });
    expect(seenFromB).toBe(0);
  });

  it("append-only: app role KHÔNG có quyền UPDATE/DELETE security_alerts", async () => {
    const grants = await direct.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name='security_alerts' AND grantee='mediaos_app'`,
    );
    const privs = grants.rows.map((r) => r.privilege_type as string);
    expect(privs).toContain("SELECT");
    expect(privs).toContain("INSERT");
    expect(privs).not.toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });
});
