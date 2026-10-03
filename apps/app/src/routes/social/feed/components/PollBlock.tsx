/**
 * S16-SOCIAL-FE-2 — khối bình chọn trong thẻ bài (`SOC-SCREEN-007`, plan D5 + §8).
 *
 * ┌─ S16-SOCIAL-FEBLOCKSEED-1 — SEED TỪ THẺ, CHỈ VÀO CACHE RỖNG (plan §0–§1) ─────────────────────┐
 * │ Thẻ chở `post.poll` (BE-2D — CÙNG bộ dựng với `043`) ⇒ truyền làm `seed` ⇒ `initialData`. TanStack │
 * │ CHỈ dùng `initialData` khi `results(postId)` chưa có data: entry đã có (kết quả `041..044`, một   │
 * │ `043` trước đó) LUÔN thắng thẻ, kể cả khi thẻ mới hơn ⇒ seed không bao giờ đè kết quả mới hơn.    │
 * │ KHÔNG `setQueryData` từ thẻ: thời điểm TỚI của client không xếp được thứ tự đọc của server (GET  │
 * │ gửi trước lượt bỏ phiếu, về sau; danh sách vô hạn dùng MỘT `dataUpdatedAt` cho mọi trang), server  │
 * │ không có mốc phiên bản, và `setQueryData` không tự chặn ghi cũ đè mới. Vắng `seed` (006 · WS · API │
 * │ trước #555 · hàng mồ côi) ⇒ khối TỰ tải `043` như trước.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 PUT GỬI CẢ TẬP, KHÔNG GỬI Ô VỪA BẤM (plan §8 H2) ─────────────────────────────────────────┐
 * │ `041` XOÁ mọi phiếu cũ của actor rồi GHI đúng `optionIds`. Bình chọn nhiều lựa chọn mà gửi mỗi  │
 * │ ô vừa tích là âm thầm xoá các ô còn lại. Form giữ TẬP đang chọn (`toggleSelection`) và gửi tập  │
 * │ đó khi bấm «Bỏ phiếu».                                                                         │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi mutation có `onError` (bài học FE-1: 0 `onError` = ghi hỏng im lặng). Lỗi hiện TRONG khối —
 * state riêng, không qua `useFeedActions` — và kéo lại `043` để trạng thái thật (poll vừa bị đóng,
 * phiếu đã đổi ở tab khác) tự giải thích cho người dùng; server không cho FE phân biệt 016/017 bằng
 * mã (plan §8 M6).
 *
 * Gate «Kết thúc»: chủ bài hoặc `manage:feed-post` — mirror `assertCanMutateContent` (`044`).
 * ⚠️ `useCan` bỏ qua scope còn server đòi sàn Company; seed chỉ cấp Company nên hôm nay không lệch
 * (cùng đánh đổi `PostCardMenu`).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { ApiError, socialApi, socialKeys, useCan } from "@mediaos/web-core";
import type { FeedPollResultsDto } from "@mediaos/contracts";
import { ActionErrorBanner, type ActionErrorKind } from "./ActionErrorBanner";
import { relativeTime } from "../lib/feed-format";
import {
  canClosePoll,
  canWithdrawVote,
  isPollAcceptingVotes,
  isSameSelection,
  pollOptionPercent,
  toggleSelection,
} from "../lib/poll-format";

/**
 * Bằng `staleTime` mặc định của app (`main.tsx`, FRONTEND-04 §16.1) — nhưng khai Ở ĐÂY: hợp đồng «thẻ chở
 * `post.poll` ⇒ 0 lần gọi `043` lúc mount» phải sống trong component, không mượn của client bọc nó (client
 * `staleTime` 0 thì seed cũ ngay và mount gọi `043` — plan §0 M2). Con số trùng mặc định ⇒ đường tự tải
 * (vắng seed) giữ nguyên hành vi.
 */
const POLL_RESULTS_STALE_MS = 30_000;

interface PollBlockProps {
  postId: string;
  /** Bài do chính actor đăng — cờ `isMine` của DTO bài, KHÔNG tự so id ở FE. */
  isMine: boolean;
  /**
   * Khối `post.poll` của thẻ — CÙNG hình dạng `043`. Chỉ làm `initialData` (lấp cache RỖNG), không bao
   * giờ ghi đè một entry đã có data.
   *
   * KHÔNG kèm `initialDataUpdatedAt` ⇒ seed được tính là vừa tải lúc entry được tạo. Đúng vì thẻ chỉ mount
   * CÙNG LÚC dữ liệu nguồn vừa về (5 nơi vẽ thẻ hôm nay — plan §1). Khi `PollBlock` mount MUỘN hơn dữ liệu
   * nguồn (danh sách ảo hoá, thẻ gập/lười, widget đọc danh sách trong cache) ⇒ truyền `dataUpdatedAt` của
   * query nguồn làm `initialDataUpdatedAt` (coi `0` của `placeholderData` là KHÔNG BIẾT).
   */
  seed?: FeedPollResultsDto;
  className?: string;
}

interface PollActionError {
  kind: Extract<ActionErrorKind, "vote" | "pollClose">;
  forbidden: boolean;
}

