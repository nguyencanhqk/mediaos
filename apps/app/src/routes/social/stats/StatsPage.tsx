/**
 * S16-SOCIAL-FE-3B (L5) — màn Thống kê tương tác `SOC-SCREEN-011`: đọc `SOCIAL-API-052` theo khoảng tuần +
 * đơn vị của URL, vẽ bộ lọc · dải thẻ · biểu đồ xu hướng · bảng «Theo tuần» · bảng «Theo đơn vị», và nút
 * «Xuất Excel» (`053`).
 *
 * Cổng: màn KHÔNG có cổng riêng. Route gác `view:feed` + `view:feed-report`; 052 và 053 chung cặp đó (plan
 * M6) — ai vào được màn thì xem và xuất được. Phạm vi ĐƠN VỊ do server ép: đơn vị ngoài phạm vi ⇒ 403 mang
 * mã riêng, màn đưa lối «Bỏ lọc đơn vị». Số liệu vẽ NGUYÊN như server trả — màn không tự lọc, không tự che.
 *
 * NĂM LUẬT của màn:
 *  1. Mặc định KHÔNG gửi `from` / `to`: server chọn 8 tuần tới hết tuần hiện tại theo giờ công ty. Nhãn
 *     khoảng và số tuần trên màn lấy từ `range` của RESPONSE, không từ URL (server mới là nơi nắn về tuần ISO).
 *  2. Tham số 052 / 053 và search kế tiếp CHỈ suy bằng hàm thuần của `stats-route-search`.
 *  3. 200 RỖNG (`units: []` + `rows: []`) = người xem chưa có đơn vị nào trong phạm vi — câu riêng, KHÔNG phải
 *     «không có quyền» (đó là 403). Có đơn vị mà toàn số 0 thì vẫn vẽ bảng số 0.
 *  4. ĐANG LỖI ⇒ chỉ còn dải lỗi: số liệu của lượt trước (kể cả bản còn trong cache) đứng dưới dải lỗi đọc
 *     như số liệu của bộ lọc đang chọn.
 *  5. Lúc đang tải chỉ giữ SỐ LIỆU cũ khi CÙNG bộ lọc đơn vị (`isEngagementKeyOfSameUnit`); trong lúc đó vùng
 *     số liệu mang `aria-busy` và nút xuất khoá — tham số đã đổi, thứ trên màn chưa. Đổi ĐƠN VỊ thì vùng số
 *     liệu nhường chỗ cho khung chờ, còn THANH BỘ LỌC ở lại (dựng từ lượt đọc xong gần nhất — `units` không
 *     đổi theo bộ lọc đơn vị): gỡ ô «Đơn vị» đang thao tác là đẩy focus về `body` sau MỖI lần chọn.
 */
import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import { socialKeys, socialStatsApi } from "@mediaos/web-core";
import type { FeedEngagementResponseDto } from "@mediaos/contracts";
import { PLACEHOLDER_CLASS, SKELETON_ROWS } from "../moderation/components/list-states";
import { EngagementTrendChart } from "./components/EngagementTrendChart";
import { ExportEngagementButton } from "./components/ExportEngagementButton";
import { StatsFilters } from "./components/StatsFilters";
import { StatsLoadError } from "./components/StatsLoadError";
import { StatsSummary } from "./components/StatsSummary";
import { UnitTotalsTable } from "./components/UnitTotalsTable";
import { WeekTotalsTable } from "./components/WeekTotalsTable";
import { isEngagementEmpty, unitTotals } from "./lib/stats-aggregate";
import { describeStatsError } from "./lib/stats-errors";
import {
  engagementParams,
  hasCustomRange,
  isEngagementKeyOfSameUnit,
  isSameStatsSearch,
  searchForOrgUnit,
  searchForRange,
  validateStatsRouteSearch,
  type StatsRouteSearch,
} from "./lib/stats-route-search";

function StatsSkeleton(): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <div
      role="status"
      aria-label={t("admin.stats.page.loadingAria")}
      className="flex flex-col gap-3"
    >
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="h-24 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

interface TableSectionProps {
  /** Tiêu đề NHÌN THẤY của bảng; tên trợ năng của bảng là `<caption>` của chính nó. */
  title: string;
  children: React.ReactNode;
}

function TableSection({ title, children }: TableSectionProps): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h2 aria-hidden="true" className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface StatsDataProps {
  data: FeedEngagementResponseDto;
  /** Đơn vị đang lọc (từ URL). */
  orgUnitId: string | undefined;
  /** Số liệu đang vẽ là của khoảng TRƯỚC, lượt đọc khoảng mới chưa về (luật 5). */
  isStale: boolean;
}

