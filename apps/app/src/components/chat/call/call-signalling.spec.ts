/**
 * call-signalling.spec.ts — biên `/ws-call` (S7-CALL-FE-1, plan §3).
 *
 * Hai lớp lỗi bài này chặn, cả hai đều hỏng IM LẶNG nếu không có nó:
 *  1. **Khung hỏng giết kết nối** — ném ra khỏi một listener socket.io là ném vào vòng lặp sự kiện của
 *     thư viện. Một SDP không parse được phải chết một mình.
 *  2. **Khung quá khổ tự giết cuộc gọi** — gateway coi khung vượt trần là VI PHẠM (hàng rào R2) và ngắt
 *     kết nối. Gửi đi là tự bắn vào chân mình; chặn ở client, ghi log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CALL_CANDIDATE_MAX_LENGTH,
  CHAT_CALL_OUTBOUND_EVENTS,
  CHAT_CALL_SDP_MAX_LENGTH,
} from "@mediaos/contracts";
import { attachCallSignalListeners, callSignal, type CallSignalHandlers } from "./call-signalling";

const CALL_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_CALL_ID = "66666666-6666-4666-8666-666666666666";
const PEER_ID = "22222222-2222-4222-8222-222222222222";

/** Socket giả tối thiểu — giữ bảng `event → handler` để bài test tự bắn khung vào. */
function makeSocket() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const emit = vi.fn();
  const socket = {
    emit,
    on: (event: string, fn: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    off: (event: string, fn: (payload: unknown) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((f) => f !== fn),
      );
    },
  };
  const fire = (event: string, payload: unknown): void => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  const listenerCount = (event: string): number => (listeners.get(event) ?? []).length;
  return { socket: socket as never, emit, fire, listenerCount };
}

function makeHandlers(): CallSignalHandlers & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onPeerJoined: vi.fn(),
    onPeerLeft: vi.fn(),
    onSdpOffer: vi.fn(),
    onSdpAnswer: vi.fn(),
    onIceCandidate: vi.fn(),
    onMediaState: vi.fn(),
    onScreenState: vi.fn(),
  } as never;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("chiều NHẬN — khung hỏng chết một mình", () => {
  it("ca ALLOW: SDP hợp lệ ⇒ mở gói và gọi handler kèm `fromUserId` của SERVER", () => {
    const { socket, fire } = makeSocket();
    const handlers = makeHandlers();
    attachCallSignalListeners(socket, CALL_ID, handlers);

    const sdp = { type: "offer", sdp: "v=0\r\n" };
    fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER, {
      callId: CALL_ID,
      fromUserId: PEER_ID,
      sdp: JSON.stringify(sdp),
    });

    expect(handlers.onSdpOffer).toHaveBeenCalledWith(PEER_ID, sdp);
  });

  it("SDP KHÔNG phải JSON ⇒ bỏ qua, KHÔNG ném, có log", () => {
    const { socket, fire } = makeSocket();
    const handlers = makeHandlers();
    attachCallSignalListeners(socket, CALL_ID, handlers);

    expect(() =>
      fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        sdp: "{ không phải json",
      }),
    ).not.toThrow();

    expect(handlers.onSdpOffer).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("payload sai hợp đồng (thiếu `fromUserId`) ⇒ bỏ qua", () => {
    const { socket, fire } = makeSocket();
    const handlers = makeHandlers();
    attachCallSignalListeners(socket, CALL_ID, handlers);

    fire(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, {
      callId: CALL_ID,
      candidate: JSON.stringify({ candidate: "candidate:1 …" }),
    });

    expect(handlers.onIceCandidate).not.toHaveBeenCalled();
  });

  it("khung của cuộc gọi KHÁC ⇒ bỏ qua", () => {
    // Relay ICE bắn vào room RIÊNG của từng người, nên một socket sống qua hai cuộc gọi liên tiếp CÓ
    // THỂ nhận candidate muộn của cuộc trước. Nạp nhầm vào PC của cuộc sau là hỏng ICE không dấu vết.
    const { socket, fire } = makeSocket();
    const handlers = makeHandlers();
    attachCallSignalListeners(socket, CALL_ID, handlers);

    fire(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, {
      callId: OTHER_CALL_ID,
      fromUserId: PEER_ID,
      candidate: JSON.stringify({ candidate: "candidate:1 …" }),
    });

    expect(handlers.onIceCandidate).not.toHaveBeenCalled();
  });

  it("hàm gỡ tháo SẠCH cả 7 kênh", () => {
    const { socket, listenerCount } = makeSocket();
    const detach = attachCallSignalListeners(socket, CALL_ID, makeHandlers());
    const events = Object.values(CHAT_CALL_OUTBOUND_EVENTS).filter((e) => e !== "call:pong");

    for (const event of events) expect(listenerCount(event)).toBe(1);
    detach();
    for (const event of events) expect(listenerCount(event)).toBe(0);
  });
});

