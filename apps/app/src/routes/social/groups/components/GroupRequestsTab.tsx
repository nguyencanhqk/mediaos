/**
 * S16-SOCIAL-FE-2B — tab «Yêu cầu tham gia» (`037 status=pending` · `038 {decision}`; plan D12).
 *
 * Chủ/quản trị nhóm KHÔNG được báo khi có yêu cầu mới (NOTI-034 chỉ tới người xin) ⇒ tab tự kéo khi
 * mở. Người khác duyệt trước ⇒ 409 (lệch trạng thái) hoặc 404 không số (hàng đã bị từ chối/xoá) ⇒ lý
 * do «trạng thái vừa đổi» + danh sách tự tải lại.
 */
import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Avatar, Button } from "@mediaos/ui";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import type { FeedGroupMemberDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { OffsetPager } from "../../feed/components/OffsetPager";
import { useGroupErrorState } from "../lib/use-group-membership";
import { GROUP_MEMBERS_PAGE_SIZE } from "./GroupMembersTab";

interface GroupRequestsTabProps {
  groupId: string;
}

export function GroupRequestsTab({ groupId }: GroupRequestsTabProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const { error, setError, fail } = useGroupErrorState();
  const [page, setPage] = React.useState(1);
  const [rejecting, setRejecting] = React.useState<FeedGroupMemberDto | null>(null);

  const params = { status: "pending" as const, page, limit: GROUP_MEMBERS_PAGE_SIZE };
  const query = useQuery({
    queryKey: socialKeys.groups.members(groupId, params),
    queryFn: () => socialGroupsApi.listMembers(groupId, params),
    placeholderData: keepPreviousData,
  });

  const decide = useMutation({
    mutationFn: ({ userId, decision }: { userId: string; decision: "approve" | "reject" }) =>
      socialGroupsApi.decideMember(groupId, userId, { decision }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setRejecting(null);
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.allOf() });
    },
    onError: (err) => {
      setRejecting(null);
      fail("memberDecide", "decide")(err);
    },
  });

  const nameOf = (m: FeedGroupMemberDto): string => m.fullName ?? t("groups.members.unknownName");

  return (
    <div className="flex flex-col gap-3" data-testid="group-requests">
      {error && (
        <ActionErrorBanner
          kind={error.kind}
          forbidden={error.forbidden}
          reason={error.reason}
          onDismiss={() => setError(null)}
        />
      )}

      {query.isLoading ? (
        <div role="status" aria-label={t("groups.requests.loadingAria")} className="h-12 animate-pulse rounded-lg bg-muted" />
      ) : query.isError || !query.data ? (
        <div data-testid="group-requests-error" className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">{t("groups.requests.errorTitle")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      ) : query.data.data.length === 0 ? (
        <p data-testid="group-requests-empty" className="text-sm text-muted-foreground">
          {t("groups.requests.empty")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {query.data.data.map((m) => (
              <li
                key={m.userId}
                data-testid={`group-request-${m.userId}`}
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <Avatar name={nameOf(m)} src={m.avatarUrl} size="sm" />
                <p className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{nameOf(m)}</p>
                <Button
                  size="sm"
                  data-testid={`group-request-approve-${m.userId}`}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ userId: m.userId, decision: "approve" })}
                >
                  {t("groups.requests.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`group-request-reject-${m.userId}`}
                  disabled={decide.isPending}
                  onClick={() => setRejecting(m)}
                >
                  {t("groups.requests.reject")}
                </Button>
              </li>
            ))}
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
        open={rejecting !== null}
        title={t("groups.requests.rejectConfirmTitle", { name: rejecting ? nameOf(rejecting) : "" })}
        description={t("groups.requests.rejectConfirmBody")}
        confirmLabel={t("groups.requests.reject")}
        cancelLabel={t("groups.actions.cancel")}
        destructive
        busy={decide.isPending}
        busyLabel={t("groups.actions.working")}
        onConfirm={() => rejecting && decide.mutate({ userId: rejecting.userId, decision: "reject" })}
        onCancel={() => setRejecting(null)}
      />
    </div>
  );
}
