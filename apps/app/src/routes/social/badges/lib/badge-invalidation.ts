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
 *
 * THÊM khi một lượt SỬA đổi TÊN hoặc BIỂU TƯỢNG (`invalidateBadgeDisplaySurfaces`): server ghép tên + biểu
 * tượng huy hiệu vào lời vinh danh LÚC ĐỌC, nên đổi một trong hai là đổi cách vẽ của mọi lời vinh danh CŨ —
 * widget «Vinh danh tháng này» (rail luôn mount, ngay cạnh màn này), trang Vinh danh, thẻ bài kudos trên bảng
 * tin. Tập khoá là của `invalidatePostSurfaces` (cụm Kiểm duyệt) — DÙNG LẠI, không chép bản thứ ba. Tắt / bật
 * lại / đổi thứ tự / mô tả không đổi gì trên các bề mặt đó ⇒ không gọi. Lượt SỬA không có câu trả lời đọc được
 * (`outcomeUnknown`) cũng gọi: không biết server đã ghi trường nào.
 */
import type { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { invalidatePostSurfaces } from "../../moderation/lib/moderation-invalidation";

export function invalidateBadgeCatalogs(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.badgesAdminAll() });
  void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.badges() });
}

/** Hai thứ của huy hiệu mà lời vinh danh mang theo khi vẽ. */
export function isBadgeDisplayChanged(
  before: Pick<KudosBadgeAdminDto, "name" | "icon">,
  after: Pick<KudosBadgeAdminDto, "name" | "icon">,
): boolean {
  return before.name !== after.name || before.icon !== after.icon;
}

export function invalidateBadgeDisplaySurfaces(queryClient: QueryClient): void {
  invalidatePostSurfaces(queryClient);
}
