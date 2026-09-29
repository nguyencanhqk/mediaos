/**
 * S16-SOCIAL-FE-2 — luật xét duyệt sáng kiến phía FE (`SOC-SCREEN-008`, plan D8).
 *
 * Mirror FSM 3 cạnh của SPEC-16 §13.3 / `apps/api/src/social/social-idea-fsm.ts`:
 *
 *   submitted → under_review → accepted
 *                           → rejected
 *
 * Hộp thoại xét duyệt CHỈ đưa các đích hợp lệ từ trạng thái hiện tại. Server vẫn là cổng cuối (409
 * `SOCIAL-ERR-019` nếu hai người duyệt cùng lúc) — hàm này để người dùng không bấm được một lựa chọn
 * chắc chắn thất bại, không phải để thay server.
 */
import type { FeedIdeaReviewTargetDto, FeedIdeaStatusDto } from "@mediaos/contracts";

const TRANSITIONS: Readonly<Record<FeedIdeaStatusDto, readonly FeedIdeaReviewTargetDto[]>> = {
  submitted: ["under_review"],
  under_review: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

/**
 * Đích hợp lệ từ `status`. Trạng thái terminal ⇒ mảng rỗng ⇒ màn ẩn nút «Xét duyệt».
 *
 * ⚠️ `Record<FeedIdeaStatusDto, …>` VÉT CẠN: thêm trạng thái mới vào enum contracts mà quên bảng này
 * là TS đỏ lúc build, không phải một sáng kiến kẹt không ai duyệt được.
 */
export function ideaReviewTargets(status: FeedIdeaStatusDto): readonly FeedIdeaReviewTargetDto[] {
  return TRANSITIONS[status];
}

/**
 * `rejected` BẮT BUỘC có lý do (`chk_feed_ideas_reject_note` — `btrim(review_note)` khác rỗng).
 * Đo SAU `trim()`, đúng như schema contracts cắt trước khi tới service: «   » là rỗng.
 */
export function isReviewNoteRequired(target: FeedIdeaReviewTargetDto): boolean {
  return target === "rejected";
}

export function isReviewSubmittable(target: FeedIdeaReviewTargetDto | null, note: string): boolean {
  if (target === null) return false;
  return !isReviewNoteRequired(target) || note.trim().length > 0;
}
