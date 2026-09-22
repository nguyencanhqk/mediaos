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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S16-SOCIAL-BE-1B — 2 event Nhóm B (`031` tin tức mới · `036` nội dung bị báo cáo)
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const SOCIAL_EVENT_NEWS_PUBLISHED = "social.news_published";
export const SOCIAL_EVENT_POST_REPORTED = "social.post_reported";

/** Mã catalog của Nhóm B — VERBATIM theo `0581`. Tách bảng riêng để `SOCIAL_EVENT_CODES` của BE-1
 *  không đổi hình dạng (nó là `as const` và đang được đọc theo khoá ở registrar). */
export const SOCIAL_EVENT_CODES_B = {
  [SOCIAL_EVENT_NEWS_PUBLISHED]: "SOCIAL_NEWS_PUBLISHED",
  [SOCIAL_EVENT_POST_REPORTED]: "SOCIAL_POST_REPORTED",
} as const;

/**
 * TRẦN người nhận của MỘT lượt phát `NOTI-031` (C8-ii, chốt ở WO này — không đẩy BE-2).
 *
 * v1 không chia lô: công ty >500 người vẫn đọc tin qua `GET /social/news`; NOTI là kênh đẩy PHỤ.
 *
 * ┌─ 🔴 CẮT CÂM BỊ CẤM ────────────────────────────────────────────────────────────────────────────┐
 * │ Cắt im lặng là đúng hình dạng «thành công RỖNG = fail-OPEN»: không ai biết, và hệ quả nghiệp vụ │
 * │ THẬT là với tin `requires_ack`, người thứ 501 trở đi **không hề được báo** nhưng route `022` vẫn │
 * │ liệt họ vào danh sách «chưa đọc». Ba ràng buộc bắt buộc, cả ba đo được:                          │
 * │   1. XÁC ĐỊNH — sắp theo `user_id` tăng dần TRƯỚC khi cắt (cắt theo thứ tự ngẫu nhiên của query  │
 * │      thì không tái lập được: ca test flaky, sự cố thật không truy được ai bị bỏ).                │
 * │   2. QUAN SÁT ĐƯỢC — log WARN kèm `post_id` + tổng đúng-ra-phải-nhận + trần, **VÀ** `recipients  │
 * │      Truncated:true` + `totalRecipients:N` trong payload outbox (hàng dữ liệu tự mang bằng chứng,│
 * │      không chỉ log dễ trôi).                                                                     │
 * │   3. ĐO ĐƯỢC — ca `N-C8-trần` hạ trần qua hằng này trong test rồi assert cả ba.                  │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export const SOCIAL_NEWS_NOTI_RECIPIENT_CAP = 500;

/**
 * `NOTI-EVENT-031` — người nhận là TOÀN BỘ audience của tin.
 *
 * ⚠️ **Producer tính tập người nhận TRONG CÙNG tx** và nhét thẳng `recipientUserIds` vào payload
 * (C8) — registrar CHỈ đọc lại, KHÔNG tra DB. Khác khuôn ASSET/LEAVE (ở đó người nhận là một VAI
 * phải tra): ở đây câu trả lời chỉ còn đúng tại thời điểm ghi — bài có thể bị ẩn/xoá/đổi audience
 * ngay sau đó, và registrar chạy SAU, NGOÀI tx.
 *
 * Dedupe `{post_id}` — content-derived theo ĐỐI TƯỢNG, KHÔNG nhét `user_id`
 * (`recipient_user_id` đã là một cột riêng của tuple dedupe).
 */
export interface SocialNewsPublishedPayload extends SocialPayloadBase {
  /** ĐÃ sắp xếp tăng dần theo `user_id` và ĐÃ cắt ở `SOCIAL_NEWS_NOTI_RECIPIENT_CAP`. */
  recipientUserIds: string[];
  /** `true` ⇔ tập thật dài hơn trần và đã bị cắt — bằng chứng đi kèm HÀNG DỮ LIỆU, không chỉ ở log. */
  recipientsTruncated: boolean;
  /** Tổng số người ĐÚNG RA phải nhận (trước khi cắt). */
  totalRecipients: number;
}

/**
 * `NOTI-EVENT-036` — người nhận là người XỬ LÝ được báo cáo.
 *
 * ⚠️ **KHÔNG gửi cho MỌI người có `view:feed-report`** như câu ngắn của SPEC-16 viết (H4-iii): chỉ
 * actor có `manage:feed-report` **VÀ** (scope Company/System HOẶC scope Department mà báo cáo thuộc
 * đơn vị của họ). Producer tính tập đó TRONG tx bằng CÙNG vị từ Department mà route `028` dùng (D6)
 * — hai đường nói khác nhau thì manager sẽ nhận thông báo về một báo cáo họ mở ra không thấy.
 *
 * Dedupe `{report_id}`. Template `0581` chỉ cần `{target_type_label}` + `{reason_label}`;
 * `target_url_template` là `/social/reports` (KHÔNG placeholder) nên không cần `post_id` để render —
 * `post_id` vẫn có mặt cho neo/điều tra.
 */
