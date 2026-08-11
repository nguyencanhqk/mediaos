/**
 * S7-CALL-FE-1 — lớp mỏng gõ kiểu trên `/ws-call` (namespace tín hiệu, `DECISIONS-07` R1).
 *
 * Tệp này KHÔNG có state và KHÔNG phải hook: nó chỉ dịch giữa hình dạng WebRTC của trình duyệt
 * (`RTCSessionDescriptionInit` / `RTCIceCandidateInit`) và hình dạng trên dây (**chuỗi mờ**). Tách ra
 * khỏi `use-chat-call.ts` để chỗ duy nhất biết về hợp đồng dây nằm gọn một chỗ, đọc được cạnh
 * `packages/contracts/src/chat-call.ts`.
 *
 * ⚠️ HÀNG RÀO **R3**: `sdp`/`candidate` đi qua server dưới dạng **chuỗi không được parse**. Việc
 * `JSON.stringify`/`JSON.parse` là của FE, hai đầu. Server không đọc, không lưu, và không có cách nào
 * biết bên trong chuỗi là gì — đó là điều kiện owner ký để `/ws-call` được phép tồn tại.
 */
import { getCallSocket } from "@mediaos/web-core";
import {
  CHAT_CALL_CANDIDATE_MAX_LENGTH,
  CHAT_CALL_OUTBOUND_EVENTS,
  CHAT_CALL_SDP_MAX_LENGTH,
  chatCallRelayIceCandidateSchema,
  chatCallRelayMediaStateSchema,
  chatCallRelayScreenStateSchema,
  chatCallRelaySdpSchema,
  chatCallPeerSchema,
} from "@mediaos/contracts";

/**
 * Kiểu socket, SUY RA từ `getCallSocket()` thay vì `import type { Socket } from "socket.io-client"`.
 *
 * Hai lý do, không phải một mẹo gõ kiểu: (1) `socket.io-client` **không** là dependency của `apps/app`
 * — nó sống ở `web-core`, và thêm vào đây chỉ để lấy một kiểu là mở đường cho một `io()` thứ hai;
 * (2) ESLint `no-restricted-imports` chặn đúng dòng import đó, và một `import type` lách được luật là
 * lách sai tinh thần của nó.
 */
type CallSocket = NonNullable<ReturnType<typeof getCallSocket>>;

/** Sự kiện inbound của gateway — allowlist ĐÓNG đúng 8. Client CHỈ được emit những khoá này. */
const EMIT = {
  JOIN: "call:join",
  LEAVE: "call:leave",
  SDP_OFFER: "call:sdp-offer",
  SDP_ANSWER: "call:sdp-answer",
  ICE_CANDIDATE: "call:ice-candidate",
  MEDIA_STATE: "call:media-state",
  SCREEN_STATE: "call:screen-state",
} as const;

/**
 * Đóng gói SDP/ICE thành chuỗi. Trả `null` khi VƯỢT TRẦN của server.
 *
 * Vượt trần thì gateway **ngắt kết nối** (hàng rào R2 coi khung quá khổ là vi phạm), nên gửi đi là tự
 * giết cuộc gọi của chính mình. Chặn ở đây, ghi log, và để cuộc gọi tiếp tục thiếu một candidate —
 * WebRTC còn những candidate khác để thử. SDP quá khổ thì cuộc gọi hỏng thật, nhưng nó hỏng KÈM một
 * dòng log chỉ đúng chỗ, thay vì "socket tự rớt" không lý do.
 */
function pack(value: unknown, maxLength: number, label: string): string | null {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") return null;
  if (encoded.length > maxLength) {
    console.error(`[call] ${label} vượt trần ${maxLength} ký tự (${encoded.length}) — KHÔNG gửi`);
    return null;
  }
  return encoded;
}

/**
 * Mở gói chuỗi mờ nhận về. `null` khi hỏng.
 *
 * ⚠️ Ném ra khỏi một listener của socket.io là ném vào vòng lặp sự kiện của thư viện — hành vi tuỳ
 * phiên bản, và tệ nhất là giết kết nối. Một khung hỏng phải chết một mình.
 */
function unpack<T>(encoded: string, label: string): T | null {
  try {
    return JSON.parse(encoded) as T;
  } catch (error) {
    console.error(`[call] ${label} không phải JSON hợp lệ — bỏ qua:`, error);
    return null;
  }
}

export interface CallSignalHandlers {
  onPeerJoined: (userId: string) => void;
  onPeerLeft: (userId: string) => void;
  onSdpOffer: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void;
  onSdpAnswer: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate: (fromUserId: string, candidate: RTCIceCandidateInit) => void;
  onMediaState: (userId: string, micOn: boolean, camOn: boolean) => void;
  onScreenState: (userId: string, sharing: boolean) => void;
}

