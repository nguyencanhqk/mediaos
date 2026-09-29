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
 * Component TRÌNH BÀY thuần: lượt xin vào + «đã gửi» + lỗi sống ở `useInviteRequest` do
 * `GroupPageBody` giữ (gate LIGHT HIGH-1). Lý do: query `032` đang 404 thì KHÔNG có `data`, và
 * TanStack v5 đặt lại `status:'pending'` cho mọi lượt refetch của query không có `data`
 * (`query-core` `fetchState`) ⇒ trang vẽ skeleton, component này UNMOUNT — state đặt ở đây sẽ mất
 * (banner lý do nháy rồi biến, nút bật lại như chưa bấm).
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import type { UseInviteRequestResult } from "../lib/use-invite-request";

interface GroupNotFoundProps {
  /** Vắng/`null` ⇒ không có đường xin vào (không `?invite=1`, hoặc `$groupId` không phải UUID). */
  invite?: UseInviteRequestResult | null;
}

export function GroupNotFound({ invite }: GroupNotFoundProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <div
      data-testid="group-not-found"
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6"
    >
      <h1 className="text-lg font-semibold text-foreground">{t("groups.notFound.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("groups.notFound.body")}</p>

      {invite && !invite.sent && (
        <>
          <p className="text-sm text-muted-foreground">{t("groups.notFound.inviteBody")}</p>
          <Button
            size="sm"
            data-testid="group-invite-request"
            disabled={invite.isPending}
            onClick={invite.request}
          >
            {invite.isPending ? t("groups.actions.working") : t("groups.notFound.inviteSubmit")}
          </Button>
        </>
      )}
      {invite?.sent && (
        <p role="status" data-testid="group-invite-sent" className="text-sm text-foreground">
          {t("groups.notFound.inviteSent")}
        </p>
      )}
      {invite?.error && (
        <ActionErrorBanner
          kind={invite.error.kind}
          forbidden={invite.error.forbidden}
          reason={invite.error.reason}
          onDismiss={invite.clearError}
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
