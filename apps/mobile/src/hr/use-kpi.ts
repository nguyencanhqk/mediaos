import { useQuery } from "@tanstack/react-query";
import { kpiApi } from "../api/kpi-api";
import { currentMonthRange } from "./hr-format";

/** Query keys for KPI personal read. */
export const KPI_DEFINITIONS_KEY = ["kpi", "definitions"] as const;
export const ownKpiKey = (definitionId: string, userId: string, month: string) =>
  ["kpi", "own", definitionId, userId, month] as const;

/** GET /kpi/definitions — active KPI definitions (to choose which KPI to view). */
export function useKpiDefinitions() {
  return useQuery({ queryKey: KPI_DEFINITIONS_KEY, queryFn: kpiApi.listDefinitions });
}

/**
 * Compute the caller's OWN KPI snapshot for a definition over the current month. Enabled only when a
 * definition + user id are known. The KPI result is reference-only (BR-007) and carries no money, so
 * caching it is safe. A 403 (employee lacks read:kpi) surfaces as isError → generic permission message.
 */
export function useOwnKpi(definitionId: string | undefined, userId: string | undefined) {
  const { periodStart, periodEnd } = currentMonthRange();
  const monthKey = periodStart.slice(0, 7);
  return useQuery({
    queryKey: ownKpiKey(definitionId ?? "", userId ?? "", monthKey),
    enabled: Boolean(definitionId) && Boolean(userId),
    queryFn: () =>
      kpiApi.compute({
        definitionId: definitionId as string,
        subjectUserId: userId as string,
        periodStart,
        periodEnd,
      }),
  });
}
