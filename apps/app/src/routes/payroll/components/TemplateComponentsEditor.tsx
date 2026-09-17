import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { SalaryComponentDto } from "@mediaos/contracts";
import { Button, Checkbox, Input, Select, cn } from "@mediaos/ui";
import {
  addComponent,
  canOverrideFormula,
  canRemoveRow,
  moveRow,
  removeRow,
  updateRow,
  type TemplateRow,
} from "../template-editor";
import { FormulaEditor } from "./FormulaEditor";

/**
 * PAY-SCREEN-010 — bảng thành phần của một mẫu (khuôn wireframe §05-2): thứ tự · mã · tên/loại · nhãn cột ·
 * công thức (catalog, ghi đè) · ẩn/hiện · gỡ. Sửa CỤC BỘ; trang cha gửi một lượt 053.
 *
 * Kéo-thả HTML5 cho chuột + nút ↑↓ cho bàn phím (D7) — không thêm thư viện dnd.
 * `editable=false` (chỉ có `view:payroll-template`) ⇒ bảng chỉ đọc, không nút nào.
 */
export function TemplateComponentsEditor({
  rows,
  onChange,
  editable,
  catalog,
  knownCodes,
  canValidate,
}: {
  rows: readonly TemplateRow[];
  onChange: (rows: TemplateRow[]) => void;
  editable: boolean;
  catalog: readonly SalaryComponentDto[];
  knownCodes: readonly string[];
  canValidate: boolean;
}) {
  const { t } = useTranslation("payroll");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("");

  const addable = useMemo(() => {
    const present = new Set(rows.map((r) => r.componentId));
    return catalog.filter((c) => c.isActive && !present.has(c.id));
  }, [catalog, rows]);

  const onAdd = () => {
    const component = addable.find((c) => c.id === toAdd);
    if (!component) return;
    onChange(addComponent(rows, component));
    setToAdd("");
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
              {editable && (
                <th className="w-20 px-2 py-2 font-medium">{t("templateEditor.order")}</th>
              )}
              <th className="px-2 py-2 font-medium">{t("templateEditor.code")}</th>
              <th className="px-2 py-2 font-medium">{t("templateEditor.component")}</th>
              <th className="px-2 py-2 font-medium">{t("templateEditor.columnLabel")}</th>
              <th className="px-2 py-2 font-medium">{t("templateEditor.formula")}</th>
              <th className="px-2 py-2 text-center font-medium">{t("templateEditor.visible")}</th>
              {editable && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                  {t("templateEditor.empty")}
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const override = row.formulaOverride.trim() !== "";
              const isOpen = expanded === row.componentId;
              return (
                <Fragment key={row.componentId}>
                  <tr
                    className={cn(
                      "border-b border-border/60 align-top",
                      dragFrom === index && "opacity-50",
                    )}
                    draggable={editable}
                    onDragStart={() => setDragFrom(index)}
                    onDragEnd={() => setDragFrom(null)}
                    onDragOver={(e) => {
                      if (editable) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragFrom !== null) onChange(moveRow(rows, dragFrom, index));
                      setDragFrom(null);
                    }}
                    data-testid={`template-row-${row.code}`}
                  >
                    {editable && (
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <GripVertical
                            className="size-4 cursor-grab text-muted-foreground"
                            aria-hidden
                          />
                          <button
                            type="button"
                            className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                            disabled={index === 0}
                            onClick={() => onChange(moveRow(rows, index, index - 1))}
                            aria-label={t("templateEditor.moveUp", { code: row.code })}
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                            disabled={index === rows.length - 1}
                            onClick={() => onChange(moveRow(rows, index, index + 1))}
                            aria-label={t("templateEditor.moveDown", { code: row.code })}
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="px-2 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-2 py-2">
                      <div>{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t(`componentKind.${row.kind}`)} ·{" "}
                        {t(`componentValueType.${row.valueType}`)}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {editable ? (
                        <Input
                          value={row.columnLabel}
                          placeholder={row.name}
                          maxLength={200}
                          onChange={(e) =>
                            onChange(updateRow(rows, index, { columnLabel: e.target.value }))
                          }
                          aria-label={t("templateEditor.columnLabelFor", { code: row.code })}
                          className="h-8 min-w-40"
                        />
                      ) : (
                        row.columnLabel || row.name
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <code
                        className={cn(
                          "block max-w-sm break-all font-mono text-xs",
                          override && "line-through opacity-60",
                        )}
                      >
                        {row.catalogFormula ?? t(`componentValueType.${row.valueType}`)}
                      </code>
                      {override && (
                        <code className="mt-1 block max-w-sm break-all font-mono text-xs text-primary">
                          {row.formulaOverride}
                        </code>
                      )}
                      {editable && canOverrideFormula(row) && (
                        <button
                          type="button"
                          className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                          onClick={() => setExpanded(isOpen ? null : row.componentId)}
                        >
                          {isOpen
                            ? t("templateEditor.closeOverride")
                            : override
                              ? t("templateEditor.editOverride")
                              : t("templateEditor.addOverride")}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox
                        checked={row.isVisible}
                        disabled={!editable}
                        onChange={(e) =>
                          onChange(updateRow(rows, index, { isVisible: e.target.checked }))
                        }
                        aria-label={t("templateEditor.visibleFor", { code: row.code })}
                      />
                    </td>
                    {editable && (
                      <td className="px-2 py-2 text-right">
                        {canRemoveRow(row) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onChange(removeRow(rows, index))}
                          >
                            {t("templateEditor.remove")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("templateEditor.required")}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                  {editable && isOpen && (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={7} className="px-4 py-3">
                        <FormulaEditor
                          label={t("templateEditor.overrideLabel", { code: row.code })}
                          value={row.formulaOverride}
                          onChange={(v) => onChange(updateRow(rows, index, { formulaOverride: v }))}
                          knownCodes={knownCodes}
                          canValidate={canValidate}
                          context={{ componentCode: row.code }}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("templateEditor.overrideHint")}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            className="w-72"
            aria-label={t("templateEditor.addLabel")}
          >
            <option value="">{t("templateEditor.addPlaceholder")}</option>
            {addable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={toAdd === ""}>
            {t("templateEditor.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
