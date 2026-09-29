/**
 * S16-SOCIAL-FE-2 — nháp bình chọn của composer + luật kiểm phía client (plan §8 M7).
 *
 * Hàm THUẦN: ô soạn giữ `PollDraft` trong state của CHÍNH nó (để luật «không dọn khi chưa resolve»
 * áp cho cả các trường poll), còn quyết định «gửi được chưa / gửi gì» nằm ở đây để test không cần DOM.
 *
 * ⚠️ Luật 2–10 lựa chọn và «hạn ở tương lai» là luật NGHIỆP VỤ của service (422 có mã) — contracts CỐ Ý
 * không ép. Kiểm ở đây để người dùng thấy lý do trước khi bấm; server vẫn là cổng cuối.
 */
import { FEED_POLL_QUESTION_MAX, type CreateFeedPostDto } from "@mediaos/contracts";

/** Mirror `pollOptionLabel()` của contracts (`feed_poll_options.label varchar(255)`). */
export const POLL_OPTION_LABEL_MAX = 255;
/** `SOCIAL-ERR-018` — SPEC-16 §12. */
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

export interface PollDraft {
  question: string;
  options: string[];
  multipleChoice: boolean;
  isAnonymous: boolean;
  /** Giá trị THÔ của `<input type="datetime-local">` (giờ địa phương, KHÔNG offset). `""` = không hạn. */
  closesAtLocal: string;
}

export const EMPTY_POLL_DRAFT: PollDraft = {
  question: "",
  options: ["", ""],
  multipleChoice: false,
  isAnonymous: false,
  closesAtLocal: "",
};

/** Khoá lỗi — là đuôi của `composer.poll.<key>` trong namespace `social`. */
export type PollDraftError =
  | "questionRequired"
  | "questionTooLong"
  | "optionsRange"
  | "optionEmpty"
  | "optionTooLong"
  | "optionDuplicate"
  | "closesAtPast";

export type PollPayload = NonNullable<CreateFeedPostDto["poll"]>;

export type PollDraftResult =
  | { ok: true; poll: PollPayload }
  | { ok: false; error: PollDraftError };

/**
 * Kiểm nháp theo đúng thứ tự người dùng điền (câu hỏi → lựa chọn → hạn) và trả lỗi ĐẦU TIÊN.
 *
 * - `question`/lựa chọn đo SAU `trim()` — contracts `.trim().min(1)` cắt trước khi kiểm, nên «   »
 *   gửi đi là 400 vô danh.
 * - Nhãn trùng (không phân biệt hoa thường, sau trim) bị chặn: BE không chặn (chỉ có unique theo
 *   `position`), nhưng hai ô giống nhau chia đôi phiếu của cùng một ý — poll vô nghĩa.
 * - `closesAtLocal` đổi sang ISO có offset bằng `toISOString()`: giá trị thô của `datetime-local` không
 *   có offset và bị `z.string().datetime({offset:true})` từ chối.
 */
export function validatePollDraft(draft: PollDraft, now: number = Date.now()): PollDraftResult {
  const question = draft.question.trim();
  if (question.length === 0) return { ok: false, error: "questionRequired" };
  if (question.length > FEED_POLL_QUESTION_MAX) return { ok: false, error: "questionTooLong" };

  const options = draft.options.map((o) => o.trim());
  if (options.length < POLL_OPTIONS_MIN || options.length > POLL_OPTIONS_MAX) {
    return { ok: false, error: "optionsRange" };
  }
  if (options.some((o) => o.length === 0)) return { ok: false, error: "optionEmpty" };
  if (options.some((o) => o.length > POLL_OPTION_LABEL_MAX)) {
    return { ok: false, error: "optionTooLong" };
  }
  const folded = options.map((o) => o.toLocaleLowerCase("vi"));
  if (new Set(folded).size !== folded.length) return { ok: false, error: "optionDuplicate" };

  let closesAt: string | undefined;
  if (draft.closesAtLocal.trim().length > 0) {
    const at = new Date(draft.closesAtLocal).getTime();
    if (Number.isNaN(at) || at <= now) return { ok: false, error: "closesAtPast" };
    closesAt = new Date(at).toISOString();
  }

  return {
    ok: true,
    poll: {
      question,
      options,
      multipleChoice: draft.multipleChoice,
      isAnonymous: draft.isAnonymous,
      ...(closesAt ? { closesAt } : {}),
    },
  };
}
