import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import {
  SOCIAL_EVENT_CODES,
  SOCIAL_EVENT_CODES_B,
  SOCIAL_EVENT_CODES_C,
  SOCIAL_EVENT_CODES_D,
  SOCIAL_EVENT_CODES_E,
  SOCIAL_EVENT_IDEA_STATUS_CHANGED,
  SOCIAL_EVENT_KUDOS_RECEIVED,
  SOCIAL_EVENT_POLL_CLOSED,
  SOCIAL_EVENT_GROUP_JOIN_DECIDED,
  SOCIAL_EVENT_COMMENT_REPLIED,
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_NEWS_PUBLISHED,
  SOCIAL_EVENT_POST_COMMENTED,
  SOCIAL_EVENT_POST_REPORTED,
} from "../social/social-noti.payload";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";

const SOURCE_MODULE_SOCIAL = "SOCIAL";

/** Khoá được forward sang payload thông báo — whitelist, KHÔNG forward khoá lạ. */
const PAYLOAD_KEYS = [
  "postId",
  "commentId",
  "targetType",
  "targetId",
  "actorUserId",
  "actor_name",
  "post_id",
  "target_type_label",
  // S16-SOCIAL-BE-2B-1 — bien template cua NOTI-035.
  "poll_question",
  // S16-SOCIAL-BE-1B — biến template của NOTI-036 (`SOCIAL_POST_REPORTED`). ĐÚNG MỘT khoá thiếu:
  // `target_type_label` đã có sẵn từ NOTI-028.
  "reason_label",
  // S16-SOCIAL-BE-2A — BA biến template của NOTI-034 (`SOCIAL_GROUP_JOIN_DECIDED`). Khoá **snake**
  // `group_id` là thứ `target_url_template` `/social/groups/{group_id}` ăn; thiếu nó ⇒ URL đích giữ
  // nguyên `{group_id}` ⇒ `assertInternalTargetUrl` từ chối ⇒ dead-letter câm.
  "group_id",
  "group_name",
  "decision_label",
  // S16-SOCIAL-BE-2B-2 — biến template DUY NHẤT còn thiếu của NOTI-032 (`actor_name` + `post_id` của
  // NOTI-033 đã có sẵn từ NOTI-028/031).
  //
  // 🔴 `status` (enum thô) CỐ Ý **KHÔNG** có mặt ở đây: nó chỉ là nguyên liệu dựng khoá dedupe
  // `{post_id}:{status}`, và `dedupeKeyOf` đọc `ctx.payload` THÔ — trước khi `payloadOf` lọc
  // allowlist này. Thêm nó vào đây là đẩy một chuỗi enum không ai dịch vào `notifications.payload`,
  // một bề mặt đọc sống lâu hơn grant.
  "status_label",
] as const;

