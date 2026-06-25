import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants } from "../helpers/seed";

/**
 * S2-AUTH-SEED-1 / L2-SUPERADMIN-BOOTSTRAP — integration (DB cô lập LANE_DB).
 *
 * Boot SuperAdminBootstrapService với env PLATFORM_SUPERADMIN_* set → đường app (mediaos_app, RLS FORCE) qua
 * withTenant seed:
 *   • 1 role company-scoped 'super-admin' (company_id = company, is_system=false) — BẤT BIẾN #1 RLS WITH CHECK.
 *   • 1 user super-admin (password hash argon2id — KHÔNG plaintext, BẤT BIẾN #3).
 *   • grant TOÀN BỘ catalog data_scope='System' TRỪ reveal-secret:platform-account.
 *   • 1 user_role.
 * Boot LẦN 2 → KHÔNG nhân đôi (idempotent). VẮNG email → no-op (suite riêng).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env dev chung → đỏ-giả; CHỈ chạy DB cô lập.
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!runIsolatedDb)(
  "SuperAdminBootstrapService (mig 0444 + runtime, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();
    const slug = `sa-${randomUUID().slice(0, 8)}`;
    const email = `superadmin+${randomUUID().slice(0, 6)}@demo.local`;
    const password = "Sup3rSecret!Pwd123";
    let companyId = "";

    // Lazy imports: chỉ nạp khi suite chạy (tránh load db/index.ts ở môi trường không DB).
    type Svc =
      import("../../src/permission/super-admin-bootstrap.service").SuperAdminBootstrapService;

    async function makeService(envOverride: Record<string, string | undefined>): Promise<Svc> {
      const { SuperAdminBootstrapService } =
        await import("../../src/permission/super-admin-bootstrap.service");
      const { SuperAdminBootstrapRepository } =
        await import("../../src/permission/super-admin-bootstrap.repository");
      const { DatabaseService } = await import("../../src/db/db.service");
      const { PasswordService } = await import("../../src/auth/password.service");
      const { AuditService } = await import("../../src/events/audit.service");
      const { OutboxService } = await import("../../src/events/outbox.service");

      const svc = new SuperAdminBootstrapService(
        new DatabaseService(),
        new PasswordService(),
        new SuperAdminBootstrapRepository(),
        new AuditService(),
        new OutboxService(),
      );
      // Override env seam (loadConfig) → tránh phụ thuộc process.env thật.
      (svc as unknown as { loadConfig: () => Record<string, string | undefined> }).loadConfig =
        () => envOverride;
      return svc;
    }

    beforeAll(async () => {
      const res = await direct.query<{ id: string }>(
        "INSERT INTO companies (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
        [`SA Co ${slug}`, slug],
      );
      companyId = res.rows[0].id;
    });

    afterAll(async () => {
      if (companyId) await cleanupTenants(direct, [companyId]);
      await direct.end();
    });

    it("VẮNG PLATFORM_SUPERADMIN_EMAIL → no-op (KHÔNG tạo role/user)", async () => {
      const svc = await makeService({});
      await svc.onApplicationBootstrap();

      const roles = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM roles WHERE company_id=$1 AND name='super-admin'",
        [companyId],
      );
      expect(roles.rows[0].n, "no-op không tạo role super-admin").toBe(0);
    });

    it("EMAIL set → 1 role company-scoped + 1 user (hash argon2id) + grant catalog TRỪ reveal-secret + 1 user_role", async () => {
      const svc = await makeService({
        PLATFORM_SUPERADMIN_EMAIL: email,
        PLATFORM_SUPERADMIN_PASSWORD: password,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: slug,
        PLATFORM_SUPERADMIN_NAME: "Super Admin",
      });
      await svc.onApplicationBootstrap();

      // role company-scoped (company_id = company, is_system=false) — BẤT BIẾN #1
      const role = await direct.query<{ id: string; company_id: string; is_system: boolean }>(
        "SELECT id, company_id, is_system FROM roles WHERE company_id=$1 AND name='super-admin' AND deleted_at IS NULL",
        [companyId],
      );
      expect(role.rows.length, "đúng 1 role super-admin company-scoped").toBe(1);
      expect(role.rows[0].company_id, "company_id = company (KHÔNG NULL)").toBe(companyId);
      expect(role.rows[0].is_system, "is_system=false (company-scoped runtime)").toBe(false);
      const roleId = role.rows[0].id;

      // user với hash argon2id (KHÔNG plaintext — BẤT BIẾN #3)
      const user = await direct.query<{ id: string; password_hash: string }>(
        "SELECT id, password_hash FROM users WHERE company_id=$1 AND normalized_email=lower($2) AND deleted_at IS NULL",
        [companyId, email],
      );
      expect(user.rows.length, "đúng 1 user super-admin").toBe(1);
      expect(user.rows[0].password_hash.startsWith("$argon2id$"), "hash argon2id").toBe(true);
      expect(user.rows[0].password_hash, "KHÔNG plaintext").not.toBe(password);

      // grant TOÀN BỘ catalog data_scope='System' TRỪ reveal-secret:platform-account
      const catalogCount = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM permissions WHERE NOT (action='reveal-secret' AND resource_type='platform-account')",
      );
      const grantCount = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1 AND effect='ALLOW'",
        [roleId],
      );
      expect(grantCount.rows[0].n, "grant = toàn bộ catalog trừ reveal-secret").toBe(
        catalogCount.rows[0].n,
      );

      const allSystem = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1 AND data_scope <> 'System'",
        [roleId],
      );
      expect(allSystem.rows[0].n, "mọi grant super-admin data_scope='System'").toBe(0);

      // reveal-secret:platform-account KHÔNG được grant
      const reveal = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id=$1 AND p.action='reveal-secret' AND p.resource_type='platform-account'`,
        [roleId],
      );
      expect(reveal.rows[0].n, "reveal-secret:platform-account KHÔNG role-grant (ADR-0010)").toBe(
        0,
      );

      // 1 user_role
      const ur = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3",
        [user.rows[0].id, roleId, companyId],
      );
      expect(ur.rows[0].n, "đúng 1 user_role").toBe(1);
    });

    it("Boot LẦN 2 → KHÔNG nhân đôi (idempotent: 1 role, 1 user, 1 user_role, grant count bất biến)", async () => {
      const roleBefore = await direct.query<{ id: string }>(
        "SELECT id FROM roles WHERE company_id=$1 AND name='super-admin' AND deleted_at IS NULL",
        [companyId],
      );
      const roleId = roleBefore.rows[0].id;
      const grantsBefore = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1",
        [roleId],
      );

      const svc = await makeService({
        PLATFORM_SUPERADMIN_EMAIL: email,
        PLATFORM_SUPERADMIN_PASSWORD: password,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: slug,
        PLATFORM_SUPERADMIN_NAME: "Super Admin",
      });
      await svc.onApplicationBootstrap();

      const roleAfter = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM roles WHERE company_id=$1 AND name='super-admin' AND deleted_at IS NULL",
        [companyId],
      );
      expect(roleAfter.rows[0].n, "vẫn đúng 1 role super-admin").toBe(1);

      const userAfter = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM users WHERE company_id=$1 AND normalized_email=lower($2) AND deleted_at IS NULL",
        [companyId, email],
      );
      expect(userAfter.rows[0].n, "vẫn đúng 1 user").toBe(1);

      const urAfter = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM user_roles WHERE role_id=$1",
        [roleId],
      );
      expect(urAfter.rows[0].n, "vẫn đúng 1 user_role (KHÔNG nhân đôi)").toBe(1);

      const grantsAfter = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1",
        [roleId],
      );
      expect(grantsAfter.rows[0].n, "grant count bất biến (idempotent)").toBe(
        grantsBefore.rows[0].n,
      );
    });

    it("EMAIL set + company slug không tồn tại → throw (fail-fast, KHÔNG seed)", async () => {
      const svc = await makeService({
        PLATFORM_SUPERADMIN_EMAIL: "ghost@nowhere.local",
        PLATFORM_SUPERADMIN_PASSWORD: password,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: `ghost-${randomUUID().slice(0, 8)}`,
      });
      await expect(svc.onApplicationBootstrap()).rejects.toThrow();
    });
  },
);
