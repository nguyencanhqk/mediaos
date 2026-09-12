import { Settings2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "./checkbox";
import { Popover } from "./popover";
import type { ColumnOption } from "../../hooks/use-column-visibility";
import { cn } from "../../lib/utils";

/**
 * `ColumnPicker` — nút ⚙ «Chọn cột» ở toolbar (UI-07 §10.4 mục 10, §12.3, DEC-020).
 *
 * Cặp đôi với `useColumnVisibility` (hook giữ state + persist). Component này THUẦN hiển thị:
 * nhận `options` + `hiddenIds` + `onToggle`, không tự đọc `localStorage`.
 *
 * ⚠️ Cột `locked` vẫn HIỆN trong menu nhưng **tick sẵn + `disabled`** — ẩn hẳn chúng đi thì người
 * dùng tưởng bảng có ít cột hơn thực tế và đi tìm cột «Tên nhân viên» trong danh sách mãi không thấy.
 */

export interface ColumnPickerProps {
  options: readonly ColumnOption[];
  hiddenIds: readonly string[];
  onToggle: (id: string) => void;
  /** Không truyền ⇒ không có nút «Mặc định». */
  onReset?: () => void;
  /** Ẩn nút «Mặc định» khi đang đúng bộ mặc định. */
  isDefault?: boolean;
  className?: string;
}

export function ColumnPicker({
  options,
  hiddenIds,
  onToggle,
  onReset,
  isDefault = true,
  className,
}: ColumnPickerProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = React.useState(false);
  const hidden = React.useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const label = t("table.columns", { defaultValue: "Chọn cột" });

  if (options.length === 0) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          title={label}
          data-testid="column-picker-trigger"
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            className,
          )}
        >
          <Settings2 className="h-4 w-4" aria-hidden />
        </button>
      }
    >
      <div className="flex items-center justify-between gap-4 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {onReset && !isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-brand transition-colors hover:underline"
            data-testid="column-picker-reset"
          >
            {t("table.columnsReset", { defaultValue: "Mặc định" })}
          </button>
        )}
      </div>
      <div className="max-h-72 space-y-0.5 overflow-y-auto">
        {options.map((option) => {
          const checked = !hidden.has(option.id) || Boolean(option.locked);
          return (
            <label
              key={option.id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                option.locked && "cursor-not-allowed opacity-60 hover:bg-transparent",
              )}
            >
              {/* `disabled` là VẺ NGOÀI, không phải cổng: click vào `<label>` bọc ngoài vẫn được
                  trình duyệt chuyển tiếp tới input và bắn `change` (đo thật trong spec). Cổng là
                  vế `!option.locked` dưới đây — `useColumnVisibility.toggle` chặn lớp thứ hai. */}
              <Checkbox
                checked={checked}
                disabled={option.locked}
                onChange={() => {
                  if (!option.locked) onToggle(option.id);
                }}
              />
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </Popover>
  );
}
