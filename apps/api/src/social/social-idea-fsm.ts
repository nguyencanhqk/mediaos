import { ConflictException } from "@nestjs/common";
import type { FeedIdeaStatusDto } from "@mediaos/contracts";
import { SOCIAL_ERR } from "./social.errors";

/**
 * S16-SOCIAL-BE-2B-2 — máy trạng thái SÁNG KIẾN (SPEC-16 §13.3 / SPEC-01 §17.19).
 *
 * ```text
 * submitted → under_review → accepted
 *                         → rejected
 * ```
 *
 * ┌─ VÌ SAO LÀ BẢNG CẠNH, KHÔNG PHẢI CHUỖI `if` ───────────────────────────────────────────────────┐
 * │ `chk_feed_ideas_status` (0580) chỉ ép TẬP GIÁ TRỊ — nó không đọc được trạng thái CŨ, nên thứ tự │
 * │ chuyển KHÔNG có lưới nào ở tầng DB. Cả luật nằm ở đây, và cách duy nhất kiểm được nó là vét cạn │
 * │ ma trận 4×4: 3 ô hợp lệ / 13 ô ném. Một chuỗi `if` cho cùng kết quả nhưng không kê ra được      │
 * │ "13 ô nào" để đếm — mà `IDEA_TRANSITIONS.length === 3` mới là neo dương thật (bảng rỗng thì MỌI │
 * │ assert phủ định vẫn xanh: deny vacuous).                                                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG có cạnh nào rời `accepted`/`rejected`: hai trạng thái đó **terminal** (SPEC-16 §13.3). Không
 * reopen, không nhảy cóc `submitted → accepted`. Mở thêm một cạnh là đổi SPEC, không phải sửa bug.
 *
 * File thuần TS — không `@Injectable`, không `tx`, không DB ⇒ ma trận I-1 chạy ở tầng UNIT, không cần
 * lane DB.
 */

/** Một cạnh hợp lệ của FSM. */
export interface IdeaTransition {
  readonly from: FeedIdeaStatusDto;
  readonly to: FeedIdeaStatusDto;
}

/**
 * ĐÚNG 3 cạnh hợp lệ — nguồn sự thật DUY NHẤT của luật chuyển trạng thái sáng kiến.
 *
 * `satisfies readonly IdeaTransition[]` ép cả hai đầu cạnh phải là giá trị của
 * `feedIdeaStatusSchema` (mirror `chk_feed_ideas_status`) ⇒ gõ sai tên trạng thái là TS đỏ, không
 * phải một cạnh chết im lặng.
 */
export const IDEA_TRANSITIONS = [
  { from: "submitted", to: "under_review" },
  { from: "under_review", to: "accepted" },
  { from: "under_review", to: "rejected" },
] as const satisfies readonly IdeaTransition[];

/**
 * Nhãn tiếng Việt của trạng thái — biến `status_label` của NOTI-032.
 *
 * 🔴 Bảng ĐÓNG (`satisfies Record<FeedIdeaStatusDto, string>`): thêm một trạng thái vào
 * `feedIdeaStatusSchema` mà quên nhãn ⇒ TS đỏ. Không có nhánh `?? status` fallback, có chủ đích —
 * fallback sẽ đẩy chuỗi enum thô (`under_review`) vào một thông báo người dùng đọc, và không cổng
 * nào bắt được vì nó vẫn "có chữ".
 *
 * Chép theo template `0581:243-248` (`'Sáng kiến của bạn: {status_label}'`).
 */
export const IDEA_STATUS_LABEL = {
  submitted: "Đã gửi",
  under_review: "Đang xét duyệt",
  accepted: "Được duyệt",
  rejected: "Từ chối",
} as const satisfies Record<FeedIdeaStatusDto, string>;

/**
 * Ném `409 SOCIAL-ERR-019` nếu `from → to` không phải cạnh hợp lệ.
 *
 * ⚠️ Ném **CHUỖI TRẦN**, không phải envelope `{code, message, details}` như `payroll-fsm.ts`: mọi mã
 * lỗi SOCIAL là chuỗi trần (`social.errors.ts`) và int-spec assert theo chính chuỗi đó. Dựng envelope
 * thứ hai ở đây làm SOCIAL có hai hình dạng lỗi cho cùng một họ mã.
 */
export function assertIdeaTransition(from: FeedIdeaStatusDto, to: FeedIdeaStatusDto): void {
  const allowed = IDEA_TRANSITIONS.some((t) => t.from === from && t.to === to);
  if (!allowed) throw new ConflictException(SOCIAL_ERR.IDEA_TRANSITION);
}
