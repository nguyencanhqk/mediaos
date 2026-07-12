import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";

const SOURCE_MODULE_AUTH = "AUTH";
const SOURCE_ENTITY_USER = "user";

/** Đọc field chuỗi an toàn từ payload (KHÔNG trust — mirror task-noti-bridge.registrar.ts strField). */
function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * WHITELIST payload: chỉ giữ các khóa an toàn CÓ MẶT (bỏ undefined) ⇒ payload notification KHÔNG mang khóa
 * lạ/secret của producer (vd resetTokenEnc). Đây là hàng rào strip DUY NHẤT cho 3 event AUTH — engine
 * `assertPayloadSafe` so-khớp-CHÍNH-XÁC nên KHÔNG bắt `resetTokenEnc`, phải strip TỪ ĐÂY (payloadOf).
 */
function pickDefined(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * S4-INT-5 — AuthHrNotiBridgeRegistrar: đăng ký 3 mapping AUTH/HR → NOTI lên `OutboxNotificationBridge`
 * (TÁI DÙNG lõi generic INT-1 — KHÔNG consumer/bridge MỚI) TẠI BOOT (OnModuleInit, mirror
 * TaskNotiBridgeRegistrar). Import CHỈ `notifications/**` + `events/**` — KHÔNG import AuthModule/
 * EmployeesModule (giữ acyclic; producer nằm ở AuthService/HrWriteService enqueue outbox, consumer đọc payload).
 *
 * 3 mapping (eventType outbox → eventCode catalog, VERBATIM — notification-event-catalog.const.ts:61-63,
 * cả 3 isEnabled=true ⇒ boot-guard registerSource PASS, zero-migration):
 *   auth.user_created            → AUTH_USER_CREATED            (recipient = User MỚI vừa provision, STORY-098).
 *   auth.password_reset_requested→ AUTH_PASSWORD_RESET_REQUESTED(recipient = chủ TK yêu cầu reset).
 *   auth.user_locked             → AUTH_USER_LOCKED             (recipient = chủ TK bị khoá).
 *
 * RECIPIENT = `payload.userId` (đọc THẲNG payload — KHÔNG reader như TASK): 3 event owner-directed, producer
 * đã ghi userId của đúng chủ thể vào payload. Anti-enumeration: producer login-fail chỉ enqueue khi userId
 * THẬT (ghost email ⇒ userId=null ⇒ KHÔNG emit) — bridge filter(Boolean) là hàng rào cuối.
 *
 * KHÔNG set actorUserId: 3 event owner-directed, chủ thể TỰ gây (tự reset / tự nhập sai tới khoá) vẫn PHẢI
 * nhận ⇒ actor-exclusion KHÔNG áp dụng (payload AUTH không mang actorUserId ⇒ bridge để undefined — đúng).
 *
 * SECURITY (crown, BẤT BIẾN #3): `payloadOf` STRIP payload durable của producer về đúng khóa an toàn TRƯỚC
 * intake — password-reset bỏ `resetTokenEnc` (envelope token), lock bỏ mọi thứ trừ userId (KHÔNG IP/attempts),
 * created giữ userId/employeeId. Handler bridge RE-THROW khi intake lỗi (OutboxWorker retry/dead-letter).
 */
@Injectable()
export class AuthHrNotiBridgeRegistrar implements OnModuleInit {
  constructor(private readonly bridge: OutboxNotificationBridge) {}

  onModuleInit(): void {
    this.registerUserCreated();
    this.registerPasswordResetRequested();
    this.registerUserLocked();
  }

  /** recipient = payload.userId (rỗng nếu thiếu ⇒ bridge intake với 0 recipient ⇒ Skipped, KHÔNG throw). */
  private recipientsOf(ctx: EventContext): Promise<string[]> {
    const userId = strField(ctx.payload, "userId");
    return Promise.resolve(userId ? [userId] : []);
  }

  private registerUserCreated(): void {
    this.bridge.registerSource({
      eventType: "auth.user_created",
      eventCode: "AUTH_USER_CREATED",
      sourceModule: SOURCE_MODULE_AUTH,
      sourceEntityType: SOURCE_ENTITY_USER,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "userId"),
      resolveRecipients: (ctx) => this.recipientsOf(ctx),
      // Giữ userId (recipient) + employeeId (biến template welcome) — strip mọi khóa khác.
      payloadOf: (ctx) =>
        pickDefined([
          ["userId", strField(ctx.payload, "userId")],
          ["employeeId", strField(ctx.payload, "employeeId")],
        ]),
    });
  }

  private registerPasswordResetRequested(): void {
    this.bridge.registerSource({
      eventType: "auth.password_reset_requested",
      eventCode: "AUTH_PASSWORD_RESET_REQUESTED",
      sourceModule: SOURCE_MODULE_AUTH,
      sourceEntityType: SOURCE_ENTITY_USER,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "userId"),
      resolveRecipients: (ctx) => this.recipientsOf(ctx),
      // CROWN: chỉ userId — STRIP `resetTokenEnc` (envelope reset token) khỏi notification (BẤT BIẾN #3).
      payloadOf: (ctx) => pickDefined([["userId", strField(ctx.payload, "userId")]]),
    });
  }

  private registerUserLocked(): void {
    this.bridge.registerSource({
      eventType: "auth.user_locked",
      eventCode: "AUTH_USER_LOCKED",
      sourceModule: SOURCE_MODULE_AUTH,
      sourceEntityType: SOURCE_ENTITY_USER,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "userId"),
      resolveRecipients: (ctx) => this.recipientsOf(ctx),
      // Chỉ userId — KHÔNG lộ IP/attempts/chi tiết bảo mật ra notify (producer đã không đưa vào, strip lần 2).
      payloadOf: (ctx) => pickDefined([["userId", strField(ctx.payload, "userId")]]),
    });
  }
}
