/**
 * S7-CHAT-FE-1 — store CHAT dùng chung (SPEC-15 §9 CHAT-SCREEN-002).
 *
 * Đây là NGUỒN SỰ THẬT HIỂN THỊ của CHAT, không phải cache react-query: trang `/chat` full-screen
 * (FE-2) và panel nổi (FE-3) đọc CÙNG store này, nên mở panel trong lúc đang ở trang chat không nhân
 * đôi dữ liệu và không lệch trạng thái.
 *
 * Đặt ở `apps/app` chứ không ở `web-core` — theo đúng tiền lệ `layout.store.ts`: CHAT chỉ dùng trong
 * app nghiệp vụ, còn `web-core` là hạ tầng dùng chung cho cả `auth`/`console`.
 *
 * BẤT BIẾN: mọi cập nhật tạo object MỚI (không mutate) — Zustand so sánh tham chiếu để quyết định
 * re-render; sửa tại chỗ thì component không vẽ lại và lỗi hiện ra như "realtime không chạy".
 */
import { create } from "zustand";
import { ApiError, chatApi } from "@mediaos/web-core";
import type {
  ChatAttachmentDto,
  ChatMessageDto,
  ChatRoomDto,
  WsChatAttachmentDto,
  WsChatMessageRecalledEvent,
  WsChatReadEvent,
  WsChatRoomEvent,
} from "@mediaos/contracts";

/**
 * Một đính kèm trong store — hợp của HAI hình dạng, và đây KHÔNG phải sự cẩu thả về kiểu.
 *
 * `chatAttachmentSchema` (REST) mang `url`/`thumbnailUrl` là URL ký hạn ngắn; `wsChatAttachmentSchema`
 * (WS) CỐ Ý không có. Lý do nằm ở tầng quyền: quyết định ký là PER-RECIPIENT (`FilePolicyService` tính
 * riêng cho từng `userId` — cùng một tệp có thể `allow` cho người gửi và `deny` cho người nhận), trong
 * khi emit là fan-out MỘT payload cho CẢ phòng. URL presign là bearer capability: ai cầm cũng tải được,
 * không qua guard nào nữa. Vì thế kênh WS chở metadata trần.
 *
 * ⇒ Ép `ChatMessageDto` lên tin đến từ WS buộc phải bịa `url: null`, mà `null` trong hợp đồng REST có
 * nghĩa RẤT CỤ THỂ: "không được phép tải hoặc ký lỗi". Bịa như vậy làm UI hiện "tệp không tải được"
 * VĨNH VIỄN cho tệp người dùng hoàn toàn có quyền tải. Giữ hợp và bắt call-site phân biệt là cách duy
 * nhất không nói dối — xem `attachmentUrl`.
 */
export type StoredChatAttachment = ChatAttachmentDto | WsChatAttachmentDto;

/**
 * BA trạng thái, không phải hai:
 *   `string`    → URL ký, tải được ngay;
 *   `null`      → server TỪ CHỐI ký (tệp còn link module khác / `Infected` / chưa `Uploaded`);
 *   `undefined` → CHƯA BIẾT (tin đến từ WS) ⇒ gọi `GET /chat/rooms/:id/messages` để lấy URL của CHÍNH
 *                 MÌNH, đúng như `wsChatAttachmentSchema` dặn.
 */
export function attachmentUrl(attachment: StoredChatAttachment): string | null | undefined {
  return "url" in attachment ? attachment.url : undefined;
}

/**
 * Tin trong store. Giống `ChatMessageDto` mọi mặt TRỪ `attachments` — xem `StoredChatAttachment`.
 * Nhận được cả DTO REST lẫn payload WS mà không phải ép kiểu ở bất kỳ điểm gọi nào.
 */
export type StoredChatMessage = Omit<ChatMessageDto, "attachments"> & {
  attachments: readonly StoredChatAttachment[];
};

/**
 * Trần tin GIỮ TRONG BỘ NHỚ mỗi phòng. Không có trần thì một phòng ồn ào chạy vài giờ sẽ giữ hàng chục
 * nghìn DTO (mỗi cái kèm mảng `attachments`) trong RAM tab — trình duyệt chậm dần rồi chết, và không ai
 * quy được nguyên nhân về CHAT. Cuộn ngược quá trần thì FE-2 tải lại bằng `beforeSeq`.
 */
export const MAX_MESSAGES_PER_ROOM = 200;

/**
 * S7-CHAT-FE-2 — trần TUYỆT ĐỐI khi người dùng CHỦ ĐỘNG cuộn ngược (`prependOlderMessages`).
 *
 * `MAX_MESSAGES_PER_ROOM` là trần của dòng tin SỐNG (đẩy về từ WS/bù REST) — người dùng không xin nó,
 * nên cắt bớt phần cũ ở đó là vô hại. Lịch sử cuộn ngược thì NGƯỢC LẠI: nó là thứ người dùng vừa bấm
 * "tải thêm" để có. Cắt nó vì một tin mới vừa tới = danh sách nhảy phắt xuống đáy giữa lúc đang đọc.
 *
 * Vì vậy có HAI trần. Chạm trần này thì UI **ngừng mời "tải thêm"** và nói rõ ra — KHÔNG âm thầm cắt:
 * cắt là đúng thứ làm vỡ neo cuộn. Rời khỏi phòng ⇒ `trimRoomHistory` trả RAM về trần sống.
 */
export const MAX_HISTORY_PER_ROOM = 1000;

/** Chu kỳ bù tin khi WS KHÔNG ở trạng thái `connected` (SPEC-15 §14 "mất kết nối"). */
export const CHAT_POLL_INTERVAL_MS = 10_000;

/**
 * Vòng đời kết nối WS.
 *
 * `polling-fallback` KHÁC `disconnected` ở một điểm quyết định: nó là trạng thái server fail-closed
 * THEO CHỦ ĐÍCH (`REALTIME_ENABLED=false`) nên auto-reconnect bị TẮT — thử lại vô ích, chỉ tốn kết nối.
 * `disconnected` thì auto-reconnect của `socket.io-client` vẫn chạy nền.
 */
export type ChatConnectionStatus = "connecting" | "connected" | "disconnected" | "polling-fallback";

