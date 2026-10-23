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
import { withReplicaSession } from "../helpers/replica-session";
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

    // `tgenabled` của trigger đóng băng trong `pg_trigger` = trạng thái TOÀN CỤC (mọi phiên thấy như
    // nhau; phiên `replica` KHÔNG đổi nó). 'O' = bật (origin) · 'D' = tắt.
    const FREEZE_TRIGGER_STATE_SQL = `SELECT tgenabled FROM pg_trigger
          WHERE tgname = 'salary_component_system_freeze'
            AND tgrelid = 'salary_components'::regclass AND NOT tgisinternal`;

    /** Trạng thái TOÀN CỤC của trigger đóng băng lúc gọi. Mảng rỗng = trigger biến mất. */
    async function freezeTriggerState(): Promise<string[]> {
      const { rows } = await direct.query<{ tgenabled: string }>(FREEZE_TRIGGER_STATE_SQL);
      return rows.map((r) => r.tgenabled);
    }

    /**
     * Đặt `DOAN_PHI.pit_deductible` của công ty A VƯỢT trigger đóng băng — CHỈ để gieo / dọn tiền đề
     * của E4 (lý do ở chú thích của E4). Chạy trong phiên `replica`: trigger không bắn cho ĐÚNG phiên
     * này, câu UPDATE commit ngay nên `runner` (connection riêng) đọc thấy.
     *
     * `freezeStateAtWrite` = trạng thái TOÀN CỤC của trigger do CHÍNH câu UPDATE đọc (`RETURNING`), tức
     * tại đúng thời điểm ghi. Đó là chỗ duy nhất thấy được một cặp `DISABLE TRIGGER` / `ENABLE TRIGGER`
     * bọc SÁT câu UPDATE: đọc trước hay sau lời gọi này đều ra 'O'.
     */
    async function forceDoanPhiPitDeductible(
      value: boolean,
    ): Promise<{ rowCount: number; freezeStateAtWrite: (string | null)[] }> {
      const res = await withReplicaSession(direct, (client) =>
        client.query<{ freeze_state: string | null }>(
          `UPDATE salary_components SET pit_deductible = $2
            WHERE company_id = $1 AND code = 'DOAN_PHI'
        RETURNING (${FREEZE_TRIGGER_STATE_SQL}) AS freeze_state`,
          [A.companyId, value],
        ),
      );
      return {
        rowCount: res.rowCount ?? 0,
        freezeStateAtWrite: res.rows.map((r) => r.freeze_state),
      };
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
      // ⚠️ BA lý do ca này trông lạ, cả ba đều CÓ CHỦ ĐÍCH:
      //
      // 1. `.rejects` ở đây sẽ LUÔN xanh vì `MasterDataSeedRunner.runOne()` nuốt throw ⇒ assert đúng
      //    là cờ `ok` của outcome, không phải phép ném.
      //
      // 2. Fixture phải VƯỢT trigger `salary_component_system_freeze` để dựng được tiền đề. Trigger
      //    (mig 0570) đóng băng hàng `is_system` tới mức một câu UPDATE thẳng qua `direct` cũng bị
      //    chặn — tức bất biến DB **giết chính fixture đối kháng** (`db-invariant-kills-adversarial-
      //    fixtures`). Đây KHÔNG phải nới cổng: hai lớp kiểm hai thứ KHÁC nhau —
      //      · trigger (ca C5b–C5f ở `s15-payroll-db1-invariants`) chặn đường GHI làm hỏng hàng seed;
      //      · `assertPayrollSeedIntegrity()` (ca này) bắt hàng seed ĐÃ lệch, dù lệch bằng đường nào —
      //        seeder viết sai, migration vá dữ liệu sai, hay khôi phục từ bản sao lưu cũ.
      //    Bỏ ca này vì "trigger đã chặn rồi" là bỏ lớp thứ hai đúng lúc lớp thứ nhất bị vòng qua.
      //
      // 3. VƯỢT bằng phiên `replica` (`withReplicaSession`), KHÔNG bằng `ALTER TABLE … DISABLE TRIGGER`
      //    (`S18-QA-CHECKALLFLAKE-1`). DDL đó chạy trên pool là autocommit ⇒ trigger TẮT cho MỌI phiên
      //    của DB tới khi bật lại, và `s15-payroll-be3-migration` chạy song song đọc `pg_trigger` trúng
      //    cửa sổ đó thì đỏ oan (`tgenabled 'D'` · `[0575] DUNG: trigger …`). Bọc DISABLE / UPDATE /
      //    ENABLE vào MỘT transaction cũng không dùng được ở đây: `runner` đọc bằng connection RIÊNG nên
      //    không thấy UPDATE chưa commit, và khoá bảng của `ALTER TABLE` giữ tới hết transaction nên
      //    runner tự chặn chính nó. Phiên `replica` chỉ làm trigger không bắn cho ĐÚNG phiên gieo:
      //    không DDL, `tgenabled` toàn cục vẫn `O` — chốt ở BA thời điểm: lúc ghi tiền đề + ngay sau
      //    lượt runner (hai assert bên dưới) + sau khi ca này xong (E4b).
      try {
        const seeded = await forceDoanPhiPitDeductible(true);
        expect(
          seeded.rowCount,
          "tiền đề của E4 KHÔNG được gieo: phải sửa đúng 1 hàng DOAN_PHI",
        ).toBe(1);
        const outcomes = await runner.reconcileCompany(A.companyId);
        // Hai chốt TRONG CỬA SỔ cho «fixture không tắt trigger TOÀN CỤC» — E4b chỉ đọc SAU ca này nên
        // mù với kiểu «tắt rồi bật lại đúng», tức đúng dạng lỗi mà `S18-QA-CHECKALLFLAKE-1` gỡ:
        //   · sau lượt runner — bắt `DISABLE` trước khi gieo + `ENABLE` ở `finally` (hình dạng cũ của ca này);
        //   · lúc ghi tiền đề — bắt cặp `DISABLE` / `ENABLE` bọc SÁT câu UPDATE (đã bật lại trước khi runner
        //     chạy nên chốt thứ nhất đọc ra 'O').
        // Cả hai KHÔNG tự thành flake: hai chỗ khác trong bộ test tắt trigger NÀY (`withSystemKind` của
        // `s15-payroll-be3-binding-gates` · replay mig 0575 ở `s15-payroll-be3-migration`) đều tắt TRONG một
        // transaction (bật lại trước COMMIT, hoặc ROLLBACK) nên không phiên nào khác đọc được 'D' của chúng.
        expect(
          await freezeTriggerState(),
          "fixture E4 đang TẮT trigger TOÀN CỤC giữa lúc runner chạy",
        ).toEqual(["O"]);
        expect(
          seeded.freezeStateAtWrite,
          "fixture E4 TẮT trigger TOÀN CỤC quanh câu UPDATE gieo tiền đề",
        ).toEqual(["O"]);
        const payroll = outcomes.find((o) => o.seedKey === "payroll.master-data");
        expect(payroll, "không tìm thấy outcome của payroll.master-data").toBeTruthy();
        expect(payroll?.ok, "seeder PHẢI báo thất bại khi đoàn phí bị đánh dấu giảm trừ thuế").toBe(
          false,
        );
        expect(payroll?.error ?? "").toContain("DOAN_PHI");
      } finally {
        // Dọn đi CÙNG đường gieo. Gieo nằm TRONG `try` nên bước này chạy cả khi gieo hỏng giữa chừng
        // (đặt lại `false` là giá trị seed ⇒ chạy thừa cũng vô hại); E5 chốt rằng dọn đã có hiệu lực.
        await forceDoanPhiPitDeductible(false);
      }
    });

    it("E4b fixture của E4 KHÔNG đụng trạng thái trigger TOÀN CỤC — `tgenabled` vẫn 'O' (tắt = mọi ca sau MÙ)", async () => {
      // E4 vượt trigger bằng phiên `replica`, không bằng DDL ⇒ `pg_trigger.tgenabled` không đổi. Ca này
      // chốt TRẠNG THÁI SAU E4: ai đưa `DISABLE TRIGGER` trở lại fixture mà quên / hỏng bước bật lại sẽ
      // ĐỎ ở đây, thay vì để các ca phía sau chạy trên một bảng không còn được đóng băng.
      // ⚠️ Ca này KHÔNG thấy được kiểu «tắt rồi bật lại đúng» — kiểu đó do hai chốt TRONG CỬA SỔ của E4
      // bắt (đọc lúc ghi tiền đề + ngay sau lượt runner).
      const states = await freezeTriggerState();
      expect(states, "trigger biến mất").toHaveLength(1);
      expect(states[0], "trigger còn ĐANG TẮT sau E4").toBe("O");
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

    it("E13 ba thành phần đầu vào-theo-dòng SEED TỪ BE-2 — công thức là CHÍNH biến SYS_* (KHÔNG REF trần)", async () => {
      // 🔁 S15-PAYROLL-BE-2 lật ca này (nợ DB-1): SPEC-11 §13.6 D mở rộng SYS_* bằng `SYS_BONUS_AMOUNT` ·
      // `SYS_PENALTY_AMOUNT` · `SYS_ADVANCE_AMOUNT` rồi mới seed. Ghim ĐÚNG công thức: một REF trần
      // (`BONUS_AMOUNT`) là mã thành phần theo grammar ⇒ tenant tạo được hàng cùng tên và CHE đầu vào engine;
      // `fixed_amount = 0` là fail-open im lặng (khoản thưởng biến mất mà `net ≥ 0` vẫn đúng).
      const { rows } = await direct.query<{
        code: string;
        kind: string;
        value_type: string;
        formula: string | null;
      }>(
        `SELECT code, kind, value_type, formula FROM salary_components
        WHERE company_id = $1 AND code IN ('THUONG','PHAT','TAM_UNG') AND is_system AND deleted_at IS NULL
        ORDER BY code`,
        [A.companyId],
      );
      expect(rows).toEqual([
        { code: "PHAT", kind: "deduction", value_type: "formula", formula: "SYS_PENALTY_AMOUNT" },
        {
          code: "TAM_UNG",
          kind: "deduction",
          value_type: "formula",
          formula: "SYS_ADVANCE_AMOUNT",
        },
        { code: "THUONG", kind: "earning", value_type: "formula", formula: "SYS_BONUS_AMOUNT" },
      ]);
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
