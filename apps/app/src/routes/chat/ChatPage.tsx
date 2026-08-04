/**
 * S7-CHAT-FE-2 — CHAT-SCREEN-001: trang `/chat` full-screen, 3 cột.
 *
 *   [ danh sách phòng ] [ hội thoại ] [ thông tin phòng ]
 *
 * Trang KHÔNG bọc `ModuleWorkspaceLayout`: layout đó thêm một sidebar module nữa, tức cột thứ TƯ trên
 * một màn hình vốn đã chật. Cổng quyền không mất gì vì nó nằm ở `ProtectedRoute meta` (tầng route), chứ
 * không ở workspace layout.
 *
 * Dữ liệu phòng/tin đọc từ `useChatStore` (đã được `useChatRealtime` ở `ProtectedShell` nạp và giữ
 * tươi). Trang chỉ hỏi thêm CHI TIẾT của phòng đang mở (`members[]` + `myRole`) — thứ danh sách phòng
 * không mang theo.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { EmptyState } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { CreateRoomDialog } from "@/components/chat/CreateRoomDialog";
import { RoomInfoPanel } from "@/components/chat/RoomInfoPanel";
import { RoomListPanel } from "@/components/chat/RoomListPanel";
import { roomDisplayName } from "@/components/chat/chat-format";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS } from "./constants";

export function ChatPage(): React.ReactElement {
  const { t } = useTranslation("chat");
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);

  const roomsById = useChatStore((s) => s.roomsById);
  const myUserId = useChatStore((s) => s.myUserId);
  const hydrateRooms = useChatStore((s) => s.hydrateRooms);
  // Đường nạp danh sách phòng nằm ở `useChatRealtime` (app shell), không ở trang này — nên trạng thái
  // "đang tải" phải hỏi store. Suy từ `roomOrder.length === 0` là hiện "chưa có cuộc trò chuyện nào"
  // ngay khung hình đầu cho người có 20 phòng.
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isInfoOpen, setInfoOpen] = useState(true);
  const [isCreateOpen, setCreateOpen] = useState(false);
  /**
   * Tên đã dựng của phòng `direct`, cache theo `roomId`.
   *
   * `GET /chat/rooms` KHÔNG kèm `members`, và phòng `direct` không có `name` (mig 0538). Tên chỉ dựng
   * được sau khi mở phòng (`getRoom` trả `members[]`). Cache lại để lần sau vào danh sách không tụt về
   * nhãn mã phòng — nhưng KHÔNG bịa tên khi chưa biết: nhãn sai làm người dùng nhắn nhầm người.
   */
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  const selectedRoom: ChatRoomDto | null =
    selectedRoomId !== null ? (roomsById[selectedRoomId] ?? null) : null;

  const detailQuery = useQuery({
    queryKey: chatKeys.rooms.detail(selectedRoomId ?? ""),
    queryFn: () => chatApi.getRoom(selectedRoomId as string),
    enabled: canViewRoom && selectedRoomId !== null,
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail) return;
    // Thu hẹp về đúng phần "phòng" trước khi vào store: store nền tảng CỐ Ý không cache `members[]`.
    // Destructure chứ không `chatRoomSchema.parse(detail)` — `apiFetch` đã validate, parse lần hai chỉ
    // thêm một điểm CÓ THỂ NÉM (cùng lý do đã ghi ở `useChatRealtime.refetchRoom`).
    const { members: _members, myRole: _myRole, ...room } = detail;
    hydrateRooms([room]);
    if (room.roomType === "direct") {
      const label = roomDisplayName(room, detail.members, myUserId, (code) =>
        t("rooms.directFallback", { code }),
      );
      setResolvedNames((prev) => (prev[room.id] === label ? prev : { ...prev, [room.id]: label }));
    }
  }, [detail, hydrateRooms, myUserId, t]);

  // Phòng đang mở biến mất (bị bớt / tự rời / lưu trữ khỏi rổ) ⇒ bỏ chọn. Giữ id chết lại thì cột giữa
  // đứng hình ở trạng thái "đang tải" vĩnh viễn.
  useEffect(() => {
    if (selectedRoomId !== null && roomsById[selectedRoomId] === undefined) setSelectedRoomId(null);
  }, [roomsById, selectedRoomId]);

  const members = useMemo(() => detail?.members ?? [], [detail]);
  const myRole = detail?.myRole ?? null;

  /**
   * Nhảy tới một tin trong hội thoại.
   *
   * v1 chỉ tìm trong phần lịch sử ĐÃ TẢI và cuộn tới nó; không có thì trả `false` để bảng ghim nói
   * thẳng "không tìm thấy trong phần đã tải". Tự nạp ngược tới khi thấy là vòng lặp có thể chạy rất lâu
   * trên phòng nghìn tin — thuộc `S7-CHAT-FE-4` (màn tìm kiếm mới là nơi có con trỏ để nhảy thẳng).
   */
  const jumpToMessage = useCallback((messageId: string): boolean => {
    const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    return true;
  }, []);

  if (!canViewRoom) {
    // §14 "không có quyền": ẩn nội dung, không hard-code role. Cổng thật vẫn ở server.
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={MessagesSquare}
          title={t("forbidden.title")}
          description={t("forbidden.body")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0" data-testid="chat-page">
      <RoomListPanel
        selectedRoomId={selectedRoomId}
        onSelectRoom={setSelectedRoomId}
        onCreateRoom={() => setCreateOpen(true)}
        resolvedNames={resolvedNames}
        isBootstrapping={!hasLoadedRooms}
      />

      {selectedRoom === null ? (
        <div className="flex min-w-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessagesSquare}
            title={t("conversation.selectRoom")}
            description={t("conversation.selectRoomHint")}
          />
        </div>
      ) : (
        <ConversationPanel
          key={selectedRoom.id}
          room={selectedRoom}
          members={members}
          myRole={myRole}
          isInfoOpen={isInfoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
        />
      )}

      {selectedRoom !== null && isInfoOpen && (
        <RoomInfoPanel
          // ⚠️ `key` BẮT BUỘC (mirror ConversationPanel): panel giữ state cục bộ theo phòng — nháp đổi
          // tên/mô tả, tab đang mở, hộp xác nhận đang chờ. Không keyed thì chuyển sang phòng khác vẫn
          // mang nguyên form đã điền TÊN CỦA PHÒNG CŨ, và bấm Lưu là đổi tên nhầm phòng.
          key={selectedRoom.id}
          room={selectedRoom}
          members={members}
          myRole={myRole}
          isLoading={detailQuery.isLoading}
          loadError={detailQuery.isError}
          onChanged={() => void detailQuery.refetch()}
          onJumpToMessage={jumpToMessage}
          onRoomLeft={() => setSelectedRoomId(null)}
        />
      )}

      {isCreateOpen && (
        <CreateRoomDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(room, displayName) => {
            hydrateRooms([room]);
            if (room.roomType === "direct" && displayName.length > 0) {
              setResolvedNames((prev) => ({ ...prev, [room.id]: displayName }));
            }
            setSelectedRoomId(room.id);
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