function StatsData({ data, orgUnitId, isStale }: StatsDataProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <div
      data-testid="stats-data"
      aria-busy={isStale ? true : undefined}
      className={cn("flex flex-col gap-4", isStale && "opacity-60")}
    >
      <StatsSummary weekTotals={data.weekTotals} />
      <EngagementTrendChart weekTotals={data.weekTotals} />
      <TableSection title={t("admin.stats.weekTable.caption")}>
        <WeekTotalsTable weekTotals={data.weekTotals} />
      </TableSection>
      <TableSection title={t("admin.stats.unitTable.caption")}>
        <UnitTotalsTable rows={unitTotals(data, orgUnitId)} />
      </TableSection>
    </div>
  );
}

export function StatsPage(): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  // Lọc lại bằng CHÍNH `validateSearch` của route: màn không phụ thuộc việc route đã nối validator hay chưa.
  const search = validateStatsRouteSearch(useSearch({ strict: false }));
  const params = engagementParams(search);

  const query = useQuery({
    queryKey: socialKeys.stats.engagement(params),
    queryFn: () => socialStatsApi.engagement(params),
    // Luật 5.
    placeholderData: (previous: FeedEngagementResponseDto | undefined, previousQuery) =>
      isEngagementKeyOfSameUnit(previousQuery?.queryKey, params)
        ? keepPreviousData(previous)
        : undefined,
    // Số liệu cũ mà trông như mới là báo cáo sai: mỗi lần vào màn đọc lại.
    staleTime: 0,
  });

  // `to: "."` = ở lại CHÍNH route đang mount màn này, thay TOÀN BỘ search (search kế tiếp luôn đủ ba khoá).
  // Đích TRÙNG search đang đứng ⇒ navigate không đổi khoá, không lượt đọc nào chạy: đọc lại thay vì đứng im.
  // Ca thật: tab mở ở URL mặc định qua ranh tuần — số liệu còn của tuần trước, › mở, mà đích của nó (8 tuần
  // tới hết tuần hiện tại) lại chính là URL mặc định.
  const go = (next: StatsRouteSearch): void => {
    if (isSameStatsSearch(next, search)) {
      void query.refetch();
      return;
    }
    void navigate({ to: ".", search: next });
  };

  // Luật 4: lỗi thắng mọi thứ đang có trong cache.
  const data = query.isError ? undefined : query.data;
  const isShowingCurrent = data !== undefined && !query.isPlaceholderData;
  // Nút xuất không có cổng riêng — chỉ khoá khi CHƯA có số liệu của đúng thứ đang xem (hoặc đang xuất).
  const exportRange = isShowingCurrent && !isEngagementEmpty(data) ? data.range : null;

  // Lượt đọc XONG gần nhất — nguồn của thanh bộ lọc khi vùng số liệu đang là khung chờ (luật 5). Cập nhật
  // ngay trong lượt vẽ (khuôn «đổi state theo dữ liệu vừa tới» của React), không qua effect: không có nhịp
  // nào thanh bộ lọc vắng mặt giữa hai lượt đọc.
  const [lastSettled, setLastSettled] = React.useState<FeedEngagementResponseDto>();
  if (isShowingCurrent && data !== lastSettled) setLastSettled(data);
  // Luật 4: đang lỗi thì không còn gì của lượt trước, kể cả bộ lọc.
  const filterSource = query.isError ? undefined : (data ?? lastSettled);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">{t("admin.stats.page.title")}</h1>
        <ExportEngagementButton params={params} range={exportRange} />
      </div>

      {query.isError && (
        <StatsLoadError
          outcome={describeStatsError(query.error, params)}
          isRetrying={query.isFetching}
          onRetry={() => void query.refetch()}
          onClearOrgUnit={() => go(searchForOrgUnit(search, undefined))}
          onResetRange={() => go(searchForRange(search, null))}
        />
      )}
      {filterSource !== undefined && !isEngagementEmpty(filterSource) && (
        <StatsFilters
          range={filterSource.range}
          units={filterSource.units}
          orgUnitId={search.orgUnitId}
          isCustomRange={hasCustomRange(search)}
          onRangeChange={(range) => go(searchForRange(search, range))}
          onOrgUnitChange={(orgUnitId) => go(searchForOrgUnit(search, orgUnitId))}
        />
      )}
      {!query.isError && data === undefined && <StatsSkeleton />}
      {data !== undefined && isEngagementEmpty(data) && (
        <p data-testid="stats-empty-scope" className={PLACEHOLDER_CLASS}>
          {t("admin.stats.page.emptyScope")}
        </p>
      )}
      {data !== undefined && !isEngagementEmpty(data) && (
        <StatsData data={data} orgUnitId={search.orgUnitId} isStale={query.isPlaceholderData} />
      )}
    </div>
  );
}
