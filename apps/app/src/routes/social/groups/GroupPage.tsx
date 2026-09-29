/**
 * S16-SOCIAL-FE-2B — `SOC-SCREEN-006` trang nhóm (`/feed/groups/$groupId`; plan D8 + §8 H2).
 *
 * ┌─ 🔴 404 LẤY TỪ `032`, KHÔNG từ feed ────────────────────────────────────────────────────────────┐
 * │ `001 ?groupId=<nhóm kín>` trả 200 RỖNG với người ngoài — feed không phân biệt «kín» với «rỗng». │
 * │ `032` mới trả 404 ERR-012 (không tồn tại · đã xoá · kín mà bạn không thuộc — CÙNG một câu trả   │
 * │ lời). ⇒ Chỉ `ApiError` 404 là «không tìm thấy»; lỗi khác (kể cả ZodError khi HTTP 200) là khối  │
 * │ lỗi + «Thử lại». Màn «không có quyền» (`ForbiddenPage`) KHÔNG BAO GIỜ xuất hiện ở đây.          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 `key={groupId}` (plan §8 H2): TanStack Router KHÔNG remount component khi chỉ `params` đổi. Không
 * có key thì đi từ nhóm A sang B (rail, danh sách, Back) GIỮ NGUYÊN nháp ô soạn / form cài đặt của A —
 * bài viết đăng NHẦM vào B, PATCH nhầm B bằng giá trị của A.
 *
 * Tab sống trong URL (`?tab`); tab không đủ năng lực (vd link cũ `?tab=settings` sau khi bị hạ vai)
 * rơi về «Bài viết» thay vì một màn 403.
 */
import * as React from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@mediaos/ui";
import { ApiError, socialGroupsApi, socialKeys, useCan } from "@mediaos/web-core";
import { GroupHeader } from "./components/GroupHeader";
import { GroupMembersTab } from "./components/GroupMembersTab";
import { GroupNotFound } from "./components/GroupNotFound";
import { GroupPostsTab } from "./components/GroupPostsTab";
import { GroupRequestsTab } from "./components/GroupRequestsTab";
import { GroupSettingsTab } from "./components/GroupSettingsTab";
import { groupCapabilities, type GroupCapabilities } from "./lib/group-capabilities";
import { isGroupId, type GroupDetailRouteSearch, type GroupTab } from "./lib/group-route-search";
import { useInviteRequest } from "./lib/use-invite-request";

/** Query `032` đang là 404 ĐÃ BIẾT (không có dữ liệu) — kéo lại không nói thêm gì. */
function isKnownNotFound(query: { state: { error: unknown; data: unknown } }): boolean {
  return (
    query.state.data === undefined &&
    query.state.error instanceof ApiError &&
    query.state.error.status === 404
  );
}

export function GroupPage(): React.ReactElement {
  const { groupId } = useParams({ strict: false }) as { groupId?: string };
  const search = useSearch({ strict: false }) as GroupDetailRouteSearch;
  const invite = search.invite === true;

  // Không phải UUID ⇒ `032` trả 400 (ParseUUIDPipe) chứ không 404 — màn 404 NGAY, không gọi API, không nút mời.
  if (!isGroupId(groupId)) return <GroupNotFound />;
  return <GroupPageBody key={groupId} groupId={groupId} tab={search.tab} invite={invite} />;
}

interface GroupPageBodyProps {
  groupId: string;
  tab: GroupTab | undefined;
  invite: boolean;
}

function availableTabs(caps: GroupCapabilities): GroupTab[] {
  return [
    "posts",
    ...(caps.canListMembers ? (["members"] as const) : []),
    ...(caps.canModerate ? (["requests"] as const) : []),
    ...(caps.canEdit ? (["settings"] as const) : []),
  ];
}

function GroupPageBody({ groupId, tab, invite }: GroupPageBodyProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const canManage = useCan("manage", "feed-group");
  // Ở ĐÂY chứ không trong `GroupNotFound`: query 404 không có `data` ⇒ mỗi lượt refetch TanStack v5 đặt
  // lại `status:'pending'` ⇒ `GroupNotFound` unmount ⇒ «đã gửi»/lý do lỗi mất (gate LIGHT HIGH-1).
  const inviteRequest = useInviteRequest(groupId);

  const groupQuery = useQuery({
    queryKey: socialKeys.groups.detail(groupId),
    queryFn: () => socialGroupsApi.get(groupId),
    // 404 là CÂU TRẢ LỜI, không phải sự cố — thử lại chỉ làm màn «không tìm thấy» hiện chậm.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    // …và cũng không kéo lại khi quay lại tab / có mạng lại: màn 404 sẽ nháy skeleton vô ích.
    refetchOnWindowFocus: (query) => !isKnownNotFound(query),
    refetchOnReconnect: (query) => !isKnownNotFound(query),
  });

  if (groupQuery.isLoading) {
    return (
      <div role="status" aria-label={t("groups.page.loadingAria")} className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (groupQuery.error instanceof ApiError && groupQuery.error.status === 404) {
    return <GroupNotFound invite={invite ? inviteRequest : null} />;
  }

  // CHỈ khi CHƯA có dữ liệu. Có dữ liệu mà lượt refetch nền hỏng (5xx/timeout sau khi mutation
  // invalidate) ⇒ GIỮ trang + cảnh báo nhỏ bên dưới: thay cả trang bằng khối lỗi là unmount ô soạn
  // và form cài đặt — mất nháp của người dùng vì một lượt tải lại phụ (gate LIGHT MEDIUM-1).
  if (!groupQuery.data) {
    return (
      <div role="alert" data-testid="group-error" className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="font-medium text-foreground">{t("groups.page.errorTitle")}</p>
        <p className="text-muted-foreground">{t("state.errorBody")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void groupQuery.refetch()}>
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  const group = groupQuery.data;
  const caps = groupCapabilities(group, canManage);
  const tabs = availableTabs(caps);
  const activeTab: GroupTab = tab && tabs.includes(tab) ? tab : "posts";
  const tabLabel: Record<GroupTab, string> = {
    posts: t("groups.page.tabPosts"),
    members: t("groups.page.tabMembers"),
    requests: t("groups.page.tabRequests"),
    settings: t("groups.page.tabSettings"),
  };

  return (
    <div className="flex flex-col gap-4" data-testid="group-page">
      {groupQuery.isError && (
        <div
          role="alert"
          data-testid="group-refresh-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          <span>{t("groups.page.refreshError")}</span>
          <Button size="sm" variant="outline" onClick={() => void groupQuery.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      )}
      <GroupHeader group={group} caps={caps} canManage={canManage} />

      {tabs.length > 1 && (
        <div role="group" aria-label={t("groups.page.tabsAria")} className="flex flex-wrap gap-2">
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`group-tab-${value}`}
              aria-pressed={activeTab === value}
              onClick={() =>
                void navigate({
                  to: "/feed/groups/$groupId",
                  params: { groupId },
                  search: value === "posts" ? {} : { tab: value },
                })
              }
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeTab === value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {tabLabel[value]}
            </button>
          ))}
        </div>
      )}

      {activeTab === "posts" && <GroupPostsTab group={group} caps={caps} />}
      {activeTab === "members" && <GroupMembersTab groupId={groupId} caps={caps} />}
      {activeTab === "requests" && <GroupRequestsTab groupId={groupId} />}
      {activeTab === "settings" && <GroupSettingsTab group={group} caps={caps} />}
    </div>
  );
}
