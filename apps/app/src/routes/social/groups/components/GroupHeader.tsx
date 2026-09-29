/**
 * S16-SOCIAL-FE-2B — đầu trang nhóm: tên · chế độ · số thành viên · mô tả · vai của tôi · nút thành
 * viên (xin vào / huỷ / rời) · «Sao chép link mời» (plan D8, owner ký O1).
 *
 * `memberCount` là cột đếm của server (gồm cả người đã nghỉ việc còn hàng `active`) — KHÔNG so với
 * `total` của `037` (037 giấu người nghỉ việc), hai con số có thể lệch và đó không phải lỗi.
 *
 * Rời nhóm KÍN: trang này sẽ 404 ngay sau đó ⇒ điều hướng về danh sách TRƯỚC khi invalidate (plan §8
 * M5b), rồi bỏ entry chi tiết cũ khỏi cache (quay lại bằng nút Back không thấy dữ liệu của lúc còn là
 * thành viên).
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link2, Lock, Users } from "lucide-react";
import { Button, Input, StatusPill } from "@mediaos/ui";
import { socialKeys } from "@mediaos/web-core";
import type { FeedGroupDto } from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import type { GroupCapabilities } from "../lib/group-capabilities";
import { GROUP_ROLE_LABEL_KEY, GROUP_ROLE_TONE, GROUP_VISIBILITY_LABEL_KEY } from "../lib/group-labels";
import { groupInviteUrl } from "../lib/group-route-search";
import { useGroupMembership } from "../lib/use-group-membership";

interface GroupHeaderProps {
  group: FeedGroupDto;
  caps: GroupCapabilities;
  /** `manage:feed-group` vẫn xem được nhóm kín sau khi rời ⇒ KHÔNG đẩy ra danh sách. */
  canManage: boolean;
}

type CopyState = "idle" | "copied" | "fallback";

export function GroupHeader({ group, caps, canManage }: GroupHeaderProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [copy, setCopy] = React.useState<CopyState>("idle");

  const membership = useGroupMembership(group.id, {
    onLeft: async () => {
      setConfirmLeave(false);
      if (group.visibility === "private" && !canManage) {
        await navigate({ to: "/feed/groups", replace: true });
        queryClient.removeQueries({ queryKey: socialKeys.groups.detail(group.id) });
      }
    },
  });

  const inviteUrl = groupInviteUrl(window.location.origin, group.id, group.visibility);
  const copyInvite = async (): Promise<void> => {
    try {
      // `navigator.clipboard` vắng (HTTP thường, webview) cũng rơi vào nhánh tự sao chép — không câm.
      await navigator.clipboard.writeText(inviteUrl);
      setCopy("copied");
    } catch {
      setCopy("fallback");
    }
  };

  const Icon = group.visibility === "private" ? Lock : Users;

  return (
    <section data-testid="group-header" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-lg font-semibold text-foreground">{group.name}</h1>
          <p className="text-xs text-muted-foreground">
            {t(GROUP_VISIBILITY_LABEL_KEY[group.visibility])} ·{" "}
            {t("groups.memberCount", { count: group.memberCount })}
          </p>
          {caps.role && (
            <StatusPill
              className="mt-1"
              tone={GROUP_ROLE_TONE[caps.role]}
              label={t("groups.page.myRole", { role: t(GROUP_ROLE_LABEL_KEY[caps.role]) })}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(caps.canJoin || caps.canRequestJoin) && (
            <Button size="sm" data-testid="group-join" disabled={membership.busy} onClick={membership.join}>
              {membership.isJoining
                ? t("groups.actions.working")
                : caps.canJoin
                  ? t("groups.actions.join")
                  : t("groups.actions.requestJoin")}
            </Button>
          )}
          {caps.canCancelRequest && (
            <Button
              size="sm"
              variant="outline"
              data-testid="group-cancel-request"
              disabled={membership.busy}
              onClick={membership.leave}
            >
              {membership.isLeaving ? t("groups.actions.working") : t("groups.actions.cancelRequest")}
            </Button>
          )}
          {caps.canLeave && (
            <Button
              size="sm"
              variant="outline"
              data-testid="group-leave"
              disabled={membership.busy}
              onClick={() => setConfirmLeave(true)}
            >
              {t("groups.actions.leave")}
            </Button>
          )}
          {caps.canCopyInvite && (
            <Button size="sm" variant="ghost" data-testid="group-copy-invite" onClick={() => void copyInvite()}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t("groups.actions.copyInvite")}
            </Button>
          )}
        </div>
      </div>

      {group.description && (
        <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{group.description}</p>
      )}

      {copy === "copied" && (
        <p role="status" data-testid="group-invite-copied" className="text-sm text-foreground">
          {t("groups.actions.copied")}
        </p>
      )}
      {copy === "fallback" && (
        <label className="flex flex-col gap-1 text-sm" data-testid="group-invite-fallback">
          <span className="text-muted-foreground">{t("groups.actions.copyFallback")}</span>
          <Input readOnly value={inviteUrl} aria-label={t("groups.actions.copyFallbackLabel")} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}

      {membership.error && (
        <ActionErrorBanner
          kind={membership.error.kind}
          forbidden={membership.error.forbidden}
          reason={membership.error.reason}
          onDismiss={membership.clearError}
        />
      )}

      <ConfirmDialog
        open={confirmLeave}
        title={t("groups.actions.leaveConfirmTitle", { name: group.name })}
        description={t("groups.actions.leaveConfirmBody")}
        confirmLabel={t("groups.actions.leave")}
        cancelLabel={t("groups.actions.cancel")}
        destructive
        busy={membership.isLeaving}
        busyLabel={t("groups.actions.working")}
        onConfirm={() => {
          // Lỗi (vd 409 chủ nhóm cuối) ⇒ đóng hộp thoại để banner lý do hiện ngay trên đầu trang.
          setConfirmLeave(false);
          membership.leave();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </section>
  );
}
