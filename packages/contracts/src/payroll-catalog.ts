import { z } from "zod";
import {
  payrollPageQuery,
  payrollTemplateScopeEnum,
  pitPayerEnum,
  salaryComponentKindEnum,
  salaryComponentValueTypeEnum,
} from "./payroll";

/**
 * MediaOS — PAYROLL **track B v2** contracts (SPEC-11 §15.1 `044..058` · API-18 §5b, wave S15-PAYROLL-V2):
 * catalog thành phần lương · mẫu bảng lương · tỉ lệ luật định.
 *
 * Tách khỏi `./payroll` vì file đó đã VƯỢT trần 800 dòng; import NGƯỢC enum + `payrollPageQuery` từ đó và
 * KHÔNG re-export tên nào của nó (trùng tên ở hai star-export là lỗi mơ hồ lúc build).
 *
 * Hai luật của `payroll.ts` áp nguyên (mirror CHECK HAI CHIỀU · mask = VẮNG KHOÁ), cộng **BA luật của máy công
 * thức** — mỗi luật bịt một mã lỗi CHẾT (`equal-caps-at-zod-and-service-make-dead-error-code`):
 *
 * 1. 🔴 **KHÔNG cap độ dài `formula`/`formulaOverride`.** Parser ép 500 ký tự ⇒ 422 PAYROLL-ERR-018
 *    `formula-too-long` kèm vị trí. `.max(500)` ở đây làm chuỗi 501 ký tự chết ở pipe với 400.
 * 2. **KHÔNG ép 7 bậc TNCN / tính liên tục ở đây** — service ép ⇒ 422 PAYROLL-ERR-022 với `reason` từng hình
 *    dạng. Zod chỉ ép HÌNH DẠNG phần tử + trần kích thước payload.
 * 3. **KHÔNG cấm tiền tố `SYS_`/`TL_`/`GT_` hay mã hệ thống ở `code`** — service trả 409 PAYROLL-ERR-024
 *    `component-code-reserved`. Regex dưới chỉ mirror phần HÌNH DẠNG của `salary_components_code_shape_check`.
 *
 * Route GHI trả `{ id }` — **0 khoá tiền** (SPEC-11 §11.3 ghi chú 8: invariant `manage ⇒ view` KHÔNG phủ
 * `payroll-template`/`statutory-rate`).
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 0. Hằng + helper
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `SYS_*` — đầu vào ĐÓNG BĂNG của dòng lương (SPEC-11 §13.6 D). **NGUỒN DUY NHẤT**: máy công thức ở
 * `apps/api/src/payroll/formula/formula.vocabulary.ts` đọc từ đây. Ba biến cuối thêm ở `S15-PAYROLL-BE-2`.
 */
export const PAYROLL_SYS_REFS = [
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
  "SYS_BONUS_AMOUNT",
  "SYS_PENALTY_AMOUNT",
  "SYS_ADVANCE_AMOUNT",
] as const;
export const payrollSysRefEnum = z.enum(PAYROLL_SYS_REFS);
export type PayrollSysRef = z.infer<typeof payrollSysRefEnum>;

/** Trần thực dụng cho tiền NHẬP (1.000 tỉ) — trong miền `numeric(18,2)` và trong độ chính xác số thực JSON. */
export const PAYROLL_CATALOG_MONEY_MAX = 999_999_999_999.99;
/** Trần PAYLOAD của 053 — trần NGHIỆP VỤ 120 thành phần do service ép (⇒ 422 018). */
export const PAYROLL_TEMPLATE_COMPONENTS_PAYLOAD_MAX = 1000;
/** Trần PAYLOAD bậc TNCN — số bậc ĐÚNG 7 do service ép (⇒ 422 022). */
export const PAYROLL_PIT_BRACKETS_PAYLOAD_MAX = 50;
/** Số khoá `profileItems` tối đa ở preview (054) — bằng trần thành phần của một mẫu. */
export const PAYROLL_PREVIEW_PROFILE_ITEMS_MAX = 120;