/** Biến template BẮT BUỘC của từng mã (mirror `variables_schema` của migration `0581`). */
const TEMPLATE_KEYS: Record<string, readonly string[]> = {
  SOCIAL_MENTIONED: ["actor_name", "target_type_label", "post_id"],
  SOCIAL_POST_COMMENTED: ["actor_name", "post_id"],
  SOCIAL_COMMENT_REPLIED: ["actor_name", "post_id"],
  // S16-SOCIAL-BE-1B — mirror `variables_schema` SAU migration `0585` (đã bỏ `{post_title}`).
  SOCIAL_NEWS_PUBLISHED: ["actor_name", "post_id"],
  // `target_url_template` của mã này là `/social/reports` — KHÔNG placeholder, nên không cần `post_id`.
  SOCIAL_POST_REPORTED: ["target_type_label", "reason_label"],
  // S16-SOCIAL-BE-2A — mirror `variables_schema` của `0581:260`. `group_id` có mặt vì
  // `target_url_template` là `/social/groups/{group_id}` (khác `SOCIAL_POST_REPORTED`, vốn trỏ tới
  // một URL KHÔNG placeholder).
  SOCIAL_GROUP_JOIN_DECIDED: ["group_name", "decision_label", "group_id"],
  // S16-SOCIAL-BE-2B-1 — mirror `variables_schema` cua `0581:262-267`. KHONG `actor_name`: phan lon
  // luot phat den tu JOB (`is_system_event = true`), o do khong co actor nao de ke ten.
  SOCIAL_POLL_CLOSED: ["poll_question", "post_id"],
  // S16-SOCIAL-BE-2B-2 — mirror `variables_schema` của `0581:243-254`, VERBATIM.
  //
  // `post_id` có mặt ở CẢ HAI vì `target_url_template` của cả hai mã là `/social/posts/{post_id}`:
  // thiếu nó ⇒ URL đích giữ nguyên `{post_id}` ⇒ `assertInternalTargetUrl` từ chối ⇒ **dead-letter
  // CÂM** (không lỗi cho người dùng, chỉ là thông báo không bao giờ tới).
  //
  // 🔴 `SOCIAL_IDEA_STATUS_CHANGED` KHÔNG có `actor_name`: comment `0581:242` ra lệnh «CHỈ
  // status_label — KHÔNG nhúng review_note», và danh tính người duyệt bị cấm hẳn ở
  // `PAYLOAD_KEYS_DENIED` dưới đây (kênh trả đũa).
  SOCIAL_IDEA_STATUS_CHANGED: ["status_label", "post_id"],
  SOCIAL_KUDOS_RECEIVED: ["actor_name", "post_id"],
};

/**
 * 🔴 **Khoá bị CẤM forward theo TỪNG MÃ** — hẹp hơn `PAYLOAD_KEYS` dùng chung.
 *
 * `SOCIAL_POST_REPORTED` (NOTI-036): `actorUserId` ở đây là **user_id NGƯỜI TỐ GIÁC**, và người
 * nhận gồm cả người giữ `manage:feed-report@Department` (`social-reports.service.ts` nhánh Department).
 * Forward nó là **vòng qua SOC-DEC-011**: `028` đã che `reporter` theo scope, nhưng
 * `notifications.payload` trả nguyên văn cho người nhận (`my-notifications.mapper.ts`) ⇒ cùng bí mật
 * đi ra bằng cửa khác — đúng khuôn «cổng màn-hình ≠ cổng đường-tải». Nặng hơn vì hàng `notifications`
 * **sống lâu hơn grant** — cùng lý lẽ đã dùng để bỏ `actor_name` khỏi chính payload này.
 *
 * An toàn về chức năng, đã đo: `actorUserId` KHÔNG nằm trong `TEMPLATE_KEYS.SOCIAL_POST_REPORTED`
 * ⇒ không phá render; và `outbox-notification-bridge.service.ts` đọc `ctx.payload.actorUserId`
 * **TRƯỚC** khi gọi `payloadOf` ⇒ cột `notifications.created_by` vẫn giữ được neo điều tra
 * (cột đó KHÔNG có trong `MyNotificationDetail`).
 */
