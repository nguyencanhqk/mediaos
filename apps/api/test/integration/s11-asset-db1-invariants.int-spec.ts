import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASH_CANONICAL_ROLES } from "../../src/dashboard/dashboard-widget-catalog.const";
import { NOTI_CANONICAL_ROLES } from "../../src/foundation/seed/notification-event-catalog.const";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S11-ASSET-DB-1 (mig 0549 · 0550 · 0551) — CHỐT HỒI QUY cho nền dữ liệu ASSET (DB-15 §6/§9 · SPEC-13 §11/§17/§18).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy ĐÚNG MỘT
 * LẦN lúc migrate. Sau khi merge, một WO sau `GRANT DELETE ON asset_assignments`, `GRANT UPDATE ON asset_inventories`
 * cấp bảng, đổi partial unique thành non-partial cùng tên, hay grant `assign:asset` cho employee — KHÔNG có gì đỏ:
 * `tenant-isolation`/`rls-registry` không phủ column-GRANT, `xtenant-fk-ratchet` chỉ phủ HÌNH DẠNG FK.
 * (mirror `s7-chat-db1-invariants.int-spec.ts`; memory `reviewers-pass-real-bugs` + `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL ở cấp job).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code` + `err.constraint` ĐÍCH DANH và có ĐỐI CHỨNG DƯƠNG trên CÙNG constraint
 * (plan-reviewer B4: ca âm neo theo tên vẫn xanh nếu index viết nhầm thành non-partial cùng tên — vế dương
 * "đóng lượt cũ rồi mở lượt mới" mới chứng minh predicate). Mọi mutation chạy trong tx ROLLBACK.
 */
describe.skipIf(!hasDb)("S11-ASSET-DB-1 · bất biến nền dữ liệu ASSET (mig 0549–0551)", () => {
  const direct = directPool();
  const app = appPool(2);
  const worker = workerPool(1);

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let empA: string;
  let empB: string;
  let catA: string;
  let catB: string;
  let catAPrefix: string;
  let assetA: string;
  let assetB: string;
  const ASSET_A_CODE = `TS-LT-${randomUUID().slice(0, 4).toUpperCase()}`;
  const ASSET_A_SERIAL = `SN-A-${randomUUID().slice(0, 8)}`;
  let assignmentA: string; // Active
  let maintenanceA: string; // Open
  let inventoryA: string; // Closed
  let itemA: string;

  type Outcome = { code: string | null; constraint?: string; message?: string };

  async function withRole<T>(
    pool: Pool,
    companyId: string | null,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    let restored = true;
    try {
      await c.query("BEGIN");
      if (companyId) {
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      }
      return await fn(c);
    } finally {
      try {
        await c.query("ROLLBACK");
      } catch {
        restored = false;
      }
      // release(true) huỷ connection nếu ROLLBACK hỏng — trả connection bẩn về pool là xanh-giả hàng loạt.
      c.release(restored ? undefined : true);
    }
  }

  const asApp = <T>(companyId: string | null, fn: (c: PoolClient) => Promise<T>) =>
    withRole(app, companyId, fn);

  /** Chạy MỘT chuỗi câu lệnh dưới app role trong tx (rollback); trả mã lỗi PG của câu ĐẦU TIÊN hỏng. */
  async function attemptSeq(
    companyId: string | null,
    steps: Array<[string, unknown[]?]>,
    pool: Pool = app,
  ): Promise<Outcome> {
    return withRole(pool, companyId, async (c) => {
      try {
        for (const [sql, params] of steps) await c.query(sql, params ?? []);
        return { code: null };
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string };
        return { code: err.code ?? "UNKNOWN", constraint: err.constraint, message: err.message };
      }
    });
  }
  const attempt = (companyId: string | null, sql: string, params: unknown[] = []) =>
    attemptSeq(companyId, [[sql, params]]);

  const RETURN_OK =
    "UPDATE asset_assignments SET status='Returned', returned_at=now(), return_condition='Good' WHERE id=$1";
  const CLOSE_MAINT_OK =
    "UPDATE asset_maintenances SET status='Closed', closed_at=now() WHERE id=$1";

  beforeAll(async () => {
    A = await seedCompany(direct, "assetA");
    B = await seedCompany(direct, "assetB");
    userA = await seedUser(direct, A.companyId, `asset-a-${A.slug}@x.test`);
    userB = await seedUser(direct, B.companyId, `asset-b-${B.slug}@x.test`);

    const mkEmp = async (companyId: string, userId: string) =>
      (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [companyId, userId],
        )
      ).rows[0].id as string;
    empA = await mkEmp(A.companyId, userA);
    empB = await mkEmp(B.companyId, userB);

    const mkCat = async (companyId: string, prefix: string) =>
      (
        await direct.query(
          `INSERT INTO asset_categories (company_id, code, name, code_prefix)
           VALUES ($1, $2, 'Laptop', $3) RETURNING id`,
          [companyId, `LAPTOP-${prefix}`, prefix],
        )
      ).rows[0].id as string;
    catAPrefix = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    catA = await mkCat(A.companyId, catAPrefix);
    catB = await mkCat(B.companyId, randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase());

    const mkAsset = async (
      companyId: string,
      categoryId: string,
      code: string,
      serial: string | null,
    ) =>
      (
        await direct.query(
          `INSERT INTO assets (company_id, category_id, asset_code, name, serial_number, status)
           VALUES ($1, $2, $3, 'Dell Latitude', $4, 'In Stock') RETURNING id`,
          [companyId, categoryId, code, serial],
        )
      ).rows[0].id as string;
    assetA = await mkAsset(A.companyId, catA, ASSET_A_CODE, ASSET_A_SERIAL);
    assetB = await mkAsset(
      B.companyId,
      catB,
      `TS-LT-${randomUUID().slice(0, 4).toUpperCase()}`,
      null,
    );

    assignmentA = (
      await direct.query(
        `INSERT INTO asset_assignments (company_id, asset_id, employee_id, assigned_by, status)
         VALUES ($1, $2, $3, $4, 'Active') RETURNING id`,
        [A.companyId, assetA, empA, userA],
      )
    ).rows[0].id as string;
    maintenanceA = (
      await direct.query(
        `INSERT INTO asset_maintenances (company_id, asset_id, reason, status)
         VALUES ($1, $2, 'Thay pin', 'Open') RETURNING id`,
        [A.companyId, assetA],
      )
    ).rows[0].id as string;
    inventoryA = (
      await direct.query(
        `INSERT INTO asset_inventories
           (company_id, name, status, closed_at, total_items, found_count, missing_count, not_checked_count)
         VALUES ($1, 'Kiểm kê Q3', 'Closed', now(), 1, 1, 0, 0) RETURNING id`,
        [A.companyId],
      )
    ).rows[0].id as string;
    itemA = (
      await direct.query(
        `INSERT INTO asset_inventory_items
           (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id, result, checked_at)
         VALUES ($1, $2, $3, 'Assigned', $4, 'Found', now()) RETURNING id`,
        [A.companyId, inventoryA, assetA, empA],
      )
    ).rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    await direct.end();
    await app.end();
    await worker.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // A. BẤT BIẾN #2 — sổ không xoá / UPDATE cấp cột, ép ở TẦNG DB bằng GRANT
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. GRANT: 4 sổ không DELETE + UPDATE cấp cột; 2 bảng mutable không DELETE; worker chỉ SELECT", () => {
    it("A1 app role KHÔNG DELETE được 4 sổ — 42501 (đối chứng: INSERT vào sổ OK)", async () => {
      for (const [table, id] of [
        ["asset_assignments", assignmentA],
        ["asset_maintenances", maintenanceA],
        ["asset_inventories", inventoryA],
        ["asset_inventory_items", itemA],
      ] as const) {
        const r = await attempt(A.companyId, `DELETE FROM ${table} WHERE id=$1`, [id]);
        expect(r.code, `${table}: DELETE phải bị chặn bởi GRANT`).toBe("42501");
      }
      const ins = await attempt(
        A.companyId,
        `INSERT INTO asset_maintenances (company_id, asset_id, reason, status)
         VALUES ($1, $2, 'đối chứng', 'Closed')`,
        [A.companyId, assetA],
      );
      // 'Closed' thiếu closed_at ⇒ vỡ close_pair; dùng Open thì đụng uq — nên đóng ngay bằng closed_at.
      expect(ins.code).toBe("23514");
      const ins2 = await attempt(
        A.companyId,
        `INSERT INTO asset_maintenances (company_id, asset_id, reason, status, closed_at)
         VALUES ($1, $2, 'đối chứng', 'Closed', now())`,
        [A.companyId, assetA],
      );
      expect(ins2.code, "INSERT vào sổ dưới app role phải OK").toBeNull();
    });

    it("A2 app role KHÔNG UPDATE được cột ngoài allowlist — 42501 (đối chứng: cột trong allowlist OK)", async () => {
      const denied: Array<[string, string, string]> = [
        ["asset_assignments", "asset_id = asset_id", assignmentA],
        ["asset_assignments", "acknowledged_at = now()", assignmentA],
        ["asset_assignments", "employee_id = employee_id", assignmentA],
        ["asset_maintenances", "reason = 'x'", maintenanceA],
        ["asset_maintenances", "asset_id = asset_id", maintenanceA],
        ["asset_inventories", "name = 'x'", inventoryA],
        ["asset_inventories", "opened_at = now()", inventoryA],
        ["asset_inventory_items", "expected_status = 'In Stock'", itemA],
        ["asset_inventory_items", "asset_id = asset_id", itemA],
      ];
      for (const [table, set, id] of denied) {
        const r = await attempt(A.companyId, `UPDATE ${table} SET ${set} WHERE id=$1`, [id]);
        expect(r.code, `${table} SET ${set}: phải 42501`).toBe("42501");
      }
      const allowed: Array<[string, string, string]> = [
        ["asset_assignments", "return_note = 'ok', updated_at = now()", assignmentA],
        ["asset_maintenances", "result_note = 'ok', cost = 10", maintenanceA],
        ["asset_inventories", "note = 'ok'", inventoryA],
        ["asset_inventory_items", "note = 'ok'", itemA],
      ];
      for (const [table, set, id] of allowed) {
        const r = await attempt(A.companyId, `UPDATE ${table} SET ${set} WHERE id=$1`, [id]);
        expect(r.code, `${table} SET ${set}: phải OK`).toBeNull();
      }
    });

    it("A2b acknowledged_at: column-grant chỉ chặn UPDATE — CHECK chk_asset_assignments_ack_v1 chặn cả INSERT (v1)", async () => {
      const r = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id, acknowledged_at) VALUES ($1, $2, $3, now())`,
          [A.companyId, assetA, empA],
        ],
      ]);
      expect(r.code).toBe("23514");
      expect(r.constraint).toBe("chk_asset_assignments_ack_v1");
    });

    it("A3 asset_categories/assets: KHÔNG DELETE (42501) — soft-delete qua UPDATE deleted_at OK", async () => {
      expect((await attempt(A.companyId, "DELETE FROM assets WHERE id=$1", [assetA])).code).toBe(
        "42501",
      );
      expect(
        (await attempt(A.companyId, "DELETE FROM asset_categories WHERE id=$1", [catA])).code,
      ).toBe("42501");
      expect(
        (
          await attempt(
            A.companyId,
            "UPDATE assets SET deleted_at=now(), deleted_by=$2 WHERE id=$1",
            [assetA, userA],
          )
        ).code,
      ).toBeNull();
      expect(
        (
          await attempt(A.companyId, "UPDATE asset_categories SET deleted_at=now() WHERE id=$1", [
            catA,
          ])
        ).code,
      ).toBeNull();
    });

    it("A4 mediaos_worker: SELECT OK, INSERT/UPDATE/DELETE 42501 trên cả 6 bảng", async () => {
      for (const table of [
        "asset_categories",
        "assets",
        "asset_assignments",
        "asset_maintenances",
        "asset_inventories",
        "asset_inventory_items",
      ]) {
        const sel = await attemptSeq(A.companyId, [[`SELECT count(*) FROM ${table}`]], worker);
        expect(sel.code, `${table}: worker SELECT phải OK`).toBeNull();
        const upd = await attemptSeq(
          A.companyId,
          [[`UPDATE ${table} SET updated_at = now()`]],
          worker,
        );
        expect(upd.code, `${table}: worker UPDATE phải 42501`).toBe("42501");
        const del = await attemptSeq(A.companyId, [[`DELETE FROM ${table}`]], worker);
        expect(del.code, `${table}: worker DELETE phải 42501`).toBe("42501");
      }
      const ins = await attemptSeq(
        A.companyId,
        [
          [
            `INSERT INTO asset_categories (company_id, code, name, code_prefix) VALUES ($1, 'w', 'w', 'WK')`,
            [A.companyId],
          ],
        ],
        worker,
      );
      expect(ins.code, "worker INSERT phải 42501").toBe("42501");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // B. BẤT BIẾN #1 — composite tenant FK: id của tenant B không được trỏ tới từ hàng của A (KI-046)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("B. composite tenant FK chặn tham chiếu chéo tenant — 23503 đích danh", () => {
    it("B1 asset_assignments.employee_id của tenant B → 23503 asset_assignments_employee_tenant_fk (cùng tenant OK)", async () => {
      const bad = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, assetA, empB],
        ],
      ]);
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("asset_assignments_employee_tenant_fk");
      const ok = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, assetA, empA],
        ],
      ]);
      expect(ok.code, "đối chứng cùng tenant phải OK").toBeNull();
    });

    it("B2 assets.category_id của tenant B → 23503 assets_category_tenant_fk", async () => {
      const bad = await attempt(
        A.companyId,
        `INSERT INTO assets (company_id, category_id, asset_code, name) VALUES ($1, $2, 'TS-X-0001', 'x')`,
        [A.companyId, catB],
      );
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("assets_category_tenant_fk");
      const ok = await attempt(
        A.companyId,
        `INSERT INTO assets (company_id, category_id, asset_code, name) VALUES ($1, $2, 'TS-X-0001', 'x')`,
        [A.companyId, catA],
      );
      expect(ok.code).toBeNull();
    });

    it("B3 asset_assignments.assigned_by = user của tenant B → 23503 asset_assignments_assigned_by_tenant_fk", async () => {
      const bad = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id, assigned_by) VALUES ($1, $2, $3, $4)`,
          [A.companyId, assetA, empA, userB],
        ],
      ]);
      expect(bad.code).toBe("23503");
      expect(bad.constraint).toBe("asset_assignments_assigned_by_tenant_fk");
      const ok = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id, assigned_by) VALUES ($1, $2, $3, $4)`,
          [A.companyId, assetA, empA, userA],
        ],
      ]);
      expect(ok.code).toBeNull();
    });

    it("B4 asset_inventory_items: asset_id / expected_holder_employee_id của tenant B → 23503 đúng tên FK", async () => {
      const badAsset = await attempt(
        A.companyId,
        `INSERT INTO asset_inventory_items (company_id, inventory_id, asset_id, expected_status)
         VALUES ($1, $2, $3, 'In Stock')`,
        [A.companyId, inventoryA, assetB],
      );
      expect(badAsset.code).toBe("23503");
      expect(badAsset.constraint).toBe("asset_inventory_items_asset_tenant_fk");

      const badHolder = await attemptSeq(A.companyId, [
        [`UPDATE asset_inventory_items SET note='free slot' WHERE id=$1`, [itemA]],
        [
          `INSERT INTO asset_inventory_items
             (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id)
           SELECT $1, $2, a.id, 'Assigned', $3 FROM assets a WHERE a.id = $4`,
          [A.companyId, inventoryA, empB, assetA],
        ],
      ]);
      // (inventoryA, assetA) đã có dòng itemA ⇒ phải dùng asset khác: tạo asset mới trong cùng tx.
      expect(["23503", "23505"]).toContain(badHolder.code);
      const badHolder2 = await attemptSeq(A.companyId, [
        [
          `INSERT INTO assets (id, company_id, category_id, asset_code, name)
           VALUES ('00000000-0000-4000-8000-00000000a5e7', $1, $2, 'TS-X-0002', 'x')`,
          [A.companyId, catA],
        ],
        [
          `INSERT INTO asset_inventory_items
             (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id)
           VALUES ($1, $2, '00000000-0000-4000-8000-00000000a5e7', 'Assigned', $3)`,
          [A.companyId, inventoryA, empB],
        ],
      ]);
      expect(badHolder2.code).toBe("23503");
      expect(badHolder2.constraint).toBe("asset_inventory_items_holder_tenant_fk");
      const ok = await attemptSeq(A.companyId, [
        [
          `INSERT INTO assets (id, company_id, category_id, asset_code, name)
           VALUES ('00000000-0000-4000-8000-00000000a5e7', $1, $2, 'TS-X-0002', 'x')`,
          [A.companyId, catA],
        ],
        [
          `INSERT INTO asset_inventory_items
             (company_id, inventory_id, asset_id, expected_status, expected_holder_employee_id)
           VALUES ($1, $2, '00000000-0000-4000-8000-00000000a5e7', 'Assigned', $3)`,
          [A.companyId, inventoryA, empA],
        ],
      ]);
      expect(ok.code, "đối chứng holder cùng tenant phải OK").toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. Partial unique = chốt cuối "một lượt đang sống" (CHECK không ép được chuyển tiếp FSM)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("C. partial unique — 23505 đích danh + vế DƯƠNG chứng minh predicate", () => {
    it("C1 hai lượt Active cùng asset → 23505 uq_asset_assignments_active; Returned rồi Active mới → OK", async () => {
      const bad = await attempt(
        A.companyId,
        `INSERT INTO asset_assignments (company_id, asset_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, assetA, empA],
      );
      expect(bad.code).toBe("23505");
      expect(bad.constraint).toBe("uq_asset_assignments_active");
      const ok = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, assetA, empA],
        ],
      ]);
      expect(
        ok.code,
        "đóng lượt cũ (1 câu đủ 3 cột) rồi mở lượt mới phải OK — predicate status='Active'",
      ).toBeNull();
    });

    it("C2 hai lượt bảo trì Open / hai đợt kiểm kê Open → 23505; đóng rồi mở lại → OK", async () => {
      const badM = await attempt(
        A.companyId,
        `INSERT INTO asset_maintenances (company_id, asset_id, reason) VALUES ($1, $2, 'x')`,
        [A.companyId, assetA],
      );
      expect(badM.code).toBe("23505");
      expect(badM.constraint).toBe("uq_asset_maintenances_open");
      const okM = await attemptSeq(A.companyId, [
        [CLOSE_MAINT_OK, [maintenanceA]],
        [
          `INSERT INTO asset_maintenances (company_id, asset_id, reason) VALUES ($1, $2, 'x')`,
          [A.companyId, assetA],
        ],
      ]);
      expect(okM.code, "đóng lượt bảo trì rồi mở lượt mới phải OK").toBeNull();

      const OPEN_INV = `INSERT INTO asset_inventories (company_id, name) VALUES ($1, 'đợt') RETURNING id`;
      const badI = await attemptSeq(A.companyId, [
        [OPEN_INV, [A.companyId]],
        [OPEN_INV, [A.companyId]],
      ]);
      expect(badI.code).toBe("23505");
      expect(badI.constraint).toBe("uq_asset_inventories_open");
      const okI = await asApp(A.companyId, async (c) => {
        try {
          const first = (await c.query(OPEN_INV, [A.companyId])).rows[0].id as string;
          await c.query(
            `UPDATE asset_inventories SET status='Closed', closed_at=now(), total_items=0, found_count=0,
                    missing_count=0, not_checked_count=0 WHERE id=$1`,
            [first],
          );
          await c.query(OPEN_INV, [A.companyId]);
          return null;
        } catch (e) {
          return (e as { code?: string }).code ?? "UNKNOWN";
        }
      });
      expect(okI, "đóng đợt (1 câu đủ 6 cột) rồi mở đợt mới phải OK").toBeNull();
    });

    it("C3 code_prefix KHÔNG cấp lại sau soft-delete (unique không partial) — nhưng `code` thì được", async () => {
      const bad = await attemptSeq(A.companyId, [
        [`UPDATE asset_categories SET deleted_at=now() WHERE id=$1`, [catA]],
        [
          `INSERT INTO asset_categories (company_id, code, name, code_prefix) VALUES ($1, 'NEW-CODE', 'x', $2)`,
          [A.companyId, catAPrefix],
        ],
      ]);
      expect(bad.code).toBe("23505");
      expect(bad.constraint).toBe("uq_asset_categories_company_prefix");
      const ok = await attemptSeq(A.companyId, [
        [`UPDATE asset_categories SET deleted_at=now() WHERE id=$1`, [catA]],
        [
          `INSERT INTO asset_categories (company_id, code, name, code_prefix) VALUES ($1, $2, 'x', 'ZZ9')`,
          [A.companyId, `LAPTOP-${catAPrefix}`],
        ],
      ]);
      expect(
        ok.code,
        "`code` cấp lại sau soft-delete phải OK (partial deleted_at IS NULL)",
      ).toBeNull();
      const dupLive = await attempt(
        A.companyId,
        `INSERT INTO asset_categories (company_id, code, name, code_prefix) VALUES ($1, $2, 'x', 'ZZ8')`,
        [A.companyId, `LAPTOP-${catAPrefix}`],
      );
      expect(dupLive.code).toBe("23505");
      expect(dupLive.constraint).toBe("uq_asset_categories_company_code_active");
    });

    it("C4 assets: trùng asset_code/serial live → 23505 đích danh; hai serial NULL OK; soft-delete rồi tái dùng code OK", async () => {
      const INS = `INSERT INTO assets (company_id, category_id, asset_code, name, serial_number) VALUES ($1, $2, $3, 'x', $4)`;
      const dupCode = await attempt(A.companyId, INS, [A.companyId, catA, ASSET_A_CODE, null]);
      expect(dupCode.code).toBe("23505");
      expect(dupCode.constraint).toBe("uq_assets_company_code_active");
      const dupSerial = await attempt(A.companyId, INS, [
        A.companyId,
        catA,
        "TS-LT-9999",
        ASSET_A_SERIAL,
      ]);
      expect(dupSerial.code).toBe("23505");
      expect(dupSerial.constraint).toBe("uq_assets_company_serial_active");
      const twoNull = await attemptSeq(A.companyId, [
        [INS, [A.companyId, catA, "TS-LT-9001", null]],
        [INS, [A.companyId, catA, "TS-LT-9002", null]],
      ]);
      expect(
        twoNull.code,
        "hai asset serial NULL phải OK (predicate serial_number IS NOT NULL)",
      ).toBeNull();
      const reuse = await attemptSeq(A.companyId, [
        [`UPDATE assets SET deleted_at=now() WHERE id=$1`, [assetA]],
        [INS, [A.companyId, catA, ASSET_A_CODE, ASSET_A_SERIAL]],
      ]);
      expect(
        reuse.code,
        "soft-delete rồi tạo lại cùng code+serial phải OK (predicate deleted_at IS NULL)",
      ).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. CHECK cặp cột — 23514 đích danh + đối chứng dương / ca biên
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. CHECK — 23514 đích danh", () => {
    it("D1 chk_asset_assignments_return_pair: Returned thiếu returned_at · Active có return_condition", async () => {
      const r1 = await attemptSeq(A.companyId, [
        [RETURN_OK, [assignmentA]],
        [
          `INSERT INTO asset_assignments (company_id, asset_id, employee_id, status, return_condition)
           VALUES ($1, $2, $3, 'Returned', 'Good')`,
          [A.companyId, assetA, empA],
        ],
      ]);
      expect(r1.code).toBe("23514");
      expect(r1.constraint).toBe("chk_asset_assignments_return_pair");
      const r2 = await attempt(
        A.companyId,
        `UPDATE asset_assignments SET return_condition='Good' WHERE id=$1`,
        [assignmentA],
      );
      expect(r2.code).toBe("23514");
      expect(r2.constraint).toBe("chk_asset_assignments_return_pair");
      const r3 = await attempt(
        A.companyId,
        `UPDATE asset_assignments SET status='Returned', returned_at=now() WHERE id=$1`,
        [assignmentA],
      );
      expect(r3.code, "Returned thiếu return_condition").toBe("23514");
      expect(
        (await attempt(A.companyId, RETURN_OK, [assignmentA])).code,
        "đối chứng thu hồi 1 câu đủ cột",
      ).toBeNull();
    });

    it("D2 chk_asset_inventories_close_pair: tổng lệch / thiếu 1 số → 23514; đúng 4 số → OK", async () => {
      const OPEN_INV = `INSERT INTO asset_inventories (company_id, name) VALUES ($1, 'đợt') RETURNING id`;
      const run = (set: string) =>
        asApp(A.companyId, async (c) => {
          try {
            const id = (await c.query(OPEN_INV, [A.companyId])).rows[0].id as string;
            await c.query(`UPDATE asset_inventories SET ${set} WHERE id=$1`, [id]);
            return { code: null } as Outcome;
          } catch (e) {
            const err = e as { code?: string; constraint?: string };
            return { code: err.code ?? "UNKNOWN", constraint: err.constraint } as Outcome;
          }
        });
      const mismatch = await run(
        "status='Closed', closed_at=now(), total_items=5, found_count=1, missing_count=1, not_checked_count=1",
      );
      expect(mismatch.code).toBe("23514");
      expect(mismatch.constraint).toBe("chk_asset_inventories_close_pair");
      const missingOne = await run(
        "status='Closed', closed_at=now(), total_items=3, found_count=1, missing_count=1",
      );
      expect(missingOne.code).toBe("23514");
      expect(missingOne.constraint).toBe("chk_asset_inventories_close_pair");
      const openWithTotals = await run("total_items=1");
      expect(openWithTotals.code, "Open mà có số tổng kết cũng vỡ").toBe("23514");
      const ok = await run(
        "status='Closed', closed_at=now(), total_items=3, found_count=1, missing_count=1, not_checked_count=1",
      );
      expect(ok.code, "đóng đợt với 4 số đúng phải OK").toBeNull();
    });

    it("D3 các CHECK giá trị: expected_status · code_prefix · purchase_price · warranty (biên = OK) · check_pair", async () => {
      const exp = await attempt(
        A.companyId,
        `INSERT INTO asset_inventory_items (company_id, inventory_id, asset_id, expected_status) VALUES ($1, $2, $3, 'Disposed')`,
        [A.companyId, inventoryA, assetB],
      );
      expect(exp.code).toBe("23514");
      expect(exp.constraint).toBe("chk_asset_inventory_items_expected");

      const prefix = await attempt(
        A.companyId,
        `INSERT INTO asset_categories (company_id, code, name, code_prefix) VALUES ($1, 'p', 'x', 'ab')`,
        [A.companyId],
      );
      expect(prefix.code).toBe("23514");
      expect(prefix.constraint).toBe("chk_asset_categories_prefix");

      const price = await attempt(
        A.companyId,
        `INSERT INTO assets (company_id, category_id, asset_code, name, purchase_price) VALUES ($1, $2, 'TS-P-1', 'x', -1)`,
        [A.companyId, catA],
      );
      expect(price.code).toBe("23514");
      expect(price.constraint).toBe("chk_assets_price");

      const W = `INSERT INTO assets (company_id, category_id, asset_code, name, purchase_date, warranty_end_date)
                 VALUES ($1, $2, 'TS-W-1', 'x', $3, $4)`;
      const warranty = await attempt(A.companyId, W, [
        A.companyId,
        catA,
        "2026-02-01",
        "2026-01-31",
      ]);
      expect(warranty.code).toBe("23514");
      expect(warranty.constraint).toBe("chk_assets_warranty");
      const boundary = await attempt(A.companyId, W, [
        A.companyId,
        catA,
        "2026-02-01",
        "2026-02-01",
      ]);
      expect(
        boundary.code,
        "warranty_end_date = purchase_date là HỢP LỆ (CHECK >=, không >)",
      ).toBeNull();

      const pair = await attempt(
        A.companyId,
        `UPDATE asset_inventory_items SET result='Missing', checked_at=NULL WHERE id=$1`,
        [itemA],
      );
      expect(pair.code).toBe("23514");
      expect(pair.constraint).toBe("chk_asset_inventory_items_check_pair");
      const pairOk = await attempt(
        A.companyId,
        `UPDATE asset_inventory_items SET result='Missing', checked_at=now(), checked_by=$2 WHERE id=$1`,
        [itemA, userA],
      );
      expect(pairOk.code).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. RLS smoke (lưới đầy đủ ở tenant-isolation qua rls-registry)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("E. RLS", () => {
    it("E1 không GUC ⇒ 0 hàng; GUC A không thấy hàng B", async () => {
      const noCtx = await asApp(null, async (c) =>
        Number((await c.query(`SELECT count(*)::int AS n FROM assets`)).rows[0].n),
      );
      expect(noCtx).toBe(0);
      const seesB = await asApp(A.companyId, async (c) =>
        Number(
          (await c.query(`SELECT count(*)::int AS n FROM assets WHERE id=$1`, [assetB])).rows[0].n,
        ),
      );
      expect(seesB).toBe(0);
      const seesA = await asApp(A.companyId, async (c) =>
        Number(
          (await c.query(`SELECT count(*)::int AS n FROM assets WHERE id=$1`, [assetA])).rows[0].n,
        ),
      );
      expect(seesA).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // F. Seed quyền / role / audit CHECK (mig 0550)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("F. seed 0550 — ma trận §9d, role asset-manager, audit CHECK", () => {
    it("F1 đúng 28 grant §9d; employee KHÔNG assign; asset-manager is_system + không canonical", async () => {
      const res = await direct.query<{
        role: string;
        action: string;
        resource: string;
        scope: string;
      }>(
        `SELECT r.name AS role, p.action, p.resource_type AS resource, rp.data_scope AS scope
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL AND rp.effect = 'ALLOW'
            AND p.resource_type IN ('asset','asset-category','asset-maintenance','asset-inventory')`,
      );
      const actual = new Set(res.rows.map((x) => `${x.role}|${x.action}|${x.resource}|${x.scope}`));
      const full = (role: string) => [
        `${role}|access|asset|Own`,
        `${role}|view|asset|Company`,
        `${role}|create|asset|Company`,
        `${role}|update|asset|Company`,
        `${role}|delete|asset|Company`,
        `${role}|assign|asset|Company`,
        `${role}|revoke|asset|Company`,
        `${role}|dispose|asset|Company`,
        `${role}|manage|asset-category|Company`,
        `${role}|manage|asset-maintenance|Company`,
        `${role}|manage|asset-inventory|Company`,
      ];
      const expected = new Set([
        "employee|access|asset|Own",
        "employee|view|asset|Own",
        "manager|access|asset|Own",
        "manager|view|asset|Department",
        "hr|access|asset|Own",
        "hr|view|asset|Company",
        ...full("company-admin"),
        ...full("asset-manager"),
      ]);
      expect(expected.size).toBe(28);
      expect([...actual].sort()).toEqual([...expected].sort());
      expect(actual.has("employee|assign|asset|Own")).toBe(false);
      expect(actual.has("employee|assign|asset|Company")).toBe(false);

      const role = await direct.query<{
        id: string;
        is_system: boolean;
        requires_two_factor: boolean;
      }>(
        `SELECT id, is_system, requires_two_factor FROM roles
          WHERE name='asset-manager' AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0].id).toBe("00000000-0000-0000-0000-000000000012");
      expect(role.rows[0].is_system).toBe(true);
      expect(role.rows[0].requires_two_factor).toBe(false);
      expect(DASH_CANONICAL_ROLES as readonly string[]).not.toContain("asset-manager");
      expect(NOTI_CANONICAL_ROLES as readonly string[]).not.toContain("asset-manager");

      const perms = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM permissions
          WHERE resource_type IN ('asset','asset-category','asset-maintenance','asset-inventory') AND is_sensitive = false`,
      );
      expect(perms.rows[0].n, "11 cặp, cả 11 is_sensitive=false").toBe(11);
    });

    it("F2 CHECK audit_logs.object_type chứa 5 giá trị asset* VÀ canary cũ 'employee'/'user' còn (NO-LOSS)", async () => {
      const def = (
        await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid='audit_logs'::regclass AND contype='c' AND conname='audit_logs_object_type_chk'`,
        )
      ).rows[0]?.def;
      expect(def).toBeTruthy();
      for (const v of [
        "asset",
        "asset_category",
        "asset_assignment",
        "asset_maintenance",
        "asset_inventory",
        "employee",
        "user",
      ]) {
        expect(new RegExp(`[,{']${v}[',}]`).test(def), `CHECK phải chứa '${v}'`).toBe(true);
      }
      expect(
        new RegExp(`[,{']asset_inventory_item[',}]`).test(def),
        "KHÔNG có asset_inventory_item",
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. NOTI (mig 0551) — CHECK cả hai bảng + catalog
  // ─────────────────────────────────────────────────────────────────────────────
  describe("G. seed 0551 — NOTI", () => {
    it("G1 notifications nhận module_code='ASSET'/notification_type='Asset' dưới app role; giá trị lạ → 23514 đích danh", async () => {
      const INS = `INSERT INTO notifications (company_id, user_id, body, module_code, notification_type) VALUES ($1, $2, 'x', $3, $4)`;
      const ok = await attempt(A.companyId, INS, [A.companyId, userA, "ASSET", "Asset"]);
      expect(ok.code, "vế notifications phải đã nới (lỗi 0507 quên vế này)").toBeNull();
      const badModule = await attempt(A.companyId, INS, [A.companyId, userA, "XXX", "Asset"]);
      expect(badModule.code).toBe("23514");
      expect(badModule.constraint).toBe("chk_notifications_module_code");
      const badType = await attempt(A.companyId, INS, [A.companyId, userA, "ASSET", "Xxx"]);
      expect(badType.code).toBe("23514");
      expect(badType.constraint).toBe("chk_notifications_notification_type");
    });

    it("G2 3 event global DedupeKey/enabled/Asset + 3 template có target_url + variables_schema", async () => {
      const ev = await direct.query<{
        event_code: string;
        dedupe_strategy: string;
        default_priority: string;
      }>(
        `SELECT event_code, dedupe_strategy, default_priority FROM notification_events
          WHERE company_id IS NULL AND deleted_at IS NULL AND module_code='ASSET' AND notification_type='Asset'
            AND is_enabled = true ORDER BY event_code`,
      );
      expect(ev.rows.map((r) => r.event_code)).toEqual([
        "ASSET_ASSIGNED",
        "ASSET_MAINTENANCE_DUE",
        "ASSET_REVOKED",
      ]);
      expect(ev.rows.every((r) => r.dedupe_strategy === "DedupeKey")).toBe(true);
      expect(ev.rows.find((r) => r.event_code === "ASSET_MAINTENANCE_DUE")?.default_priority).toBe(
        "High",
      );
      const tpl = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
          WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code='ASSET'
            AND t.channel='IN_APP' AND t.locale='vi-VN' AND t.status='Active' AND t.is_default
            AND t.target_url_template IS NOT NULL AND t.variables_schema IS NOT NULL`,
      );
      expect(tpl.rows[0].n).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // H. Idempotency — bằng chứng DUY NHẤT (db:migrate lần 2 KHÔNG thực thi gì: migrator bỏ qua migration đã áp)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("H. idempotency 0550 + 0551 (chạy lại NGUYÊN file qua owner)", () => {
    it("H1 chạy lại toàn bộ 0550 + 0551 ⇒ 0 exception, count roles/permissions/role_permissions/events/templates KHÔNG đổi", async () => {
      const COUNTS = `
        -- CHỈ đếm hàng DO WO NÀY sở hữu — đếm cả catalog dễ đỏ-giả khi spec khác seed global song song (silent-failure-hunter LOW-2).
        SELECT
          (SELECT count(*) FROM roles WHERE name = 'asset-manager' AND company_id IS NULL AND deleted_at IS NULL) AS roles,
          (SELECT count(*) FROM permissions
            WHERE resource_type IN ('asset','asset-category','asset-maintenance','asset-inventory'))            AS perms,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE p.resource_type IN ('asset','asset-category','asset-maintenance','asset-inventory'))            AS grants,
          (SELECT count(*) FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'ASSET')                          AS events,
          (SELECT count(*) FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code = 'ASSET') AS templates,
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'audit_logs_object_type_chk')      AS audit_def`;
      const before = (await direct.query(COUNTS)).rows[0];
      for (const file of [
        "0550_s11assetdb1_seed_role_perms_audit.sql",
        "0551_s11assetdb1_noti_asset.sql",
      ]) {
        const sql = readFileSync(path.join(__dirname, "..", "..", "migrations", file), "utf8");
        for (const stmt of sql.split("--> statement-breakpoint")) {
          if (
            stmt
              .trim()
              .replace(/^--.*$/gm, "")
              .trim().length === 0
          )
            continue;
          await direct.query(stmt);
        }
      }
      const after = (await direct.query(COUNTS)).rows[0];
      expect(after).toEqual(before);
    });
  });
});
