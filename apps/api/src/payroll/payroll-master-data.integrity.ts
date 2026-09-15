import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollStatutoryRates, payrollTemplates, salaryComponents } from "../db/schema/payroll";
import { isFormulaError } from "./formula/formula.errors";
import { compileGraph } from "./formula/formula.graph";
import { templateGraphComponent } from "./payroll-template-graph";
import { PayrollTemplatesRepository } from "./payroll-templates.repository";

/**
 * Kiểm tra tính toàn vẹn của seed PAYROLL — tách khỏi `payroll-master-data.seeder.ts` (S15-PAYROLL-DB-1B plan §3.3:
 * seeder đã vượt trần 800 dòng). Hàm THUẦN theo tham số: KHÔNG import seeder — hằng đi vào qua `expected`.
 *
 * ⚠️ Kiểm **theo TẬP MÃ, không theo phép ĐẾM**: app role có `INSERT/UPDATE` trên `salary_components`, và `kind` /
 * `pit_deductible` người dùng đặt được. Công ty thêm khoản BH tự nguyện `pit_deductible = true` (hợp lệ) sẽ làm
 * `count(...) = 3` gãy ⇒ seeder `Failed` mỗi lượt boot ⇒ áp lực nới assert ⇒ **mất chốt «đoàn phí giảm thuế»**
 * (`invariant-count-must-filter-owned-rows`). Lọc `is_system` + so TẬP MÃ thì hàng của tenant không ảnh hưởng.
 *
 * ⚠️ Ném ở đây KHÔNG chặn boot (runner nuốt) — nó đánh batch `Failed` + log. Cổng cứng nằm ở đường TÍNH/ĐỌC.
 */

export interface SystemComponentExpectation {
  readonly code: string;
  readonly kind: string;
  readonly valueType: string;
  readonly formula: string | null;
  readonly pitDeductible: boolean;
}

export interface PayrollSeedExpectations {
  readonly components: readonly SystemComponentExpectation[];
  /** Giá trị seeder chèn cho MỌI hàng hệ thống — CÙNG object seeder dùng ở INSERT (một nguồn). */
  readonly rowDefaults: { readonly fixedAmount: string | null; readonly isActive: boolean };
  readonly engineCodes: readonly string[];
  readonly pitDeductibleCodes: readonly string[];
  readonly defaultTemplateCode: string;
}

type SystemRow = {
  code: string;
  kind: string;
  valueType: string;
  formula: string | null;
  fixedAmount: string | null;
  pitDeductible: boolean;
  isActive: boolean;
};

const TAG = "[payroll.master-data]";

/** `componentsTx` không dùng `this` — gọi CHÍNH câu truy vấn của 053/054/047 thay vì chép lại (plan §3.8 M-2). */
const templatesRepo = new PayrollTemplatesRepository();

export async function assertPayrollSeedIntegrity(
  tx: TenantTx,
  companyId: string,
  expected: PayrollSeedExpectations,
): Promise<void> {
  const systemRows: SystemRow[] = await tx
    .select({
      code: salaryComponents.code,
      kind: salaryComponents.kind,
      valueType: salaryComponents.valueType,
      formula: salaryComponents.formula,
      fixedAmount: salaryComponents.fixedAmount,
      pitDeductible: salaryComponents.pitDeductible,
      isActive: salaryComponents.isActive,
    })
    .from(salaryComponents)
    .where(
      and(
        eq(salaryComponents.companyId, companyId),
        eq(salaryComponents.isSystem, true),
        isNull(salaryComponents.deletedAt),
      ),
    );

  assertCodeSets(systemRows, expected, companyId); // (1)(2)(3)(6)
  await assertLiveStatutoryRate(tx, companyId); // (4)
  await assertDefaultTemplateCompiles(tx, companyId, expected.defaultTemplateCode); // (5)
  assertSystemRowContent(systemRows, expected, companyId); // (7)
}

function assertCodeSets(
  rows: readonly SystemRow[],
  expected: PayrollSeedExpectations,
  companyId: string,
): void {
  // (1) Tập mã `value_type = 'engine'` ĐÚNG BẰNG 4 nút tổng hợp.
  assertSameCodeSet(
    rows.filter((r) => r.valueType === "engine").map((r) => r.code),
    expected.engineCodes,
    "nút tổng hợp value_type='engine'",
    companyId,
  );
  // (2) Tập mã được trừ thuế ĐÚNG BẰNG 3 khoản BH bắt buộc — `DOAN_PHI` KHÔNG được có mặt.
  assertSameCodeSet(
    rows.filter((r) => r.kind === "statutory_employee" && r.pitDeductible).map((r) => r.code),
    expected.pitDeductibleCodes,
    "khoản statutory_employee được trừ thuế (pit_deductible)",
    companyId,
  );
  // (3) Ca DƯƠNG tường minh: thiếu ca này thì "DOAN_PHI vắng mặt hoàn toàn" cũng làm (2) xanh.
  const doanPhi = rows.find((r) => r.code === "DOAN_PHI");
  if (!doanPhi) {
    throw new Error(`${TAG} thiếu thành phần DOAN_PHI (company=${companyId}) — (2) sẽ xanh RỖNG`);
  }
  if (doanPhi.pitDeductible !== false) {
    throw new Error(
      `${TAG} DOAN_PHI.pit_deductible = true (company=${companyId}) — đoàn phí do NV chịu nhưng KHÔNG được trừ thuế ` +
        `(SPEC-11 §13.7 D)`,
    );
  }
  // (6) Tập mã `is_system` sống ĐÚNG BẰNG hằng TS — so hai tập LẤY TỪ DB không bắt được mã bị KHAI TỬ hay mã THỪA.
  assertSameCodeSet(
    rows.map((r) => r.code),
    expected.components.map((c) => c.code),
    "tập mã thành phần hệ thống so với hằng seeder",
    companyId,
  );
}

