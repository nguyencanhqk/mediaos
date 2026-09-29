/**
 * S16-SOCIAL-FE-2B — widget «Nhóm của tôi» ở rail phải (`030 membership=mine`; plan D14).
 *
 * 🔴 KHÔNG badge «bài mới» (done_when #3 · G3): đếm bài mới theo nhóm cần room WS của nhóm, thứ chỉ có
 * sau `S16-SOCIAL-BE-2C` — WS hôm nay chỉ phát bài `audience='company'`. Một con số ở đây sẽ là số
 * bịa. `membership:'mine'` = CHỈ nhóm mình `active` (không gồm yêu cầu đang chờ).
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock, Users } from "lucide-react";
import type { FeedGroupDto } from "@mediaos/contracts";
import { PortalWidgetBlock } from "@/layouts/portal/PortalRightRail";

interface MyGroupsWidgetProps {
  items: readonly FeedGroupDto[];
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

export function MyGroupsWidget({
  items,
  isLoading,
  isError,
  className,
}: MyGroupsWidgetProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <PortalWidgetBlock
      title={t("groups.widget.title")}
      isLoading={isLoading}
      errorText={isError ? t("state.errorBody") : null}
      className={className}
      action={
        <Link
          to="/feed/groups"
          search={{ membership: "mine" }}
          className="rounded text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("groups.widget.viewAll")}
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="my-groups-empty">
          {t("groups.widget.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="my-groups-list">
          {items.map((group) => {
            const Icon = group.visibility === "private" ? Lock : Users;
            return (
              <li key={group.id}>
                <Link
                  to="/feed/groups/$groupId"
                  params={{ groupId: group.id }}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{group.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PortalWidgetBlock>
  );
}
