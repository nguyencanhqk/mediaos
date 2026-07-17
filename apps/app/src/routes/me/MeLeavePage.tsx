/**
 * MeLeavePage — ME-SCREEN-010 "Nghỉ phép của tôi" (SPEC-09 §8.1/§8.2, route "/me/leave").
 *
 * Đọc DUY NHẤT `GET /me/leave-summary` (meApi.getLeaveSummary) — section-envelope RIÊNG `{status, data}`
 * (§13), KHÔNG tự tính lại số dư phép (§7.4 "ME KHÔNG tự tính lại"), KHÔNG gọi endpoint bảng LEAVE nguồn
 * trực tiếp (§7.5). Deep-link sang `/leave/me/requests` (đơn nghỉ của tôi) — route đích TỰ gate lại.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, RefreshCw } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import { EmptyState, Button, Skeleton, PageHeader, Badge } from "@mediaos/ui";
import type { MeLeaveSummary } from "@mediaos/contracts";
import { MeSectionCard } from "./components/MeSectionCard";
import { MeDeepLinkButtons } from "./components/MeDeepLinkButtons";
import { ME_ACCESS_PAIR, ME_QUICK_ACTION_PATHS } from "./constants";

/** Bảng rút gọn số dư phép — CHỈ render field server trả (masking là việc của server, §7.4). */
function LeaveBalanceTable({ data }: { data: MeLeaveSummary }) {
  const { t } = useTranslation("me");

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">{t("leavePage.columns.type")}</th>
            <th className="pb-2 text-right font-medium">{t("leavePage.columns.remaining")}</th>
          </tr>
        </thead>
        <tbody>
          {data.balances.map((row) => (
            <tr key={row.leaveTypeCode} className="border-b border-border/60 last:border-0">
              <td className="py-2 text-foreground">{row.leaveTypeName}</td>
              <td className="py-2 text-right font-medium tabular-nums text-foreground">
                {row.remainingDays} {row.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Badge variant={data.pendingRequestCount > 0 ? "warning" : "outline"}>
        {data.pendingRequestCount > 0
          ? t("leave.pendingRequests", { count: data.pendingRequestCount })
          : t("leave.noPendingRequests")}
      </Badge>
    </div>
  );
}

function MeLeavePageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.leaveSummary(),
    queryFn: meApi.getLeaveSummary,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full max-w-xl rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("leavePage.error.title")}
          description={t("leavePage.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("leavePage.title")}
        description={t("leavePage.description")}
        icon={CalendarDays}
      />

      <MeSectionCard
        title={t("leave.title")}
        icon={CalendarDays}
        isPageLoading={false}
        section={data}
        onRetry={() => void refetch()}
        isEmpty={(d) => d.balances.length === 0}
        emptyTitle={t("leave.empty")}
        className="max-w-xl"
      >
        {(d) => <LeaveBalanceTable data={d} />}
      </MeSectionCard>

      <MeDeepLinkButtons
        title={t("leavePage.linksTitle")}
        actions={[
          {
            key: "my-requests",
            label: t("leavePage.myRequests"),
            icon: FileText,
            path: ME_QUICK_ACTION_PATHS.MY_LEAVE_REQUESTS,
          },
        ]}
      />
    </div>
  );
}

export function MeLeavePage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeLeavePageInner />;
}
