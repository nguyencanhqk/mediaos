/**
 * S16-SOCIAL-FE-3 (L2) — màn Kiểm duyệt `SOC-SCREEN-010`, tab «Báo cáo» (đọc `SOCIAL-API-028`, kết thúc
 * báo cáo bằng `SOCIAL-API-029` qua `ResolveReportDialog`).
 *
 * ┌─ CẤU TRÚC — chỗ cắm cho tab «Bài đang ẩn» ───────────────────────────────────────────────────────┐
 * │ `ModerationPage` = VỎ: tiêu đề + đọc search của route + chọn tấm (panel) theo tab. Mọi thứ của    │
 * │ hàng đợi báo cáo (query 028 · ô lọc · hộp thoại · dải kết cục) nằm trong `ReportsPanel`. Thêm tab  │
 * │ thứ hai = thêm thanh tab + một nhánh ở vỏ (`activeModerationTab` + `searchForTab` đã có sẵn ở     │
 * │ `lib/moderation-route-search`), KHÔNG phải viết lại `ReportsPanel`.                               │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng: màn KHÔNG tự gác quyền đọc — route gác `view:feed` + `view:feed-report` (bước nối dây), server
 * là cổng cuối (403 của 028 ⇒ dải `forbidden`). Nút «Xử lý» do `ReportRow` gác (`manage:feed-report`), ô
 * hành động kèm do hộp thoại gác (`manage:feed-post`).
 *
 * BỐN LUẬT của tấm «Báo cáo»:
 *  1. Tham số 028 và search kế tiếp CHỈ suy bằng hàm thuần của `moderation-route-search` — «Tất cả» không
 *     gửi `status`, mặc định không ghi lên URL, đổi bộ lọc về trang 1 đều nằm ở đó.
 *  2. Giữ trang cũ trong lúc tải CHỈ khi lật trang trong CÙNG bộ lọc. Đổi bộ lọc mà giữ thì hàng «đang
 *     chờ» (còn nút «Xử lý») nằm dưới nhãn «Đã giải quyết», hoặc câu rỗng của bộ lọc mới hiện ra trước
 *     khi dữ liệu của nó về (hợp đồng prop `page` của `ReportQueue`).
 *  3. Kết cục của 029 xử lý Ở ĐÂY, không ở hộp thoại / hàng: sau khi làm mới, hàng vừa xử lý (và mọi thứ
 *     mount dưới nó) biến mất — dải đặt ở đó mất theo (plan B6).
 *  4. Lượt đọc đang LỖI ⇒ không vẽ dải kết cục: câu «danh sách đã được làm mới» đứng cạnh «không tải
 *     được danh sách» là nói hai điều trái nhau. Thử lại xong thì dải hiện lại.
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { socialKeys, socialModerationApi } from "@mediaos/web-core";
import type { FeedReportDto, FeedReportPageDto, FeedReportStatusDto } from "@mediaos/contracts";
import { AdminErrorNotice } from "../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../admin/lib/admin-errors";
import { ReportQueue } from "./components/ReportQueue";
import { ResolveReportDialog, type ResolveReportOutcome } from "./components/ResolveReportDialog";
import {
  activeStatusFilter,
  MODERATION_STATUS_FILTERS,
  reportListParams,
  searchForPage,
  searchForStatusFilter,
  validateModerationRouteSearch,
  type ModerationRouteSearch,
  type ReportListParams,
} from "./lib/moderation-route-search";
import { NO_REPORT_ACTION } from "./lib/report-actions";

type ClosedReportStatus = Exclude<FeedReportStatusDto, "open">;

/** Dải «kết cục» của lượt 029 gần nhất, vẽ ở trang. */
type OutcomeNotice =
  | { kind: "done"; status: ClosedReportStatus }
  | { kind: "failed"; reason: AdminErrorReason };

/**
 * Làm mới cache sau một kết cục của 029.
 *  · Trạng thái báo cáo đã đổi (hoặc thứ đang thấy đã cũ — E1 · E6) ⇒ MỌI trang của hàng đợi.
 *  · Có hành động kèm ⇒ bài đã bị ẩn / khoá bình luận / xoá (hoặc một bình luận của nó bị xoá) ⇒ thêm tab
 *    «Bài đang ẩn», dòng cuộn feed, chi tiết + bình luận của bài. Id bài lấy từ `targetSnapshot.postId`:
 *    với báo cáo BÌNH LUẬN, `targetId` là id bình luận chứ không phải id bài (plan M2b).
 */
function invalidateAfterOutcome(queryClient: QueryClient, outcome: ResolveReportOutcome): void {
  if (outcome.kind === "failed") {
    if (outcome.invalidate) {
      void queryClient.invalidateQueries({ queryKey: socialKeys.moderation.reports.lists() });
    }
    return;
  }
  void queryClient.invalidateQueries({ queryKey: socialKeys.moderation.reports.lists() });
  if (outcome.action === NO_REPORT_ACTION) return;
  void queryClient.invalidateQueries({ queryKey: socialKeys.moderation.hiddenPosts() });
  void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
  const postId = outcome.report.targetSnapshot?.postId;
  if (postId === undefined) return;
  void queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(postId) });
  void queryClient.invalidateQueries({ queryKey: socialKeys.posts.comments(postId) });
}

