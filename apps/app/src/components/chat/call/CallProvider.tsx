/**
 * S7-CALL-FE-1 — chủ sở hữu DUY NHẤT của máy trạng thái cuộc gọi.
 *
 * Gắn ĐÚNG MỘT LẦN ở `ProtectedShell`, cạnh `useChatRealtime` và `ChatDock`. Đặt trong cây route thì
 * mỗi lần điều hướng là unmount ⇒ cuộc gọi đang chạy bị cắt giữa chừng (và camera treo, vì cleanup của
 * hook chạy đúng lúc người dùng chỉ định bấm sang trang khác).
 *
 * Ba việc, không hơn:
 *  1. Nghe `chat:call` trên `/ws` DÙNG CHUNG (`getAppSocket()`) — đây là đường chuông đến duy nhất.
 *  2. Đổ chuông (WebAudio) theo `phase`.
 *  3. Phát context cho `CallButtons` ở đầu phòng bấm gọi.
 *
 * ⚠️ KHÔNG tự `io()`: `/ws` là singleton dùng chung với CHAT + NOTI (ESLint ép). Và KHÔNG bao giờ
 * `socket.disconnect()` ở cleanup — `<StrictMode>` chạy effect hai lần, ngắt ở đó là giết realtime của
 * cả app ngay lần mount đầu.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getAppSocket, useAuthStore } from "@mediaos/web-core";
import { WS_EVENTS, wsChatCallEventSchema, type ChatCallKind } from "@mediaos/contracts";
import { useRoomRoster } from "../use-room-roster";
import { CallExperience } from "./CallExperience";
import { startRingtone } from "./call-ringtone";
import { useChatCall, type CallPhase } from "./use-chat-call";

interface CallContextValue {
  phase: CallPhase;
  /** `null` = không có cuộc gọi nào — nút gọi ở mọi phòng đều bấm được. */
  activeRoomId: string | null;
  startCall: (roomId: string, kind: ChatCallKind) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

/**
 * Trả `null` khi cây không có `<CallProvider>` — `ConversationPanel` được `ChatDock`, trang `/chat` và
 * cả test render riêng lẻ, nên NÉM ở đây sẽ biến "chưa bọc provider" thành trang trắng. Caller ẩn nút
 * gọi khi nhận `null`, đúng hành vi mong muốn.
 */
export function useOptionalCallContext(): CallContextValue | null {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { t } = useTranslation("chat");
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const call = useChatCall();

  const { applyLifecycleEvent } = call;

  // ── chuông đến trên `/ws` ──────────────────────────────────────────────────
  useEffect(() => {
    if (myUserId === null) return;
    const socket = getAppSocket();
    if (!socket) return;

    const onChatCall = (payload: unknown): void => {
      const parsed = wsChatCallEventSchema.safeParse(payload);
      if (!parsed.success) {
        // Cùng lý do như `useChatRealtime`: đổi shape ở `packages/contracts` làm cuộc gọi ngừng hoạt
        // động HOÀN TOÀN, và triệu chứng duy nhất là "bấm gọi không ai đổ chuông" — không lần ra được.
        console.error("[call] payload chat:call sai hợp đồng — bỏ qua:", parsed.error);
        return;
      }
      applyLifecycleEvent(parsed.data, myUserId);
    };

    socket.on(WS_EVENTS.CHAT_CALL, onChatCall);
    return () => {
      socket.off(WS_EVENTS.CHAT_CALL, onChatCall);
    };
  }, [applyLifecycleEvent, myUserId]);

  // ── chuông ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (call.phase !== "incoming-ringing" && call.phase !== "outgoing-ringing") return;
    const handle = startRingtone(call.phase === "incoming-ringing" ? "incoming" : "outgoing");
    return () => handle?.stop();
  }, [call.phase]);

  // ── tên hiển thị của người kia ─────────────────────────────────────────────
  /**
   * Roster của phòng đang gọi — cùng `queryKey` mà `ConversationPanel` đã dùng, nên phòng vừa mở thì
   * tên có NGAY từ cache, không đợi vòng mạng nào.
   *
   * `null` khi không có cuộc gọi ⇒ `useRoomRoster` tự tắt query (`enabled: roomId !== null`). Overlay
   * hiện trước, tên điền sau là chấp nhận được: người dùng bắt máy được ngay cả khi chưa thấy tên.
   */
  const roster = useRoomRoster(call.session?.roomId ?? null);
  const peerName =
    call.peerUserId === null ? null : (roster.nameByUser.get(call.peerUserId) ?? null);

  /**
   * ⚠️ Phụ thuộc `call.startCall`, KHÔNG phải `call`.
   *
   * `call` là object trả về của hook — tham chiếu MỚI mỗi lần render. Đưa nó vào deps thì `startCall`
   * đổi mỗi render ⇒ `value` bên dưới đổi mỗi render ⇒ `useMemo` không giữ được gì và MỌI người dùng
   * context (mỗi `ConversationPanel` đang mở, kể cả trong panel nổi) render lại theo từng nhịp của
   * cuộc gọi — kể cả những nhịp dày như ICE. `startCall` thì đã `useCallback` ổn định trong hook.
   */
  const { startCall: startCallImpl } = call;
  const startCall = useCallback(
    (roomId: string, kind: ChatCallKind) => {
      void startCallImpl(roomId, kind);
    },
    [startCallImpl],
  );

  const value = useMemo<CallContextValue>(
    () => ({
      phase: call.phase,
      activeRoomId: call.session?.roomId ?? null,
      startCall,
    }),
    [call.phase, call.session?.roomId, startCall],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallExperience
        phase={call.phase}
        kind={call.session?.kind ?? "audio"}
        peerName={peerName ?? t("call.unknownPeer")}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        micOn={call.micOn}
        camOn={call.camOn}
        isSharingScreen={call.isSharingScreen}
        remoteMicOn={call.remoteMicOn}
        remoteCamOn={call.remoteCamOn}
        remoteSharing={call.remoteSharing}
        notice={call.notice}
        onAccept={() => void call.acceptCall()}
        onReject={call.rejectCall}
        onHangup={call.hangup}
        onToggleMic={call.toggleMic}
        onToggleCamera={call.toggleCamera}
        onToggleScreenShare={() => void call.toggleScreenShare()}
      />
    </CallContext.Provider>
  );
}