const PAYLOAD_KEYS_DENIED: Record<string, readonly string[]> = {
  SOCIAL_POST_REPORTED: ["actorUserId", "actor_name"],
  /**
   * S16-SOCIAL-BE-2B-1 (nợ test N7 phát hiện, 23/09/2026) — NOTI-035 «bình chọn đã đóng».
   *
   * `PAYLOAD_KEYS` là allowlist **toàn module**: `actorUserId`/`actor_name` nằm trong đó vì NOTI-028
   * (nhắc tên) cần chúng. Nghĩa là không có gì chặn hai khoá ấy đi vào payload của mã NÀY nếu một
   * lượt sửa producer sau này thêm chúng — và `notifications.payload` là bề mặt đọc thứ hai, sống
   * lâu hơn grant (SOC-DEC-009). Với bình chọn ẩn danh, "actor" của một lượt đóng có thể chính là
   * người đã bỏ phiếu.
   *
   * Không phải lỗ ĐANG bị khai thác: producer hiện chỉ chở `post_id` + `poll_question` +
   * `recipientUserIds`. Đây là ghi thành LUẬT điều mà docblock `SocialPollClosedPayload` vốn đã
   * khẳng định («payload không có `actor_name` — nhánh job không có actor nào để kể tên»), thay vì
   * để nó là một tính chất tình cờ của producer.
   */
  SOCIAL_POLL_CLOSED: ["actorUserId", "actor_name"],
  /**
   * S16-SOCIAL-BE-2B-2 (D16) — NOTI-032 «sáng kiến đổi trạng thái».
   *
   * 🔴 Danh tính NGƯỜI DUYỆT không được vào `notifications.payload`. Xét duyệt là kênh có thể bị TRẢ
   * ĐŨA: người bị từ chối sáng kiến đọc được "ai bấm" là đủ để biến một quyết định của tổ chức thành
   * một việc giữa hai cá nhân. Nặng hơn vì hàng `notifications` **sống lâu hơn grant** — người duyệt
   * mất cặp `approve:feed-idea` hôm nay thì hàng đã ghi hôm qua vẫn nằm đó, và
   * `my-notifications.mapper.ts` trả payload NGUYÊN VĂN cho người nhận.
   *
   * An toàn về chức năng, đã đo: `actorUserId`/`actor_name` KHÔNG nằm trong
   * `TEMPLATE_KEYS.SOCIAL_IDEA_STATUS_CHANGED` ⇒ không phá render; và bridge đọc
   * `ctx.payload.actorUserId` TRƯỚC khi gọi `payloadOf` ⇒ cột `notifications.created_by` vẫn giữ neo
   * điều tra. Producer hôm nay cũng không chở hai khoá đó — đây là ghi thành LUẬT, để nó không còn là
   * tính chất tình cờ của producer.
   */
  SOCIAL_IDEA_STATUS_CHANGED: ["actorUserId", "actor_name"],
};

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Khoá NEO/biến template thiếu ⇒ **NÉM**.
 *
 * Trả `undefined`/`[]` là nhánh nuốt câm: recipient rỗng ⇒ engine `recordSkip("no_recipient")` không
 * log; `dedupeKeyOf` undefined ⇒ fallback `ctx.eventId` (LUÔN khác nhau) ⇒ dedupe biến mất; biến
 * template thiếu ⇒ tiêu đề render nguyên văn `{actor_name}` và `assertInternalTargetUrl` từ chối URL
 * còn placeholder. Ném ⇒ `OutboxWorker` retry → dead-letter (kêu to) — đúng tiền lệ CHAT/ASSET.
 */
function requireField(payload: Record<string, unknown>, key: string): string {
  const v = strField(payload, key);
  if (!v) {
    throw new Error(
      `SocialNotiBridgeRegistrar: payload outbox thiếu khoá bắt buộc '${key}' — hợp đồng social-noti.payload.ts lệch.`,
    );
  }
  return v;
}

/**
 * Mảng người nhận do PRODUCER tính — RỖNG ⇒ **NÉM**, cùng luật `requireField`.
 *
 * Trả `[]` là nhánh nuốt câm đúng hình dạng «thành công RỖNG = fail-OPEN»: engine
 * `recordSkip("no_recipient")` không log, và một sự kiện đáng lẽ báo cho cả công ty biến mất không
 * dấu vết. Producer đã có nhánh xử lý tập rỗng ở tầng nó (log WARN rồi KHÔNG enqueue), nên một
 * payload đã tới đây mà rỗng nghĩa là hợp đồng payload đã lệch.
 */
function requireUserIds(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  if (ids.length === 0) {
    throw new Error(
      `SocialNotiBridgeRegistrar: payload outbox thiếu/rỗng '${key}' — hợp đồng social-noti.payload.ts lệch.`,
    );
  }
  return ids;
}

