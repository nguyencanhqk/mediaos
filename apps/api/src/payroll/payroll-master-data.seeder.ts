import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  payrollStatutoryRates,
  payrollTemplateComponents,
  payrollTemplates,
  salaryComponents,
} from "../db/schema/payroll";
import type {
  MasterDataSeedContext,
  ModuleMasterDataSeeder,
} from "../foundation/seed/master-data-seeder.types";

/**
 * S15-PAYROLL-DB-1 — RUNTIME per-company master-data seeder cho PAYROLL v2
 * (DB-13 §13.4 bảng seed · §13.7 số PAY-DEC-014 · §15.3 bước B-2).
 *
 * ── VÌ SAO RUNTIME, KHÔNG PHẢI MIGRATION ────────────────────────────────────────────────────────
 * `salary_components` · `payroll_statutory_rates` · `payroll_templates` đều company-scoped
 * (`company_id NOT NULL`). Mig `0445:12` và `master-data-seeder.types.ts` ghi thẳng convention: CẤM
 * seed company-scoped ở migrate-time, vì DB sạch có **0 company** ⇒ migration seed 0 hàng ⇒ khối
 * VERIFY "đúng 4 hàng engine / 3 hàng pit_deductible" — chốt DUY NHẤT chặn lỗi «đoàn phí giảm thuế» —
 * trở thành **xanh RỖNG** (`empty-success-is-the-fail-open-shape`).
 * DB-13 §15.3 bước B đã được đính chính theo đó; mig `0571` chỉ seed dữ liệu TOÀN CỤC (quyền + CHECK
 * audit).
 *
 * ── GIÁ PHẢI TRẢ, PHẢI BIẾT ─────────────────────────────────────────────────────────────────────
 * 🔴 `MasterDataSeedRunner.runOne()` bọc **try/catch toàn phần**: seeder ném ⇒ `logger.error` +
 * `markBatchFailed` + `{ ok: false }` rồi **chạy tiếp**. Boot KHÔNG sập. Nghĩa là assert ở
 * `assertSeedIntegrity()` dưới đây là một **dòng log + batch Failed**, KHÔNG phải cổng cứng như
 * migration verify. Cộng thêm BỐN đường một công ty tồn tại mà không được seed:
 *   (a) boot ĐẦU TIÊN trên DB trắng — thứ tự hook giữa `MasterDataSeedBootstrapService` và
 *       `EnsureDefaultCompanyBootstrapService` không đảm bảo ⇒ runner có thể thấy 0 company;
 *   (b) `MASTER_DATA_SEED_ON_BOOT=false` (kill-switch vận hành);
 *   (c) `NODE_ENV=test` ⇒ bootstrap no-op;
 *   (d) company tạo SAU boot.
 * ⇒ **Cổng CỨNG cho "catalog không đủ" nằm ở đường TÍNH/ĐỌC**, không nằm ở đây: thiếu bản
 * `payroll_statutory_rates` hiệu lực ⇒ 422 `PAYROLL-ERR-022`; thiếu/không phân giải được 4 nút engine
 * ⇒ 422 `PAYROLL-ERR-018`. **CẤM trả `net = 0` / `net = gross`.** Nợ đã ghi vào `done_when` của
 * `S15-PAYROLL-BE-2` và `S15-PAYROLL-BE-3`.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────────────────────────
 * `INSERT … ON CONFLICT DO NOTHING` theo các partial unique `WHERE deleted_at IS NULL`
 * (`salary_components_company_code_uq` · `payroll_templates_company_code_uq` ·
 * `payroll_statutory_rates_company_effective_uq`) ⇒ chạy lại KHÔNG nhân bản.
 *
 * ⚠️ **LUẬT BUMP `seedVersion`**: `ON CONFLICT DO NOTHING` **KHÔNG cập nhật hàng đã có**. Đổi NỘI DUNG
 * một hàng seed (ví dụ lật `pitDeductible`, sửa tỉ lệ) mà không bump `seedVersion` ⇒ công ty cũ giữ
 * giá trị SAI vĩnh viễn và chỉ `assertSeedIntegrity()` phát hiện. Đổi nội dung ⇒ **bump `seedVersion`**
 * và viết bước vá dữ liệu tường minh.
 */