/**
 * Gắn listener cho MỘT cuộc gọi. Trả hàm gỡ.
 *
 * `callId` được kiểm ở đây chứ không ở handler: relay `call:ice-candidate` bắn vào room RIÊNG của từng
 * người (`callUserRoomName`), nên một socket còn sống qua hai cuộc gọi liên tiếp có thể nhận candidate
 * muộn của cuộc trước. Nạp nhầm vào `RTCPeerConnection` của cuộc sau là hỏng ICE mà không có lỗi nào.
 */
export function attachCallSignalListeners(
  socket: CallSocket,
  callId: string,
  handlers: CallSignalHandlers,
): () => void {
  const onPeerJoined = (payload: unknown): void => {
    const parsed = chatCallPeerSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    handlers.onPeerJoined(parsed.data.userId);
  };

  const onPeerLeft = (payload: unknown): void => {
    const parsed = chatCallPeerSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    handlers.onPeerLeft(parsed.data.userId);
  };

  const onSdpOffer = (payload: unknown): void => {
    const parsed = chatCallRelaySdpSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    const sdp = unpack<RTCSessionDescriptionInit>(parsed.data.sdp, "sdp-offer");
    if (sdp) handlers.onSdpOffer(parsed.data.fromUserId, sdp);
  };

  const onSdpAnswer = (payload: unknown): void => {
    const parsed = chatCallRelaySdpSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    const sdp = unpack<RTCSessionDescriptionInit>(parsed.data.sdp, "sdp-answer");
    if (sdp) handlers.onSdpAnswer(parsed.data.fromUserId, sdp);
  };

  const onIceCandidate = (payload: unknown): void => {
    const parsed = chatCallRelayIceCandidateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    const candidate = unpack<RTCIceCandidateInit>(parsed.data.candidate, "ice-candidate");
    if (candidate) handlers.onIceCandidate(parsed.data.fromUserId, candidate);
  };

  const onMediaState = (payload: unknown): void => {
    const parsed = chatCallRelayMediaStateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    handlers.onMediaState(parsed.data.userId, parsed.data.micOn, parsed.data.camOn);
  };

  const onScreenState = (payload: unknown): void => {
    const parsed = chatCallRelayScreenStateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.callId !== callId) return;
    handlers.onScreenState(parsed.data.userId, parsed.data.sharing);
  };

  socket.on(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, onPeerJoined);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT, onPeerLeft);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER, onSdpOffer);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER, onSdpAnswer);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, onIceCandidate);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.MEDIA_STATE, onMediaState);
  socket.on(CHAT_CALL_OUTBOUND_EVENTS.SCREEN_STATE, onScreenState);

  return () => {
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, onPeerJoined);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT, onPeerLeft);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER, onSdpOffer);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER, onSdpAnswer);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, onIceCandidate);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.MEDIA_STATE, onMediaState);
    socket.off(CHAT_CALL_OUTBOUND_EVENTS.SCREEN_STATE, onScreenState);
  };
}

export const callSignal = {
  join: (socket: CallSocket, callId: string): void => {
    socket.emit(EMIT.JOIN, { callId });
  },

  leave: (socket: CallSocket, callId: string): void => {
    socket.emit(EMIT.LEAVE, { callId });
  },

  sdpOffer: (socket: CallSocket, callId: string, toUserId: string, sdp: RTCSessionDescriptionInit) => {
    const packed = pack(sdp, CHAT_CALL_SDP_MAX_LENGTH, "sdp-offer");
    if (packed) socket.emit(EMIT.SDP_OFFER, { callId, toUserId, sdp: packed });
  },

  sdpAnswer: (socket: CallSocket, callId: string, toUserId: string, sdp: RTCSessionDescriptionInit) => {
    const packed = pack(sdp, CHAT_CALL_SDP_MAX_LENGTH, "sdp-answer");
    if (packed) socket.emit(EMIT.SDP_ANSWER, { callId, toUserId, sdp: packed });
  },

  iceCandidate: (
    socket: CallSocket,
    callId: string,
    toUserId: string,
    candidate: RTCIceCandidateInit,
  ) => {
    const packed = pack(candidate, CHAT_CALL_CANDIDATE_MAX_LENGTH, "ice-candidate");
    if (packed) socket.emit(EMIT.ICE_CANDIDATE, { callId, toUserId, candidate: packed });
  },

  mediaState: (socket: CallSocket, callId: string, micOn: boolean, camOn: boolean): void => {
    socket.emit(EMIT.MEDIA_STATE, { callId, micOn, camOn });
  },

  screenState: (socket: CallSocket, callId: string, sharing: boolean): void => {
    socket.emit(EMIT.SCREEN_STATE, { callId, sharing });
  },
};
