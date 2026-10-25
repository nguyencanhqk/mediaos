/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-13) — lớp phím tắt chuyển phòng: listener + vùng `aria-live` đọc tên
 * phòng vừa mở + bảng gợi ý phím (?). Gắn MỘT lần ở `ChatPage` và ở `ChatDrawerBody` — hai nơi có danh
 * sách phòng. Luật phím và luật chọn đích ở `use-room-shortcuts.ts` (hàm thuần, kiểm bằng gọi hàm).
 *
 * Đổi phòng xong, focus vào ô soạn là việc của `ConversationPanel autoFocusComposer`: panel được keyed
 * theo phòng ở cả trang lẫn drawer, nên đổi phòng = dựng panel mới = focus ô soạn — không cần lối thứ hai.
 *
 * Vùng `aria-live` cũng là NÚT NEO của lớp này (`hostRef`): dialog modal nào CHỨA nó (Sheet drawer) là
 * khung bao, không chặn phím; dialog nào không chứa nó (hộp tạo phòng, bảng gợi ý) là lớp chồng, nhường phím.
 */
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, toast } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { roomDisplayName } from "./chat-format";
import type { RoomFilterChip } from "./room-list-filter";
import {
  useLiveAnnouncement,
  useRoomNavOrder,
  useRoomShortcuts,
  useShortcutPlatform,
  type RoomShortcutAction,
  type ShortcutPlatform,
} from "./use-room-shortcuts";

/** Khoá gộp «Đã đọc hết»: nhấn lặp không chồng nhiều thông báo. */
export const ALL_READ_TOAST_KEY = "chat-all-read";

const KEYS: Readonly<Record<ShortcutPlatform, Readonly<Record<RoomShortcutAction, string[]>>>> = {
  other: {
    prev: ["Alt", "↑"],
    next: ["Alt", "↓"],
    nextUnread: ["Alt", "Shift", "↓"],
  },
  mac: {
    prev: ["⌘", "⌥", "↑"],
    next: ["⌘", "⌥", "↓"],
    nextUnread: ["⌘", "⌥", "⇧", "↓"],
  },
};

const ACTIONS: readonly RoomShortcutAction[] = ["prev", "next", "nextUnread"];

interface RoomShortcutsProps {
  /** Chip + câu lọc ĐANG áp cho danh sách phòng (cùng nguồn với `RoomListPanel`). */
  chip: RoomFilterChip;
  query: string;
  currentRoomId: string | null;
  onOpenRoom: (roomId: string) => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  /** Ghi đè nền tảng (test). Mặc định phát hiện từ `navigator`. */
  platform?: ShortcutPlatform;
}

export function RoomShortcuts({
  chip,
  query,
  currentRoomId,
  onOpenRoom,
  helpOpen,
  onHelpOpenChange,
  platform: platformOverride,
}: RoomShortcutsProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const myUserId = useChatStore((s) => s.myUserId);
  const labelOf = useCallback(
    (room: ChatRoomDto): string =>
      roomDisplayName(room, undefined, myUserId, (code) => t("rooms.directFallback", { code })),
    [myUserId, t],
  );
  const order = useRoomNavOrder(chip, query, labelOf);
  const platform = useShortcutPlatform(platformOverride);
  const hostRef = useRef<HTMLDivElement>(null);
  const { message, announce } = useLiveAnnouncement();

  useRoomShortcuts({
    order,
    currentRoomId,
    platform,
    hostRef,
    onOpenRoom: (room) => {
      onOpenRoom(room.id);
      announce(t("shortcuts.opened", { name: labelOf(room) }));
    },
    // Thông báo nổi đã có vùng `aria-live` riêng (Toaster) ⇒ không đọc lại lần hai ở vùng của ta.
    onAllRead: () => toast.success(t("shortcuts.allRead"), { key: ALL_READ_TOAST_KEY }),
    onOpenHelp: () => onHelpOpenChange(true),
  });

  return (
    <>
      <div
        ref={hostRef}
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="room-shortcut-live"
      >
        {message}
      </div>
      <Dialog
        open={helpOpen}
        onClose={() => onHelpOpenChange(false)}
        title={t("shortcuts.helpTitle")}
        description={t("shortcuts.helpBody")}
      >
        <dl className="space-y-2 text-sm" data-testid="room-shortcut-help">
          {ACTIONS.map((action) => (
            <ShortcutRow
              key={action}
              label={t(`shortcuts.actions.${action}`)}
              keys={KEYS[platform][action]}
            />
          ))}
          <ShortcutRow label={t("shortcuts.actions.help")} keys={["?"]} />
        </dl>
      </Dialog>
    </>
  );
}

function ShortcutRow({
  label,
  keys,
}: {
  label: string;
  keys: readonly string[];
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt>{label}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
          >
            {k}
          </kbd>
        ))}
      </dd>
    </div>
  );
}
