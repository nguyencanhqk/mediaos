import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { RoleAdminService } from "../../src/permission/role-admin.service";
import { RoleAdminRepository } from "../../src/permission/role-admin.repository";
import { DataScopeService } from "../../src/permission/data-scope.service";
import { DataScopeRepository } from "../../src/permission/data-scope.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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
 * S6-SEC-1 · S0-B (🔴 CROWN, RED-first) — ROLE HỆ THỐNG TOÀN CỤC LÀ BẤT KHẢ XÂM PHẠM VỚI TENANT.
 *
 * LỖ HỔNG ĐANG VÁ (FULL gate `rls-tenant-isolation-tester` tìm ra, đã tái lập trên DB thật):
 * admin của tenant A, chỉ cần `assign:permission`, XOÁ được `role_permissions` của các role hệ thống
 * **toàn cục** (`roles.company_id IS NULL`) — tức role mà MỌI tenant dùng chung, kể cả công ty thật.
 *
 * Vì sao lọt:
 *   1. DB — policy `role_permissions_tenant_isolation` (mig 0005:87) đặt `OR r.company_id IS NULL`
 *      trong `USING` để tenant ĐỌC được role hệ thống. Postgres **chỉ xét `USING` cho DELETE**
 *      (`WITH CHECK` không áp cho DELETE) ⇒ khe hở dành cho ĐỌC trở thành quyền XOÁ.
 *   2. App  — `assignPermissionToRole`/`revokePermissionFromRole` chỉ chặn
 *      `role.companyId !== null && role.companyId !== actor.companyId`; role toàn cục có
 *      `companyId === null` nên **lọt qua**. Hai hàm này thiếu guard `isSystem` mà
 *      `updateRole`/`deleteRole` đã có.
 *
 * Hậu quả: ghi CHÉO TENANT và **không hoàn tác được qua ứng dụng** — `WITH CHECK` chặn INSERT khôi
 * phục, phải superuser/migration.
 *
 * Vì sao mọi lưới cũ trượt: `role_permissions` KHÔNG có cột `company_id` ⇒ nằm ngoài phép đo
 * "153/153 bảng company_id có RLS+FORCE"; và `tenant-isolation.int-spec` (465 ca) CHỈ chạy SELECT —
 * không có một ca deny GHI chéo tenant nào.
 *
 * File này phủ CẢ HAI tầng (defense in depth) — tầng nào tuột thì tầng kia vẫn phải chặn.
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
 */

const runDb = hasDb && Boolean(process.env["LANE_DB"]);

/** Role hệ thống seed sẵn ở mig 0005 — `company_id IS NULL`, dùng chung mọi tenant. */
const SYSTEM_ROLE_EMPLOYEE = "00000000-0000-0000-0000-000000000008";