/** Mã mẫu bảng lương mặc định — business key idempotent. */
export const PAYROLL_DEFAULT_TEMPLATE_CODE = "MAU_MAC_DINH";

/** Ngày hiệu lực của bản tỉ lệ luật định seed — business key idempotent. */
export const PAYROLL_SEED_RATE_EFFECTIVE_FROM = "2024-07-01";

/**
 * BỐN nút tổng hợp (SPEC-11 §13.6 E). Giá trị do **engine** cộng, không do công thức người dùng ⇒
 * `value_type = 'engine'`, `formula = NULL`, `fixed_amount = NULL`, `is_system = true`.
 * CHECK `salary_components_engine_kind_check` ép HAI CHIỀU với `kind = 'aggregate'`.
 */
export const PAYROLL_ENGINE_COMPONENT_CODES = [
  "TONG_THU_NHAP",
  "TONG_BH_NV",
  "THU_NHAP_CHIU_THUE",
  "TONG_KHAU_TRU",
] as const;

/**
 * BA khoản BH bắt buộc phần NV — **được trừ khỏi thu nhập tính thuế** (`pit_deductible = true`).
 * ⚠️ `DOAN_PHI` CỐ Ý KHÔNG nằm ở đây: đoàn phí do NV chịu nhưng **không** được trừ thuế
 * (SPEC-11 §13.7 D). Đây là lý do `pit_deductible` là CỘT DỮ LIỆU chứ không phải mã hard-code trong
 * engine.
 */
export const PAYROLL_PIT_DEDUCTIBLE_CODES = ["BHXH_NV", "BHYT_NV", "BHTN_NV"] as const;

/**
 * Hai union dưới đây mirror `salary_components_kind_check` (7 giá trị) và
 * `salary_components_value_type_check` (4 giá trị). Mirror hai chiều với Zod sống ở
 * `packages/contracts/src/payroll.ts` (`salaryComponentKindEnum` · `salaryComponentValueTypeEnum`);
 * khai lại dạng union ở đây để bảng seed bên dưới bị TRÌNH BIÊN DỊCH ép — gõ sai một `kind` là lỗi
 * kiểu, không phải một hàng seed lệch âm thầm.
 */
type ComponentKind =
  | "earning"
  | "deduction"
  | "statutory_employee"
  | "statutory_employer"
  | "tax"
  | "tax_exempt"
  | "aggregate";
type ComponentValueType = "formula" | "fixed" | "profile_item" | "engine";

interface ComponentSeed {
  code: string;
  name: string;
  kind: ComponentKind;
  valueType: ComponentValueType;
  formula: string | null;
  pitDeductible: boolean;
  sortOrder: number;
  /** `false` ⇒ cột này ẩn trong mẫu mặc định (chi phí DN không phải cột của phiếu NV). */
  visibleInDefaultTemplate: boolean;
}

/**
 * Không gian tên REF — **ĐÓNG** (SPEC-11 §13.6 D). Ba họ, không có họ thứ tư:
 *   • `SYS_*`  — đầu vào ĐÓNG BĂNG của dòng lương (chỉ đọc);
 *   • `TL_*` · `GT_*` — hằng luật định hiệu lực tại ngày cuối kỳ (chỉ đọc);
 *   • *(còn lại)* — **mã thành phần** trong mẫu của kỳ.
 *
 * 🔴 **VÌ SAO PHẢI DÙNG ĐÚNG TIỀN TỐ — và vì sao tên trần là một LỖ THẬT.**
 * `salary_components_code_shape_check` cấm người dùng đặt mã mang tiền tố `SYS_`/`TL_`/`GT_`. Nếu công
 * thức seed viết `BASE_SALARY` (tên trần) thay vì `SYS_BASE_SALARY`, thì theo chính grammar đó
 * `BASE_SALARY` là **mã thành phần**, và CHECK **cho phép** một tenant tạo hàng `code = 'BASE_SALARY'`
 * ⇒ hàng đó **CHE đầu vào của engine cho cả công ty** (đặt `fixed_amount = 0` là mọi khoản BH = 0).
 * CHECK vẫn xanh, RLS vẫn xanh, mọi bất biến SQL vẫn xanh — đúng lớp lỗi shadowing mà §8.2 C1 dựng
 * CHECK đó để chặn. Dùng đúng tiền tố thì CHECK mới bảo vệ đúng thứ nó định bảo vệ.
 * Ca `s15-payroll-db1-seed.int-spec.ts` **E11** census MỌI REF của mọi công thức seed theo luật này.
 */