describe("chiều GỬI — trần độ dài chặn ở client", () => {
  it("ca ALLOW: SDP trong trần ⇒ emit đúng khoá + đóng gói thành chuỗi", () => {
    const { socket, emit } = makeSocket();
    const sdp: RTCSessionDescriptionInit = { type: "answer", sdp: "v=0\r\n" };

    callSignal.sdpAnswer(socket, CALL_ID, PEER_ID, sdp);

    expect(emit).toHaveBeenCalledWith("call:sdp-answer", {
      callId: CALL_ID,
      toUserId: PEER_ID,
      sdp: JSON.stringify(sdp),
    });
  });

  it("SDP VƯỢT trần ⇒ KHÔNG emit (gửi đi là bị gateway ngắt kết nối)", () => {
    const { socket, emit } = makeSocket();
    const huge: RTCSessionDescriptionInit = {
      type: "offer",
      sdp: "x".repeat(CHAT_CALL_SDP_MAX_LENGTH),
    };

    callSignal.sdpOffer(socket, CALL_ID, PEER_ID, huge);

    expect(emit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("ICE candidate VƯỢT trần ⇒ KHÔNG emit; cuộc gọi vẫn còn candidate khác để thử", () => {
    const { socket, emit } = makeSocket();

    callSignal.iceCandidate(socket, CALL_ID, PEER_ID, {
      candidate: "y".repeat(CHAT_CALL_CANDIDATE_MAX_LENGTH),
    });

    expect(emit).not.toHaveBeenCalled();
  });

  it("KHÔNG emit khoá nào ngoài allowlist ĐÓNG 8 sự kiện", () => {
    // Sự kiện ngoài danh sách ⇒ gateway ghi `user_security_events` + NGẮT (hàng rào R2). Bài này đóng
    // đinh phía client: mọi đường gửi của module cuộc gọi chỉ dùng đúng 7 khoá inbound có thật ở đây
    // (`call:ping` do tầng khác giữ nhịp, không đi qua module này).
    const { socket, emit } = makeSocket();
    const allowed = new Set([
      "call:join",
      "call:leave",
      "call:sdp-offer",
      "call:sdp-answer",
      "call:ice-candidate",
      "call:media-state",
      "call:screen-state",
    ]);

    callSignal.join(socket, CALL_ID);
    callSignal.leave(socket, CALL_ID);
    callSignal.sdpOffer(socket, CALL_ID, PEER_ID, { type: "offer", sdp: "v=0" });
    callSignal.sdpAnswer(socket, CALL_ID, PEER_ID, { type: "answer", sdp: "v=0" });
    callSignal.iceCandidate(socket, CALL_ID, PEER_ID, { candidate: "c" });
    callSignal.mediaState(socket, CALL_ID, false, true);
    callSignal.screenState(socket, CALL_ID, true);

    const emitted = emit.mock.calls.map((c) => c[0] as string);
    expect(emitted).toHaveLength(7);
    for (const event of emitted) expect(allowed.has(event)).toBe(true);
  });
});
