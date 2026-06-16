import { useTranslation } from "react-i18next";
import type { EmployeeListItemDto } from "@mediaos/contracts";
import type { ChannelFilters } from "@/lib/channels-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CHANNEL_STATUS_LABELS,
  CHANNEL_STATUS_OPTIONS,
  PLATFORM_LABELS,
  PLATFORM_OPTIONS,
} from "./constants";

interface ChannelFilterBarProps {
  filters: ChannelFilters;
  onChange: (patch: Partial<ChannelFilters>) => void;
  onClear: () => void;
  employees: EmployeeListItemDto[];
  nicheOptions: string[];
}

const hasAnyFilter = (f: ChannelFilters): boolean =>
  Boolean(f.platform || f.status || f.managerId || f.niche || f.q || f.risk);

export function ChannelFilterBar({
  filters,
  onChange,
  onClear,
  employees,
  nicheOptions,
}: ChannelFilterBarProps) {
  const { t } = useTranslation("channels");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.q ?? ""}
        onChange={(e) => onChange({ q: e.target.value || undefined })}
        placeholder={t("filterBar.searchPlaceholder")}
        className="max-w-xs"
      />

      <Select
        value={filters.platform ?? ""}
        onChange={(e) => onChange({ platform: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("filterBar.allPlatforms")}</option>
        {PLATFORM_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABELS[p]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.status ?? ""}
        onChange={(e) => onChange({ status: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("filterBar.allStatuses")}</option>
        {CHANNEL_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {CHANNEL_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.managerId ?? ""}
        onChange={(e) => onChange({ managerId: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("filterBar.allManagers")}</option>
        {employees.map((e) => (
          <option key={e.userId} value={e.userId}>
            {e.userFullName ?? e.userEmail ?? e.userId}
          </option>
        ))}
      </Select>

      <Select
        value={filters.niche ?? ""}
        onChange={(e) => onChange({ niche: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("filterBar.allNiches")}</option>
        {nicheOptions.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={filters.risk ?? false}
          onChange={(e) => onChange({ risk: e.target.checked || undefined })}
          className="h-4 w-4 rounded border-border"
        />
        {t("filterBar.riskOnly")}
      </label>

      {hasAnyFilter(filters) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("filterBar.clearFilter")}
        </Button>
      )}
    </div>
  );
}
