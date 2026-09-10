/**
 * S17-CHAT-UX2-FE-4 — khối «Tin ghim» của bảng thông tin phòng v2 (CHAT-API-012c · SPEC-15 §9).
 *
 * Nội dung giữ nguyên của S7-CHAT-FE-2, chỉ tách khỏi `RoomInfoPanel` khi panel đổi từ tab sang
 * accordion. Truy vấn KHÔNG cần cờ `enabled` nữa: `AccordionContent` unmount thân khi đóng, nên
 * component này chỉ tồn tại lúc khối đang mở — một nguồn sự thật cho "đang mở", thay vì hai.
 *
 * ⚠️ Ghim TIN (ở đây) ≠ ghim HỘI THOẠI: `chat_messages.pinned_at` cả phòng cùng thấy, trần 20/phòng;
 * `chat_room_members.pinned_at` chỉ mình thấy, trần 10/người. Trùng chữ "ghim", khác bảng, khác phạm vi.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { chatApi, chatKeys } from "@mediaos/web-core";
import { Button, Skeleton } from "@mediaos/ui";
import { formatClock } from "../chat-format";

interface RoomPinnedListProps {
  roomId: string;
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
}

export function RoomPinnedList({
  roomId,
  onJumpToMessage,
}: RoomPinnedListProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const pinnedQuery = useQuery({
    queryKey: chatKeys.rooms.pinned(roomId),
    queryFn: () => chatApi.getPinned(roomId),
  });

  return (
    <>
      {pinnedQuery.isLoading ? (
        <div className="space-y-2 p-3" aria-busy="true">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : pinnedQuery.isError ? (
        <p className="p-3 text-xs text-muted-foreground">{t("info.pinned.loadError")}</p>
      ) : (pinnedQuery.data?.length ?? 0) === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">{t("info.pinned.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {pinnedQuery.data?.map((message) => (
            <li key={message.id} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <Pin
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {message.senderName ?? t("message.unknownSender")}
                    <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                      {formatClock(message.createdAt)}
                    </span>
                  </p>
                  {/* Text node — `body` là chuỗi người dùng gõ, React escape (không HTML thô). */}
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {message.recalledAt !== null ? t("message.recalled") : (message.body ?? "")}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => onJumpToMessage(message.id, message.roomSeq)}
                  >
                    {t("info.pinned.jump")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="px-3 pb-3 text-[11px] text-muted-foreground">{t("info.pinned.limitHint")}</p>
    </>
  );
}
