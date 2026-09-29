/**
 * S16-SOCIAL-FE-2 — `SOC-SCREEN-008` Sáng kiến (SOCIAL-API-045 + xét duyệt 046, plan D8).
 *
 * - Pill trạng thái sống Ở ĐÂY (thẻ bài feed chưa có nó — plan §2 G4, chờ BE-2D).
 * - `reviewNote` vẽ ĐÚNG giá trị server trả: server đã mask cho người không phải tác giả / không có
 *   `approve:feed-idea` (D19 của BE-2B-2). `null` ⇒ không vẽ khối, không đoán «có mà bị ẩn».
 * - Nút «Xét duyệt» bọc `PermissionGate approve:feed-idea` VÀ chỉ hiện khi FSM còn đích (trạng thái
 *   terminal ⇒ không nút).
 * - Danh sách KHÔNG chở tác giả (API chỉ trả `postId`) ⇒ link sang bài để xem ai đăng.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { PermissionGate, socialApi, socialKeys } from "@mediaos/web-core";
import {
  feedIdeaStatusSchema,
  type FeedIdeaItemDto,
  type FeedIdeaStatusDto,
} from "@mediaos/contracts";
import { OffsetPager } from "../feed/components/OffsetPager";
import { relativeTime } from "../feed/lib/feed-format";
import { IdeaReviewDialog } from "./IdeaReviewDialog";
import { ideaReviewTargets } from "./lib/idea-review";

const PAGE_SIZE = 20;
type IdeaFilter = FeedIdeaStatusDto | "all";
const FILTERS: readonly IdeaFilter[] = ["all", ...feedIdeaStatusSchema.options];

const PILL_CLASS: Record<FeedIdeaStatusDto, string> = {
  submitted: "bg-muted text-muted-foreground",
  under_review: "bg-accent text-accent-foreground",
  accepted: "bg-primary/15 text-primary",
  rejected: "bg-destructive/10 text-destructive",
};

export function IdeasPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const [filter, setFilter] = React.useState<IdeaFilter>("all");
  const [page, setPage] = React.useState(1);
  const [reviewing, setReviewing] = React.useState<FeedIdeaItemDto | null>(null);

  const params = { page, limit: PAGE_SIZE, ...(filter === "all" ? {} : { status: filter }) };
  const query = useQuery({
    queryKey: socialKeys.ideas.list(params),
    queryFn: () => socialApi.listIdeas(params),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("ideas.title")}</h1>

      <div role="group" aria-label={t("ideas.filterAria")} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`ideas-filter-${value}`}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === value
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {value === "all" ? t("ideas.filterAll") : t(`idea.status.${value}`)}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div role="status" aria-label={t("state.loadingAria")} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div
          data-testid="ideas-error"
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
          data-testid="ideas-empty"
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {filter === "all" ? t("ideas.empty") : t("ideas.emptyFiltered")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="ideas-list">
            {query.data.data.map((idea) => (
              <li
                key={idea.ideaId}
                data-testid={`ideas-item-${idea.ideaId}`}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-3 whitespace-pre-line break-words text-sm text-foreground">
                      {idea.body ?? ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        data-testid="idea-status-pill"
                        className={cn(
                          "rounded-full px-2 py-0.5 font-medium",
                          PILL_CLASS[idea.status],
                        )}
                      >
                        {t(`idea.status.${idea.status}`)}
                      </span>
                      <span>{relativeTime(idea.createdAt)}</span>
                      {idea.reviewer && (
                        <span>
                          {t("idea.reviewedBy", { name: idea.reviewer.fullName })}
                          {idea.reviewedAt ? ` · ${relativeTime(idea.reviewedAt)}` : ""}
                        </span>
                      )}
                    </div>
                    {idea.reviewNote !== null && (
                      <blockquote
                        data-testid="idea-review-note-view"
                        className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground"
                      >
                        <span className="font-medium">{t("idea.note")}: </span>
                        {idea.reviewNote}
                      </blockquote>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <Link
                    to="/feed/posts/$postId"
                    params={{ postId: idea.postId }}
                    className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("idea.openPost")}
                  </Link>
                  {ideaReviewTargets(idea.status).length > 0 && (
                    <PermissionGate action="approve" resourceType="feed-idea">
                      <Button
                        size="sm"
                        data-testid="idea-review-open"
                        onClick={() => setReviewing(idea)}
                      >
                        {t("idea.review")}
                      </Button>
                    </PermissionGate>
                  )}
                </div>
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

      {reviewing && <IdeaReviewDialog idea={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}