/**
 * S16-SOCIAL-BE-1 — `SocialNotiBridgeRegistrar`: 3 mapping SOCIAL → NOTI (SPEC-16 §17) lên
 * `OutboxNotificationBridge` ĐÃ SHIP, tại boot (khuôn `AssetNotiBridgeRegistrar`).
 * **KHÔNG import `SocialModule`** — cạnh phụ thuộc đi một chiều `notifications → social` và chỉ qua
 * hằng (`social-noti.payload.ts`), không qua service nào.
 *
 *   `social.mentioned`       → `SOCIAL_MENTIONED`       (028) — người nhận: NGƯỜI ĐƯỢC NHẮC
 *   `social.post_commented`  → `SOCIAL_POST_COMMENTED`  (029) — người nhận: TÁC GIẢ BÀI
 *   `social.comment_replied` → `SOCIAL_COMMENT_REPLIED` (030) — người nhận: TÁC GIẢ BÌNH LUẬN CHA
 *
 * ┌─ VÌ SAO `resolveRecipients` KHÔNG TRA DB ─────────────────────────────────────────────────────┐
 * │ Producer (service SOCIAL) đã biết CHÍNH XÁC người nhận tại thời điểm ghi, TRONG CÙNG tx — và   │
 * │ đó là thời điểm DUY NHẤT câu trả lời còn đúng. Tra lại ở registrar (chạy sau, ngoài tx) sẽ đọc │
 * │ trạng thái MỚI HƠN: mention đã bị gỡ ở lượt sửa sau, tác giả bài đã đổi, bình luận cha đã xoá. │
 * │ Producer vì vậy nhét thẳng `mentionedUserId`/`postAuthorUserId`/`parentAuthorUserId` vào        │
 * │ payload, và registrar chỉ đọc lại. Khác ASSET/LEAVE (ở đó người nhận là một VAI phải tra).      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `dedupeKeyOf` BẮT BUỘC: catalog `0581` chốt cả 3 mã `dedupe_strategy='DedupeKey'`, còn
 * `registerSource()` để `dedupeKeyOf` OPTIONAL với fallback `ctx.eventId` (LUÔN khác nhau) ⇒ quên
 * dòng đó là dedupe biến mất câm lặng.
 *
 * Khoá dedupe **content-derived theo ĐỐI TƯỢNG, KHÔNG nhét `user_id`**: `NotificationDedupeService`
 * chống trùng theo tuple `(company_id, recipient_user_id, event_code, dedupe_key)` và
 * `recipient_user_id` ĐÃ là một cột riêng trong tuple đó (memory
 * `idempotency-key-must-be-content-derived`). Khoá khớp comment nguồn
 * `notification-event-catalog.const.ts:210`: `028 '{target_type}:{target_id}'` · `029/030 '{comment_id}'`.
 */
@Injectable()
export class SocialNotiBridgeRegistrar implements OnModuleInit {
  constructor(private readonly bridge: OutboxNotificationBridge) {}

