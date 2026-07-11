import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { VisibilityState } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";
import { Button, Checkbox, Popover } from "@mediaos/ui";
import type { EmployeeColumnMeta } from "./employee-table-columns";

/**
 * HR-PROFILE-UI-1 — panel "Tùy chỉnh cột": tick ẩn/hiện từng cột + nút Mặc định.
 * (Gom nhóm 1/2 cấp của bản mẫu là follow-up — xem backlog.)
 */
interface ColumnSettingsPopoverProps {
  catalog: EmployeeColumnMeta[];
  visibility: VisibilityState;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}

export function ColumnSettingsPopover({
  catalog,
  visibility,
  onToggle,
  onReset,
}: ColumnSettingsPopoverProps) {
  const { t } = useTranslation("hr");
  const [open, setOpen] = useState(false);

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
      <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
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
