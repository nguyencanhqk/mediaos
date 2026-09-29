/**
 * S16-SOCIAL-FE-2 — `SOC-SCREEN-007` Bình chọn (SOCIAL-API-040, plan D7).
 *
 * Danh sách chỉ đủ để MỞ bài: `040` không chở số phiếu hay `multipleChoice` (plan §1 M4). Khối bỏ
 * phiếu đầy đủ nằm trên thẻ bài ở màn chi tiết (`/feed/posts/$postId`).
 *
 * Nhãn trạng thái dùng `isPollAcceptingVotes`: poll quá hạn mà job chưa đóng hiện «Đã hết hạn», không
 * hiện «Kết thúc …» như thể vẫn bỏ phiếu được (plan §8 H4).
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type { FeedPollListItemDto } from "@mediaos/contracts";
import { OffsetPager } from "../feed/components/OffsetPager";
import { relativeTime } from "../feed/lib/feed-format";
import { isPollAcceptingVotes } from "../feed/lib/poll-format";

const PAGE_SIZE = 20;
type PollTab = "open" | "closed" | "all";
const TABS: readonly PollTab[] = ["open", "closed", "all"];

export function PollsPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const [tab, setTab] = React.useState<PollTab>("open");
  const [page, setPage] = React.useState(1);

  const params = { page, limit: PAGE_SIZE, ...(tab === "all" ? {} : { status: tab }) };
  const query = useQuery({
    queryKey: socialKeys.polls.list(params),
    queryFn: () => socialApi.listPolls(params),
    placeholderData: keepPreviousData,
  });

  const tabLabel: Record<PollTab, string> = {
    open: t("polls.tabOpen"),
    closed: t("polls.tabClosed"),
    all: t("polls.tabAll"),
  };

  const statusLabel = (poll: FeedPollListItemDto): string => {
    if (poll.status === "closed") return t("poll.closed");
    if (!isPollAcceptingVotes(poll)) return t("poll.expired");
    return poll.closesAt ? t("poll.closesIn", { when: relativeTime(poll.closesAt) }) : "";
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("polls.title")}</h1>

      <div role="group" aria-label={t("polls.filterAria")} className="flex flex-wrap gap-2">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`polls-tab-${value}`}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === value
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {tabLabel[value]}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div role="status" aria-label={t("state.loadingAria")} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div
          data-testid="polls-error"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          <p className="font-medium text-foreground">{t("state.errorTitle")}</p>
          <p className="text-muted-foreground">{t("state.errorBody")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      ) : query.data.data.length === 0 ? (
        <p
          data-testid="polls-empty"
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {tab === "open" ? t("polls.emptyOpen") : t("polls.empty")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="polls-list">
            {query.data.data.map((poll) => (
              <li key={poll.pollId}>
                <Link
                  to="/feed/posts/$postId"
                  params={{ postId: poll.postId }}
                  data-testid={`polls-item-${poll.pollId}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-foreground">
                      {poll.question}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[poll.isAnonymous ? t("poll.anonymous") : "", statusLabel(poll)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Link>
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
    </div>
  );
}
