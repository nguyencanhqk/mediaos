/**
 * S16-SOCIAL-BE-1 — payload outbox cho **3 event SOCIAL của Nhóm A** (SPEC-16 §17, seed `0581`).
 *
 * Registrar (`notifications/social-noti-bridge.registrar.ts`) map `eventType` nội bộ → `eventCode`
 * catalog và dựng `dedupeKey` content-derived từ các trường dưới đây.
 *
 * ┌─ 3/9, KHÔNG PHẢI 9/9 (plan §2 D15) ───────────────────────────────────────────────────────────┐
 * │ BE-1 đăng ký + phát ĐÚNG BA mã: `SOCIAL_MENTIONED` (028) · `SOCIAL_POST_COMMENTED` (029) ·     │
 * │ `SOCIAL_COMMENT_REPLIED` (030). `SOCIAL_NEWS_PUBLISHED` (031) và `SOCIAL_POST_REPORTED` (036)   │
 * │ chuyển `S16-SOCIAL-BE-1B`; 4 mã còn lại (032-035) thuộc `S16-SOCIAL-BE-2`.                      │
 * │ `registerSource()` fail-loud tại boot nếu mã chưa `is_enabled` trong catalog — nên đăng ký thừa │
 * │ một mã chưa ai phát thì vô hại, nhưng PHÁT một mã chưa đăng ký thì dead-letter câm.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **BIẾN TEMPLATE PHẢI KHỚP NGUYÊN VĂN `variables_schema` của `0581`** (snake_case). Thiếu khoá
 * thì renderer giữ nguyên `{placeholder}` trong `target_url` ⇒ `assertInternalTargetUrl` từ chối ⇒
 * MỌI NOTI SOCIAL dead-letter câm (đúng bug đã chặn merge ở RECRUIT 31/08/2026). Khoá camelCase giữ
 * SONG SONG cho neo/dedupe của registrar.
 *
 * ⚠️ **KHÔNG nội dung bài trong payload.** Template `0581` chỉ cần `actor_name` + `post_id` +
 * `target_type_label`. Nhét `body` vào đây là phát nguyên văn bài `hidden`/`org_unit` qua bảng
 * `notifications` — một kênh KHÁC, không đi qua `visiblePostCondition` nào.
 */

export const SOCIAL_EVENT_MENTIONED = "social.mentioned";
export const SOCIAL_EVENT_POST_COMMENTED = "social.post_commented";
export const SOCIAL_EVENT_COMMENT_REPLIED = "social.comment_replied";

/** Mã catalog (`notification_events.event_code`) — VERBATIM theo `0581`. */
export const SOCIAL_EVENT_CODES = {
  [SOCIAL_EVENT_MENTIONED]: "SOCIAL_MENTIONED",
  [SOCIAL_EVENT_POST_COMMENTED]: "SOCIAL_POST_COMMENTED",
  [SOCIAL_EVENT_COMMENT_REPLIED]: "SOCIAL_COMMENT_REPLIED",
} as const;

interface SocialPayloadBase {
  actorUserId: string;
  /** Bài gốc — đích của `target_url_template` `/social/posts/{post_id}`. */
  postId: string;
  // Biến template 0581 (snake_case).
  actor_name: string;
  post_id: string;
  [key: string]: unknown;
}

/**
 * `NOTI-EVENT-028` — người nhận là NGƯỜI ĐƯỢC NHẮC.
 *
 * Dedupe `{target_type}:{target_id}` (khớp comment nguồn `notification-event-catalog.const.ts:210`)
 * — **content-derived theo ĐỐI TƯỢNG, KHÔNG nhét `user_id`**: `NotificationDedupeService` chống
 * trùng theo tuple `(company_id, recipient_user_id, event_code, dedupe_key)` và `recipient_user_id`
 * ĐÃ là một cột riêng trong tuple đó (memory `idempotency-key-must-be-content-derived`).
 *
 * MỘT event cho MỘT người được nhắc (không gộp lô): người nhận khác nhau thì thông báo khác nhau,
 * và gộp lại buộc registrar phải tự tách — tức chuyển một quyết định của producer xuống consumer.
 */
export interface SocialMentionedPayload extends SocialPayloadBase {
  targetType: "post" | "comment";
  targetId: string;
  mentionedUserId: string;
  /** Nhãn tiếng Việt cho `{target_type_label}` của template 0581. */
  target_type_label: string;
}

/** `NOTI-EVENT-029` — người nhận là TÁC GIẢ BÀI. Dedupe `{comment_id}`. */
export interface SocialPostCommentedPayload extends SocialPayloadBase {
  commentId: string;
  postAuthorUserId: string;
}

/** `NOTI-EVENT-030` — người nhận là TÁC GIẢ BÌNH LUẬN CHA. Dedupe `{comment_id}`. */
export interface SocialCommentRepliedPayload extends SocialPayloadBase {
  commentId: string;
  parentCommentId: string;
  parentAuthorUserId: string;
}
