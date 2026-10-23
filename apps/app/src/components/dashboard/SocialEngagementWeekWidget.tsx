/**
 * SocialEngagementWeekWidget — «Tương tác tuần» (SPEC-16 §17.3 SOCIAL-WIDGET-001, S16-SOCIAL-DASH-1).
 * widget_code=SOCIAL_ENGAGEMENT_WEEK, slug=social-engagement-week, module nguồn SOCIAL, mig 0592.
 *
 * Data: apps/api dashboard-widget-social.handlers.ts `fetchEngagementWeek()` → { weekStart, posts, comments,
 * reactions, activeMembers } của TUẦN HIỆN TẠI — nguyên `FeedEngagementWeekDto` mà
 * `SocialStatsService.weeklyEngagementForWidget` trả (hàng tổng tuần cuối của SOCIAL-API-052, cùng câu SQL
 * với màn Thống kê tương tác). FE KHÔNG cộng, KHÔNG suy ra số nào: bốn số in nguyên như server gửi. Bài +
 * bình luận + cảm xúc bằng 0 ⇒ BE trả `Empty` (thẻ hiện chữ, không hiện bốn số 0).
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Department' (DASH_WIDGET_MIN_DATA_SCOPE) — quản lý cầm
 * `view:feed-report@Department` thấy số của đơn vị mình, HR / company-admin @Company thấy số toàn công ty;
 * grant Own / Team KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid không mount ⇒ KHÔNG gọi API. Gate ở
 * component chỉ kiểm được CẶP (capabilities không mang scope) nên là gate PHỤ, KHÔNG phải cổng thật.
 *
 * ⚠️ `useCanExact`, KHÔNG <PermissionGate> — nhưng lý do KHÁC ba widget PAYROLL: ('view','feed-report')
 * KHÔNG phải cặp nhạy cảm (seed 0578). Khớp đúng-bằng là để giống bộ gác route `/feed*`, nơi chỉ cặp đích
 * danh mới mở cổng: `useCan` sẽ cho người chỉ cầm wildcard `*:*` thấy ô rồi bấm vào tường.
 *
 * ⚠️ NÚT DẪN chỉ vẽ khi có THÊM `view:feed`: đích `/feed/stats` đòi ĐỦ hai cặp (ROUTE_REGISTRY
 * `social.stats` — `["view:feed", "view:feed-report"]`). Thiếu `view:feed` thì bốn số vẫn hiện (server đã
 * cho xem), chỉ không mời bấm vào một màn chắc chắn 403.
 *
 * ⚠️ `weekStart` là NGÀY LỊCH do server tính theo múi giờ CÔNG TY. FE chỉ tách chuỗi để đổi thứ tự hiển thị,
 * KHÔNG dùng `Date` để định dạng hay đọc bằng getter local: FE không biết múi giờ công ty, và nửa đêm UTC
 * đọc bằng getter local ở máy múi âm là lùi một ngày. `Date` chỉ có mặt trong phép kiểm «ngày có thật» bằng
 * số học UTC. Chuỗi không đúng dạng ⇒ nhánh LỖI, không vẽ rác (xem `formatWeekStart`).
 *
 * KHÔNG CACHE phía server (SOC-DEC-010: TTL 0 + `Cache-Control: no-store`); ở FE con số có thể cũ tối đa 15
 * giây — `staleTime` chung của mọi widget (`useDashboardWidget.ts`).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { Button } from "@mediaos/ui";
import { useCanExact } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import {
  DASH_SOCIAL_ENGINE_PAIRS,
  DASH_WIDGET_CODE,
  DASH_WIDGET_GATE_PAIR,
} from "@/routes/dashboard/constants";
import {
  socialEngagementWeekWidgetDataSchema,
  widgetMessageSchema,
  type SocialEngagementWeekWidgetData,
} from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích nút dẫn — màn Thống kê tương tác. Cast `as "/"` như PayrollCostWidget (xem ghi chú ở đó). */
const SOCIAL_STATS_PATH = "/feed/stats" as "/";

/**
 * Bốn ô số theo thứ tự hiển thị. `field` = khoá của payload · `labelKey` = khoá i18n · `testId` để spec đọc
 * ĐÚNG ô (bốn số có thể trùng giá trị nên không tìm theo chữ được).
 */
const ENGAGEMENT_METRICS = [
  {
    field: "posts",
    labelKey: "dashboard:socialEngagementWeek.posts",
    testId: "social-engagement-posts",
  },
  {
    field: "comments",
    labelKey: "dashboard:socialEngagementWeek.comments",
    testId: "social-engagement-comments",
  },
  {
    field: "reactions",
    labelKey: "dashboard:socialEngagementWeek.reactions",
    testId: "social-engagement-reactions",
  },
  {
    field: "activeMembers",
    labelKey: "dashboard:socialEngagementWeek.activeMembers",
    testId: "social-engagement-active-members",
  },
] as const;