describe.skipIf(!runDb)("S6-SEC-1 S0-B — role hệ thống toàn cục bất khả xâm phạm", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let adminUser: string;
  let svc: RoleAdminService;
  const companyIds: string[] = [];

  /** Đếm grant của role hệ thống toàn cục — đọc bằng superuser để không bị RLS che. */
  async function countSystemRoleGrants(): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1",
      [SYSTEM_ROLE_EMPLOYEE],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "sysimmut");
    companyIds.push(A.companyId);

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, "x");
    const adminRole = await seedRole(direct, A.companyId, "sysimmut-admin");
    // `assign:permission` là cặp nhạy cảm — đúng thứ company-admin thật có.
    const assignPerm = await seedPermissionCatalog(direct, "assign", "permission", true);
    await seedRolePermission(direct, adminRole, assignPerm, "ALLOW", "Company");
    await seedUserRole(direct, adminUser, adminRole, A.companyId);

    // BẮT BUỘC truyền DatabaseService tường minh vào PermissionRepository: bản dựng mặc định
    // (`new PermissionRepository()`) trả về 0 grant trong ngữ cảnh test ⇒ can() ra `deny-default` và
    // mọi test dưới đây sẽ "đỏ vì sai lý do" (Forbidden ở cổng assertCan, chứ không phải vì guard
    // system-role) — tức xanh-giả ngược: ta tưởng đã chặn, thật ra chưa chạm tới chỗ cần kiểm.
    const dbsvc = new DatabaseService();
    const permissionService = new PermissionService(new PermissionRepository(dbsvc));
    svc = new RoleAdminService(
      dbsvc,
      permissionService,
      new AuditService(),
      new RoleAdminRepository(),
      // S6-SEC-IDENTITY-PROJ-1 (KI-053): `dataScope` là tham số BẮT BUỘC, không optional-với-default —
      // spec dựng service bằng tay phải truyền instance THẬT, nếu không nó chạy với resolver rỗng và
      // xanh trên đúng nhánh mà bản vá bảo vệ.
      new DataScopeService(permissionService, new DataScopeRepository(dbsvc)),
    );
  });

  afterAll(async () => {
    await app.end();
    await cleanupTenants(direct, companyIds);
  });

  // ── Tầng ứng dụng ────────────────────────────────────────────────────────────

  it("REVOKE: tenant admin gỡ quyền khỏi role hệ thống TOÀN CỤC → bị từ chối, 0 grant biến mất", async () => {
    const before = await countSystemRoleGrants();
    expect(before, "fixture: role hệ thống phải có sẵn grant để phép đo có nghĩa").toBeGreaterThan(0);

    await expect(
      svc.revokePermissionFromRole(
        { id: adminUser, companyId: A.companyId },
        SYSTEM_ROLE_EMPLOYEE,
        { action: "read", resourceType: "employee" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await countSystemRoleGrants()).toBe(before);
  });

  it("ASSIGN: tenant admin thêm quyền vào role hệ thống TOÀN CỤC → bị từ chối, 0 grant thêm", async () => {
    const before = await countSystemRoleGrants();

    await expect(
      svc.assignPermissionToRole({ id: adminUser, companyId: A.companyId }, SYSTEM_ROLE_EMPLOYEE, {
        action: "manage",
        resourceType: "user",
        effect: "ALLOW",
        dataScope: "Company",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await countSystemRoleGrants()).toBe(before);
  });

  // ── Tầng DB (RLS) — tuyến phòng thủ độc lập với app ──────────────────────────

  it("RLS: app role (trong ngữ cảnh tenant A) DELETE role_permissions của role toàn cục → 0 row", async () => {
    const before = await countSystemRoleGrants();
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const del = await c.query("DELETE FROM role_permissions WHERE role_id = $1", [
        SYSTEM_ROLE_EMPLOYEE,
      ]);
      expect(del.rowCount, "RLS phải chặn DELETE hàng của role toàn cục").toBe(0);
    } finally {
      // ROLLBACK PHẢI ở finally: nếu assertion ném trong try thì ROLLBACK không chạy và connection
      // được trả về pool khi đang DỞ TRANSACTION ⇒ test sau đọc phải trạng thái bẩn (đã dính một lần).
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    expect(await countSystemRoleGrants()).toBe(before);
  });

  it("RLS: app role vẫn ĐỌC được role hệ thống (khe hở USING là CHỦ Ý cho đọc, không phải cho ghi)", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const r = await c.query("SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1", [
        SYSTEM_ROLE_EMPLOYEE,
      ]);
      expect(r.rows[0].n, "đọc role hệ thống KHÔNG được siết theo").toBeGreaterThan(0);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("RLS: DELETE grant của role CHÍNH TENANT vẫn chạy (không siết quá tay)", async () => {
    const ownRole = await seedRole(direct, A.companyId, "sysimmut-own");
    const perm = await seedPermissionCatalog(direct, "read", "employee", false);
    await seedRolePermission(direct, ownRole, perm, "ALLOW", "Own");

    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const del = await c.query("DELETE FROM role_permissions WHERE role_id = $1", [ownRole]);
      expect(del.rowCount, "role của chính tenant PHẢI xoá được").toBeGreaterThan(0);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  // ── CÙNG HỌ LỖI trên danh mục NOTI (re-gate S6-SEC-1 tìm ra, mig 0531) ──────
  // Không phải DELETE mà là UPDATE: `notification_events`/`notification_templates` là danh mục TOÀN
  // CỤC (company_id IS NULL) dùng chung mọi tenant, app role có UPDATE, và trước 0531 KHÔNG có trigger
  // bất biến ⇒ một tenant "re-home" được cả danh mục về mình, commit được, và KHÔNG hoàn tác được qua
  // app (WITH CHECK chặn chiều ngược). Mọi tenant khác mất sạch catalog ⇒ không tạo nổi thông báo.
  for (const table of ["notification_events", "notification_templates"] as const) {
    it(`RLS: app role KHÔNG "re-home" được hàng toàn cục của ${table} về tenant mình`, async () => {
      const globalBefore = (
        await direct.query(`SELECT count(*)::int AS n FROM ${table} WHERE company_id IS NULL`)
      ).rows[0].n as number;
      expect(globalBefore, `fixture: ${table} phải có hàng toàn cục`).toBeGreaterThan(0);

      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(
          c.query(`UPDATE ${table} SET company_id = $1 WHERE company_id IS NULL`, [A.companyId]),
        ).rejects.toMatchObject({ code: "23514" }); // check_violation từ enforce_company_id_immutable
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        c.release();
      }

      const globalAfter = (
        await direct.query(`SELECT count(*)::int AS n FROM ${table} WHERE company_id IS NULL`)
      ).rows[0].n as number;
      expect(globalAfter, "danh mục toàn cục phải nguyên vẹn").toBe(globalBefore);
    });
  }

  it("RLS: app role KHÔNG xoá được chính hàng `roles` toàn cục (grant DELETE thừa đã gỡ)", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      // KHÔNG dùng `catch { blocked = true }` trần: bất kỳ lỗi nào (mất kết nối, sai DB, gõ nhầm SQL)
      // cũng sẽ đọc thành "đã chặn" ⇒ deny-case crown xanh giả. Lỗi mong đợi là TẤT ĐỊNH:
      // SQLSTATE 42501 (`permission denied for table roles`) do đã REVOKE DELETE ở mig 0530.
      let blocked = false;
      try {
        const del = await c.query("DELETE FROM roles WHERE company_id IS NULL");
        blocked = del.rowCount === 0; // nếu grant còn mà RLS chặn thì cũng chấp nhận
      } catch (err) {
        expect(
          (err as { code?: string }).code,
          "phải là permission-denied (42501), không phải một lỗi hạ tầng bất kỳ",
        ).toBe("42501");
        blocked = true;
      }
      expect(blocked, "role hệ thống toàn cục không được phép xoá từ ngữ cảnh tenant").toBe(true);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });
});
