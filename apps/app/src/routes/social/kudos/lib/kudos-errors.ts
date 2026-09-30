/**
 * S16-SOCIAL-FE-2C — LÝ DO cụ thể của một lỗi khi đăng lời vinh danh (plan D7, done_when #1 «hiện 422
 * nếu lọt»).
 *
 * Đọc MÃ qua `socialErrorCode` (sau #554 mã nằm ở `error.code`; tiền tố số của `message` cho API cũ).
 * Áp cho CẢ bảng tin lẫn nhóm: các mã này chỉ phát ra từ nhánh `type='kudos'` của `002`, nên không có
 * ngữ cảnh nào khác để phân xử. Mã khác ⇒ `null` (caller tự rơi về lý do nhóm / câu chung).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { socialErrorCode } from "../../groups/lib/group-errors";
import type { ActionErrorReason } from "../../feed/components/ActionErrorBanner";

const C = SOCIAL_ERROR_CODES;

const KUDOS_REASON_BY_CODE: Readonly<Record<string, ActionErrorReason>> = {
  [C.KUDOS_CREATE_REQUIRED]: "kudosCreateDenied",
  [C.KUDOS_OFFICIAL_DENIED]: "kudosOfficialDenied",
  [C.KUDOS_SELF_RECIPIENT]: "kudosSelf",
  [C.KUDOS_RECIPIENT_LIMIT]: "kudosRecipientLimit",
  [C.KUDOS_RECIPIENT_INVALID]: "kudosRecipientInvalid",
  // `SOCIAL-ERR-022` — huy hiệu không có / đã TẮT / tenant khác (một mã cho cả ba).
  [C.KUDOS_BADGE_INVALID]: "kudosBadgeInvalid",
};

export function kudosErrorReason(err: unknown): ActionErrorReason | null {
  const code = socialErrorCode(err);
  return code && Object.hasOwn(KUDOS_REASON_BY_CODE, code) ? KUDOS_REASON_BY_CODE[code] : null;
}