export interface SocialPostReportedPayload extends Omit<SocialPayloadBase, "actor_name"> {
  /**
   * 🔴 **KHÔNG `actor_name`** (gate 22/09). Template `SOCIAL_POST_REPORTED` (`0581:268-273`) render
   * đúng hai nhãn đóng `{target_type_label}`/`{reason_label}`; `actor_name` ở đây là TÊN NGƯỜI TỐ
   * GIÁC, và `payloadOf` của registrar forward MỌI khoá có trong whitelist ⇒ nó sẽ nằm trong
   * `notifications.payload`. Đó đúng nguyên tắc mà header `0585` dùng để bỏ `{post_title}`: một
   * bảng có bề mặt đọc KHÁC (và rộng hơn) bề mặt đọc của chính hàng gốc — và hàng thông báo **sống
   * lâu hơn grant**, nên thu hồi `manage:feed-report` không xoá được tên đã ghi.
   *
   * ⚠️ **`actorUserId` cŨNG không được forward** (D13-a, owner ký 22/09). Nó VẪN nằm trong payload
   * outbox — `outbox-notification-bridge.service.ts` đọc nó để điền `notifications.created_by`, cột
   * KHÔNG có trong `MyNotificationDetail` ⇒ neo điều tra còn nguyên — nhưng `PAYLOAD_KEYS_DENIED` của
   * registrar trừ nó khỏi `notifications.payload`. Lý do giống hệt `actor_name` ở trên: user_id giải ra
   * được danh tính qua DTO của module khác, và hàng thông báo sống lâu hơn grant.
   *
   * Danh tính người tố giác chỉ đọc được ở `028`/`029`, và **chỉ khi người đọc ở scope Company**
   * (SOC-DEC-011 · `toReportDto(r, revealReporter)`). Đó là đường DUY NHẤT — nếu thêm một đường nữa
   * thì phải gác bằng CÙNG vị từ, không phải bằng một bản luật thứ hai.
   */
  reportId: string;
  report_id: string;
  targetType: "post" | "comment";
  targetId: string;
  /** Nhãn tiếng Việt cho `{target_type_label}` — bảng ĐÓNG enum→nhãn, không phải chữ tự do. */
  target_type_label: string;
  /** Nhãn tiếng Việt cho `{reason_label}` — bảng ĐÓNG enum→nhãn. */
  reason_label: string;
  recipientUserIds: string[];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S16-SOCIAL-BE-2A — 1 event NHÓM (`034` kết quả yêu cầu vào nhóm)
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const SOCIAL_EVENT_GROUP_JOIN_DECIDED = "social.group_join_decided";

/** Mã catalog của khối NHÓM — VERBATIM theo `0581:199` (bảng riêng, cùng lý do đã ghi ở `_B`). */
export const SOCIAL_EVENT_CODES_C = {
  [SOCIAL_EVENT_GROUP_JOIN_DECIDED]: "SOCIAL_GROUP_JOIN_DECIDED",
} as const;

/**
 * `NOTI-EVENT-034` — người nhận là **NGƯỜI XIN VÀO NHÓM** (đúng một người), lọc D7.
 *
 * 🔴 **KHÔNG extends `SocialPayloadBase`**: sự kiện này không có bài nào, và `postId`/`post_id`/
 * `actor_name` của base đều là bắt buộc. Kế thừa để "cho giống" sẽ buộc producer bịa một `post_id`
 * rỗng — thứ mà `assertInternalTargetUrl` sẽ nuốt im lặng vào một URL đích hỏng.
 *
 * ⚠️ Ba biến template của `0581:255-260` (`variables_schema = {group_name, decision_label,
 * group_id}`) PHẢI có đủ: registrar `requireField` NÉM khi thiếu, và `target_url_template` là
 * `/social/groups/{group_id}` — nên khoá **snake** `group_id` là thứ deep-link ăn, không phải camel.
 *
 * ⚠️ **KHÔNG chở danh tính người duyệt** (D13-a của BE-1B): hàng `notifications` sống lâu hơn grant,
 * và `my-notifications.mapper.ts` trả payload NGUYÊN VĂN cho người nhận. Người xin vào cần biết
 * *kết quả*, không cần biết *ai bấm*.
 *
 * `dedupe_strategy='None'` theo catalog ⇒ registrar **KHÔNG khai `dedupeKeyOf`** (khai mà catalog bỏ
 * qua = tài liệu nói sai về code). Lý do chọn `None` nằm ở header `0581`.
 */
export interface SocialGroupJoinDecidedPayload {
  /** Neo `source_entity_id` + biến `{group_id}` của `target_url_template`. */
  group_id: string;
  /** Biến `{group_name}` — tên nhóm ĐỌC TRONG TX của `038` (tên có thể đổi ngay sau đó). */
  group_name: string;
  /** Biến `{decision_label}` — bảng nhãn ĐÓNG ở service, KHÔNG phải chữ tự do. */
  decision_label: string;
  /** Đúng MỘT người: chính người xin vào. Rỗng ⇒ producer KHÔNG phát (xem `038`). */
  recipientUserIds: string[];
  [key: string]: unknown;
}