/** Phần HÌNH DẠNG của `salary_components_code_shape_check`. */
const COMPONENT_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
const SORT_ORDER = z.number().int().min(0).max(1_000_000);
const MONEY_INPUT = z.number().min(0).max(PAYROLL_CATALOG_MONEY_MAX).multipleOf(0.01);
const POSITIVE_MONEY_INPUT = z.number().positive().max(PAYROLL_CATALOG_MONEY_MAX).multipleOf(0.01);
/** mirror `payroll_statutory_rates_pct_range_check` (BETWEEN 0 AND 100) + `numeric(5,2)`. */
const PERCENT_INPUT = z.number().min(0).max(100).multipleOf(0.01);
/** Số thập phân dạng CHUỖI (preview) — không đi qua số thực. */
const DECIMAL_STRING = z.string().regex(/^-?\d{1,16}(\.\d{1,10})?$/);

/**
 * Query boolean IDEMPOTENT với pipe chạy hai lần (`zod-query-param-double-pipe-idempotent`). KHÔNG dùng
 * `z.coerce.boolean()`: nó biến chuỗi `"false"` thành `true`.
 */
const BOOLEAN_QUERY = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);

const atLeastOneKey = (v: Record<string, unknown>) => Object.keys(v).length > 0;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. salary_components — PAYROLL-API-044..048
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** `aggregate` do engine sở hữu — client không tạo/đổi sang được (DB-13 §13.4). */
export const salaryComponentInputKindEnum = salaryComponentKindEnum.exclude(["aggregate"]);
/** `engine` CHỈ seeder tạo được (SPEC-11 §15.1 hàng 045/047 ⇒ 400). */
export const salaryComponentInputValueTypeEnum = salaryComponentValueTypeEnum.exclude(["engine"]);

/** GET /payroll/salary-components (044). */
export const salaryComponentListQuerySchema = z.object({
  kind: salaryComponentKindEnum.optional(),
  isSystem: BOOLEAN_QUERY.optional(),
  isActive: BOOLEAN_QUERY.optional(),
  ...payrollPageQuery,
});
export type SalaryComponentListQuery = z.infer<typeof salaryComponentListQuerySchema>;

/**
 * POST /payroll/salary-components (045). Refine CẶP `valueType` ↔ `formula`/`fixedAmount` mirror
 * `salary_components_value_pair_check` — trên PAYLOAD tạo mới là đủ (không có hàng cũ để merge).
 */
export const createSalaryComponentSchema = z
  .object({
    code: COMPONENT_CODE,
    name: z.string().trim().min(1).max(200),
    kind: salaryComponentInputKindEnum,
    valueType: salaryComponentInputValueTypeEnum,
    formula: z.string().nullable().optional(),
    fixedAmount: MONEY_INPUT.nullable().optional(),
    pitDeductible: z.boolean().default(false),
    isActive: z.boolean().default(true),
    sortOrder: SORT_ORDER.default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasFormula = typeof v.formula === "string";
    const hasFixed = typeof v.fixedAmount === "number";
    const ok =
      (v.valueType === "formula" && hasFormula && !hasFixed) ||
      (v.valueType === "fixed" && hasFixed && !hasFormula) ||
      (v.valueType === "profile_item" && !hasFormula && !hasFixed);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valueType"],
        message:
          "valueType không khớp formula/fixedAmount (formula ⇒ chỉ formula · fixed ⇒ chỉ fixedAmount · profile_item ⇒ không cả hai)",
      });
    }
  });
export type CreateSalaryComponentRequest = z.infer<typeof createSalaryComponentSchema>;

/**
 * PATCH /payroll/salary-components/:id (047). `code` BẤT BIẾN (khoá lạ ⇒ 400) — đổi mã làm gãy mọi công thức
 * tham chiếu nó. Cặp `valueType` kiểm ở SERVICE trên hàng SAU MERGE ⇒ 422 018 `component-value-pair`
 * (`zod-refine-sees-payload-not-merged-row`). Hàng `is_system`: chỉ `name`/`sortOrder` (trigger 0570).
 * `delete: true` = xoá mềm (không có route DELETE riêng).
 */
