import type { AppRegistryItem } from "@mediaos/web-core";
import { openLms } from "@/routes/lms/open-lms";
import { openSocial } from "@/routes/social/open-social";

/**
 * Map app CROSS-DOMAIN → hàm "mở vào thẳng" (S16-SOCIAL-FBPOST-1).
 *
 * App cross-domain không điều hướng nội bộ được: nó nằm ở origin khác và không có màn đăng nhập riêng,
 * nên phải lấy token SSO NGAY trong lúc bấm rồi `assign` sang đó. Mỗi `opener` nhận một `fallback` gọi
 * khi cầu SSO lỗi — rơi về trang trung chuyển của app đó để người dùng ĐỌC được lý do.
 *
 * 🔴 **Vì sao tách ra khỏi `AppSwitcher` thành map thuần:** nhánh cũ viết thẳng `if (app.appKey ===
 * "social")` trong component, và khi `S16-SOCIAL-FE-1` ĐỔI NGHĨA khoá `"social"` (từ vệ tinh fbpost
 * thành cổng thông tin nội bộ `/feed`) thì không cổng nào bắt được: chọn «Mạng xã hội» bị SSO đẩy ra
 * ứng dụng Facebook, còn «Đăng bài Facebook» thì rơi về trang trung chuyển. Tách thành dữ liệu thuần
 * để spec đo được ĐÚNG câu hỏi "khoá nào được coi là cross-domain", thay vì đếm chuỗi trong component.
 *
 * Khoá = `appKey` của `APP_REGISTRY`, **KHÔNG** phải `moduleCode`: ô `social` (cổng thông tin) và ô
 * `fbpost` (vệ tinh) dùng CHUNG `moduleCode: "SOCIAL"` — so theo module sẽ bắt cả hai.
 */
export const CROSS_DOMAIN_APP_OPENERS: Readonly<
  Record<string, (fallback: () => void) => Promise<void>>
> = {
  lms: openLms,
  fbpost: openSocial,
};

export function getCrossDomainOpener(
  appKey: string,
): ((fallback: () => void) => Promise<void>) | undefined {
  return CROSS_DOMAIN_APP_OPENERS[appKey];
}

/**
 * "App đang mở" — dùng cho CẢ badge «Đang mở» và nhánh bấm-không-làm-gì (S16-SOCIAL-FBPOST-1).
 *
 * 🔴 So theo `moduleCode` một mình là SAI từ khi S16-SOCIAL-FE-1 cho hai ô dùng chung
 * `moduleCode: "SOCIAL"` (cổng thông tin `social` + vệ tinh `fbpost`): đang ở `/feed` thì
 * `currentModuleCode` = SOCIAL ⇒ ô «Đăng bài Facebook» bị coi là "đang mở" ⇒ badge sai VÀ bấm vào chỉ
 * đóng overlay, không đi đâu — đúng lúc người dùng cần nó nhất (rail SOCIAL không render ở icon-mode).
 *
 * App CROSS-DOMAIN rời khỏi SPA nên KHÔNG bao giờ là "app đang mở": luôn cho bấm.
 */
export function isCurrentApp(app: AppRegistryItem, currentModuleCode?: string): boolean {
  if (getCrossDomainOpener(app.appKey)) return false;
  return app.moduleCode === currentModuleCode;
}
