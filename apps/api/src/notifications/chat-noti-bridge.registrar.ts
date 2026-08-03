import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { ChatAudienceReader } from "./chat-audience.reader";

const SOURCE_MODULE_CHAT = "CHAT";
const SOURCE_ENTITY_CHAT_MESSAGE = "chat_message";

/** Gộp lô DM: 15 phút (SPEC-15 §17). Xem `bucket15m` cho ngữ nghĩa BIÊN CỐ ĐỊNH. */
const DM_BUCKET_MS = 15 * 60 * 1000;

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Số nguyên không âm, hoặc `undefined`. Dùng cho `payloadOf`: whitelist theo KHOÁ không đủ — một payload
 * mang `unread_count: { raw: {...} }` sẽ chảy nguyên cây JSON vào `notifications.payload` vì
 * `assertPayloadSafe` chỉ so khớp TÊN khoá, không giới hạn hình dạng giá trị.
 */
function numField(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Trường BẮT BUỘC về mặt CẤU TRÚC của payload — thiếu ⇒ **NÉM**, không `return []`.
 *
 * Đây là ranh giới giữa hai chuyện rất khác nhau mà `return []` gộp làm một:
 *   • "không còn ai để báo" (rời phòng / bật mute / phòng lưu trữ) — HỢP LỆ, engine ghi `no_recipient`;
 *   • "payload không có hình dạng đã hẹn" — HỎNG, và hỏng theo kiểu lan ra toàn hệ thống.
 *
 * Nếu một WO sau đổi tên khoá (`roomId` → `room_id`), nhánh `return []` khiến MỌI thông báo CHAT ngừng
 * chảy trong khi outbox vẫn `done`, CI vẫn xanh, log vẫn sạch — dấu vết duy nhất là dòng audit
 * `no_recipient` không phân biệt được với "cả phòng đã tắt thông báo". Ném ở đây đẩy event qua đường
 * retry → dead-letter → alert của `OutboxWorker` (bridge re-throw sẵn ở `outbox-notification-bridge.service.ts`).
 */
function requireStrField(ctx: EventContext, key: string): string {
  const v = strField(ctx.payload, key);
  if (!v) {
    throw new Error(
      `${ctx.eventType}: payload THIẾU trường bắt buộc '${key}' (event ${ctx.eventId}) — ` +
        `hợp đồng payload đã lệch, KHÔNG phải "không còn người nhận".`,
    );
  }
  return v;
}

/**
 * Mảng user-id BẮT BUỘC CÓ MẶT. Phân biệt **khoá vắng mặt** (hợp đồng lệch ⇒ ném) với **mảng rỗng**
 * (không nhắc ai ⇒ hợp lệ, trả rỗng) — `Array.isArray(undefined)` cho `false` nên nếu không tách hai ca
 * này thì đúng ca đổi-tên-khoá lại rơi vào nhánh im lặng.
 */
function requireStrArrayField(ctx: EventContext, key: string): string[] {
  const v = ctx.payload[key];
  if (!Array.isArray(v)) {
    throw new Error(
      `${ctx.eventType}: payload THIẾU mảng bắt buộc '${key}' (event ${ctx.eventId}) — ` +
        `hợp đồng payload đã lệch, KHÔNG phải "không nhắc ai".`,
    );
  }
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Bucket 15 phút tính TỪ `payload.createdAt`, KHÔNG từ `Date.now()` lúc consume.
 *
 * Lý do không dùng `Date.now()`: outbox event là dữ liệu BỀN và có thể được consume lại rất muộn (retry,
 * reaper re-claim, worker khởi động lại). Khoá suy từ thời điểm consume sẽ cho hai giá trị khác nhau cho
 * CÙNG một event ⇒ khoá chống-trùng không chống được gì (memory `idempotency-key-must-be-content-derived`).
 *
 * ⚠️ BIÊN CỐ ĐỊNH, không phải cửa sổ trượt: tin lúc 14:59 và 15:01 rơi vào hai bucket khác nhau dù chỉ cách
 * 2 phút ⇒ **2 thông báo riêng**. Đây là hệ quả CHỦ Ý của `floor(epoch / 15p)`, ghi ra để QA không mở bug.
 */
function bucket15m(createdAtIso: string): number | null {
  const ms = Date.parse(createdAtIso);
  return Number.isNaN(ms) ? null : Math.floor(ms / DM_BUCKET_MS);
}

/**
 * S7-CHAT-BE-6 — nối 2 sự kiện CHAT → NOTI qua `OutboxNotificationBridge` (lõi GENERIC của S4-INT-1 —
 * TÁI DÙNG, không dựng bridge/consumer thứ hai).
 *
 *   chat.message.mentioned    → CHAT_MENTIONED       (gửi ngay)
 *   chat.message.direct_sent  → CHAT_DIRECT_MESSAGE  (gộp lô 15 phút)
 *
 * ══ NỘI DUNG TIN NHẮN KHÔNG BAO GIỜ RỜI MODULE CHAT ══
 * `payloadOf` của cả hai mapping là **WHITELIST tường minh**, không phải strip blacklist. Mặc định của
 * bridge là forward NGUYÊN `ctx.payload`; nếu một WO sau thêm `body`/`preview` vào payload outbox (rất tự
 * nhiên khi làm rich-notification) thì không có lớp nào chặn nội dung tin chảy vào `notifications.payload`
 * và vào body thông báo đẩy — bảng đó không phải append-only nhưng đã gửi đi thì không thu lại được.
 * Whitelist khiến trường mới phải được thêm CÓ Ý THỨC ở đây mới đi tiếp. Ca test 12 gieo payload có `body`
 * và chứng minh nó bị chặn.
 *
 * ══ Khoá chống-trùng, hai tầng ══
 * Tầng 1 = `OutboxWorker.processed_events` (consumer_name + event_id). Tầng 2 = partial-unique
 * `uq_notifications_dedupe_active`. Tầng 2 chỉ hoạt động khi `dedupe_key` KHÁC NULL, và nó chỉ khác NULL
 * khi strategy ≠ 'None' (`NotificationDedupeService.resolveStrategy`):
 *   • `CHAT_DIRECT_MESSAGE` — catalog DB seed `'DedupeKey'` (`0538:719`) ⇒ catalog THẮNG, `dedupeKeyOf` ở
 *     dưới có hiệu lực.
 *   • `CHAT_MENTIONED` — catalog seed `'None'` (`0538:717`, đúng nghĩa "gửi ngay, không gộp theo cửa sổ")
 *     ⇒ phải khai trong `DEFAULT_DEDUPE` mới có tầng 2. "Không gộp lô" KHÔNG đồng nghĩa "không cần
 *     idempotent" — xem `notification-dedupe.const.ts`.
 *
 * KHÔNG import `ChatModule`: audience đọc thẳng bảng qua `ChatAudienceReader` (giữ acyclic).
 */
@Injectable()
export class ChatNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: ChatAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerMentioned();
    this.registerDirectMessage();
  }

  private registerMentioned(): void {
    this.bridge.registerSource({
      eventType: "chat.message.mentioned",
      eventCode: "CHAT_MENTIONED",
      sourceModule: SOURCE_MODULE_CHAT,
      sourceEntityType: SOURCE_ENTITY_CHAT_MESSAGE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "messageId"),
      resolveRecipients: async (ctx) => {
        const roomId = requireStrField(ctx, "roomId");
        const candidates = requireStrArrayField(ctx, "mentionedUserIds");
        if (candidates.length === 0) return [];
        return this.db.withTenant(ctx.companyId, (tx) =>
          this.reader.resolveMentionRecipients(tx, ctx.companyId, roomId, candidates),
        );
      },
      // `dedupeKeyOf` bỏ trống ⇒ bridge dùng `ctx.eventId` (once-ever theo outbox event) — đúng ngữ nghĩa
      // "gửi ngay, chỉ chống re-consume", mirror `LEAVE_REQUEST_SUBMITTED`.
      //
      // Whitelist lọc theo KHOÁ **và** theo KIỂU: `strField` ép chuỗi, nên một payload nhét cây JSON dưới
      // khoá hợp lệ (`actor_name: {…}`) bị cắt về `""` thay vì chảy nguyên vào `notifications.payload`.
      payloadOf: (ctx) => ({
        actor_name: strField(ctx.payload, "actor_name") ?? "",
        room_name: strField(ctx.payload, "room_name") ?? "",
        room_id: strField(ctx.payload, "roomId") ?? "",
      }),
    });
  }

  private registerDirectMessage(): void {
    this.bridge.registerSource({
      eventType: "chat.message.direct_sent",
      eventCode: "CHAT_DIRECT_MESSAGE",
      sourceModule: SOURCE_MODULE_CHAT,
      sourceEntityType: SOURCE_ENTITY_CHAT_MESSAGE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "messageId"),
      resolveRecipients: async (ctx) => {
        const roomId = requireStrField(ctx, "roomId");
        const recipientUserId = requireStrField(ctx, "recipientUserId");
        return this.db.withTenant(ctx.companyId, (tx) =>
          this.reader.resolveDirectRecipient(tx, ctx.companyId, roomId, recipientUserId),
        );
      },
      dedupeKeyOf: (ctx) => this.directDedupeKey(ctx),
      // `unread_count` rơi về 1 (KHÔNG phải 0) khi payload sai kiểu: thông báo này tồn tại nghĩa là có ít
      // nhất một tin chưa đọc, nên 1 là cận dưới ĐÚNG; 0 sẽ render "0 tin chưa đọc" — vô nghĩa và sai.
      payloadOf: (ctx) => ({
        actor_name: strField(ctx.payload, "actor_name") ?? "",
        unread_count: numField(ctx.payload, "unread_count") ?? 1,
        room_id: strField(ctx.payload, "roomId") ?? "",
      }),
    });
  }

  /**
   * `chat:{roomId}:{recipientUserId}:{bucket}` — mọi DM cùng phòng, cùng người nhận, cùng bucket 15 phút
   * gộp thành MỘT thông báo.
   *
   * Trả `undefined` khi payload thiếu trường (bridge rơi về `ctx.eventId`): thà mất tính-gộp-lô của một
   * event hỏng còn hơn sinh khoá `chat:undefined:undefined:NaN` — khoá đó gộp NHẦM các DM không liên quan
   * của những người khác nhau vào cùng một hàng.
   */
  private directDedupeKey(ctx: EventContext): string | undefined {
    const roomId = strField(ctx.payload, "roomId");
    const recipientUserId = strField(ctx.payload, "recipientUserId");
    const createdAt = strField(ctx.payload, "createdAt");
    if (!roomId || !recipientUserId || !createdAt) return undefined;
    const bucket = bucket15m(createdAt);
    if (bucket === null) return undefined;
    return `chat:${roomId}:${recipientUserId}:${bucket}`;
  }
}
