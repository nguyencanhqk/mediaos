import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import {
  PAYROLL_DEFAULT_TEMPLATE_CODE,
  PAYROLL_ENGINE_COMPONENT_CODES,
  PAYROLL_FORMULA_VOCABULARY,
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
      // ⚠️ HAI lý do ca này trông lạ, cả hai đều CÓ CHỦ ĐÍCH:
      //
      // 1. `.rejects` ở đây sẽ LUÔN xanh vì `MasterDataSeedRunner.runOne()` nuốt throw ⇒ assert đúng
      //    là cờ `ok` của outcome, không phải phép ném.
      //
      // 2. Fixture phải TẮT TẠM trigger `salary_component_system_freeze` để dựng được tiền đề. Trigger
      //    (mig 0570) đóng băng hàng `is_system` tới mức một câu UPDATE thẳng qua `direct` cũng bị
      //    chặn — tức bất biến DB **giết chính fixture đối kháng** (`db-invariant-kills-adversarial-
      //    fixtures`). Đây KHÔNG phải nới cổng: hai lớp kiểm hai thứ KHÁC nhau —
      //      · trigger (ca C5b–C5f ở `s15-payroll-db1-invariants`) chặn đường GHI làm hỏng hàng seed;
      //      · `assertSeedIntegrity()` (ca này) bắt hàng seed ĐÃ lệch, dù lệch bằng đường nào —
      //        seeder viết sai, migration vá dữ liệu sai, hay khôi phục từ bản sao lưu cũ.
      //    Bỏ ca này vì "trigger đã chặn rồi" là bỏ lớp thứ hai đúng lúc lớp thứ nhất bị vòng qua.
      //    `finally` bật lại trigger VÀ ca E4b assert nó đã bật lại (tắt mà quên bật = mọi ca sau mù).
      await direct.query(
        "ALTER TABLE salary_components DISABLE TRIGGER salary_component_system_freeze",
      );
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
        await direct.query(
          "ALTER TABLE salary_components ENABLE TRIGGER salary_component_system_freeze",
        );
      }
    });

    it("E4b trigger ĐÃ ĐƯỢC BẬT LẠI sau fixture của E4 (tắt mà quên bật = mọi ca sau MÙ)", async () => {
      const { rows } = await direct.query<{ tgenabled: string }>(
        `SELECT tgenabled FROM pg_trigger
          WHERE tgname = 'salary_component_system_freeze'
            AND tgrelid = 'salary_components'::regclass AND NOT tgisinternal`,
      );
      expect(rows, "trigger biến mất").toHaveLength(1);
      // 'O' = enabled (origin). 'D' = disabled.
      expect(rows[0].tgenabled, "trigger còn ĐANG TẮT sau E4").toBe("O");
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

    it("E11 CENSUS: mọi REF trong mọi công thức seed thuộc KHÔNG GIAN TÊN ĐÓNG (§13.6 D)", async () => {
      // 🔴 Đây là ca biến `salary_components_code_shape_check` thành chốt THẬT.
      //    CHECK cấm người dùng đặt mã mang tiền tố `SYS_`/`TL_`/`GT_`. Nếu công thức seed tham chiếu
      //    một tên TRẦN (`BASE_SALARY`, `INSURANCE_BASE`…) thì theo chính grammar §13.6 A tên đó là
      //    **mã thành phần** ⇒ CHECK **cho phép** một tenant tạo hàng cùng tên ⇒ hàng đó CHE đầu vào
      //    của engine cho cả công ty (đặt `fixed_amount = 0` là mọi khoản BH = 0), mà CHECK/RLS/mọi
      //    bất biến SQL vẫn xanh. Nói cách khác: CHECK vẫn chạy nhưng bảo vệ NHẦM không gian tên.
      //    Census đọc công thức ĐÃ SEED TRONG DB (không đọc hằng TS) nên nó cũng bắt được drift dữ liệu.
      const { rows } = await direct.query<{ code: string; formula: string | null }>(
        `SELECT code, formula FROM salary_components
        WHERE company_id = $1 AND is_system AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows.length, "catalog rỗng ⇒ census này xanh RỖNG").toBeGreaterThan(0);

      const seededCodes = new Set(rows.map((r) => r.code));
      const sysRefs = new Set<string>(PAYROLL_FORMULA_VOCABULARY.sysRefs);
      const statutoryRefs = new Set<string>(PAYROLL_FORMULA_VOCABULARY.statutoryRefs);
      const funcs = new Set<string>(PAYROLL_FORMULA_VOCABULARY.funcs);

      const offenders: string[] = [];
      for (const r of rows) {
        if (!r.formula) continue;
        // Mọi định danh theo đúng khuôn REF của grammar; `FUNC(` phân biệt bằng dấu mở ngoặc ngay sau.
        for (const m of r.formula.matchAll(/[A-Z][A-Z0-9_]{0,31}(\s*\()?/g)) {
          const token = m[0].replace(/\s*\($/, "");
          const isCall = Boolean(m[1]);
          if (isCall) {
            if (!funcs.has(token)) offenders.push(`${r.code}: FUNC lạ '${token}'`);
            continue;
          }
          if (sysRefs.has(token) || statutoryRefs.has(token) || seededCodes.has(token)) continue;
          offenders.push(
            `${r.code}: REF '${token}' KHÔNG thuộc SYS_*/TL_*/GT_* và KHÔNG phải mã đã seed ` +
              `⇒ tenant tạo được hàng cùng tên và CHE đầu vào engine`,
          );
        }
      }
      expect(offenders, offenders.join(" ; ")).toEqual([]);
    });

    it("E12 ĐỐI CHỨNG DƯƠNG cho E11: từ vựng đóng THỰC SỰ được dùng (census không xanh vì 0 REF)", async () => {
      // Nếu mọi công thức seed rỗng/NULL thì E11 duyệt 0 token và xanh. Ca này ghim rằng có REF thật.
      const { rows } = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM salary_components
        WHERE company_id = $1 AND is_system AND deleted_at IS NULL
          AND formula LIKE '%SYS\\_%'`,
        [A.companyId],
      );
      expect(
        Number(rows[0].n),
        "không công thức seed nào dùng biến SYS_* ⇒ E11 xanh rỗng",
      ).toBeGreaterThan(0);
    });

    it("E13 ba thành phần đầu vào-theo-dòng CỐ Ý CHƯA SEED — nợ của S15-PAYROLL-BE-2", async () => {
      // `THUONG` · `PHAT` · `TAM_UNG` có giá trị là ĐẦU VÀO THEO DÒNG, mà `SYS_*` (§13.6 D, khai ĐÓNG)
      // không có biến nào biểu diễn được. Seed bằng REF trần = tự tạo lỗ shadowing (xem E11); seed
      // `fixed_amount = 0` = fail-open im lặng (khoản thưởng biến mất, `net ≥ 0` vẫn đúng).
      // Ca này ghim CHỦ ĐÍCH: ai seed chúng mà không mở rộng SYS_* trước sẽ phải sửa ca này và giải thích.
      const { rows } = await direct.query<{ code: string }>(
        `SELECT code FROM salary_components
        WHERE company_id = $1 AND code IN ('THUONG','PHAT','TAM_UNG') AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows.map((r) => r.code)).toEqual([]);
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
