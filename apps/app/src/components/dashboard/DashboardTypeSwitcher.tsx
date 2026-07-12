/**
 * DashboardTypeSwitcher — DASH-SCREEN-001 "chuyển đổi Dashboard type" (SPEC-07 §14.2, S4-FE-DASH-2 P1).
 * GET /dashboard/types trả CHÍNH XÁC tập dashboard_type (Employee/Manager/HR/Admin) mà user hiện tại được
 * phép xem (server gate qua view-{type}:dashboard, DASH_TYPE_PERMISSION_PAIR) — FE KHÔNG tự liệt kê 4 type
 * cứng, chỉ render những gì server trả (BẤT BIẾN #1). Tự ẨN (return null) khi: thiếu read:dashboard, đang
 * loading/lỗi, hoặc user chỉ có ĐÚNG 1 type (không có gì để chuyển).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi, dashboardKeys, useCan } from "@mediaos/web-core";
import type { DashboardTypeValue } from "@mediaos/contracts";
import { DASH_READ_PAIR } from "@/routes/dashboard/constants";

interface DashboardTypeSwitcherProps {
  /** Type đang chọn ở page cha; `null` = dùng is_default do server trả. */
  value: DashboardTypeValue | null;
  onChange: (type: DashboardTypeValue) => void;
}

export function DashboardTypeSwitcher({ value, onChange }: DashboardTypeSwitcherProps) {
  const { t } = useTranslation("dashboard");
  const canView = useCan(DASH_READ_PAIR.action, DASH_READ_PAIR.resourceType);

  const { data, isLoading, isError } = useQuery({
    queryKey: dashboardKeys.types(),
    queryFn: () => dashboardApi.getDashboardTypes(),
    enabled: canView,
    staleTime: 5 * 60_000,
  });

  if (!canView || isLoading || isError || !data || data.length <= 1) return null;

  const defaultType =
    data.find((item) => item.is_default)?.dashboard_type ?? data[0].dashboard_type;
  const active = value ?? defaultType;

  return (
    <div
      role="tablist"
      aria-label={t("typeSwitcher.label")}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {data.map((item) => (
        <button
          key={item.dashboard_type}
          type="button"
          role="tab"
          aria-selected={active === item.dashboard_type}
          onClick={() => onChange(item.dashboard_type)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active === item.dashboard_type
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
