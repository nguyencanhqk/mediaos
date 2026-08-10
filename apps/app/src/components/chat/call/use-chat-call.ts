/**
 * S7-CALL-FE-1 — máy trạng thái cuộc gọi **1-1** (CHAT-SCREEN-006).
 *
 * Port CÓ SỬA từ `apps/lms/components/chat/useDirectMessageCall.ts` (885 dòng, mesh nhiều bên). Hai
 * khác biệt lớn, cả hai là quyết định của wave này chứ không phải rút gọn cho tiện:
 *
 *  1. **Vòng đời đi REST** (hàng rào R4). Bản LMS emit `inviteCall`/`acceptCall`/`hangupCall` qua
 *     socket; ở đây mọi mốc đi `chatCallApi`, còn socket `/ws-call` CHỈ chở SDP/ICE/media-state.
 *  2. **ĐÚNG MỘT `RTCPeerConnection`.** Owner chốt 1-1 (plan §0.1) ⇒ `Map<userId, pc>` của bản mesh
 *     thu về một biến. Kèm theo đó, luật "ai offer" ngắn lại còn một dòng — xem `onPeerJoined`.
 *
 * ⚠️ Hook này KHÔNG gate quyền. Cổng `call:chat-room` nằm ở `CallButtons` (ẩn nút) và ở BE
 * (`@RequirePermission`). Đặt cổng ở đây nữa sẽ chặn cả chiều NHẬN máy — người được gọi cần nhận cuộc
 * gọi kể cả khi vai trò của họ không được phép KHỞI TẠO.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chatCallApi, closeCallSocket, getCallSocket } from "@mediaos/web-core";
import type { ChatCallKind, WsChatCallEvent } from "@mediaos/contracts";
import { attachCallSignalListeners, callSignal } from "./call-signalling";

export type CallPhase = "idle" | "outgoing-ringing" | "incoming-ringing" | "connecting" | "in-call";

export interface CallSession {
  callId: string;
  roomId: string;
  kind: ChatCallKind;
  /** Người khởi tạo — với chiều NHẬN đây chính là người đang gọi mình. */
  initiatorUserId: string;
}

