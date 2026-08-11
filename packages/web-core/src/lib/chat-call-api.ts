import {
  chatCallSchema,
  type ChatCallDto,
  type ChatCallKind,
  iceConfigSchema,
  type IceConfigDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * S7-CALL-FE-1 — client REST cho vòng đời cuộc gọi (`CHAT-API-026..029`).
 *
 * ⚠️ HÀNG RÀO **R4** của `CHAT-DEC-020` sống ở tệp này: vòng đời cuộc gọi (mời · nhận · từ chối · huỷ ·
 * gác) đi **REST**, KHÔNG đi WebSocket. `/ws-call` chỉ chở SDP/ICE/media-state. Bản LMS mà WO này port
 * từ đó emit cả vòng đời qua socket (`inviteCall`/`acceptCall`/…) — phần đó **bỏ hẳn**, không phải
 * "chuyển sang REST rồi vẫn emit cho chắc": hai đường ghi cho cùng một FSM là hai đường phải giữ đồng bộ.
 *
 * MIRROR BE `chat-calls.controller.ts` + `chat-call-ice.controller.ts`. Đổi route ở BE mà quên tệp này
 * thì triệu chứng là 404 lúc bấm gọi — nên mọi đường dưới đây có ca test đóng đinh đúng chuỗi path.
 */
export const chatCallApi = {
  /** POST /chat/rooms/:id/calls (CHAT-API-026) — mời. 409 nếu phòng đang có cuộc gọi sống. */
  createCall: (roomId: string, kind: ChatCallKind): Promise<ChatCallDto> =>
    apiFetch(`/chat/rooms/${roomId}/calls`, chatCallSchema, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),

  /** POST /chat/calls/:id/accept (CHAT-API-027) — nhận. Chỉ người được mời. */
  acceptCall: (callId: string): Promise<ChatCallDto> =>
    apiFetch(`/chat/calls/${callId}/accept`, chatCallSchema, { method: "POST" }),

  /** POST /chat/calls/:id/reject (CHAT-API-027) — từ chối. Chỉ khi còn đổ chuông. */
  rejectCall: (callId: string): Promise<ChatCallDto> =>
    apiFetch(`/chat/calls/${callId}/reject`, chatCallSchema, { method: "POST" }),

  /** POST /chat/calls/:id/cancel (CHAT-API-028) — huỷ. Chỉ người khởi tạo, chỉ khi chưa ai nhận. */
  cancelCall: (callId: string): Promise<ChatCallDto> =>
    apiFetch(`/chat/calls/${callId}/cancel`, chatCallSchema, { method: "POST" }),

  /** POST /chat/calls/:id/hangup (CHAT-API-028) — kết thúc. Bên nào cũng gác được. */
  hangupCall: (callId: string): Promise<ChatCallDto> =>
    apiFetch(`/chat/calls/${callId}/hangup`, chatCallSchema, { method: "POST" }),

  /**
   * GET /chat/calls/ice-config (CHAT-API-029) — ICE server hạn ngắn do SERVER sinh.
   *
   * ⚠️ Credential trong response là **secret dẫn xuất** (TTL 600 s): KHÔNG log, KHÔNG nhét vào store
   * Zustand (devtools ghi lại state), KHÔNG cache qua `localStorage`. Nó chỉ sống trong một `useRef`
   * của hook cuộc gọi và chết cùng cuộc gọi.
   */
  getIceConfig: (): Promise<IceConfigDto> => apiFetch(`/chat/calls/ice-config`, iceConfigSchema),
};
