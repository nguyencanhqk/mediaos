/**
 * S16-SOCIAL-FE-3C (L7) — chỗ cắm widget DASH «Tổng quan nhân sự» ở CUỐI rail phải của bảng tin
 * (UI-07 §34b.2 «(theo quyền)» · SPEC-07 §14.8 · plan D15 · D16 · owner ký O1 = B ngày 05/10/2026).
 *
 * ┌─ 🔴 CỔNG NGOÀI: ĐỦ BỐN CẶP, KHỚP ĐÚNG-BẰNG ──────────────────────────────────────────────────────────┐
 * │ `view:feed`        ô nằm trong vỏ bảng tin — cùng cặp với năm widget rail còn lại.                   │
 * │ `read:dashboard`   cặp mà route dữ liệu widget (`GET /dashboard/widgets/:slug`) đòi.                 │
 * │ `read:employee`    cặp server gác riêng widget này (`DASH_WIDGET_GATE_PAIR.HR_OVERVIEW`).            │
 * │ `update:employee`  vế PHÂN BIỆT: trong bốn vai chuẩn chỉ HR và company-admin giữ nó.                 │
 * │                                                                                                      │
 * │ Ba cặp đầu MỌI vai chuẩn đều có, và server không đặt sàn phạm vi cho widget này: nhân viên gọi đường │
 * │ dữ liệu không bị từ chối — phép đếm chỉ co về phạm vi của họ (Own = chính họ). Thiếu vế thứ tư thì   │
 * │ ai cũng thấy một ô «nhân sự» vô nghĩa và ai cũng phát một request DASH khi mở bảng tin. Vì thế cổng  │
 * │ ở đây CHẶT HƠN server có chủ ý — và loại luôn quản lý: nhánh «phạm vi Department chỉ thấy phòng      │
 * │ mình» của SPEC-07 §14.8 chờ server có sàn phạm vi + tín hiệu cho FE — nợ                             │
 * │ `S4-DASH-HROVERVIEW-FLOOR-1`. Khi nợ đó đóng, bỏ vế `update:employee` ở ĐÂY.                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `useCanExact`, không `useCan` / `<PermissionGate>`: chỉ cặp ĐÍCH DANH mới mở cổng. Người chỉ cầm wildcard
 * (`*:*`) không phải «HR hoặc company-admin» theo chữ ký của owner, và route `/feed*` cũng khớp đúng-bằng.
 *
 * Vì sao BỌC NGOÀI mà không sửa `HrOverviewWidget`: cổng trong của nó (`PermissionGate(read:employee)`, nhận
 * wildcard) là cổng của ô trên màn Dashboard — siết ở đó là đổi luôn hành vi của màn ấy. Vế `read:employee`
 * ở đây vì vậy KHÔNG thừa: nó là vế duy nhất chặn người có ba cặp kia mà chỉ đọc hồ sơ qua wildcard.
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
 */
import { useCanExact } from "@mediaos/web-core";
import { HrOverviewWidget } from "@/components/dashboard/HrOverviewWidget";
import { DASH_READ_PAIR, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";

/**
 * Cặp đọc bảng tin (seed `0578`, cấp cho cả bốn vai chuẩn). Cụm SOCIAL chưa có file hằng cặp — các màn khác
 * gọi `useCan("view", "feed")` bằng literal; khai tên ở đây để bốn vế của cổng cùng một hình dạng.
 */
const FEED_VIEW_PAIR = { action: "view", resourceType: "feed" } as const;

export function HrOverviewRailSlot(): React.ReactElement | null {
  const widgetPair = DASH_WIDGET_GATE_PAIR.HR_OVERVIEW;
  const hrStaffPair = HR_ENGINE_PAIRS.UPDATE_EMPLOYEE;

  // Bốn hook gọi VÔ ĐIỀU KIỆN rồi mới AND: `a && useCanExact(…)` là gọi hook có điều kiện.
  const canViewFeed = useCanExact(FEED_VIEW_PAIR.action, FEED_VIEW_PAIR.resourceType);
  const canReadDashboard = useCanExact(DASH_READ_PAIR.action, DASH_READ_PAIR.resourceType);
  const canReadEmployees = useCanExact(widgetPair.action, widgetPair.resourceType);
  const canUpdateEmployees = useCanExact(hrStaffPair.action, hrStaffPair.resourceType);

  if (!(canViewFeed && canReadDashboard && canReadEmployees && canUpdateEmployees)) return null;

  return <HrOverviewWidget />;
}