/**
 * Tin đang gửi (bong bóng lạc quan). KHÔNG có `resolvedMessageId`.
 *
 * ⚠️ Bản kế hoạch ban đầu ghép echo WS với pending theo FIFO-trong-phòng. Bỏ hẳn (plan rev 3 §R3.4):
 * gửi A rồi B, echo của **B** về khi A còn `sending` sẽ gán bản thật của B vào pending A; POST của A
 * hỏng sau đó ⇒ A mang id của B ⇒ UI coi A đã gửi xong. **Tin A biến mất, không báo lỗi, không nút gửi
 * lại.** `chatMessageSchema` không mang `clientMessageId` nên không có khoá ghép THẬT — ghép theo thứ
 * tự là phỏng đoán. Nay: pending CHỈ được giải quyết bởi CHÍNH response POST của nó.
 *
 * Đánh đổi có ý thức: echo WS về trước response POST thì người dùng thấy bong bóng tạm **và** tin thật
 * trong vài chục mili-giây. Trùng lặp thoáng qua thì thấy được và tự hết; tin bị nuốt thì không ai thấy.
 */
export interface PendingChatMessage {
  clientMessageId: string;
  roomId: string;
  body: string;
  createdAt: string;
  status: "sending" | "failed";
}

/**
 * S7-CHAT-FE-4 — mỏ neo của chế độ **xem ngữ cảnh** (CHAT-SCREEN-005 "nhảy tới tin trong ngữ cảnh").
 *
 * ┌─ VÌ SAO PHẢI CÓ TRẠNG THÁI RIÊNG, KHÔNG CHỈ "cuộn tới id" ────────────────────────────────────────┐
 * │ `messagesByRoom[roomId]` là MỘT danh sách phẳng sắp theo `roomSeq`, và `MessageList` vẽ liền mạch. │
 * │ Nạp dải `[900…950]` vào danh sách đang giữ `[4980…5000]` cho ra màn hình mà hai tin cách nhau      │
 * │ 4.000 số nằm SÁT NHAU dưới cùng một dải ngày — người đọc không có cách nào biết ở giữa còn gì.     │
 * │ Vì thế cửa sổ ngữ cảnh THAY THẾ danh sách, và tin mới hơn `windowEndSeq` KHÔNG được chèn vào       │
 * │ (vẫn cập nhật tổng hợp phòng để badge chạy). Trạng thái này LUÔN hiện dải báo + nút thoát trên UI, │
 * │ nên nó không thể hỏng im lặng.                                                                     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export interface ChatMessageContext {
  /** Tin đích của lần nhảy — UI làm nổi đúng tin này. */
  targetMessageId: string;
  targetSeq: number;
  /** `roomSeq` LỚN NHẤT của cửa sổ đã nạp. Tin mới hơn số này không được chèn (xem docblock trên). */
  windowEndSeq: number;
}

/**
 * Việc cần làm SAU khi xử lý một sự kiện `chat:room` — trả về cho caller thay vì tự gọi API.
 *
 * Store giữ đồng bộ và thuần để test được bằng gọi hàm trực tiếp; mọi I/O nằm ở `useChatRealtime`.
 */
export type ChatRoomEffect =
  | { kind: "none" }
  | { kind: "refetch-room"; roomId: string }
  | { kind: "refetch-rooms" };

interface SubscribedRoom {
  pollIntervalId: ReturnType<typeof setInterval> | null;
}

interface ChatStoreState {
  /** userId của CHÍNH MÌNH — hook shell nạp sau `/auth/me`. `null` = chưa biết ⇒ mọi nhánh so-mình no-op. */
  myUserId: string | null;
  roomsById: Record<string, ChatRoomDto>;
  /** Thứ tự hiển thị: `lastMessageAt` GIẢM DẦN, phòng chưa có tin xếp CUỐI. */
  roomOrder: string[];
  /** Tin theo phòng, TĂNG DẦN theo `roomSeq`, trần `MAX_MESSAGES_PER_ROOM`. */
  messagesByRoom: Record<string, readonly StoredChatMessage[]>;
  pendingByClientId: Record<string, PendingChatMessage>;
  connectionStatus: ChatConnectionStatus;
  subscribedRoomIds: Record<string, SubscribedRoom>;
  /** S7-CHAT-FE-4 — phòng nào đang xem NGỮ CẢNH của một kết quả tìm kiếm. Vắng khoá = dòng thời gian thường. */
  contextByRoom: Record<string, ChatMessageContext>;

