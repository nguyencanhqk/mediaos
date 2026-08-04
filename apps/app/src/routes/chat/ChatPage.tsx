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
import { Button, EmptyState } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { CreateRoomDialog } from "@/components/chat/CreateRoomDialog";
import { MessageSearchPanel } from "@/components/chat/MessageSearchPanel";
import { RoomInfoPanel } from "@/components/chat/RoomInfoPanel";
import { RoomListPanel } from "@/components/chat/RoomListPanel";
import { roomDisplayName } from "@/components/chat/chat-format";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS, CONTEXT_AFTER, CONTEXT_BEFORE } from "./constants";

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

  const enterMessageContext = useChatStore((s) => s.enterMessageContext);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isInfoOpen, setInfoOpen] = useState(true);
  const [isCreateOpen, setCreateOpen] = useState(false);
  /**
   * S7-CHAT-FE-4 — cột trái có HAI chế độ: danh sách phòng ↔ tìm kiếm tin nhắn (CHAT-SCREEN-005).
   *
   * Không mở cột thứ tư: trang này cố ý không bọc `ModuleWorkspaceLayout` để tránh đúng chuyện đó
   * (docblock đầu file). Câu tìm kiếm giữ ở ĐÂY chứ không trong panel: đóng/mở lại panel mà mất câu vừa
   * gõ là bắt người dùng gõ lại sau mỗi lần xem một kết quả.
   */
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /**
   * Giữ Ý ĐỊNH ("tất cả" ↔ "trong phòng này"), KHÔNG giữ một `roomId` đã chốt.
   *
   * Chốt id vào state là để lại một phạm vi CŨ khi người dùng đổi phòng: nhãn nút nói tên phòng đang
   * mở còn truy vấn lại bó theo phòng trước đó — sai theo kiểu không ai đối chiếu được. Suy từ
   * `selectedRoomId` mỗi lần render thì nhãn và truy vấn không thể lệch nhau.
   */
  const [searchScope, setSearchScope] = useState<"all" | "room">("all");
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [jumpError, setJumpError] = useState(false);
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
   * S7-CHAT-FE-4 — nhảy tới MỘT tin bất kỳ trong ngữ cảnh của nó (CHAT-SCREEN-005).
   *
   * FE-2 chỉ quét DOM phần đã tải và trả "không thấy" cho mọi tin cũ hơn. Nay nạp hẳn cửa sổ quanh
   * `roomSeq` bằng ĐÚNG hai lời gọi (`/messages` không có `aroundSeq`):
   *
   *   beforeSeq = seq + 1  → 25 tin có seq ≤ seq, GỒM chính tin đích (vị từ `lt`, loại trừ)
   *   afterSeq  = seq      → 25 tin sau nó (vị từ `gt`)
   *
   * ⚠️ `+ 1` không phải làm tròn cho đẹp: `beforeSeq = seq` loại trừ đúng tin người dùng vừa bấm vào.
   *
   * Cửa sổ THAY THẾ danh sách của phòng (`enterMessageContext`) — ghép vào dải đang giữ sẽ dựng một khe
   * hở câm giữa hai đoạn cách nhau hàng nghìn tin (xem docblock `ChatMessageContext`).
   */
  const jumpToMessage = useCallback(
    async (roomId: string, messageId: string, roomSeq: number): Promise<void> => {
      setSelectedRoomId(roomId);
      setJumpError(false);
      try {
        const [olderPage, newerPage] = await Promise.all([
          chatApi.getMessages(roomId, { beforeSeq: roomSeq + 1, limit: CONTEXT_BEFORE }),
          chatApi.getMessages(roomId, { afterSeq: roomSeq, limit: CONTEXT_AFTER }),
        ]);
        const window = [...olderPage, ...newerPage];
        // Tin đích vắng mặt (vừa bị thu hồi + lọc, hoặc con trỏ lệch): KHÔNG vào chế độ ngữ cảnh — vào
        // rồi thì người dùng ngồi trong một cửa sổ đóng băng mà không có tin nào được làm nổi.
        if (!window.some((m) => m.id === messageId)) {
          setJumpError(true);
          return;
        }
        enterMessageContext(roomId, window, { messageId, seq: roomSeq });
      } catch (err: unknown) {
        setJumpError(true);
        console.error(`[chat] không mở được ngữ cảnh của tin ${messageId}:`, err);
      }
    },
    [enterMessageContext],
  );

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

  const selectedRoomLabel =
    selectedRoom === null
      ? null
      : (resolvedNames[selectedRoom.id] ??
        selectedRoom.name ??
        t("rooms.directFallback", { code: selectedRoom.roomCode }));

  return (
    <div className="relative flex h-[calc(100vh-4rem)] min-h-0" data-testid="chat-page">
      {isSearchOpen ? (
        <MessageSearchPanel
          query={searchQuery}
          onQueryChange={setSearchQuery}
          scope={{
            roomId: searchScope === "room" ? selectedRoomId : null,
            roomLabel: selectedRoomLabel,
          }}
          onScopeChange={setSearchScope}
          onOpenResult={(result) => {
            setActiveResultId(result.id);
            void jumpToMessage(result.roomId, result.id, result.roomSeq);
          }}
          onClose={() => setSearchOpen(false)}
          activeMessageId={activeResultId}
        />
      ) : (
        <RoomListPanel
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          onCreateRoom={() => setCreateOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          resolvedNames={resolvedNames}
          isBootstrapping={!hasLoadedRooms}
        />
      )}

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
          onJumpToMessage={(messageId, roomSeq) =>
            void jumpToMessage(selectedRoom.id, messageId, roomSeq)
          }
          onRoomLeft={() => setSelectedRoomId(null)}
        />
      )}

      {/*
       * Lỗi mở ngữ cảnh là lỗi của một THAO TÁC, không phải của một khung nhìn — nó không có chỗ nào
       * trong 3 cột để nằm, nên báo nổi ở góc và người dùng bấm tiếp kết quả khác được ngay.
       */}
      {jumpError && (
        <div
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md border border-destructive/50 bg-background px-3 py-2 text-xs shadow-md"
          role="alert"
        >
          <span className="text-destructive">{t("search.jumpFailed")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-6"
            onClick={() => setJumpError(false)}
          >
            {t("search.dismiss")}
          </Button>
        </div>
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
