/**
 * use-chat-call.spec.ts — vòng đời cuộc gọi (S7-CALL-QA-2, điểm mù #1/1.241 dòng).
 *
 * Phủ: startCall/acceptCall/rejectCall/hangup, suy giảm media (không mic/camera/quyền bị từ chối),
 * công tắc mic/camera, chia sẻ màn hình. Nhánh signalling (peer-joined/SDP/ICE/applyLifecycleEvent/dọn
 * khi mất mạng) nằm ở `use-chat-call-signalling.spec.ts` — tách theo mối quan tâm, tránh 1 file > 800 dòng.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCallDto } from "@mediaos/contracts";

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

vi.mock("./call-signalling", () => ({
  attachCallSignalListeners: vi.fn(() => vi.fn()),
  callSignal: {
    join: vi.fn(),
    leave: vi.fn(),
    sdpOffer: vi.fn(),
    sdpAnswer: vi.fn(),
    iceCandidate: vi.fn(),
    mediaState: vi.fn(),
    screenState: vi.fn(),
  },
}));

import { chatCallApi, getCallSocket } from "@mediaos/web-core";
import { callSignal } from "./call-signalling";
import { useChatCall } from "./use-chat-call";
import {
  FakeMediaStream,
  FakeMediaStreamTrack,
  stubGetUserMedia,
  stubMediaStreamGlobal,
  stubPeerConnectionGlobal,
} from "./call-test-doubles";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const CALL_ID = "22222222-2222-4222-8222-222222222222";
const PEER_ID = "33333333-3333-4333-8333-333333333333";
const MY_ID = "44444444-4444-4444-8444-444444444444";
const FAKE_SOCKET = { id: "fake-socket" } as unknown as ReturnType<typeof getCallSocket>;

const createCallMock = chatCallApi.createCall as unknown as ReturnType<typeof vi.fn>;
const acceptCallMock = chatCallApi.acceptCall as unknown as ReturnType<typeof vi.fn>;
const rejectCallMock = chatCallApi.rejectCall as unknown as ReturnType<typeof vi.fn>;
const cancelCallMock = chatCallApi.cancelCall as unknown as ReturnType<typeof vi.fn>;
const hangupCallMock = chatCallApi.hangupCall as unknown as ReturnType<typeof vi.fn>;
const getCallSocketMock = getCallSocket as unknown as ReturnType<typeof vi.fn>;
const mediaStateMock = callSignal.mediaState as unknown as ReturnType<typeof vi.fn>;
const screenStateMock = callSignal.screenState as unknown as ReturnType<typeof vi.fn>;

const CALL_DTO: ChatCallDto = {
  id: CALL_ID,
  roomId: ROOM_ID,
  initiatorUserId: MY_ID,
  kind: "audio",
  status: "ringing",
  startedAt: "2026-08-14T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  stubPeerConnectionGlobal();
  stubMediaStreamGlobal();
  stubGetUserMedia();
  getCallSocketMock.mockReturnValue(FAKE_SOCKET);
  createCallMock.mockResolvedValue(CALL_DTO);
  acceptCallMock.mockResolvedValue(CALL_DTO);
  rejectCallMock.mockResolvedValue(CALL_DTO);
  cancelCallMock.mockResolvedValue(CALL_DTO);
  hangupCallMock.mockResolvedValue(CALL_DTO);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startCall", () => {
  it("thành công ⇒ tạo call, mở signalling, phase = outgoing-ringing", async () => {
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    expect(createCallMock).toHaveBeenCalledWith(ROOM_ID, "audio");
    expect(result.current.phase).toBe("outgoing-ringing");
    expect(result.current.session?.callId).toBe(CALL_ID);
  });

  it("createCall lỗi ⇒ trả camera lại NGAY (track.stop, không chỉ tắt enabled)", async () => {
    const audioTrack = new FakeMediaStreamTrack("audio");
    const videoTrack = new FakeMediaStreamTrack("video");
    stubGetUserMedia(async () => new FakeMediaStream([audioTrack, videoTrack]));
    createCallMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "video");
    });

    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    expect(result.current.localStream).toBeNull();
    expect(result.current.notice).toBeTruthy();
  });

  it("gọi lần hai khi đã có phiên ⇒ bỏ qua", async () => {
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    expect(createCallMock).toHaveBeenCalledTimes(1);
  });
});

describe("acquireLocalMedia — suy giảm, không bỏ cuộc", () => {
  it("không có navigator.mediaDevices ⇒ notice + chỉ-nghe, cuộc gọi vẫn tiếp tục", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    expect(result.current.localStream).toBeNull();
    expect(result.current.notice).toMatch(/mic\/camera/i);
    expect(result.current.phase).toBe("outgoing-ringing");
  });

  it("gọi video mà máy không có camera (NotFoundError) ⇒ hạ xuống audio-only", async () => {
    stubGetUserMedia(async (constraints) => {
      if (constraints.video) {
        const err = new Error("no camera");
        err.name = "NotFoundError";
        throw err;
      }
      return new FakeMediaStream([new FakeMediaStreamTrack("audio")]);
    });
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "video");
    });
    expect(result.current.localStream).not.toBeNull();
    expect(result.current.camOn).toBe(false);
    expect(result.current.notice).toMatch(/không tìm thấy camera/i);
  });

  it("bị từ chối quyền (NotAllowedError) ⇒ chỉ-nghe, thông điệp đúng lý do", async () => {
    stubGetUserMedia(async () => {
      const err = new Error("denied");
      err.name = "NotAllowedError";
      throw err;
    });
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    expect(result.current.localStream).toBeNull();
    expect(result.current.notice).toMatch(/từ chối quyền/i);
  });

  it("mic/camera đang bị app khác dùng (NotReadableError) ⇒ chỉ-nghe", async () => {
    stubGetUserMedia(async () => {
      const err = new Error("busy");
      err.name = "NotReadableError";
      throw err;
    });
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    expect(result.current.notice).toMatch(/đang được ứng dụng khác dùng/i);
  });
});

describe("acceptCall / rejectCall / hangup", () => {
  function ringSession(): ReturnType<typeof renderHook<ReturnType<typeof useChatCall>, unknown>> {
    const hook = renderHook(() => useChatCall());
    act(() => {
      hook.result.current.applyLifecycleEvent(
        {
          callId: CALL_ID,
          roomId: ROOM_ID,
          kind: "audio",
          status: "ringing",
          initiatorUserId: PEER_ID,
          startedAt: "2026-08-14T00:00:00.000Z",
          action: "ringing",
        },
        MY_ID,
      );
    });
    return hook;
  }

  it("acceptCall bị bỏ qua khi KHÔNG ở incoming-ringing", async () => {
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.acceptCall();
    });
    expect(acceptCallMock).not.toHaveBeenCalled();
  });

  it("acceptCall thành công ⇒ phase connecting", async () => {
    const { result } = ringSession();
    expect(result.current.phase).toBe("incoming-ringing");
    acceptCallMock.mockResolvedValue({ ...CALL_DTO, initiatorUserId: PEER_ID, status: "active" });
    await act(async () => {
      await result.current.acceptCall();
    });
    expect(acceptCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(result.current.phase).toBe("connecting");
  });

  it("acceptCall lỗi ⇒ dọn sạch + notice", async () => {
    const { result } = ringSession();
    acceptCallMock.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.acceptCall();
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.session).toBeNull();
    expect(result.current.notice).toBeTruthy();
  });

  it("rejectCall dọn LẠC QUAN dù request lỗi mạng", async () => {
    const { result } = ringSession();
    rejectCallMock.mockRejectedValue(new Error("net"));
    act(() => {
      result.current.rejectCall();
    });
    expect(rejectCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(result.current.phase).toBe("idle");
  });

  it("hangup không có phiên ⇒ chỉ fullCleanup, KHÔNG gọi API nào", () => {
    const { result } = renderHook(() => useChatCall());
    act(() => {
      result.current.hangup();
    });
    expect(cancelCallMock).not.toHaveBeenCalled();
    expect(hangupCallMock).not.toHaveBeenCalled();
  });

  it("hangup khi đang outgoing-ringing ⇒ cancelCall (chưa ai nhận)", async () => {
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    act(() => {
      result.current.hangup();
    });
    expect(cancelCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(hangupCallMock).not.toHaveBeenCalled();
  });

  it("hangup sau khi đã accepted ⇒ hangupCall (không phải cancel — FSM một chiều)", async () => {
    const { result } = ringSession();
    acceptCallMock.mockResolvedValue({ ...CALL_DTO, initiatorUserId: PEER_ID, status: "active" });
    await act(async () => {
      await result.current.acceptCall();
    });
    act(() => {
      result.current.hangup();
    });
    expect(hangupCallMock).toHaveBeenCalledWith(CALL_ID);
    expect(cancelCallMock).not.toHaveBeenCalled();
  });
});

describe("công tắc mic/camera", () => {
  it("toggleMic/toggleCamera không làm gì khi chưa có local stream", () => {
    const { result } = renderHook(() => useChatCall());
    act(() => {
      result.current.toggleMic();
      result.current.toggleCamera();
    });
    expect(mediaStateMock).not.toHaveBeenCalled();
  });

  it("toggleMic tắt track audio thật + báo trạng thái cho bên kia", async () => {
    const audioTrack = new FakeMediaStreamTrack("audio");
    stubGetUserMedia(async () => new FakeMediaStream([audioTrack]));
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "audio");
    });
    act(() => {
      result.current.toggleMic();
    });
    expect(audioTrack.enabled).toBe(false);
    expect(result.current.micOn).toBe(false);
    // Cuộc gọi thoại (`kind:"audio"`) ⇒ `camOn` bị startCall đặt `false` ngay từ đầu (không có video).
    expect(mediaStateMock).toHaveBeenCalledWith(FAKE_SOCKET, CALL_ID, false, false);
  });

  it("toggleCamera tắt track video thật + báo trạng thái", async () => {
    const audioTrack = new FakeMediaStreamTrack("audio");
    const videoTrack = new FakeMediaStreamTrack("video");
    stubGetUserMedia(async () => new FakeMediaStream([audioTrack, videoTrack]));
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.startCall(ROOM_ID, "video");
    });
    act(() => {
      result.current.toggleCamera();
    });
    expect(videoTrack.enabled).toBe(false);
    expect(result.current.camOn).toBe(false);
    expect(mediaStateMock).toHaveBeenCalledWith(FAKE_SOCKET, CALL_ID, true, false);
  });
});

describe("chia sẻ màn hình — chưa vào cuộc (chưa có RTCPeerConnection)", () => {
  // `pc` chỉ được dựng bởi `ensurePeerConnection`, kích hoạt từ `onPeerJoined`/`onSdpOffer` của
  // `./call-signalling` — module đó bị mock hoàn toàn ở file này (xem đầu file). Luồng bật/tắt chia
  // sẻ màn hình có `pc` thật được phủ ở `use-chat-call-signalling.spec.ts`, nơi socket là thật.
  it("gọi trước khi có cuộc gọi ⇒ không làm gì, không emit trạng thái", async () => {
    const { result } = renderHook(() => useChatCall());
    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(screenStateMock).not.toHaveBeenCalled();
    expect(result.current.isSharingScreen).toBe(false);
  });
});