  setMyUserId: (userId: string | null) => void;
  setConnectionStatus: (status: ChatConnectionStatus) => void;
  hydrateRooms: (rooms: readonly ChatRoomDto[]) => void;
  /** Đồng bộ TRỌN một rổ phòng theo `GET /chat/rooms` — upsert cái có, GỠ cái vắng mặt. */
  syncRoomList: (rooms: readonly ChatRoomDto[], archivedScope: boolean) => void;
  /**
   * S7-CHAT-FE-2 — `GET /chat/rooms` đã trả về ÍT NHẤT một lần chưa (bất kể rỗng hay không).
   *
   * Cần cờ TƯỜNG MINH vì "chưa tải xong" và "tải xong, không có phòng nào" trông y hệt nhau từ phía
   * `roomOrder` (đều là mảng rỗng). Suy từ độ dài mảng là hiện "Chưa có cuộc trò chuyện nào" ngay
   * khung hình đầu — người dùng có 20 phòng vẫn thấy màn hình nói họ chẳng có phòng nào (§14 "loading").
   * Đường nạp nằm ở `useChatRealtime` (app shell), nên trang `/chat` không tự biết được.
   */
  hasLoadedRooms: boolean;
  applyRoomEvent: (event: WsChatRoomEvent) => ChatRoomEffect;
  removeRoomForSelf: (roomId: string) => void;
  applyIncomingMessage: (message: StoredChatMessage) => void;
  /** S7-CHAT-FE-2 — nạp MỘT TRANG tin CŨ HƠN (cuộn ngược `beforeSeq`). Xem `MAX_HISTORY_PER_ROOM`. */
  prependOlderMessages: (roomId: string, older: readonly StoredChatMessage[]) => void;
  /** Trả RAM về trần sống sau khi rời khỏi phòng đang xem — giữ 200 tin MỚI NHẤT. */
  trimRoomHistory: (roomId: string) => void;
  /**
   * S7-CHAT-FE-4 — vào chế độ xem ngữ cảnh: THAY THẾ danh sách của phòng bằng `window` (một dải LIÊN
   * TỤC quanh tin đích, do caller nạp bằng `beforeSeq`+`afterSeq`) và đặt mỏ neo.
   */
  enterMessageContext: (
    roomId: string,
    window: readonly StoredChatMessage[],
    target: { messageId: string; seq: number },
  ) => void;
  /**
   * Thoát chế độ ngữ cảnh: xoá mỏ neo **VÀ** xoá danh sách của phòng.
   *
   * Vế thứ hai không phải tiện tay: danh sách đang giữ là một dải CŨ, còn tin mới thì đã bị chặn chèn
   * suốt thời gian xem. Giữ nó lại rồi nối tiếp tin mới vào sau chính là cái khe hở câm mà chế độ này
   * dựng ra để tránh. Caller gọi tiếp `reload()` của `useChatConversation` để nạp trang mới nhất.
   */
  exitMessageContext: (roomId: string) => void;
  applyMessageRecalled: (event: WsChatMessageRecalledEvent) => void;
  applyReadEvent: (event: WsChatReadEvent) => void;
  applyOptimisticSend: (clientMessageId: string, roomId: string, body: string) => void;
  resolvePendingSend: (clientMessageId: string, message: StoredChatMessage | null) => void;
  /**
   * S7-CHAT-FE-2 — người dùng bấm "Bỏ tin này" trên một bong bóng GỬI LỖI.
   *
   * Cần hàm riêng vì `resolvePendingSend(id, null)` là "đánh dấu lỗi, GIỮ lại để gửi lại" — không có
   * đường nào xoá. Thiếu nó thì bong bóng đỏ nằm lại vĩnh viễn và cách duy nhất để dọn là tải lại trang.
   * CHỈ người dùng gọi được (không có đường tự động), nên nó không thể vô tình nuốt tin của ai.
   */
  discardPendingSend: (clientMessageId: string) => void;
  subscribeToRoom: (roomId: string) => void;
  unsubscribeFromRoom: (roomId: string) => void;
  /** `room_seq` lớn nhất đang giữ của phòng — con trỏ `afterSeq` khi bù tin. `undefined` = chưa có tin. */
  lastKnownSeq: (roomId: string) => number | undefined;
  /** `room_seq` NHỎ nhất đang giữ — con trỏ `beforeSeq` khi cuộn ngược. `undefined` = chưa có tin. */
  oldestKnownSeq: (roomId: string) => number | undefined;
  /** Dọn TOÀN BỘ (đăng xuất / đổi phiên): xoá mọi interval rồi về trạng thái khởi tạo. */
  resetChatStore: () => void;
}

// ── helper thuần ──────────────────────────────────────────────────────────────

/**
 * Sắp thứ tự phòng: `lastMessageAt` GIẢM DẦN, phòng chưa có tin (`null`/vắng) xếp CUỐI.
 *
 * So sánh bằng `Date.parse` chứ không trừ chuỗi: `"2026-08-04T…" - "2026-08-03T…"` cho `NaN`, và
 * comparator trả `NaN` làm `Array.prototype.sort` cho thứ tự KHÔNG xác định (không throw) — hỏng im
 * lặng, mỗi trình duyệt một kiểu.
 */
function sortRoomIds(roomsById: Record<string, ChatRoomDto>): string[] {
  return Object.values(roomsById)
    .slice()
    .sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : Number.NaN;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : Number.NaN;
      const aEmpty = Number.isNaN(ta);
      const bEmpty = Number.isNaN(tb);
      if (aEmpty && bEmpty) return a.id.localeCompare(b.id); // ổn định, không phụ thuộc thứ tự khoá
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      return tb - ta;
    })
    .map((r) => r.id);
}

/** Bản này có mang URL ký không? (nguồn REST) — phân biệt với bản đến từ WS (metadata trần). */
function hasSignedUrls(attachments: readonly StoredChatAttachment[]): boolean {
  return attachments.some((a) => "url" in a);
}

/**
 * Chèn một tin vào danh sách ĐÃ sắp theo `roomSeq`, dedupe theo `id`, cắt trần từ đầu (tin CŨ NHẤT ra
 * trước). Trả về CHÍNH mảng cũ khi không có gì đổi — caller dựa vào đó để bỏ qua `set()` thừa.
 *
 * ⚠️ **Trùng `id` KHÔNG phải lúc nào cũng là no-op.** Cùng một tin đến từ hai nguồn có nội dung KHÁC
 * nhau: bản WS bị strip `url`/`thumbnailUrl` (masking per-recipient), bản REST có. Echo WS thường về
 * TRƯỚC response POST (push đang bay sẵn trong khi `fetch` còn resolve) ⇒ nếu dedupe mù thì bản có URL
 * bị vứt IM LẶNG, và đính kèm của chính mình vừa gửi vĩnh viễn không tải được.
 *
 * Tệ hơn: lời hứa trong docblock `attachmentUrl` ("`undefined` ⇒ đi hỏi REST") KHÔNG THỰC HIỆN ĐƯỢC nếu
 * dedupe mù — lưới bù chỉ xin `afterSeq` (tin MỚI HƠN), nên mọi tin REST mang URL đều đã có `id` trong
 * danh sách và bị loại. Vì thế trùng id ⇒ NÂNG CẤP riêng `attachments`, không thay cả tin.
 */
