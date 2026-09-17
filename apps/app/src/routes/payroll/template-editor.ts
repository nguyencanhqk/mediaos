import type {
  PayrollTemplateDetailDto,
  PutPayrollTemplateComponentsRequest,
  SalaryComponentDto,
  SalaryComponentKind,
  SalaryComponentValueType,
} from "@mediaos/contracts";

/**
 * S15-PAYROLL-FE-2 — trạng thái SOẠN của danh sách thành phần một mẫu bảng lương (PAY-SCREEN-010, D6).
 *
 * Hàm THUẦN, bất biến (mỗi thao tác trả mảng MỚI). Màn sửa cục bộ rồi gửi MỘT lượt `PUT …/components`
 * (053 đặt lại toàn bộ — sửa từng dòng rời làm đồ thị tạm thời có vòng giữa chừng).
 *
 * ⚠️ KHÔNG chép danh sách mã hệ thống bắt buộc sang FE (`THUONG` · `PHAT` · `TAM_UNG` · `NGHI_KHONG_LUONG`
 * + 4 nút tổng hợp) — thiếu thì server trả 422 `template-input-missing`/`template-missing-engine-nodes` kèm
 * `missing`. Ở đây chỉ khoá hai điều CHẮC CHẮN sai: gỡ nút `engine` và ghi đè công thức của hàng
 * `engine`/`profile_item` (⇒ 422 `formula-override-not-allowed`).
 */

export interface TemplateRow {
  readonly componentId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: SalaryComponentKind;
  readonly valueType: SalaryComponentValueType;
  /** "" = dùng tên thành phần. */
  readonly columnLabel: string;
  readonly catalogFormula: string | null;
  /** "" = dùng công thức của catalog. */
  readonly formulaOverride: string;
  readonly isVisible: boolean;
}

/** Bước `sortOrder` khi gửi — chừa khe để sau này chèn tay giữa hai dòng mà không đánh số lại. */
export const TEMPLATE_SORT_STEP = 10;

export function rowsFromDetail(detail: PayrollTemplateDetailDto): TemplateRow[] {
  return [...detail.components]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((c) => ({
      componentId: c.componentId,
      code: c.code,
      name: c.name,
      kind: c.kind,
      valueType: c.valueType,
      columnLabel: c.columnLabel ?? "",
      catalogFormula: c.catalogFormula,
      formulaOverride: c.formulaOverride ?? "",
      isVisible: c.isVisible,
    }));
}

export function canOverrideFormula(row: Pick<TemplateRow, "valueType">): boolean {
  return row.valueType === "formula" || row.valueType === "fixed";
}

export function canRemoveRow(row: Pick<TemplateRow, "valueType">): boolean {
  return row.valueType !== "engine";
}

export function moveRow(rows: readonly TemplateRow[], from: number, to: number): TemplateRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return [...rows];
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export function removeRow(rows: readonly TemplateRow[], index: number): TemplateRow[] {
  const row = rows[index];
  if (!row || !canRemoveRow(row)) return [...rows];
  return rows.filter((_, i) => i !== index);
}

export function updateRow(
  rows: readonly TemplateRow[],
  index: number,
  patch: Partial<Pick<TemplateRow, "columnLabel" | "formulaOverride" | "isVisible">>,
): TemplateRow[] {
  return rows.map((r, i) => {
    if (i !== index) return r;
    const merged = { ...r, ...patch };
    return canOverrideFormula(r) ? merged : { ...merged, formulaOverride: "" };
  });
}

/** Thêm vào CUỐI; đã có thì trả nguyên (053 cấm trùng ⇒ 422 `template-component-duplicate`). */
export function addComponent(
  rows: readonly TemplateRow[],
  component: SalaryComponentDto,
): TemplateRow[] {
  if (rows.some((r) => r.componentId === component.id)) return [...rows];
  return [
    ...rows,
    {
      componentId: component.id,
      code: component.code,
      name: component.name,
      kind: component.kind,
      valueType: component.valueType,
      columnLabel: "",
      catalogFormula: component.formula,
      formulaOverride: "",
      isVisible: true,
    },
  ];
}

/** Payload 053 — nhãn/công thức rỗng ⇒ `null` (dùng của catalog), `sortOrder` = vị trí × bước. */
export function toPutPayload(rows: readonly TemplateRow[]): PutPayrollTemplateComponentsRequest {
  return {
    components: rows.map((r, i) => ({
      componentId: r.componentId,
      columnLabel: r.columnLabel.trim() === "" ? null : r.columnLabel.trim(),
      formulaOverride:
        canOverrideFormula(r) && r.formulaOverride.trim() !== "" ? r.formulaOverride.trim() : null,
      isVisible: r.isVisible,
      sortOrder: i * TEMPLATE_SORT_STEP,
    })),
  };
}

/** Đã khác bản server chưa — so PAYLOAD (thứ tự + nội dung), không so tham chiếu mảng. */
export function isTemplateDirty(
  rows: readonly TemplateRow[],
  detail: PayrollTemplateDetailDto | undefined,
): boolean {
  if (!detail) return false;
  return (
    JSON.stringify(toPutPayload(rows)) !== JSON.stringify(toPutPayload(rowsFromDetail(detail)))
  );
}
