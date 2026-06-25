import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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

/**
 * BẤT BIẾN #1 (rls-tenant-isolation-tester PASS) — super-admin company-scoped GHI RUNTIME bởi
 * SuperAdminBootstrapService KHÔNG rò chéo tenant.
 *
 * Khác với suite trên (idempotency/no-duplicate qua `direct` superuser, bypass RLS), suite này kiểm chứng
 * hàng do RUNTIME PATH tạo (role + role_permissions + user_roles của super-admin company A) KHÔNG đọc được
 * khi mở connection app với GUC = công ty B. RLS FORCE (mig 0005) ép:
 *   • roles.USING: company_id = current OR company_id IS NULL → role super-admin (company_id=A, is_system=false)
 *     KHÔNG khớp tenant B ⇒ 0 row.
 *   • role_permissions.USING: EXISTS roles WHERE company_id=current OR NULL → JOIN role A ⇒ 0 row cho B.
 *   • user_roles.USING: company_id = current → user_role (company_id=A) ⇒ 0 row cho B.
 *
 * Positive control: cùng hàng đó HIỂN THỊ dưới GUC = công ty A ⇒ chứng minh 0-row của B là RLS chặn chéo,
 * KHÔNG phải query sai. Idiom asTenant() tái dùng từ auth-appendonly.int-spec.ts / db-tenant.int-spec.ts.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): chỉ chạy DB cô lập.
 */
describe.skipIf(!runIsolatedDb)(
  "BẤT BIẾN #1: super-admin company-scoped (runtime) KHÔNG rò chéo tenant (RLS FORCE)",
  () => {
    const direct = directPool();
    const app = appPool(1);

    const slugA = `sa-x-${randomUUID().slice(0, 8)}`;
    const emailA = `superadmin-x+${randomUUID().slice(0, 6)}@demo.local`;
    const passwordA = "Sup3rSecret!Pwd123";
    let companyA = "";
    let companyB = "";
    let saRoleId = "";
    let saUserId = "";

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
      (svc as unknown as { loadConfig: () => Record<string, string | undefined> }).loadConfig =
        () => envOverride;
      return svc;
    }

    /** Run fn inside a transaction as app role với tenant context set (mirror auth-appendonly.int-spec.ts). */
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

    beforeAll(async () => {
      // Công ty A: boot super-admin qua RUNTIME path (đường app, RLS WITH CHECK company_id=current).
      const resA = await direct.query<{ id: string }>(
        "INSERT INTO companies (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
        [`SA-X Co ${slugA}`, slugA],
      );
      companyA = resA.rows[0].id;

      const svc = await makeService({
        PLATFORM_SUPERADMIN_EMAIL: emailA,
        PLATFORM_SUPERADMIN_PASSWORD: passwordA,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: slugA,
        PLATFORM_SUPERADMIN_NAME: "Super Admin X",
      });
      await svc.onApplicationBootstrap();

      // Capture hàng do runtime tạo cho công ty A (đọc qua direct = bypass RLS, chỉ để lấy id grid).
      const role = await direct.query<{ id: string }>(
        "SELECT id FROM roles WHERE company_id=$1 AND name='super-admin' AND deleted_at IS NULL",
        [companyA],
      );
      saRoleId = role.rows[0].id;
      const user = await direct.query<{ id: string }>(
        "SELECT id FROM users WHERE company_id=$1 AND normalized_email=lower($2) AND deleted_at IS NULL",
        [companyA, emailA],
      );
      saUserId = user.rows[0].id;

      // Công ty B: tenant "ngoài" — KHÔNG được thấy bất kỳ hàng super-admin nào của A qua RLS.
      const slugB = `sa-x-b-${randomUUID().slice(0, 8)}`;
      const resB = await direct.query<{ id: string }>(
        "INSERT INTO companies (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
        [`SA-X Co B ${slugB}`, slugB],
      );
      companyB = resB.rows[0].id;
    });

    afterAll(async () => {
      const ids = [companyA, companyB].filter(Boolean);
      if (ids.length) await cleanupTenants(direct, ids);
      await direct.end();
      await app.end();
    });

    // ── Positive control: hàng runtime HIỂN THỊ dưới GUC = công ty A ───────────────────
    it("positive control: dưới GUC = công ty A, app role THẤY role/role_permissions/user_roles của super-admin", async () => {
      const seen = await asTenant(companyA, async (c) => {
        const role = await c.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM roles WHERE id=$1",
          [saRoleId],
        );
        const rp = await c.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1",
          [saRoleId],
        );
        const ur = await c.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id=$1 AND role_id=$2",
          [saUserId, saRoleId],
        );
        return { role: role.rows[0].n, rp: rp.rows[0].n, ur: ur.rows[0].n };
      });
      expect(seen.role, "tenant A PHẢI thấy role super-admin của mình").toBe(1);
      expect(seen.rp, "tenant A PHẢI thấy role_permissions của super-admin (>0)").toBeGreaterThan(
        0,
      );
      expect(seen.ur, "tenant A PHẢI thấy user_role của super-admin").toBe(1);
    });

    // ── Cross-tenant deny: dưới GUC = công ty B, 0 row (RLS FORCE chặn đọc chéo) ────────
    it("tenant B KHÔNG đọc được role super-admin của công ty A (0 row — roles.USING company-scoped)", async () => {
      const n = await asTenant(companyB, async (c) => {
        const r = await c.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM roles WHERE id=$1", [
          saRoleId,
        ]);
        return r.rows[0].n;
      });
      expect(n, "tenant B KHÔNG được thấy role super-admin company-scoped của A").toBe(0);
    });

    it("tenant B KHÔNG đọc được role_permissions của super-admin công ty A (0 row — RLS JOIN roles)", async () => {
      const n = await asTenant(companyB, async (c) => {
        const r = await c.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1",
          [saRoleId],
        );
        return r.rows[0].n;
      });
      expect(n, "tenant B KHÔNG được thấy grant của super-admin A (rò catalog quyền)").toBe(0);
    });

    it("tenant B KHÔNG đọc được user_roles của super-admin công ty A (0 row — user_roles.USING company_id)", async () => {
      const n = await asTenant(companyB, async (c) => {
        const r = await c.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id=$1 AND role_id=$2",
          [saUserId, saRoleId],
        );
        return r.rows[0].n;
      });
      expect(n, "tenant B KHÔNG được thấy gán super-admin↔user của A").toBe(0);
    });

    it("tenant B liệt kê roles của CHÍNH MÌNH KHÔNG chứa super-admin của A (lưới không thủng im lặng)", async () => {
      const names = await asTenant(companyB, async (c) => {
        const r = await c.query<{ name: string }>(
          "SELECT name FROM roles WHERE company_id=$1 AND deleted_at IS NULL",
          [companyB],
        );
        return r.rows.map((x) => x.name);
      });
      expect(names, "company B chưa seed role nào → KHÔNG có super-admin").not.toContain(
        "super-admin",
      );
    });
  },
);