function insertMessage(
  list: readonly StoredChatMessage[],
  message: StoredChatMessage,
): readonly StoredChatMessage[] {
  const existingAt = list.findIndex((m) => m.id === message.id);
  if (existingAt !== -1) {
    const stored = list[existingAt];
    // Chỉ đi một chiều WS→REST. Tin ĐÃ THU HỒI thì server trả `attachments: []` ở CẢ hai đường, nên một
    // bản "có URL" cho tin thu hồi là dữ liệu lệch — không phục hồi nội dung đã bị che.
    if (
      stored.recalledAt !== null ||
      !hasSignedUrls(message.attachments) ||
      hasSignedUrls(stored.attachments)
    ) {
      return list;
    }
    const upgraded = [...list];
    upgraded[existingAt] = { ...stored, attachments: message.attachments };
    return upgraded;
  }

  // Đường thường là tin MỚI NHẤT ⇒ quét từ cuối, dừng ngay ở vị trí đúng.
  let at = list.length;
  while (at > 0 && list[at - 1].roomSeq > message.roomSeq) at -= 1;

  // ⚠️ S7-CHAT-FE-2 — trần ĐỘNG, không phải hằng. Danh sách chưa vượt trần sống ⇒ giữ nguyên luật cũ
  // (200). Danh sách ĐÃ vượt ⇒ phần dôi ra là lịch sử người dùng chủ động nạp bằng "tải thêm", và một
  // tin mới tới KHÔNG được phép vứt nó đi: cắt ở đây làm khung nhìn tụt thẳng xuống đáy giữa lúc người
  // ta đang đọc tin cũ. Trần tuyệt đối vẫn còn (`MAX_HISTORY_PER_ROOM`) để RAM không trôi vô hạn.
  const cap = list.length > MAX_MESSAGES_PER_ROOM ? MAX_HISTORY_PER_ROOM : MAX_MESSAGES_PER_ROOM;

  // Tin cũ hơn MỌI tin đang giữ trong một danh sách đã đầy: chèn vào đầu rồi bị cắt bỏ ngay ở dòng
  // dưới. Kết quả giống hệt `list` nhưng là mảng MỚI ⇒ Zustand vẫn phát re-render vô ích.
  // (Nạp lịch sử đi bằng `prependOlderMessages` — đường đó CỐ Ý không qua hàm này.)
  if (at === 0 && list.length >= cap) return list;

  const next = [...list.slice(0, at), message, ...list.slice(at)];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Trường được phép ghi đè từ payload `chat:room` — ALLOWLIST, không phải merge tổng quát.
 *
 * ⚠️ `unreadCount` là PER-MEMBER: payload WS `.omit()` nó CÓ CHỦ Ý (một con số chung cho cả phòng là
 * bịa). Nếu code thay nguyên object thì mỗi lần ai đó đổi tên/lưu trữ phòng, badge của phòng đó về
 * `undefined` — tức "0 chưa đọc" — dù không ai đọc thêm tin nào. Zod `.omit()` đã strip khoá này, nên
 * allowlist ở đây là lớp phòng thủ THỨ HAI, không dựa may rủi vào hợp đồng phía kia không đổi.
 */
function mergeRoomMetadata(
  current: ChatRoomDto,
  incoming: NonNullable<WsChatRoomEvent["room"]>,
): ChatRoomDto {
  const merged: ChatRoomDto = { ...current, name: incoming.name };
  // ⚠️ Bốn trường dưới đây `.optional()` trong schema. Gán thẳng `incoming.x` sẽ ghi `undefined` đè lên
  // giá trị đang có mỗi khi payload không kèm khoá đó — mô tả phòng biến mất, `lastMessageAt` về rỗng
  // và phòng rơi xuống cuối danh sách, chỉ vì một sự kiện đổi TÊN. Vắng khoá nghĩa là "không nói gì về
  // trường này", KHÔNG phải "hãy xoá nó".
  if (incoming.description !== undefined) merged.description = incoming.description;
  if (incoming.isArchived !== undefined) merged.isArchived = incoming.isArchived;
  if (incoming.lastMessageAt !== undefined) merged.lastMessageAt = incoming.lastMessageAt;
  if (incoming.lastMessageSeq !== undefined) merged.lastMessageSeq = incoming.lastMessageSeq;
  return merged;
}

/**
 * Ghép một phòng từ REST vào phòng đang giữ — **theo mốc nước `lastMessageSeq`**, không đè mù.
 *
 * ⚠️ Đây là chống LOST-UPDATE, không phải tối ưu. Cửa sổ đua mở đúng lúc reconnect (lúc dễ dồn tin
 * nhất): t0 phát `GET /chat/rooms` (server tính `unreadCount = 0`) → t0+50ms tin mới về qua WS, badge
 * lên 1 → t0+120ms response CŨ (ảnh chụp t0) về và ghi `unreadCount: 0`. Người dùng có tin chưa đọc mà
 * **không có badge** ⇒ không bao giờ vào xem. Chỉ tin server khi ảnh chụp của nó KHÔNG cũ hơn thứ ta
 * đang giữ.
 */
function mergeServerRoom(current: ChatRoomDto | undefined, incoming: ChatRoomDto): ChatRoomDto {
  if (!current) return incoming;
  const currentSeq = current.lastMessageSeq ?? 0;
  const incomingSeq = incoming.lastMessageSeq ?? 0;
  if (incomingSeq >= currentSeq) return incoming;
  // Ảnh chụp của server CŨ hơn: lấy siêu dữ liệu (tên/mô tả/lưu trữ) của nó, giữ ba trường "mới nhất".
  return {
    ...incoming,
    lastMessageAt: current.lastMessageAt,
    lastMessageSeq: current.lastMessageSeq,
    unreadCount: current.unreadCount,
  };
}

/** Chưa đọc = `lastMessageSeq − lastReadSeq`, CẢ HAI trong hệ `room_seq` (SPEC-15 §13.1). Kẹp ≥ 0. */
function unreadFrom(room: ChatRoomDto, lastReadSeq: number): number {
  return Math.max(0, (room.lastMessageSeq ?? 0) - lastReadSeq);
}

/**
 * Khoá idempotency của một tin, sinh MỘT LẦN lúc bắt đầu soạn.
 *
 * ⚠️ Gọi lại hàm này khi bấm "gửi lại" là **huỷ toàn bộ tác dụng chống trùng** — server dedupe theo
 * `client_message_id`, khoá mới nghĩa là tin mới (memory `idempotency-key-must-be-content-derived`).
 * Ô soạn giữ khoá, hàm gửi NHẬN khoá làm tham số.
 *
 * `randomUUID` có ở mọi trình duyệt secure-context và Node ≥19; nhánh dự phòng chỉ để test/môi trường
 * không secure-context không nổ — vẫn phải là UUID v4 hợp lệ vì `sendMessageSchema` đòi `.uuid()`.
 */
export function createClientMessageId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (ch) => {
    const n = Number(ch);
    return (n ^ (Math.floor(Math.random() * 256) & (15 >> (n / 4)))).toString(16);
  });
}

// ── store ─────────────────────────────────────────────────────────────────────

/**
 * FACTORY, không phải hằng dùng chung. `set({ ...INITIAL_STATE })` chỉ sao chép TẦNG TRÊN — mọi lần
 * `resetChatStore()` sẽ trỏ lại CÙNG object `roomsById`/`messagesByRoom`/… Hôm nay mọi writer đều
 * spread nên chưa hỏng, nhưng một dòng ghi tại chỗ ở đâu đó sẽ làm "trạng thái khởi tạo" bẩn vĩnh viễn.
 */
