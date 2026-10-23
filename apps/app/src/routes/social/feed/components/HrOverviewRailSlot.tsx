/**
 * S16-SOCIAL-FE-3C (L7) · S4-DASH-HROVERVIEW-FE-1 — chỗ cắm widget DASH «Tổng quan nhân sự» ở CUỐI rail phải của
 * bảng tin (UI-07 §34b.2 «(theo quyền)» · SPEC-07 §14.8 · plan D15 · D16).
 *
 * ┌─ 🔴 CỔNG NGOÀI: BA CẶP KHỚP ĐÚNG-BẰNG + PHẠM VI ĐỌC HỒ SƠ ĐẠT SÀN ────────────────────────────────────┐
 * │ `view:feed`        ô nằm trong vỏ bảng tin — cùng cặp với năm widget rail còn lại.                   │
 * │ `read:dashboard`   cặp mà route dữ liệu widget (`GET /dashboard/widgets/:slug`) đòi.                 │
 * │ `read:employee`    cặp server gác riêng widget này (`DASH_WIDGET_GATE_PAIR.HR_OVERVIEW`).            │
 * │ phạm vi ≥ sàn      phạm vi của CHÍNH cặp `read:employee` (`/auth/me.scopes`) đạt                      │
 * │                    `DASH_WIDGET_MIN_DATA_SCOPE.HR_OVERVIEW` của `@mediaos/contracts`.                │
 * │                                                                                                      │
 * │ Ba cặp đầu MỌI vai chuẩn đều có (nhân viên @Own · quản lý @Team · HR / company-admin @Company), nên   │
 * │ vế phân biệt là PHẠM VI. Server ép CÙNG hằng sàn ở danh sách widget lẫn đường số liệu (dưới sàn ⇒    │
 * │ 403), nên ô chỉ mount khi lời gọi của nó được phép — không ai thấy một ô lỗi chắc chắn, không ai phát │
 * │ một request DASH vô ích mỗi lần mở bảng tin. Giá trị sàn KHÔNG chép sang đây: đổi ở contracts là đổi │
 * │ cổng của cả hai phía.                                                                                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Khớp ĐÚNG-BẰNG ở cả bốn vế: `useCanExact` cho ba cặp (không `useCan` / `<PermissionGate>` — người chỉ cầm
 * wildcard `*:*` không mở cổng, route `/feed*` cũng khớp đúng-bằng), và phạm vi chỉ đọc ở khoá `read:employee`
 * đích danh — phạm vi ghi trên khoá wildcard (`*:*`, `read:*`, `*:employee`) không tính. Phép so «đạt sàn» là
 * `hasScope` của web-core (thứ tự Own ⊂ Team ⊂ Department ⊂ Company ⊂ System; `Project` không xếp hạng).
 *
 * Vì sao BỌC NGOÀI mà không sửa `HrOverviewWidget`: cổng trong của nó (`PermissionGate(read:employee)`, nhận
 * wildcard) là cổng của ô trên màn Dashboard — siết ở đó là đổi luôn hành vi của màn ấy. Vế `read:employee`
 * ở đây vì vậy KHÔNG thừa: nó là vế duy nhất chặn người có các vế kia mà chỉ đọc hồ sơ qua wildcard.
 *
 * Thiếu một vế ⇒ trả `null`: `HrOverviewWidget` không mount ⇒ không có `useQuery` nào ⇒ không lời gọi DASH
 * nào (kể cả `/dashboard/me` — file này không hỏi server «có widget không») và không thẻ rỗng. KHÔNG gác bằng
 * `enabled: false`: query tắt vẫn để lại một thẻ có tiêu đề mà không có ruột.
 *
 * Không truyền `dashboardType`: chọn «HR» / «Admin» ở đây là suy vai người xem tại FE. Hệ quả: ô này và ô cùng
 * tên trên màn Dashboard giữ HAI mục cache riêng (ở FE lẫn ở server) nên hai con số có thể lệch nhau trong
 * thời gian cache của server.
 *
 * Cổng ở FE chỉ để KHÔNG vẽ và KHÔNG hỏi; quyền thật và phạm vi dữ liệu do server quyết ở mỗi lời gọi.
 *
 * VÙNG CÓ NHÃN: năm khối SOCIAL của rail là `<section aria-label>` (`PortalWidgetBlock`), còn thẻ của widget DASH tự
 * nó không khai vùng nào ⇒ slot bọc ô trong một `<section aria-label>` để ô có mặt trong danh sách vùng của trình đọc
 * màn hình như năm khối kia. Nhãn là CHÍNH khoá tiêu đề của widget (`dashboard:hrOverview.title`) — tên vùng không
 * lệch được khỏi chữ nhìn thấy. Khung bọc đứng SAU cổng (không đủ quyền ⇒ không có vùng rỗng) và không mang class
 * nào: bố cục vẫn do thẻ của widget tự lo. ⚠️ Tiêu đề trong thẻ vẫn là `<h3>` đứng sau năm `<h2>` của rail, đệm của
 * thẻ lớn hơn các khối bên cạnh — sửa gốc cần `WidgetCard` nhận cấp tiêu đề / biến thể gọn (nợ, ngoài WO này).
 */
