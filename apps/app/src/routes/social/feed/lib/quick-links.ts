/**
 * S16-SOCIAL-FE-3C (L6) — «dải ô liên kết nhanh» của bảng tin: CHỌN app nào được vẽ (SPEC-16 SC-14 · plan D14).
 *
 * 🔴 FILE NÀY KHÔNG NÊU MỘT CẶP QUYỀN NÀO — và phải giữ như vậy. Hằng dưới chỉ mang `appKey` + THỨ TỰ; nhãn ·
 * icon · đích · CỔNG của từng ô lấy 100% từ mục tương ứng của `APP_REGISTRY`, qua đúng hàm mà AppSwitcher
 * dùng (`getVisibleApps`). Hệ quả có chủ đích:
 *  · ô «Đăng bài Facebook» gác ĐÚNG MỘT cặp registry khai cho `fbpost` — khớp cổng của endpoint SSO (xem
 *    docblock `SocialFbpostLink`); viết lại cổng ở đây là có ô hiện ra rồi bấm vào ăn 403;
 *  · ô «Phòng họp» đòi ĐỦ hai cặp, vì registry khai `requiredPermissions` chứ không phải any-of;
 *  · đổi cổng của một app ⇒ sửa MỘT chỗ (registry), dải tự theo.
 *
 * `getVisibleApps`, KHÔNG phải `getHomeGridApps`: hàm sau bỏ các ô `switcherOnly` (hôm nay là `fbpost`) —
 * bộ lọc đó thuộc về lưới ô Home, còn SC-14 liệt «Đăng bài Facebook» đích danh trong dải.
 */
import {
  getVisibleApps,
  type AppRegistryItem,
  type ModuleStatus,
  type PermissionChecker,
  type SessionContext,
} from "@mediaos/web-core";

/**
 * App của dải, theo đúng thứ tự SC-14: Công việc · Nghỉ phép · Chấm công · Phòng họp · Mục tiêu · Đào tạo ·
 * Đăng bài Facebook. Thứ tự VẼ đi theo hằng này, không theo `order` của registry (đó là thứ tự của lưới Home).
 */
export const FEED_QUICK_LINK_APP_KEYS = [
  "tasks",
  "leave",
  "attendance",
  "rooms",
  "goals",
  "lms",
  "fbpost",
] as const;

const USABLE_STATUS: ModuleStatus = "active";

/** Trạng thái HIỆU LỰC — cùng phép tính với `getVisibleApps`: module của phiên (nếu có) đè hằng registry. */
function effectiveStatus(app: AppRegistryItem, session: SessionContext): ModuleStatus {
  return session.modules.find((mod) => mod.moduleCode === app.moduleCode)?.status ?? app.status;
}

/**
 * Ô của dải = app thuộc hằng, ĐANG DÙNG ĐƯỢC, và người xem có quyền registry đòi.
 *
 * 🔴 Vì sao còn lọc `active` sau `getVisibleApps`: hàm đó trả CẢ app `coming_soon` / `locked` / `maintenance`
 * mà KHÔNG kiểm quyền (lưới Home vẽ chúng thành thẻ mờ «Sắp ra mắt»). Dải này chỉ có liên kết bấm được —
 * để lọt một app như thế là vẽ một ô cho người không có quyền, trỏ vào màn chưa mở.
 * Hai vế, và cần cả hai:
 *  · `app.status` — hằng registry: FE đã có màn dùng được hay chưa;
 *  · trạng thái hiệu lực — module bị khoá ở phiên thì `getVisibleApps` cũng bỏ qua bước kiểm quyền.
 *    Hôm nay phiên của portal luôn mang `modules: []` (`portal-session.ts`) nên hai vế trùng nhau; ngày
 *    `/auth/me` trả module mà thiếu vế này là ô hiện ra không qua cổng quyền.
 *
 * Nhận registry làm THAM SỐ (không import thẳng hằng) để spec đưa được bản sao có app chưa `active` vào.
 */
export function pickQuickLinkApps(
  apps: readonly AppRegistryItem[],
  session: SessionContext,
  checker: PermissionChecker,
): AppRegistryItem[] {
  const usable = getVisibleApps(apps, session, checker).filter(
    (app) => app.status === USABLE_STATUS && effectiveStatus(app, session) === USABLE_STATUS,
  );
  return FEED_QUICK_LINK_APP_KEYS.flatMap((key) => {
    const app = usable.find((candidate) => candidate.appKey === key);
    return app ? [app] : [];
  });
}
