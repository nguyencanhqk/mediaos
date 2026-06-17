import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import type { KpiResultDto } from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  KPI_COMPONENT_KEYS,
  KPI_TIER_BAR,
  KPI_TIER_VARIANT,
  clampPercent,
  componentLabel,
  formatScore,
  isConfirmed,
  kpiScoreTier,
} from "@/lib/kpi-format";

interface KpiGoalTreeProps {
  result: KpiResultDto;
  /** Tên định nghĩa KPI để hiển thị làm tiêu đề cây mục tiêu. */
  definitionName: string;
}

/**
 * Cây mục tiêu KPI: mục tiêu gốc (điểm tổng có trọng số) → 5 mục tiêu con (5 thành phần),
 * mỗi mục tiêu hiển thị tiến độ % (thanh) + bậc xếp loại. RENDER ĐÚNG dữ liệu server trả
 * (BẤT BIẾN #2: kpi_results append-only, không tự suy diễn thêm).
 */
export function KpiGoalTree({ result, definitionName }: KpiGoalTreeProps) {
  const { t } = useTranslation("kpi");
  const totalTier = kpiScoreTier(result.totalScore);
  const confirmed = isConfirmed(result.confirmedAt);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
            <Target className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div>
            <p className="font-semibold text-foreground">{definitionName}</p>
            <p className="text-xs text-muted-foreground">
              {t("result.period", {
                start: formatDate(result.periodStart),
                end: formatDate(result.periodEnd),
              })}
            </p>
          </div>
        </div>
        <Badge variant={confirmed ? "brand" : "muted"}>
          {confirmed ? t("status.confirmed") : t("status.reference")}
        </Badge>
      </div>

      {/* Mục tiêu gốc — điểm tổng */}
      <div className="mt-5">
        <GoalRow
          label={t("result.totalScore")}
          score={result.totalScore}
          variant={KPI_TIER_VARIANT[totalTier]}
          barClass={KPI_TIER_BAR[totalTier]}
          emphasized
        />
      </div>

      {/* 5 mục tiêu con — thành phần KPI */}
      <ul className="mt-4 space-y-3 border-l-2 border-border pl-4">
        {KPI_COMPONENT_KEYS.map((key) => {
          const score = result.components[key];
          const tier = kpiScoreTier(score);
          return (
            <li key={key}>
              <GoalRow
                label={componentLabel(key, t)}
                score={score}
                variant={KPI_TIER_VARIANT[tier]}
                barClass={KPI_TIER_BAR[tier]}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface GoalRowProps {
  label: string;
  score: number;
  variant: Parameters<typeof Badge>[0]["variant"];
  barClass: string;
  emphasized?: boolean;
}

function GoalRow({ label, score, variant, barClass, emphasized }: GoalRowProps) {
  const pct = clampPercent(score);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "text-sm",
            emphasized ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <Badge variant={variant} className="tabular-nums">
          {formatScore(score)}
        </Badge>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-all", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN");
}
