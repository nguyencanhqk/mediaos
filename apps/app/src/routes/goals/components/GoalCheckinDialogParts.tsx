import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { goalApi, goalKeys } from "@mediaos/web-core";
import type { GoalCoreResponseDto, GoalUpdateResponseDto } from "@mediaos/contracts";
import { cn } from "@mediaos/ui";
import {
  GOAL_CONFIDENCE_LEVEL_KEYS,
  confidenceLevelOf,
  type GoalConfidenceLevel,
} from "../constants";
import { formatProgress } from "../goal-format";

/** Chỉ dòng mới nhất của sổ — đủ cho chú thích «Lần trước». */
const LAST_UPDATE_PARAMS = { limit: 1 } as const;

export function FieldBlock({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * S20-GOAL-QUICKCHECKIN-1 — độ tự tin một chạm: 3 nút bật/tắt (`aria-pressed`), bấm lại nút đang chọn
 * ⇒ bỏ chọn. Mặc định KHÔNG chọn — phía gọi không gửi `confidence` khi `value === null`.
 */
export function ConfidencePicker({
  value,
  onChange,
  disabled,
}: {
  value: GoalConfidenceLevel | null;
  onChange: (next: GoalConfidenceLevel | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("goals");
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-xs font-medium text-muted-foreground">
        {t("checkinDialog.fields.confidence")}
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {GOAL_CONFIDENCE_LEVEL_KEYS.map((level) => {
          const pressed = value === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              data-testid={`goal-checkin-confidence-${level}`}
              onClick={() => onChange(pressed ? null : level)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50",
                pressed
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted",
              )}
            >
              {t(`checkinDialog.confidenceLevels.${level}`)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("checkinDialog.hints.confidenceOptional")}</p>
    </div>
  );
}

function formatMeasure(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  if (!unit) return String(value);
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

function useLastValueText(goal: GoalCoreResponseDto, last: GoalUpdateResponseDto): string {
  const { t } = useTranslation("goals");
  if (goal.progressMode !== "manual") {
    return t("checkinDialog.last.progress", { value: formatProgress(last.newProgressPercent) });
  }
  if (goal.measureType === "boolean") {
    const value =
      last.newCurrentValue === null
        ? "—"
        : last.newCurrentValue > 0
          ? t("checkinDialog.last.achieved")
          : t("checkinDialog.last.notAchieved");
    return t("checkinDialog.last.simple", { value });
  }
  return t("checkinDialog.last.value", {
    value: formatMeasure(last.newCurrentValue, goal.unit),
    target: formatMeasure(goal.targetValue, goal.unit),
  });
}

/**
 * «Lần trước» — đọc `GET /goals/:id/updates?limit=1` (dòng mới nhất của sổ chỉ-thêm). CHỈ là chú thích:
 * lỗi ⇒ «Lần trước: —» và hộp vẫn check-in được bình thường (không retry — chú thích không đáng giữ
 * người dùng chờ). Mức tự tin lần trước chỉ được KỂ ra, không chọn sẵn.
 */
export function LastCheckinHint({ goal }: { goal: GoalCoreResponseDto }) {
  const { t } = useTranslation("goals");
  const { data, isLoading, isError } = useQuery({
    queryKey: goalKeys.updates(goal.id, LAST_UPDATE_PARAMS),
    queryFn: () => goalApi.listUpdates(goal.id, LAST_UPDATE_PARAMS),
    retry: false,
  });

  const last = data?.[0];
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground" data-testid="goal-checkin-last">
      {isLoading ? (
        <p>{t("checkinDialog.last.loading")}</p>
      ) : isError || !data ? (
        <p>{t("checkinDialog.last.unknown")}</p>
      ) : !last ? (
        <p>{t("checkinDialog.last.none")}</p>
      ) : (
        <LastCheckinLines goal={goal} last={last} />
      )}
    </div>
  );
}

function LastCheckinLines({
  goal,
  last,
}: {
  goal: GoalCoreResponseDto;
  last: GoalUpdateResponseDto;
}) {
  const { t } = useTranslation("goals");
  const valueText = useLastValueText(goal, last);
  return (
    <>
      <p>{valueText}</p>
      {last.confidence !== null && (
        <p>
          {t("checkinDialog.last.confidence", {
            level: t(`checkinDialog.confidenceLevels.${confidenceLevelOf(last.confidence)}`),
          })}
        </p>
      )}
    </>
  );
}
