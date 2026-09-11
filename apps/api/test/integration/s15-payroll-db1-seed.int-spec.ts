import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import {
  PAYROLL_DEFAULT_TEMPLATE_CODE,
  PAYROLL_ENGINE_COMPONENT_CODES,
  PAYROLL_PIT_DEDUCTIBLE_CODES,
  PAYROLL_SEED_RATE_EFFECTIVE_FROM,
  PayrollMasterDataSeeder,
} from "../../src/payroll/payroll-master-data.seeder";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S15-PAYROLL-DB-1 — seed master-data RUNTIME của PAYROLL v2 (`PayrollMasterDataSeeder`).
 *
 * ── VÌ SAO SPEC NÀY LÀ CỔNG DUY NHẤT ────────────────────────────────────────────────────────────
 * Catalog thành phần lương + tỉ lệ luật định + mẫu mặc định là **company-scoped**, nên chúng KHÔNG
 * được seed trong migration (mig `0445` + `master-data-seeder.types.ts` cấm; DB sạch có 0 company ⇒
 * migration verify thành xanh RỖNG). Chúng sống ở seeder runtime ⇒ **khối VERIFY của migration không
 * phủ chúng**, và file này là chỗ duy nhất chứng minh chúng đúng.
 *
 * ── VÌ SAO CHẠY QUA `runner.reconcileCompany()`, KHÔNG GỌI THẲNG `seeder.seed()` ────────────────
 * 🔴 `MasterDataSeedRunner.runOne()` bọc **try/catch toàn phần**: seeder ném ⇒ `logger.error` +
 * `markBatchFailed` + `{ ok: false }`, **KHÔNG ném ra ngoài**. Vì vậy:
 *   • ca ÂM viết bằng `await expect(...).rejects` sẽ **KHÔNG BAO GIỜ ĐỎ** — nó là ca xanh-RỖNG kiểu
 *     mới, đúng thứ WO này đang đi vá ⇒ ca ÂM ở đây assert **`outcome.ok === false`**;
 *   • gọi thẳng `seeder.seed()` bỏ qua tenant tx + tracking của runner ⇒ false-green (xem
 *     `backlog.mjs:2259` — "KHÔNG gọi seeder.seed() trực tiếp"). Tiền lệ: `attendance-be1.int.spec.ts:142`.
 *
 * ── VÌ SAO ASSERT THEO TẬP MÃ, KHÔNG THEO PHÉP ĐẾM ─────────────────────────────────────────────
 * App role có `INSERT/UPDATE` trên `salary_components`, và chỉ `value_type` bị chặn ở route — `kind`
 * và `pit_deductible` thì người dùng đặt được. Một công ty thêm khoản BH tự nguyện
 * `pit_deductible = true` (hợp lệ nghiệp vụ) sẽ làm `count(...) = 3` gãy ⇒ áp lực nới assert ⇒ **mất
 * chốt «đoàn phí giảm thuế»** (`invariant-count-must-filter-owned-rows`). Lọc `is_system` + so TẬP MÃ.
 */
