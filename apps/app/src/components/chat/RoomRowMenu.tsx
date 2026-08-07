/**
 * S8-CHAT-UX-FE-2 — menu ngữ cảnh của MỘT hội thoại (SPEC-15 §10 CHAT-FUNC-015/016/017 + §9 archive).
 *
 * ┌─ HAI lối mở, và lối bàn phím KHÔNG được là lối phụ ───────────────────────────────────────────────┐
 * │ Chuột phải (`onContextMenu` ở hàng, `RoomListPanel` gọi xuống) là lối TẮT. Nút `…` dưới đây là một │
 * │ `<button>` thật nằm trong luồng tab — người dùng bàn phím và trình đọc màn hình tới được bằng đúng │
 * │ đường họ vẫn đi. Menu chỉ-chuột-phải là menu không tồn tại với một phần người dùng.                │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Nút này KHÔNG được nằm trong nút chọn phòng: `<button>` lồng `<button>` là HTML không hợp lệ và
 * hành vi bấm/hội tụ không xác định. `RoomListPanel` tách hàng thành flex hai anh em vì đúng lý do này.
 *
 * ⚠️ Ghim · tắt thông báo · đánh dấu chưa đọc là **TUỲ CHỌN CÁ NHÂN** — KHÔNG cổng quyền (SPEC-15 §11,
 * memory `personal-prefs-must-not-sit-behind-permission-gate`). Chỉ **Lưu trữ phòng** hỏi
 * `archive:chat-room`, và cổng đó do caller truyền xuống (`canArchive`) chứ không hỏi lại ở đây.
 */
import { useTranslation } from "react-i18next";
import { Archive, BellOff, BellRing, MailOpen, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { Button, Popover, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { MUTE_PRESETS, isRoomMuted, isRoomPinned, type MutePresetKey } from "./chat-room-prefs";

interface RoomRowMenuProps {
  room: ChatRoomDto;
  /** Nhãn phòng — đưa vào `aria-label` để trình đọc màn hình biết menu này của phòng NÀO. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `archive:chat-room`. Vắng cặp ⇒ ẩn hẳn mục, không hiện rồi để server trả 403. */
  canArchive: boolean;
  isBusy: boolean;
  onTogglePin: (room: ChatRoomDto) => void;
  onMute: (room: ChatRoomDto, preset: MutePresetKey | null) => void;
  onMarkUnread: (room: ChatRoomDto) => void;
  onArchive: (room: ChatRoomDto) => void;
}

export function RoomRowMenu({
  room,
  label,
  open,
  onOpenChange,
  canArchive,
  isBusy,
  onTogglePin,
  onMute,
  onMarkUnread,
  onArchive,
}: RoomRowMenuProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const pinned = isRoomPinned(room);
  const muted = isRoomMuted(room);
  const isArchived = room.isArchived ?? false;

  // Mỗi mục tự đóng menu TRƯỚC khi chạy: để menu mở trên một dòng vừa đổi trạng thái là mời bấm lần hai
  // vào một nhãn đã cũ ("Ghim" trong khi phòng vừa được ghim xong).
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      className="min-w-[13rem] p-1"
      trigger={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("rooms.menu.openAria", { name: label })}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="chat-room-menu-trigger"
          onClick={() => onOpenChange(!open)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
    >
      <ul
        role="menu"
        aria-label={t("rooms.menu.listAria", { name: label })}
        className="space-y-0.5"
      >
        <MenuItem
          icon={pinned ? PinOff : Pin}
          label={pinned ? t("rooms.menu.unpin") : t("rooms.menu.pin")}
          disabled={isBusy}
          onSelect={run(() => onTogglePin(room))}
          testId="chat-room-menu-pin"
        />

        {muted ? (
          <MenuItem
            icon={BellRing}
            label={t("rooms.menu.unmute")}
            disabled={isBusy}
            onSelect={run(() => onMute(room, null))}
            testId="chat-room-menu-unmute"
          />
        ) : (
          <>
            <li className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("rooms.menu.muteHeading")}
            </li>
            {MUTE_PRESETS.map((preset) => (
              <MenuItem
                key={preset.key}
                icon={BellOff}
                label={t(`rooms.menu.mutePreset.${preset.key}`)}
                disabled={isBusy}
                onSelect={run(() => onMute(room, preset.key))}
                testId={`chat-room-menu-mute-${preset.key}`}
              />
            ))}
          </>
        )}

        <MenuItem
          icon={MailOpen}
          label={t("rooms.menu.markUnread")}
          disabled={isBusy}
          onSelect={run(() => onMarkUnread(room))}
          testId="chat-room-menu-unread"
        />

        {canArchive && !isArchived && (
          <MenuItem
            icon={Archive}
            label={t("rooms.menu.archive")}
            disabled={isBusy}
            onSelect={run(() => onArchive(room))}
            testId="chat-room-menu-archive"
          />
        )}
      </ul>
    </Popover>
  );
}

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  disabled: boolean;
  onSelect: () => void;
  testId: string;
}

function MenuItem({
  icon: Icon,
  label,
  disabled,
  onSelect,
  testId,
}: MenuItemProps): React.ReactElement {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
        data-testid={testId}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden={true} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}