export const updateSalaryComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: salaryComponentInputKindEnum,
    valueType: salaryComponentInputValueTypeEnum,
    formula: z.string().nullable(),
    fixedAmount: MONEY_INPUT.nullable(),
    pitDeductible: z.boolean(),
    isActive: z.boolean(),
    sortOrder: SORT_ORDER,
    delete: z.literal(true),
  })
  .partial()
  .strict()
  .refine(atLeastOneKey, { message: "cần ít nhất một trường để sửa" });
export type UpdateSalaryComponentRequest = z.infer<typeof updateSalaryComponentSchema>;

/**
 * POST /payroll/salary-components/validate-formula (048) — KHÔNG ghi gì. `componentCode` (tuỳ chọn) ⇒ kiểm
 * vòng như thể thành phần đó mang công thức này.
 */
export const validateFormulaSchema = z
  .object({
    formula: z.string(),
    componentCode: COMPONENT_CODE.optional(),
    /**
     * Loại của thành phần đang soạn — quyết định cạnh NGẦM với 4 nút aggregate, nên quyết định cả «có vòng hay
     * không» (một `earning` tham chiếu `TONG_THU_NHAP` là vòng, một `deduction` thì không). Vắng ⇒ lấy của
     * `componentCode` nếu đã có trong catalog, không thì `earning`.
     */
    kind: salaryComponentInputKindEnum.optional(),
    pitDeductible: z.boolean().optional(),
  })
  .strict();
export type ValidateFormulaRequest = z.infer<typeof validateFormulaSchema>;

/** Một lỗi công thức — `kind` theo bảng ĐÓNG SPEC-11 §12.1 (không nhân bản danh sách ở đây). */
export const formulaIssueSchema = z.object({
  code: z.string(),
  kind: z.string(),
  message: z.string(),
  pos: z.number().int().optional(),
  ref: z.string().optional(),
  func: z.string().optional(),
  cycle: z.array(z.string()).optional(),
});
export type FormulaIssue = z.infer<typeof formulaIssueSchema>;

/** 048 luôn 200 — `valid:false` kèm `errors[]` là kết quả hợp lệ của một lượt kiểm. */
export const validateFormulaResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(formulaIssueSchema),
  refs: z.array(z.string()),
  depth: z.number().int(),
  nodes: z.number().int(),
});
export type ValidateFormulaResult = z.infer<typeof validateFormulaResultSchema>;

/**
 * DTO thành phần (044/046). `fixedAmount` là cấu hình cấp công ty (không phải lương per-người) — gác bằng cặp
 * sensitive `('view','salary-component')` ở route.
 */
export const salaryComponentDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: salaryComponentKindEnum,
  valueType: salaryComponentValueTypeEnum,
  formula: z.string().nullable(),
  fixedAmount: z.number().nullable(),
  pitDeductible: z.boolean(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.string(),
});
export type SalaryComponentDto = z.infer<typeof salaryComponentDtoSchema>;

export const salaryComponentDetailDtoSchema = salaryComponentDtoSchema.extend({
  usedByTemplates: z.array(z.object({ id: z.string().uuid(), code: z.string(), name: z.string() })),
});
export type SalaryComponentDetailDto = z.infer<typeof salaryComponentDetailDtoSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. payroll_templates + payroll_template_components — PAYROLL-API-049..054
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** GET /payroll/templates (049). */
export const payrollTemplateListQuerySchema = z.object({
  scope: payrollTemplateScopeEnum.optional(),
  isActive: BOOLEAN_QUERY.optional(),
  ...payrollPageQuery,
});
export type PayrollTemplateListQuery = z.infer<typeof payrollTemplateListQuerySchema>;

/** POST /payroll/templates (050). Refine cặp mirror `payroll_templates_scope_pair_check`. */
export const createPayrollTemplateSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    scope: payrollTemplateScopeEnum.default("company"),
    orgUnitId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.scope === "org_unit") !== (typeof v.orgUnitId === "string")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orgUnitId"],
        message: "scope = org_unit ⇔ có orgUnitId",
      });
    }
  });
export type CreatePayrollTemplateRequest = z.infer<typeof createPayrollTemplateSchema>;

