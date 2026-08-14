/**
 * use-chat-call-signalling.spec.ts — biên `/ws-call` + `applyLifecycleEvent` (S7-CALL-QA-2).
 *
 * ⚠️ KHÔNG mock `./call-signalling` ở đây (khác `use-chat-call.spec.ts`): bài test cốt lõi của file này
 * là chứng minh luật **KHÔNG GLARE** — "ai NHẬN `call:peer-joined` thì bên đó offer" — chạy đúng bằng
 * chính `attachCallSignalListeners`/`callSignal` thật, qua một socket giả (`makeFakeSocket`) tự bắn sự
 * kiện vào, giống hệt cách `call-signalling.spec.ts` đã làm ở lớp dưới.
 *
 * Also phủ done_when#3 của S7-CALL-FE-1: mất mạng giữa cuộc gọi (ICE `failed` quá hạn ân xá, hoặc
 * unmount) phải gọi `track.stop()` thật — không chỉ đổi state.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCallDto, WsChatCallEvent } from "@mediaos/contracts";
import { CHAT_CALL_OUTBOUND_EVENTS } from "@mediaos/contracts";

vi.mock("@mediaos/web-core", () => ({
  chatCallApi: {
    createCall: vi.fn(),
    acceptCall: vi.fn(),
    rejectCall: vi.fn(),
    cancelCall: vi.fn(),
    hangupCall: vi.fn(),
    getIceConfig: vi.fn(),
  },
  getCallSocket: vi.fn(),
  closeCallSocket: vi.fn(),
}));

import { chatCallApi, closeCallSocket, getCallSocket } from "@mediaos/web-core";
import { useChatCall } from "./use-chat-call";
import {
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakePeerConnection,
  makeFakeSocket,
  stubGetUserMedia,
  stubMediaStreamGlobal,
  stubPeerConnectionGlobal,
  type FakeSocket,
} from "./call-test-doubles";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const CALL_ID = "22222222-2222-4222-8222-222222222222";
const PEER_ID = "33333333-3333-4333-8333-333333333333";
const MY_ID = "44444444-4444-4444-8444-444444444444";

const createCallMock = chatCallApi.createCall as unknown as ReturnType<typeof vi.fn>;
const acceptCallMock = chatCallApi.acceptCall as unknown as ReturnType<typeof vi.fn>;
const cancelCallMock = chatCallApi.cancelCall as unknown as ReturnType<typeof vi.fn>;
const hangupCallMock = chatCallApi.hangupCall as unknown as ReturnType<typeof vi.fn>;
const getIceConfigMock = chatCallApi.getIceConfig as unknown as ReturnType<typeof vi.fn>;
const getCallSocketMock = getCallSocket as unknown as ReturnType<typeof vi.fn>;
const closeCallSocketMock = closeCallSocket as unknown as ReturnType<typeof vi.fn>;

const CALL_DTO: ChatCallDto = {
  id: CALL_ID,
  roomId: ROOM_ID,
  initiatorUserId: MY_ID,
  kind: "audio",
  status: "ringing",
  startedAt: "2026-08-14T00:00:00.000Z",
};

let fakeSocket: FakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  stubPeerConnectionGlobal();
  stubMediaStreamGlobal();
  stubGetUserMedia();
  fakeSocket = makeFakeSocket();
  getCallSocketMock.mockReturnValue(fakeSocket.socket);
  createCallMock.mockResolvedValue(CALL_DTO);
  acceptCallMock.mockResolvedValue(CALL_DTO);
  cancelCallMock.mockResolvedValue(CALL_DTO);
  hangupCallMock.mockResolvedValue(CALL_DTO);
  getIceConfigMock.mockResolvedValue({ iceServers: [] });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ringingEvent(overrides: Partial<WsChatCallEvent> = {}): WsChatCallEvent {
  return {
    callId: CALL_ID,
    roomId: ROOM_ID,
    kind: "audio",
    status: "ringing",
    initiatorUserId: PEER_ID,
    startedAt: "2026-08-14T00:00:00.000Z",
    action: "ringing",
    ...overrides,
  };
}

async function asCaller(kind: "audio" | "video" = "audio") {
  const hook = renderHook(() => useChatCall());
  await act(async () => {
    await hook.result.current.startCall(ROOM_ID, kind);
  });
  return hook;
}

async function asCallee() {
  const hook = renderHook(() => useChatCall());
  act(() => {
    hook.result.current.applyLifecycleEvent(ringingEvent(), MY_ID);
  });
  acceptCallMock.mockResolvedValue({ ...CALL_DTO, initiatorUserId: PEER_ID, status: "active" });
  await act(async () => {
    await hook.result.current.acceptCall();
  });
  return hook;
}

describe("luật KHÔNG GLARE — ai NHẬN peer-joined thì bên đó offer (mọi thứ tự vào phòng)", () => {
  it("A vào trước (caller) rồi thấy B vào ⇒ A offer", async () => {
    await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    expect(pc.createOffer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: "offer", sdp: "fake-offer-sdp" });
    expect(fakeSocket.emit).toHaveBeenCalledWith("call:sdp-offer", {
      callId: CALL_ID,
      toUserId: PEER_ID,
      sdp: JSON.stringify({ type: "offer", sdp: "fake-offer-sdp" }),
    });
  });

  it("B vào trước (callee do race đã join sớm) rồi thấy A vào ⇒ B offer — CÙNG một quy tắc, không rẽ theo vai trò", async () => {
    await asCallee();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    expect(pc.createOffer).toHaveBeenCalled();
    expect(fakeSocket.emit).toHaveBeenCalledWith(
      "call:sdp-offer",
      expect.objectContaining({ callId: CALL_ID, toUserId: PEER_ID }),
    );
  });

  it("vào SAU và nhận được offer của bên kia ⇒ bên này TRẢ LỜI (answer), KHÔNG tự offer thêm lần nào", async () => {
    await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_OFFER, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        sdp: JSON.stringify({ type: "offer", sdp: "v=0 remote-offer" }),
      });
    });
    const pc = FakePeerConnection.instances[0];
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "v=0 remote-offer",
    });
    expect(pc.createAnswer).toHaveBeenCalled();
    expect(pc.createOffer).not.toHaveBeenCalled();
    expect(fakeSocket.emit).toHaveBeenCalledWith("call:sdp-answer", {
      callId: CALL_ID,
      toUserId: PEER_ID,
      sdp: JSON.stringify({ type: "answer", sdp: "fake-answer-sdp" }),
    });
  });
});

describe("onSdpAnswer — chỉ nạp khi đúng trạng thái have-local-offer", () => {
  it("có offer đang chờ ⇒ nạp answer", async () => {
    await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    expect(pc.signalingState).toBe("have-local-offer");

    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        sdp: JSON.stringify({ type: "answer", sdp: "v=0 remote-answer" }),
      });
    });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "v=0 remote-answer",
    });
  });

  it("KHÔNG ở have-local-offer (vd. chưa dựng pc nào) ⇒ bỏ qua, không ném", async () => {
    await asCaller();
    await expect(
      act(async () => {
        fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER, {
          callId: CALL_ID,
          fromUserId: PEER_ID,
          sdp: JSON.stringify({ type: "answer", sdp: "v=0" }),
        });
      }),
    ).resolves.not.toThrow();
  });
});

describe("onIceCandidate — hàng đợi trước khi có remoteDescription", () => {
  it("chưa có remoteDescription ⇒ xếp hàng, KHÔNG addIceCandidate ngay; có remoteDescription rồi ⇒ rút hàng + nạp trực tiếp", async () => {
    await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];

    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        candidate: JSON.stringify({ candidate: "candidate:1 …" }),
      });
    });
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.SDP_ANSWER, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        sdp: JSON.stringify({ type: "answer", sdp: "v=0" }),
      });
    });
    expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: "candidate:1 …" });

    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.ICE_CANDIDATE, {
        callId: CALL_ID,
        fromUserId: PEER_ID,
        candidate: JSON.stringify({ candidate: "candidate:2 …" }),
      });
    });
    expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: "candidate:2 …" });
  });
});

describe("onMediaState / onScreenState — cờ hiển thị của bên kia", () => {
  it("cập nhật remoteMicOn/remoteCamOn/remoteSharing từ khung server gán userId", async () => {
    const { result } = await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.MEDIA_STATE, {
        callId: CALL_ID,
        userId: PEER_ID,
        micOn: false,
        camOn: true,
      });
    });
    expect(result.current.remoteMicOn).toBe(false);
    expect(result.current.remoteCamOn).toBe(true);

    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.SCREEN_STATE, {
        callId: CALL_ID,
        userId: PEER_ID,
        sharing: true,
      });
    });
    expect(result.current.remoteSharing).toBe(true);
  });
});

describe("onPeerLeft — dây an toàn khi tab bên kia đóng thẳng", () => {
  it("bắn call:peer-left ⇒ hangup ngay (route cancel vì còn outgoing-ringing)", async () => {
    const { result } = await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT, { callId: CALL_ID, userId: PEER_ID });
    });
    expect(cancelCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(result.current.phase).toBe("idle");
  });
});

describe("dây RTCPeerConnection nội bộ — onicecandidate / ontrack / connectionstatechange", () => {
  it("onicecandidate: có candidate ⇒ emit qua callSignal; end-of-candidates (null) ⇒ KHÔNG emit", async () => {
    await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    fakeSocket.emit.mockClear();

    const candidate = {
      toJSON: () => ({ candidate: "candidate:9 …" }),
    } as unknown as RTCIceCandidate;
    act(() => {
      pc.onicecandidate?.({ candidate });
    });
    expect(fakeSocket.emit).toHaveBeenCalledWith("call:ice-candidate", {
      callId: CALL_ID,
      toUserId: PEER_ID,
      candidate: JSON.stringify({ candidate: "candidate:9 …" }),
    });

    fakeSocket.emit.mockClear();
    act(() => {
      pc.onicecandidate?.({ candidate: null });
    });
    expect(fakeSocket.emit).not.toHaveBeenCalled();
  });

  it("ontrack: gom track của bên kia vào remoteStream (không thay bằng track mới)", async () => {
    const { result } = await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    const remoteAudio = new FakeMediaStreamTrack("audio");
    act(() => {
      pc.ontrack?.({ track: remoteAudio });
    });
    expect(result.current.remoteStream?.getTracks()).toHaveLength(1);

    const remoteVideo = new FakeMediaStreamTrack("video");
    act(() => {
      pc.ontrack?.({ track: remoteVideo });
    });
    expect(result.current.remoteStream?.getTracks()).toHaveLength(2);
  });

  it("connectionstatechange → connected ⇒ phase in-call", async () => {
    const { result } = await asCaller();
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    expect(result.current.phase).toBe("connecting");
    const pc = FakePeerConnection.instances[0];
    pc.connectionState = "connected";
    act(() => {
      pc.onconnectionstatechange?.();
    });
    expect(result.current.phase).toBe("in-call");
  });
});

describe("mất mạng GIỮA cuộc gọi (done_when #3) — dọn RTCPeerConnection, KHÔNG treo camera", () => {
  it("ICE failed quá 10s ân xá ⇒ gác máy tự động: pc.close() + track.stop() thật (không chỉ đổi state)", async () => {
    const camTrack = new FakeMediaStreamTrack("video");
    const micTrack = new FakeMediaStreamTrack("audio");
    stubGetUserMedia(async () => new FakeMediaStream([micTrack, camTrack]));

    const { result } = await asCaller("video");
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];
    pc.connectionState = "connected";
    act(() => {
      pc.onconnectionstatechange?.();
    });
    expect(result.current.phase).toBe("in-call");

    vi.useFakeTimers();
    pc.connectionState = "failed";
    act(() => {
      pc.onconnectionstatechange?.();
    });
    expect(pc.restartIce).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(hangupCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(pc.close).toHaveBeenCalled();
    expect(camTrack.stop).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    expect(closeCallSocketMock).toHaveBeenCalled();
  });

  it("ICE hồi phục TRƯỚC hạn ân xá ⇒ KHÔNG gác máy, camera vẫn sống", async () => {
    const camTrack = new FakeMediaStreamTrack("video");
    stubGetUserMedia(
      async () => new FakeMediaStream([new FakeMediaStreamTrack("audio"), camTrack]),
    );

    const { result } = await asCaller("video");
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];

    vi.useFakeTimers();
    pc.connectionState = "failed";
    act(() => {
      pc.onconnectionstatechange?.();
    });

    pc.connectionState = "connected";
    act(() => {
      pc.onconnectionstatechange?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(hangupCallMock).not.toHaveBeenCalled();
    expect(camTrack.stop).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("in-call");
  });

  it("unmount giữa cuộc gọi (đóng tab) ⇒ cleanup chạy, camera KHÔNG treo sáng", async () => {
    const camTrack = new FakeMediaStreamTrack("video");
    const micTrack = new FakeMediaStreamTrack("audio");
    stubGetUserMedia(async () => new FakeMediaStream([micTrack, camTrack]));

    const { unmount } = await asCaller("video");
    await act(async () => {
      fakeSocket.fire(CHAT_CALL_OUTBOUND_EVENTS.PEER_JOINED, { callId: CALL_ID, userId: PEER_ID });
    });
    const pc = FakePeerConnection.instances[0];

    unmount();

    expect(pc.close).toHaveBeenCalled();
    expect(camTrack.stop).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(closeCallSocketMock).toHaveBeenCalled();
  });
});

describe("applyLifecycleEvent — nạp mốc `chat:call` từ `/ws`", () => {
  it("ringing do CHÍNH MÌNH khởi tạo ⇒ bỏ qua (startCall đã dựng phiên rồi)", () => {
    const { result } = renderHook(() => useChatCall());
    act(() => {
      result.current.applyLifecycleEvent(ringingEvent({ initiatorUserId: MY_ID }), MY_ID);
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.session).toBeNull();
  });

  it("đang bận một cuộc khác ⇒ bỏ qua cuộc thứ hai (máy trạng thái chỉ giữ đúng 1 cuộc)", () => {
    const { result } = renderHook(() => useChatCall());
    act(() => {
      result.current.applyLifecycleEvent(ringingEvent(), MY_ID);
    });
    expect(result.current.session?.callId).toBe(CALL_ID);

    const otherCallId = "55555555-5555-4555-8555-555555555555";
    act(() => {
      result.current.applyLifecycleEvent(
        ringingEvent({
          callId: otherCallId,
          initiatorUserId: "66666666-6666-4666-8666-666666666666",
        }),
        MY_ID,
      );
    });
    expect(result.current.session?.callId).toBe(CALL_ID);
  });

  it("ringing hợp lệ ⇒ incoming-ringing, session + peerUserId = người gọi", () => {
    const { result } = renderHook(() => useChatCall());
    act(() => {
      result.current.applyLifecycleEvent(ringingEvent(), MY_ID);
    });
    expect(result.current.phase).toBe("incoming-ringing");
    expect(result.current.peerUserId).toBe(PEER_ID);
  });

  it("accepted khớp callId đang chờ ⇒ connecting; khác callId ⇒ bỏ qua", async () => {
    const { result } = await asCaller();
    act(() => {
      result.current.applyLifecycleEvent(
        {
          callId: CALL_ID,
          roomId: ROOM_ID,
          kind: "audio",
          status: "active",
          initiatorUserId: MY_ID,
          startedAt: "2026-08-14T00:00:00.000Z",
          action: "accepted",
        },
        MY_ID,
      );
    });
    expect(result.current.phase).toBe("connecting");

    act(() => {
      result.current.applyLifecycleEvent(
        {
          callId: "77777777-7777-4777-8777-777777777777",
          roomId: ROOM_ID,
          kind: "audio",
          status: "active",
          initiatorUserId: MY_ID,
          startedAt: "2026-08-14T00:00:00.000Z",
          action: "accepted",
        },
        MY_ID,
      );
    });
    expect(result.current.session?.callId).toBe(CALL_ID);
  });

  it("rejected/cancelled/ended/missed ⇒ MỘT đường dọn chung (fullCleanup)", async () => {
    const { result } = await asCaller();
    act(() => {
      result.current.applyLifecycleEvent(
        {
          callId: CALL_ID,
          roomId: ROOM_ID,
          kind: "audio",
          status: "rejected",
          initiatorUserId: MY_ID,
          startedAt: "2026-08-14T00:00:00.000Z",
          action: "rejected",
        },
        MY_ID,
      );
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.session).toBeNull();
  });
});
