/**
 * S2-AUTH-DB-3 (Lane B/D) — Integration (Postgres THẬT, DB CÔ LẬP LANE_DB) cho user_roles SOFT-DELETE.
 *
 * Chứng minh trên ĐƯỜNG THẬT (RLS+FORCE + role mediaos_app qua DatabaseService.withTenant) những bất biến
 * KHÔNG mock được (mig 0471 + Lane B writer/reader):
 *   (a) QA-06 append-only: app-role DELETE user_roles → DENIED (42501); UPDATE set deleted_at → THÀNH CÔNG
 *       (bắt đúng grant UPDATE mới, KHÔNG chạy superuser).
 *   (b) deleteUserRole = UPDATE soft-delete: row CÒN (deleted_at/deleted_by set), findUserRole → undefined.
 *   (c) QA-05 reader mất-quyền: getCompanyRoleGrants / …WithScope → [] ngay sau soft-delete.
 *   (d) QA-05 re-assign SAU revoke: insert lại OK, KHÔNG vỡ partial-unique; findUserRole thấy hàng active mới.
 *   (e) QA-06 forensic (round-2 #5): re-grant→re-revoke cùng (user,role,company) → tombstone CŨ KHÔNG bị đổi
 *       deleted_at/deleted_by (nhờ `AND deleted_at IS NULL` trong WHERE của deleteUserRole).
 *   (f) QA-05 object-grant (round-2 #8): object_permission role-subject HẾT hiệu lực sau khi user_role của role
 *       đó bị soft-delete (getObjectGrants nhánh role-subject lọc deleted_at).
 *   (g) findUserIdsWithRole loại user đã soft-delete role.
 *   (h) Bootstrap idempotency: assignRole ON CONFLICT +WHERE deleted_at IS NULL — boot 2 lần KHÔNG 42P10.
 *   (i) QA-06 tenant isolation: 2-tenant — soft-delete/reader vẫn ép company_id (không rò chéo).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. Colocated src/permission → vitest gom qua include `src/**\/*.spec.ts`.
 * Hand-built repos (KHÔNG boot Nest) — DatabaseService/repos đều stateless singletons (mirror int-spec khác).
 *
 * RED: `deleteUserRole` gọi với 5 tham số (actorUserId) + reader lọc deleted_at — trước GREEN chữ ký 4 tham
 *   số ⇒ compile-fail; hành vi DELETE (hard) ⇒ (a)/(b)/(e) đỏ. Sau GREEN pass.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  type SeededTenant,
} from "../../test/helpers/seed";
import { PermissionAdminRepository } from "./permission-admin.repository";
import { PermissionRepository } from "./permission.repository";
import { SuperAdminBootstrapRepository } from "./super-admin-bootstrap.repository";

const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Lấy SQLSTATE code — drizzle bọc lỗi pg trong DrizzleQueryError (code nằm ở `.cause`), nên soi cả 2 tầng. */
function pgCode(err: unknown): string | undefined {
  const layers = [err, (err as { cause?: unknown } | null)?.cause];
  for (const layer of layers) {
    if (typeof layer === "object" && layer !== null && "code" in layer) {
      return String((layer as { code: unknown }).code);
    }
  }
  return undefined;
}

