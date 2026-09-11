/**
 * S15-PAYROLL-BE-1 — `salary_profile_items` (payload v2 của `PAYROLL-API-020/021/022`).
 *
 * Đây là spec của **ba BLOCKER nặng nhất** trong plan-review vòng 1 — mỗi khối ghim một lớp lỗi TIỀN:
 *
 *   A. 🔴 **B1 — mirror `allowances` KHÔNG được bơm tiền vào `gross`.** `payroll-calc.repository.ts`
 *      cộng MỌI phần tử `allowances[].amount` vào `gross`; nếu validate không ép
 *      `value_type='profile_item'` thì `items:[{componentCode:"TNCN"}]` làm nhân viên **ĐƯỢC CỘNG**
 *      tiền thuế. Và item `isActive:false` không được vào mirror.
 *   B. 🔴 **B4 — `items` VẮNG ở 022 ⇒ KHÔNG chạm hai nguồn.** Coi `undefined` như `[]` là **xoá sạch
 *      phụ cấp trong im lặng**.
 *   C. 🔻 **Nợ DB-1** — hồ sơ DI SẢN mang mã `PC_nnn` ngoài catalog: ĐỌC trả nguyên kèm `note`; GHI lại
 *      y nguyên ⇒ **422 PAYROLL-ERR-018**, KHÔNG 500, KHÔNG im lặng mất dòng.
 *   D. `PAYROLL-ERR-014 profile-item-duplicate` (chốt cuối unique, `23505` ⇒ 409 chứ không 500).
 *
 * ⚠️ **Catalog company-scoped seed RUNTIME** nên spec tự INSERT `salary_components`. **CẤM mã dạng
 * `PC_*` trong seed catalog** — `salary_components_code_shape_check` CHẤP NHẬN `PC_001` (nó chỉ cấm
 * `SYS_`/`TL_`/`GT_`), nên seed nhầm sẽ làm ca C "lưu lại y nguyên ⇒ 422" thành xanh **RỖNG**.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!s15be1items";

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-1 — items[] hồ sơ lương (B1 · B4 · nợ DB-1)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tFull = "";
  let subjectUserId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const patch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);

  /** Ngày hiệu lực DUY NHẤT cho mỗi hồ sơ — unique `(user, effective_date)` là partial. */
  let dayCursor = 0;
  const nextDate = () =>
    `2027-0${1 + Math.floor(dayCursor / 28)}-${String((dayCursor++ % 28) + 1).padStart(2, "0")}`;

  async function createProfile(items: unknown[] | undefined) {
    return post(tFull, "/salary-profiles").send({
      userId: subjectUserId,
      effectiveDate: nextDate(),
      baseSalary: 10_000_000,
      ...(items === undefined ? {} : { items }),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s15items");
    companyIds.push(A.companyId);

    subjectUserId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);

    /**
     * Catalog tối thiểu — **HAI** mã `profile_item` (cần ≥2 cho ca ALLOW đối chứng của D1) + ba mã SAI
     * LOẠI để ghim B1. Mọi mã đều KHÔNG mang tiền tố `PC_`.
     */
    // ⚠️ Fixture phải thoả CẢ HAI CHECK của `salary_components` (mig 0570), nếu không `beforeAll` nổ:
    //   • `value_pair_check`  : `formula` ⇒ formula NOT NULL · `fixed` ⇒ fixed_amount NOT NULL ·
    //                           `profile_item`/`engine` ⇒ CẢ HAI NULL.
    //   • `engine_kind_check` : `(value_type = 'engine') = (kind = 'aggregate')`, và nhánh `engine`
    //                           của `value_pair_check` còn đòi `is_system = true`.
    const comps: Array<[string, string, string, string, string | null, boolean]> = [
      ["PHUCAP_TRUA", "Phụ cấp ăn trưa", "earning", "profile_item", null, false],
      ["PHUCAP_XANG", "Phụ cấp xăng xe", "earning", "profile_item", null, false],
      ["TNCN", "Thuế TNCN", "tax", "formula", "THU_NHAP_CHIU_THUE * 0.1", false],
      ["NGHI_KHONG_LUONG", "Nghỉ không lương", "deduction", "formula", "LUONG_NGAY * 1", false],
      ["TONG_THU_NHAP", "Tổng thu nhập", "aggregate", "engine", null, true],
    ];
    for (const [code, name, kind, valueType, formula, isSystem] of comps) {
      await direct.query(
        `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula, is_system, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [A.companyId, code, name, kind, valueType, formula, isSystem],
      );
    }

    const roleId = await seedRole(direct, A.companyId, `s15items-${randomUUID().slice(0, 6)}`);
    for (const [action, resource] of [
      ["view", "salary-profile"],
      ["manage", "salary-profile"],
    ] as Array<[string, string]>) {
      const permId = await seedPermissionCatalog(direct, action, resource, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    const uid = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
    await seedUserRole(direct, uid, roleId, A.companyId);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `full@${A.slug}.test`, password: LOGIN_PW });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    tFull = res.body.data.accessToken;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. 🔴 B1 — chốt chặn TIỀN ─────────────────────────────────────────────────────────────────
  it("A1 — ALLOW đối chứng: mã `profile_item` hợp lệ ⇒ 201, mirror `allowances` có TÊN TỪ CATALOG", async () => {
    const res = await createProfile([{ componentCode: "PHUCAP_TRUA", amount: 730_000 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      componentCode: "PHUCAP_TRUA",
      componentName: "Phụ cấp ăn trưa",
      kind: "earning",
      amount: 730_000,
    });
    expect(res.body.data.allowances).toEqual([{ name: "Phụ cấp ăn trưa", amount: 730_000 }]);
  });

  it("A2 — 🔴 mã loại `tax` (TNCN) ⇒ 422 018 `profile-item-wrong-type` (KHÔNG được bơm vào gross)", async () => {
    const res = await createProfile([{ componentCode: "TNCN", amount: 5_000_000 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: "kind", message: "profile-item-wrong-type" }),
    );
  });

  it("A3 — 🔴 mã loại `deduction` và `engine` cũng bị TỪ CHỐI (cùng lớp lỗi A2)", async () => {
    for (const code of ["NGHI_KHONG_LUONG", "TONG_THU_NHAP"]) {
      const res = await createProfile([{ componentCode: code, amount: 1_000_000 }]);
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    }
  });

  it("A4 — 🔴 KHÔNG hàng nào được ghi khi validate trượt (ném TRƯỚC tx ⇒ 0 side-effect)", async () => {
    const before = await direct.query(
      `SELECT count(*)::int AS n FROM salary_profile_items WHERE company_id = $1`,
      [A.companyId],
    );
    await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 100_000 },
      { componentCode: "TNCN", amount: 5_000_000 },
    ]);
    const after = await direct.query(
      `SELECT count(*)::int AS n FROM salary_profile_items WHERE company_id = $1`,
      [A.companyId],
    );
    expect(after.rows[0].n, "payload trượt validate vẫn ghi được một phần").toBe(before.rows[0].n);
  });

  it("A5 — 🔴 item `isActive:false` ghi xuống bảng NHƯNG KHÔNG vào mirror `allowances`", async () => {
    const res = await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 730_000, isActive: false },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    // Lịch sử GIỮ ở bảng con…
    const rows = await direct.query(
      `SELECT is_active FROM salary_profile_items
        WHERE salary_profile_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].is_active).toBe(false);
    // …nhưng KHÔNG vào cột nuôi `gross`.
    const sp = await direct.query(
      `SELECT jsonb_array_length(allowances) AS n FROM salary_profiles WHERE id = $1`,
      [id],
    );
    expect(Number(sp.rows[0].n), "item TẮT vẫn được trả tiền").toBe(0);
  });

  // ── B. 🔴 B4 — `items` vắng ở 022 ─────────────────────────────────────────────────────────────
  it("B1 — `PATCH {note}` (KHÔNG gửi `items`) KHÔNG được xoá items lẫn allowances", async () => {
    const created = await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 730_000 },
      { componentCode: "PHUCAP_XANG", amount: 500_000 },
    ]);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    const res = await patch(tFull, `/salary-profiles/${id}`).send({ note: "chỉ sửa ghi chú" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const items = await direct.query(
      `SELECT count(*)::int AS n FROM salary_profile_items
        WHERE salary_profile_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    expect(items.rows[0].n, "PATCH {note} đã XOÁ SẠCH items trong im lặng").toBe(2);
    const sp = await direct.query(
      `SELECT jsonb_array_length(allowances) AS n FROM salary_profiles WHERE id = $1`,
      [id],
    );
    expect(Number(sp.rows[0].n), "PATCH {note} đã xoá mirror allowances trong im lặng").toBe(2);
  });

  it("B2 — ĐỐI CHỨNG DƯƠNG: gửi `items` ⇒ ĐẶT LẠI TOÀN BỘ (2 → 1)", async () => {
    const created = await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 730_000 },
      { componentCode: "PHUCAP_XANG", amount: 500_000 },
    ]);
    const id = created.body.data.id as string;
    const res = await patch(tFull, `/salary-profiles/${id}`).send({
      items: [{ componentCode: "PHUCAP_XANG", amount: 600_000 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].componentCode).toBe("PHUCAP_XANG");
    expect(res.body.data.allowances).toEqual([{ name: "Phụ cấp xăng xe", amount: 600_000 }]);
  });

  it("B3 — gửi `items: []` ⇒ XOÁ HẾT (khác hẳn `undefined` — đó là ý nghĩa của B1)", async () => {
    const created = await createProfile([{ componentCode: "PHUCAP_TRUA", amount: 730_000 }]);
    const id = created.body.data.id as string;
    const res = await patch(tFull, `/salary-profiles/${id}`).send({ items: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.allowances).toEqual([]);
  });

  // ── C. 🔻 Nợ DB-1 — mã `PC_nnn` di sản ────────────────────────────────────────────────────────
  it("C1 — hồ sơ DI SẢN (mã `PC_nnn` ngoài catalog): ĐỌC trả NGUYÊN kèm `note`, 200", async () => {
    const created = await createProfile([]);
    const id = created.body.data.id as string;
    // Giả lập kết quả backfill mig 0570 (DB-13 §12.2.a): `PC_001` + `note` giữ TÊN GỐC.
    await direct.query(
      `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount, note)
       VALUES ($1,$2,'PC_001',730000,'Ăn trưa')`,
      [A.companyId, id],
    );

    const res = await get(tFull, `/salary-profiles/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.items, "dòng di sản bị LỌC MẤT khi đọc").toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      componentCode: "PC_001",
      componentName: null, // ngoài catalog ⇒ không chiếu được
      kind: null,
      note: "Ăn trưa", // tên gốc giữ ở `note`
      amount: 730_000,
    });
  });

  it("C2 — 🔻 GHI LẠI Y NGUYÊN hồ sơ di sản ⇒ 422 018 `profile-item-unknown-component` (KHÔNG 500)", async () => {
    const created = await createProfile([]);
    const id = created.body.data.id as string;
    await direct.query(
      `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount, note)
       VALUES ($1,$2,'PC_002',730000,'Ăn trưa')`,
      [A.companyId, id],
    );
    const read = await get(tFull, `/salary-profiles/${id}`);
    expect(read.status).toBe(200);

    // "Lưu lại y nguyên" = gửi lại đúng những gì vừa đọc.
    const res = await patch(tFull, `/salary-profiles/${id}`).send({
      items: read.body.data.items.map((i: { componentCode: string; amount: number }) => ({
        componentCode: i.componentCode,
        amount: i.amount,
      })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-018");
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: "kind", message: "profile-item-unknown-component" }),
    );
    // Thông điệp phải HƯỚNG DẪN, không chỉ nói "sai".
    expect(res.body.error.message).toContain("danh mục");
    // Và dòng di sản KHÔNG bị mất im lặng.
    const still = await direct.query(
      `SELECT count(*)::int AS n FROM salary_profile_items
        WHERE salary_profile_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    expect(still.rows[0].n, "422 mà vẫn xoá mất dòng di sản").toBe(1);
  });

  it("C3 — ĐỐI CHỨNG DƯƠNG: đổi sang mã catalog THẬT ⇒ 200, dòng di sản được thay", async () => {
    const created = await createProfile([]);
    const id = created.body.data.id as string;
    await direct.query(
      `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount, note)
       VALUES ($1,$2,'PC_003',730000,'Ăn trưa')`,
      [A.companyId, id],
    );
    const res = await patch(tFull, `/salary-profiles/${id}`).send({
      items: [{ componentCode: "PHUCAP_TRUA", amount: 730_000 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].componentCode).toBe("PHUCAP_TRUA");
  });

  // ── D. PAYROLL-ERR-014 profile-item-duplicate ─────────────────────────────────────────────────
  it("D1 — hai dòng CÙNG `componentCode` ⇒ 409 014 `profile-item-duplicate` (KHÔNG 500)", async () => {
    const res = await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 100_000 },
      { componentCode: "PHUCAP_TRUA", amount: 200_000 },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-014");
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ field: "kind", message: "profile-item-duplicate" }),
    );
  });

  it("D2 — ĐỐI CHỨNG DƯƠNG: hai dòng KHÁC mã (cả hai `profile_item`) ⇒ 201", async () => {
    const res = await createProfile([
      { componentCode: "PHUCAP_TRUA", amount: 100_000 },
      { componentCode: "PHUCAP_XANG", amount: 200_000 },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.items).toHaveLength(2);
  });
});