  onModuleInit(): void {
    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_MENTIONED,
      eventCode: SOCIAL_EVENT_CODES[SOCIAL_EVENT_MENTIONED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      // Neo là ĐỐI TƯỢNG chứa lượt nhắc (bài hoặc bình luận), không phải bài gốc — hai thứ khác nhau
      // khi mention nằm trong một bình luận.
      sourceEntityType: "feed_mention",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "targetId"),
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "mentionedUserId")]),
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "targetType")}:${requireField(ctx.payload, "targetId")}`,
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_MENTIONED"),
    });

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_POST_COMMENTED,
      eventCode: SOCIAL_EVENT_CODES[SOCIAL_EVENT_POST_COMMENTED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_comment",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "commentId"),
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "postAuthorUserId")]),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "commentId"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_POST_COMMENTED"),
    });

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_COMMENT_REPLIED,
      eventCode: SOCIAL_EVENT_CODES[SOCIAL_EVENT_COMMENT_REPLIED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_comment",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "commentId"),
      resolveRecipients: (ctx) =>
        Promise.resolve([requireField(ctx.payload, "parentAuthorUserId")]),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "commentId"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_COMMENT_REPLIED"),
    });

    // ── S16-SOCIAL-BE-1B — 2 mã Nhóm B. Khối ADDITIVE: không sửa 3 lời gọi ở trên. ──

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_NEWS_PUBLISHED,
      eventCode: SOCIAL_EVENT_CODES_B[SOCIAL_EVENT_NEWS_PUBLISHED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_post",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "post_id"),
      // Producer đã tính tập người nhận TRONG tx (C8) — registrar CHỈ đọc lại. Xem docblock
      // `SocialNewsPublishedPayload`: tra lại ở đây (chạy SAU, NGOÀI tx) sẽ đọc trạng thái MỚI HƠN
      // (bài đã bị ẩn/xoá/đổi audience) và trả một tập khác tập đúng tại thời điểm ghi.
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "post_id"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_NEWS_PUBLISHED"),
    });

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_POST_REPORTED,
      eventCode: SOCIAL_EVENT_CODES_B[SOCIAL_EVENT_POST_REPORTED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      // Neo là chính BÁO CÁO (không phải bài): một bài bị báo cáo nhiều lần sinh nhiều hàng đợi khác
      // nhau, và người xử lý cần lần ngược về đúng báo cáo họ được nhắc.
      sourceEntityType: "feed_report",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "report_id"),
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "report_id"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_POST_REPORTED"),
    });

    // ── S16-SOCIAL-BE-2A — NOTI-034 (khối additive) ──
    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_GROUP_JOIN_DECIDED,
      eventCode: SOCIAL_EVENT_CODES_C[SOCIAL_EVENT_GROUP_JOIN_DECIDED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_group",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "group_id"),
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      // 🔴 CỐ Ý KHÔNG có `dedupeKeyOf`: catalog `0581` khai `dedupe_strategy='None'` cho mã này
      // (không nguồn `decided_at` bền vững nào phủ được CẢ nhánh duyệt lẫn nhánh từ chối — nhánh từ
      // chối xoá CỨNG hàng). Khai một khoá ở đây là để tài liệu nói một đằng, engine làm một nẻo;
      // và nếu ai đó bật `DedupeKey` sau này, chuỗi «xin → từ chối → xin lại → duyệt» sẽ NUỐT MẤT
      // quyết định thứ hai. Mất tệ hơn trùng.
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_GROUP_JOIN_DECIDED"),
    });

    // ── S16-SOCIAL-BE-2B-1 — NOTI-035 (khối additive) ──
    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_POLL_CLOSED,
      eventCode: SOCIAL_EVENT_CODES_D[SOCIAL_EVENT_POLL_CLOSED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_post",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "post_id"),
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      // 🔴 BẮT BUỘC có `dedupeKeyOf` — catalog `0581` khai mã này `dedupe_strategy='DedupeKey'`.
      // Bỏ trống thì engine rơi về `ctx.eventId`, một giá trị LUÔN KHÁC NHAU mỗi lượt phát ⇒ dedupe
      // biến mất CÂM: không lỗi, không log, chỉ là người dùng nhận thông báo trùng mãi.
      //
      // Khoá là `post_id` trần, KHÔNG kèm trạng thái: một bình chọn chỉ đóng ĐÚNG MỘT LẦN (không có
      // route nào mở lại), nên hai lượt phát cho cùng `post_id` luôn là trùng lặp thật — cửa sổ đua
      // giữa `044` (tay) và job.
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "post_id"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_POLL_CLOSED"),
    });

    // ── S16-SOCIAL-BE-2B-2 — NOTI-032 + NOTI-033 (khối additive) ──

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_IDEA_STATUS_CHANGED,
      eventCode: SOCIAL_EVENT_CODES_E[SOCIAL_EVENT_IDEA_STATUS_CHANGED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      // `feed_post`, KHÔNG `feed_idea`: CHECK `audit_logs.object_type` (`0583`) và cả module đều coi
      // sáng kiến là một BÀI — neo hai chỗ theo hai khoá khác nhau là bắt người điều tra tự ghép.
      sourceEntityType: "feed_post",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "post_id"),
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      // 🔴 BẮT BUỘC có `dedupeKeyOf` — catalog `0581:194` khai `dedupe_strategy='DedupeKey'`. Bỏ trống
      // thì engine rơi về `ctx.eventId`, một giá trị LUÔN KHÁC mỗi lượt ⇒ dedupe biến mất CÂM.
      //
      // 🔴 Khoá là `{post_id}:{status}`, KHÔNG phải `post_id` trần — đây là chỗ mã này KHÁC
      // `SOCIAL_POLL_CLOSED` ngay trên. Bình chọn đóng ĐÚNG MỘT LẦN nên `post_id` trần là đủ; sáng
      // kiến đi qua tới HAI lượt chuyển (`submitted→under_review` rồi `→accepted|rejected`), và tuple
      // dedupe thật là `(company_id, recipient_user_id, event_code, dedupe_key)` ⇒ khoá trần sẽ
      // **NUỐT lượt thứ hai**: tác giả nhận đúng một thông báo và không bao giờ biết kết quả cuối.
      // Ca `N-032c` là lưới DUY NHẤT bắt được điều này.
      dedupeKeyOf: (ctx) =>
        `${requireField(ctx.payload, "post_id")}:${requireField(ctx.payload, "status")}`,
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_IDEA_STATUS_CHANGED"),
    });

    this.bridge.registerSource({
      eventType: SOCIAL_EVENT_KUDOS_RECEIVED,
      eventCode: SOCIAL_EVENT_CODES_E[SOCIAL_EVENT_KUDOS_RECEIVED],
      sourceModule: SOURCE_MODULE_SOCIAL,
      sourceEntityType: "feed_post",
      sourceEntityIdOf: (ctx) => requireField(ctx.payload, "post_id"),
      // Producer đã tính tập người nhận TRONG tx (map employee→user + lọc D18 4 vế). Registrar CHỈ
      // đọc lại: tra lại ở đây (chạy SAU, NGOÀI tx) sẽ đọc trạng thái MỚI HƠN — một người vừa nghỉ
      // việc sau khi bài được đăng sẽ rụng khỏi tập, khác tập đúng tại thời điểm ghi.
      resolveRecipients: (ctx) => Promise.resolve(requireUserIds(ctx.payload, "recipientUserIds")),
      // Catalog `0581:196` = `DedupeKey`. `post_id` trần ĐỦ: một bài kudos chỉ phát MỘT lần (không có
      // route sửa người nhận ở WO này), nên hai lượt phát cho cùng `post_id` luôn là trùng thật.
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "post_id"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_KUDOS_RECEIVED"),
    });
  }

  /**
   * Whitelist khoá + ép ĐỦ biến template TRƯỚC khi render (thiếu ⇒ ném, không render `{x}`),
   * rồi TRỪ tiếp `PAYLOAD_KEYS_DENIED[eventCode]` — xem docblock của hằng đó.
   *
   * Thứ tự có ý: `requireField` chạy TRƯỚC phép trừ, nên một ngày ai đó cấm nhầm một biến
   * template thì lỗi lộ ra ở chính chỗ render chứ không thành `{x}` câm trong thông báo.
   */
  private payloadOf(ctx: EventContext, eventCode: string): Record<string, unknown> {
    for (const k of TEMPLATE_KEYS[eventCode] ?? []) requireField(ctx.payload, k);
    const denied = PAYLOAD_KEYS_DENIED[eventCode] ?? [];
    return Object.fromEntries(
      PAYLOAD_KEYS.filter((k) => k in ctx.payload && !denied.includes(k)).map((k) => [
        k,
        ctx.payload[k],
      ]),
    );
  }
}
