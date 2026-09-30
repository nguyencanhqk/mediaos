/**
 * S16-SOCIAL-FE-2C — `SOC-SCREEN-009` Vinh danh theo tháng (SOCIAL-API-047, plan D10).
 *
 * Tháng + trang sống trên URL (`?month=YYYY-MM&page=N`, `kudos-route-search.ts`) để chia sẻ được link;
 * vắng `month` = tháng HIỆN TẠI theo giờ công ty — và luôn gửi `month` tường minh cho `047` (vắng `month`
 * ở `047` nghĩa là «gần đây», không phải «tháng này»).
 *
 * Mỗi dòng = `KudosBlock` (cùng khối với thẻ bài) + mốc thời gian + link «Xem bài» theo `postId` (KHÔNG
 * `kudosId` — hai uuid cùng dòng, nhầm là 404). Trang quá trang cuối (`total > 0`, `data` rỗng) KHÔNG nói
 * «chưa có vinh danh» — nó nói «trang này không còn» và đưa nút về trang đầu.
 */
import type * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@mediaos/ui";
import { socialKeys, socialKudosApi } from "@mediaos/web-core";
import { OffsetPager } from "../feed/components/OffsetPager";
import { relativeTime } from "../feed/lib/feed-format";
import { KudosBlock } from "./components/KudosBlock";
import { currentKudosMonth, kudosMonthParts, shiftKudosMonth } from "./lib/kudos-month";
import type { KudosRouteSearch } from "./lib/kudos-route-search";

const PAGE_SIZE = 20;

export function KudosPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as KudosRouteSearch;

  const current = currentKudosMonth();
  const month = search.month ?? current;
  const page = search.page ?? 1;
  const params = { month, page, limit: PAGE_SIZE };
  const query = useQuery({
    queryKey: socialKeys.kudos.list(params),
    queryFn: () => socialKudosApi.list(params),
    // Giữ dữ liệu cũ CHỈ khi lật trang trong CÙNG tháng (gate LIGHT M1): đổi tháng mà giữ thì danh sách
    // tháng trước hiện dưới nhãn tháng mới cho tới khi tải xong — đọc như dữ liệu của tháng mới.
    placeholderData: (prev, prevQuery) =>
      (prevQuery?.queryKey.at(-1) as { month?: string } | undefined)?.month === month
        ? keepPreviousData(prev)
        : undefined,
  });

  /** Mặc định (tháng hiện tại · trang 1) KHÔNG ghi lên URL — link chia sẻ gọn, «tháng này» vẫn là tháng này. */
  const go = (nextMonth: string, nextPage = 1): void => {
    void navigate({
      to: "/feed/kudos",
      search: {
        ...(nextMonth !== current ? { month: nextMonth } : {}),
        ...(nextPage > 1 ? { page: nextPage } : {}),
      },
    });
  };

  const prev = shiftKudosMonth(month, -1);
  const next = shiftKudosMonth(month, 1);
  // So chuỗi `YYYY-MM` = so thời gian. Không lật sang tháng TƯƠNG LAI (luôn rỗng).
  const canGoNext = next !== null && month < current;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("kudos.page.title")}</h1>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="kudos-prev-month"
          aria-label={t("kudos.page.prevMonth")}
          disabled={prev === null}
          onClick={() => prev && go(prev)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span data-testid="kudos-month-label" className="min-w-32 text-center text-sm font-medium">
          {t("kudos.page.monthLabel", kudosMonthParts(month))}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="kudos-next-month"
          aria-label={t("kudos.page.nextMonth")}
          disabled={!canGoNext}
          onClick={() => next && canGoNext && go(next)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {query.isLoading ? (
        <div role="status" aria-label={t("state.loadingAria")} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div data-testid="kudos-error" className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">{t("state.errorTitle")}</p>
          <p className="text-muted-foreground">{t("state.errorBody")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            {t("state.retry")}
          </Button>
        </div>
      ) : query.data.data.length === 0 ? (
        query.data.total > 0 ? (
          <div
            data-testid="kudos-past-last-page"
            className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            <p>{t("kudos.page.pastLastPage")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => go(month)}>
              {t("kudos.page.backToFirstPage")}
            </Button>
          </div>
        ) : (
          <p
            data-testid="kudos-empty"
            className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            {t("kudos.page.empty")}
          </p>
        )
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="kudos-list">
            {query.data.data.map((item) => (
              <li key={item.kudosId} className="rounded-lg border border-border bg-card p-3">
                <KudosBlock block={item} />
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{relativeTime(item.createdAt)}</span>
                  <span aria-hidden="true">·</span>
                  <Link
                    to="/feed/posts/$postId"
                    params={{ postId: item.postId }}
                    data-testid="kudos-view-post"
                    className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("kudos.viewPost")}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          <OffsetPager
            page={query.data.page}
            limit={query.data.limit}
            total={query.data.total}
            onPageChange={(p) => go(month, p)}
            disabled={query.isFetching}
          />
        </>
      )}
    </div>
  );
}
