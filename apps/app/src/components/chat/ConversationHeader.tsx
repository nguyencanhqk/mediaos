/**
 * S17-CHAT-UX2-FE-2 — thanh đầu hội thoại v2 (SPEC-15 §9 CHAT-SCREEN-001 · §14).
 *
 * S7 để thanh này inline trong `ConversationPanel`. Tách ra vì v2 thêm avatar + lối tìm-trong-phòng và
 * panel đã dài 400+ dòng; nhưng quan trọng hơn: thanh đầu là thứ **FE-5 (drawer)** sẽ dùng lại với đúng
 * nội dung, kích thước khác — một component thuần, không đọc store, là thứ dùng lại được.
 *
 * Component này **KHÔNG đọc store và KHÔNG gọi API**: mọi thứ nó vẽ đến từ props. `callSlot` là
 * `ReactNode` thay vì `CallButtons` gọi thẳng — nút gọi cần `CallProvider` ở tổ tiên, và bắt thanh đầu
 * phụ thuộc vào một context tuỳ chọn biến nó thành thứ không render nổi trong test lẻ.
 */
import { useTranslation } from "react-i18next";
import { Info, Search } from "lucide-react";
import { Avatar, Button } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { RoomAvatar } from "./RoomAvatar";

interface ConversationHeaderProps {
  room: ChatRoomDto;
  /** Nhãn ĐÃ dựng của phòng (DM = tên người đối thoại). */
  title: string;
  /** Số thành viên đang hoạt động — 0 ⇒ không hiện dòng đếm (chưa tải xong `getRoom`). */
  memberCount: number;
  /**
   * Phòng `direct`: người đối thoại có đang online không. `null` = KHÔNG PHẢI phòng direct.
   *
   * Ba giá trị (`null` · `true` · `false`) chứ không phải boolean: sự kiện `chat:presence` chỉ fan-out
   * tới peer DM (cố ý — phát trạng thái online tới mọi phòng là rò lịch làm việc), nên ở phòng nhóm ta
   * KHÔNG BIẾT, và "không biết" phải khác "đang offline".
   */
  peerOnline: boolean | null;
  /** Ảnh người đối thoại (roster, phòng `direct`). `null` ⇒ chữ cái đầu. */
  peerAvatarUrl: string | null;
  isInfoOpen: boolean;
  onToggleInfo?: () => void;
  /** Mở tìm kiếm ĐÃ bó theo phòng này. `undefined` ⇒ ẩn nút (drawer chưa có cột tìm kiếm). */
  onSearchInRoom?: () => void;
  /** Nút gọi — do caller dựng (cần `CallProvider`). */
  callSlot?: React.ReactNode;
}

export function ConversationHeader({
  room,
  title,
  memberCount,
  peerOnline,
  peerAvatarUrl,
  isInfoOpen,
  onToggleInfo,
  onSearchInRoom,
  callSlot,
}: ConversationHeaderProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const isDirect = room.roomType === "direct";

  return (
    <header
      className="flex items-center gap-2 border-b border-border px-4 py-2.5"
      data-testid="chat-conversation-header"
    >
      {/*
       * Phòng `direct` KHÔNG có `avatarUrl` riêng — CHECK `chk_chat_rooms_direct_no_avatar` (mig 0543)
       * ép ở DB. Ảnh DM là dẫn xuất từ người đối thoại, lấy qua ROSTER (đã ký 1 lô cho cả phòng).
       */}
      {isDirect ? (
        <Avatar
          name={title}
          src={peerAvatarUrl}
          size="md"
          data-testid="chat-header-avatar"
          className="shrink-0"
        />
      ) : (
        <RoomAvatar room={room} label={title} size="md" className="shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {peerOnline === true && (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                aria-hidden="true"
                data-testid="chat-peer-online-dot"
              />
              {/* Chấm màu là tín hiệu THỊ GIÁC — người đọc màn hình cần chữ, không có chữ thì trạng
                  thái này đơn giản không tồn tại với họ. */}
              <span className="truncate">{t("presence.online")}</span>
            </>
          )}
          {peerOnline !== true && (
            <span className="truncate">
              {memberCount > 0
                ? t("conversation.membersCount", { count: memberCount })
                : t(`rooms.types.${room.roomType}`)}
            </span>
          )}
        </p>
      </div>

      {onSearchInRoom && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("conversation.searchInRoom")}
          data-testid="chat-header-search"
          onClick={onSearchInRoom}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}

      {callSlot}

      {onToggleInfo && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isInfoOpen ? t("conversation.infoToggleClose") : t("conversation.infoToggle")}
          aria-pressed={isInfoOpen}
          onClick={onToggleInfo}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </header>
  );
}
