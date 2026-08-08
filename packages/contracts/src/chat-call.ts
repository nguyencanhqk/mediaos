import { z } from "zod";

/**
 * S7-CALL — hợp đồng cuộc gọi thoại/hình.
 *
 * Nguồn chuẩn: `docs/DECISIONS/DECISIONS-07_Chat_Call_Signalling.md` (ĐÃ KÝ 08/08/2026) ·
 * SPEC-15 §5.1c · §15a · §12 (CHAT-ERR-026..030) · migration `0546`.
 *
 * ⚠️ BỘ GIÁ TRỊ Ở ĐÂY PHẢI KHỚP CHECK CỦA DB (`0546` khối A/B). Chúng sống ở HAI chỗ; thêm giá trị
 *    phải sửa CẢ HAI, và vế DB chỉ được NỚI bằng migration mới — không rewrite tại chỗ.
 */

// ─── vòng đời (REST — hàng rào R4) ────────────────────────────────────────────

export const chatCallKindSchema = z.enum(["audio", "video"]);
export type ChatCallKind = z.infer<typeof chatCallKindSchema>;

/** FSM MỘT CHIỀU: `ringing` → `active` → kết thúc. Không hồi sinh (CHAT-ERR-029 → 422). */
export const chatCallStatusSchema = z.enum([
  "ringing",
  "active",
  "ended",
  "rejected",
  "cancelled",
  "missed",
]);
export type ChatCallStatus = z.infer<typeof chatCallStatusSchema>;

export const chatCallOutcomeSchema = z.enum([
  "accepted",
  "rejected",
  "missed",
  "cancelled",
  "left",
]);
export type ChatCallOutcome = z.infer<typeof chatCallOutcomeSchema>;

export const chatCallParticipantSchema = z.object({
  userId: z.string().uuid(),
  invitedAt: z.string().datetime(),
  joinedAt: z.string().datetime().nullable().optional(),
  leftAt: z.string().datetime().nullable().optional(),
  /** `null` = còn đang đổ chuông, chưa ngã ngũ. */
  outcome: chatCallOutcomeSchema.nullable().optional(),
});
export type ChatCallParticipantDto = z.infer<typeof chatCallParticipantSchema>;

export const chatCallSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  initiatorUserId: z.string().uuid(),
  kind: chatCallKindSchema,
  status: chatCallStatusSchema,
  startedAt: z.string().datetime(),
  /** Chỉ có giá trị khi đã có người nhận — DB ép bằng `chat_calls_accepted_at_chk`. */
  acceptedAt: z.string().datetime().nullable().optional(),
  /** Bắt buộc có ở mọi trạng thái kết thúc — DB ép bằng `chat_calls_ended_at_chk`. */
  endedAt: z.string().datetime().nullable().optional(),
  participants: z.array(chatCallParticipantSchema).optional(),
});
export type ChatCallDto = z.infer<typeof chatCallSchema>;

/** `POST /chat/rooms/:id/calls` — CHAT-API-026. */
export const createChatCallSchema = z.object({ kind: chatCallKindSchema });
export type CreateChatCallInput = z.infer<typeof createChatCallSchema>;

// ─── ICE config (CHAT-API-029) ────────────────────────────────────────────────

/**
 * ⚠️ BẤT BIẾN #3 — credential ở đây do SERVER sinh từ env (`CLOUDFLARE_TURN_KEY_ID` /
 * `CLOUDFLARE_TURN_API_TOKEN`), hạn ngắn, và **KHÔNG được ghi log** ở bất kỳ mức nào. Secret gốc
 * KHÔNG bao giờ xuống client — chỉ credential dẫn xuất.
 */
export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export const iceConfigSchema = z.object({ iceServers: z.array(iceServerSchema) });
export type IceConfigDto = z.infer<typeof iceConfigSchema>;

// ─── tín hiệu WebRTC (/ws-call — hàng rào R1·R2·R3) ───────────────────────────

/**
 * ⚠️ ALLOWLIST **ĐÓNG** — đúng 8 sự kiện inbound (DECISIONS-07 §4 · SPEC-15 CHAT-DEC-020 R2).
 * Sự kiện ngoài danh sách ⇒ **ngắt kết nối** + ghi `user_security_events` (CHAT-ERR-030), KHÔNG trả
 * lỗi nghiệp vụ mô tả — phản hồi càng cụ thể càng tiện cho việc dò danh sách được chấp nhận.
 *
 * ⚠️ Đây là kênh DUY NHẤT trong hệ thống mà client được ghi lên WS. `/ws` (CHAT + NOTI) giữ nguyên
 *    **0 `@SubscribeMessage`** — thêm sự kiện vào đây KHÔNG phải giấy phép nới `/ws`.
 */
export const CHAT_CALL_INBOUND_EVENTS = [
  "call:join",
  "call:leave",
  "call:sdp-offer",
  "call:sdp-answer",
  "call:ice-candidate",
  "call:media-state",
  "call:ping",
  "call:screen-state",
] as const;
export type ChatCallInboundEvent = (typeof CHAT_CALL_INBOUND_EVENTS)[number];

/**
 * Trần độ dài cho tải trọng tín hiệu. SDP thực tế ~2-8KB; 64KB là trần rộng rãi mà vẫn chặn được
 * việc bơm dữ liệu tuỳ ý qua kênh relay.
 *
 * ⚠️ `sdp`/`candidate` là **CHUỖI MỜ** (hàng rào R3): server **không parse, không đọc, không lưu**.
 *    Ngày nào ta lưu SDP thì ngoại lệ `CHAT-DEC-020` **hết hiệu lực** và phải mở ADR mới.
 */
export const CHAT_CALL_SDP_MAX_LENGTH = 65_536;
export const CHAT_CALL_CANDIDATE_MAX_LENGTH = 4_096;

const callIdOnly = z.object({ callId: z.string().uuid() });

/** `call:join` · `call:leave` · `call:ping` */
export const chatCallJoinSchema = callIdOnly;
export const chatCallLeaveSchema = callIdOnly;
export const chatCallPingSchema = callIdOnly;

export const chatCallSdpSchema = z.object({
  callId: z.string().uuid(),
  toUserId: z.string().uuid(),
  sdp: z.string().min(1).max(CHAT_CALL_SDP_MAX_LENGTH),
});
export type ChatCallSdpPayload = z.infer<typeof chatCallSdpSchema>;

export const chatCallIceCandidateSchema = z.object({
  callId: z.string().uuid(),
  toUserId: z.string().uuid(),
  candidate: z.string().min(1).max(CHAT_CALL_CANDIDATE_MAX_LENGTH),
});
export type ChatCallIceCandidatePayload = z.infer<typeof chatCallIceCandidateSchema>;

export const chatCallMediaStateSchema = z.object({
  callId: z.string().uuid(),
  micOn: z.boolean(),
  camOn: z.boolean(),
});
export type ChatCallMediaStatePayload = z.infer<typeof chatCallMediaStateSchema>;

export const chatCallScreenStateSchema = z.object({
  callId: z.string().uuid(),
  sharing: z.boolean(),
});
export type ChatCallScreenStatePayload = z.infer<typeof chatCallScreenStateSchema>;
