import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { KpiDefinitionDto } from "@mediaos/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { kpiApi } from "@/lib/kpi-api";
import { orgApi } from "@/lib/org-api";
import { useCan } from "@/hooks/use-can";
import { KPI_COMPONENT_KEYS, componentLabel, formatScore } from "@/lib/kpi-format";
import { KpiComputePanel } from "./kpi-compute-panel";
import { KpiHistory } from "./kpi-history";

/** Trần số bản ghi lịch sử KPI tải cho trang (server cũng giới hạn max 200). */
const KPI_HISTORY_LIMIT = 100;

/**
 * KPI / Mục tiêu (G8-4). 2 vùng:
 *  1. Danh sách ĐỊNH NGHĨA KPI (công thức trọng số 5 thành phần) — GET /kpi/definitions.
 *  2. Tính & xác nhận KPI theo phòng ban/nhân viên → CÂY MỤC TIÊU + tiến độ % (gated read/confirm:kpi).
 *
 * Mask mặc định: chỉ render dữ liệu server trả. Lịch sử kpi_results CHƯA có GET list ở BE → tiến độ
 * lấy theo từng lần compute (xem báo cáo lane).
 */
export function KpiPage() {
  const { t } = useTranslation("kpi");
  const [query, setQuery] = useState("");
  const canRead = useCan("read", "kpi");

  const {
    data: definitions = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["kpi", "definitions"],
    queryFn: () => kpiApi.listDefinitions(),
  });

  // Lịch sử KPI (read:kpi). Server lọc scope của-mình cho employee — client KHÔNG tự lọc chủ thể.
  const {
    data: results = [],
    isLoading: resultsLoading,
    isError: resultsError,
  } = useQuery({
    queryKey: ["kpi", "results"],
    queryFn: () => kpiApi.listResults({ limit: KPI_HISTORY_LIMIT }),
    enabled: canRead,
  });

  // Tên chủ thể (best-effort) — tái dùng query org của compute panel (react-query dedupe theo key).
  const { data: employees = [] } = useQuery({
    queryKey: ["org", "employees"],
    queryFn: orgApi.listEmployees,
    enabled: canRead,
  });
  const { data: teams = [] } = useQuery({
    queryKey: ["org", "teams"],
    queryFn: orgApi.listTeams,
    enabled: canRead,
  });
  const subjectNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of employees) map[u.id] = u.fullName ?? u.email;
    for (const tm of teams) map[tm.id] = tm.name;
    return map;
  }, [employees, teams]);

  const columns = useMemo<ColumnDef<KpiDefinitionDto>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("definition.columns.name"),
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{d.name}</p>
              {d.description && (
                <p className="truncate text-xs text-muted-foreground">{d.description}</p>
              )}
            </div>
          );
        },
      },
      {
        id: "weights",
        header: t("definition.columns.weights"),
        enableGlobalFilter: false,
        cell: ({ row }) => <WeightBreakdown weights={row.original.weights} />,
      },
      {
        accessorKey: "isActive",
        header: t("definition.columns.status"),
        cell: ({ getValue }) => {
          const active = getValue() as boolean;
          return (
            <Badge variant={active ? "success" : "muted"}>
              {active ? t("definition.active") : t("definition.inactive")}
            </Badge>
          );
        },
      },
    ],
    [t],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("title")}
        description={t("summary", { count: definitions.length })}
        icon={Target}
      >
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
      </PageHeader>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("definition.section")}</h2>
        {isError ? (
          <EmptyState
            icon={Target}
            title={t("common:errors.loadFailed")}
            description={t("definition.loadHint")}
          />
        ) : (
          <DataTable
            columns={columns}
            data={definitions}
            isLoading={isLoading}
            globalFilter={query}
            emptyState={
              <EmptyState
                icon={Target}
                title={query ? t("definition.searchEmpty") : t("definition.empty")}
                description={query ? undefined : t("definition.emptyHint")}
              />
            }
          />
        )}
      </section>

      {canRead && (
        <KpiHistory
          results={results}
          isLoading={resultsLoading}
          isError={resultsError}
          subjectNames={subjectNames}
        />
      )}

      <KpiComputePanel definitions={definitions} />
    </div>
  );
}

/** Thanh phân rã trọng số 5 thành phần (tổng = 100) — đọc nhanh công thức KPI. */
function WeightBreakdown({ weights }: { weights: KpiDefinitionDto["weights"] }) {
  const { t } = useTranslation("kpi");
  return (
    <div className="min-w-[180px] space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {KPI_COMPONENT_KEYS.map((key, i) => (
          <span
            key={key}
            className={WEIGHT_BAR_COLORS[i]}
            style={{ width: `${weights[key]}%` }}
            title={`${componentLabel(key, t)}: ${formatScore(weights[key])}%`}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("definition.weightSummary", {
          top: componentLabel(topComponent(weights), t),
          pct: formatScore(weights[topComponent(weights)]),
        })}
      </p>
    </div>
  );
}

const WEIGHT_BAR_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
] as const;

function topComponent(weights: KpiDefinitionDto["weights"]): (typeof KPI_COMPONENT_KEYS)[number] {
  return KPI_COMPONENT_KEYS.reduce((best, key) =>
    weights[key] > weights[best] ? key : best,
  );
}
