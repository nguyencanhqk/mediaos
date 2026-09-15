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
import {
  ENGINE_NODE_CODES,
  FORMULA_FUNCS,
  STATUTORY_REFS,
  SYS_REFS,
} from "./formula/formula.vocabulary";
import { payrollCatalogLockTx } from "./payroll-catalog.lock";
import {
  assertPayrollSeedIntegrity,
  type PayrollSeedExpectations,
} from "./payroll-master-data.integrity";

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
 * `assertPayrollSeedIntegrity()` (payroll-master-data.integrity.ts) là một **dòng log + batch Failed**, KHÔNG phải cổng cứng như
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
 * giá trị SAI vĩnh viễn và chỉ `assertPayrollSeedIntegrity()` phát hiện. Đổi nội dung ⇒ **bump `seedVersion`**
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
export const PAYROLL_ENGINE_COMPONENT_CODES = ENGINE_NODE_CODES; // nguồn: formula/formula.vocabulary.ts

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

export interface ComponentSeed {
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
 * 🔁 **`THUONG` · `PHAT` · `TAM_UNG` — SEED TỪ `S15-PAYROLL-BE-2` (`seedVersion v2`).** DB-1 cố ý chưa seed vì
 * giá trị của chúng là ĐẦU VÀO THEO DÒNG mà `SYS_*` (§13.6 D, khai ĐÓNG) không biểu diễn được. BE-2 mở rộng
 * `SYS_*` (`SYS_BONUS_AMOUNT` · `SYS_PENALTY_AMOUNT` · `SYS_ADVANCE_AMOUNT` — nguồn `PAYROLL_SYS_REFS` ở
 * contracts) rồi seed ba hàng với công thức là CHÍNH biến đó. **CẤM REF trần** (`BONUS_AMOUNT`…): theo grammar
 * đó là MÃ THÀNH PHẦN ⇒ tenant tạo được hàng cùng tên và CHE đầu vào engine. Ca E11/E13 ghim luật này.
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
    // 🔁 v3 (S15-PAYROLL-DB-1B): tử số pro-rate = present + unpaid, kẹp trần bằng MIN(…, base) — SPEC-11 §13.4
    // «Nghỉ KHÔNG lương» (owner 2026-09-01). Bản v1/v2 chia theo present rồi NGHI_KHONG_LUONG trừ tiếp ⇒ trừ HAI LẦN.
    // Nhân tử số TRƯỚC, chia MỘT lần: khớp số học chính xác 100% trên 51.584 ca (plan §5.2.a). Hàng đã seed vá ở mig 0574.
    formula:
      "MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100",
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
  // ── S15-PAYROLL-BE-2 (seedVersion v2) — đầu vào THEO DÒNG, qua biến SYS_* (KHÔNG REF trần) ──
  {
    code: "THUONG",
    name: "Thưởng",
    kind: "earning",
    valueType: "formula",
    formula: "SYS_BONUS_AMOUNT",
    pitDeductible: false,
    sortOrder: 30,
    visibleInDefaultTemplate: true,
  },
  {
    code: "NGHI_KHONG_LUONG",
    name: "Nghỉ không lương",
    // 🔁 v4 (S15-PAYROLL-BE-3, owner O-5 15/09): `earning` công thức ÂM thay `deduction` dương. LUONG_CO_BAN cộng
    // SYS_UNPAID_LEAVE_DAYS vào tử số; để khoản trừ lại là `deduction` thì THU_NHAP_CHIU_THUE (không trừ deduction)
    // tính TNCN trên tiền NV không nhận (ca A1: 750.000 thay vì 550.000). ROUND_HALF_UP đối xứng quanh 0 ⇒
    // |v4| = v3 từng xu. Hàng đã seed vá ở mig 0575.
    kind: "earning",
    valueType: "formula",
    formula: "-(SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS)",
    pitDeductible: false,
    sortOrder: 50,
    visibleInDefaultTemplate: true,
  },
  {
    code: "PHAT",
    name: "Phạt",
    kind: "deduction",
    valueType: "formula",
    formula: "SYS_PENALTY_AMOUNT",
    pitDeductible: false,
    sortOrder: 60,
    visibleInDefaultTemplate: true,
  },
  {
    // Nguồn giá trị = tạm ứng `Approved` chưa khấu trừ (bảng `payroll_advances` của DB-2; BE-3/BE-4 bind).
    code: "TAM_UNG",
    name: "Tạm ứng",
    kind: "deduction",
    valueType: "formula",
    formula: "SYS_ADVANCE_AMOUNT",
    pitDeductible: false,
    sortOrder: 70,
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
 * Mã MỌI thành phần hệ thống — một nguồn cho luật «mã dành riêng» của route 045 (nợ DB-1 silent-failure (a)):
 * tenant KHÔNG được tạo hàng trùng mã hệ thống ngoài luật tiền tố `SYS_`/`TL_`/`GT_` — kể cả ở công ty CHƯA seed
 * (khi đó UNIQUE chưa có hàng để chặn, và seeder chạy sau sẽ ném fail-loud).
 */
export const PAYROLL_SYSTEM_COMPONENT_CODES: readonly string[] = SYSTEM_COMPONENTS.map((c) => c.code);

/** Hằng catalog hệ thống — xuất cho ca đối chứng engine ↔ số học chính xác (s15-payroll-db1b F2); spec KHÔNG chép lại. */
export const PAYROLL_SYSTEM_COMPONENTS: readonly ComponentSeed[] = SYSTEM_COMPONENTS;

/**
 * S15-PAYROLL-BE-3 (plan §0b B1) — BỐN thành phần hệ thống MANG ĐẦU VÀO đã bị gắn/đánh dấu ở máy tính lương. Mẫu gắn
 * vào kỳ PHẢI chứa đủ (sống, active, KHÔNG ghi đè công thức): thiếu `TAM_UNG` ⇒ tạm ứng `Deducted` mà không trừ; thiếu
 * `THUONG` ⇒ thưởng consume mà không trả; thiếu `NGHI_KHONG_LUONG` ⇒ nghỉ không lương vẫn được trả (LUONG_CO_BAN đã
 * cộng unpaid vào tử số). Một nguồn cho cổng gắn mẫu (002/004) lẫn cổng tính (007).
 */
export const PAYROLL_TEMPLATE_REQUIRED_INPUT_CODES = [
  "THUONG",
  "PHAT",
  "TAM_UNG",
  "NGHI_KHONG_LUONG",
] as const;

/** Giá trị chèn cho MỌI hàng hệ thống — một nguồn cho INSERT (seedComponents) lẫn assert (7). */
const SYSTEM_ROW_DEFAULTS = { fixedAmount: null, isActive: true } as const;

/**
 * Hằng đi vào assert toàn vẹn (payroll-master-data.integrity.ts) — hàm đó KHÔNG import seeder. Xuất cho cổng drift
 * CỨNG lúc tính (plan §4.8): assert (7) ở seeder chỉ là log vì runner nuốt throw.
 */
export const PAYROLL_SEED_EXPECTATIONS: PayrollSeedExpectations = {
  components: SYSTEM_COMPONENTS,
  rowDefaults: SYSTEM_ROW_DEFAULTS,
  engineCodes: PAYROLL_ENGINE_COMPONENT_CODES,
  pitDeductibleCodes: PAYROLL_PIT_DEDUCTIBLE_CODES,
  defaultTemplateCode: PAYROLL_DEFAULT_TEMPLATE_CODE,
};

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

/** Xuất cho unit spec máy tính dòng lương (`formula.line.spec.ts`) — spec KHÔNG chép lại số seed. */
export const PAYROLL_STATUTORY_RATE_SEED = STATUTORY_RATE_SEED;

@Injectable()
export class PayrollMasterDataSeeder implements ModuleMasterDataSeeder {
  readonly seedKey = "payroll.master-data";
  /** ⚠️ Đổi NỘI DUNG seed ⇒ BUMP giá trị này (xem docblock đầu file). */
  // v2 (S15-PAYROLL-BE-2): + THUONG · PHAT · TAM_UNG. Runner gọi seed() MỖI lần boot bất kể version — bump là
  // để batch/track ghi đúng lượt đổi nội dung, KHÔNG phải cơ chế khiến công ty cũ nhận hàng mới.
  // v3 (S15-PAYROLL-DB-1B): LUONG_CO_BAN tử số present + unpaid, kẹp trần — hàng đã seed vá bằng mig 0574.
  // v4 (S15-PAYROLL-BE-3): NGHI_KHONG_LUONG thành `earning` công thức ÂM — hàng đã seed vá bằng mig 0575.
  readonly seedVersion = "v4";

  async seed(ctx: MasterDataSeedContext): Promise<void> {
    // CÙNG khoá với route ghi catalog/mẫu (045 · 047 · 050 · 052 · 053) — seeder chạy mỗi lần boot và không
    // được đua với `PUT /payroll/templates/:id/components` (DELETE rồi INSERT) — xem payroll-catalog.lock.ts.
    await payrollCatalogLockTx(ctx.tx, ctx.companyId);
    const insertedCodes = await this.seedComponents(ctx);
    await this.seedStatutoryRate(ctx);
    await this.seedDefaultTemplate(ctx, insertedCodes);
    await assertPayrollSeedIntegrity(ctx.tx, ctx.companyId, PAYROLL_SEED_EXPECTATIONS);
  }

  /** Catalog thành phần hệ thống (DB-13 §13.4). */
  private async seedComponents(ctx: MasterDataSeedContext): Promise<ReadonlySet<string>> {
    const { companyId, tx } = ctx;
    const inserted = new Set<string>();

    for (const c of SYSTEM_COMPONENTS) {
      const rows = await tx
        .insert(salaryComponents)
        .values({
          companyId,
          code: c.code,
          name: c.name,
          kind: c.kind,
          valueType: c.valueType,
          formula: c.formula,
          // `engine` BẮT BUỘC fixedAmount NULL (salary_components_value_pair_check).
          fixedAmount: SYSTEM_ROW_DEFAULTS.fixedAmount,
          pitDeductible: c.pitDeductible,
          isSystem: true,
          isActive: SYSTEM_ROW_DEFAULTS.isActive,
          sortOrder: c.sortOrder,
        })
        // ON CONFLICT phải khớp PARTIAL unique index (predicate deleted_at IS NULL) → `where` = arbiter.
        .onConflictDoNothing({
          target: [salaryComponents.companyId, salaryComponents.code],
          where: sql`deleted_at IS NULL`,
        })
        // RETURNING chỉ có hàng khi CHÍNH lượt này chèn ⇒ nguồn DUY NHẤT của «mã mới» cho seedDefaultTemplate.
        .returning({ code: salaryComponents.code });
      if (rows.length > 0) inserted.add(c.code);

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
    return inserted;
  }

  /**
   * Một bản tỉ lệ luật định (DB-13 §13.7 · PAY-DEC-014) — CHỈ cho công ty CHƯA có bản nào (kể cả đã xoá mềm).
   *
   * 🔴 database-review BE-2 **HIGH-1**: từ BE-2 người dùng sửa được bản tỉ lệ qua 058, kể cả `effectiveFrom`.
   * Arbiter `(company_id, effective_from) WHERE deleted_at IS NULL` chỉ nhìn NGÀY ⇒ đổi ngày bản seed là seeder
   * chèn lại bản gốc ở lần boot sau; máy tính chọn bản `effective_from ≤ cuối kỳ` MỚI NHẤT nên số seed đè chỉnh
   * sửa của người dùng cho mọi kỳ về sau — 0 audit. Cùng lớp lỗi B2 (mẫu mặc định).
   * Bản tỉ lệ MỚI của một seedVersion sau (luật đổi) KHÔNG đi đường này — phải là ghi có chủ đích.
   */
  private async seedStatutoryRate(ctx: MasterDataSeedContext): Promise<void> {
    const { companyId, tx } = ctx;

    const [anyRate] = await tx
      .select({ id: payrollStatutoryRates.id })
      .from(payrollStatutoryRates)
      .where(eq(payrollStatutoryRates.companyId, companyId))
      .limit(1);
    if (anyRate) {
      await ctx.track({
        targetTable: "payroll_statutory_rates",
        targetKey: PAYROLL_SEED_RATE_EFFECTIVE_FROM,
        operation: "Skip",
        payload: { effectiveFrom: PAYROLL_SEED_RATE_EFFECTIVE_FROM, reason: "company-already-has-rates" },
      });
      return;
    }

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
   * 🔴 Mẫu 0 thành phần là mẫu KHÔNG TÁI TẠO GÌ (`empty-success-is-the-fail-open-shape`) ⇒ lúc TẠO mẫu, link MỌI
   * thành phần `is_system`.
   *
   * 🔴 **Seeder chạy MỖI LẦN BOOT** (`MasterDataSeedBootstrapService` → `reconcileAllCompanies`) — từ BE-2 người
   * dùng SỬA được mẫu (052/053), nên seeder KHÔNG được hoàn tác chỉnh sửa hợp lệ (plan-review BE-2 **B2**):
   *  (a) đã có BẤT KỲ hàng `MAU_MAC_DINH` nào — KỂ CẢ ĐÃ XOÁ MỀM — ⇒ KHÔNG tạo lại (arbiter partial
   *      `WHERE deleted_at IS NULL` sẽ âm thầm chèn một mẫu mới nếu chỉ dựa vào ON CONFLICT);
   *  (b) mẫu còn sống mà KHÔNG do lượt này tạo ⇒ CHỈ link các mã VỪA ĐƯỢC CHÈN trong chính lượt này (mã mới của
   *      `seedVersion` sau). Thành phần người dùng đã gỡ khỏi mẫu không bao giờ «vừa được chèn» lần nữa ⇒ không
   *      bị gắn lại; mọi thay đổi do con người đi qua 053 và có audit.
   *
   * KHÔNG tự gắn mẫu vào kỳ nào (`payroll_periods.template_id` thuộc `S15-PAYROLL-DB-2`).
   */
  private async seedDefaultTemplate(
    ctx: MasterDataSeedContext,
    insertedCodes: ReadonlySet<string>,
  ): Promise<void> {
    const { companyId, tx } = ctx;

    const existing = await tx
      .select({
        id: payrollTemplates.id,
        deletedAt: payrollTemplates.deletedAt,
        createdBy: payrollTemplates.createdBy,
      })
      .from(payrollTemplates)
      .where(
        and(
          eq(payrollTemplates.companyId, companyId),
          eq(payrollTemplates.code, PAYROLL_DEFAULT_TEMPLATE_CODE),
        ),
      );

    // CHỈ hàng DO SEEDER tạo (`created_by` NULL): mẫu cùng mã người dùng tạo lại qua 050 sau khi xoá mềm mẫu
    // mặc định là mẫu CỦA NGƯỜI DÙNG — không gắn mã, không assert (security-review BE-2 LOW-6).
    let templateId: string | null =
      existing.find((r) => r.deletedAt === null && r.createdBy === null)?.id ?? null;
    let created = false;

    if (existing.length === 0) {
      const [row] = await tx
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
        })
        .returning({ id: payrollTemplates.id });
      if (!row) {
        throw new Error(
          `[payroll.master-data] mẫu mặc định ${PAYROLL_DEFAULT_TEMPLATE_CODE} không chèn được dù chưa có hàng nào ` +
            `(company=${companyId}) — DỪNG thay vì seed một mẫu RỖNG`,
        );
      }
      templateId = row.id;
      created = true;
    }

    // Mẫu do seeder tạo đã bị XOÁ MỀM, hoặc hàng sống cùng mã là mẫu CỦA NGƯỜI DÙNG ⇒ không hồi sinh, không gắn.
    if (templateId === null) {
      await ctx.track({
        targetTable: "payroll_templates",
        targetKey: PAYROLL_DEFAULT_TEMPLATE_CODE,
        operation: "Skip",
        payload: {
          code: PAYROLL_DEFAULT_TEMPLATE_CODE,
          // Hai trạng thái KHÁC nhau — nhãn chẩn đoán phải nói đúng cái nào (silent-failure-hunter BE-2 LOW-2).
          reason: existing.some((r) => r.deletedAt === null)
            ? "user-owned-live-template"
            : "soft-deleted-by-user",
        },
      });
      return;
    }

    const toLink = SYSTEM_COMPONENTS.filter((c) => created || insertedCodes.has(c.code));
    if (toLink.length > 0) {
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

      for (const c of toLink) {
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
            templateId,
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
    }

    await ctx.track({
      targetTable: "payroll_templates",
      targetKey: PAYROLL_DEFAULT_TEMPLATE_CODE,
      operation: "Upsert",
      targetId: templateId,
      payload: {
        code: PAYROLL_DEFAULT_TEMPLATE_CODE,
        scope: "company",
        created,
        linkedCodes: toLink.map((c) => c.code),
      },
    });
  }
}