describe.skipIf(!hasDb)(
  "S15-PAYROLL-DB-1 · seed master-data runtime (PayrollMasterDataSeeder)",
  () => {
    const direct = directPool();
    let runner: MasterDataSeedRunner;
    let A: SeededTenant;
    let B: SeededTenant;

    beforeAll(async () => {
      A = await seedCompany(direct, "s15sda");
      B = await seedCompany(direct, "s15sdb");

      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new PayrollMasterDataSeeder());
      runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);

      await runner.reconcileCompany(A.companyId);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    async function systemCodes(companyId: string, where: string): Promise<string[]> {
      const { rows } = await direct.query<{ code: string }>(
        `SELECT code FROM salary_components
        WHERE company_id = $1 AND is_system AND deleted_at IS NULL AND ${where}
        ORDER BY code`,
        [companyId],
      );
      return rows.map((r) => r.code);
    }

    it("E1 tập mã value_type='engine' ĐÚNG BẰNG 4 nút tổng hợp (SET-EQUALITY, không đếm)", async () => {
      expect(await systemCodes(A.companyId, "value_type = 'engine'")).toEqual(
        [...PAYROLL_ENGINE_COMPONENT_CODES].sort(),
      );
    });

    it("E2 tập mã được trừ thuế ĐÚNG BẰNG 3 khoản BH bắt buộc — DOAN_PHI KHÔNG có mặt", async () => {
      expect(
        await systemCodes(A.companyId, "kind = 'statutory_employee' AND pit_deductible"),
      ).toEqual([...PAYROLL_PIT_DEDUCTIBLE_CODES].sort());
    });

    it("E3 ĐỐI CHỨNG DƯƠNG: DOAN_PHI TỒN TẠI và pit_deductible = false", async () => {
      // Thiếu ca này thì "DOAN_PHI vắng mặt hoàn toàn" cũng làm E2 xanh.
      const { rows } = await direct.query<{ pit_deductible: boolean; kind: string }>(
        `SELECT pit_deductible, kind FROM salary_components
        WHERE company_id = $1 AND code = 'DOAN_PHI' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows, "DOAN_PHI không được seed").toHaveLength(1);
      expect(rows[0].kind).toBe("statutory_employee");
      expect(
        rows[0].pit_deductible,
        "đoàn phí do NV chịu nhưng KHÔNG được trừ thuế (SPEC-11 §13.7 D)",
      ).toBe(false);
    });

    it("E4 ca ÂM: lật DOAN_PHI.pit_deductible=true ⇒ outcome.ok === FALSE (KHÔNG dùng .rejects)", async () => {
      // ⚠️ `.rejects` ở đây sẽ LUÔN xanh vì runner nuốt throw — assert đúng là cờ `ok` của outcome.
      await direct.query(
        `UPDATE salary_components SET pit_deductible = true
        WHERE company_id = $1 AND code = 'DOAN_PHI'`,
        [A.companyId],
      );
      try {
        const outcomes = await runner.reconcileCompany(A.companyId);
        const payroll = outcomes.find((o) => o.seedKey === "payroll.master-data");
        expect(payroll, "không tìm thấy outcome của payroll.master-data").toBeTruthy();
        expect(payroll?.ok, "seeder PHẢI báo thất bại khi đoàn phí bị đánh dấu giảm trừ thuế").toBe(
          false,
        );
        expect(payroll?.error ?? "").toContain("DOAN_PHI");
      } finally {
        await direct.query(
          `UPDATE salary_components SET pit_deductible = false
          WHERE company_id = $1 AND code = 'DOAN_PHI'`,
          [A.companyId],
        );
      }
    });

    it("E5 ĐỐI CHỨNG DƯƠNG cho E4: sau khi khôi phục, seeder chạy lại XANH (ok === true)", async () => {
      // Không có ca này thì E4 xanh kể cả khi seeder hỏng vĩnh viễn vì lý do khác.
      const outcomes = await runner.reconcileCompany(A.companyId);
      const payroll = outcomes.find((o) => o.seedKey === "payroll.master-data");
      expect(payroll?.ok, payroll?.error ?? "").toBe(true);
    });

    it("E6 idempotent: chạy reconcileCompany lần thứ hai KHÔNG nhân bản hàng seed", async () => {
      const before = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM salary_components WHERE company_id = $1 AND is_system`,
        [A.companyId],
      );
      await runner.reconcileCompany(A.companyId);
      const after = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM salary_components WHERE company_id = $1 AND is_system`,
        [A.companyId],
      );
      expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));
    });

    it("E7 ghim SỐ SEED PAY-DEC-014 (owner xác nhận 02/09/2026) — không ghim «đúng luật»", async () => {
      const { rows } = await direct.query<Record<string, string>>(
        `SELECT si_employee_pct, hi_employee_pct, ui_employee_pct,
              si_employer_pct, hi_employer_pct, ui_employer_pct,
              union_employer_pct, union_employee_pct,
              personal_deduction, dependent_deduction,
              si_cap, hi_cap, ui_cap, base_wage, min_region_wage,
              jsonb_array_length(pit_brackets) AS nbrackets,
              (pit_brackets -> 6 ->> 'upTo') AS last_upto,
              (pit_brackets -> 6 ->> 'rate') AS last_rate
         FROM payroll_statutory_rates
        WHERE company_id = $1 AND effective_from = $2 AND deleted_at IS NULL`,
        [A.companyId, PAYROLL_SEED_RATE_EFFECTIVE_FROM],
      );
      expect(rows, "không có bản tỉ lệ luật định nào được seed").toHaveLength(1);
      const r = rows[0];
      expect(Number(r.si_employee_pct)).toBe(8);
      expect(Number(r.hi_employee_pct)).toBe(1.5);
      expect(Number(r.ui_employee_pct)).toBe(1);
      expect(Number(r.si_employer_pct)).toBe(17.5);
      expect(Number(r.hi_employer_pct)).toBe(3);
      expect(Number(r.ui_employer_pct)).toBe(1);
      expect(Number(r.union_employer_pct)).toBe(2);
      expect(Number(r.union_employee_pct)).toBe(1);
      expect(Number(r.personal_deduction)).toBe(11_000_000);
      expect(Number(r.dependent_deduction)).toBe(4_400_000);
      // Trần lưu THÀNH TIỀN (20 × nền), KHÔNG lưu hệ số — service không được nhân lại.
      expect(Number(r.si_cap)).toBe(20 * Number(r.base_wage));
      expect(Number(r.hi_cap)).toBe(20 * Number(r.base_wage));
      expect(Number(r.ui_cap)).toBe(20 * Number(r.min_region_wage));
      // 7 bậc; bậc cuối BẮT BUỘC upTo = null (hở/chồng kiểm ở service — BE-2/BE-3).
      expect(Number(r.nbrackets)).toBe(7);
      expect(r.last_upto).toBeNull();
      expect(Number(r.last_rate)).toBe(35);
    });

    it("E8 mẫu mặc định KHÔNG RỖNG — SET-EQUALITY hai tập seeded (không magic number)", async () => {
      // Mẫu 0 thành phần = mẫu không tái tạo gì: BE-2 «xem trước» và BE-3 «tính theo mẫu» sẽ ra bảng
      // 0 cột mà KHÔNG lỗi (empty-success-is-the-fail-open-shape).
      const { rows: tplCodes } = await direct.query<{ code: string }>(
        `SELECT sc.code
         FROM payroll_template_components ptc
         JOIN payroll_templates t
           ON t.company_id = ptc.company_id AND t.id = ptc.template_id
         JOIN salary_components sc
           ON sc.company_id = ptc.company_id AND sc.id = ptc.component_id
        WHERE ptc.company_id = $1 AND t.code = $2 AND sc.is_system
        ORDER BY sc.code`,
        [A.companyId, PAYROLL_DEFAULT_TEMPLATE_CODE],
      );
      const catalog = await systemCodes(A.companyId, "true");
      expect(tplCodes.map((r) => r.code)).toEqual(catalog);
      expect(tplCodes.length, "mẫu mặc định RỖNG").toBeGreaterThan(0);
    });

    it("E9 chi phí DN (statutory_employer) bị ẨN khỏi mẫu mặc định — không phải cột của phiếu NV", async () => {
      const { rows } = await direct.query<{ code: string; is_visible: boolean }>(
        `SELECT sc.code, ptc.is_visible
         FROM payroll_template_components ptc
         JOIN payroll_templates t
           ON t.company_id = ptc.company_id AND t.id = ptc.template_id
         JOIN salary_components sc
           ON sc.company_id = ptc.company_id AND sc.id = ptc.component_id
        WHERE ptc.company_id = $1 AND t.code = $2 AND sc.kind = 'statutory_employer'`,
        [A.companyId, PAYROLL_DEFAULT_TEMPLATE_CODE],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((r) => r.is_visible).map((r) => r.code)).toEqual([]);
    });

    it("E10 công ty CHƯA chạy seeder có 0 hàng catalog — đúng 4 đường không-seed của §3.1.a", async () => {
      // Ca này KHÔNG phải lỗi: nó ghim rằng "đã seed" KHÔNG phải điều kiện đương nhiên, nên cổng cứng
      // cho «catalog không đủ» phải nằm ở đường TÍNH/ĐỌC (422 ERR-018/ERR-022 — nợ của BE-2/BE-3),
      // không nằm ở niềm tin vào boot.
      const { rows } = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM salary_components WHERE company_id = $1`,
        [B.companyId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  },
);
