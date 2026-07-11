import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupingState, VisibilityState } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";
import { Button, Checkbox, Popover } from "@mediaos/ui";
import type { EmployeeColumnMeta } from "./employee-table-columns";

/** Số cấp gom nhóm tối đa (đơn vị → trạng thái). */
const MAX_GROUPING_LEVELS = 2;

/**
 * HR-PROFILE-UI-1/2 — panel "Tùy chỉnh cột": tick ẩn/hiện từng cột + nút Mặc định.
 * HR-PROFILE-UI-2: thêm mục "Gom nhóm" 1–2 cấp (theo đơn vị/trạng thái) — TanStack getGroupedRowModel,
 * gom trên hàng ĐÃ tải (server-pagination giữ nguyên).
 */
interface ColumnSettingsPopoverProps {
  catalog: EmployeeColumnMeta[];
  visibility: VisibilityState;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
  /** Cột được phép gom nhóm (đơn vị/trạng thái). */
  groupableColumns: EmployeeColumnMeta[];
  /** Trạng thái gom nhóm hiện tại (mảng column id, thứ tự = cấp). */
  grouping: GroupingState;
  onGroupingChange: (grouping: GroupingState) => void;
}

export function ColumnSettingsPopover({
  catalog,
  visibility,
  onToggle,
  onReset,
  groupableColumns,
  grouping,
  onGroupingChange,
}: ColumnSettingsPopoverProps) {
  const { t } = useTranslation("hr");
  const [open, setOpen] = useState(false);

  /** Bật/tắt 1 cấp gom nhóm — thêm vào cuối (nếu chưa đủ cấp) hoặc gỡ khỏi mảng. */
  function toggleGrouping(id: string, checked: boolean) {
    if (checked) {
      if (grouping.includes(id) || grouping.length >= MAX_GROUPING_LEVELS) return;
      onGroupingChange([...grouping, id]);
    } else {
      onGroupingChange(grouping.filter((g) => g !== id));
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-64"
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={t("employees.columnSettings.title")}
          title={t("employees.columnSettings.title")}
          onClick={() => setOpen((o) => !o)}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      }
    >
      <p className="text-sm font-semibold text-foreground">{t("employees.columnSettings.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("employees.columnSettings.visible")}</p>
      <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
        {catalog.map((col) => (
          <label
            key={col.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60"
          >
            <Checkbox
              checked={visibility[col.id] !== false}
              onChange={(e) => onToggle(col.id, e.target.checked)}
            />
            {t(col.labelKey)}
          </label>
        ))}
      </div>

      {/* Gom nhóm 1–2 cấp (đơn vị/trạng thái) */}
      {groupableColumns.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-xs font-medium text-foreground">
            {t("employees.grouping.title", { defaultValue: "Gom nhóm" })}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("employees.grouping.hint", { defaultValue: "Chọn tối đa 2 cấp" })}
          </p>
          <div className="mt-1.5 space-y-0.5">
            {groupableColumns.map((col) => {
              const checked = grouping.includes(col.id);
              const atMax = grouping.length >= MAX_GROUPING_LEVELS;
              const level = grouping.indexOf(col.id) + 1;
              return (
                <label
                  key={col.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60"
                >
                  <Checkbox
                    checked={checked}
                    disabled={!checked && atMax}
                    onChange={(e) => toggleGrouping(col.id, e.target.checked)}
                    data-testid={`group-col-${col.id}`}
                  />
                  <span className="flex-1">{t(col.labelKey)}</span>
                  {checked && (
                    <span className="text-[11px] text-brand">
                      {t("employees.grouping.level", {
                        defaultValue: "Cấp {{level}}",
                        level,
                      })}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t("employees.columnSettings.reset")}
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          {t("employees.columnSettings.done")}
        </Button>
      </div>
    </Popover>
  );
}
