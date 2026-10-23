import { useTranslation } from "react-i18next";
import { Select } from "@mediaos/ui";
import { NOTI_STATUS } from "./constants";
import {
  NOTI_LIST_PRIORITIES,
  NOTI_LIST_SOURCES,
  type NotificationListSearch,
} from "./notification-list-search";

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function Chip({ label, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

interface ChipGroupProps<T extends string> {
  label: string;
  allLabel: string;
  options: readonly T[];
  value: T | undefined;
  optionLabel: (value: T) => string;
  onChange: (value: T | undefined) => void;
}

function ChipGroup<T extends string>({
  label,
  allLabel,
  options,
  value,
  optionLabel,
  onChange,
}: ChipGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <Chip label={allLabel} active={value === undefined} onClick={() => onChange(undefined)} />
      {options.map((option) => (
        <Chip
          key={option}
          label={optionLabel(option)}
          active={value === option}
          onClick={() => onChange(option)}
        />
      ))}
    </div>
  );
}

interface NotificationListFiltersProps {
  search: NotificationListSearch;
  onChange: (patch: Partial<NotificationListSearch>) => void;
}

/**
 * S20-NOTI-LISTNAV-1 (US-X-13) — chip lọc nguồn (`source_module`) + mức ưu tiên (`priority`) và bộ chọn
 * trạng thái của trang Thông báo. Không giữ state: giá trị đọc từ URL, đổi ⇒ `onChange` ghi lên URL.
 */
export function NotificationListFilters({ search, onChange }: NotificationListFiltersProps) {
  const { t } = useTranslation("notifications");

  return (
    <div className="flex flex-col gap-3">
      <ChipGroup
        label={t("list.filters.sourceLabel")}
        allLabel={t("list.filters.sourceAll")}
        options={NOTI_LIST_SOURCES}
        value={search.source}
        optionLabel={(source) => t(`list.filters.sources.${source}`)}
        onChange={(source) => onChange({ source })}
      />
      <ChipGroup
        label={t("list.filters.priorityLabel")}
        allLabel={t("list.filters.priorityAll")}
        options={NOTI_LIST_PRIORITIES}
        value={search.priority}
        optionLabel={(priority) => t(`priority.${priority}`)}
        onChange={(priority) => onChange({ priority })}
      />
      <Select
        value={search.status ?? ""}
        onChange={(e) =>
          onChange({
            status: e.target.value === NOTI_STATUS.UNREAD ? NOTI_STATUS.UNREAD : undefined,
          })
        }
        className="w-48"
        aria-label={t("list.filters.allStatuses")}
      >
        <option value="">{t("list.filters.allStatuses")}</option>
        <option value={NOTI_STATUS.UNREAD}>{t("list.filters.unreadOnly")}</option>
      </Select>
    </div>
  );
}
