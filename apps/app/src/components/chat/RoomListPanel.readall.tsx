/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-05) — dải «Đọc hết» dưới hàng chip, CHỈ khi chip «Chưa đọc» đang bật.
 *
 * Áp cho đúng các phòng ĐANG HIỂN THỊ (`visible` của `RoomListPanel` — đã qua rổ → chip → ô tìm): đang tìm
 * thì phòng bị lọc đi giữ nguyên badge. Không còn phòng nào có đích (`markReadTargetOf`) ⇒ nút vô hiệu,
 * không ẩn: nút biến mất ngay sau cú bấm (các phòng rời chip «Chưa đọc») là cảnh giao diện giật dưới tay.
 *
 * Tách khỏi `RoomListPanel.tsx` (đã sát trần 800 dòng) cùng lý do `RoomListPanel.preview.tsx` đã tách.
 */
import { useTranslation } from "react-i18next";
import { CheckCheck } from "lucide-react";
import { Button } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { markReadTargetOf } from "./chat-unread-batch";

interface ReadAllBarProps {
  /** Phòng đang hiển thị trong chip «Chưa đọc». */
  rooms: readonly ChatRoomDto[];
  isBusy: boolean;
  onReadAll: (rooms: readonly ChatRoomDto[]) => void;
}

export function ReadAllBar({ rooms, isBusy, onReadAll }: ReadAllBarProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const targets = rooms.filter((room) => markReadTargetOf(room) !== null);
  return (
    <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 text-xs"
        disabled={targets.length === 0 || isBusy}
        aria-label={t("rooms.readAll.aria", { count: targets.length })}
        onClick={() => onReadAll(targets)}
        data-testid="chat-read-all"
      >
        <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {t("rooms.readAll.button")}
      </Button>
    </div>
  );
}
