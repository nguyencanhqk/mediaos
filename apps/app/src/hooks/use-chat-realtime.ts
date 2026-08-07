/**
 * S7-CHAT-FE-1 — nối CHAT vào kết nối `/ws` dùng chung của app shell (SPEC-15 §13.8).
 *
 * Gắn ĐÚNG MỘT LẦN ở `ProtectedShell` (mount-once, bọc mọi route đã đăng nhập). Hook này KHÔNG render
 * gì và KHÔNG mở kết nối riêng: nó lấy socket từ `getAppSocket()` — nơi duy nhất phía client được gọi
 * `io()` (ép bằng ESLint `no-restricted-imports`).
 *
 * ⚠️ WS MỘT CHIỀU (CHAT-DEC-005): hook chỉ ĐĂNG KÝ listener, không bao giờ `emit`. Muốn ghi thì gọi REST.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  chatApi,
  chatKeys,
  getAppSocket,
  refreshAccessToken,
  useAuthStore,
  useCan,
} from "@mediaos/web-core";
import {
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatPresenceEventSchema,
  wsChatReactionEventSchema,
  wsChatReadEventSchema,
  wsChatRoomEventSchema,
  wsChatTypingEventSchema,
} from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";

/**
 * Hai message lỗi handshake mà server phát CÓ CHỦ ĐÍCH (`realtime.gateway.ts`). Mọi message khác rơi
 * vào nhánh MẶC ĐỊNH — xem `onConnectError`.
 */
const WS_ERR_UNAUTHORIZED = "unauthorized";
const WS_ERR_REALTIME_DISABLED = "realtime_disabled";

/**
 * Payload sai hình dạng: BỎ QUA (không throw trong listener socket) nhưng KHÔNG câm lặng.
 *
 * `packages/contracts/src/realtime.ts` thuộc `S7-CHAT-RT-1`. Một lần đổi shape ở đó làm CHAT ngừng cập
 * nhật HOÀN TOÀN; không có dòng log này thì triệu chứng duy nhất là "chat đứng im" — không lần ra được.
 */
function warnBadPayload(event: string, error: unknown): void {
  console.error(`[chat] payload WS sai hợp đồng trên kênh ${event} — bỏ qua:`, error);
}

