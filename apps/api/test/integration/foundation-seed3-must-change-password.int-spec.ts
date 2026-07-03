import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";
import { DatabaseService } from "../../src/db/db.service";
import { PasswordService } from "../../src/auth/password.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { SuperAdminBootstrapService } from "../../src/permission/super-admin-bootstrap.service";
import { SuperAdminBootstrapRepository } from "../../src/permission/super-admin-bootstrap.repository";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import type { ModuleCatalogService } from "../../src/foundation/module-catalog/module-catalog.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";

/**
 * S2-FND-SEED-3 (Lane D) — CHUỖI dựng-từ-trống → super-admin → login → must_change_password lifecycle.
 * Postgres THẬT, DB CÔ LẬP `mediaos_<lane>` (CLAUDE §9.5), gate CỨNG `hasDb && LANE_DB` (đỏ-giả trên DB
 * dev chung). Đặt ở test/ (KHÔNG colocated) — case dựng AuthService/BootstrapService thật + login + capture log.
 *
 * PHỦ (DB10-TC-001/002/003 + §17.2 điểm 5 + §19.3 + BẤT BIẾN #3 + owner-chốt #7):
 *   (DB10-TC-004 THẬT = "Thiếu extension pgcrypto" — KHÔNG liên quan must_change_password; must_change_password
 *    thuộc DB-10 §17.2 điểm 5 "Bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên").
 *   • bootstrap chain: SuperAdminBootstrapService seed super-admin vào company (đại diện tenant-root vừa
 *     ensure) → user must_change_password=true (§17.2 điểm 5) + audit auth.super_admin_bootstrapped GIỮ
 *     NGUYÊN, KHÔNG audit riêng company auto-create (owner-chốt #7).
 *   • secret non-leak (BẤT BIẾN #3 / QA-06): log bootstrap KHÔNG chứa PLATFORM_SUPERADMIN_PASSWORD;
 *     audit `after` payload KHÔNG lộ password_hash.
 *   • login admin OK (§19.3 / DB10-TC-001): AuthService.login trả token.
 *   • lifecycle (QA-04/QA-05): /auth/me → mustChangePassword=true; change-password → clear cờ (cùng tx) ⇒
 *     DB false + password rotated; /auth/me sau đó → mustChangePassword=false.
 *   • idempotent (DB10-TC-003): boot 2 lần → 1 user + grant-count ổn định (KHÔNG phình).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

const SLUG = `seed3d-${TAG}`;
const EMAIL = `superadmin-seed3d+${TAG}@demo.local`;
const PASSWORD = "S3d!Sup3rSecret#Pwd";
const NEW_PASSWORD = "S3d!Rotated#Pwd2026";
const META = { ip: "127.0.0.1", userAgent: "vitest-seed3d" };

const bootstrapEnv: Record<string, string> = {
  PLATFORM_SUPERADMIN_EMAIL: EMAIL,
  PLATFORM_SUPERADMIN_PASSWORD: PASSWORD,
  PLATFORM_SUPERADMIN_COMPANY_SLUG: SLUG,
  PLATFORM_SUPERADMIN_NAME: "Super Admin Seed3D",
  // BOOTSTRAP_COMPANY_SLUG khớp slug → ensure/resolve trúng cùng tenant (chuỗi bootstrap khép kín).
  BOOTSTRAP_COMPANY_SLUG: SLUG,
  BOOTSTRAP_COMPANY_LANGUAGE: "vi",
  BOOTSTRAP_COMPANY_CURRENCY: "VND",
};

/** Capture MỌI level log (Logger.prototype) vào 1 mảng để assert secret-non-leak. Trả restore(). */
function captureLoggerOutput(sink: string[]): { restore: () => void } {
  const levels = ["log", "warn", "error", "debug", "verbose"] as const;
  for (const level of levels) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      sink.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return { restore: () => vi.restoreAllMocks() };
}

