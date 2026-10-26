import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronDown } from "lucide-react";
import { companyTimeZone, formatDate, formatDateTime } from "@mediaos/web-core";
import { Button, Input, Popover, cn } from "@mediaos/ui";
import {
  customDeadlineToIso,
  DEFAULT_DEADLINE_PRESETS,
  isoToCustomDeadline,
  resolveDeadlinePresets,
  type DeadlinePreset,
  type DeadlinePresetDefinition,
} from "./deadline-presets";

/**
 * S20-TASK-QUICKEDIT-1 (US-TASK-NV-08) — popover mốc hạn DÙNG CHUNG: chi tiết việc, form tạo/sửa, việc
 * con, dòng «Việc của tôi» / Danh sách / Quá hạn (và tạo nhanh ở S20-TASK-QUICKADD-1).
 *
 * Component KHÔNG tự lưu: chọn mốc ⇒ `onSelect(isoUtc | null)`, phía gọi quyết định lưu ngay qua route
 * change-deadline (dòng, chi tiết, việc con) hay chỉ điền ô (form). Không tự gate quyền — phía gọi chỉ
 * render nó khi có cặp `update-deadline:task`.
 *
 * Mốc tính khi MỞ popover, theo giờ công ty (`timeZone`, mặc định `companyTimeZone()`), qua hàm thuần
 * `resolveDeadlinePresets` — không mốc nào ở quá khứ. «Tuỳ chỉnh» đọc ô `datetime-local` theo cùng múi.
 */
export interface DeadlineQuickPickerProps {
  /** id + data-testid của nút mở; mốc con là `${id}-preset-<id>`, `${id}-clear`, `${id}-custom`. */
  id: string;
  /** Hạn hiện tại (ISO UTC) hoặc `null`. */
  value: string | null;
  onSelect: (dueAt: string | null) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Định nghĩa mốc — mặc định Hôm nay · Ngày mai · Thứ Sáu · Thứ Hai tuần sau; nối thêm được. */
  presets?: readonly DeadlinePresetDefinition[];
  /** Hiện «Xoá hạn» khi đang có hạn (mặc định có). */
  allowClear?: boolean;
  /** Hiện «Tuỳ chỉnh» (mặc định có) — tắt khi phía gọi đã có ô ngày giờ riêng cạnh đó. */
  allowCustom?: boolean;
  /** «field»: nút rộng hiện ngày giờ · «compact»: chip nhỏ trên dòng · «quick»: nút «Chọn nhanh». */
  variant?: "field" | "compact" | "quick";
  /** Đồng hồ — test truyền mốc cố định; mặc định giờ thật lúc mở popover. */
  getNow?: () => Date;
  timeZone?: string;
}

const realNow = () => new Date();

function TriggerContent({
  variant,
  value,
  timeZone,
}: {
  variant: NonNullable<DeadlineQuickPickerProps["variant"]>;
  value: string | null;
  timeZone: string;
}) {
  const { t } = useTranslation("tasks");
  if (variant === "quick") {
    return <span className="text-xs font-medium">{t("deadlinePicker.quickLabel")}</span>;
  }
  if (variant === "compact") {
    return (
      <>
        <CalendarDays className="h-3 w-3" aria-hidden="true" />
        <span>{value ? formatDateTime(value, timeZone) : t("deadlinePicker.setDeadline")}</span>
      </>
    );
  }
  return (
    <>
      <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className={cn(!value && "text-muted-foreground")}>
        {value ? formatDateTime(value, timeZone) : t("deadlinePicker.empty")}
      </span>
      <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
    </>
  );
}

const TRIGGER_CLASS: Record<NonNullable<DeadlineQuickPickerProps["variant"]>, string> = {
  field:
    "flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-sm",
  compact:
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
  quick:
    "inline-flex h-7 items-center rounded-md border border-border px-2 text-muted-foreground hover:bg-muted hover:text-foreground",
};

function PresetChip({
  id,
  preset,
  timeZone,
  onPick,
}: {
  id: string;
  preset: DeadlinePreset;
  timeZone: string;
  onPick: (dueAt: string) => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <button
      type="button"
      data-testid={`${id}-preset-${preset.id}`}
      onClick={() => onPick(preset.dueAt)}
      className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
    >
      <span>{t(`deadlinePicker.presets.${preset.labelKey}`, { time: preset.time })}</span>
      <span className="text-xs text-muted-foreground">{formatDate(preset.dueAt, timeZone)}</span>
    </button>
  );
}

function CustomDeadline({
  id,
  value,
  timeZone,
  onApply,
}: {
  id: string;
  value: string | null;
  timeZone: string;
  onApply: (dueAt: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const [draft, setDraft] = useState(() => isoToCustomDeadline(value, timeZone));
  const [invalid, setInvalid] = useState(false);
  const apply = () => {
    const iso = customDeadlineToIso(draft, timeZone);
    if (!iso) {
      setInvalid(true);
      return;
    }
    onApply(iso);
  };
  return (
    <div className="space-y-1.5 border-t border-border px-2 pt-2">
      <Input
        autoFocus
        type="datetime-local"
        aria-label={t("deadlinePicker.customInputLabel")}
        data-testid={`${id}-custom-input`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          // Popover nằm trong drawer — đừng để Esc lọt lên đóng panel.
          if (e.key === "Escape") e.stopPropagation();
        }}
        className="h-8 text-sm"
      />
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t("deadlinePicker.customInvalid")}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        className="w-full"
        data-testid={`${id}-custom-apply`}
        onClick={apply}
      >
        {t("deadlinePicker.customApply")}
      </Button>
    </div>
  );
}

export function DeadlineQuickPicker({
  id,
  value,
  onSelect,
  ariaLabel,
  disabled = false,
  presets = DEFAULT_DEADLINE_PRESETS,
  allowClear = true,
  allowCustom = true,
  variant = "field",
  getNow = realNow,
  timeZone = companyTimeZone(),
}: DeadlineQuickPickerProps) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    if (!next) setCustomOpen(false);
  };
  const pick = (dueAt: string | null) => {
    setOpenState(false);
    // Chọn lại đúng hạn đang có = no-op, không bắn request thừa.
    if (dueAt !== value) onSelect(dueAt);
  };
  const resolved = open ? resolveDeadlinePresets(getNow(), timeZone, presets) : [];

  return (
    <Popover
      open={open}
      onOpenChange={setOpenState}
      align="start"
      className="w-64 p-1"
      trigger={
        <button
          type="button"
          id={id}
          data-testid={id}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpenState(!open)}
          className={cn(
            TRIGGER_CLASS[variant],
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <TriggerContent variant={variant} value={value} timeZone={timeZone} />
        </button>
      }
    >
      <div role="group" aria-label={t("deadlinePicker.presetsLabel")} className="space-y-0.5">
        {resolved.map((preset) => (
          <PresetChip key={preset.id} id={id} preset={preset} timeZone={timeZone} onPick={pick} />
        ))}
        {allowClear && value !== null && (
          <button
            type="button"
            data-testid={`${id}-clear`}
            onClick={() => pick(null)}
            className="w-full rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
          >
            {t("deadlinePicker.clear")}
          </button>
        )}
        {allowCustom && !customOpen && (
          <button
            type="button"
            data-testid={`${id}-custom`}
            onClick={() => setCustomOpen(true)}
            className="w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            {t("deadlinePicker.custom")}
          </button>
        )}
      </div>
      {allowCustom && customOpen && (
        <CustomDeadline id={id} value={value} timeZone={timeZone} onApply={pick} />
      )}
    </Popover>
  );
}