function noticeOf(outcome: ResolveReportOutcome): OutcomeNotice | null {
  if (outcome.kind === "failed") return { kind: "failed", reason: outcome.reason };
  const { status } = outcome.updated;
  return status === "open" ? null : { kind: "done", status };
}

function OutcomeNoticeBar({
  notice,
  onDismiss,
}: {
  notice: OutcomeNotice;
  onDismiss: () => void;
}): React.ReactElement {
  const { t } = useTranslation("social");
  // Kết cục lỗi (E1 · E6 · E9) là cuối cùng — KHÔNG truyền `onRetry`.
  if (notice.kind === "failed") {
    return <AdminErrorNotice reason={notice.reason} onDismiss={onDismiss} />;
  }
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <p className="text-sm text-foreground">
        {t(`admin.moderation.page.outcome.${notice.status}`)}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("admin.notice.dismiss")}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

interface ReportsPanelProps {
  search: ModerationRouteSearch;
  onSearchChange: (next: ModerationRouteSearch) => void;
}

function ReportsPanel({ search, onSearchChange }: ReportsPanelProps): React.ReactElement {
  const { t } = useTranslation("social");
  const queryClient = useQueryClient();
  const filterId = React.useId();
  const [resolving, setResolving] = React.useState<FeedReportDto | null>(null);
  const [notice, setNotice] = React.useState<OutcomeNotice | null>(null);

  const statusFilter = activeStatusFilter(search);
  const params = reportListParams(search);
  const query = useQuery({
    queryKey: socialKeys.moderation.reports.list(params),
    queryFn: () => socialModerationApi.listReports(params),
    // Luật 2 ở docblock: chỉ giữ trang cũ khi nó thuộc CÙNG bộ lọc.
    placeholderData: (previous: FeedReportPageDto | undefined, previousQuery) =>
      (previousQuery?.queryKey.at(-1) as ReportListParams | undefined)?.status === params.status
        ? keepPreviousData(previous)
        : undefined,
    // Hàng đợi kiểm duyệt cũ mà trông như mới là mời người ta xử lý báo cáo đã đổi trạng thái.
    staleTime: 0,
  });

  const go = (next: ModerationRouteSearch): void => {
    setNotice(null);
    onSearchChange(next);
  };

  const handleFilterChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = MODERATION_STATUS_FILTERS.find((value) => value === event.target.value);
    if (next !== undefined) go(searchForStatusFilter(search, next));
  };

  const handleOutcome = (outcome: ResolveReportOutcome): void => {
    setResolving(null);
    invalidateAfterOutcome(queryClient, outcome);
    setNotice(noticeOf(outcome));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={filterId} className="text-sm text-foreground">
          {t("admin.moderation.page.filterLabel")}
        </label>
        <select
          id={filterId}
          value={statusFilter}
          onChange={handleFilterChange}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {MODERATION_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {t(`admin.moderation.page.filter.${value}`)}
            </option>
          ))}
        </select>
      </div>

      {notice !== null && !query.isError && (
        <OutcomeNoticeBar notice={notice} onDismiss={() => setNotice(null)} />
      )}

      <ReportQueue
        page={query.data}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.isError ? query.error : null}
        statusFilter={statusFilter}
        onRetry={() => void query.refetch()}
        onPageChange={(page) => go(searchForPage(search, page))}
        onResolve={(report) => {
          setNotice(null);
          setResolving(report);
        }}
      />

      {resolving !== null && (
        <ResolveReportDialog
          key={resolving.id}
          report={resolving}
          onClose={() => setResolving(null)}
          onOutcome={handleOutcome}
        />
      )}
    </section>
  );
}

export function ModerationPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  // Lọc lại bằng CHÍNH `validateSearch` của route: màn không phụ thuộc việc route đã nối validator hay chưa.
  const search = validateModerationRouteSearch(useSearch({ strict: false }));

  const handleSearchChange = (next: ModerationRouteSearch): void => {
    // `to: "."` = ở lại CHÍNH route đang mount màn này, chỉ thay search (thay TOÀN BỘ, không gộp với
    // search cũ: `next` luôn mang đủ ba khoá). Màn không tự chép đường dẫn của mình — `path` chỉ khai
    // một chỗ, ở `router.tsx`.
    const nextSearch: Record<string, unknown> = { ...next };
    void navigate({ to: ".", search: () => nextSearch });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("admin.moderation.page.title")}</h1>
      <ReportsPanel search={search} onSearchChange={handleSearchChange} />
    </div>
  );
}
