/**
 * S16-SOCIAL-FE-2B — màn 404 của trang nhóm (done_when #2 · plan D8 · owner ký O1).
 *
 * ┌─ 🔴 TRUNG TÍNH — KHÔNG phải oracle dò nhóm kín ──────────────────────────────────────────────┐
 * │ `032` trả CÙNG một 404 cho nhóm không tồn tại · đã xoá · kín mà bạn không thuộc. Màn này nói  │
 * │ đúng một câu cho cả ba, và KHÔNG phải màn «không có quyền» (`ForbiddenPage`).                  │
 * │ Câu mời + nút «Gửi yêu cầu tham gia» phụ thuộc DUY NHẤT tham số URL `?invite=1` — giống hệt    │
 * │ nhau với một UUID không tồn tại ⇒ không lộ gì trước khi bấm. Sau khi bấm, oracle chỉ mở cho    │
 * │ người đã cầm UUID 122-bit — BE đã chấp nhận (`social-groups.repository.ts#findLiveGroupTx`).   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Luật cứng hoá (plan §8 M6): `join` CHỈ chạy khi BẤM (link không được ép nạn nhân gửi yêu cầu) ·
 * `groupId` không phải UUID ⇒ không có nút · DTO 201 của `035` (mang tên/mô tả nhóm kín) KHÔNG hiện và
 * KHÔNG ghi vào cache chi tiết · «đã gửi» là state CỦA COMPONENT NÀY nên sống qua lượt refetch.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { useGroupErrorState } from "../lib/use-group-membership";

interface GroupNotFoundProps {
  /** `null` khi `$groupId` không phải UUID — khi đó KHÔNG có đường xin vào. */
  groupId: string | null;
  invite: boolean;
}

export function GroupNotFound({ groupId, invite }: GroupNotFoundProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const { error, setError, fail } = useGroupErrorState();
  const [sent, setSent] = React.useState(false);

  const request = useMutation({
    mutationFn: (id: string) => socialGroupsApi.join(id),
    onMutate: () => setError(null),
    // CHỦ Ý bỏ qua DTO trả về (tên/mô tả nhóm kín) — chỉ làm mới DANH SÁCH (hàng `pending` giờ hiện ở 030).
    onSuccess: () => {
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.lists() });
    },
    onError: fail("groupJoin", "join"),
  });

  const canRequest = invite && groupId !== null;

  return (
    <div
      data-testid="group-not-found"
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6"
    >
      <h1 className="text-lg font-semibold text-foreground">{t("groups.notFound.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("groups.notFound.body")}</p>

      {canRequest && !sent && (
        <>
          <p className="text-sm text-muted-foreground">{t("groups.notFound.inviteBody")}</p>
          <Button
            size="sm"
            data-testid="group-invite-request"
            disabled={request.isPending}
            onClick={() => request.mutate(groupId)}
          >
            {request.isPending ? t("groups.actions.working") : t("groups.notFound.inviteSubmit")}
          </Button>
        </>
      )}
      {sent && (
        <p role="status" data-testid="group-invite-sent" className="text-sm text-foreground">
          {t("groups.notFound.inviteSent")}
        </p>
      )}
      {error && (
        <ActionErrorBanner
          kind={error.kind}
          forbidden={error.forbidden}
          reason={error.reason}
          onDismiss={() => setError(null)}
        />
      )}

      <Link
        to="/feed/groups"
        className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("groups.page.backToList")}
      </Link>
    </div>
  );
}
