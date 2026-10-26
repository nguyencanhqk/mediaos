/**
 * Làm mới cache sau khi server XÁC NHẬN check-in/check-out (useCheckIn/useCheckOut).
 *
 * Khoá ATT (today, my-records) tải lại ngay như cũ. Riêng tiền tố widget dashboard (`dashboardKeys.widgets.all`)
 * chỉ bị ĐÁNH DẤU cũ (`refetchType: "none"`), không GET lại ngay: server không xoá cache widget khi check-in/out
 * (`DASH_CACHE_INVALIDATION_MAP` không có sự kiện check-in/out), nên GET thường ngay sau đó chỉ trả lại bản cache
 * cũ. Trên /dashboard đó từng là 6 request vô ích sau một lần check-in (S20-DASH-QUICKACTION-1, lượt đo trình
 * duyệt). Widget chấm công tự tải `refresh=true` sau khi server xác nhận (WidgetCardAttendanceActions →
 * `onConfirmed`); widget khác tải lại ở lần mount/focus kế như mọi query đã cũ. Trên màn Chấm công các query
 * widget không hoạt động ⇒ hành vi giữ nguyên (query không hoạt động vốn chỉ bị đánh dấu cũ).
 */
import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { dashboardKeys } from "@mediaos/web-core";

export async function invalidateAfterCheck(
  queryClient: QueryClient,
  keys: readonly QueryKey[],
): Promise<void> {
  const dashboardWidgetsHash = hashKey(dashboardKeys.widgets.all);
  for (const key of keys) {
    const isDashboardWidgets = hashKey(key) === dashboardWidgetsHash;
    await queryClient.invalidateQueries({
      queryKey: key,
      refetchType: isDashboardWidgets ? "none" : "active",
    });
  }
}
