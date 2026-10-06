/**
 * S16-SOCIAL-FE-3B (L4) — MỘT chỗ khai «sau một lượt ghi huy hiệu thì làm mới gì» (plan D13).
 *
 * HAI khoá, không khoá nào là tiền tố của khoá kia (`query-keys.ts` — nhánh quản trị tách khỏi nhánh công khai
 * vì hai cổng khác nhau), nên phải gọi CẢ HAI:
 *  · `kudos.badgesAdminAll()` — mọi trang của bảng quản trị (056);
 *  · `kudos.badges()` — catalog công khai (048) mà ô chọn huy hiệu của composer vinh danh đọc. Quên khoá này
 *    là huy hiệu vừa ngừng dùng còn chọn được (gửi thì server từ chối), huy hiệu vừa tạo / bật lại thì chưa có.
 *
 * Khoá không có observer chỉ bị đánh dấu cũ, không phát lời gọi nào.
 */
import type { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";

export function invalidateBadgeCatalogs(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.badgesAdminAll() });
  void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.badges() });
}