export interface ChatCallController {
  phase: CallPhase;
  session: CallSession | null;
  /** `null` cho tới khi bên kia `call:join` — contract cuộc gọi KHÔNG có `calleeUserId` (xem §2 plan). */
  peerUserId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  isSharingScreen: boolean;
  remoteMicOn: boolean;
  remoteCamOn: boolean;
  remoteSharing: boolean;
  /** Thông báo mềm (không có mic, bị từ chối quyền…) — cuộc gọi VẪN chạy ở chế độ hẹp hơn. */
  notice: string | null;
  startCall: (roomId: string, kind: ChatCallKind) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  /** Nạp một sự kiện `chat:call` từ `/ws` vào máy trạng thái. */
  applyLifecycleEvent: (event: WsChatCallEvent, myUserId: string) => void;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** ICE dự phòng khi `/chat/calls/ice-config` lỗi hoặc bị bóp tần suất (429). Cùng STUN bản LMS dùng. */
const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Chờ trước khi gác vì `failed`. Trạng thái `failed` NHÁY được khi mạng chập; gác ngay biến một giây
 * mất sóng thành một cuộc gọi rớt. Giữ nguyên 10 s của bản LMS — con số đó đã chạy thật trên người dùng.
 */
const ICE_FAILURE_GRACE_MS = 10_000;

export function useChatCall(): ChatCallController {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [session, setSession] = useState<CallSession | null>(null);
  const [peerUserId, setPeerUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [remoteMicOn, setRemoteMicOn] = useState(true);
  const [remoteCamOn, setRemoteCamOn] = useState(true);
  const [remoteSharing, setRemoteSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const peerUserIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[] | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const detachSignalsRef = useRef<(() => void) | null>(null);
  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Hai "cửa sau" để code chạy MUỘN (hẹn giờ ICE, `track.onended` của trình duyệt) gọi được bản mới
   * nhất của hai hàm định nghĩa bên dưới. Gán trong `useEffect`, KHÔNG gán thẳng trong thân render:
   * ghi vào ref lúc render phá tính thuần và React 19 concurrent có quyền bỏ đi rồi render lại.
   */
  const hangupRef = useRef<() => void>(() => undefined);
  const toggleScreenShareRef = useRef<() => Promise<void>>(async () => undefined);

  const setSessionBoth = useCallback((next: CallSession | null): void => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const setPeerBoth = useCallback((next: string | null): void => {
    peerUserIdRef.current = next;
    setPeerUserId(next);
  }, []);

  // ── dọn dẹp ────────────────────────────────────────────────────────────────

  /**
   * Đường dọn DUY NHẤT. Mọi lối kết thúc (gác · sự kiện vòng đời · unmount · lỗi) đi qua đây.
   *
   * ⚠️ `track.stop()` là bắt buộc, không phải `enabled = false`: chỉ tắt track thì **đèn camera vẫn
   * sáng** sau khi UI đã đóng. Đó là lỗi người dùng nhìn thấy trong khi không test nào thấy, và là
   * `done_when #3` của WO ("KHÔNG treo camera đang bật").
   */
  const fullCleanup = useCallback((): void => {
    if (failureTimerRef.current !== null) {
      clearTimeout(failureTimerRef.current);
      failureTimerRef.current = null;
    }

    detachSignalsRef.current?.();
    detachSignalsRef.current = null;

    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // đã đóng rồi — không có gì để cứu
      }
      pcRef.current = null;
    }

    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
    screenTrackRef.current?.stop();
    cameraTrackRef.current?.stop();
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    screenTrackRef.current = null;
    pendingIceRef.current = [];

    closeCallSocket();

    setLocalStream(null);
    setRemoteStream(null);
    setPeerBoth(null);
    setSessionBoth(null);
    setPhase("idle");
    setMicOn(true);
    setCamOn(true);
    setIsSharingScreen(false);
    setRemoteMicOn(true);
    setRemoteCamOn(true);
    setRemoteSharing(false);
  }, [setPeerBoth, setSessionBoth]);

  // Unmount = đóng máy/đăng xuất giữa cuộc gọi. Không dọn thì camera sáng tới khi đóng tab.
  useEffect(() => () => fullCleanup(), [fullCleanup]);

  // ── media cục bộ ───────────────────────────────────────────────────────────

  /**
   * Lấy mic/cam. **Không ném**: hỏng thì trả `null` và cuộc gọi tiếp tục ở chế độ **chỉ nghe** —
   * người không có webcam vẫn phải nghe được cuộc gọi video của người khác.
   */
  const acquireLocalMedia = useCallback(async (kind: ChatCallKind): Promise<MediaStream | null> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // Ngữ cảnh không bảo mật (http:// không phải localhost) rơi vào đây — thông điệp phải nói ra
      // điều đó, "không truy cập được camera" sẽ khiến người ta đi bấm lại quyền trình duyệt vô ích.
      setNotice("Trình duyệt không cho dùng mic/camera ở kết nối này. Chế độ chỉ nghe.");
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: kind === "video" ? VIDEO_CONSTRAINTS : false,
      });
      localStreamRef.current = stream;
      cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
      setLocalStream(stream);
      return stream;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      // Gọi video mà máy không có camera: hạ xuống audio thay vì bỏ cuộc — vẫn nói chuyện được.
      if (kind === "video" && name === "NotFoundError") {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: AUDIO_CONSTRAINTS,
            video: false,
          });
          localStreamRef.current = audioOnly;
          setLocalStream(audioOnly);
          setNotice("Không tìm thấy camera — gọi bằng âm thanh.");
          setCamOn(false);
          return audioOnly;
        } catch {
          // rơi tiếp xuống nhánh chỉ-nghe bên dưới
        }
      }
      setNotice(
        name === "NotAllowedError"
          ? "Bạn đã từ chối quyền mic/camera. Chế độ chỉ nghe."
          : name === "NotReadableError"
            ? "Mic/camera đang được ứng dụng khác dùng. Chế độ chỉ nghe."
            : "Không dùng được mic/camera. Chế độ chỉ nghe.",
      );
      return null;
    }
  }, []);

  // ── RTCPeerConnection ──────────────────────────────────────────────────────

  const fetchIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    if (iceServersRef.current) return iceServersRef.current;
    try {
      const config = await chatCallApi.getIceConfig();
      const servers = config.iceServers.length > 0 ? config.iceServers : FALLBACK_ICE;
      iceServersRef.current = servers;
      return servers;
    } catch {
      // 429 (bóp tần suất) hoặc TURN chưa cấu hình ⇒ STUN công cộng. Gọi trong cùng mạng LAN vẫn chạy;
      // ném ở đây sẽ biến "chất lượng kém hơn" thành "không gọi được".
      iceServersRef.current = FALLBACK_ICE;
      return FALLBACK_ICE;
    }
  }, []);

  const ensurePeerConnection = useCallback(async (): Promise<RTCPeerConnection> => {
    const existing = pcRef.current;
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: await fetchIceServers() });

    pc.onicecandidate = (event) => {
      const socket = getCallSocket();
      const current = sessionRef.current;
      const to = peerUserIdRef.current;
      if (!event.candidate || !socket || !current || !to) return;
      callSignal.iceCandidate(socket, current.callId, to, event.candidate.toJSON());
    };

    pc.ontrack = (event) => {
      // MỘT `MediaStream` gom mọi track của bên kia. `event.streams[0]` KHÔNG dùng được: nó vắng mặt
      // khi bên kia thêm track bằng `addTransceiver` (nhánh chỉ-nghe ở trên làm đúng thế).
      setRemoteStream((prev) => {
        const stream = prev ?? new MediaStream();
        if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
        // Đối tượng MỚI mỗi lần: React so sánh tham chiếu, `<video>` sẽ không gắn lại srcObject nếu ta
        // trả về chính stream cũ sau khi thêm track audio vào một cuộc gọi đang chỉ có video.
        return prev === null ? stream : new MediaStream(stream.getTracks());
      });
    };

    /**
     * `connected`/`completed` của ICE là tín hiệu "media đang chảy" đáng tin hơn `connectionState`:
     * vài trình duyệt không phát `connectionState === 'connected'` ổn định.
     */
    const markConnectedIfReady = (): void => {
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        if (failureTimerRef.current !== null) {
          clearTimeout(failureTimerRef.current);
          failureTimerRef.current = null;
        }
        setPhase((prev) => (prev === "idle" ? prev : "in-call"));
      }
    };

    /** Leo thang 2 nấc: thử vá đường ICE ngay, chỉ gác khi 10 s sau vẫn hỏng (plan §5). */
    const handleDegraded = (): void => {
      try {
        pc.restartIce();
      } catch {
        // best-effort — trình duyệt cũ không có restartIce
      }
      if (failureTimerRef.current !== null) return;
      failureTimerRef.current = setTimeout(() => {
        failureTimerRef.current = null;
        const stillFailed = pc.connectionState === "failed" || pc.iceConnectionState === "failed";
        if (!stillFailed) return;
        setNotice("Mất kết nối với người kia — cuộc gọi đã dừng.");
        hangupRef.current();
      }, ICE_FAILURE_GRACE_MS);
    };

    pc.onconnectionstatechange = () => {
      markConnectedIfReady();
      if (pc.connectionState === "failed") handleDegraded();
    };
    pc.oniceconnectionstatechange = () => {
      markConnectedIfReady();
      if (pc.iceConnectionState === "failed") handleDegraded();
    };

    const local = localStreamRef.current;
    if (local) {
      for (const track of local.getTracks()) pc.addTrack(track, local);
    } else {
      // Chế độ chỉ-nghe: vẫn phải khai transceiver, không thì SDP không có m-line nào và bên kia
      // không gửi được gì tới ta — cuộc gọi "thành công" mà im lặng hoàn toàn.
      pc.addTransceiver("audio", { direction: "recvonly" });
      if (sessionRef.current?.kind === "video") {
        pc.addTransceiver("video", { direction: "recvonly" });
      }
    }

    pcRef.current = pc;
    return pc;
  }, [fetchIceServers]);

  /** Nạp các candidate tới TRƯỚC `setRemoteDescription` — trước đó `addIceCandidate` sẽ ném. */
  const drainPendingIce = useCallback(async (pc: RTCPeerConnection): Promise<void> => {
    const pending = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Một candidate hỏng không giết cuộc gọi — còn những đường khác để thử.
      }
    }
  }, []);

  // ── nối `/ws-call` ─────────────────────────────────────────────────────────

  /**
   * Mở `/ws-call`, gắn listener, rồi `call:join`.
   *
   * ⚠️ THỨ TỰ: chỉ gọi hàm này SAU khi đã có media cục bộ (hoặc đã chốt chỉ-nghe). Join sớm là mở cửa
   * cho `call:peer-joined` tới lúc `localStreamRef` còn `null` ⇒ PC dựng ra không có track nào, và
   * cuộc gọi câm một chiều **mà không có lỗi nào hiện ra**.
   */
  const openSignalling = useCallback(
    (callId: string): void => {
      const socket = getCallSocket();
      if (!socket) return;

      detachSignalsRef.current?.();
      detachSignalsRef.current = attachCallSignalListeners(socket, callId, {
        /**
         * Bên kia vừa vào phiên ⇒ **MÌNH** offer.
         *
         * Luật một dòng, đối xứng, không có glare: ai đã ở trong phòng thì thấy `peer-joined` của người
         * vào sau, nên đúng MỘT bên offer trong mọi thứ tự vào. Bản LMS phải phân nhánh
         * "caller-offer-sau-accept" vs "joiner-offer-theo-snapshot" vì nó có mesh; ở 1-1 luật này phủ cả hai.
         */
        onPeerJoined: (userId) => {
          setPeerBoth(userId);
          setPhase((prev) => (prev === "in-call" ? prev : "connecting"));
          void (async () => {
            try {
              const pc = await ensurePeerConnection();
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const s = getCallSocket();
              if (s && pc.localDescription) {
                callSignal.sdpOffer(s, callId, userId, pc.localDescription.toJSON());
              }
            } catch (error) {
              console.error("[call] tạo offer thất bại:", error);
            }
          })();
        },

        onPeerLeft: () => {
          // Bên kia rời phiên signalling. Sự kiện `chat:call{ended}` trên `/ws` mới là mốc chính thức —
          // đây là dây an toàn cho trường hợp tab bên kia bị đóng thẳng (REST hangup không kịp chạy).
          hangupRef.current();
        },

        onSdpOffer: (fromUserId, sdp) => {
          setPeerBoth(fromUserId);
          void (async () => {
            try {
              const pc = await ensurePeerConnection();
              await pc.setRemoteDescription(sdp);
              await drainPendingIce(pc);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              const s = getCallSocket();
              if (s && pc.localDescription) {
                callSignal.sdpAnswer(s, callId, fromUserId, pc.localDescription.toJSON());
              }
            } catch (error) {
              console.error("[call] trả lời offer thất bại:", error);
            }
          })();
        },

        onSdpAnswer: (_fromUserId, sdp) => {
          void (async () => {
            const pc = pcRef.current;
            // `have-local-offer` là trạng thái DUY NHẤT mà một answer hợp lệ: nạp answer ở trạng thái
            // khác ném `InvalidStateError` và làm hỏng PC đang chạy tốt.
            if (!pc || pc.signalingState !== "have-local-offer") return;
            try {
              await pc.setRemoteDescription(sdp);
              await drainPendingIce(pc);
            } catch (error) {
              console.error("[call] nạp answer thất bại:", error);
            }
          })();
        },

        onIceCandidate: (_fromUserId, candidate) => {
          const pc = pcRef.current;
          if (!pc || !pc.remoteDescription) {
            pendingIceRef.current.push(candidate);
            return;
          }
          void pc.addIceCandidate(candidate).catch(() => undefined);
        },

        onMediaState: (_userId, nextMic, nextCam) => {
          setRemoteMicOn(nextMic);
          setRemoteCamOn(nextCam);
        },

        onScreenState: (_userId, sharing) => setRemoteSharing(sharing),
      });

      callSignal.join(socket, callId);
    },
    [drainPendingIce, ensurePeerConnection, setPeerBoth],
  );

  // ── hành động ──────────────────────────────────────────────────────────────

  const startCall = useCallback(
    async (roomId: string, kind: ChatCallKind): Promise<void> => {
      if (sessionRef.current !== null) return;
      setNotice(null);

      const stream = await acquireLocalMedia(kind);
      setCamOn(kind === "video" && (stream?.getVideoTracks().length ?? 0) > 0);

      try {
        const call = await chatCallApi.createCall(roomId, kind);
        setSessionBoth({
          callId: call.id,
          roomId: call.roomId,
          kind: call.kind,
          initiatorUserId: call.initiatorUserId,
        });
        setPhase("outgoing-ringing");
        openSignalling(call.id);
      } catch (error) {
        // Media đã bật rồi mới biết không mời được ⇒ phải trả camera lại NGAY, đừng để đèn sáng chờ
        // người dùng tự đóng một overlay không bao giờ hiện.
        for (const track of stream?.getTracks() ?? []) track.stop();
        localStreamRef.current = null;
        setLocalStream(null);
        console.error("[call] không tạo được cuộc gọi:", error);
        setNotice("Không gọi được. Phòng có thể đang có cuộc gọi khác.");
      }
    },
    [acquireLocalMedia, openSignalling, setSessionBoth],
  );

  const acceptCall = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    if (!current || phase !== "incoming-ringing") return;

    const stream = await acquireLocalMedia(current.kind);
    setCamOn(current.kind === "video" && (stream?.getVideoTracks().length ?? 0) > 0);

    try {
      await chatCallApi.acceptCall(current.callId);
      setPhase("connecting");
      openSignalling(current.callId);
    } catch (error) {
      console.error("[call] không nhận được máy:", error);
      setNotice("Không nhận được cuộc gọi — có thể bên kia đã ngắt.");
      fullCleanup();
    }
  }, [acquireLocalMedia, fullCleanup, openSignalling, phase]);

  const rejectCall = useCallback((): void => {
    const current = sessionRef.current;
    if (!current) return;
    // Dọn LẠC QUAN, không chờ response: người bấm "Từ chối" muốn chuông tắt ngay lập tức. Bản ghi ở
    // server vẫn đúng nhờ chính lời gọi này; lỗi mạng chỉ khiến BE tự đánh `missed` sau đó.
    void chatCallApi.rejectCall(current.callId).catch(() => undefined);
    fullCleanup();
  }, [fullCleanup]);

  const hangup = useCallback((): void => {
    const current = sessionRef.current;
    if (!current) {
      fullCleanup();
      return;
    }
    const socket = getCallSocket();
    if (socket) callSignal.leave(socket, current.callId);

    // Chưa ai nhận ⇒ `cancel`; đã vào cuộc ⇒ `hangup`. Hai route KHÁC NHAU ở BE (FSM một chiều): gọi
    // `hangup` khi còn `ringing` trả 422 CHAT-ERR-029 và cuộc gọi kẹt đổ chuông tới khi job đánh nhỡ.
    const request =
      phase === "outgoing-ringing"
        ? chatCallApi.cancelCall(current.callId)
        : chatCallApi.hangupCall(current.callId);
    void request.catch(() => undefined);

    fullCleanup();
  }, [fullCleanup, phase]);

  useEffect(() => {
    hangupRef.current = hangup;
  }, [hangup]);

  // ── công tắc media ─────────────────────────────────────────────────────────

  const broadcastMediaState = useCallback((nextMic: boolean, nextCam: boolean): void => {
    const socket = getCallSocket();
    const current = sessionRef.current;
    if (socket && current) callSignal.mediaState(socket, current.callId, nextMic, nextCam);
  }, []);

  const toggleMic = useCallback((): void => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMicOn(next);
    broadcastMediaState(next, camOn);
  }, [broadcastMediaState, camOn, micOn]);

  const toggleCamera = useCallback((): void => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCamOn(next);
    broadcastMediaState(micOn, next);
  }, [broadcastMediaState, camOn, micOn]);

  /**
   * Bật/tắt chia sẻ màn hình bằng `replaceTrack`.
   *
   * ⚠️ `replaceTrack` KHÔNG đổi SDP ⇒ **không cần** vòng offer/answer thứ hai. Đi đường
   * `removeTrack`+`addTrack` sẽ cần renegotiate, mà kênh renegotiate ở đây phải đi qua `/ws-call` —
   * thêm một luồng đàm phán nữa chỉ để làm việc mà một lời gọi hàm làm xong.
   */
  const toggleScreenShare = useCallback(async (): Promise<void> => {
    const pc = pcRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) {
      setNotice("Cuộc gọi thoại không chia sẻ được màn hình.");
      return;
    }
    const socket = getCallSocket();
    const current = sessionRef.current;

    if (isSharingScreen) {
      const camera = cameraTrackRef.current;
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      await sender.replaceTrack(camera ?? null);
      setIsSharingScreen(false);
      if (socket && current) callSignal.screenState(socket, current.callId, false);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      // Người dùng bấm "Stop sharing" của CHÍNH trình duyệt — nút của ta không hề được bấm. Không nghe
      // sự kiện này thì UI báo "đang chia sẻ" vĩnh viễn trong khi bên kia thấy khung hình đứng.
      track.onended = () => void toggleScreenShareRef.current();
      await sender.replaceTrack(track);
      setIsSharingScreen(true);
      if (socket && current) callSignal.screenState(socket, current.callId, true);
    } catch {
      // Người dùng bấm Huỷ ở hộp chọn màn hình — đó là ý định, không phải lỗi.
    }
  }, [isSharingScreen]);

  useEffect(() => {
    toggleScreenShareRef.current = toggleScreenShare;
  }, [toggleScreenShare]);

  // ── sự kiện vòng đời từ `/ws` ──────────────────────────────────────────────

  /**
   * Nạp `chat:call` vào máy trạng thái. `myUserId` truyền vào (không đọc store trong đây) để hook giữ
   * được tính thuần và test được mà không dựng cả `useAuthStore`.
   */
  const applyLifecycleEvent = useCallback(
    (event: WsChatCallEvent, myUserId: string): void => {
      const current = sessionRef.current;

      if (event.action === "ringing") {
        // Chính mình mời ⇒ bỏ qua: `startCall` đã dựng phiên rồi. Không chặn thì người gọi tự rung
        // chuông cho chính mình (BE seed participant cho MỌI thành viên active, kể cả người khởi tạo).
        if (event.initiatorUserId === myUserId) return;
        // Đang bận một cuộc khác ⇒ bỏ qua. Máy trạng thái này giữ ĐÚNG MỘT cuộc gọi (1-1); nhận cuộc
        // thứ hai sẽ ghi đè phiên đang chạy và bỏ rơi `RTCPeerConnection` cũ còn đang mở camera.
        if (current !== null) return;
          setNotice(null);
        setSessionBoth({
          callId: event.callId,
          roomId: event.roomId,
          kind: event.kind,
          initiatorUserId: event.initiatorUserId,
        });
        setPeerBoth(event.initiatorUserId);
        setPhase("incoming-ringing");
        return;
      }

      if (!current || current.callId !== event.callId) return;

      if (event.action === "accepted") {
        // Người gọi biết máy đã được nhận. Chưa phải `in-call` — media chưa chảy; `peer-joined` +
        // ICE `connected` mới là mốc đó.
        setPhase((prev) => (prev === "in-call" ? prev : "connecting"));
        return;
      }

      // rejected · cancelled · ended · missed — mọi lối kết thúc đi chung MỘT đường dọn.
      //
      // ⚠️ GIỚI HẠN ĐÃ BIẾT: khung cuộc gọi đóng ngay, nên người gọi KHÔNG thấy lời giải thích khi bị
      // từ chối/đánh nhỡ — chỉ thấy khung biến mất. Vá đúng cách là một pha `ended` giữ khung thêm vài
      // giây, thuộc WO sau; giữ một biến `endReason` không ai đọc ở đây chỉ tạo ảo giác đã xử lý.
      fullCleanup();
    },
    [fullCleanup, setPeerBoth, setSessionBoth],
  );

  return {
    phase,
    session,
    peerUserId,
    localStream,
    remoteStream,
    micOn,
    camOn,
    isSharingScreen,
    remoteMicOn,
    remoteCamOn,
    remoteSharing,
    notice,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    applyLifecycleEvent,
  };
}