/** PATCH /payroll/templates/:id (052) — cặp scope kiểm ở service SAU MERGE ⇒ 422 018 `template-scope-pair`. */
export const updatePayrollTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    scope: payrollTemplateScopeEnum,
    orgUnitId: z.string().uuid().nullable(),
    isActive: z.boolean(),
    delete: z.literal(true),
  })
  .partial()
  .strict()
  .refine(atLeastOneKey, { message: "cần ít nhất một trường để sửa" });
export type UpdatePayrollTemplateRequest = z.infer<typeof updatePayrollTemplateSchema>;

export const payrollTemplateComponentInputSchema = z
  .object({
    componentId: z.string().uuid(),
    columnLabel: z.string().trim().min(1).max(200).nullable().optional(),
    /** KHÔNG cap độ dài — luật 1 ở docblock đầu file. `null`/vắng = dùng công thức của catalog. */
    formulaOverride: z.string().nullable().optional(),
    isVisible: z.boolean().default(true),
    sortOrder: SORT_ORDER.default(0),
  })
  .strict();
export type PayrollTemplateComponentInput = z.infer<typeof payrollTemplateComponentInputSchema>;

/**
 * PUT /payroll/templates/:id/components (053) — ĐẶT LẠI TOÀN BỘ trong một lượt. Trần 120 thành phần, trùng
 * thành phần, thiếu 4 nút aggregate… đều ép ở service (⇒ 422 018), KHÔNG ở đây.
 */
export const putPayrollTemplateComponentsSchema = z
  .object({
    components: z
      .array(payrollTemplateComponentInputSchema)
      .max(PAYROLL_TEMPLATE_COMPONENTS_PAYLOAD_MAX),
  })
  .strict();
export type PutPayrollTemplateComponentsRequest = z.infer<
  typeof putPayrollTemplateComponentsSchema
>;

export const payrollTemplateDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  scope: payrollTemplateScopeEnum,
  orgUnitId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
});
export type PayrollTemplateDto = z.infer<typeof payrollTemplateDtoSchema>;

export const payrollTemplateComponentDtoSchema = z.object({
  componentId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: salaryComponentKindEnum,
  valueType: salaryComponentValueTypeEnum,
  columnLabel: z.string().nullable(),
  /** Công thức của CATALOG (tham khảo). */
  catalogFormula: z.string().nullable(),
  formulaOverride: z.string().nullable(),
  isVisible: z.boolean(),
  sortOrder: z.number().int(),
});
export type PayrollTemplateComponentDto = z.infer<typeof payrollTemplateComponentDtoSchema>;

/**
 * GET /payroll/templates/:id (051). `formulaSetFingerprint` băm TẬP CÔNG THỨC của MẪU, KHÔNG kèm bản tỉ lệ
 * (tỉ lệ đi theo KỲ) — dòng lương dùng `lineFingerprint(formulaSetFingerprint, statutoryRateId)` (SPEC-11 §13.6 G).
 */