const SYS_REFS = [
  "SYS_BASE_SALARY",
  "SYS_INSURANCE_SALARY",
  "SYS_PROBATION_SALARY",
  "SYS_PAY_RATIO",
  "SYS_WORK_DAYS",
  "SYS_PRESENT_DAYS",
  "SYS_PAID_LEAVE_DAYS",
  "SYS_UNPAID_LEAVE_DAYS",
  "SYS_LATE_MINUTES",
  "SYS_PRORATE",
  "SYS_DEPENDENTS",
  "SYS_DAILY_RATE",
] as const;

const STATUTORY_REFS = [
  "TL_BHXH_NV",
  "TL_BHYT_NV",
  "TL_BHTN_NV",
  "TL_BHXH_DN",
  "TL_BHYT_DN",
  "TL_BHTN_DN",
  "TL_KPCD",
  "TL_DOAN_PHI",
  "GT_BAN_THAN",
  "GT_NPT",
] as const;

/** `FUNC` của grammar (SPEC-11 §13.6 A) — danh sách ĐÓNG. */
const FORMULA_FUNCS = [
  "IF",
  "MIN",
  "MAX",
  "ROUND",
  "ABS",
  "CEIL",
  "FLOOR",
  "TNCN_LUY_TIEN",
  "BH_TRAN_BHXH",
  "BH_TRAN_BHYT",
  "BH_TRAN_BHTN",
] as const;

/** Xuất cho spec census E11 — giữ MỘT nguồn, spec KHÔNG chép lại (chép lại là tautology). */
export const PAYROLL_FORMULA_VOCABULARY = {
  sysRefs: SYS_REFS,
  statutoryRefs: STATUTORY_REFS,
  funcs: FORMULA_FUNCS,
} as const;

/**
 * Catalog hệ thống — bảng seed DB-13 §13.4.
 *
 * Công thức viết theo **không gian tên đóng** ở trên và `FUNC` hợp lệ của §13.6 A. Parser/evaluator là
 * việc của `S15-PAYROLL-BE-2`; ở WO này chúng chỉ là DỮ LIỆU — chưa ai evaluate chúng. Nhưng chúng là
 * dữ liệu **seed lên PROD lúc boot**, và `ON CONFLICT DO NOTHING` KHÔNG cập nhật hàng đã có, nên sai ở
 * đây là sai VĨNH VIỄN cho tới khi có bước vá dữ liệu ⇒ viết đúng ngay, hoặc KHÔNG seed.
 *
 * ⚠️ **BA thành phần CỐ Ý KHÔNG SEED: `THUONG` · `PHAT` · `TAM_UNG`** (DB-13 §13.4 có liệt kê — đã
 * đính chính cùng commit). Lý do: giá trị của chúng là **đầu vào THEO DÒNG** (thưởng/phạt đã duyệt của
 * kỳ; tạm ứng `Approved` chưa khấu trừ), mà không gian tên `SYS_*` của §13.6 D — khai **ĐÓNG** —
 * **không có** biến nào biểu diễn được. Hai lối sai đều tệ: seed bằng REF trần (`BONUS_AMOUNT`…) là
 * TỰ TAY tạo lỗ shadowing mô tả ở trên; seed `fixed_amount = 0` là fail-open im lặng (khoản thưởng
 * biến mất mà `net ≥ 0` vẫn đúng). ⇒ **nợ bàn giao `S15-PAYROLL-BE-2`**: mở rộng `SYS_*` trong
 * SPEC-11 §13.6 D (vd `SYS_BONUS_AMOUNT` · `SYS_PENALTY_AMOUNT` · `SYS_ADVANCE_AMOUNT`) rồi seed ba
 * hàng này cùng lượt, có **bump `seedVersion`**.
 *
 * ⚠️ Điều kiện `joins_social_insurance`/`joins_union` **KHÔNG** nằm trong công thức: §13.7 B chốt
 * «không tham gia ⇒ thành phần bằng 0, VẪN ghi dòng» — đó là hành vi của ENGINE (BE-3), không phải
 * một vế `IF` trong công thức catalog.
 */