/** Ngày lịch `YYYY-MM-DD` — cùng dạng với `isoDateSchema` của hợp đồng 052 (contracts social-api-stats.ts). */
const ISO_DATE_PATTERN = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * `YYYY-MM-DD` ⇒ `DD/MM/YYYY` bằng TÁCH CHUỖI (`Date` chỉ để kiểm ngày có thật — xem doc-block đầu file). Chuỗi không đúng
 * dạng ⇒ `null` để nơi gọi rơi về nhánh lỗi. Không dùng `formatStatsDate` của màn Thống kê tương tác: hàm đó
 * trả NGUYÊN VĂN chuỗi sai dạng, tức là vẽ thẳng thứ server gửi nhầm ra thẻ.
 */
function formatWeekStart(weekStart: string): string | null {
  const match = ISO_DATE_PATTERN.exec(weekStart);
  if (match === null) return null;
  const [, year, month, day] = match;
  // Ngày lịch phải TỒN TẠI (30/02 khớp regex nhưng không có thật). Số học UTC chỉ để XÁC THỰC — không dùng
  // `Date` để định dạng hay đổi múi giờ.
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (probe.getUTCMonth() !== Number(month) - 1 || probe.getUTCDate() !== Number(day)) return null;
  return `${day}/${month}/${year}`;
}

interface SocialEngagementWeekWidgetProps {
  dashboardType?: DashboardTypeValue;
}

interface EngagementWeekBodyProps {
  week: SocialEngagementWeekWidgetData;
  /** `weekStart` đã đổi sang `DD/MM/YYYY`. */
  weekStartLabel: string;
}

/** Thân thẻ khi `Active`: dòng tuần · bốn cặp nhãn/số (`dt`/`dd`) · nút dẫn theo quyền. */
function EngagementWeekBody({ week, weekStartLabel }: EngagementWeekBodyProps) {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();
  // Vế THỨ HAI mà đích `/feed/stats` đòi (vế đầu `view:feed-report` là cổng ngoài của chính widget).
  const feedEntryPair = DASH_SOCIAL_ENGINE_PAIRS.FEED_VIEW;
  const canOpenStats = useCanExact(feedEntryPair.action, feedEntryPair.resourceType);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("dashboard:socialEngagementWeek.weekOf", { date: weekStartLabel })}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {ENGAGEMENT_METRICS.map((metric) => (
          <div key={metric.field}>
            <dt className="text-xs text-muted-foreground">{t(metric.labelKey)}</dt>
            <dd
              data-testid={metric.testId}
              className="tabular-nums text-2xl font-semibold text-foreground"
            >
              {week[metric.field]}
            </dd>
          </div>
        ))}
      </dl>
      {canOpenStats && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-1 text-xs"
          onClick={() => void navigate({ to: SOCIAL_STATS_PATH })}
        >
          {t("dashboard:socialEngagementWeek.cta")}
        </Button>
      )}
    </div>
  );
}

function SocialEngagementWeekWidgetInner({ dashboardType }: SocialEngagementWeekWidgetProps) {
  const { t } = useTranslation(["dashboard"]);
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.SOCIAL_ENGAGEMENT_WEEK,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? socialEngagementWeekWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  // `weekStart` qua được schema (`z.string()`) chưa chắc là ngày lịch: không tách được thì coi như payload sai
  // hình, rơi về nhánh LỖI cùng parse-fail — không vẽ bốn số cạnh một dòng «Tuần từ …» rác.
  const week = parsed?.success ? parsed.data : null;
  const weekStartLabel = week ? formatWeekStart(week.weekStart) : null;
  const weekStartInvalid = week !== null && weekStartLabel === null;
  // Fail-closed: không rỗng mà cũng không có ruột vẽ được (`Active` thiếu payload · query bị tạm dừng lúc
  // offline nên `data` vắng) là LỖI — không để thẻ chỉ còn tiêu đề.
  const bodyMissing =
    !isLoading && status !== "Empty" && (week === null || weekStartLabel === null);

  // `Hidden` = server bảo đừng vẽ. Mọi hook đã được gọi ở trên nên trả `null` ở đây an toàn.
  if (status === "Hidden") return null;

  return (
    <WidgetCard
      title={t("dashboard:socialEngagementWeek.title")}
      icon={BarChart3}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed || weekStartInvalid || bodyMissing}
      isEmpty={status === "Empty"}
      emptyTitle={
        emptyMsg.success ? emptyMsg.data.message : t("dashboard:socialEngagementWeek.empty.title")
      }
      errorTitle={data?.error_state?.message ?? t("dashboard:widget.error.title")}
      errorDescription={t("dashboard:widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {week !== null && weekStartLabel !== null && (
        <EngagementWeekBody week={week} weekStartLabel={weekStartLabel} />
      )}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — thiếu `view:feed-report` ⇒ KHÔNG render (KHÔNG fetch). `useCanExact` chứ KHÔNG
 * <PermissionGate>: khớp đúng-bằng như bộ gác route `/feed*` (xem doc-block đầu file — KHÔNG phải vì cặp
 * nhạy cảm). Gate PHỤ — cổng THẬT (cặp + sàn scope 'Department') nằm ở BE. Hook fetch nằm trong `Inner` nên
 * trả `null` ở đây là không có `useQuery` nào chạy.
 */
export function SocialEngagementWeekWidget(props: SocialEngagementWeekWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.SOCIAL_ENGAGEMENT_WEEK;
  const allowed = useCanExact(pair.action, pair.resourceType);
  if (!allowed) return null;
  return <SocialEngagementWeekWidgetInner {...props} />;
}