describe.skipIf(!runDb)(
  "S2-FND-SEED-3 Lane D — bootstrap chain + must_change_password lifecycle (crown, DB thật)",
  () => {
    const direct: Pool = directPool();
    const dbsvc = new DatabaseService();
    const password = new PasswordService();
    let companyId = "";
    let userId = "";
    const bootstrapLogs: string[] = [];

    function makeBootstrapService(env: Record<string, string>): SuperAdminBootstrapService {
      const svc = new SuperAdminBootstrapService(
        dbsvc,
        password,
        new SuperAdminBootstrapRepository(),
        new AuditService(),
        new OutboxService(),
      );
      (svc as unknown as { loadConfig: () => Record<string, string> }).loadConfig = () => env;
      return svc;
    }

    function makeAuth(): AuthService {
      const permissions = new PermissionService(new PermissionRepository(dbsvc));
      const modules = { getMyApps: async () => [] } as unknown as ModuleCatalogService;
      const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
      const replayGuard = new ReplayGuardService(new ValkeyService());
      const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
      const twoFactor = new TwoFactorService(
        dbsvc,
        secrets,
        new TotpService(),
        new TokenService(),
        new AuditService(),
        new LoginRateLimiter(),
        replayGuard,
      );
      return new AuthService(
        dbsvc,
        password,
        new TokenService(),
        new LoginRateLimiter(),
        new AuditService(),
        new OutboxService(),
        permissions,
        secrets,
        twoFactor,
        replayGuard,
        securityAlerts,
        makeSecurityPolicyService(dbsvc),
        modules,
      );
    }

    function expectTokens(r: LoginResponse): AuthTokens {
      if ("twoFactorRequired" in r)
        throw new Error("KHÔNG mong đợi 2FA challenge cho super-admin seed");
      return r;
    }

    beforeAll(async () => {
      // Seed tenant-root (đại diện company vừa ensure_default_company tạo). Dùng slug khớp để super-admin
      // resolveCompanyBySlug trúng — deterministic trên LANE_DB dùng chung (N=1 guard có thể trả active KHÁC).
      const c = await direct.query<{ id: string }>(
        "INSERT INTO companies (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
        [`Seed3D Co ${SLUG}`, SLUG],
      );
      companyId = c.rows[0].id;

      // Chạy bootstrap TRONG capture-log để assert secret-non-leak trên chính lượt seed super-admin.
      const cap = captureLoggerOutput(bootstrapLogs);
      try {
        await makeBootstrapService(bootstrapEnv).onApplicationBootstrap();
      } finally {
        cap.restore();
      }

      const u = await direct.query<{ id: string }>(
        "SELECT id FROM users WHERE company_id=$1 AND normalized_email=lower($2) AND deleted_at IS NULL",
        [companyId, EMAIL],
      );
      userId = u.rows[0]?.id ?? "";
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      if (companyId) await cleanupTenants(direct, [companyId]);
      await direct.end();
    });

    // ── bootstrap seed super-admin + must_change_password=true + secret non-leak ──────────────────
    it("bootstrap — super-admin tạo với must_change_password=true (§17.2 điểm 5)", async () => {
      expect(userId, "super-admin phải được seed vào company theo slug").toBeTruthy();
      const u = await direct.query<{ must_change_password: boolean; status: string }>(
        "SELECT must_change_password, status FROM users WHERE id=$1",
        [userId],
      );
      expect(u.rows[0].must_change_password, "admin bootstrap ÉP đổi mật khẩu lần đầu").toBe(true);
      expect(u.rows[0].status).toBe("active");
    });

    it("secret non-leak — log bootstrap KHÔNG chứa PLATFORM_SUPERADMIN_PASSWORD (BẤT BIẾN #3)", () => {
      const blob = bootstrapLogs.join("\n");
      expect(bootstrapLogs.length, "bootstrap phải có log an toàn (id/đếm quyền)").toBeGreaterThan(
        0,
      );
      expect(blob, "log KHÔNG được lộ mật khẩu env").not.toContain(PASSWORD);
      // KHÔNG lộ hash argon2 (băm mật khẩu) qua log.
      expect(blob).not.toContain("$argon2");
    });

    it("audit — auth.super_admin_bootstrapped GIỮ NGUYÊN, payload KHÔNG lộ password_hash (owner-chốt #7)", async () => {
      const a = await direct.query<{ action: string; after: unknown }>(
        "SELECT action, after FROM audit_logs WHERE company_id=$1 AND action='auth.super_admin_bootstrapped'",
        [companyId],
      );
      expect(a.rows.length, "phải có audit auth.super_admin_bootstrapped").toBeGreaterThanOrEqual(
        1,
      );
      const after = a.rows[0].after as { roleName?: string } | null;
      expect(after?.roleName, "audit after ghi roleName super-admin (metadata an toàn)").toBe(
        "super-admin",
      );
      const blob = JSON.stringify(a.rows[0].after);
      expect(blob, "audit payload KHÔNG lộ mật khẩu/hash").not.toContain(PASSWORD);
      expect(blob).not.toContain("$argon2");

      // owner-chốt #7: KHÔNG audit RIÊNG cho company auto-create (chỉ auth.super_admin_bootstrapped).
      const autoCreate = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_logs
          WHERE company_id=$1 AND (action ILIKE '%default_company%' OR action ILIKE '%company.auto%'
             OR action ILIKE '%company_bootstrap%')`,
        [companyId],
      );
      expect(autoCreate.rows[0].n, "KHÔNG audit riêng company auto-create").toBe(0);
    });

    // ── login admin OK (§19.3) + /auth/me → mustChangePassword=true ───────────────────────────────
    it("login admin thành công (§19.3) + /auth/me trả mustChangePassword=true", async () => {
      const auth = makeAuth();
      const tokens = expectTokens(
        await auth.login({ companySlug: SLUG, email: EMAIL, password: PASSWORD }, META),
      );
      expect(tokens.accessToken, "login super-admin cấp access token").toBeTruthy();

      const me = await auth.me(tokens.accessToken);
      expect(me.email).toBe(EMAIL);
      expect(me.company?.id).toBe(companyId);
      expect(me.mustChangePassword, "/auth/me phơi cờ ép đổi = true").toBe(true);
      // BẤT BIẾN #3: /auth/me KHÔNG rò hash/mật khẩu.
      const blob = JSON.stringify(me);
      expect(blob).not.toContain(PASSWORD);
      expect(blob).not.toContain("$argon2");
      expect(blob).not.toContain("password_hash");
    });

    // ── idempotent (DB10-TC-003): boot 2 lần → 1 user + grant-count ổn định ───────────────────────
    it("idempotent — boot lần 2 → vẫn 1 super-admin + grant-count KHÔNG phình", async () => {
      const roleRow = await direct.query<{ id: string }>(
        "SELECT id FROM roles WHERE company_id=$1 AND name='super-admin' AND deleted_at IS NULL",
        [companyId],
      );
      const roleId = roleRow.rows[0].id;
      // ROOT-FIX flaky grant-count (memory super-admin-bootstrap-flaky-count): super-admin được cấp TOÀN BỘ
      // catalog `permissions` — nếu file test khác chạy SONG SONG bơm permission MỚI vào catalog global giữa
      // 2 lượt boot thì COUNT(*) toàn role sẽ phình (327→333) dù bootstrap idempotent. Chốt tập permission_id
      // đã cấp TRƯỚC boot-2 rồi CHỈ đếm trong tập đó ⇒ miễn nhiễm pollution song song; vẫn chứng minh idempotent
      // (tập cũ KHÔNG bị xoá/nhân đôi — role_permissions có UNIQUE(role_id,permission_id)).
      const grantedBefore = await direct.query<{ permission_id: string }>(
        "SELECT permission_id FROM role_permissions WHERE role_id=$1",
        [roleId],
      );
      const grantedBeforeIds = grantedBefore.rows.map((r) => r.permission_id);

      await makeBootstrapService(bootstrapEnv).onApplicationBootstrap();

      const userCount = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM users WHERE company_id=$1 AND normalized_email=lower($2) AND deleted_at IS NULL",
        [companyId, EMAIL],
      );
      expect(userCount.rows[0].n, "vẫn ĐÚNG 1 super-admin (KHÔNG nhân đôi)").toBe(1);

      const stillGranted = await direct.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id=$1 AND permission_id = ANY($2::uuid[])",
        [roleId, grantedBeforeIds],
      );
      expect(
        stillGranted.rows[0].n,
        "grant cũ giữ nguyên sau boot-2 (idempotent — đếm theo tập permission_id cụ thể, né flaky pollution)",
      ).toBe(grantedBeforeIds.length);
    });

    // ── change-password → clear cờ CÙNG tx → /auth/me trả false (QA-04/QA-05) ─────────────────────
    it("change-password — clear must_change_password CÙNG tx (DB false + password rotated); /auth/me → false", async () => {
      const auth = makeAuth();
      // Tiền đề: sau idempotent re-boot, cờ vẫn true (re-ép). Đổi mật khẩu → clear.
      await auth.changePassword({ id: userId, companyId }, PASSWORD, NEW_PASSWORD);

      // Cờ clear + password rotated CÙNG statement/tx (Lane C) — quan sát qua DB.
      const u = await direct.query<{ must_change_password: boolean; password_hash: string }>(
        "SELECT must_change_password, password_hash FROM users WHERE id=$1",
        [userId],
      );
      expect(u.rows[0].must_change_password, "change-password clear cờ ép đổi").toBe(false);
      // Mật khẩu mới verify được (rotated thật, KHÔNG plaintext — BẤT BIẾN #3).
      expect(await password.verify(u.rows[0].password_hash, NEW_PASSWORD)).toBe(true);

      // Login bằng mật khẩu MỚI → /auth/me phản ánh mustChangePassword=false.
      const tokens = expectTokens(
        await auth.login({ companySlug: SLUG, email: EMAIL, password: NEW_PASSWORD }, META),
      );
      const me = await auth.me(tokens.accessToken);
      expect(me.mustChangePassword, "/auth/me sau đổi mật khẩu → false").toBe(false);
    });
  },
);