export function useChatRealtime(): void {
  // ⚠️ MỌI hook dưới đây gọi VÔ ĐIỀU KIỆN. Đặt `if (!canReadChat) return;` phía trên chúng sẽ làm số
  // hook thay đổi giữa các lần render (`useCan` đọc capabilities nạp sau `/auth/me`, lần render đầu gần
  // như luôn `false`) ⇒ React ném "Rendered fewer hooks than expected" và TRẮNG NGUYÊN app shell —
  // không chỉ hỏng CHAT. Cổng quyền nằm BÊN TRONG từng hook.
  const canReadChat = useCan("view", "chat-room");
  const myUserId = useAuthStore((s) => s.user?.id ?? null);

  const setMyUserId = useChatStore((s) => s.setMyUserId);
  const syncRoomList = useChatStore((s) => s.syncRoomList);

  const roomsQuery = useQuery({
    queryKey: chatKeys.rooms.list(),
    queryFn: () => chatApi.listRooms(),
    enabled: canReadChat,
  });
  const rooms = roomsQuery.data;
  const refetchRooms = roomsQuery.refetch;

  useEffect(() => {
    setMyUserId(myUserId);
  }, [myUserId, setMyUserId]);

  useEffect(() => {
    // `syncRoomList` chứ KHÔNG phải `hydrateRooms`: vắng mặt trong payload là tín hiệu DUY NHẤT cho biết
    // mình đã bị bớt khỏi phòng khi sự kiện `chat:room` rơi đúng lúc WS đứt. `false` = rổ CHƯA lưu trữ,
    // khớp `archived: query.archived ?? false` mà service ép cho `listRooms()` không tham số.
    if (rooms) syncRoomList(rooms, false);
  }, [rooms, syncRoomList]);

  useEffect(() => {
    if (!canReadChat) return;
    const socket = getAppSocket();
    if (!socket) return; // chưa có phiên — shell sẽ điều hướng về app đăng nhập

    const store = () => useChatStore.getState();

    /**
     * Hỏi server xem mình còn thuộc phòng không. KHÔNG suy diễn từ payload: `chat:room` không mang
     * `affectedUserId`, và sự kiện được phát tới CẢ phòng lẫn người bị ảnh hưởng (plan rev 3 §R3.1).
     *
     * 404 = `assertMember` từ chối ⇒ không còn là thành viên ⇒ dọn store.
     * Lỗi KHÁC (5xx/mạng) ⇒ GIỮ NGUYÊN store. Xoá phòng vì server hắt hơi là mất lịch sử hiển thị của
     * một phòng người dùng vẫn đang ở trong.
     */
    const refetchRoom = (roomId: string): void => {
      void chatApi
        .getRoom(roomId)
        .then((detail) => {
          // Thu hẹp về đúng phần "phòng": `chatRoomDetailSchema` còn kèm `members[]` + `myRole`, mà
          // store nền tảng cố ý KHÔNG cache danh sách thành viên (§3).
          //
          // ⚠️ Bóc tách tường minh chứ KHÔNG `chatRoomSchema.parse(detail)`: `apiFetch` đã validate
          // payload này rồi, nên parse lần hai không thêm an toàn — nhưng nó CÓ THỂ NÉM, và cú ném đó
          // rơi thẳng vào `.catch` bên dưới (chỉ xử lý 404) ⇒ phòng lặng lẽ không bao giờ được nạp,
          // không log, không dấu vết. Destructure không có nhánh hỏng nào.
          const { members: _members, myRole: _myRole, ...room } = detail;
          store().hydrateRooms([room]);
        })
        .catch((err: unknown) => {
          // `instanceof ApiError` chứ KHÔNG ép `err as {status?}`: `fetch` ném `TypeError` khi mất mạng,
          // và cast đó nói với TS rằng MỌI thứ ném ra đều có `status` — người sửa sau sẽ đọc tiếp
          // `err.code`/`err.message` từ một object không có chúng.
          if (err instanceof ApiError && err.status === 404) {
            store().removeRoomForSelf(roomId);
            return;
          }
          // Lỗi khác ⇒ GIỮ NGUYÊN phòng (không xoá vì server hắt hơi), nhưng phải để lại dấu.
          console.error(`[chat] không tra được phòng ${roomId} sau sự kiện chat:room:`, err);
        });
    };

    const onChatMessage = (payload: unknown): void => {
      const parsed = wsChatMessageEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:message", parsed.error);
      store().applyIncomingMessage(parsed.data);
    };

    const onChatMessageRecalled = (payload: unknown): void => {
      const parsed = wsChatMessageRecalledEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:message-recalled", parsed.error);
      store().applyMessageRecalled(parsed.data);
    };

    const onChatRead = (payload: unknown): void => {
      const parsed = wsChatReadEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:read", parsed.error);
      store().applyReadEvent(parsed.data);
    };

    /**
     * S8-CHAT-UX-FE-3 — `chat:reaction`. Payload HẸP HƠN DTO REST (`mine` bị strip vì per-user);
     * `applyReactionEvent` giữ lại `mine` đang có. Xem docblock của nó trong store.
     */
    const onChatReaction = (payload: unknown): void => {
      const parsed = wsChatReactionEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:reaction", parsed.error);
      store().applyReactionEvent(parsed.data);
    };

    const onChatTyping = (payload: unknown): void => {
      const parsed = wsChatTypingEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:typing", parsed.error);
      store().applyTypingEvent(parsed.data);
    };

    const onChatPresence = (payload: unknown): void => {
      const parsed = wsChatPresenceEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:presence", parsed.error);
      store().applyPresenceEvent(parsed.data);
    };

    const onChatRoom = (payload: unknown): void => {
      const parsed = wsChatRoomEventSchema.safeParse(payload);
      if (!parsed.success) return void warnBadPayload("chat:room", parsed.error);
      const effect = store().applyRoomEvent(parsed.data);
      if (effect.kind === "refetch-room") refetchRoom(effect.roomId);
      else if (effect.kind === "refetch-rooms") void refetchRooms();
    };

    /**
     * Kết nối (lại) được.
     *
     * Đi lên từ `connecting` = lần bắt tay ĐẦU TIÊN — `roomsQuery` vừa bootstrap xong, không có lỗ hổng
     * nào để bù. Đi lên từ `disconnected`/`polling-fallback` = có một khoảng thời gian tin đã tới server
     * mà tab này không nghe thấy ⇒ bù NGAY tại t=0, không chờ nhịp poll 10 giây kế tiếp (người dùng
     * nhìn màn hình trống suốt 10 giây là đủ để tin rằng chat hỏng).
     */
    const onConnect = (): void => {
      const previous = store().connectionStatus;
      if (previous !== "connecting") {
        for (const roomId of Object.keys(store().subscribedRoomIds)) {
          const afterSeq = store().lastKnownSeq(roomId);
          void chatApi
            .getMessages(roomId, afterSeq ? { afterSeq } : {})
            .then((messages) => {
              for (const message of messages) store().applyIncomingMessage(message);
            })
            .catch(() => {
              // Bù lỗi thì nhịp poll thường vẫn còn — không leo thang thành lỗi toàn cục.
            });
        }
        // Đổi tên/lưu trữ/thêm-bớt thành viên lỡ trong lúc đứt chỉ có ở danh sách phòng, không ở tin.
        void refetchRooms();
      }
      store().setConnectionStatus("connected");
    };

    /** Rớt vì BẤT KỲ lý do gì. Thiếu listener này thì state kẹt `connected` SAI SỰ THẬT và lưới bù tin
     * (điều kiện `connectionStatus !== 'connected'`) không bao giờ kích hoạt. */
    const onDisconnect = (): void => {
      store().setConnectionStatus("disconnected");
    };

    const onConnectError = (err: Error): void => {
      if (err.message === WS_ERR_UNAUTHORIZED) {
        // Token hết hạn giữa phiên. `auth` của socket là HÀM nên lần thử kế tiếp (backoff của
        // socket.io-client) tự đọc token MỚI — không cần tự gọi `connect()`, và KHÔNG đổi trạng thái:
        // đây là một nhịp trong quá trình kết nối, chưa phải kết luận "mất kết nối".
        void refreshAccessToken();
        return;
      }
      if (err.message === WS_ERR_REALTIME_DISABLED) {
        // Server fail-closed THEO CHỦ ĐÍCH (`REALTIME_ENABLED=false`). Thử lại là vô ích tới khi
        // operator bật lại ⇒ TẮT auto-reconnect và chuyển hẳn sang bù bằng REST.
        // ⚠️ `socket.io` là MANAGER dùng chung với NOTI. Tắt ở đây là quyết định toàn-tab, và điều đó
        // ĐÚNG về mặt nghiệp vụ (`REALTIME_ENABLED=false` giết realtime của MỌI module, không riêng
        // CHAT) — nhưng CHAT không được giữ cờ đó vĩnh viễn hộ cả app: cleanup hoàn nguyên (xem dưới).
        // Giới hạn còn lại, ghi ra để không ai tưởng đã xong: operator bật lại `REALTIME_ENABLED` giữa
        // phiên thì tab này KHÔNG tự nối lại cho tới lần tải trang kế. Quyền sở hữu công tắc này thuộc
        // về `realtime-socket.ts` (chủ socket), là việc của WO NOTI-FE/realtime, không phải FE-1.
        socket.io.reconnection(false);
        store().setConnectionStatus("polling-fallback");
        return;
      }
      // NHÁNH MẶC ĐỊNH — mọi thứ khác: CORS bị chặn, `xhr poll error`, proxy cắt, DNS hỏng…
      // KHÔNG tắt auto-reconnect (khác `realtime_disabled`): những lỗi này thường tự khỏi. Điều quan
      // trọng là RA KHỎI `connecting` — kẹt ở đó thì UI đứng hình vô thời hạn và lưới bù không chạy.
      store().setConnectionStatus("disconnected");
    };

    // ⚠️ Socket có thể ĐANG kết nối sẵn khi hook mount: nó là singleton dùng chung, một WO NOTI-FE (hoặc
    // một lần remount của shell) có thể đã mở nó từ trước. Sự kiện `connect` KHÔNG phát lại cho listener
    // gắn sau ⇒ trạng thái kẹt `'connecting'` VĨNH VIỄN, và lưới bù REST (điều kiện
    // `connectionStatus !== 'connected'`) chạy mãi 10 giây một lần dù WS hoàn toàn khoẻ. Đồng bộ ngay.
    if (socket.connected) store().setConnectionStatus("connected");

    socket.on(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(WS_EVENTS.CHAT_MESSAGE_RECALLED, onChatMessageRecalled);
    socket.on(WS_EVENTS.CHAT_READ, onChatRead);
    socket.on(WS_EVENTS.CHAT_ROOM, onChatRoom);
    socket.on(WS_EVENTS.CHAT_REACTION, onChatReaction);
    socket.on(WS_EVENTS.CHAT_TYPING, onChatTyping);
    socket.on(WS_EVENTS.CHAT_PRESENCE, onChatPresence);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      // Gỡ ĐÚNG những handler đã gắn. TUYỆT ĐỐI KHÔNG `socket.disconnect()`: socket là singleton dùng
      // chung với NOTI, và `<StrictMode>` chạy effect hai lần — ngắt ở cleanup sẽ giết kết nối của cả
      // app ngay lần mount đầu. Socket sống tới khi tab đóng; đăng xuất là hard navigation nên trình
      // duyệt tự huỷ.
      socket.off(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(WS_EVENTS.CHAT_MESSAGE_RECALLED, onChatMessageRecalled);
      socket.off(WS_EVENTS.CHAT_READ, onChatRead);
      socket.off(WS_EVENTS.CHAT_ROOM, onChatRoom);
      socket.off(WS_EVENTS.CHAT_REACTION, onChatReaction);
      socket.off(WS_EVENTS.CHAT_TYPING, onChatTyping);
      socket.off(WS_EVENTS.CHAT_PRESENCE, onChatPresence);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      // Trả lại chính sách kết nối cho chủ socket. Không hoàn nguyên thì một lần `realtime_disabled`
      // thoáng qua để lại cờ tắt-reconnect trên Manager DÙNG CHUNG — NOTI realtime chết theo, vĩnh viễn,
      // dù nó chưa bao giờ đồng ý và không có cách nào biết vì sao.
      socket.io.reconnection(true);
    };
  }, [canReadChat, refetchRooms]);
}