const createInitialState = () => ({
  myUserId: null as string | null,
  roomsById: {} as Record<string, ChatRoomDto>,
  roomOrder: [] as string[],
  messagesByRoom: {} as Record<string, readonly StoredChatMessage[]>,
  pendingByClientId: {} as Record<string, PendingChatMessage>,
  connectionStatus: "connecting" as ChatConnectionStatus,
  subscribedRoomIds: {} as Record<string, SubscribedRoom>,
  contextByRoom: {} as Record<string, ChatMessageContext>,
  hasLoadedRooms: false,
});

export const useChatStore = create<ChatStoreState>((set, get) => ({
  ...createInitialState(),

  setMyUserId: (myUserId) => set({ myUserId }),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  /**
   * Nạp/cập nhật MỘT SỐ phòng từ REST (đường `getRoom` một phòng). Chỉ upsert — KHÔNG xoá phòng vắng
   * mặt, vì caller không hứa đã đưa danh sách đầy đủ. Muốn đồng bộ cả danh sách thì dùng `syncRoomList`.
   */
  hydrateRooms: (rooms) =>
    set((state) => {
      if (rooms.length === 0) return state;
      const roomsById = { ...state.roomsById };
      for (const room of rooms)
        roomsById[room.id] = mergeServerRoom(state.roomsById[room.id], room);
      return { roomsById, roomOrder: sortRoomIds(roomsById) };
    }),

  /**
   * Đồng bộ TOÀN BỘ một "rổ" phòng theo kết quả `GET /chat/rooms` — upsert cái có, GỠ cái vắng mặt.
   *
   * ⚠️ Vì sao cần hàm riêng chứ không để `hydrateRooms` tự gỡ: **vắng mặt là tín hiệu DUY NHẤT** cho
   * biết mình đã bị bớt khỏi phòng khi sự kiện `chat:room` rơi vào lúc WS đứt (Socket.IO KHÔNG bật
   * `connectionStateRecovery` ⇒ sự kiện lỡ là mất vĩnh viễn). `listRoomsForUser` inner-join
   * `chat_room_members` với `left_at IS NULL`, nên phòng đã rời BIẾN MẤT khỏi payload. Chỉ merge thì
   * phòng "ma" ở lại với badge cũ, bấm vào ăn 404, và interval bù nện `GET …/messages` 404 mỗi 10 giây.
   *
   * ⚠️ `archivedScope` KHÔNG phải tham số trang trí. `chat-rooms.service.ts` ép `archived: query.archived
   * ?? false`, tức `listRooms()` **chỉ trả phòng CHƯA lưu trữ**. Gỡ mù theo payload đó sẽ xoá sạch mọi
   * phòng đã lưu trữ mà mình VẪN là thành viên. Chỉ gỡ trong đúng rổ đã truy vấn.
   */
  syncRoomList: (rooms, archivedScope) => {
    const state = get();
    // Đặt cờ TRƯỚC mọi việc khác: kể cả rổ rỗng cũng là "server đã trả lời" — đó chính là lúc UI được
    // phép nói "chưa có cuộc trò chuyện nào".
    if (!state.hasLoadedRooms) set({ hasLoadedRooms: true });
    const incoming = new Set(rooms.map((r) => r.id));
    const stale = Object.values(state.roomsById).filter(
      (r) => (r.isArchived ?? false) === archivedScope && !incoming.has(r.id),
    );
    // Đi qua `removeRoomForSelf` chứ không tự xoá khoá: chỉ nó dọn luôn `messagesByRoom` và
    // `clearInterval` của lưới bù — thiếu vế đó thì phòng biến khỏi danh sách mà interval vẫn sống.
    for (const room of stale) get().removeRoomForSelf(room.id);
    get().hydrateRooms(rooms);
  },

  /**
   * Sự kiện `chat:room`. Nhóm THÀNH VIÊN không tự quyết được ở client — phải HỎI SERVER.
   *
   * ⚠️ Payload KHÔNG mang `affectedUserId`, và nhận được sự kiện KHÔNG có nghĩa nó nói về mình:
   * `emitChatRoom` phát tới CẢ room-socket của phòng LẪN user-room của người bị ảnh hưởng, nên mọi
   * thành viên đều nhận `member_removed` giống hệt nhau. Suy từ "mình còn trong socket-room hay không"
   * cũng không được — `syncRoomMembership` đá socket ra BẤT ĐỒNG BỘ với sự kiện, và trạng thái đó client
   * không đọc được. Vì thế: `refetch-room` → 200 thì mình vẫn là thành viên, 404 thì không (plan rev 3
   * §R3.1). Cái giá: N thành viên cùng gọi `GET /chat/rooms/:id` một lần khi đổi thành viên — chấp nhận
   * ở v1 vì đây là sự kiện hiếm. Sửa đúng về sau = RT-1 thêm `affectedUserIds` vào payload, KHÔNG phải
   * FE tự đoán thêm.
   */
  applyRoomEvent: (event) => {
    const state = get();
    const known = state.roomsById[event.roomId] !== undefined;

    // Bắt ra local TRƯỚC `set()`: bên trong callback, TS mất phép thu hẹp kiểu trên thuộc tính của
    // `event`, và lối thoát nhanh nhất lúc đó là `!` — đúng thứ che mất ca `room` vắng mặt thật.
    const incomingRoom = event.room;

    switch (event.action) {
      case "created": {
        if (!incomingRoom) return { kind: "refetch-rooms" }; // lệch hợp đồng RT-1 → fail-soft, không đoán
        if (known) return { kind: "none" }; // trùng lặp/đua — idempotent
        // Phòng vừa tạo chưa có tin nào ⇒ `unreadCount: 0` là sự thật, không phải giá trị bịa.
        set((s) => {
          const roomsById = { ...s.roomsById, [event.roomId]: { ...incomingRoom, unreadCount: 0 } };
          return { roomsById, roomOrder: sortRoomIds(roomsById) };
        });
        return { kind: "none" };
      }

      case "updated":
      case "archived": {
        if (!known || !incomingRoom) return { kind: "none" };
        set((s) => {
          const roomsById = {
            ...s.roomsById,
            [event.roomId]: mergeRoomMetadata(s.roomsById[event.roomId], incomingRoom),
          };
          return { roomsById, roomOrder: sortRoomIds(roomsById) };
        });
        return { kind: "none" };
      }

      case "member_added":
        // Đã ở trong phòng ⇒ là người KHÁC vừa vào; FE-1 không vẽ danh sách thành viên nên không cần gì.
        // Chưa có phòng ⇒ CÓ THỂ mình vừa được thêm — hỏi server.
        return known ? { kind: "none" } : { kind: "refetch-room", roomId: event.roomId };

      case "member_removed":
      case "left":
        // Không giữ phòng thì không có gì để gỡ. Có giữ ⇒ CÓ THỂ là mình — hỏi server.
        return known ? { kind: "refetch-room", roomId: event.roomId } : { kind: "none" };

      case "member_role_changed":
        return { kind: "none" }; // không đổi metadata phòng lẫn tập phòng của mình

      default:
        return { kind: "none" };
    }
  },

  /**
   * Bị bớt khỏi phòng (hoặc tự rời): dọn SẠCH.
   *
   * Bỏ sót bất kỳ vế nào đều để lại rác thấy được: phòng "ma" còn tên + badge trong danh sách; lịch sử
   * tin của phòng mình KHÔNG còn quyền đọc vẫn nằm trong RAM; và interval bù tin tiếp tục gọi
   * `GET /chat/rooms/:id/messages` (giờ trả 404) mỗi 10 giây, vô thời hạn.
   */
  removeRoomForSelf: (roomId) => {
    const sub = get().subscribedRoomIds[roomId];
    if (sub?.pollIntervalId) clearInterval(sub.pollIntervalId);
    set((state) => {
      if (state.roomsById[roomId] === undefined && state.subscribedRoomIds[roomId] === undefined) {
        return state;
      }
      const { [roomId]: _room, ...roomsById } = state.roomsById;
      const { [roomId]: _msgs, ...messagesByRoom } = state.messagesByRoom;
      const { [roomId]: _sub, ...subscribedRoomIds } = state.subscribedRoomIds;
      // S7-CHAT-FE-4: mỏ neo ngữ cảnh phải đi cùng — bỏ lại là một mỏ neo mồ côi trỏ vào phòng mình
      // không còn quyền đọc, và nó sẽ chặn chèn nếu phòng đó quay lại (được thêm lại vào nhóm).
      const { [roomId]: _ctx, ...contextByRoom } = state.contextByRoom;
      return {
        roomsById,
        messagesByRoom,
        subscribedRoomIds,
        contextByRoom,
        roomOrder: state.roomOrder.filter((id) => id !== roomId),
      };
    });
  },

  /**
   * Một tin đi vào store — nguồn: WS `chat:message`, response POST, hoặc trang bù `afterSeq`.
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG đụng `pendingByClientId` ở đây, kể cả khi `senderId` là mình (§R3.4).
   */
  applyIncomingMessage: (message) =>
    set((state) => {
      const current = state.messagesByRoom[message.roomId] ?? [];

      /**
       * S7-CHAT-FE-4 — CHỐT CHÈN của chế độ xem ngữ cảnh.
       *
       * Đặt ở ĐÂY chứ không ở từng caller vì mọi đường vào danh sách đều chạy qua hàm này: WS
       * `chat:message`, response POST (`resolvePendingSend`), response `pin`/`recall`, lưới bù
       * `afterSeq`, trang đầu của `useChatConversation`. Chặn ở caller là chặn 5 chỗ và bỏ sót chỗ thứ 6.
       *
       * Phần TỔNG HỢP phòng (`unreadCount`/`lastMessageSeq`/thứ tự) vẫn chạy bình thường: người đang đọc
       * ngữ cảnh cũ vẫn phải thấy badge nhảy khi có tin mới — nếu không, "yên tĩnh" trở thành trạng thái
       * không phân biệt được với "đang bị chặn".
       */
      const context = state.contextByRoom[message.roomId];
      const isBeyondContextWindow = context !== undefined && message.roomSeq > context.windowEndSeq;

      const next = isBeyondContextWindow ? current : insertMessage(current, message);
      const listChanged = next !== current;

      const room = state.roomsById[message.roomId];
      if (!room) {
        // trùng id (hoặc bị chốt ngữ cảnh chặn) và không có phòng để cập nhật ⇒ không set lại, khỏi re-render
        return listChanged
          ? { messagesByRoom: { ...state.messagesByRoom, [message.roomId]: next } }
          : state;
      }

      // ⚠️ CHỈ tin nào MỚI HƠN con trỏ phòng mới được đụng vào tổng hợp của phòng. Hàm này nhận cả tin
      // CŨ: lưới bù gọi `getMessages(roomId, {})` khi phòng chưa có tin nào trong bộ nhớ (`afterSeq`
      // phải `.positive()` nên không gửi được 0) và server trả nguyên TRANG MỚI NHẤT 50 tin đã đọc từ
      // lâu; FE-2 cuộn ngược bằng `beforeSeq` cũng đổ tin cũ vào đây. Không có chốt này thì mở panel một
      // phòng lúc mất mạng làm badge nhảy lên ~50 cho phòng thật ra 0 chưa đọc — và ở
      // `polling-fallback` (`REALTIME_ENABLED=false`) không có `chat:read` nào để sửa lại, badge sai
      // tới khi F5. Tin vẫn được CHÈN bình thường; chỉ phần tổng hợp bị chặn.
      if (message.roomSeq <= (room.lastMessageSeq ?? 0)) {
        return listChanged
          ? { messagesByRoom: { ...state.messagesByRoom, [message.roomId]: next } }
          : state;
      }

      // Tin của người KHÁC làm tăng badge; tin của chính mình thì không (mình vừa gửi = đã đọc).
      // Badge tổng của FE-3 cộng dồn `unreadCount` từng phòng — KHÔNG gọi `GET /chat/unread-count`.
      const isMine = state.myUserId !== null && message.senderId === state.myUserId;
      const updatedRoom: ChatRoomDto = {
        ...room,
        lastMessageAt: message.createdAt,
        lastMessageSeq: message.roomSeq,
        unreadCount: isMine ? (room.unreadCount ?? 0) : (room.unreadCount ?? 0) + 1,
      };
      const roomsById = { ...state.roomsById, [message.roomId]: updatedRoom };
      return {
        // Bị chốt ngữ cảnh chặn ⇒ KHÔNG đụng `messagesByRoom` (mảng y hệt trong một object mới vẫn làm
        // mọi component đọc `messagesByRoom` render lại vô ích). Tổng hợp phòng thì vẫn cập nhật.
        ...(listChanged
          ? { messagesByRoom: { ...state.messagesByRoom, [message.roomId]: next } }
          : {}),
        roomsById,
        roomOrder: sortRoomIds(roomsById),
      };
    }),

  /**
   * S7-CHAT-FE-2 — một TRANG tin cũ hơn từ `getMessages(roomId, { beforeSeq })`.
   *
   * ⚠️ KHÔNG đi qua `applyIncomingMessage`. Hai lý do, cả hai đều làm hỏng im lặng:
   *   1. `insertMessage` **bỏ qua** tin cũ hơn mọi tin đang giữ khi danh sách đã đầy ⇒ từ trang thứ hai
   *      trở đi "tải thêm" không thêm gì, không lỗi, không dấu vết — người dùng chỉ thấy nút không chạy.
   *   2. `applyIncomingMessage` còn đụng `unreadCount`/`lastMessageAt` của phòng. Tin CŨ không được
   *      quyền chạm mấy thứ đó (nó có chốt `roomSeq <= lastMessageSeq`, nhưng đi vòng qua là đủ).
   *
   * Lịch sử vào CHÍNH `messagesByRoom` chứ không vào buffer riêng của component — nhờ vậy
   * `applyMessageRecalled` với tới được phần cuộn ngược. Buffer thứ hai nghĩa là một tin bị admin thu hồi
   * vẫn hiện NGUYÊN NỘI DUNG với người đang đọc lịch sử, và không sự kiện nào sửa được.
   */
  prependOlderMessages: (roomId, older) =>
    set((state) => {
      if (older.length === 0) return state;
      const list = state.messagesByRoom[roomId] ?? [];
      const known = new Set(list.map((m) => m.id));
      const fresh = older
        .filter((m) => m.roomId === roomId && !known.has(m.id))
        .sort((a, b) => a.roomSeq - b.roomSeq);
      if (fresh.length === 0) return state;

      // Chạm trần tuyệt đối: nhận PHẦN MỚI NHẤT của trang (giữ liền mạch với danh sách đang có) thay vì
      // nhận trọn rồi cắt đầu — cắt đầu là vứt đúng thứ người dùng vừa xin.
      const room = fresh.length + list.length;
      const toAdd =
        room <= MAX_HISTORY_PER_ROOM
          ? fresh
          : fresh.slice(Math.max(0, fresh.length - (MAX_HISTORY_PER_ROOM - list.length)));
      if (toAdd.length === 0) return state;

      return { messagesByRoom: { ...state.messagesByRoom, [roomId]: [...toAdd, ...list] } };
    }),

  /**
   * Cắt về 200 tin MỚI NHẤT. Gọi khi người dùng RỜI khỏi phòng đang xem — không gọi lúc đang xem, vì
   * cắt trong khi khung nhìn đang neo vào một tin cũ là cách chắc chắn nhất làm cuộn nhảy.
   */
  trimRoomHistory: (roomId) =>
    set((state) => {
      const list = state.messagesByRoom[roomId];
      if (!list || list.length <= MAX_MESSAGES_PER_ROOM) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: list.slice(list.length - MAX_MESSAGES_PER_ROOM),
        },
      };
    }),

  enterMessageContext: (roomId, window, target) =>
    set((state) => {
      // Lọc + sắp ở ĐÂY chứ không tin caller: hai lời gọi `beforeSeq`/`afterSeq` về không theo thứ tự
      // gửi, và một `roomId` lạ lọt vào danh sách của phòng khác là dữ liệu sai, không phải hiển thị sai.
      const list = window
        .filter((m) => m.roomId === roomId)
        .slice()
        .sort((a, b) => a.roomSeq - b.roomSeq);
      if (list.length === 0) return state;
      return {
        messagesByRoom: { ...state.messagesByRoom, [roomId]: list },
        contextByRoom: {
          ...state.contextByRoom,
          [roomId]: {
            targetMessageId: target.messageId,
            targetSeq: target.seq,
            windowEndSeq: list[list.length - 1].roomSeq,
          },
        },
      };
    }),

  exitMessageContext: (roomId) =>
    set((state) => {
      if (state.contextByRoom[roomId] === undefined) return state;
      const { [roomId]: _left, ...contextByRoom } = state.contextByRoom;
      const { [roomId]: _stale, ...messagesByRoom } = state.messagesByRoom;
      return { contextByRoom, messagesByRoom };
    }),

  /**
   * `chat:message-recalled` — che nội dung tin đã thu hồi.
   *
   * Payload CHỈ có 3 khoá (không kèm `body`, kể cả `null`) theo đúng hợp đồng: nội dung tin thu hồi
   * không được đi qua kênh nào nữa. Client tự xoá bản đang giữ — kể cả `attachments`, vì đường REST
   * cũng trả `[]` cho tin đã thu hồi (cùng lớp che, SPEC-15 §13.6).
   */
  applyMessageRecalled: (event) =>
    set((state) => {
      const list = state.messagesByRoom[event.roomId];
      if (!list?.some((m) => m.id === event.messageId)) return state;
      const next = list.map((m) =>
        m.id === event.messageId
          ? { ...m, body: null, recalledAt: event.recalledAt, attachments: [] }
          : m,
      );
      return { messagesByRoom: { ...state.messagesByRoom, [event.roomId]: next } };
    }),

  /**
   * `chat:read` — con trỏ đã đọc của MỘT người trong phòng.
   *
   * FE-1 chỉ xử lý con trỏ CỦA CHÍNH MÌNH (đọc trên thiết bị khác ⇒ badge ở tab này phải tắt theo).
   * Con trỏ của người khác là dữ liệu của "đã xem bởi" (SPEC-15 §13.2) — thuộc FE-2, cố ý no-op ở đây
   * thay vì gom vào một cấu trúc chưa ai dùng.
   */
  applyReadEvent: (event) =>
    set((state) => {
      if (state.myUserId === null || event.userId !== state.myUserId) return state;
      const room = state.roomsById[event.roomId];
      if (!room) return state;
      const unreadCount = unreadFrom(room, event.lastReadSeq);
      if (room.unreadCount === unreadCount) return state;
      return { roomsById: { ...state.roomsById, [event.roomId]: { ...room, unreadCount } } };
    }),

  /** Bong bóng tạm. Gọi lại với CÙNG `clientMessageId` (bấm "gửi lại") thì ghi đè, KHÔNG tạo entry thứ hai. */
  applyOptimisticSend: (clientMessageId, roomId, body) =>
    set((state) => ({
      pendingByClientId: {
        ...state.pendingByClientId,
        [clientMessageId]: {
          clientMessageId,
          roomId,
          body,
          createdAt:
            state.pendingByClientId[clientMessageId]?.createdAt ?? new Date().toISOString(),
          status: "sending",
        },
      },
    })),

  /**
   * Kết thúc một lần gửi — CHỈ response POST của chính nó gọi được hàm này (§R3.4).
   *
   * `message === null` (gửi lỗi) → đánh dấu `failed` và **GIỮ** entry: nút "gửi lại" phải dùng LẠI đúng
   * `clientMessageId` cũ để server dedupe (SPEC-15 §14). Xoá entry ở đây là xoá luôn tin người dùng vừa
   * gõ — mất dữ liệu, không phải mất trạng thái.
   */
  resolvePendingSend: (clientMessageId, message) => {
    if (message === null) {
      set((state) => {
        const pending = state.pendingByClientId[clientMessageId];
        if (!pending || pending.status === "failed") return state;
        return {
          pendingByClientId: {
            ...state.pendingByClientId,
            [clientMessageId]: { ...pending, status: "failed" },
          },
        };
      });
      return;
    }
    get().applyIncomingMessage(message); // idempotent nếu echo WS đã về trước
    set((state) => {
      if (state.pendingByClientId[clientMessageId] === undefined) return state;
      const { [clientMessageId]: _done, ...pendingByClientId } = state.pendingByClientId;
      return { pendingByClientId };
    });
  },

  discardPendingSend: (clientMessageId) =>
    set((state) => {
      if (state.pendingByClientId[clientMessageId] === undefined) return state;
      const { [clientMessageId]: _dropped, ...pendingByClientId } = state.pendingByClientId;
      return { pendingByClientId };
    }),

  lastKnownSeq: (roomId) => {
    const list = get().messagesByRoom[roomId];
    return list?.length ? list[list.length - 1].roomSeq : undefined;
  },

  oldestKnownSeq: (roomId) => {
    const list = get().messagesByRoom[roomId];
    return list?.length ? list[0].roomSeq : undefined;
  },

  /**
   * Theo dõi một phòng + bật lưới bù tin.
   *
   * Interval LUÔN được tạo (kể cả đang `connected`) nhưng mỗi nhịp tự bỏ qua khi `connected` — nhờ vậy
   * mất kết nối GIỮA CHỪNG là lưới có sẵn, không phải chờ ai đó nhớ gọi lại `subscribeToRoom`.
   * Bù bằng `afterSeq` (con trỏ `room_seq`), KHÔNG phải tải lại cả trang: tin đã có không kéo về lần nữa.
   *
   * `void` + `.catch` tường minh: một lần bù lỗi (mạng chập, 404 do vừa bị bớt khỏi phòng) KHÔNG được
   * thành unhandled rejection làm đỏ cả tab — nhịp sau tự thử lại.
   */
  subscribeToRoom: (roomId) => {
    if (get().subscribedRoomIds[roomId]) return; // đã theo dõi — không tạo interval thứ hai
    const pollIntervalId = setInterval(() => {
      const state = get();
      if (state.connectionStatus === "connected") return;
      if (state.subscribedRoomIds[roomId] === undefined) return; // đua với unsubscribe
      void pollRoomMessages(roomId);
    }, CHAT_POLL_INTERVAL_MS);
    set((state) => ({
      subscribedRoomIds: { ...state.subscribedRoomIds, [roomId]: { pollIntervalId } },
    }));
  },

  unsubscribeFromRoom: (roomId) => {
    const sub = get().subscribedRoomIds[roomId];
    if (!sub) return;
    if (sub.pollIntervalId) clearInterval(sub.pollIntervalId);
    set((state) => {
      const { [roomId]: _gone, ...subscribedRoomIds } = state.subscribedRoomIds;
      return { subscribedRoomIds };
    });
  },

  resetChatStore: () => {
    for (const sub of Object.values(get().subscribedRoomIds)) {
      if (sub.pollIntervalId) clearInterval(sub.pollIntervalId);
    }
    set(createInitialState());
  },
}));

