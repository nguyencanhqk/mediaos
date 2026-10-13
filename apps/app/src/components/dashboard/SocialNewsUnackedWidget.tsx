/**
 * SocialNewsUnackedWidget — «Tin tức chưa đọc» (SPEC-16 §17.3 SOCIAL-WIDGET-002, S16-SOCIAL-DASH-1).
 * widget_code=SOCIAL_NEWS_UNACKED, slug=social-news-unacked, module nguồn SOCIAL, mig 0592.
 *
 * Data: apps/api dashboard-widget-social.handlers.ts `fetchNewsUnacked()` → `{ total }` — số tin YÊU CẦU XÁC
 * NHẬN mà CHÍNH người xem chưa xác nhận (`unackedCount` của SOCIAL-API-020 ở chế độ `countOnly`, không nạp
 * hàng tin nào). KHÔNG tiêu đề tin, KHÔNG tên người. `total === 0` ⇒ BE trả `Empty` — widget vẫn hiện, với
 * chữ «đã xác nhận hết» (trạng thái ĐẸP, không phải lỗi).
 *
 * AI THẤY WIDGET: BE ép SÀN scope 'Company' cho GRANT (khớp sàn của route nguồn 020) — «Own» trong catalog
 * là NHÃN DỮ LIỆU (đếm cho chính người gọi), không phải phạm vi của grant. Ai không có `view:feed@Company`
 * KHÔNG nhận widget trong GET /dashboard/me ⇒ Grid không mount ⇒ KHÔNG gọi API. Gate ở component chỉ kiểm
 * được CẶP (capabilities không mang scope) ⇒ gate PHỤ.
 *
 * ⚠️ `useCanExact`, KHÔNG <PermissionGate> — nhưng lý do KHÁC ba widget PAYROLL: ('view','feed') KHÔNG phải
 * cặp nhạy cảm (seed 0578). Khớp đúng-bằng là để giống bộ gác route `/feed*` (đích `/feed/news` chỉ nhận cặp
 * đích danh): `useCan` sẽ cho người chỉ cầm wildcard `*:*` thấy ô rồi bấm vào tường. Cặp gate của widget
 * TRÙNG cặp của đích ⇒ nút dẫn không cần cổng riêng.
 *
 * Nút dẫn mở `/feed/news` TRẦN: màn Tin tức chưa có bộ lọc «chưa xác nhận» qua URL (nợ N1 của plan).
 *
 * KHÔNG CACHE phía server (TTL 0 + `Cache-Control: no-store`); ở FE con số có thể cũ tối đa 15 giây —
 * `staleTime` chung của mọi widget (`useDashboardWidget.ts`): vừa xác nhận một tin rồi quay lại Dashboard
 * trong khoảng đó vẫn thấy số cũ.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useCanExact } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { socialNewsUnackedWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

/** Đích nút dẫn — màn Tin tức. Cast `as "/"` như PayrollCostWidget (xem ghi chú ở đó). */
const SOCIAL_NEWS_PATH = "/feed/news" as "/";

interface SocialNewsUnackedWidgetProps {
  dashboardType?: DashboardTypeValue;
}

/**
 * Thân thẻ khi `Active`: MỘT nút phủ cả con số lẫn dòng mời bấm (khuôn PayrollAdvancePendingWidget). Bên
 * trong nút dùng `span` khối chứ không `p`: `<button>` chỉ được chứa phrasing content.
 */
function NewsUnackedBody({ total }: { total: number }) {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: SOCIAL_NEWS_PATH })}
      className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-muted/50"
    >
      <span className="block tabular-nums text-3xl font-semibold text-foreground">
        <span data-testid="social-news-unacked-total">{total}</span>{" "}
        <span className="text-xs font-normal text-muted-foreground">
          {t("dashboard:socialNewsUnacked.countLabel", { count: total })}
        </span>
      </span>
      <span className="block text-xs text-muted-foreground">
        {t("dashboard:socialNewsUnacked.cta")}
      </span>
    </button>
  );
}

function SocialNewsUnackedWidgetInner({ dashboardType }: SocialNewsUnackedWidgetProps) {
  const { t } = useTranslation(["dashboard"]);
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.SOCIAL_NEWS_UNACKED,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? socialNewsUnackedWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);
  // Fail-closed: không rỗng mà cũng không có ruột vẽ được (`Active` thiếu payload · query bị tạm dừng lúc
  // offline nên `data` vắng) là LỖI — không để thẻ chỉ còn tiêu đề.
  const bodyMissing = !isLoading && status !== "Empty" && !parsed?.success;

  // `Hidden` = server bảo đừng vẽ. Mọi hook đã được gọi ở trên nên trả `null` ở đây an toàn.
  if (status === "Hidden") return null;

  return (
    <WidgetCard
      title={t("dashboard:socialNewsUnacked.title")}
      icon={Megaphone}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed || bodyMissing}
      isEmpty={status === "Empty"}
      emptyTitle={
        emptyMsg.success ? emptyMsg.data.message : t("dashboard:socialNewsUnacked.empty.title")
      }
      errorTitle={data?.error_state?.message ?? t("dashboard:widget.error.title")}
      errorDescription={t("dashboard:widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && <NewsUnackedBody total={parsed.data.total} />}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — thiếu `view:feed` ⇒ KHÔNG render (KHÔNG fetch). `useCanExact` chứ KHÔNG <PermissionGate>:
 * khớp đúng-bằng như bộ gác route `/feed*` (xem doc-block đầu file — KHÔNG phải vì cặp nhạy cảm). Gate PHỤ —
 * cổng THẬT (cặp + sàn scope 'Company') nằm ở BE. Hook fetch nằm trong `Inner` nên trả `null` ở đây là không
 * có `useQuery` nào chạy.
 */
export function SocialNewsUnackedWidget(props: SocialNewsUnackedWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.SOCIAL_NEWS_UNACKED;
  const allowed = useCanExact(pair.action, pair.resourceType);
  if (!allowed) return null;
  return <SocialNewsUnackedWidgetInner {...props} />;
}
