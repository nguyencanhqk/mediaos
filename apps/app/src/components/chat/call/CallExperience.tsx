/**
 * S7-CALL-FE-1 — mặt tiền của cuộc gọi: overlay chuông đến + khung đang gọi (thu nhỏ ⇄ toàn màn).
 *
 * Port UI từ `apps/lms/components/chat/CallExperience.tsx`, cắt phần lưới nhiều bên (mesh) vì wave này
 * chốt 1-1 (plan §0.1): một khung hình lớn cho người kia + một khung nhỏ tự xem mình.
 *
 * Component THUẦN HIỂN THỊ — không giữ state cuộc gọi, không gọi API. Mọi hành động đi ngược lên
 * `CallProvider` qua props để chỉ có MỘT chỗ biết máy trạng thái.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { Button } from "@mediaos/ui";
import type { CallPhase } from "./use-chat-call";

interface CallExperienceProps {
  phase: CallPhase;
  kind: "audio" | "video";
  peerName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  isSharingScreen: boolean;
  remoteMicOn: boolean;
  remoteCamOn: boolean;
  remoteSharing: boolean;
  notice: string | null;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}

/**
 * Gắn `MediaStream` vào `<video>`.
 *
 * `srcObject` KHÔNG đặt được qua JSX (React chỉ biết `src`) ⇒ bắt buộc đi qua ref. Đặt lại mỗi khi
 * stream đổi tham chiếu — `ontrack` trả về `MediaStream` MỚI khi thêm track, đúng để nhánh này chạy lại.
 */
function useMediaStream(stream: MediaStream | null): React.RefObject<HTMLVideoElement | null> {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    // `play()` bị trình duyệt từ chối khi chưa có cử chỉ người dùng — nuốt, vì `autoPlay` trên thẻ đã
    // xử lý phần lớn ca và một promise bị reject không bắt sẽ nổi lên console như lỗi thật.
    void el.play().catch(() => undefined);
  }, [stream]);
  return ref;
}