/**
 * (4) Có ít nhất một bản tỉ lệ luật định CÒN SỐNG. KHÔNG ghim ngày seed: 058 đổi được `effectiveFrom`, ghim ngày là
 * ném mỗi lần boot sau khi người dùng sửa hợp lệ (database-review BE-2 HIGH-1).
 */
async function assertLiveStatutoryRate(tx: TenantTx, companyId: string): Promise<void> {
  const [rate] = await tx
    .select({ id: payrollStatutoryRates.id })
    .from(payrollStatutoryRates)
    .where(
      and(eq(payrollStatutoryRates.companyId, companyId), isNull(payrollStatutoryRates.deletedAt)),
    )
    .limit(1);
  if (!rate) {
    throw new Error(
      `${TAG} không còn bản payroll_statutory_rates nào sống (company=${companyId}) — máy tính lương sẽ không có tỉ lệ để áp`,
    );
  }
}

/**
 * (5) Mẫu mặc định DO SEEDER TẠO (nếu còn sống) phải BIÊN DỊCH được như đường TÍNH sẽ biên dịch nó —
 * `compileGraph(requireEngineNodes)` trên CÙNG hàng (`componentsTx`) và CÙNG ánh xạ (`templateGraphComponent`) của
 * 053/054/BE-3. Đếm 4 nút aggregate (bản BE-2) mù với ghi đè REF tới mã không tồn tại hay thành phần đã bị gỡ: mẫu
 * hỏng âm thầm tới lượt tính đầu tiên. KHÔNG so SET-EQUALITY với catalog — người dùng sửa được mẫu qua 053.
 * Thành phần ngưng dùng/xoá mềm: 053 và 054 đều từ chối ⇒ ở đây cũng vậy (không chặt hơn đường thật).
 */
async function assertDefaultTemplateCompiles(
  tx: TenantTx,
  companyId: string,
  templateCode: string,
): Promise<void> {
  const [tpl] = await tx
    .select({ id: payrollTemplates.id })
    .from(payrollTemplates)
    .where(
      and(
        eq(payrollTemplates.companyId, companyId),
        eq(payrollTemplates.code, templateCode),
        isNull(payrollTemplates.deletedAt),
        // Mẫu người dùng tạo lại cùng mã (050 luôn tạo RỖNG) ⇒ assert này ném MỖI LẦN BOOT (security-review BE-2 LOW-6).
        isNull(payrollTemplates.createdBy),
      ),
    )
    .limit(1);
  if (!tpl) return;

  const rows = await templatesRepo.componentsTx(tx, companyId, tpl.id);
  const retired = rows
    .filter((r) => !r.componentActive || r.componentDeletedAt !== null)
    .map((r) => r.code);
  if (retired.length > 0) {
    throw new Error(
      `${TAG} mẫu mặc định chứa thành phần ngưng dùng/xoá mềm [${retired.join(", ")}] (company=${companyId}) — ` +
        `đường tính sẽ từ chối (422)`,
    );
  }
  try {
    compileGraph(rows.map(templateGraphComponent), { requireEngineNodes: true });
  } catch (err) {
    if (!isFormulaError(err)) throw err;
    throw new Error(
      `${TAG} mẫu mặc định KHÔNG biên dịch được: ${err.code} ${err.kind} ${JSON.stringify(err.details)} ` +
        `(company=${companyId})`,
    );
  }
}

/**
 * (7) NỘI DUNG mọi hàng `is_system` sống có mã thuộc hằng == đúng giá trị seeder chèn. (6) chỉ so TẬP MÃ nên mù
 * với lệch nội dung — đúng lớp lỗi của công thức `LUONG_CO_BAN` trừ hai lần (plan-review BE-2 B1): hàng seed sai
 * tồn tại vĩnh viễn vì `ON CONFLICT DO NOTHING` + trigger đóng băng. Mã lạ là việc của (6).
 * KHÔNG so cột người dùng sửa được (`name`, `sort_order`) — seeder chạy MỖI boot.
 * `fixed_amount` so nguyên chuỗi: hằng hiện là `null` cho mọi hàng; hằng nào mang số phải chuẩn hoá scale trước khi so.
 */
function assertSystemRowContent(
  rows: readonly SystemRow[],
  expected: PayrollSeedExpectations,
  companyId: string,
): void {
  const byCode = new Map(expected.components.map((c) => [c.code, c]));
  const drift: string[] = [];
  for (const row of rows) {
    const e = byCode.get(row.code);
    if (!e) continue;
    const pairs: Array<[string, unknown, unknown]> = [
      ["kind", row.kind, e.kind],
      ["value_type", row.valueType, e.valueType],
      ["formula", row.formula, e.formula],
      ["pit_deductible", row.pitDeductible, e.pitDeductible],
      ["fixed_amount", row.fixedAmount, expected.rowDefaults.fixedAmount],
      ["is_active", row.isActive, expected.rowDefaults.isActive],
    ];
    for (const [field, got, want] of pairs) {
      if (got !== want)
        drift.push(`${row.code}.${field}: DB=${JSON.stringify(got)} hằng=${JSON.stringify(want)}`);
    }
  }
  if (drift.length > 0) {
    throw new Error(
      `${TAG} nội dung hàng hệ thống LỆCH hằng seeder (company=${companyId}) — ${drift.join(" · ")}`,
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
      `${TAG} ${what} LỆCH (company=${companyId}) — thiếu: [${missing.join(", ")}] · thừa: [${extra.join(", ")}]`,
    );
  }
}