export const payrollTemplateDetailDtoSchema = payrollTemplateDtoSchema.extend({
  components: z.array(payrollTemplateComponentDtoSchema),
  formulaSetFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PayrollTemplateDetailDto = z.infer<typeof payrollTemplateDetailDtoSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. payroll_statutory_rates — PAYROLL-API-055..058
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Một bậc TNCN — CHỈ hình dạng; 7 bậc + liên tục ép ở service (luật 2). */
export const pitBracketSchema = z
  .object({ upTo: z.number().nullable(), rate: z.number() })
  .strict();

/** Khối giá trị của một bản tỉ lệ — mirror `payroll_statutory_rates_pct_range_check` + `_amount_check`. */
export const statutoryRateValuesSchema = z.object({
  siEmployeePct: PERCENT_INPUT,
  hiEmployeePct: PERCENT_INPUT,
  uiEmployeePct: PERCENT_INPUT,
  siEmployerPct: PERCENT_INPUT,
  hiEmployerPct: PERCENT_INPUT,
  uiEmployerPct: PERCENT_INPUT,
  unionEmployerPct: PERCENT_INPUT,
  unionEmployeePct: PERCENT_INPUT,
  siCap: POSITIVE_MONEY_INPUT,
  hiCap: POSITIVE_MONEY_INPUT,
  uiCap: POSITIVE_MONEY_INPUT,
  baseWage: POSITIVE_MONEY_INPUT,
  minRegionWage: POSITIVE_MONEY_INPUT,
  personalDeduction: MONEY_INPUT,
  dependentDeduction: MONEY_INPUT,
  pitBrackets: z.array(pitBracketSchema).max(PAYROLL_PIT_BRACKETS_PAYLOAD_MAX),
});

/** GET /payroll/statutory-rates (055). */
export const statutoryRateListQuerySchema = z.object({ ...payrollPageQuery });
export type StatutoryRateListQuery = z.infer<typeof statutoryRateListQuerySchema>;

/** POST /payroll/statutory-rates (056). */
export const createStatutoryRateSchema = statutoryRateValuesSchema
  .extend({
    effectiveFrom: z.string().date(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type CreateStatutoryRateRequest = z.infer<typeof createStatutoryRateSchema>;

/** PATCH /payroll/statutory-rates/:id (058) — chỉ bản CHƯA có kỳ dùng (⇒ 409 033 `rate-in-use`). */
export const updateStatutoryRateSchema = createStatutoryRateSchema
  .partial()
  .strict()
  .refine(atLeastOneKey, { message: "cần ít nhất một trường để sửa" });
export type UpdateStatutoryRateRequest = z.infer<typeof updateStatutoryRateSchema>;

export const statutoryRateDtoSchema = statutoryRateValuesSchema.extend({
  id: z.string().uuid(),
  effectiveFrom: z.string().date(),
  pitBrackets: z.array(z.object({ upTo: z.number().nullable(), rate: z.number() })),
  note: z.string().nullable(),
  /** Đã có kỳ lương ≥ Calculated dùng bản này ⇒ không sửa tại chỗ được (FE khoá nút Sửa). */
  inUse: z.boolean(),
  updatedAt: z.string(),
});
export type StatutoryRateDto = z.infer<typeof statutoryRateDtoSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. Preview (054) + envelope GHI
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * POST /payroll/templates/:id/preview (054) — dữ liệu GIẢ do client gửi; server KHÔNG đọc lương thật, KHÔNG
 * đọc `payroll_statutory_rates` (tránh đọc-xuyên cặp `view:statutory-rate`). `inputs` vắng khoá ⇒ 0 (CHỈ ở
 * preview). Giá trị trả là CHUỖI thập phân scale 2.
 */
export const payrollTemplatePreviewSchema = z
  .object({
    inputs: z.record(payrollSysRefEnum, DECIMAL_STRING).default({}),
    /** ≤ 120 khoá — bằng trần thành phần của một mẫu (payload lớn hơn không thể là dữ liệu giả hợp lý). */
    profileItems: z
      .record(COMPONENT_CODE, DECIMAL_STRING)
      .refine((v) => Object.keys(v).length <= PAYROLL_PREVIEW_PROFILE_ITEMS_MAX, {
        message: `tối đa ${PAYROLL_PREVIEW_PROFILE_ITEMS_MAX} khoá`,
      })
      .default({}),
    pitPayer: pitPayerEnum.default("EMPLOYEE"),
    statutory: statutoryRateValuesSchema.omit({ baseWage: true, minRegionWage: true }).strict(),
  })
  .strict();
export type PayrollTemplatePreviewRequest = z.infer<typeof payrollTemplatePreviewSchema>;

export const payrollTemplatePreviewResultSchema = z.object({
  columns: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      kind: salaryComponentKindEnum,
      isVisible: z.boolean(),
      sortOrder: z.number().int(),
    }),
  ),
  values: z.record(z.string(), DECIMAL_STRING),
  formulaSetFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  nodesVisited: z.number().int(),
});
export type PayrollTemplatePreviewResult = z.infer<typeof payrollTemplatePreviewResultSchema>;

/** Envelope GHI của 045/047/050/052/053/056/058 — 0 khoá tiền. */
export const payrollCatalogWriteResultSchema = z.object({ id: z.string().uuid() });
export type PayrollCatalogWriteResult = z.infer<typeof payrollCatalogWriteResultSchema>;