const SYSTEM_COMPONENTS: readonly ComponentSeed[] = [
  // ── Nền ──
  {
    code: "LUONG_CO_BAN",
    name: "Lương cơ bản",
    kind: "earning",
    valueType: "formula",
    formula: "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS",
    pitDeductible: false,
    sortOrder: 10,
    visibleInDefaultTemplate: true,
  },
  {
    code: "PHU_CAP",
    name: "Phụ cấp",
    kind: "earning",
    valueType: "profile_item",
    formula: null,
    pitDeductible: false,
    sortOrder: 20,
    visibleInDefaultTemplate: true,
  },
  {
    code: "NGHI_KHONG_LUONG",
    name: "Nghỉ không lương",
    kind: "deduction",
    valueType: "formula",
    formula: "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS",
    pitDeductible: false,
    sortOrder: 50,
    visibleInDefaultTemplate: true,
  },
  // ── Nút tổng hợp 1/4 ──
  {
    code: "TONG_THU_NHAP",
    name: "Tổng thu nhập",
    kind: "aggregate",
    valueType: "engine",
    formula: null,
    pitDeductible: false,
    sortOrder: 100,
    visibleInDefaultTemplate: true,
  },
  // ── BH phần NV — pit_deductible = true.
  //    Căn cứ đóng PHẢI KẸP TRẦN bằng `BH_TRAN_*` (SPEC-11 §13.7 B): trần lưu THÀNH TIỀN trong bản tỉ
  //    lệ; nhân thẳng không kẹp thì người lương cao bị trừ VƯỢT TRẦN và ba cột si_cap/hi_cap/ui_cap
  //    thành trang trí — sai thẳng vào số nộp bảo hiểm, không CHECK nào bắt.
  {
    code: "BHXH_NV",
    name: "BHXH (nhân viên)",
    kind: "statutory_employee",
    valueType: "formula",
    formula: "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_BHXH_NV / 100",
    pitDeductible: true,
    sortOrder: 110,
    visibleInDefaultTemplate: true,
  },
  {
    code: "BHYT_NV",
    name: "BHYT (nhân viên)",
    kind: "statutory_employee",
    valueType: "formula",
    formula: "BH_TRAN_BHYT(SYS_INSURANCE_SALARY) * TL_BHYT_NV / 100",
    pitDeductible: true,
    sortOrder: 120,
    visibleInDefaultTemplate: true,
  },
  {
    code: "BHTN_NV",
    name: "BHTN (nhân viên)",
    kind: "statutory_employee",
    valueType: "formula",
    formula: "BH_TRAN_BHTN(SYS_INSURANCE_SALARY) * TL_BHTN_NV / 100",
    pitDeductible: true,
    sortOrder: 130,
    visibleInDefaultTemplate: true,
  },
  // ── Đoàn phí — NV chịu, tính trên căn cứ BHXH (§13.7 D), nhưng KHÔNG được trừ thuế ──
  {
    code: "DOAN_PHI",
    name: "Đoàn phí công đoàn",
    kind: "statutory_employee",
    valueType: "formula",
    formula: "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_DOAN_PHI / 100",
    pitDeductible: false,
    sortOrder: 140,
    visibleInDefaultTemplate: true,
  },
  // ── Nút tổng hợp 2/4 · 3/4 ──
  {
    code: "TONG_BH_NV",
    name: "Tổng bảo hiểm nhân viên",
    kind: "aggregate",
    valueType: "engine",
    formula: null,
    pitDeductible: false,
    sortOrder: 150,
    visibleInDefaultTemplate: true,
  },
  {
    code: "THU_NHAP_CHIU_THUE",
    name: "Thu nhập tính thuế",
    kind: "aggregate",
    valueType: "engine",
    formula: null,
    pitDeductible: false,
    sortOrder: 160,
    visibleInDefaultTemplate: true,
  },
  {
    code: "TNCN",
    name: "Thuế TNCN",
    kind: "tax",
    valueType: "formula",
    // `TNCN_LUY_TIEN` là FUNC hợp lệ (§13.6 A); `THU_NHAP_CHIU_THUE` là MÃ THÀNH PHẦN (họ thứ ba của
    // không gian tên) — đây chính là lý do bốn nút tổng hợp phải là NODE THẬT của đồ thị.
    formula: "TNCN_LUY_TIEN(THU_NHAP_CHIU_THUE)",
    pitDeductible: false,
    sortOrder: 170,
    visibleInDefaultTemplate: true,
  },
  // ── Nút tổng hợp 4/4 ──
  {
    code: "TONG_KHAU_TRU",
    name: "Tổng khấu trừ",
    kind: "aggregate",
    valueType: "engine",
    formula: null,
    pitDeductible: false,
    sortOrder: 180,
    visibleInDefaultTemplate: true,
  },
  // ── BH phần DN + KPCĐ — CHI PHÍ DOANH NGHIỆP, ẩn khỏi mẫu mặc định ──
  // ⚠️ Bốn khoản này TUYỆT ĐỐI KHÔNG vào `TONG_KHAU_TRU` (SPEC-11 §13.7 C): cộng nhầm thì lương NV
  //    tụt ~21,5% TRONG KHI mọi bất biến SQL vẫn xanh. `kind='statutory_employer'` là dấu phân biệt.
  {
    code: "BHXH_DN",
    name: "BHXH (doanh nghiệp)",
    kind: "statutory_employer",
    valueType: "formula",
    formula: "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_BHXH_DN / 100",
    pitDeductible: false,
    sortOrder: 200,
    visibleInDefaultTemplate: false,
  },
  {
    code: "BHYT_DN",
    name: "BHYT (doanh nghiệp)",
    kind: "statutory_employer",
    valueType: "formula",
    formula: "BH_TRAN_BHYT(SYS_INSURANCE_SALARY) * TL_BHYT_DN / 100",
    pitDeductible: false,
    sortOrder: 210,
    visibleInDefaultTemplate: false,
  },
  {
    code: "BHTN_DN",
    name: "BHTN (doanh nghiệp)",
    kind: "statutory_employer",
    valueType: "formula",
    formula: "BH_TRAN_BHTN(SYS_INSURANCE_SALARY) * TL_BHTN_DN / 100",
    pitDeductible: false,
    sortOrder: 220,
    visibleInDefaultTemplate: false,
  },
  {
    code: "KPCD",
    name: "Kinh phí công đoàn",
    kind: "statutory_employer",
    valueType: "formula",
    formula: "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_KPCD / 100",
    pitDeductible: false,
    sortOrder: 230,
    visibleInDefaultTemplate: false,
  },
] as const;

