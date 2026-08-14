/**
 * S7-CALL-QA-2 — test doubles dùng chung cho use-chat-call/CallExperience/CallProvider/call-ringtone.
 *
 * jsdom KHÔNG cài WebRTC/WebAudio (`RTCPeerConnection`, `MediaStream`, `AudioContext` đều vắng mặt),
 * nên các hàm trong module `call/` không có gì để chạy trên nếu không stub. Tệp này KHÔNG phải spec
 * (tên không tận cùng bằng `.spec.ts`) — vitest không tự chạy nó.
 */
import { vi } from "vitest";

export class FakeMediaStreamTrack {
  kind: "audio" | "video";
  enabled = true;
  readonly stop = vi.fn();
  onended: (() => void) | null = null;

  constructor(kind: "audio" | "video" = "audio") {
    this.kind = kind;
  }
}

export class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }

  addTrack(track: FakeMediaStreamTrack): void {
    this.tracks.push(track);
  }
}

/** Cài `MediaStream` giả vào `globalThis` — production code gọi `new MediaStream()` trực tiếp. */
export function stubMediaStreamGlobal(): void {
  vi.stubGlobal("MediaStream", FakeMediaStream);
}

export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: FakeMediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  readonly addTrack = vi.fn();
  readonly addTransceiver = vi.fn();
  readonly getSenders = vi.fn(
    () => [] as { track: FakeMediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }[],
  );
  readonly addIceCandidate = vi.fn(async () => undefined);
  readonly restartIce = vi.fn();
  readonly close = vi.fn();

  readonly createOffer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: "offer",
      sdp: "fake-offer-sdp",
    }),
  );
  readonly createAnswer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: "answer",
      sdp: "fake-answer-sdp",
    }),
  );
  /**
   * `RTCSessionDescription` thật có `.toJSON()` — production code gọi `pc.localDescription.toJSON()`
   * trước khi emit offer/answer. Object literal thường không có hàm đó, nên PHẢI gắn thủ công ở đây,
   * không thì lỗi bị `catch` nuốt và bài test "offer được gửi" xanh giả (không emit gì cả).
   */
  readonly setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit): Promise<void> => {
    this.localDescription = {
      ...desc,
      toJSON: () => ({ type: desc.type, sdp: desc.sdp }),
    } as RTCSessionDescriptionInit;
    this.signalingState = desc.type === "offer" ? "have-local-offer" : "stable";
  });
  readonly setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit): Promise<void> => {
    this.remoteDescription = desc;
    if (desc.type === "offer") this.signalingState = "have-remote-offer";
    if (desc.type === "answer") this.signalingState = "stable";
  });

  constructor(_config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }
}

/** Cài `RTCPeerConnection` giả + reset sổ instance. Gọi lại ở mỗi `beforeEach`. */
export function stubPeerConnectionGlobal(): void {
  FakePeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
}

export interface FakeSocket {
  socket: {
    emit: ReturnType<typeof vi.fn>;
    on: (event: string, fn: (payload: unknown) => void) => void;
    off: (event: string, fn: (payload: unknown) => void) => void;
  };
  emit: ReturnType<typeof vi.fn>;
  fire: (event: string, payload: unknown) => void;
  listenerCount: (event: string) => number;
}

/**
 * Socket giả tối thiểu (giữ bảng `event → handler[]`) — dùng cho MỌI namespace (`/ws-call` lẫn `/ws`),
 * đủ để `attachCallSignalListeners`/`socket.on(WS_EVENTS.CHAT_CALL, …)` đăng ký thật và bài test tự
 * bắn khung vào bằng `fire()`. Cùng khuôn với `makeSocket()` ở `call-signalling.spec.ts`.
 */
export function makeFakeSocket(): FakeSocket {
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
  return { socket, emit, fire, listenerCount };
}

/** Gắn `navigator.mediaDevices.getUserMedia` giả, trả về stream có đúng track theo `kind`. */
export function stubGetUserMedia(
  impl?: (constraints: MediaStreamConstraints) => Promise<FakeMediaStream>,
): ReturnType<typeof vi.fn> {
  const getUserMedia = vi.fn(
    impl ??
      (async (constraints: MediaStreamConstraints) => {
        const tracks = [new FakeMediaStreamTrack("audio")];
        if (constraints.video) tracks.push(new FakeMediaStreamTrack("video"));
        return new FakeMediaStream(tracks);
      }),
  );
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}
