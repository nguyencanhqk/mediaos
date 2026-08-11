/**
 * S7-CALL-FE-1 — nút gọi thoại/gọi hình ở đầu phòng chat.
 *
 * ══ HAI CỔNG, KHÔNG PHẢI MỘT ══
 *  1. **Quyền** `call:chat-room` — thiếu thì KHÔNG render (không phải render rồi `disabled`: một nút xám
 *     nói với người dùng "tính năng này có, bạn làm sai gì đó", trong khi sự thật là họ không có quyền).
 *  2. **Topology 1-1** — `roomType === "direct"` VÀ đúng 2 thành viên chưa rời.
 *
 * Vì sao cần cả hai vế ở cổng 2 (plan §0.1): `roomType` là ý định lúc TẠO phòng, số thành viên là sự
 * thật HÔM NAY. Một phòng `direct` bị thêm người vẫn phải tắt nút — BE seed hàng participant cho MỌI
 * thành viên active khi có lời mời, nên bấm gọi ở phòng 3 người là rung chuông 3 máy trong khi máy
 * trạng thái ở FE chỉ dựng nổi MỘT `RTCPeerConnection`.
 *
 * ⚠️ Đây là hàng rào **UX**, KHÔNG phải cổng an ninh: người tự gọi REST vẫn mời được cả phòng. Cổng
 * thật là `@RequirePermission("call","chat-room")` + `assertMember` ở BE.
 */
import { useTranslation } from "react-i18next";
import { Phone, Video } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import type { ChatCallKind, ChatRoomDto } from "@mediaos/contracts";
import { CHAT_PAIRS } from "@/routes/chat/constants";

interface CallButtonsProps {
  room: ChatRoomDto;
  /** Roster phòng — nguồn "ai còn trong phòng", gồm cả người đã rời (`leftAt`). */
  members: readonly { userId: string; leftAt?: string | null }[];
  /** Có cuộc gọi nào đang chạy không — bấm gọi lúc đang gọi sẽ 409 ở BE. */
  isBusy: boolean;
  onStartCall: (kind: ChatCallKind) => void;
}

export function CallButtons({
  room,
  members,
  isBusy,
  onStartCall,
}: CallButtonsProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const canCall = useCan(CHAT_PAIRS.CALL.action, CHAT_PAIRS.CALL.resourceType);

  const activeMemberCount = members.filter((m) => !m.leftAt).length;
  const isOneToOne = room.roomType === "direct" && activeMemberCount === 2;

  if (!canCall || !isOneToOne) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("call.startAudio")}
        title={t("call.startAudio")}
        disabled={isBusy}
        onClick={() => onStartCall("audio")}
        data-testid="chat-call-audio"
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("call.startVideo")}
        title={t("call.startVideo")}
        disabled={isBusy}
        onClick={() => onStartCall("video")}
        data-testid="chat-call-video"
      >
        <Video className="h-4 w-4" aria-hidden="true" />
      </Button>
    </>
  );
}