/**
 * Số PAY-DEC-014 — **owner xác nhận 02/09/2026**.
 *
 * ⚠️ Trần lưu **THÀNH TIỀN**, KHÔNG lưu hệ số: `si_cap`/`hi_cap` = 20 × lương cơ sở (2.340.000),
 * `ui_cap` = 20 × lương tối thiểu vùng (4.960.000). `base_wage`/`min_region_wage` lưu kèm CHỈ để
 * GIẢI THÍCH con số đó đến từ đâu — service **KHÔNG** nhân lại (SPEC-11 §13.7 B).
 *
 * Hệ thống LƯU và ÁP, **không khẳng định đúng luật** (SPEC-11 §3.11): ca test ghim SỐ SEED này, không
 * ghim «đúng luật». Đổi luật ⇒ người dùng tạo bản `effective_from` mới qua màn Thiết lập, KHÔNG sửa
 * seeder.
 */
const STATUTORY_RATE_SEED = {
  effectiveFrom: PAYROLL_SEED_RATE_EFFECTIVE_FROM,
  siEmployeePct: "8.00",
  hiEmployeePct: "1.50",
  uiEmployeePct: "1.00",
  siEmployerPct: "17.50",
  hiEmployerPct: "3.00",
  uiEmployerPct: "1.00",
  unionEmployerPct: "2.00",
  unionEmployeePct: "1.00",
  siCap: "46800000.00", // 20 × 2.340.000
  hiCap: "46800000.00", // 20 × 2.340.000
  uiCap: "99200000.00", // 20 × 4.960.000
  baseWage: "2340000.00",
  minRegionWage: "4960000.00",
  personalDeduction: "11000000.00",
  dependentDeduction: "4400000.00",
  /** 7 bậc luỹ tiến; bậc cuối BẮT BUỘC `upTo = null` (CHECK chỉ ép mảng 7 phần tử — liên tục kiểm ở service). */
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: 10000000, rate: 10 },
    { upTo: 18000000, rate: 15 },
    { upTo: 32000000, rate: 20 },
    { upTo: 52000000, rate: 25 },
    { upTo: 80000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
  note: "owner xác nhận 02/09/2026 (PAY-DEC-014)",
} as const;

