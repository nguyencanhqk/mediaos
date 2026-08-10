import { CHAT_CALL_INBOUND_EVENTS, WS_CALL_NAMESPACE } from "@mediaos/contracts";
import type { ChatCallInboundEvent } from "@mediaos/contracts";
import { CHAT_ERR } from "./chat.errors";

/**
 * S7-CALL-RT-1 — LUẬT TỪ CHỐI của `/ws-call`, tách khỏi gateway thành **hàm thuần**.
 *
 * ┌─ VÌ SAO FILE NÀY SỐNG Ở `src/chat/` CHỨ KHÔNG Ở `src/realtime/` ─────────────────────────────────┐
 * │ `chat-error-code-census.spec.ts` ca "hằng mã lỗi chết" chỉ quét `readdirSync(src/chat)`. Một hằng │
 * │ `CHAT_ERR.*` mà caller duy nhất nằm ngoài thư mục đó sẽ bị đo là **hằng chết** ⇒ census ĐỎ ở một  │
 * │ file mà WO không định sửa. Đặt luật ở đây làm caller nằm trong tầm quét, và giữ `realtime/**` chỉ │
 * │ còn phần vận chuyển.                                                                             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Thuần (0 I/O, 0 DI) để bằng chứng của nó sống ở glob `src` — LUÔN chạy, không `skipIf(!LANE_DB)`.
 */

/** Ba sự kiện **RELAY** — chúng đẩy dữ liệu tới một người khác, nên bị xử nặng hơn 5 sự kiện còn lại. */
const RELAY_EVENTS: ReadonlySet<string> = new Set<ChatCallInboundEvent>([
  "call:sdp-offer",
  "call:sdp-answer",
  "call:ice-candidate",
]);

const INBOUND: ReadonlySet<string> = new Set<string>(CHAT_CALL_INBOUND_EVENTS);

/** Lý do từ chối — bộ ĐÓNG, và là thứ DUY NHẤT được ghi lại về một khung bị từ chối. */
export type SignalDenyReason = "not_allowlisted" | "schema" | "too_long" | "not_participant";

/**
 * `probe` = dò cửa ⇒ ghi `user_security_events` + ngắt. `race` = đua vòng đời ⇒ **bỏ im lặng**.
 * Xem `classifyMissingParticipant` cho lý do đầy đủ của việc tách hai lớp này.
 */
export type MissingParticipantVerdict = "probe" | "race";

/** Khung có được nhận vào xử lý không (hàng rào **R2** — allowlist ĐÓNG đúng 8). */
export function isInboundCallEvent(event: string): event is ChatCallInboundEvent {
  return INBOUND.has(event);
}

/**
 * Actor gửi một khung HỢP LỆ nhưng **không có hàng `chat_call_participants`** — xử thế nào?
 *
 * ⚠️ Đây là quyết định quan trọng nhất của WO, và nó KHÔNG phải "nới lỏng cho tiện":
 *
 * - **RELAY** (`sdp-offer`/`sdp-answer`/`ice-candidate`) → `probe`. Người không thuộc cuộc gọi mà đẩy
 *   tín hiệu vào đó đang cố chen vào phiên WebRTC của người khác. Không có ca hợp lệ nào.
 * - **Còn lại** (`join`/`leave`/`ping`/`media-state`/`screen-state`) → `race`. Hai ca THẬT, xảy ra hằng
 *   ngày: (1) người được mời thứ 21 trở đi bị `CHAT_CALL_MAX_INVITEES = 20` cắt — họ là thành viên phòng
 *   hợp lệ, FE của họ vẫn có thể thử `call:join`; (2) khung tới sau khi cuộc gọi vừa kết thúc.
 *   Xếp chúng vào `probe` nghĩa là mỗi cuộc gọi kết thúc bình thường ghi thêm vài hàng vào
 *   `user_security_events` — bảng **append-only, KHÔNG có job dọn** — và ngắt kết nối một người dùng
 *   hợp lệ. Hàng rào chống bơm sẽ tự trở thành đường bơm.
 *
 * Không có nhánh `default` im lặng: sự kiện thứ 9 (nếu ai đó nới allowlist) rơi vào `probe` — fail-closed
 * — và ca test "mọi sự kiện đều được phân loại" bắt buộc người thêm phải chọn có ý thức.
 */
export function classifyMissingParticipant(event: string): MissingParticipantVerdict {
  return RELAY_EVENTS.has(event) ? "probe" : "race";
}

/** Hình dạng ĐÓNG của `user_security_events.payload` cho `CALL_SIGNALLING_VIOLATION`. */
export interface SignalViolationPayload {
  ns: typeof WS_CALL_NAMESPACE;
  event: string;
  reason: SignalDenyReason;
  code: string;
}