import { useTranslation } from "react-i18next";
import { DASH_WIDGET_MIN_DATA_SCOPE } from "@mediaos/contracts";
import {
  createPermissionChecker,
  useAuthStore,
  useCanExact,
  type DataScope,
} from "@mediaos/web-core";
import { HrOverviewWidget } from "@/components/dashboard/HrOverviewWidget";
import { DASH_READ_PAIR, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";

/**
 * Cặp đọc bảng tin (seed `0578`, cấp cho cả bốn vai chuẩn). Cụm SOCIAL chưa có file hằng cặp — các màn khác
 * gọi `useCan("view", "feed")` bằng literal; khai tên ở đây để các vế của cổng cùng một hình dạng.
 */
const FEED_VIEW_PAIR = { action: "view", resourceType: "feed" } as const;

const WIDGET_PAIR = DASH_WIDGET_GATE_PAIR.HR_OVERVIEW;
/** Khoá của cặp trong `capabilities` / `scopes` của `/auth/me` — đích danh, không wildcard. */
const WIDGET_PAIR_KEY = `${WIDGET_PAIR.action}:${WIDGET_PAIR.resourceType}`;

/**
 * Phạm vi của ĐÚNG khoá `read:employee` có đạt sàn của widget không. Checker dựng từ MỘT khoá đó nên phạm vi
 * nằm trên khoá wildcard không bao giờ được tính; khoá vắng mặt ⇒ false.
 */
function meetsWidgetScopeFloor(scopes: Readonly<Record<string, readonly DataScope[]>>): boolean {
  const pairScopes = scopes[WIDGET_PAIR_KEY];
  if (!pairScopes) return false;
  return createPermissionChecker([
    { permission: WIDGET_PAIR_KEY, scopes: [...pairScopes] },
  ]).hasScope(WIDGET_PAIR_KEY, DASH_WIDGET_MIN_DATA_SCOPE.HR_OVERVIEW);
}

export function HrOverviewRailSlot(): React.ReactElement | null {
  const { t } = useTranslation("dashboard");

  // Bốn hook gọi VÔ ĐIỀU KIỆN rồi mới AND: `a && useCanExact(…)` là gọi hook có điều kiện. Selector phạm vi trả
  // boolean ⇒ ô chỉ render lại khi kết luận đổi, không phải mỗi lần store đổi.
  const canViewFeed = useCanExact(FEED_VIEW_PAIR.action, FEED_VIEW_PAIR.resourceType);
  const canReadDashboard = useCanExact(DASH_READ_PAIR.action, DASH_READ_PAIR.resourceType);
  const canReadEmployees = useCanExact(WIDGET_PAIR.action, WIDGET_PAIR.resourceType);
  const readsEmployeesAtFloor = useAuthStore((s) => meetsWidgetScopeFloor(s.scopes));

  if (!(canViewFeed && canReadDashboard && canReadEmployees && readsEmployeesAtFloor)) return null;

  return (
    <section aria-label={t("hrOverview.title")}>
      <HrOverviewWidget />
    </section>
  );
}
