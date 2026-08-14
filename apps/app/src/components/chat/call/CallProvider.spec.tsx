/**
 * CallProvider.spec.tsx — chủ sở hữu DUY NHẤT của máy trạng thái (S7-CALL-QA-2, điểm mù #3/1.241 dòng).
 *
 * `useChatCall()` bị MOCK ở đây có chủ đích: vòng đời cuộc gọi thật đã có 2 spec riêng
 * (`use-chat-call*.spec.ts`). File này chỉ khoá 3 việc CallProvider tự nhận trong docblock của nó:
 * (1) nghe `chat:call` trên `/ws` DÙNG CHUNG, (2) đổ chuông theo `phase`, (3) phát context.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { WS_EVENTS } from "@mediaos/contracts";
import type { WsChatCallEvent } from "@mediaos/contracts";
import i18n from "@/i18n";
import { makeFakeSocket, type FakeSocket } from "./call-test-doubles";
import type { ChatCallController } from "./use-chat-call";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    getAppSocket: vi.fn(),
    useAuthStore: vi.fn(),
    chatApi: { ...actual.chatApi, listMembers: vi.fn().mockResolvedValue([]) },
  };
});

vi.mock("./use-chat-call", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-chat-call")>();
  return { ...actual, useChatCall: vi.fn() };
});

vi.mock("./call-ringtone", () => ({ startRingtone: vi.fn() }));

import { getAppSocket, useAuthStore } from "@mediaos/web-core";
import { startRingtone } from "./call-ringtone";
import { useChatCall } from "./use-chat-call";
import { CallProvider, useOptionalCallContext } from "./CallProvider";

const MY_ID = "44444444-4444-4444-8444-444444444444";
const PEER_ID = "33333333-3333-4333-8333-333333333333";
const CALL_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";

const getAppSocketMock = getAppSocket as unknown as ReturnType<typeof vi.fn>;
const useAuthStoreMock = useAuthStore as unknown as ReturnType<typeof vi.fn>;
const useChatCallMock = useChatCall as unknown as ReturnType<typeof vi.fn>;
const startRingtoneMock = startRingtone as unknown as ReturnType<typeof vi.fn>;

function makeController(overrides: Partial<ChatCallController> = {}): ChatCallController {
  return {
    phase: "idle",
    session: null,
    peerUserId: null,
    localStream: null,
    remoteStream: null,
    micOn: true,
    camOn: true,
    isSharingScreen: false,
    remoteMicOn: true,
    remoteCamOn: true,
    remoteSharing: false,
    notice: null,
    startCall: vi.fn(async () => undefined),
    acceptCall: vi.fn(async () => undefined),
    rejectCall: vi.fn(),
    hangup: vi.fn(),
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(async () => undefined),
    applyLifecycleEvent: vi.fn(),
    ...overrides,
  };
}

let fakeSocket: FakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  // CallProvider luôn mount <CallExperience>; khung <video> từ xa được render (chỉ ẩn bằng class) ngay
  // khi phase khác "idle", nên effect gọi `el.play()`. jsdom trả `undefined` thay vì Promise (khác MỌI
  // trình duyệt thật) — stub để khớp hành vi thật, không phải sửa bug sản phẩm.
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  fakeSocket = makeFakeSocket();
  getAppSocketMock.mockReturnValue(fakeSocket.socket);
  useAuthStoreMock.mockImplementation((selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: MY_ID } }),
  );
  useChatCallMock.mockReturnValue(makeController());
  startRingtoneMock.mockReturnValue({ stop: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function renderProvider(client = new QueryClient()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <CallProvider>
          <div data-testid="child">con</div>
        </CallProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

function ringingPayload(overrides: Partial<WsChatCallEvent> = {}): WsChatCallEvent {
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

describe("useOptionalCallContext ngoài Provider", () => {
  it("trả null — caller (nút gọi) tự ẩn thay vì crash trang trắng", () => {
    function Probe(): React.ReactElement {
      const ctx = useOptionalCallContext();
      return <div data-testid="probe">{ctx === null ? "null" : "có"}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("null");
  });
});

describe("nghe chat:call trên /ws — mount/unmount KHÔNG rò listener", () => {
  it("mount ⇒ đăng ký ĐÚNG 1 listener; unmount ⇒ gỡ SẠCH", () => {
    const { unmount } = renderProvider();
    expect(fakeSocket.listenerCount(WS_EVENTS.CHAT_CALL)).toBe(1);
    unmount();
    expect(fakeSocket.listenerCount(WS_EVENTS.CHAT_CALL)).toBe(0);
  });

  it("chưa đăng nhập (myUserId null) ⇒ KHÔNG đăng ký gì", () => {
    useAuthStoreMock.mockImplementation((selector: (s: { user: null }) => unknown) =>
      selector({ user: null }),
    );
    renderProvider();
    expect(fakeSocket.listenerCount(WS_EVENTS.CHAT_CALL)).toBe(0);
  });

  it("payload hợp lệ ⇒ nạp vào applyLifecycleEvent kèm đúng myUserId", () => {
    const controller = makeController();
    useChatCallMock.mockReturnValue(controller);
    renderProvider();
    act(() => {
      fakeSocket.fire(WS_EVENTS.CHAT_CALL, ringingPayload());
    });
    expect(controller.applyLifecycleEvent).toHaveBeenCalledWith(ringingPayload(), MY_ID);
  });

  it("payload SAI hợp đồng ⇒ bỏ qua có log, KHÔNG gọi applyLifecycleEvent (đổi shape không giết cả app)", () => {
    const controller = makeController();
    useChatCallMock.mockReturnValue(controller);
    renderProvider();
    act(() => {
      fakeSocket.fire(WS_EVENTS.CHAT_CALL, { callId: "not-a-uuid" });
    });
    expect(controller.applyLifecycleEvent).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("chuông theo phase", () => {
  it("incoming-ringing ⇒ startRingtone('incoming')", () => {
    useChatCallMock.mockReturnValue(makeController({ phase: "incoming-ringing" }));
    renderProvider();
    expect(startRingtoneMock).toHaveBeenCalledWith("incoming");
  });

  it("outgoing-ringing ⇒ startRingtone('outgoing')", () => {
    useChatCallMock.mockReturnValue(makeController({ phase: "outgoing-ringing" }));
    renderProvider();
    expect(startRingtoneMock).toHaveBeenCalledWith("outgoing");
  });

  it("phase không đổ chuông (idle/in-call) ⇒ KHÔNG gọi startRingtone", () => {
    useChatCallMock.mockReturnValue(makeController({ phase: "in-call" }));
    renderProvider();
    expect(startRingtoneMock).not.toHaveBeenCalled();
  });

  it("rời khỏi phase đổ chuông ⇒ handle.stop() được gọi (dọn effect cũ)", () => {
    const handle = { stop: vi.fn() };
    startRingtoneMock.mockReturnValue(handle);
    const client = new QueryClient();
    useChatCallMock.mockReturnValue(makeController({ phase: "incoming-ringing" }));
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <CallProvider>
            <div />
          </CallProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(handle.stop).not.toHaveBeenCalled();

    useChatCallMock.mockReturnValue(makeController({ phase: "in-call" }));
    rerender(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <CallProvider>
            <div />
          </CallProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });
});

describe("context phát cho CallButtons", () => {
  it("activeRoomId theo session hiện tại; startCall context gọi ĐÚNG startCall của hook", () => {
    const controller = makeController({
      session: { callId: CALL_ID, roomId: ROOM_ID, kind: "audio", initiatorUserId: MY_ID },
    });
    useChatCallMock.mockReturnValue(controller);

    function Probe(): React.ReactElement {
      const ctx = useOptionalCallContext();
      return (
        <button data-testid="probe-start" onClick={() => ctx?.startCall(ROOM_ID, "video")}>
          {ctx?.activeRoomId ?? "none"}
        </button>
      );
    }

    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <CallProvider>
            <Probe />
          </CallProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(screen.getByTestId("probe-start").textContent).toBe(ROOM_ID);
    screen.getByTestId("probe-start").click();
    expect(controller.startCall).toHaveBeenCalledWith(ROOM_ID, "video");
  });
});
