/**
 * S7-CHAT-FE-2 — CHAT-SCREEN-001: trang `/chat` full-screen.
 *
 *   [ danh sách phòng ] [ hội thoại ] [ thông tin phòng ]
 *
 * ─── S17-CHAT-UX2-FE-5 (v2) — RESPONSIVE ba mốc (CHAT-DEC-026) ─────────────────────────────────────
 *   ≥1280  ba cột như trên (320 · co giãn · 340)
 *   ≥768   hai cột — bảng thông tin phòng chuyển thành `Sheet` mở bằng nút ⓘ
 *   <768   MỘT khung tại một thời điểm: danh sách → hội thoại (nút ‹) → thông tin toàn màn
 *
 * Mốc do `useChatLayoutMode` quyết (JS chứ không chỉ CSS: `md:hidden` giấu được một cột nhưng không
 * biến một cột thành `Sheet` có focus-trap, và không đổi được nghĩa của nút ⓘ). Cây JSX viết bằng NĂM
 * KHE CỐ ĐỊNH để cột hội thoại không bị dựng lại khi đổi mốc — xem docblock trong `return`.
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { chatApi, chatKeys, useCan } from "@mediaos/web-core";
import { Button, EmptyState, Sheet } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { ChatEmptyHero } from "@/components/chat/ChatEmptyHero";
import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { CreateRoomDialog } from "@/components/chat/CreateRoomDialog";
import { MessageSearchPanel } from "@/components/chat/MessageSearchPanel";
import { RoomInfoPanel } from "@/components/chat/RoomInfoPanel";
import { RoomListPanel } from "@/components/chat/RoomListPanel";
import { roomDisplayName } from "@/components/chat/chat-format";
import { useChatLayoutMode } from "@/components/chat/use-chat-viewport";
import { useChatStore } from "@/stores/chat.store";
import { CHAT_PAIRS, CONTEXT_AFTER, CONTEXT_BEFORE } from "./constants";

export function ChatPage(): React.ReactElement {
  const { t } = useTranslation("chat");
  const canViewRoom = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);
  /**
   * S17 — cổng của nút "Tin nhắn mới" trên hero khung trống. Hỏi Ở ĐÂY chứ không truyền cờ từ
   * `RoomListPanel` (nơi cũng hỏi cùng cặp): `useCan` là hook thuần đọc capabilities trong store, gọi
   * hai lần không tốn vòng mạng nào — còn chuyền cờ qua ba tầng props là mở đường cho hai cổng lệch nhau.
   */
  const canCreateRoom = useCan(CHAT_PAIRS.CREATE_ROOM.action, CHAT_PAIRS.CREATE_ROOM.resourceType);

  const queryClient = useQueryClient();

  const roomsById = useChatStore((s) => s.roomsById);
  const myUserId = useChatStore((s) => s.myUserId);
  const hydrateRooms = useChatStore((s) => s.hydrateRooms);
  // Đường nạp danh sách phòng nằm ở `useChatRealtime` (app shell), không ở trang này — nên trạng thái
  // "đang tải" phải hỏi store. Suy từ `roomOrder.length === 0` là hiện "chưa có cuộc trò chuyện nào"
  // ngay khung hình đầu cho người có 20 phòng.
  const hasLoadedRooms = useChatStore((s) => s.hasLoadedRooms);

  const enterMessageContext = useChatStore((s) => s.enterMessageContext);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  /**
   * S17-CHAT-UX2-FE-5 — HAI state cho "bảng thông tin đang mở", không phải một (CHAT-DEC-026).
   *
   * ≥1280 bảng là một CỘT (mặc định mở — nó không che gì). <1280 bảng là một `Sheet` phủ lên hội thoại
   * (mặc định đóng). Dùng chung một state mặc định `true` thì mở trang ở màn 1024px là bung ngay một
   * Sheet che kín hội thoại mà người dùng chưa bấm gì. Còn "sửa hộ" bằng một `useEffect` đóng-khi-vào-
   * chế-độ-sheet thì lại ghi đè ý định người dùng mỗi lần xoay máy hoặc kéo cửa sổ.
   */
  const [isInfoColumnOpen, setInfoColumnOpen] = useState(true);
  const [isInfoSheetOpen, setInfoSheetOpen] = useState(false);
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
  }, [detail, hydrateRooms]);

  // Phòng đang mở biến mất (bị bớt / tự rời / lưu trữ khỏi rổ) ⇒ bỏ chọn. Giữ id chết lại thì cột giữa
  // đứng hình ở trạng thái "đang tải" vĩnh viễn.
  useEffect(() => {
    if (selectedRoomId !== null && roomsById[selectedRoomId] === undefined) setSelectedRoomId(null);
  }, [roomsById, selectedRoomId]);

  const members = useMemo(() => detail?.members ?? [], [detail]);
  const myRole = detail?.myRole ?? null;

  /**
   * S17-CHAT-UX2-FE-5 — bố cục theo bề rộng khung nhìn (CHAT-DEC-026 · SPEC-15 §9 SCREEN-001 v2).
   *
   *   three (≥1280) ba cột: danh sách 320 · hội thoại co giãn · thông tin 340
   *   two   (≥768)  hai cột; thông tin phòng thành `Sheet` mở bằng nút ⓘ
   *   single (<768) MỘT khung tại một thời điểm: danh sách → hội thoại (‹) → thông tin toàn màn
   */
  const layoutMode = useChatLayoutMode();
  const isSingle = layoutMode === "single";
  /** <1280: bảng thông tin là `Sheet`, và CHÍNH nó nghe Esc (xem `escapeClosesInfo` bên dưới). */
  const isInfoSheet = layoutMode !== "three";
  const isInfoOpen = isInfoSheet ? isInfoSheetOpen : isInfoColumnOpen;
  const toggleInfo = useCallback(() => {
    if (isInfoSheet) setInfoSheetOpen((v) => !v);
    else setInfoColumnOpen((v) => !v);
  }, [isInfoSheet]);

  /**
   * Ở mốc `single`, ba khung LOẠI TRỪ nhau — trước FE-5 chúng chỉ loại trừ MỘT PHẦN.
   *
   * `MessageSearchPanel` thay `RoomListPanel`, nhưng nó vẫn đứng SONG SONG với hội thoại; ở ba cột thì
   * ổn, còn ở một cột (cả hai đều chiếm hết bề ngang) là hai khung chồng lên nhau. Và `jumpToMessage`
   * tự `setSelectedRoomId`, nên bấm một kết quả tìm kiếm là rơi thẳng vào ca đó.
   */
  const activeSinglePane: "search" | "list" | "conversation" = isSearchOpen
    ? "search"
    : selectedRoomId === null
      ? "list"
      : "conversation";
  const showList = isSingle ? activeSinglePane === "list" : !isSearchOpen;
  const showSearch = isSearchOpen;
  const showConversationArea = isSingle ? activeSinglePane === "conversation" : true;

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

  /**
   * S17-CHAT-UX2-FE-1 — dựng TẠI CHỖ, không còn cache `resolvedNames`.
   *
   * `room.peer.name` (S17-CHAT-UX2-BE-1) có ngay từ `GET /chat/rooms` nên DM có tên đúng ở khung hình
   * đầu — toàn bộ lý do tồn tại của cache đã biến mất. `detail?.members` vẫn được truyền vào để phòng
   * đang MỞ dùng nguồn tươi nhất; hai nguồn cùng suy từ `chat_room_members` nên không được phép lệch.
   */
  const selectedRoomLabel =
    selectedRoom === null
      ? null
      : roomDisplayName(selectedRoom, detail?.members, myUserId, (code) =>
          t("rooms.directFallback", { code }),
        );

  /**
   * S17-CHAT-UX2-FE-5 — dựng MỘT LẦN, đặt vào MỘT trong hai khe (cột hoặc Sheet). Xem khe 4 bên dưới.
   */
  const infoPanel =
    selectedRoom === null ? null : (
      <RoomInfoPanel
        // ⚠️ `key` BẮT BUỘC: panel giữ state cục bộ theo phòng — nháp đổi tên/mô tả, tab đang mở,
        // hộp xác nhận đang chờ. Không keyed thì chuyển sang phòng khác vẫn mang nguyên form đã
        // điền TÊN CỦA PHÒNG CŨ, và bấm Lưu là đổi tên nhầm phòng.
        //
        // Tiền tố `info-` cũng bắt buộc: dùng CHUNG một chuỗi key với `ConversationPanel` ở trên là
        // đúng cái đã làm rò khung hội thoại ra PROD (xem docblock ở đó). Hai anh em cùng mảng
        // children PHẢI có key khác nhau.
        key={`info-${selectedRoom.id}`}
        // <1280 bảng nằm TRONG `Sheet` — Sheet đã có viền, nền và bề rộng riêng, nên panel bỏ khung
        // của chính nó đi (nếu không là hai đường viền lồng nhau và một cột 340px trong panel 400px).
        variant={isInfoSheet ? "sheet" : "page"}
        room={selectedRoom}
        members={members}
        myRole={myRole}
        /*
         * S17-CHAT-UX2-FE-4 — «Tạo bởi …» lấy từ `detail`, KHÔNG từ `selectedRoom`.
         *
         * `createdByName` chỉ có ở `chatRoomDetailSchema` (CHAT-API-004) — đường DANH SÁCH không
         * mang nó (BE-1 cố ý: thêm một `LEFT JOIN users` cho mỗi phòng ở đường nóng nhất của
         * module). `selectedRoom` đến từ store (kiểu `ChatRoomDto`) nên đọc trường này ở đó là đọc
         * một khóa không thuộc hợp đồng — hôm nay tình cờ còn, ngày store dọn là mất im lặng.
         */
        createdByName={detail?.createdByName ?? null}
        isLoading={detailQuery.isLoading}
        loadError={detailQuery.isError}
        onChanged={() => void detailQuery.refetch()}
        onJumpToMessage={(messageId, roomSeq) =>
          void jumpToMessage(selectedRoom.id, messageId, roomSeq)
        }
        onRoomLeft={() => setSelectedRoomId(null)}
      />
    );

  return (
    /*
     * S17-CHAT-UX2-FE-5 — `h-full min-h-0` thay `h-[calc(100vh-4rem)]`.
     *
     * Con số cũ là số ma bám vào topbar và đã LỆCH: topbar là `h-14` (56px), không phải `4rem` (64px).
     * `ProtectedShell` đã khoá `h-dvh` + `flex min-h-0 flex-1` nên để nó cấp chiều cao là hết lệch —
     * và `dvh` còn xử lý đúng thanh URL động của iOS Safari, thứ `100vh` cắt cụt mất ô soạn tin.
     *
     * ⚠️ Năm KHE dưới đây là CỐ ĐỊNH theo thứ tự, không được gộp thành ternary đổi type. React giữ index
     * cho children TĨNH và `false` không làm dịch chỗ, nên `ConversationPanel` ở khe 2 sống nguyên qua cả
     * ba mốc. Viết `mode === "three" ? <ConversationPanel/> : <ConversationPanel/>` là hai VỊ TRÍ khác
     * nhau ⇒ React unmount+mount mỗi lần kéo cửa sổ qua mốc ⇒ `useChatConversation` cleanup chạy
     * `trimRoomHistory` và cắt lịch sử về 200 tin, vứt đúng phần người dùng vừa bấm "tải thêm".
     */
    <div className="relative flex h-full min-h-0" data-testid="chat-page" data-layout={layoutMode}>
      {/* khe 0 — danh sách phòng */}
      {showList && (
        <RoomListPanel
          // Mốc 1 cột: chiếm hết bề ngang. `drawer` ở đây không phải "trong drawer" mà là "không phải
          // một cột trong bố cục nhiều cột" — cùng hình dạng, cùng lý do.
          variant={isSingle ? "drawer" : "page"}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          onCreateRoom={() => setCreateOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          isBootstrapping={!hasLoadedRooms}
        />
      )}

      {/* khe 1 — tìm theo nội dung tin (CHAT-SCREEN-005) */}
      {showSearch && (
        <MessageSearchPanel
          className={isSingle ? "w-full" : undefined}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          scope={{
            roomId: searchScope === "room" ? selectedRoomId : null,
            roomLabel: selectedRoomLabel,
          }}
          onScopeChange={setSearchScope}
          onOpenResult={(result) => {
            setActiveResultId(result.id);
            // Mốc 1 cột: đóng cột tìm kiếm để đi THẲNG tới hội thoại. Không đóng thì hai khung cùng
            // `w-full` chồng lên nhau (xem `activeSinglePane`).
            if (isSingle) setSearchOpen(false);
            void jumpToMessage(result.roomId, result.id, result.roomSeq);
          }}
          onClose={() => setSearchOpen(false)}
          activeMessageId={activeResultId}
        />
      )}

      {/* khe 2 — hội thoại (hoặc hero khi chưa chọn phòng). VỊ TRÍ CỐ ĐỊNH — xem docblock ở trên. */}
      {showConversationArea &&
        (selectedRoom === null ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatEmptyHero
              title={t("conversation.heroTitle")}
              description={t("conversation.heroBody")}
              // Cổng `create:chat-room`: thiếu cặp ⇒ KHÔNG truyền handler ⇒ nút không render (§14).
              onCreateRoom={canCreateRoom ? () => setCreateOpen(true) : undefined}
              onOpenSearch={() => setSearchOpen(true)}
            />
          </div>
        ) : (
          <ConversationPanel
            // ⚠️ TIỀN TỐ `conv-` KHÔNG phải trang trí — nó là bản vá của một lỗi ĐÃ RA PROD (05/08).
            //
            // Panel này và `RoomInfoPanel` là hai anh em trong CÙNG một mảng children. Khi cả hai cùng
            // mang `key={selectedRoom.id}`, lúc đổi phòng React dựng map fiber cũ THEO KEY để tìm cái
            // cần xoá — key trùng nên fiber của panel này bị fiber của info ghi đè khỏi map, và cuối
            // vòng reconcile React chỉ xoá những gì CÒN trong map. Hệ quả: khung hội thoại cũ không bao
            // giờ bị gỡ, mỗi lần bấm một phòng lại rơi lại một khung nằm cạnh nhau (owner báo: "cứ ấn
            // vào là mở thêm khung"). React KHÔNG cảnh báo trùng key cho children tĩnh, nên không có
            // gì đỏ ở console lẫn ở test.
            //
            // Giữ `key` (để đổi phòng là dựng lại state cục bộ) nhưng phải DUY NHẤT trong mảng anh em.
            key={`conv-${selectedRoom.id}`}
            room={selectedRoom}
            members={members}
            myRole={myRole}
            isInfoOpen={isInfoOpen}
            onToggleInfo={toggleInfo}
            /*
             * S17-CHAT-UX2-FE-5 — ai là chủ phím Esc cho bảng thông tin.
             *
             * <1280 bảng là `Sheet` và Sheet đã tự nghe Esc. Để cả hai cùng chạy thì React gộp batch
             * `setInfoSheetOpen(false)` rồi `setInfoSheetOpen(v => !v)` ⇒ `false` → `true`, và Sheet
             * KHÔNG BAO GIỜ đóng được bằng Esc — đúng thứ `done_when` #4 đòi phải làm được.
             */
            escapeClosesInfo={!isInfoSheet}
            /*
             * Mốc 1 cột: danh sách và hội thoại loại trừ nhau, nên phải có đường quay lại. Ở 2/3 cột
             * `undefined` ⇒ ẩn nút: danh sách vẫn nằm ngay bên trái, một nút "quay lại" ở đó là mời bấm
             * vào chỗ không dẫn đi đâu cả.
             */
            onBack={isSingle ? () => setSelectedRoomId(null) : undefined}
            /*
             * S17 — 🔍 ở thanh đầu + phím tắt: mở cột tìm kiếm ĐÃ bó theo phòng đang mở. Đặt `searchScope`
             * là "room" chứ không để mặc định "all": người dùng bấm kính lúp TRONG một phòng đang có ý
             * định tìm trong phòng đó, và phạm vi vẫn đổi lại được bằng nút ngay trong panel.
             */
            onSearchInRoom={() => {
              setSearchScope("room");
              setSearchOpen(true);
            }}
          />
        ))}

      {/* khe 3 — bảng thông tin phòng dưới dạng CỘT (chỉ mốc ≥1280) */}
      {!isInfoSheet && isInfoOpen && infoPanel}

      {/*
       * khe 4 — CÙNG bảng đó dưới dạng Sheet (mốc <1280).
       *
       * `infoPanel` dựng MỘT LẦN ở trên rồi đặt vào đúng MỘT trong hai khe: hai `RoomInfoPanel` sống
       * song song sẽ chạy hai `listRoomFiles` cho cùng một phòng ⇒ hai hàng `file_access_logs` cho một
       * lần người dùng mở bảng.
       *
       * ⚠️ Gán vào một `const` KHÔNG cứu được remount khi kéo cửa sổ qua mốc 1280: hai khe là hai vị trí
       * khác nhau trong cây nên React vẫn unmount+mount, và nháp đổi tên/mô tả đang gõ trong bảng sẽ
       * mất. Chấp nhận (đổi bề rộng cửa sổ GIỮA LÚC đang sửa tên phòng là ca hiếm) — chỉ không được hứa
       * ngược lại trong docblock.
       */}
      {isInfoSheet && selectedRoom !== null && (
        <Sheet
          open={isInfoSheetOpen}
          onClose={() => setInfoSheetOpen(false)}
          title={t("info.title")}
          // <768: toàn màn. 768–1279: panel 400px trượt từ phải, giữ thấy hội thoại phía sau.
          className={isSingle ? "w-full max-w-none" : "max-w-[400px]"}
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          /*
           * Bấm nền KHÔNG đóng — cùng lý do với drawer chat, và đây là chỗ dễ bỏ sót hơn:
           * `RoomInfoPanel` giữ nháp đổi TÊN/MÔ TẢ phòng bằng state cục bộ, mà `Sheet` unmount sạch
           * children khi đóng. Một cú click trượt tay ra ngoài lúc đang sửa tên là mất nháp, không
           * cảnh báo, không hoàn tác. ✕ và Esc vẫn đóng.
           */
          closeOnBackdrop={false}
          data-testid="chat-info-sheet"
        >
          {infoPanel}
        </Sheet>
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
          onCreated={(room) => {
            hydrateRooms([room]);
            /**
             * S17-CHAT-UX2-FE-1 — XIN LẠI danh sách thay vì bịa `peer` từ tên vừa gõ.
             *
             * `POST /chat/rooms/direct` trả `peer: null` (mapper mặc định — hai khoá v2 chỉ được dựng ở
             * `listRooms`), nên dòng phòng vừa tạo sẽ hiện nhãn MÃ PHÒNG cho tới lần nạp danh sách kế
             * tiếp. Trước đây `resolvedNames` lấp chỗ đó bằng chuỗi người dùng vừa gõ.
             *
             * Không lấp lại bằng một `peer` tự dựng: `peer` thiếu `userId`/`isActive` là DTO GIẢ, và mọi
             * thứ đọc nó — chấm online, nhãn «Ngừng hoạt động» — sẽ nói sai về một người thật. Một vòng
             * `GET /chat/rooms` trả về nguồn thật, và `syncRoomList` ở `useChatRealtime` đưa thẳng vào store.
             */
            void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.list() });
            setSelectedRoomId(room.id);
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
