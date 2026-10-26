/**
 * S20-CHAT-DISCUSS-1 (US-CHAT-NV-11) — «Thảo luận»: mở phòng chat của dự án trong drawer, trang giữ nguyên.
 *
 * Nguồn phòng = danh sách phòng ĐÃ có trong `useChatStore` (`ProtectedShell` nạp `chatKeys.rooms.list()`
 * qua `useChatRealtime` rồi `syncRoomList`; `chat:room` vá tiếp). Nút KHÔNG tự hỏi server, KHÔNG tạo
 * phòng từ client và KHÔNG có phòng theo việc (CHAT-DEC-009) — phòng dự án do BE dẫn xuất từ thành viên
 * dự án (`chat-derived-rooms-sync.service.ts`), membership do BE quyết.
 *
 *   thiếu `access:chat` hoặc `view:chat-room`  ⇒ không nút (không có drawer / không có danh sách)
 *   danh sách phòng chưa về                    ⇒ chưa hiện gì
 *   có phòng `project` + `refId = projectId`    ⇒ nút mở phòng đó qua `openRoom`
 *   không có, mà caller nói phòng PHẢI có       ⇒ nút vô hiệu + «Phòng dự án đang được tạo»
 *   không có, còn lại                           ⇒ không nút, không lộ gì về phòng
 *
 * `expectsRoom` do caller truyền vì chỉ caller có dữ liệu đó: tôi là thành viên (`myProjectRole`) của một
 * dự án CÒN MỞ — BE chỉ đưa thành viên đang hoạt động vào phòng chưa lưu trữ, nên khi đó vắng phòng nghĩa
 * là đồng bộ chưa xong. Chi tiết việc không có dữ liệu này nên để mặc định `false` — không suy «đang tạo»
 * từ việc không thấy phòng.
 */
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";

/** Id phòng dự án trong danh sách của tôi, hoặc `null`. Trả chuỗi (không object) ⇒ selector ổn định. */
export function findProjectRoomId(
  roomsById: Readonly<Record<string, ChatRoomDto>>,
  projectId: string,
): string | null {
  for (const room of Object.values(roomsById)) {
    if (room.roomType === "project" && room.refId === projectId) return room.id;
  }
  return null;
}

interface ProjectDiscussButtonProps {
  projectId: string;
  /** Phòng dự án PHẢI có cho tôi (thành viên của dự án còn mở) — vắng phòng thì nói «đang được tạo». */
  expectsRoom?: boolean;
  className?: string;
}

export function ProjectDiscussButton({
  projectId,
  expectsRoom = false,
  className,
}: ProjectDiscussButtonProps): React.ReactElement | null {
  const { t } = useTranslation("chat");
  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);
  const roomId = useChatStore((s) => findProjectRoomId(s.roomsById, projectId));
  const openRoom = useChatDockStore((s) => s.openRoom);

  if (!canAccessChat || !canViewRoom || !hasLoadedRooms) return null;
  if (roomId === null && !expectsRoom) return null;

  const isPending = roomId === null;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        aria-describedby={isPending ? `project-discuss-pending-${projectId}` : undefined}
        onClick={() => {
          if (roomId !== null) openRoom(roomId);
        }}
        data-testid="project-discuss-button"
      >
        <MessagesSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t("discuss.action")}
      </Button>
      {isPending && (
        <span id={`project-discuss-pending-${projectId}`} className="text-xs text-muted-foreground">
          {t("discuss.pending")}
        </span>
      )}
    </span>
  );
}
