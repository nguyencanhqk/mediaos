/**
 * S16-SOCIAL-FE-2C — nháp vinh danh của composer + luật kiểm phía client (plan D4).
 *
 * Hàm THUẦN, khuôn `poll-draft.ts`: `FeedComposer` giữ `KudosDraft` trong state của CHÍNH nó (luật «không
 * dọn khi chưa resolve» áp cho cả người nhận/huy hiệu), còn «gửi được chưa / gửi gì» nằm ở đây.
 *
 * ⚠️ Trần 1..10 người nhận là luật SERVICE (422 `KUDOS-RECIPIENT-LIMIT`) — contracts cố ý không ép; kiểm
 * ở đây để người dùng thấy lý do trước khi bấm, server vẫn là cổng cuối.
 */
import {
  FEED_BODY_MAX,
  KUDOS_RECIPIENT_MAX,
  KUDOS_RECIPIENT_MIN,
  type CreateFeedPostDto,
  type KudosRecipientCandidateDto,
} from "@mediaos/contracts";

export interface KudosDraft {
  /** Thứ tự CHỌN (cho chip). Payload thì sắp xếp lại — xem `validateKudosDraft`. */
  readonly recipients: readonly KudosRecipientCandidateDto[];
  /** `null` = không gắn huy hiệu ⇒ BỎ khoá `badgeId` (contracts `uuid().optional()`, không nullable). */
  readonly badgeId: string | null;
  readonly isOfficial: boolean;
}

/** So THAM CHIẾU với hằng này = cờ «nháp đã bị sửa» (khuôn `EMPTY_POLL_DRAFT`). */
export const EMPTY_KUDOS_DRAFT: KudosDraft = { recipients: [], badgeId: null, isOfficial: false };

/** Khoá lỗi — đuôi của `composer.kudos.<key>` trong namespace `social`. */
export type KudosDraftError =
  | "recipientsRequired"
  | "recipientsTooMany"
  | "messageRequired"
  | "messageTooLong";

export type KudosPayload = NonNullable<CreateFeedPostDto["kudos"]>;

export type KudosDraftResult =
  | { ok: true; kudos: KudosPayload }
  | { ok: false; error: KudosDraftError };

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Thêm người nhận. Trùng (không phân biệt hoa thường) hoặc đã đủ trần ⇒ trả NGUYÊN tham chiếu nháp. */
export function addKudosRecipient(
  draft: KudosDraft,
  candidate: KudosRecipientCandidateDto,
): KudosDraft {
  if (draft.recipients.some((r) => sameId(r.employeeId, candidate.employeeId))) return draft;
  if (draft.recipients.length >= KUDOS_RECIPIENT_MAX) return draft;
  return { ...draft, recipients: [...draft.recipients, candidate] };
}

export function removeKudosRecipient(draft: KudosDraft, employeeId: string): KudosDraft {
  const next = draft.recipients.filter((r) => !sameId(r.employeeId, employeeId));
  return next.length === draft.recipients.length ? draft : { ...draft, recipients: next };
}

/**
 * Kiểm nháp theo thứ tự người dùng điền (người nhận → lời nhắn), trả lỗi ĐẦU TIÊN; hợp lệ ⇒ payload.
 *
 * - `recipientEmployeeIds` lowercase + khử trùng + **SẮP XẾP**: khoá `Idempotency-Key` suy từ
 *   `JSON.stringify(body)`, thứ tự chọn khác nhau thì khoá khác nhau cho cùng một lời vinh danh.
 * - `message` đo SAU `trim()` (contracts `.trim().min(1).max(FEED_BODY_MAX)`).
 * - `isOfficial` chỉ `true` khi người soạn CÒN quyền (`canOfficial`) — nháp bật cờ rồi mất quyền giữa
 *   chừng thì không gửi cờ (gửi là 403 `KUDOS-OFFICIAL-DENIED`).
 */
export function validateKudosDraft(
  draft: KudosDraft,
  message: string,
  canOfficial: boolean,
): KudosDraftResult {
  const ids = [...new Set(draft.recipients.map((r) => r.employeeId.toLowerCase()))].sort();
  if (ids.length < KUDOS_RECIPIENT_MIN) return { ok: false, error: "recipientsRequired" };
  if (ids.length > KUDOS_RECIPIENT_MAX) return { ok: false, error: "recipientsTooMany" };

  const trimmed = message.trim();
  if (trimmed.length === 0) return { ok: false, error: "messageRequired" };
  if (trimmed.length > FEED_BODY_MAX) return { ok: false, error: "messageTooLong" };

  return {
    ok: true,
    kudos: {
      recipientEmployeeIds: ids,
      message: trimmed,
      isOfficial: draft.isOfficial && canOfficial,
      ...(draft.badgeId ? { badgeId: draft.badgeId } : {}),
    },
  };
}
