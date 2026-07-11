import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { hrApi, hrKeys } from "@mediaos/web-core";
import { Card, CardContent, DonutChart, Skeleton, StatCard } from "@mediaos/ui";

/**
 * HR-PROFILE-UI-1 — dải tổng quan đầu trang Hồ sơ: headcount đang làm việc, donut giới tính
 * (chỉ hiện khi server trả byGender — tức caller có view-sensitive), 4 thẻ loại nhân sự.
 * Số liệu đã lọc theo data-scope ở SERVER (GET /hr/employees/summary).
 */

const GENDER_COLORS: Record<string, string> = {
  Male: "#10b981",
  Female: "#f43f5e",
  Other: "#6366f1",
  unknown: "#94a3b8",
};

export function EmployeeOverviewStrip() {
  const { t } = useTranslation("hr");
  const { data, isLoading, isError } = useQuery({
    queryKey: hrKeys.employees.summary(),
    queryFn: () => hrApi.getEmployeeSummary(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">{t("employees.overview.error")}</p>;
  }

  const working = data.byStatus["active"] ?? 0;
  const byType = data.byEmploymentType;
  const probation = byType["probation"] ?? 0;
  const official = byType["full_time"] ?? 0;
  const partTime = byType["part_time"] ?? 0;
  const other = Object.entries(byType)
    .filter(([key]) => !["probation", "full_time", "part_time"].includes(key))
    .reduce((sum, [, count]) => sum + count, 0);

  // byGender null = server mask (thiếu view-sensitive) → ẩn hẳn khối donut, không render 0 giả.
  const genderSegments = data.byGender
    ? Object.entries(data.byGender)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => ({
          label: t(`employees.gender.${key}`, { defaultValue: key }),
          value: count,
          color: GENDER_COLORS[key] ?? GENDER_COLORS["unknown"]!,
        }))
    : null;

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="xl:col-span-3">
        <CardContent className="flex h-full flex-col justify-center gap-1 pt-5">
          <span className="text-sm font-medium text-muted-foreground">
            {t("employees.overview.working")}
          </span>
          <span className="text-4xl font-bold text-brand tabular-nums">{working}</span>
        </CardContent>
      </Card>

      {genderSegments && (
        <Card className="xl:col-span-4">
          <CardContent className="flex items-center gap-6 pt-5">
            <DonutChart segments={genderSegments} size={104} thickness={16} />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-muted-foreground">
                {t("employees.overview.genderTitle")}
              </p>
              {genderSegments.map((s) => (
                <p key={s.label} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-semibold tabular-nums">{s.value}</span>
                  <span className="text-muted-foreground">{s.label}</span>
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div
        className={`grid grid-cols-2 gap-4 sm:grid-cols-4 ${genderSegments ? "xl:col-span-5" : "xl:col-span-9"}`}
      >
        <StatCard
          tone="emerald"
          label={t("employees.overview.cards.probation")}
          value={probation}
        />
        <StatCard tone="cyan" label={t("employees.overview.cards.official")} value={official} />
        <StatCard tone="blue" label={t("employees.overview.cards.partTime")} value={partTime} />
        <StatCard tone="amber" label={t("employees.overview.cards.other")} value={other} />
      </div>
    </div>
  );
}