/**
 * Dựng payload forensic — **ĐÓNG, và không có đường nào nhận nội dung khung**.
 *
 * ⚠️ **ĐÂY LÀ CHỖ R3 CÓ THỂ BỊ PHÁ BẰNG CỬA SAU.** Cách viết forensic tự nhiên nhất là nhét khung vi
 * phạm vào payload "để điều tra". Làm thế là **LƯU SDP vào một bảng append-only không xoá được**, và
 * theo `DECISIONS-07` R3 thì ngày ta lưu SDP là ngày ngoại lệ `CHAT-DEC-020` HẾT HIỆU LỰC — tức cả cái
 * cửa `/ws-call` này mất cơ sở. `AuditMaskerService` **không** cứu: nó mask theo TÊN KHOÁ
 * (`password`/`token`/`secret`/`*_hash`), còn `sdp`/`candidate` không nằm trong danh sách đó.
 *
 * Vì vậy hàm nhận đúng **hai** tham số, cả hai là giá trị SERVER tự biết. Thêm tham số thứ ba là một
 * quyết định phải qua ADR, không phải một dòng trong lần sửa sau. Có ca test ghim `.length === 2`.
 *
 * `event` được LỌC QUA ALLOWLIST trước khi ghi: tên sự kiện là chuỗi do CLIENT đặt tự do — ghi thẳng là
 * cho phép bơm nội dung tuỳ ý (kể cả chính SDP) vào bảng append-only qua một khoá khác.
 */
export function buildSignalViolationPayload(
  event: string,
  reason: SignalDenyReason,
): SignalViolationPayload {
  return {
    ns: WS_CALL_NAMESPACE,
    event: isInboundCallEvent(event) ? event : "unknown",
    reason,
    // Lấy MÃ từ hằng thông điệp — một chuỗi "CHAT-ERR-030" gõ tay ở đây là bản sao sẽ trôi khi spec đổi.
    code: CHAT_ERR.CALL_SIGNAL_REJECTED.split(":")[0],
  };
}

// ─── trần khung theo SOCKET (V7 — chống khuếch đại DoS lên DB) ────────────────

/**
 * ⚠️ **Vì sao cần trần này dù đã có allowlist + cổng quyền.** Lớp `race` ở trên cố ý *không ghi, không
 * ngắt* — nhưng mỗi khung vẫn tốn **2 truy vấn** (`assertCallAccess` + `listParticipants`). Nest gửi
 * handler qua `mergeMap` **concurrency vô hạn** (`@nestjs/platform-socket.io/adapters/io-adapter.js`),
 * nên một socket bắn 10.000 khung sinh 10.000 truy vấn ĐỒNG THỜI trên pool PgBouncer dùng chung TOÀN
 * API — một người dùng hợp lệ (hoặc một token bị đánh cắp) kéo sập mọi module khác.
 *
 * Trần đặt **trước** mọi truy vấn, thuần in-memory trên `socket.data`: quyết định này chỉ có nghĩa cho
 * MỘT kết nối, không cần chia sẻ qua Valkey.
 *
 * Con số: SDP + trickle ICE của một cuộc gọi 1-1 hiếm khi vượt ~50 khung trong 10 s (mạng xấu đẻ nhiều
 * candidate hơn — đó là lý do trần rộng gấp đôi). Đặt chặt hơn là **bóp chết chính cuộc gọi, và hỏng IM
 * LẶNG**: khung bị bỏ không sinh lỗi nào, người dùng chỉ thấy "không nối được".
 */
export const CALL_SIGNAL_FRAME_WINDOW_MS = 10_000;
export const CALL_SIGNAL_FRAMES_PER_WINDOW = 120;
/** Vượt `FRAMES_PER_WINDOW × hệ số` trong cùng cửa sổ = không còn là mạng xấu nữa ⇒ ngắt. */
export const CALL_SIGNAL_HARD_MULTIPLIER = 3;

/**
 * Trần ghi `user_security_events` theo NGƯỜI (bucket `ChatCallCooldownService`), cửa sổ 60 s.
 *
 * Khoá theo **người**, không theo (người, cuộc gọi): chia theo cuộc gọi thì cứ mời một cuộc gọi mới là
 * được cấp lại hạn mức. Vượt trần ⇒ **vẫn ngắt** nhưng **không ghi** — đúng lập luận `S7-CALL-BE-1` §5c:
 * đừng đổi một bảng có trần lấy một bảng không có trần.
 */
export const CHAT_CALL_VIOLATION_MAX_PER_MIN = 5;
/** Trần số HANDSHAKE `/ws-call` theo người: mỗi lần bắt tay tốn một `permissions.can()` (đọc DB). */
export const CHAT_CALL_CONNECT_MAX_PER_MIN = 30;

export interface FrameBudget {
  windowStartMs: number;
  count: number;
}

export type FrameVerdict = "ok" | "drop" | "disconnect";

export function newFrameBudget(nowMs: number): FrameBudget {
  return { windowStartMs: nowMs, count: 0 };
}

/**
 * Tính một khung vào ngân sách. **THUẦN** — trả ngân sách MỚI, không sửa tại chỗ (caller gán lại vào
 * `socket.data`), nên ca test đọc được từng bước thay vì phải quan sát tác dụng phụ.
 */
export function chargeFrame(
  budget: FrameBudget,
  nowMs: number,
): { budget: FrameBudget; verdict: FrameVerdict } {
  const fresh =
    nowMs - budget.windowStartMs >= CALL_SIGNAL_FRAME_WINDOW_MS ? newFrameBudget(nowMs) : budget;
  const next: FrameBudget = { windowStartMs: fresh.windowStartMs, count: fresh.count + 1 };

  if (next.count > CALL_SIGNAL_FRAMES_PER_WINDOW * CALL_SIGNAL_HARD_MULTIPLIER) {
    return { budget: next, verdict: "disconnect" };
  }
  return { budget: next, verdict: next.count > CALL_SIGNAL_FRAMES_PER_WINDOW ? "drop" : "ok" };
}
