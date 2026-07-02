/**
 * HR-SCREEN-ORG-CHART (S2-FE-HR-6) — /hr/org-chart. Sơ đồ tổ chức (cây phòng ban), CHỈ ĐỌC.
 *
 * Nguồn: GET /org/units/tree (org.controller.ts) — BE để READ mở cho mọi user tenant đã đăng nhập
 * (cơ cấu tổ chức KHÔNG nhạy cảm, không PermissionGuard riêng). FE gate hiển thị bằng
 * HR_ENGINE_PAIRS.ORG_CHART_VIEW (= read:department, cặp seed thật mig 0444/0005) — nhất quán với
 * /hr/departments, KHÔNG bịa permission "org-chart" chưa seed.
 *
 * Data-scope (S2-INT-2): endpoint trả TOÀN BỘ org_unit của company (RLS company_id ép qua withTenant) —
 * cơ cấu phòng ban vốn không phải dữ liệu theo Team/Own, nên KHÔNG lọc thêm ở client; nếu server sau
 * này thêm data-scope cho org-chart, FE chỉ cần render đúng field trả về (masking là việc của server).
 *
 * States: loading · error · empty · forbidden.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Network, RefreshCw } from "lucide-react";
import { orgApi, hrKeys, useCan, type OrgTreeNode } from "@mediaos/web-core";
import { Button, EmptyState, PageHeader } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { OrgTreeBranch } from "./OrgTreeBranch";

export function OrgChartPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const canView = useCan(
    HR_ENGINE_PAIRS.ORG_CHART_VIEW.action,
    HR_ENGINE_PAIRS.ORG_CHART_VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery<OrgTreeNode[]>({
    queryKey: hrKeys.orgChart.tree(),
    queryFn: () => orgApi.getTree(),
    enabled: canView,
    staleTime: 30_000,
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Network}
          title={t("orgChart.forbidden.title")}
          description={t("orgChart.forbidden.description")}
          data-testid="org-chart-forbidden"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("orgChart.title")}
        description={t("orgChart.description")}
        icon={Network}
      />

      {isError ? (
        <EmptyState
          icon={Network}
          title={t("orgChart.error.title")}
          description={t("orgChart.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div
          data-testid="org-chart-loading"
          className="animate-pulse rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          {tc("loading")}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Network}
          title={t("orgChart.empty.title")}
          description={t("orgChart.empty.description")}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <ul className="space-y-1" role="tree" aria-label={t("orgChart.title")}>
            {data.map((node) => (
              <OrgTreeBranch key={node.id} node={node} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
