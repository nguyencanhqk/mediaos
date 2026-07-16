/**
 * MeNotificationsPage — ME-SCREEN-012 "Thông báo của tôi" (SPEC-09 §8.1/§8.2, route "/me/notifications").
 *
 * TÁI DÙNG `myNotificationApi.list` (own-scope THUẬT — server khoá cứng recipient theo token, client
 * KHÔNG truyền user_id) cho danh sách gần đây + `meApi.getNotificationSummary` (section-envelope riêng,
 * §13) cho số chưa đọc. Deep-link "Xem tất cả" sang `/notifications` (trang quản lý đầy đủ) — route đích
 * TỰ gate lại (mirror MeQuickActions).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Bell, RefreshCw } from "lucide-react";
import { meApi, meKeys, myNotificationApi, notificationKeys, useCan } from "@mediaos/web-core";
import {
  EmptyState,
  Button,
  Skeleton,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@mediaos/ui";
import { MeSectionCard } from "./components/MeSectionCard";
import { NotificationSectionContent } from "./components/MeSectionContents";
import { MeDeepLinkButtons } from "./components/MeDeepLinkButtons";
import { ME_ACCESS_PAIR, ME_NOTIFICATIONS_PREVIEW_LIMIT, ME_QUICK_ACTION_PATHS } from "./constants";

/** Danh sách preview gần đây — độc lập query với summary (1 nguồn lỗi KHÔNG phá phần còn lại, §18.2). */
function RecentNotificationsCard() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const listQuery = useQuery({
    queryKey: notificationKeys.list({ per_page: ME_NOTIFICATIONS_PREVIEW_LIMIT }),
    queryFn: () => myNotificationApi.list({ per_page: ME_NOTIFICATIONS_PREVIEW_LIMIT }),
    staleTime: 15_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          {t("notificationsPage.recentTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {listQuery.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {!listQuery.isLoading && listQuery.isError && (
          <EmptyState
            title={t("notificationsPage.list.error.title")}
            description={t("notificationsPage.list.error.description")}
            className="py-4"
            action={
              <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        )}
        {!listQuery.isLoading && !listQuery.isError && (listQuery.data ?? []).length === 0 && (
          <EmptyState title={t("notificationsPage.list.empty")} className="py-4" />
        )}
        {!listQuery.isLoading && !listQuery.isError && (listQuery.data?.length ?? 0) > 0 && (
          <ul className="space-y-3">
            {(listQuery.data ?? []).map((item) => (
              <li key={item.notification_id} className="space-y-0.5 text-sm">
                <p className={item.is_read ? "text-foreground" : "font-semibold text-foreground"}>
                  {item.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{item.short_content}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MeNotificationsPageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const summaryQuery = useQuery({
    queryKey: meKeys.notificationSummary(),
    queryFn: meApi.getNotificationSummary,
    staleTime: 30_000,
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full max-w-xl rounded-xl" />
      </div>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("notificationsPage.error.title")}
          description={t("notificationsPage.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void summaryQuery.refetch()}>
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
        title={t("notificationsPage.title")}
        description={t("notificationsPage.description")}
        icon={Bell}
      />

      <MeSectionCard
        title={t("notification.title")}
        icon={Bell}
        isPageLoading={false}
        section={summaryQuery.data}
        onRetry={() => void summaryQuery.refetch()}
        isEmpty={(d) => d.unreadCount === 0}
        emptyTitle={t("notification.empty")}
        className="max-w-xl"
      >
        {(d) => <NotificationSectionContent data={d} />}
      </MeSectionCard>

      <RecentNotificationsCard />

      <MeDeepLinkButtons
        title={t("notificationsPage.linksTitle")}
        actions={[
          {
            key: "view-all",
            label: t("notificationsPage.viewAll"),
            icon: Bell,
            path: ME_QUICK_ACTION_PATHS.NOTIFICATIONS,
          },
        ]}
      />
    </div>
  );
}

export function MeNotificationsPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeNotificationsPageInner />;
}
