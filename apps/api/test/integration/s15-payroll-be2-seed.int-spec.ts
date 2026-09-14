import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import {
  PAYROLL_DEFAULT_TEMPLATE_CODE,
  PayrollMasterDataSeeder,
} from "../../src/payroll/payroll-master-data.seeder";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";

/**
 * S15-PAYROLL-BE-2 — plan-review **B2**: `PayrollMasterDataSeeder` chạy **MỖI LẦN BOOT**
 * (`MasterDataSeedBootstrapService` → `reconcileAllCompanies`) và từ BE-2 người dùng SỬA được mẫu (052/053).
 * Seeder KHÔNG được hoàn tác chỉnh sửa hợp lệ — trước bản vá nó chèn lại link cho MỌI mã hệ thống và tạo lại mẫu
 * đã xoá mềm, 0 audit.
 *
 * Mỗi ca dùng CÔNG TY RIÊNG (không đè trạng thái của nhau). Ca ÂM assert `outcome.ok === false` — runner NUỐT
 * throw nên `.rejects` luôn xanh (xem `s15-payroll-db1-seed.int-spec.ts` E4).
 */
describe.skipIf(!hasDb)("S15-PAYROLL-BE-2 · seeder tôn trọng chỉnh sửa mẫu (B2) + assert (5)(6)", () => {
  const direct = directPool();
  const companies: string[] = [];
  let runner: MasterDataSeedRunner;

  beforeAll(() => {
    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new PayrollMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companies);
    await direct.end();
  });

  async function freshSeeded(label: string): Promise<string> {
    const t = await seedCompany(direct, label);
    companies.push(t.companyId);
    const outcomes = await runner.reconcileCompany(t.companyId);
    expect(outcomes.every((o) => o.ok), JSON.stringify(outcomes)).toBe(true);
    return t.companyId;
  }

  async function linkedCodes(companyId: string): Promise<string[]> {
    const { rows } = await direct.query<{ code: string }>(
      `SELECT sc.code FROM payroll_template_components ptc
         JOIN payroll_templates pt ON pt.company_id = ptc.company_id AND pt.id = ptc.template_id
         JOIN salary_components sc ON sc.company_id = ptc.company_id AND sc.id = ptc.component_id
        WHERE ptc.company_id = $1 AND pt.code = $2 AND pt.deleted_at IS NULL
        ORDER BY sc.code`,
      [companyId, PAYROLL_DEFAULT_TEMPLATE_CODE],
    );
    return rows.map((r) => r.code);
  }

  async function reconcileOk(companyId: string): Promise<boolean> {
    const outcomes = await runner.reconcileCompany(companyId);
    return outcomes.every((o) => o.ok);
  }

  it("S1 — ĐỐI CHỨNG DƯƠNG: công ty mới ⇒ mẫu mặc định link đủ mọi thành phần hệ thống, gồm THUONG/PHAT/TAM_UNG", async () => {
    const c = await freshSeeded("s15b2s1");
    const codes = await linkedCodes(c);
    expect(codes).toEqual(expect.arrayContaining(["THUONG", "PHAT", "TAM_UNG", "TONG_KHAU_TRU", "KPCD"]));
    // Chạy lại lần hai: idempotent, không nhân bản.
    expect(await reconcileOk(c)).toBe(true);
    expect(await linkedCodes(c)).toEqual(codes);
  });

  it("S2 — 🔴 người dùng GỠ KPCD khỏi mẫu (như 053) ⇒ seeder chạy lại KHÔNG gắn lại", async () => {
    const c = await freshSeeded("s15b2s2");
    await direct.query(
      `DELETE FROM payroll_template_components
        WHERE company_id = $1 AND component_id = (SELECT id FROM salary_components WHERE company_id = $1 AND code = 'KPCD')`,
      [c],
    );
    expect(await reconcileOk(c)).toBe(true);
    expect(await linkedCodes(c)).not.toContain("KPCD");
  });

  it("S3 — 🔴 người dùng XOÁ MỀM mẫu mặc định (như 052) ⇒ seeder KHÔNG hồi sinh một MAU_MAC_DINH mới", async () => {
    const c = await freshSeeded("s15b2s3");
    await direct.query(`UPDATE payroll_templates SET deleted_at = now() WHERE company_id = $1 AND code = $2`, [
      c,
      PAYROLL_DEFAULT_TEMPLATE_CODE,
    ]);
    expect(await reconcileOk(c)).toBe(true);
    const { rows } = await direct.query<{ live: string; total: string }>(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) AS total
         FROM payroll_templates WHERE company_id = $1 AND code = $2`,
      [c, PAYROLL_DEFAULT_TEMPLATE_CODE],
    );
    expect(Number(rows[0].live)).toBe(0);
    expect(Number(rows[0].total)).toBe(1);
  });

  it("S4 — mã MỚI của seedVersion sau vẫn được CHÈN + LINK cho công ty cũ (mô phỏng công ty seed ở v1)", async () => {
    const c = await freshSeeded("s15b2s4");
    const v2 = "('THUONG','PHAT','TAM_UNG')";
    await direct.query(
      `DELETE FROM payroll_template_components
        WHERE company_id = $1 AND component_id IN (SELECT id FROM salary_components WHERE company_id = $1 AND code IN ${v2})`,
      [c],
    );
    await direct.query(`DELETE FROM salary_components WHERE company_id = $1 AND code IN ${v2}`, [c]);
    expect(await linkedCodes(c)).not.toContain("THUONG");

    expect(await reconcileOk(c)).toBe(true);
    expect(await linkedCodes(c)).toEqual(expect.arrayContaining(["THUONG", "PHAT", "TAM_UNG"]));
  });

  it("S5 — assert (6): thừa một hàng is_system NGOÀI hằng TS ⇒ outcome.ok === false", async () => {
    const c = await freshSeeded("s15b2s5");
    await direct.query(
      `INSERT INTO salary_components (company_id, code, name, kind, value_type, fixed_amount, is_system)
       VALUES ($1, 'ZZ_THUA', 'thừa', 'earning', 'fixed', 0, true)`,
      [c],
    );
    expect(await reconcileOk(c)).toBe(false);
  });

  it("S6 — assert (5): mẫu mặc định mất nút aggregate (TONG_KHAU_TRU) ⇒ outcome.ok === false (seeder không tự gắn lại)", async () => {
    const c = await freshSeeded("s15b2s6");
    await direct.query(
      `DELETE FROM payroll_template_components
        WHERE company_id = $1 AND component_id = (SELECT id FROM salary_components WHERE company_id = $1 AND code = 'TONG_KHAU_TRU')`,
      [c],
    );
    expect(await reconcileOk(c)).toBe(false);
    expect(await linkedCodes(c)).not.toContain("TONG_KHAU_TRU");
  });

  it("S7 — 🔴 người dùng XOÁ MỀM mẫu mặc định rồi TẠO LẠI cùng mã (050, created_by = người) ⇒ seeder KHÔNG gắn mã, assert (5) KHÔNG ném mỗi lần boot", async () => {
    const c = await freshSeeded("s15b2s7");
    await direct.query(`UPDATE payroll_templates SET deleted_at = now() WHERE company_id = $1 AND code = $2`, [
      c,
      PAYROLL_DEFAULT_TEMPLATE_CODE,
    ]);
    // `created_by` có FK tổng hợp (company_id, created_by) → users ⇒ phải là người THẬT của công ty.
    const human = await seedUser(direct, c, `s7-${randomUUID().slice(0, 8)}@s15b2seed.test`);
    // 050 luôn tạo mẫu RỖNG — đúng hình dạng làm assert (5) (thiếu nút aggregate) ném trước bản vá LOW-6.
    await direct.query(
      `INSERT INTO payroll_templates (company_id, code, name, scope, is_active, created_by)
       VALUES ($1, $2, 'mẫu người dùng tạo lại', 'company', true, $3)`,
      [c, PAYROLL_DEFAULT_TEMPLATE_CODE, human],
    );
    expect(await reconcileOk(c)).toBe(true);
    expect(await linkedCodes(c), "seeder không được gắn mã vào mẫu CỦA NGƯỜI DÙNG").toEqual([]);
  });

  it("S8 — 🔴 người dùng đổi `effectiveFrom` bản tỉ lệ seed (như 058) ⇒ seeder KHÔNG chèn lại bản gốc, chỉnh sửa GIỮ NGUYÊN (database-review HIGH-1)", async () => {
    const c = await freshSeeded("s15b2s8");
    await direct.query(`UPDATE payroll_statutory_rates SET effective_from = '2024-01-01' WHERE company_id = $1`, [c]);
    expect(await reconcileOk(c)).toBe(true);
    const { rows } = await direct.query<{ d: string }>(
      `SELECT to_char(effective_from, 'YYYY-MM-DD') AS d FROM payroll_statutory_rates WHERE company_id = $1`,
      [c],
    );
    expect(rows.map((r) => r.d), "seeder không được chèn bản gốc cạnh bản người dùng đã sửa").toEqual(["2024-01-01"]);
  });
});
