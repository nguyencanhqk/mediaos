/**
 * S16-SOCIAL-FE-2B — một hàng của danh sách nhóm (plan D6). Nút theo `myStatus` của CHÍNH actor,
 * lấy qua `groupCapabilities` (không tự suy từ `myRole`).
 *
 * Tên nhóm chỉ là link khi `canOpenGroup`: nhóm kín mà mình còn `pending` vẫn nằm trong `030` nhưng
 * `032` trả 404 — link ở đó là đường vào một màn «không tìm thấy».
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock, Users } from "lucide-react";
import { Badge, Button } from "@mediaos/ui";
import type { FeedGroupDto } from "@mediaos/contracts";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { canOpenGroup, groupCapabilities } from "../lib/group-capabilities";
import { GROUP_VISIBILITY_LABEL_KEY } from "../lib/group-labels";
import { useGroupMembership } from "../lib/use-group-membership";

interface GroupListRowProps {
  group: FeedGroupDto;
  canManage: boolean;
}

export function GroupListRow({ group, canManage }: GroupListRowProps): React.ReactElement {
  const { t } = useTranslation("social");
  const caps = groupCapabilities(group, canManage);
  const membership = useGroupMembership(group.id);
  const Icon = group.visibility === "private" ? Lock : Users;

  const name = canOpenGroup(group, canManage) ? (
    <Link
      to="/feed/groups/$groupId"
      params={{ groupId: group.id }}
      data-testid={`group-link-${group.id}`}
      className="break-words text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {group.name}
    </Link>
  ) : (
    <span
      data-testid={`group-name-${group.id}`}
      className="break-words text-sm font-medium text-foreground"
    >
      {group.name}
    </span>
  );

  return (
    <li
      data-testid={`group-row-${group.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {name}
          <p className="text-xs text-muted-foreground">
            {t(GROUP_VISIBILITY_LABEL_KEY[group.visibility])} ·{" "}
            {t("groups.memberCount", { count: group.memberCount })}
          </p>
          {group.description && (
            <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">
              {group.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {caps.role !== null && <Badge variant="success">{t("groups.list.joined")}</Badge>}
          {caps.canCancelRequest && (
            <>
              <Badge variant="warning">{t("groups.list.pending")}</Badge>
              <Button
                size="sm"
                variant="outline"
                data-testid={`group-cancel-${group.id}`}
                disabled={membership.busy}
                onClick={membership.leave}
              >
                {membership.isLeaving
                  ? t("groups.actions.working")
                  : t("groups.actions.cancelRequest")}
              </Button>
            </>
          )}
          {(caps.canJoin || caps.canRequestJoin) && (
            <Button
              size="sm"
              data-testid={`group-join-${group.id}`}
              disabled={membership.busy}
              onClick={membership.join}
            >
              {membership.isJoining
                ? t("groups.actions.working")
                : caps.canJoin
                  ? t("groups.actions.join")
                  : t("groups.actions.requestJoin")}
            </Button>
          )}
        </div>
      </div>
      {membership.error && (
        <ActionErrorBanner
          kind={membership.error.kind}
          forbidden={membership.error.forbidden}
          reason={membership.error.reason}
          onDismiss={membership.clearError}
        />
      )}
    </li>
  );
}
