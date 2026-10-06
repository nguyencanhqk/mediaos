/**
 * S16-SOCIAL-FE-3B (L5) — thanh bộ lọc của màn Thống kê tương tác (`SOC-SCREEN-011`, plan D12).
 *
 * Chỉ TRÌNH BÀY + phát Ý ĐỊNH — không state, không lời gọi, không đụng URL:
 *  · Nhãn khoảng và số tuần lấy từ `range` SERVER trả (không từ URL: server mới là nơi nắn về tuần ISO).
 *  · ‹ › dịch đúng `range.weeks` tuần; ô «Số tuần» đổi độ dài, GIỮ ngày kết thúc. Khoảng kế tiếp tính bằng số
 *    học chuỗi ở `lib/stats-range.ts`; khoảng trùng mặc định của server được phát thành `null` (không ghi URL).
 *  · › khoá khi khoảng đang kết thúc ở tuần hiện tại theo GIỜ CÔNG TY; «Về hiện tại» khoá khi đang ở mặc định.
 *  · Ô đơn vị dựng option NGAY TRONG render từ `units` của response (plan B9: không nạp option qua effect —
 *    `fireEvent.change` / người dùng nhanh tay sẽ đua với lượt nạp). `units` cũng là tập `orgUnitId` hợp lệ
 *    DUY NHẤT của 052: chọn ngoài tập đó là 403.
 *
 * Trang (L5b) sở hữu URL: nhận `onRangeChange` / `onOrgUnitChange` rồi `navigate` bằng `searchForRange` /
 * `searchForOrgUnit`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@mediaos/ui";
import type { FeedEngagementUnitDto } from "@mediaos/contracts";
import {
  STATS_WEEK_OPTIONS,
  asUrlRange,
  canShiftForward,
  formatStatsDate,
  rangeForWeeks,
  shiftRange,
  type StatsRange,
} from "../lib/stats-range";
import type { StatsDateRange } from "../lib/stats-route-search";
import { useUnitName } from "../lib/use-stats-labels";

export interface StatsFiltersProps {
  /** `range` của response 052 đang hiển thị. */
  range: StatsRange;
  /** `units` của response 052 — nguồn DUY NHẤT của ô đơn vị. */
  units: readonly FeedEngagementUnitDto[];
  /** Đơn vị đang lọc (từ URL); `undefined` = tất cả. */
  orgUnitId: string | undefined;
  /** URL đang mang `from` / `to` ⇒ «Về hiện tại» mở. */
  isCustomRange: boolean;
  /** `null` = về mặc định của server (bỏ `from` + `to`). */
  onRangeChange: (range: StatsDateRange | null) => void;
  onOrgUnitChange: (orgUnitId: string | undefined) => void;
}

const ALL_UNITS = "";

const SELECT_CLASS =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Bốn lựa chọn chuẩn + số tuần đang xem nếu nó nằm ngoài (URL sửa tay), xếp tăng dần. */
function weekOptionsFor(weeks: number): number[] {
  const all = STATS_WEEK_OPTIONS.includes(weeks)
    ? STATS_WEEK_OPTIONS
    : [...STATS_WEEK_OPTIONS, weeks];
  return [...all].sort((a, b) => a - b);
}

interface LabeledSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

/** `<select>` thuần có `<label>` gắn bằng `htmlFor` — tên trợ năng của ô là chính chữ nhãn. */
function LabeledSelect({
  label,
  value,
  onChange,
  children,
}: LabeledSelectProps): React.ReactElement {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT_CLASS}
      >
        {children}
      </select>
    </div>
  );
}

interface RangeStepperProps {
  range: StatsRange;
  /** Khoảng của nút ‹ / › ; `null` = nút khoá. */
  back: StatsDateRange | null;
  forward: StatsDateRange | null;
  isCustomRange: boolean;
  onStep: (range: StatsDateRange) => void;
  onReset: () => void;
}

/** ‹ nhãn khoảng › + «Về hiện tại». Hai nút mũi tên mang tên trợ năng có số tuần sẽ dịch. */
function RangeStepper({
  range,
  back,
  forward,
  isCustomRange,
  onStep,
  onReset,
}: RangeStepperProps): React.ReactElement {
  const { t } = useTranslation("social");
  const step = (target: StatsDateRange | null) => (): void => {
    if (target !== null) onStep(target);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={back === null}
        aria-label={t("admin.stats.filters.back", { weeks: range.weeks })}
        onClick={step(back)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <p className="px-1 text-sm text-foreground">
        <span className="sr-only">{t("admin.stats.filters.rangeLabel")}: </span>
        <span className="font-medium tabular-nums" data-testid="stats-range-label">
          {t("admin.stats.filters.range", {
            from: formatStatsDate(range.from),
            to: formatStatsDate(range.to),
          })}
        </span>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={forward === null}
        aria-label={t("admin.stats.filters.forward", { weeks: range.weeks })}
        onClick={step(forward)}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!isCustomRange} onClick={onReset}>
        {t("admin.stats.filters.reset")}
      </Button>
    </div>
  );
}

export function StatsFilters({
  range,
  units,
  orgUnitId,
  isCustomRange,
  onRangeChange,
  onOrgUnitChange,
}: StatsFiltersProps): React.ReactElement {
  const { t } = useTranslation("social");
  const unitName = useUnitName();

  // Đọc đồng hồ MỘT lần mỗi lượt vẽ: trạng thái khoá của › và khoảng nó phát ra phải cùng một «bây giờ».
  const now = new Date();
  const emit = (next: StatsDateRange): void => {
    onRangeChange(asUrlRange(next, now));
  };
  const handleWeeksChange = (value: string): void => {
    const next = rangeForWeeks(range, Number(value));
    if (next !== null) emit(next);
  };

  return (
    <div
      role="group"
      aria-label={t("admin.stats.filters.aria")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <RangeStepper
        range={range}
        back={shiftRange(range, "back", now)}
        forward={canShiftForward(range, now) ? shiftRange(range, "forward", now) : null}
        isCustomRange={isCustomRange}
        onStep={emit}
        onReset={() => onRangeChange(null)}
      />
      <LabeledSelect
        label={t("admin.stats.filters.weeksLabel")}
        value={String(range.weeks)}
        onChange={handleWeeksChange}
      >
        {weekOptionsFor(range.weeks).map((weeks) => (
          <option key={weeks} value={String(weeks)}>
            {t("admin.stats.filters.weeksOption", { weeks })}
          </option>
        ))}
      </LabeledSelect>
      <LabeledSelect
        label={t("admin.stats.filters.unitLabel")}
        value={orgUnitId ?? ALL_UNITS}
        onChange={(value) => onOrgUnitChange(value === ALL_UNITS ? undefined : value)}
      >
        <option value={ALL_UNITS}>{t("admin.stats.filters.allUnits")}</option>
        {units.map((unit) => (
          <option key={unit.orgUnitId} value={unit.orgUnitId}>
            {unitName(unit)}
          </option>
        ))}
      </LabeledSelect>
    </div>
  );
}
