/**
 * S16-SOCIAL-FE-2B — `SOC-SCREEN-006` danh sách nhóm (`/feed/groups`, SOCIAL-API-030; plan D6).
 *
 * Bộ lọc sống trong URL (`membership` · `q` · `page`, xem `group-route-search.ts`) — widget «Nhóm của
 * tôi» ở rail link thẳng tới `?membership=mine`. `030` KHÔNG BAO GIỜ liệt kê nhóm kín mình không có
 * hàng (trừ `manage:feed-group`), nên màn này không phải cửa dò nhóm kín.
 *
 * Ba câu rỗng khác nhau (tất cả · của tôi · tìm kiếm) — nói sai lý do là đẩy người dùng đi sửa nhầm.
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button, Input, cn } from "@mediaos/ui";
import { PermissionGate, socialGroupsApi, socialKeys, useCan } from "@mediaos/web-core";
import { OffsetPager } from "../feed/components/OffsetPager";
import { CreateGroupDialog } from "./components/CreateGroupDialog";
import { GroupListRow } from "./components/GroupListRow";
import type { GroupsMembership, GroupsRouteSearch } from "./lib/group-route-search";

export const GROUPS_PAGE_SIZE = 20;
const TABS: readonly GroupsMembership[] = ["all", "mine"];

export function GroupsPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as GroupsRouteSearch;
  const canManage = useCan("manage", "feed-group");
  const [createOpen, setCreateOpen] = React.useState(false);

  const membership: GroupsMembership = search.membership ?? "all";
  const page = search.page ?? 1;
  const q = search.q;
  const [draftQ, setDraftQ] = React.useState(q ?? "");
  // URL đổi từ ngoài (back/forward, link rail) ⇒ ô tìm theo URL.
  React.useEffect(() => setDraftQ(q ?? ""), [q]);

  const params = { membership, page, limit: GROUPS_PAGE_SIZE, ...(q ? { q } : {}) };
  const query = useQuery({
    queryKey: socialKeys.groups.list(params),
    queryFn: () => socialGroupsApi.list(params),
    placeholderData: keepPreviousData,
  });

  const go = (next: GroupsRouteSearch): void => {
    void navigate({
      to: "/feed/groups",
      search: {
        ...(next.membership && next.membership !== "all" ? { membership: next.membership } : {}),
        ...(next.q ? { q: next.q } : {}),
        ...(next.page && next.page > 1 ? { page: next.page } : {}),
      },
    });
  };

  const emptyText = q
    ? t("groups.list.emptySearch", { q })
    : membership === "mine"
      ? t("groups.list.emptyMine")
      : t("groups.list.emptyAll");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("groups.list.title")}</h1>
        <PermissionGate action="create" resourceType="feed-group">
          <Button size="sm" data-testid="groups-create" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("groups.list.create")}
          </Button>
        </PermissionGate>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("groups.list.tabsAria")} className="flex gap-2">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`groups-tab-${value}`}
              aria-pressed={membership === value}
              onClick={() => go({ membership: value, q })}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                membership === value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {value === "all" ? t("groups.list.tabAll") : t("groups.list.tabMine")}
            </button>
          ))}
        </div>
        <form
          role="search"
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // Trim ở đây: `q` chỉ khoảng trắng ⇒ server `min(1)` sau trim trả 400 (`buildQueryString` chỉ bỏ "").
            go({ membership, q: draftQ.trim() || undefined });
          }}
        >
          <Input
            aria-label={t("groups.list.searchLabel")}
            data-testid="groups-search"
            placeholder={t("groups.list.searchPlaceholder")}
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            className="h-8 w-48"
          />
          <Button type="submit" size="sm" variant="outline" data-testid="groups-search-submit">
            {t("groups.list.searchSubmit")}
          </Button>
        </form>
      </div>

      {query.isLoading ? (
        <div
          role="status"
          aria-label={t("groups.list.loadingAria")}
          className="flex flex-col gap-2"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div
          role="alert"
          data-testid="groups-error"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          <p className="font-medium text-foreground">{t("groups.list.errorTitle")}</p>
          <p className="text-muted-foreground">{t("state.errorBody")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      ) : query.data.data.length === 0 ? (
        <p
          data-testid="groups-empty"
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {emptyText}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="groups-list">
            {query.data.data.map((group) => (
              <GroupListRow key={group.id} group={group} canManage={canManage} />
            ))}
          </ul>
          <OffsetPager
            page={query.data.page}
            limit={query.data.limit}
            total={query.data.total}
            onPageChange={(p) => go({ membership, q, page: p })}
            disabled={query.isFetching}
          />
        </>
      )}

      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
