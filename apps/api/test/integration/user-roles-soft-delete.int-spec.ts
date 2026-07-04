import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionAdminService } from "../../src/permission/permission-admin.service";
import { PermissionAdminRepository } from "../../src/permission/permission-admin.repository";
import { SuperAdminBootstrapRepository } from "../../src/permission/super-admin-bootstrap.repository";

// Auth-plane deps (priv-esc login-mint) — mirror newAuth() của test/integration/auth.int-spec.ts.
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { makeSecurityPolicyService } from "../helpers/security-policy";

import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S2-AUTH-DB-3 (Lane D — CANONICAL test/** integration, LANE_DB cô lập) — user_roles SOFT-DELETE.
 *
 * MỤC ĐÍCH: chứng minh trên ĐƯỜNG THẬT (Postgres + RLS+FORCE + role mediaos_app qua DatabaseService.withTenant)
 * các bất biến của mig 0471 + Lane B/C ở TẦNG SERVICE + AUTH (không chỉ repo). Bổ sung cho spec repo-level
 * colocated (src/permission/permission-soft-delete.int.spec.ts) bằng các bằng chứng end-to-end mà repo-level
 * KHÔNG phủ:
 *   (QA-06) append-only: app-role UPDATE (soft-delete) THÀNH CÔNG dưới mediaos_app THẬT; hard DELETE → DENIED (42501).
 *   (QA-05) revokeRole (SERVICE) → row CÒN (tombstone) + user MẤT quyền NGAY qua PermissionService.can()/
 *           getCapabilities (KHÔNG chỉ getCompanyRoleGrants) + cache-invalidate (outbox permission.changed).
 *   (QA-05) re-assign role đã gỡ (SERVICE) → OK, KHÔNG vỡ partial-unique, quyền QUAY LẠI.
 *   (QA-06) forensic: re-grant→re-revoke → tombstone CŨ KHÔNG bị đổi deleted_at/deleted_by (round-2 #5).
 *   (QA-02) re-grant CÙNG expiry null SAU soft-delete (SERVICE assignRole) → KHÔNG NO-OP-GIẢ: hàng active MỚI
 *           + audit RoleAssigned/RoleReassigned + cache-invalidate (findUserRole lọc tombstone, round-3 #9).
 *   (QA-05/06) priv-esc cross-plane: soft-delete user_role PLATFORM_ADMIN_ROLE_ID → LOGIN SAU KHÔNG mint token
 *           operator-plane (aud=tenant, isOperatorTx lọc deleted_at, round-2 #6) — chạy qua AuthService THẬT.
 *   (QA-05) object-grant: object_permission role-subject HẾT hiệu lực qua can() sau soft-delete user_role (round-2 #8).
 *   (bootstrap) assignRole ON CONFLICT +WHERE deleted_at IS NULL — boot 2 lần KHÔNG 42P10, count không phình.
 *   (QA-06) tenant isolation: 2-tenant — soft-delete/reader vẫn ép company_id (không rò chéo).
 *
 * RED-FIRST (thiết kế): mọi assertion viết theo hành vi SAU 0471/Lane B-C. Chạy trên code TRƯỚC đó ⇒ ĐỎ:
 *   - deleteUserRole 4 tham số (thiếu actorUserId) ⇒ compile-fail; hành vi hard-DELETE ⇒ (QA-06) sai (no tombstone);
 *   - reader chưa lọc deleted_at ⇒ can()/getCapabilities vẫn true sau revoke; isOperatorTx chưa lọc ⇒ vẫn mint operator.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate / CLAUDE.md §9.5): .env làm hasDb=true ⇒
 * đỏ-giả trên DB dev chung 'mediaos'; CHỈ chạy trên DB cô lập theo lane. Hand-built services (KHÔNG boot Nest;
 * mọi service stateless singleton — mirror int-spec khác).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/** AC-0b: id role hệ thống platform-admin (mig 0230) — phiên user giữ role này = aud='operator'. */
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Lấy SQLSTATE — drizzle bọc lỗi pg trong DrizzleQueryError (code ở `.cause`), soi cả 2 tầng. */
function pgCode(err: unknown): string | undefined {
  const layers = [err, (err as { cause?: unknown } | null)?.cause];
  for (const layer of layers) {
    if (typeof layer === "object" && layer !== null && "code" in layer) {
      return String((layer as { code: unknown }).code);
    }
  }
  return undefined;
}

describe.skipIf(!runDb)(
  "S2-AUTH-DB-3 user_roles soft-delete — service + auth plane (LANE_DB)",
  () => {
    const direct: Pool = directPool();

    let A: SeededTenant;
    let B: SeededTenant;

    let db: DatabaseService;
    let permRepo: PermissionRepository;
    let permService: PermissionService;
    let adminRepo: PermissionAdminRepository;
    let adminSvc: PermissionAdminService;
    let bootstrapRepo: SuperAdminBootstrapRepository;
    const tokenSvc = new TokenService();
    const meta = { ip: "127.0.0.1", userAgent: "vitest" };

    // Lưới tenant A.
    let adminA: string; // actor có assign-role:user ALLOW (sensitive) → dùng adminSvc.assignRole/revokeRole
    let actorA2: string; // actor khác — chứng minh deleted_by tombstone khác nhau
    let targetA: string; // user nhận/gỡ capRole
    let capRole: string; // role cấp read:project ALLOW Company (non-sensitive)

    // Priv-esc.
    const PLATFORM_EMAIL = "platform-admin-privesc@a.test";
    const PLATFORM_PW = "Passw0rd!privesc-strong";
    let platformUser: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "urssd-a");
      B = await seedCompany(direct, "urssd-b");

      db = new DatabaseService();
      permRepo = new PermissionRepository(db);
      permService = new PermissionService(permRepo);
      adminRepo = new PermissionAdminRepository();
      adminSvc = new PermissionAdminService(
        db,
        permService,
        new AuditService(),
        new OutboxService(),
        adminRepo,
      );
      bootstrapRepo = new SuperAdminBootstrapRepository();

      // Actor A: admin có assign-role:user (ALLOW tường minh, sensitive) → qua assertCan của adminSvc.
      const assignPerm = await seedPermissionCatalog(direct, "assign-role", "user", true);
      adminA = await seedUser(direct, A.companyId, `admin-${A.slug}@t.local`);
      const adminRole = await seedRole(direct, A.companyId, "urssd-admin-role");
      await seedRolePermission(direct, adminRole, assignPerm, "ALLOW");
      await seedUserRole(direct, adminA, adminRole, A.companyId);

      actorA2 = await seedUser(direct, A.companyId, `actor2-${A.slug}@t.local`);

      // Target A + capRole: read:project ALLOW Company (non-sensitive) — role gán/gỡ để test can()/getCapabilities.
      targetA = await seedUser(direct, A.companyId, `target-${A.slug}@t.local`);
      capRole = await seedRole(direct, A.companyId, "urssd-cap-role");
      const readProject = await seedPermissionCatalog(direct, "read", "project", false);
      await seedRolePermission(direct, capRole, readProject, "ALLOW", "Company");

      // Priv-esc user (cần password hash để login THẬT).
      const pw = new PasswordService();
      platformUser = await seedUser(
        direct,
        A.companyId,
        PLATFORM_EMAIL,
        await pw.hash(PLATFORM_PW),
      );
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    // Mỗi test tự-đủ: reset grant của target + platform user (superuser, bypass RLS) — GIỮ role actor adminA.
    beforeEach(async () => {
      await direct.query("DELETE FROM object_permissions WHERE company_id = $1", [A.companyId]);
      await direct.query(
        "DELETE FROM user_roles WHERE company_id = $1 AND user_id = ANY($2::uuid[])",
        [A.companyId, [targetA, platformUser]],
      );
    });

    // ── helpers (app-role path qua DatabaseService.withTenant = mediaos_app THẬT) ────────────────────
    async function grantRole(
      userId: string,
      roleId: string,
      companyId: string,
      grantedBy: string,
    ): Promise<string> {
      const row = await db.withTenant(companyId, (tx) =>
        adminRepo.insertUserRole(tx, { companyId, userId, roleId, grantedBy, expiresAt: null }),
      );
      if (!row) throw new Error("grantRole: insert trả undefined (đã có hàng active?)");
      return row.id;
    }

    async function softDelete(
      userId: string,
      roleId: string,
      companyId: string,
      actorUserId: string,
    ): Promise<string | undefined> {
      return db.withTenant(companyId, (tx) =>
        adminRepo.deleteUserRole(tx, companyId, userId, roleId, actorUserId),
      );
    }

    async function countActiveUserRoles(userId: string, roleId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM user_roles
       WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL`,
        [A.companyId, userId, roleId],
      );
      return r.rows[0].n as number;
    }

    async function countAuditForObject(objectId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id=$1 AND object_type='user_role' AND object_id=$2`,
        [A.companyId, objectId],
      );
      return r.rows[0].n as number;
    }

    async function countOutboxForUser(userId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
       WHERE event_type='permission.changed' AND payload->>'companyId'=$1 AND payload->>'userId'=$2`,
        [A.companyId, userId],
      );
      return r.rows[0].n as number;
    }

    function newAuth(): AuthService {
      const dbsvc = new DatabaseService();
      // Login-mint KHÔNG cần PermissionService (isOperatorTx là query DB trực tiếp trong AuthService).
      const mockPermissions = {
        getCapabilities: async () => ({}),
        getAllowlistedSensitiveCapabilities: async () => ({}),
        getCapabilityScopes: async () => ({}),
      } as unknown as PermissionService;
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
        new PasswordService(),
        new TokenService(),
        new LoginRateLimiter(),
        new AuditService(),
        new OutboxService(),
        mockPermissions,
        secrets,
        twoFactor,
        replayGuard,
        securityAlerts,
        makeSecurityPolicyService(dbsvc),
        { getMyApps: async () => [] } as never,
      );
    }

    // ── (QA-06) APPEND-ONLY: UPDATE soft-delete OK / hard DELETE DENIED dưới mediaos_app THẬT ─────────
    it("(QA-06) app-role UPDATE user_roles (soft-delete) THÀNH CÔNG; hard DELETE bị DENIED (42501)", async () => {
      const urId = await grantRole(targetA, capRole, A.companyId, adminA);

      // POSITIVE: UPDATE (soft-delete) chạy được dưới mediaos_app THẬT (bắt đúng grant UPDATE mới, KHÔNG superuser).
      const updatedId = await softDelete(targetA, capRole, A.companyId, adminA);
      expect(updatedId).toBe(urId);

      // Re-grant hàng active để có mục tiêu cho DELETE.
      await grantRole(targetA, capRole, A.companyId, adminA);

      // NEGATIVE: hard DELETE dưới app-role PHẢI bị chặn (REVOKE DELETE, mig 0471) — grant-level 42501, KHÔNG RLS 0-row.
      const denied = await db
        .withTenant(A.companyId, (tx) =>
          tx.execute(sql`DELETE FROM user_roles WHERE company_id = ${A.companyId}`),
        )
        .then(
          () => null,
          (err) => err,
        );
      expect(denied).not.toBeNull();
      expect(pgCode(denied)).toBe("42501"); // insufficient_privilege
    });

    // ── (QA-05) revokeRole → mất quyền NGAY qua can()/getCapabilities + tombstone + cache-invalidate ──
    it("(QA-05) revokeRole (SERVICE): tombstone giữ + user MẤT quyền NGAY (can()=false, getCapabilities loại) + outbox", async () => {
      const actor = { id: adminA, companyId: A.companyId };
      const assigned = await adminSvc.assignRole(actor, targetA, { roleId: capRole });
      expect(assigned?.id).toBeTruthy();

      // TRƯỚC: quyền hiệu lực qua PermissionService (không chỉ repo).
      const canBefore = await permService.can({
        userId: targetA,
        companyId: A.companyId,
        action: "read",
        resourceType: "project",
        resourceId: null,
      });
      expect(canBefore.allow).toBe(true);
      const capsBefore = await permService.getCapabilities(targetA, A.companyId);
      expect(capsBefore["read:project"]).toBe(true);

      const outboxBefore = await countOutboxForUser(targetA);
      await adminSvc.revokeRole(actor, targetA, capRole);

      // Row VẪN tồn tại dưới dạng tombstone (BẤT BIẾN #2 — forensic), deleted_by = actor.
      const tomb = await direct.query(
        `SELECT deleted_at, deleted_by FROM user_roles
       WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NOT NULL`,
        [A.companyId, targetA, capRole],
      );
      expect(tomb.rows).toHaveLength(1);
      expect(tomb.rows[0].deleted_at).not.toBeNull();
      expect(tomb.rows[0].deleted_by).toBe(adminA);
      expect(await countActiveUserRoles(targetA, capRole)).toBe(0);

      // SAU: mất quyền NGAY (không đợi TTL cache) — reader lọc deleted_at.
      const canAfter = await permService.can({
        userId: targetA,
        companyId: A.companyId,
        action: "read",
        resourceType: "project",
        resourceId: null,
      });
      expect(canAfter.allow).toBe(false);
      const capsAfter = await permService.getCapabilities(targetA, A.companyId);
      expect(capsAfter["read:project"]).toBeUndefined();

      // Cache-invalidate: emit permission.changed cho target (PermissionCacheInvalidator DEL cap-key).
      expect(await countOutboxForUser(targetA)).toBe(outboxBefore + 1);
    });

    it("(QA-05) re-assign role đã gỡ (SERVICE) → OK, KHÔNG vỡ partial-unique, quyền QUAY LẠI", async () => {
      const actor = { id: adminA, companyId: A.companyId };
      await adminSvc.assignRole(actor, targetA, { roleId: capRole });
      await adminSvc.revokeRole(actor, targetA, capRole); // tombstone

      // Re-assign phải thành công (partial-unique chỉ chặn active — tombstone không tính).
      const reassigned = await adminSvc.assignRole(actor, targetA, { roleId: capRole });
      expect(reassigned?.id).toBeTruthy();
      expect(await countActiveUserRoles(targetA, capRole)).toBe(1);

      const canBack = await permService.can({
        userId: targetA,
        companyId: A.companyId,
        action: "read",
        resourceType: "project",
        resourceId: null,
      });
      expect(canBack.allow).toBe(true);
    });

    // ── (QA-06) FORENSIC: re-grant→re-revoke KHÔNG đổi tombstone CŨ (AND deleted_at IS NULL bảo vệ) ───
    it("(QA-06 forensic, round-2 #5): re-revoke KHÔNG ghi đè tombstone CŨ (deleted_at/deleted_by giữ nguyên)", async () => {
      const id1 = await grantRole(targetA, capRole, A.companyId, adminA);
      await softDelete(targetA, capRole, A.companyId, adminA);
      const t1 = await direct.query("SELECT deleted_at, deleted_by FROM user_roles WHERE id=$1", [
        id1,
      ]);
      const deletedAt1 = t1.rows[0].deleted_at as Date;
      expect(deletedAt1).not.toBeNull();
      expect(t1.rows[0].deleted_by).toBe(adminA);

      // Re-grant hàng MỚI rồi re-revoke bởi actorA2 (KHÁC actor).
      const id2 = await grantRole(targetA, capRole, A.companyId, adminA);
      expect(id2).not.toBe(id1);
      await softDelete(targetA, capRole, A.companyId, actorA2);

      // Tombstone CŨ (id1) KHÔNG bị đổi.
      const t1After = await direct.query(
        "SELECT deleted_at, deleted_by FROM user_roles WHERE id=$1",
        [id1],
      );
      expect(t1After.rows[0].deleted_by).toBe(adminA);
      expect(new Date(t1After.rows[0].deleted_at).getTime()).toBe(new Date(deletedAt1).getTime());
      // Tombstone MỚI (id2) mang actor mới.
      const t2 = await direct.query("SELECT deleted_by FROM user_roles WHERE id=$1", [id2]);
      expect(t2.rows[0].deleted_by).toBe(actorA2);
    });

    // ── (QA-02) idempotency round-3 #9: re-grant CÙNG expiry SAU soft-delete KHÔNG no-op-giả ─────────
    it("(QA-02) re-grant CÙNG expiry null SAU soft-delete → hàng active MỚI + audit + cache-invalidate (KHÔNG no-op-giả)", async () => {
      const actor = { id: adminA, companyId: A.companyId };
      const first = await adminSvc.assignRole(actor, targetA, { roleId: capRole }); // expiresAt null
      expect(first?.id).toBeTruthy();
      await adminSvc.revokeRole(actor, targetA, capRole); // soft-delete → findUserRole thấy undefined

      const outboxBefore = await countOutboxForUser(targetA);

      // Re-grant CÙNG expiry (null cả hai). Nếu findUserRole KHÔNG lọc tombstone → sameExpiry no-op-GIẢ (0 ghi).
      const second = await adminSvc.assignRole(actor, targetA, { roleId: capRole });
      expect(second?.id).toBeTruthy();
      // Hàng active MỚI (id khác first) — bằng chứng KHÔNG no-op.
      expect(second!.id).not.toBe(first!.id);
      expect(await countActiveUserRoles(targetA, capRole)).toBe(1);
      // Audit cho hàng mới (RoleAssigned vì findUserRole=undefined sau soft-delete) + cache-invalidate.
      expect(await countAuditForObject(second!.id)).toBe(1);
      const auditRow = await direct.query(
        `SELECT action FROM audit_logs WHERE company_id=$1 AND object_type='user_role' AND object_id=$2 LIMIT 1`,
        [A.companyId, second!.id],
      );
      expect(["RoleAssigned", "RoleReassigned"]).toContain(auditRow.rows[0].action);
      expect(await countOutboxForUser(targetA)).toBe(outboxBefore + 1);
    });

    // ── (QA-05/06) PRIV-ESC cross-plane: soft-delete platform-admin → login KHÔNG mint operator ──────
    it("(QA-05/06 priv-esc, round-2 #6): soft-delete user_role platform-admin → login SAU mint aud=tenant (KHÔNG operator)", async () => {
      // Gán platform-admin (id …f0, company_id NULL) cho platformUser trong tenant A (superuser, bypass RLS).
      await direct.query(
        `INSERT INTO user_roles (user_id, role_id, company_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
        [platformUser, PLATFORM_ADMIN_ROLE_ID, A.companyId],
      );

      const auth = newAuth();
      const loginReq = { companySlug: A.slug, email: PLATFORM_EMAIL, password: PLATFORM_PW };

      // TRƯỚC soft-delete: giữ platform-admin → aud='operator'.
      const before = await auth.login(loginReq, meta);
      if ("twoFactorRequired" in before)
        throw new Error("không mong đợi 2FA challenge (setup lỗi)");
      expect(tokenSvc.verifyAccessToken(before.accessToken, "any").aud).toBe("operator");

      // Soft-delete assignment platform-admin qua app-role path (UPDATE deleted_at).
      const softId = await softDelete(platformUser, PLATFORM_ADMIN_ROLE_ID, A.companyId, adminA);
      expect(softId).toBeTruthy();

      // SAU soft-delete: isOperatorTx lọc deleted_at ⇒ KHÔNG còn operator ⇒ aud='tenant' (không leo thang chéo plane).
      const after = await auth.login(loginReq, meta);
      if ("twoFactorRequired" in after) throw new Error("không mong đợi 2FA challenge (setup lỗi)");
      expect(tokenSvc.verifyAccessToken(after.accessToken, "any").aud).toBe("tenant");
    });

    // ── (QA-05) OBJECT-GRANT role-subject hết hiệu lực qua can() sau soft-delete user_role ───────────
    it("(QA-05 object-grant, round-2 #8): object_permission role-subject HẾT hiệu lực qua can() sau soft-delete user_role", async () => {
      const OBJ_TYPE = "doc";
      const OBJ_ID = randomUUID();
      // view:doc CHỈ cấp qua object_permission role-subject (KHÔNG có company grant) → cô lập ảnh hưởng object-grant.
      const viewDoc = await seedPermissionCatalog(direct, "view", OBJ_TYPE, false);
      await direct.query(
        `INSERT INTO object_permissions
         (company_id, subject_type, subject_id, permission_id, object_type, object_id, effect)
       VALUES ($1, 'role', $2, $3, $4, $5, 'ALLOW') ON CONFLICT DO NOTHING`,
        [A.companyId, capRole, viewDoc, OBJ_TYPE, OBJ_ID],
      );

      // User giữ role active → object-grant role-subject áp dụng.
      await grantRole(targetA, capRole, A.companyId, adminA);
      const canBefore = await permService.can({
        userId: targetA,
        companyId: A.companyId,
        action: "view",
        resourceType: OBJ_TYPE,
        resourceId: OBJ_ID,
      });
      expect(canBefore.allow).toBe(true);

      // Soft-delete user_role → user KHÔNG còn "giữ" role → object-grant role-subject hết hiệu lực → default-deny.
      await softDelete(targetA, capRole, A.companyId, adminA);
      const canAfter = await permService.can({
        userId: targetA,
        companyId: A.companyId,
        action: "view",
        resourceType: OBJ_TYPE,
        resourceId: OBJ_ID,
      });
      expect(canAfter.allow).toBe(false);
    });

    // ── (bootstrap) idempotency: ON CONFLICT + WHERE deleted_at IS NULL — boot 2 lần KHÔNG 42P10 ──────
    it("(bootstrap) assignRole ON CONFLICT +WHERE deleted_at IS NULL — boot 2 lần KHÔNG 42P10, count không phình", async () => {
      const bootUser = await seedUser(
        direct,
        A.companyId,
        `boot-${randomUUID().slice(0, 8)}@a.test`,
      );
      await db.withTenant(A.companyId, (tx) =>
        bootstrapRepo.assignRole(tx, bootUser, capRole, A.companyId),
      );
      // Lần 2 KHÔNG được ném 42P10 (arbiter khớp PARTIAL unique index user_roles_active_uq).
      await expect(
        db.withTenant(A.companyId, (tx) =>
          bootstrapRepo.assignRole(tx, bootUser, capRole, A.companyId),
        ),
      ).resolves.not.toThrow();

      const count = await direct.query(
        "SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3",
        [bootUser, capRole, A.companyId],
      );
      expect(count.rows[0].n).toBe(1);
    });

    // ── (QA-06) TENANT ISOLATION: soft-delete ở A KHÔNG đụng B; reader ép company_id ─────────────────
    it("(QA-06 tenant-iso): soft-delete ở A KHÔNG đụng B; reader ép company_id (không rò chéo tenant)", async () => {
      const targetB = await seedUser(direct, B.companyId, `target-${B.slug}@t.local`);
      const roleB = await seedRole(direct, B.companyId, "urssd-role-b");
      const readProjectB = await seedPermissionCatalog(direct, "read", "project", false);
      await seedRolePermission(direct, roleB, readProjectB, "ALLOW", "Company");

      await grantRole(targetB, roleB, B.companyId, adminA);
      await grantRole(targetA, capRole, A.companyId, adminA);

      // Soft-delete role của A — B KHÔNG bị ảnh hưởng.
      await softDelete(targetA, capRole, A.companyId, adminA);

      const canB = await permService.can({
        userId: targetB,
        companyId: B.companyId,
        action: "read",
        resourceType: "project",
        resourceId: null,
      });
      expect(canB.allow).toBe(true);

      // Ngữ cảnh A (RLS) KHÔNG thấy user_role của B — findUserIdsWithRole roleB dưới company A = rỗng.
      const crossA = await db.withTenant(A.companyId, (tx) =>
        adminRepo.findUserIdsWithRole(tx, A.companyId, roleB),
      );
      expect(crossA).not.toContain(targetB);
    });
  },
);