describe.skipIf(!runDb)("S2-AUTH-DB-3 user_roles soft-delete (Postgres thật, LANE_DB)", () => {
  const direct: Pool = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let db: DatabaseService;
  let adminRepo: PermissionAdminRepository;
  let permRepo: PermissionRepository;
  let bootstrapRepo: SuperAdminBootstrapRepository;

  // Lưới tenant A: actor (admin), target user, role + role_permission (read:project ALLOW).
  let actorA: string;
  let actorA2: string;
  let targetA: string;
  let roleA: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "authdb3-a");
    B = await seedCompany(direct, "authdb3-b");
    db = new DatabaseService();
    adminRepo = new PermissionAdminRepository();
    permRepo = new PermissionRepository(db);
    bootstrapRepo = new SuperAdminBootstrapRepository();

    actorA = await seedUser(direct, A.companyId, `actor-${A.slug}@t.local`);
    actorA2 = await seedUser(direct, A.companyId, `actor2-${A.slug}@t.local`);
    targetA = await seedUser(direct, A.companyId, `target-${A.slug}@t.local`);
    roleA = await seedRole(direct, A.companyId, "authdb3-role");
    const permId = await seedPermissionCatalog(direct, "read", "project", false);
    await seedRolePermission(direct, roleA, permId, "ALLOW", "Company");
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // Mỗi test tự-đủ: reset lưới grant của tenant A (superuser, bypass RLS) → không rò trạng thái giữa các it.
  beforeEach(async () => {
    await direct.query("DELETE FROM object_permissions WHERE company_id = $1", [A.companyId]);
    await direct.query("DELETE FROM user_roles WHERE company_id = $1", [A.companyId]);
  });

  /** Chèn 1 user_role ACTIVE (grantedBy=actor) qua app-role path; trả về id. */
  async function grantActive(userId: string, roleId: string, companyId: string): Promise<string> {
    const row = await db.withTenant(companyId, (tx) =>
      adminRepo.insertUserRole(tx, {
        companyId,
        userId,
        roleId,
        grantedBy: actorA,
        expiresAt: null,
      }),
    );
    if (!row) throw new Error("grantActive: insert trả undefined (đã có active?)");
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

  it("(a) QA-06 append-only: app-role UPDATE set deleted_at THÀNH CÔNG; app-role DELETE user_roles bị DENIED (42501)", async () => {
    const urId = await grantActive(targetA, roleA, A.companyId);

    // POSITIVE: UPDATE (soft-delete) chạy được dưới mediaos_app THẬT (không superuser).
    const updatedId = await softDelete(targetA, roleA, A.companyId, actorA);
    expect(updatedId).toBe(urId);

    // Re-grant để có hàng active cho phép thử DELETE.
    await grantActive(targetA, roleA, A.companyId);

    // NEGATIVE: hard-DELETE user_roles dưới app-role PHẢI bị chặn (REVOKE DELETE, mig 0471).
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

  it("(b) deleteUserRole = UPDATE soft-delete: row CÒN với deleted_at/deleted_by set, findUserRole → undefined", async () => {
    const urId = await grantActive(targetA, roleA, A.companyId);

    const before = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserRole(tx, A.companyId, targetA, roleA),
    );
    expect(before?.id).toBe(urId);

    await softDelete(targetA, roleA, A.companyId, actorA);

    // Reader lọc tombstone → undefined.
    const after = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserRole(tx, A.companyId, targetA, roleA),
    );
    expect(after).toBeUndefined();

    // Row VẪN tồn tại (không hard-delete) — deleted_at set + deleted_by = actor (forensic).
    const raw = await direct.query("SELECT deleted_at, deleted_by FROM user_roles WHERE id = $1", [
      urId,
    ]);
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].deleted_at).not.toBeNull();
    expect(raw.rows[0].deleted_by).toBe(actorA);
  });

  it("(c) QA-05 reader mất-quyền: getCompanyRoleGrants / …WithScope trả [] ngay sau soft-delete", async () => {
    await grantActive(targetA, roleA, A.companyId);

    const grantsBefore = await permRepo.getCompanyRoleGrants(targetA, A.companyId);
    expect(grantsBefore.some((g) => g.action === "read" && g.resourceType === "project")).toBe(
      true,
    );
    const scopedBefore = await permRepo.getCompanyRoleGrantsWithScope(targetA, A.companyId);
    expect(scopedBefore.length).toBeGreaterThan(0);

    await softDelete(targetA, roleA, A.companyId, actorA);

    const grantsAfter = await permRepo.getCompanyRoleGrants(targetA, A.companyId);
    expect(grantsAfter).toEqual([]);
    const scopedAfter = await permRepo.getCompanyRoleGrantsWithScope(targetA, A.companyId);
    expect(scopedAfter).toEqual([]);
  });

  it("(d) QA-05 re-assign SAU revoke: insert lại OK (KHÔNG vỡ partial-unique); findUserRole thấy hàng active MỚI", async () => {
    // Dựng tombstone: grant → soft-delete → còn 1 tombstone (deleted_at set).
    await grantActive(targetA, roleA, A.companyId);
    await softDelete(targetA, roleA, A.companyId, actorA);

    // Re-grant phải thành công (partial-unique chỉ chặn active — tombstone không tính).
    const newId = await grantActive(targetA, roleA, A.companyId);
    const active = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserRole(tx, A.companyId, targetA, roleA),
    );
    expect(active?.id).toBe(newId);
    expect(active?.deletedAt ?? null).toBeNull();

    // Quyền quay lại.
    const grants = await permRepo.getCompanyRoleGrants(targetA, A.companyId);
    expect(grants.some((g) => g.action === "read")).toBe(true);
  });

  it("(e) QA-06 forensic (round-2 #5): re-revoke KHÔNG đổi tombstone CŨ (AND deleted_at IS NULL bảo vệ)", async () => {
    // Grant hàng active rồi soft-delete lần 1 bởi actorA → tombstone id1.
    const id1 = await grantActive(targetA, roleA, A.companyId);
    await softDelete(targetA, roleA, A.companyId, actorA);
    const t1 = await direct.query("SELECT deleted_at, deleted_by FROM user_roles WHERE id = $1", [
      id1,
    ]);
    const deletedAt1 = t1.rows[0].deleted_at as Date;
    expect(deletedAt1).not.toBeNull();
    expect(t1.rows[0].deleted_by).toBe(actorA);

    // Re-grant hàng MỚI rồi re-revoke bởi actorA2 (khác actor).
    const id2 = await grantActive(targetA, roleA, A.companyId);
    expect(id2).not.toBe(id1);
    await softDelete(targetA, roleA, A.companyId, actorA2);

    // Tombstone CŨ (id1) KHÔNG bị đổi: deleted_by vẫn actorA, deleted_at KHÔNG thay đổi.
    const t1After = await direct.query(
      "SELECT deleted_at, deleted_by FROM user_roles WHERE id = $1",
      [id1],
    );
    expect(t1After.rows[0].deleted_by).toBe(actorA);
    expect(new Date(t1After.rows[0].deleted_at).getTime()).toBe(new Date(deletedAt1).getTime());

    // Tombstone MỚI (id2) mang actor mới.
    const t2 = await direct.query("SELECT deleted_by FROM user_roles WHERE id = $1", [id2]);
    expect(t2.rows[0].deleted_by).toBe(actorA2);
  });

  it("(f) QA-05 object-grant (round-2 #8): object_permission role-subject HẾT hiệu lực sau soft-delete user_role", async () => {
    const OBJ_TYPE = "project";
    const OBJ_ID = "99999999-9999-9999-9999-999999999999";
    const permId = await seedPermissionCatalog(direct, "read", OBJ_TYPE, false);
    // object_permission subject_type='role' → áp cho MỌI user giữ role đó.
    await direct.query(
      `INSERT INTO object_permissions
         (company_id, subject_type, subject_id, permission_id, object_type, object_id, effect)
       VALUES ($1, 'role', $2, $3, $4, $5, 'ALLOW') ON CONFLICT DO NOTHING`,
      [A.companyId, roleA, permId, OBJ_TYPE, OBJ_ID],
    );

    // User giữ role active → object-grant role-subject áp dụng.
    await grantActive(targetA, roleA, A.companyId);
    const before = await permRepo.getObjectGrants(targetA, A.companyId, OBJ_TYPE, OBJ_ID);
    expect(before.some((g) => g.action === "read" && g.effect === "ALLOW")).toBe(true);

    // Soft-delete user_role → user KHÔNG còn "giữ" role → object-grant role-subject hết hiệu lực.
    await softDelete(targetA, roleA, A.companyId, actorA);
    const after = await permRepo.getObjectGrants(targetA, A.companyId, OBJ_TYPE, OBJ_ID);
    expect(after.some((g) => g.resourceType === OBJ_TYPE)).toBe(false);
  });

  it("(g) findUserIdsWithRole loại user đã soft-delete role", async () => {
    // targetA hiện tombstone (từ f). Cấp lại rồi so sánh trước/sau.
    await grantActive(targetA, roleA, A.companyId);
    const withActive = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserIdsWithRole(tx, A.companyId, roleA),
    );
    expect(withActive).toContain(targetA);

    await softDelete(targetA, roleA, A.companyId, actorA);
    const afterDelete = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserIdsWithRole(tx, A.companyId, roleA),
    );
    expect(afterDelete).not.toContain(targetA);
  });

  it("(h) Bootstrap idempotency: assignRole ON CONFLICT +WHERE deleted_at IS NULL — boot 2 lần KHÔNG 42P10, KHÔNG nhân đôi", async () => {
    const bootUser = await seedUser(direct, A.companyId, `boot-${A.slug}@t.local`);
    await db.withTenant(A.companyId, (tx) =>
      bootstrapRepo.assignRole(tx, bootUser, roleA, A.companyId),
    );
    // Lần 2 — KHÔNG được ném 42P10 (arbiter khớp partial unique index mới).
    await expect(
      db.withTenant(A.companyId, (tx) =>
        bootstrapRepo.assignRole(tx, bootUser, roleA, A.companyId),
      ),
    ).resolves.not.toThrow();

    const count = await direct.query(
      "SELECT count(*)::int AS n FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3",
      [bootUser, roleA, A.companyId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("(i) QA-06 tenant isolation: soft-delete ở A KHÔNG đụng B; reader ép company_id (không rò chéo)", async () => {
    const targetB = await seedUser(direct, B.companyId, `target-${B.slug}@t.local`);
    const roleB = await seedRole(direct, B.companyId, "authdb3-role-b");
    const permId = await seedPermissionCatalog(direct, "read", "project", false);
    await seedRolePermission(direct, roleB, permId, "ALLOW", "Company");

    await grantActive(targetB, roleB, B.companyId);
    await grantActive(targetA, roleA, A.companyId);

    // Soft-delete role của A — B KHÔNG bị ảnh hưởng.
    await softDelete(targetA, roleA, A.companyId, actorA);

    const bGrants = await permRepo.getCompanyRoleGrants(targetB, B.companyId);
    expect(bGrants.some((g) => g.action === "read")).toBe(true);

    // Ngữ cảnh A KHÔNG thấy user_role của B (RLS) — findUserIdsWithRole roleB dưới company A = rỗng.
    const crossA = await db.withTenant(A.companyId, (tx) =>
      adminRepo.findUserIdsWithRole(tx, A.companyId, roleB),
    );
    expect(crossA).not.toContain(targetB);
  });
});