export function CallExperience(props: CallExperienceProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const [isMinimised, setIsMinimised] = useState(false);
  const localVideoRef = useMediaStream(props.localStream);
  const remoteVideoRef = useMediaStream(props.remoteStream);

  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const isIncoming = props.phase === "incoming-ringing";

  // Chuông đến: đưa focus vào nút Nhận. Người dùng bàn phím không phải Tab qua cả trang để bắt máy —
  // và cuộc gọi có hạn 45 giây, không đủ thời gian cho một hành trình focus dài.
  useEffect(() => {
    if (isIncoming) acceptRef.current?.focus();
  }, [isIncoming]);

  if (props.phase === "idle") return null;

  // ── chuông đến ─────────────────────────────────────────────────────────────
  if (isIncoming) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={t("call.incomingTitle", { name: props.peerName })}
        data-testid="chat-call-incoming"
      >
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-xl">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {props.kind === "video" ? t("call.incomingVideo") : t("call.incomingAudio")}
          </p>
          <h2 className="mt-2 truncate text-lg font-semibold text-foreground">{props.peerName}</h2>
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {t("call.ringing")}
          </p>

          <div className="mt-6 flex items-center justify-center gap-4">
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full"
              onClick={props.onReject}
              data-testid="chat-call-reject"
            >
              <PhoneOff className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("call.reject")}
            </Button>
            <Button
              ref={acceptRef}
              size="lg"
              className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={props.onAccept}
              data-testid="chat-call-accept"
            >
              <Phone className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("call.accept")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── đang gọi / đang kết nối ────────────────────────────────────────────────
  const statusText =
    props.phase === "outgoing-ringing"
      ? t("call.calling")
      : props.phase === "connecting"
        ? t("call.connecting")
        : props.remoteSharing
          ? t("call.peerSharingScreen")
          : t("call.inCall");

  const showRemoteVideo = props.kind === "video" && props.remoteStream !== null;

  return (
    <div
      className={
        isMinimised
          ? "fixed bottom-4 right-4 z-[60] w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          : "fixed inset-0 z-[60] flex flex-col bg-neutral-950"
      }
      role="dialog"
      aria-modal={!isMinimised}
      aria-label={t("call.frameLabel", { name: props.peerName })}
      data-testid="chat-call-frame"
    >
      <header
        className={
          isMinimised
            ? "flex items-center gap-2 border-b border-border px-3 py-2"
            : "flex items-center gap-2 px-4 py-3 text-white"
        }
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{props.peerName}</p>
          <p
            className={
              isMinimised
                ? "truncate text-xs text-muted-foreground"
                : "truncate text-xs text-white/70"
            }
            role="status"
          >
            {statusText}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className={isMinimised ? undefined : "text-white hover:bg-white/10 hover:text-white"}
          aria-label={isMinimised ? t("call.expand") : t("call.minimize")}
          onClick={() => setIsMinimised((prev) => !prev)}
          data-testid="chat-call-toggle-size"
        >
          {isMinimised ? (
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 bg-neutral-900">
        {/* `playsInline` bắt buộc cho iOS Safari: thiếu nó video tự bung ra trình phát toàn màn hình
            của hệ điều hành và che mất mọi nút điều khiển của ta. */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={showRemoteVideo ? "h-full w-full object-contain" : "hidden"}
          data-testid="chat-call-remote-video"
        />
        {!showRemoteVideo && (
          <div className="flex h-full min-h-[8rem] items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-2xl font-semibold text-white">
              {props.peerName.slice(0, 1).toUpperCase()}
            </div>
          </div>
        )}

        {/* Tự xem mình — TẮT TIẾNG tuyệt đối (`muted`): không tắt là dội âm chính giọng mình. */}
        {props.kind === "video" && props.localStream !== null && !isMinimised && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-4 h-28 w-40 rounded-lg border border-white/20 object-cover shadow-lg"
            data-testid="chat-call-local-video"
          />
        )}

        {!props.remoteMicOn && (
          <p className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {t("call.peerMuted")}
          </p>
        )}
      </div>

      {props.notice !== null && (
        <p
          className={
            isMinimised
              ? "border-t border-border px-3 py-2 text-xs text-muted-foreground"
              : "px-4 py-2 text-center text-xs text-white/80"
          }
          role="status"
        >
          {props.notice}
        </p>
      )}

      <footer
        className={
          isMinimised
            ? "flex items-center justify-center gap-1 border-t border-border px-2 py-2"
            : "flex items-center justify-center gap-3 px-4 py-5"
        }
      >
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
          aria-label={props.micOn ? t("call.muteMic") : t("call.unmuteMic")}
          aria-pressed={!props.micOn}
          onClick={props.onToggleMic}
          data-testid="chat-call-toggle-mic"
        >
          {props.micOn ? (
            <Mic className="h-4 w-4" aria-hidden="true" />
          ) : (
            <MicOff className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>

        {props.kind === "video" && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
            aria-label={props.camOn ? t("call.cameraOff") : t("call.cameraOn")}
            aria-pressed={!props.camOn}
            onClick={props.onToggleCamera}
            data-testid="chat-call-toggle-cam"
          >
            {props.camOn ? (
              <Video className="h-4 w-4" aria-hidden="true" />
            ) : (
              <VideoOff className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        )}

        {props.kind === "video" && props.phase === "in-call" && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
            aria-label={props.isSharingScreen ? t("call.stopSharing") : t("call.shareScreen")}
            aria-pressed={props.isSharingScreen}
            onClick={props.onToggleScreenShare}
            data-testid="chat-call-toggle-screen"
          >
            <MonitorUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        <Button
          variant="destructive"
          size="icon"
          className="rounded-full"
          aria-label={t("call.hangup")}
          onClick={props.onHangup}
          data-testid="chat-call-hangup"
        >
          <PhoneOff className="h-4 w-4" aria-hidden="true" />
        </Button>
      </footer>
    </div>
  );
}
