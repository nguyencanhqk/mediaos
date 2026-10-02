/**
 * S16-SOCIAL-FEMODERRMSG-1 — LÝ DO cụ thể của một lỗi khi hành động TRÊN MỘT BÀI (cảm xúc · lưu ·
 * kiểm duyệt · xoá — bốn đường ghi của `useFeedActions`).
 *
 * Cùng khuôn `kudos/lib/kudos-errors.ts`: đọc MÃ qua `socialErrorCode` (sau #554 mã nằm ở `error.code`;
 * API cũ chỉ có tiền tố số của `message`) rồi tra một bảng mã → lý do. Mã không có trong bảng ⇒ `null`
 * (banner rơi về câu forbidden/generic như cũ).
 *
 * ┌─ ĐO 02/10/2026 — `005`/`006` (+ `009`/`010`/`011`/`012`) TRẢ ĐƯỢC NHỮNG GÌ ─────────────────────────┐
 * │ 404 `SOCIAL-ERR-001` (`POST_NOT_FOUND`) — `assertPostVisible` + nhánh đua `"gone"` của `006`: bài  │
 * │   đã bị xoá / bị ẩn / không còn trong audience. Thử lại KHÔNG BAO GIỜ thành ⇒ cần lý do. ✅ ở đây.  │
 * │ 403 (`AUTH-ERR-FORBIDDEN` tầng 1/2 · `SOCIAL-ERR-010` per-field · `SOCIAL-ERR-003` xoá bài người    │
 * │   khác) — câu `forbidden.<kind>` đã nói đúng «không có quyền» ⇒ KHÔNG thêm lý do.                  │
 * │ 422 `SOCIAL-ERR-PIN-NEWS-ONLY` — KHÔNG chạm được từ menu sau FEMODPAYLOAD-1 («Ghim» chỉ hiện với   │
 * │   bài `news`, `type` không sửa được, bỏ ghim gửi `pinned:false`) ⇒ KHÔNG thêm câu.                 │
 * │ 409 — `005`/`006` không có nhánh 409 nào.                                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `SOCIAL-ERR-001` là số CHUNG của bài · bình luận · báo cáo lạ. Ở bốn đường của `useFeedActions`
 * mục tiêu LUÔN là một bài nên đọc nó thành «bài không còn» là đúng; đừng dùng hàm này cho đường ghi
 * bình luận (`017` xoá bình luận đã mất cũng là `001`).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { socialErrorCode } from "../../groups/lib/group-errors";
import type { ActionErrorReason } from "../components/ActionErrorBanner";

const C = SOCIAL_ERROR_CODES;

const POST_ACTION_REASON_BY_CODE: Readonly<Record<string, ActionErrorReason>> = {
  // Một câu cho CẢ «đã xoá» lẫn «không còn được xem» — cùng luật chống-oracle của `detail.notFound`.
  [C.POST_NOT_FOUND]: "postGone",
};

export function postActionErrorReason(err: unknown): ActionErrorReason | null {
  const code = socialErrorCode(err);
  return code && Object.hasOwn(POST_ACTION_REASON_BY_CODE, code)
    ? POST_ACTION_REASON_BY_CODE[code]
    : null;
}