export function PollBlock({ postId, isMine, seed, className }: PollBlockProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const canManagePost = useCan("manage", "feed-post");
  const resultsKey = socialKeys.polls.results(postId);

  const query = useQuery({
    queryKey: resultsKey,
    queryFn: () => socialApi.getPollResults(postId),
    initialData: seed,
    staleTime: POLL_RESULTS_STALE_MS,
  });

  /** `null` = chưa chỉnh gì ⇒ form phản chiếu `myVote` của server. */
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<PollActionError | null>(null);

  const applyResult = (result: FeedPollResultsDto): void => {
    queryClient.setQueryData(resultsKey, result);
    setDraft(null);
    setError(null);
  };

  const onFail = (kind: PollActionError["kind"]) => (err: unknown) => {
    setError({ kind, forbidden: err instanceof ApiError && err.status === 403 });
    setDraft(null);
    void queryClient.invalidateQueries({ queryKey: resultsKey });
  };

  const voteMutation = useMutation({
    mutationFn: (optionIds: readonly string[]) => socialApi.votePoll(postId, optionIds),
    onSuccess: applyResult,
    onError: onFail("vote"),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => socialApi.withdrawPollVote(postId),
    onSuccess: applyResult,
    onError: onFail("vote"),
  });

  const closeMutation = useMutation({
    mutationFn: () => socialApi.closePoll(postId),
    onSuccess: (result) => {
      applyResult(result);
      // Poll vừa đóng phải rời tab «Đang mở» + widget rail (plan §8 H5). Chỉ nhánh `list`: nhánh
      // `results` vừa được ghi ở trên, invalidate nó là một request thừa.
      void queryClient.invalidateQueries({ queryKey: [...socialKeys.polls.allOf(), "list"] });
    },
    onError: onFail("pollClose"),
  });

  if (query.isLoading) {
    return (
      <div
        role="status"
        aria-label={t("poll.loadingAria")}
        data-testid="poll-block-loading"
        className={cn("h-24 animate-pulse rounded-md bg-muted", className)}
      />
    );
  }

  if (query.isError || !query.data) {
    return (
      <div
        data-testid="poll-block-error"
        className={cn("rounded-md border border-border p-3 text-sm", className)}
      >
        <p className="text-muted-foreground">{t("poll.errorTitle")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
          {t("state.retry")}
        </Button>
      </div>
    );
  }

  const poll = query.data;
  const accepting = isPollAcceptingVotes(poll);
  const selection = draft ?? poll.myVote;
  const isBusy = voteMutation.isPending || withdrawMutation.isPending || closeMutation.isPending;
  const canSubmitVote =
    accepting && !isBusy && selection.length > 0 && !isSameSelection(selection, poll.myVote);

  let statusLabel: string | null = null;
  if (poll.status === "closed") statusLabel = t("poll.closed");
  else if (!accepting) statusLabel = t("poll.expired");
  else if (poll.closesAt) statusLabel = t("poll.closesIn", { when: relativeTime(poll.closesAt) });

  return (
    <section
      data-testid="poll-block"
      data-poll-status={poll.status}
      className={cn("rounded-md border border-border p-3", className)}
    >
      <header className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{poll.question}</p>
          <p className="text-xs text-muted-foreground">
            {poll.multipleChoice ? t("poll.multipleHint") : t("poll.singleHint")}
            {poll.isAnonymous ? ` · ${t("poll.anonymous")}` : ""}
            {statusLabel ? (
              <span data-testid="poll-status-label">{` · ${statusLabel}`}</span>
            ) : null}
          </p>
        </div>
      </header>

      <fieldset className="mt-3 space-y-2" disabled={!accepting || isBusy}>
        <legend className="sr-only">{t("poll.optionsAria")}</legend>
        {poll.options.map((option) => {
          const percent = pollOptionPercent(option.voteCount, poll.totalVoters);
          const checked = selection.includes(option.id);
          const isMyVote = poll.myVote.includes(option.id);
          return (
            <label
              key={option.id}
              data-testid={`poll-option-${option.id}`}
              className="relative block cursor-pointer overflow-hidden rounded-md border border-border px-3 py-2 text-sm"
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 left-0", isMyVote ? "bg-primary/20" : "bg-muted")}
                style={{ width: `${percent}%` }}
              />
              <span className="relative flex items-center gap-2">
                <input
                  type={poll.multipleChoice ? "checkbox" : "radio"}
                  name={`poll-${postId}`}
                  checked={checked}
                  onChange={() =>
                    setDraft(toggleSelection(selection, option.id, poll.multipleChoice))
                  }
                />
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                {isMyVote && <span className="sr-only">{t("poll.myChoice")}</span>}
                <span className="tabular-nums text-muted-foreground">
                  {t("poll.percent", { percent })}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground" data-testid="poll-total-voters">
          {t("poll.totalVoters", { count: poll.totalVoters })}
        </span>

        {accepting && (
          <Button
            size="sm"
            data-testid="poll-vote"
            disabled={!canSubmitVote}
            onClick={() => voteMutation.mutate(selection)}
          >
            {voteMutation.isPending
              ? t("poll.voting")
              : poll.myVote.length > 0
                ? t("poll.changeVote")
                : t("poll.vote")}
          </Button>
        )}

        {canWithdrawVote(poll) && (
          <Button
            size="sm"
            variant="outline"
            data-testid="poll-withdraw"
            disabled={isBusy}
            onClick={() => withdrawMutation.mutate()}
          >
            {t("poll.withdraw")}
          </Button>
        )}

        {canClosePoll({ status: poll.status, isMine, canManagePost }) && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="poll-close"
            disabled={isBusy}
            onClick={() => closeMutation.mutate()}
          >
            {closeMutation.isPending ? t("poll.closing") : t("poll.close")}
          </Button>
        )}
      </div>

      {error && (
        <ActionErrorBanner
          kind={error.kind}
          forbidden={error.forbidden}
          onDismiss={() => setError(null)}
          className="mt-3"
        />
      )}
    </section>
  );
}
