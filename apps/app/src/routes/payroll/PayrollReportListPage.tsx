import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileSpreadsheet, Star } from "lucide-react";
import type { PayrollReportCode } from "@mediaos/contracts";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, Card, EmptyState, PageHeader, Skeleton, useLocalPref } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS } from "./constants";
import { orderByFavorites, sanitizeFavorites, toggleFavorite } from "./report-view";

export const REPORT_FAVORITES_PREF_KEY = "payroll.reports.favorites";

/**
 * PAY-SCREEN-016 «Báo cáo» — danh mục (`/payroll/reports`, S15-PAYROLL-FE-4).
 *
 * Danh sách dựng từ 080, KHÔNG hard-code 7 mã: server chỉ trả báo cáo caller MỞ ĐƯỢC (owner O-2 — báo cáo lộ
 * tiền theo người đòi thêm cặp nguồn). 080 là metadata, không audit ⇒ gọi thoải mái khi đủ cổng.
 * Yêu thích lưu localStorage của trình duyệt (tiện nghi cá nhân, không phải dữ liệu nghiệp vụ).
 */
export function PayrollReportListPage({
  onOpenReport,
}: {
  onOpenReport: (code: PayrollReportCode) => void;
}) {
  const { t } = useTranslation("payroll");
  const P = PAYROLL_ENGINE_PAIRS;
  const canView = useCanExact(P.reportList.action, P.reportList.resourceType);
  const [rawFavorites, setFavorites] = useLocalPref<unknown>(REPORT_FAVORITES_PREF_KEY, []);
  const favorites = useMemo(() => sanitizeFavorites(rawFavorites), [rawFavorites]);

  const query = useQuery({
    queryKey: payrollKeys.reports.catalog(),
    queryFn: () => payrollApi.listReports(),
    enabled: canView,
  });

  const items = useMemo(
    () => orderByFavorites(query.data ?? [], favorites),
    [query.data, favorites],
  );

  if (!canView) return <EmptyState title={t("overview.noPermission")} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t("reports.title")} description={t("reports.description")} />
      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={t("reports.empty")} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((item) => {
            const isFavorite = favorites.includes(item.code);
            const favLabel = isFavorite ? t("reports.unfavorite") : t("reports.favorite");
            return (
              <li key={item.code}>
                <Card className="flex h-full items-start gap-3 p-4">
                  <button
                    type="button"
                    aria-pressed={isFavorite}
                    aria-label={favLabel}
                    title={favLabel}
                    onClick={() => setFavorites(toggleFavorite(favorites, item.code))}
                    className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent"
                  >
                    <Star
                      className={`size-4 ${isFavorite ? "fill-warning text-warning" : ""}`}
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenReport(item.code)}
                    className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block font-medium text-foreground">
                        {t(`reports.names.${item.code}`)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t(`reports.descriptions.${item.code}`)}
                      </span>
                      {item.exportable && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <FileSpreadsheet className="size-3.5" aria-hidden />
                          {t("reports.exportable")}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
