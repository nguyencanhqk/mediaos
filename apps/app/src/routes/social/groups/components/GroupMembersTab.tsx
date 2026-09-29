/**
 * S16-SOCIAL-FE-2B — tab «Thành viên» (`037 status=active` · `038 {role}` · `039`; plan D11 + §8 M2).
 *
 * - `status:'active'` LUÔN gửi rõ: `037` không lọc thì LẪN cả hàng `pending` (hàng chờ ở tab Yêu cầu).
 * - Ô chọn vai chỉ với `canModerate`. Option «Chủ nhóm» LUÔN render, `disabled` khi `!canGrantOwner`:
 *   gỡ hẳn option thì admin nhìn hàng CHỦ NHÓM thấy select hiện «Thành viên» (sai vai hiện tại) và
 *   chọn «Thành viên» không bắn `change` (plan §8 M2). Admin HẠ/MỜI RA được chủ nhóm (trừ chủ cuối) —
 *   đúng cổng BE, chỉ phong chủ là không.
 * - Hàng của CHÍNH MÌNH: không «Mời ra» (dùng «Rời nhóm» ở đầu trang), VẪN đổi vai được — đó là đường
 *   tự hạ sau khi phong người khác làm chủ (chuyển owner = hai bước, BE không có route nguyên tử).
 * - 409 chủ nhóm cuối / trạng thái đổi ⇒ lý do cụ thể + kéo lại (`useGroupErrorState`).
 */
import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, Button, Select, StatusPill } from "@mediaos/ui";
import { socialGroupsApi, socialKeys, useAuthStore } from "@mediaos/web-core";
import type { FeedGroupMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { OffsetPager } from "../../feed/components/OffsetPager";
import { relativeTime } from "../../feed/lib/feed-format";
import type { GroupCapabilities } from "../lib/group-capabilities";
import {
  GROUP_ROLE_LABEL_KEY,
  GROUP_ROLE_OPTIONS,
  GROUP_ROLE_TONE,
  type GroupRoleValue,
} from "../lib/group-labels";
import { useGroupErrorState } from "../lib/use-group-membership";

export const GROUP_MEMBERS_PAGE_SIZE = 20;

interface GroupMembersTabProps {
  groupId: string;
  caps: GroupCapabilities;
}

export function GroupMembersTab({ groupId, caps }: GroupMembersTabProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const { error, setError, fail } = useGroupErrorState();
  const [page, setPage] = React.useState(1);
  const [removing, setRemoving] = React.useState<FeedGroupMemberDto | null>(null);

  const params = { status: "active" as const, page, limit: GROUP_MEMBERS_PAGE_SIZE };
  const query = useQuery({
    queryKey: socialKeys.groups.members(groupId, params),
    queryFn: () => socialGroupsApi.listMembers(groupId, params),
    placeholderData: keepPreviousData,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.groups.allOf() });
  };

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: GroupRoleValue }) =>
      socialGroupsApi.decideMember(groupId, userId, { role }),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: fail("memberRole", "role"),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => socialGroupsApi.removeMember(groupId, userId),
    onMutate: () => setError(null),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
    onError: (err) => {
      setRemoving(null);
      fail("memberRemove", "remove")(err);
    },
  });

  const busy = roleMutation.isPending || removeMutation.isPending;
  const nameOf = (m: FeedGroupMemberDto): string => m.fullName ?? t("groups.members.unknownName");

  return (
    <div className="flex flex-col gap-3" data-testid="group-members">
      {caps.canModerate && <p className="text-xs text-muted-foreground">{t("groups.members.transferHint")}</p>}
      {error && (
        <ActionErrorBanner
          kind={error.kind}
          forbidden={error.forbidden}
          reason={error.reason}
          onDismiss={() => setError(null)}
        />
      )}

      {query.isLoading ? (
        <div role="status" aria-label={t("groups.members.loadingAria")} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div data-testid="group-members-error" className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">{t("groups.members.errorTitle")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      ) : query.data.data.length === 0 ? (
        <p data-testid="group-members-empty" className="text-sm text-muted-foreground">
          {t("groups.members.empty")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {query.data.data.map((m) => {
              const isMe = m.userId === myUserId;
              return (
                <li
                  key={m.userId}
                  data-testid={`group-member-${m.userId}`}
                  className="flex flex-wrap items-center gap-3 p-3"
                >
                  <Avatar name={nameOf(m)} src={m.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">
                      {nameOf(m)} {isMe && <span className="text-muted-foreground">{t("groups.members.you")}</span>}
                    </p>
                    {m.joinedAt && (
                      <p className="text-xs text-muted-foreground">
                        {t("groups.members.joinedAt", { when: relativeTime(m.joinedAt) })}
                      </p>
                    )}
                  </div>
                  {caps.canModerate ? (
                    <Select
                      aria-label={t("groups.members.roleSelectLabel", { name: nameOf(m) })}
                      data-testid={`group-member-role-${m.userId}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        roleMutation.mutate({ userId: m.userId, role: e.target.value as GroupRoleValue })
                      }
                      className="h-8 w-40"
                    >
                      {GROUP_ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r} disabled={r === "owner" && !caps.canGrantOwner}>
                          {t(GROUP_ROLE_LABEL_KEY[r])}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <StatusPill tone={GROUP_ROLE_TONE[m.role]} label={t(GROUP_ROLE_LABEL_KEY[m.role])} />
                  )}
                  {caps.canModerate && !isMe && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`group-member-remove-${m.userId}`}
                      disabled={busy}
                      onClick={() => setRemoving(m)}
                    >
                      {t("groups.members.remove")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <OffsetPager
            page={query.data.page}
            limit={query.data.limit}
            total={query.data.total}
            onPageChange={setPage}
            disabled={query.isFetching}
          />
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t("groups.members.removeConfirmTitle", { name: removing ? nameOf(removing) : "" })}
        description={t("groups.members.removeConfirmBody")}
        confirmLabel={t("groups.members.remove")}
        cancelLabel={t("groups.actions.cancel")}
        destructive
        busy={removeMutation.isPending}
        busyLabel={t("groups.actions.working")}
        onConfirm={() => removing && removeMutation.mutate(removing.userId)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