/**
 * Kéo các tin phát sinh sau con trỏ hiện có của một phòng và nạp vào store.
 *
 * `afterSeq` chỉ gửi khi ĐÃ có tin trong phòng: `listChatMessagesQuerySchema` đòi `.positive()`, và
 * `afterSeq=0` là 400 chứ không phải "lấy từ đầu". Chưa có tin ⇒ bỏ tham số ⇒ server trả trang mới nhất.
 */
async function pollRoomMessages(roomId: string): Promise<void> {
  // S7-CHAT-FE-4 — phòng đang xem NGỮ CẢNH thì không bù: `lastKnownSeq` khi đó là cuối CỬA SỔ (một dải
  // cũ), nên mỗi nhịp sẽ kéo về đúng những tin mà chốt chèn từ chối — 10 giây một lần, vô thời hạn.
  // Thoát ngữ cảnh xoá danh sách + `reload()` nạp lại trang mới nhất, tức không mất tin nào.
  if (useChatStore.getState().contextByRoom[roomId] !== undefined) return;
  const afterSeq = useChatStore.getState().lastKnownSeq(roomId);
  try {
    const messages = await chatApi.getMessages(roomId, afterSeq ? { afterSeq } : {});
    for (const message of messages) useChatStore.getState().applyIncomingMessage(message);
  } catch (err: unknown) {
    // 404 = `assertMember` từ chối ⇒ mình KHÔNG còn trong phòng. Đây là đường phát hiện DUY NHẤT khi sự
    // kiện `chat:room` rơi vào lúc WS đứt (Socket.IO không bật `connectionStateRecovery` ⇒ lỡ là mất).
    // Không xử ca này thì interval nện 404 mỗi 10 giây VÔ THỜI HẠN, im lặng tuyệt đối.
    if (err instanceof ApiError && err.status === 404) {
      useChatStore.getState().removeRoomForSelf(roomId);
      return;
    }
    // Lỗi khác (mạng chập/5xx): nhịp sau tự thử lại. KHÔNG đổi `connectionStatus` từ đây — trạng thái
    // kết nối là việc của socket, một lần REST hỏng không chứng minh WS đã chết. Nhưng PHẢI để lại dấu:
    // nuốt câm là cách một phòng ngừng cập nhật mà không ai tìm ra nguyên nhân (CLAUDE.md §5).
    console.error(`[chat] bù tin phòng ${roomId} thất bại:`, err);
  }
}