@Injectable()
export class PayrollMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "payroll.master-data";
  /** ⚠️ Đổi NỘI DUNG seed ⇒ BUMP giá trị này (xem docblock đầu file). */
  readonly seedVersion = "v1";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    await this.seedComponents(ctx);
    await this.seedStatutoryRate(ctx);
    await this.seedDefaultTemplate(ctx);
    await this.assertSeedIntegrity(ctx);
  }

  /** Catalog thành phần hệ thống (DB-13 §13.4). */
  private async seedComponents(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    for (const c of SYSTEM_COMPONENTS) {
      await tx
        .insert(salaryComponents)
        .values({
          companyId,
          code: c.code,
          name: c.name,
          kind: c.kind,
          valueType: c.valueType,
          formula: c.formula,
          // `engine` BẮT BUỘC fixedAmount NULL (salary_components_value_pair_check).
          fixedAmount: null,
          pitDeductible: c.pitDeductible,
          isSystem: true,
          isActive: true,
          sortOrder: c.sortOrder,
        })
        // ON CONFLICT phải khớp PARTIAL unique index (predicate deleted_at IS NULL) → `where` = arbiter.
        .onConflictDoNothing({
          target: [salaryComponents.companyId, salaryComponents.code],
          where: sql`deleted_at IS NULL`,
        });

      await ctx.track({
        targetTable: "salary_components",
        targetKey: c.code,
        operation: "Upsert",
        // Config-only payload (KHÔNG secret/PII) — ổn định giữa các lần ⇒ checksum không đổi ⇒ lần 2 Skipped.
        payload: {
          code: c.code,
          kind: c.kind,
          valueType: c.valueType,
          pitDeductible: c.pitDeductible,
          sortOrder: c.sortOrder,
        },
      });
    }
  }

  /** Một bản tỉ lệ luật định (DB-13 §13.7 · PAY-DEC-014). */
  private async seedStatutoryRate(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    await tx
      .insert(payrollStatutoryRates)
      .values({ companyId, ...STATUTORY_RATE_SEED, pitBrackets: STATUTORY_RATE_SEED.pitBrackets })
      .onConflictDoNothing({
        target: [payrollStatutoryRates.companyId, payrollStatutoryRates.effectiveFrom],
        where: sql`deleted_at IS NULL`,
      });

    await ctx.track({
      targetTable: "payroll_statutory_rates",
      targetKey: PAYROLL_SEED_RATE_EFFECTIVE_FROM,
      operation: "Upsert",
      // Ngưỡng thuế/tỉ lệ là hằng pháp luật CÔNG KHAI — không phải PII/secret, được phép vào track.
      payload: { ...STATUTORY_RATE_SEED, pitBrackets: STATUTORY_RATE_SEED.pitBrackets },
    });
  }

  /**
   * Mẫu bảng lương mặc định + **thành phần của nó**.
   *
   * 🔴 Mẫu 0 thành phần là mẫu KHÔNG TÁI TẠO GÌ: BE-2 «xem trước mẫu» và BE-3 «tính theo mẫu» chạy
   * trên nó sẽ ra **bảng 0 cột / 0 giá trị mà không lỗi** — lại đúng hình dạng
   * `empty-success-is-the-fail-open-shape`. Vì vậy seed MỘT hàng `payroll_template_components` cho
   * MỖI thành phần `is_system`, và `assertSeedIntegrity()` so SET-EQUALITY giữa hai tập seeded (không
   * magic number ⇒ thêm/bớt thành phần hệ thống không làm assert trôi).
   *
   * KHÔNG tự gắn mẫu vào kỳ nào (`payroll_periods.template_id` thuộc `S15-PAYROLL-DB-2`).
   */
  private async seedDefaultTemplate(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    await tx
      .insert(payrollTemplates)
      .values({
        companyId,
        code: PAYROLL_DEFAULT_TEMPLATE_CODE,
        name: "Mẫu bảng lương mặc định",
        scope: "company",
        orgUnitId: null,
        isActive: true,
      })
      .onConflictDoNothing({
        target: [payrollTemplates.companyId, payrollTemplates.code],
        where: sql`deleted_at IS NULL`,
      });

    const [tpl] = await tx
      .select({ id: payrollTemplates.id })
      .from(payrollTemplates)
      .where(
        and(
          eq(payrollTemplates.companyId, companyId),
          eq(payrollTemplates.code, PAYROLL_DEFAULT_TEMPLATE_CODE),
          isNull(payrollTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!tpl) {
      throw new Error(
        `[payroll.master-data] mẫu mặc định ${PAYROLL_DEFAULT_TEMPLATE_CODE} không đọc lại được sau INSERT ` +
          `(company=${companyId}) — DỪNG thay vì seed một mẫu RỖNG`,
      );
    }

    const componentRows = await tx
      .select({ id: salaryComponents.id, code: salaryComponents.code })
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.companyId, companyId),
          eq(salaryComponents.isSystem, true),
          isNull(salaryComponents.deletedAt),
        ),
      );
    const byCode = new Map(componentRows.map((r) => [r.code, r.id]));

    for (const c of SYSTEM_COMPONENTS) {
      const componentId = byCode.get(c.code);
      if (!componentId) {
        throw new Error(
          `[payroll.master-data] thành phần hệ thống ${c.code} không tồn tại sau seed (company=${companyId})`,
        );
      }
      await tx
        .insert(payrollTemplateComponents)
        .values({
          companyId,
          templateId: tpl.id,
          componentId,
          columnLabel: null, // NULL ⇒ dùng salary_components.name
          formulaOverride: null, // NULL ⇒ dùng công thức của catalog
          isVisible: c.visibleInDefaultTemplate,
          sortOrder: c.sortOrder,
        })
        // Unique THẲNG (bảng không có soft delete) ⇒ không cần `where` arbiter.
        .onConflictDoNothing({
          target: [
            payrollTemplateComponents.companyId,
            payrollTemplateComponents.templateId,
            payrollTemplateComponents.componentId,
          ],
        });
    }

    await ctx.track({
      targetTable: "payroll_templates",
      targetKey: PAYROLL_DEFAULT_TEMPLATE_CODE,
      operation: "Upsert",
      targetId: tpl.id,
      payload: {
        code: PAYROLL_DEFAULT_TEMPLATE_CODE,
        scope: "company",
        componentCount: SYSTEM_COMPONENTS.length,
      },
    });
  }

  /**
   * Kiểm tra tính toàn vẹn của seed — **theo TẬP MÃ, không theo phép ĐẾM**.
   *
   * ⚠️ Vì sao không đếm: app role có `INSERT/UPDATE` trên `salary_components`, và chỉ `value_type`
   * bị chặn ở route — `kind` và `pit_deductible` thì người dùng đặt được. Một công ty thêm khoản BH
   * tự nguyện `pit_deductible = true` (hoàn toàn hợp lệ về nghiệp vụ) sẽ làm `count(...) = 3` gãy ⇒
   * seeder `Failed` mỗi lượt boot ⇒ áp lực nới assert ⇒ **mất chốt «đoàn phí giảm thuế»**
   * (`invariant-count-must-filter-owned-rows`). Lọc `is_system` + so TẬP MÃ thì hàng của tenant không
   * ảnh hưởng, mà sai lệch trong hàng seed vẫn bị bắt.
   *
   * ⚠️ Ném ở đây KHÔNG chặn boot (runner nuốt) — nó đánh batch `Failed` + log. Cổng cứng nằm ở BE-2/BE-3.
   */
  private async assertSeedIntegrity(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    const systemRows = await tx
      .select({
        code: salaryComponents.code,
        kind: salaryComponents.kind,
        valueType: salaryComponents.valueType,
        pitDeductible: salaryComponents.pitDeductible,
      })
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.companyId, companyId),
          eq(salaryComponents.isSystem, true),
          isNull(salaryComponents.deletedAt),
        ),
      );

    // (1) Tập mã `value_type = 'engine'` ĐÚNG BẰNG 4 nút tổng hợp.
    assertSameCodeSet(
      systemRows.filter((r) => r.valueType === "engine").map((r) => r.code),
      PAYROLL_ENGINE_COMPONENT_CODES,
      "nút tổng hợp value_type='engine'",
      companyId,
    );

    // (2) Tập mã được trừ thuế ĐÚNG BẰNG 3 khoản BH bắt buộc — `DOAN_PHI` KHÔNG được có mặt.
    assertSameCodeSet(
      systemRows
        .filter((r) => r.kind === "statutory_employee" && r.pitDeductible)
        .map((r) => r.code),
      PAYROLL_PIT_DEDUCTIBLE_CODES,
      "khoản statutory_employee được trừ thuế (pit_deductible)",
      companyId,
    );

    // (3) Ca DƯƠNG tường minh: `DOAN_PHI` PHẢI tồn tại và PHẢI `pit_deductible = false`. Thiếu ca này
    //     thì "DOAN_PHI vắng mặt hoàn toàn" cũng làm (2) xanh.
    const doanPhi = systemRows.find((r) => r.code === "DOAN_PHI");
    if (!doanPhi) {
      throw new Error(
        `[payroll.master-data] thiếu thành phần DOAN_PHI (company=${companyId}) — (2) sẽ xanh RỖNG`,
      );
    }
    if (doanPhi.pitDeductible !== false) {
      throw new Error(
        `[payroll.master-data] DOAN_PHI.pit_deductible = true (company=${companyId}) — đoàn phí do NV ` +
          `chịu nhưng KHÔNG được trừ thuế (SPEC-11 §13.7 D)`,
      );
    }

    // (4) Có ít nhất một bản tỉ lệ luật định.
    const [rate] = await tx
      .select({ id: payrollStatutoryRates.id })
      .from(payrollStatutoryRates)
      .where(
        and(
          eq(payrollStatutoryRates.companyId, companyId),
          eq(payrollStatutoryRates.effectiveFrom, PAYROLL_SEED_RATE_EFFECTIVE_FROM),
          isNull(payrollStatutoryRates.deletedAt),
        ),
      )
      .limit(1);
    if (!rate) {
      throw new Error(
        `[payroll.master-data] thiếu bản payroll_statutory_rates ${PAYROLL_SEED_RATE_EFFECTIVE_FROM} ` +
          `(company=${companyId}) — máy tính lương sẽ không có tỉ lệ để áp`,
      );
    }

    // (5) Mẫu mặc định KHÔNG RỖNG — SET-EQUALITY giữa HAI TẬP SEEDED (không magic number).
    const [tpl] = await tx
      .select({ id: payrollTemplates.id })
      .from(payrollTemplates)
      .where(
        and(
          eq(payrollTemplates.companyId, companyId),
          eq(payrollTemplates.code, PAYROLL_DEFAULT_TEMPLATE_CODE),
          isNull(payrollTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!tpl) {
      throw new Error(
        `[payroll.master-data] thiếu mẫu mặc định ${PAYROLL_DEFAULT_TEMPLATE_CODE} (company=${companyId})`,
      );
    }
    const tplComponents = await tx
      .select({ code: salaryComponents.code })
      .from(payrollTemplateComponents)
      .innerJoin(
        salaryComponents,
        and(
          eq(salaryComponents.companyId, payrollTemplateComponents.companyId),
          eq(salaryComponents.id, payrollTemplateComponents.componentId),
        ),
      )
      .where(
        and(
          eq(payrollTemplateComponents.companyId, companyId),
          eq(payrollTemplateComponents.templateId, tpl.id),
          eq(salaryComponents.isSystem, true),
        ),
      );
    assertSameCodeSet(
      tplComponents.map((r) => r.code),
      systemRows.map((r) => r.code),
      "thành phần của mẫu mặc định so với catalog hệ thống",
      companyId,
    );
  }
}

/** So hai tập mã, báo THIẾU/THỪA đích danh (thông điệp đếm-số không chỉ ra được hàng nào sai). */
function assertSameCodeSet(
  actual: readonly string[],
  expected: readonly string[],
  what: string,
  companyId: string,
): void {
  const a = new Set(actual);
  const e = new Set(expected);
  const missing = [...e].filter((x) => !a.has(x)).sort();
  const extra = [...a].filter((x) => !e.has(x)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[payroll.master-data] ${what} LỆCH (company=${companyId}) — thiếu: [${missing.join(", ")}] · ` +
        `thừa: [${extra.join(", ")}]`,
    );
  }
}
