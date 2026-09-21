import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import {
  SOCIAL_EVENT_CODES,
  SOCIAL_EVENT_COMMENT_REPLIED,
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_POST_COMMENTED,
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
] as const;

/** Biến template BẮT BUỘC của từng mã (mirror `variables_schema` của migration `0581`). */
const TEMPLATE_KEYS: Record<string, readonly string[]> = {
  SOCIAL_MENTIONED: ["actor_name", "target_type_label", "post_id"],
  SOCIAL_POST_COMMENTED: ["actor_name", "post_id"],
  SOCIAL_COMMENT_REPLIED: ["actor_name", "post_id"],
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
      resolveRecipients: (ctx) => Promise.resolve([requireField(ctx.payload, "parentAuthorUserId")]),
      dedupeKeyOf: (ctx) => requireField(ctx.payload, "commentId"),
      payloadOf: (ctx) => this.payloadOf(ctx, "SOCIAL_COMMENT_REPLIED"),
    });
  }

  /** Whitelist khoá + ép ĐỦ biến template TRƯỚC khi render (thiếu ⇒ ném, không render `{x}`). */
  private payloadOf(ctx: EventContext, eventCode: string): Record<string, unknown> {
    for (const k of TEMPLATE_KEYS[eventCode] ?? []) requireField(ctx.payload, k);
    return Object.fromEntries(
      PAYLOAD_KEYS.filter((k) => k in ctx.payload).map((k) => [k, ctx.payload[k]]),
    );
  }
}
