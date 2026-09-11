/**
 * S7-CHAT-FE-3 — trạng thái UI của panel chat phụ (SPEC-15 §9 CHAT-SCREEN-002).
 *
 * ⚠️ **Tên file giữ nguyên là "dock", nhưng panel nay là DRAWER** (S17-CHAT-UX2-FE-5 · CHAT-DEC-026).
 * Cửa sổ nổi góc dưới đã xoá; API `openRoom`/`closeRoom` giữ nguyên tên vì `done_when` của WO đó yêu
 * cầu, và đổi tên file chỉ để đổi một danh từ là một diff rác chạm mọi import.
 *
 * ⚠️ Store này KHÔNG giữ phòng và KHÔNG giữ tin. Nguồn dữ liệu duy nhất vẫn là `useChatStore` (FE-1) —
 * đó là điều làm cho lời hứa "drawer và trang /chat dùng CHUNG store, CHUNG một kết nối WS" đúng theo
 * nghĩa đen. Ở đây chỉ có hai câu hỏi thuần giao diện: drawer có đang mở không, và hội thoại nào đang
 * ở trong đó.
 *
 * BẤT BIẾN: mọi cập nhật tạo object MỚI (Zustand so sánh tham chiếu).
 */
import { create } from "zustand";

/**
 * Trần hội thoại mở cùng lúc — SPEC-15 §9 CHAT-SCREEN-002: **đúng MỘT hội thoại tại một thời điểm**.
 *
 * Đổi 2026-08-05 (quyết định của owner) từ 3 xuống 1. Lý do đo được trên máy thật: mỗi lần bấm một phòng
 * là THÊM một cửa sổ mà cửa sổ cũ vẫn nằm đó, nên dải dưới màn hình dồn thành nhiều khung hẹp — người
 * dùng đọc ra là "cứ bấm là mở thêm khung, không ẩn phần chat cũ". Trần 1 biến thao tác "mở phòng" thành
 * THAY CHỖ: luôn còn đúng một hội thoại trước mắt, không ai phải tự dọn cửa sổ thừa.
 *
 * Vẫn để dưới dạng hằng số (không hard-code `[roomId]` trong `openRoom`) vì đây là một CHÍNH SÁCH chứ
 * không phải một phép gán: mọi nhánh đẩy-cửa-sổ-cũ-ra bên dưới chạy theo con số này, nên đổi lại về >1
 * chỉ là đổi một chỗ — và bài test trần vẫn còn nguyên hiệu lực.
 *
 * Ràng buộc chi phí không đổi: mỗi cửa sổ mở là một `useChatConversation` đang chạy (một lưới bù tin 10
 * giây + một truy vấn chi tiết phòng), nên trần thấp hơn chỉ có lợi.
 */
export const MAX_DOCK_WINDOWS = 1;

interface ChatDockState {
  /**
   * S17-CHAT-UX2-FE-5 — drawer có đang mở không (CHAT-DEC-026).
   *
   * Trước FE-5, "có gì đó đang mở" SUY từ `openRoomIds.length > 0` — đúng với cửa sổ nổi, vì cửa sổ nổi
   * chỉ tồn tại khi có một phòng để hiện. Drawer thì KHÁC HẲN: nó mở ra ở chế độ DANH SÁCH, chưa chọn
   * phòng nào. Không có cờ riêng thì "mở drawer để tìm một phòng" là một trạng thái không biểu diễn
   * được, và người dùng buộc phải chọn phòng trước khi thấy được danh sách phòng.
   *
   * Hai trục ĐỘC LẬP, cố ý: đóng drawer KHÔNG xoá `openRoomIds` — mở lại là về đúng hội thoại đang đọc
   * dở (mirror hành vi "rời `/chat` là cửa sổ hiện lại nguyên vẹn" của dock cũ).
   */
  isOpen: boolean;
  /**
   * Hội thoại đang mở. Ở trần hiện tại (`MAX_DOCK_WINDOWS === 1`) mảng này dài tối đa MỘT phần tử.
   *
   * Vẫn là MẢNG chứ không phải `string | null`: thứ tự "mở gần đây nhất nằm CUỐI" là thứ luật đẩy cửa sổ
   * cũ ra dựa vào, và đổi kiểu ở đây sẽ bắt viết lại `openRoom`/`closeRoom` nếu trần được nới lại.
   */
  openRoomIds: readonly string[];
  /**
   * Mở (hoặc đưa ra trước mắt) một hội thoại.
   *
   * Đã mở sẵn ⇒ chỉ bật `isOpen`, GIỮ NGUYÊN mảng: đây là đường "bấm lại chính phòng đang đọc dở" sau
   * khi đã đóng drawer.
   *
   * Quá trần ⇒ đẩy cái CŨ NHẤT (index 0) ra, KHÔNG từ chối mở. Từ chối là một nút bấm không phản hồi:
   * người dùng vừa chọn một phòng và không có gì xảy ra, không lời giải thích. Ở trần 1, "đẩy cái cũ
   * nhất ra" chính là hành vi THAY CHỖ mà người dùng mong đợi — phòng vừa bấm chiếm khung, phòng trước
   * đó đóng lại.
   */
  openRoom: (roomId: string) => void;
  /**
   * Đóng một hội thoại. **KHÔNG đóng drawer** — quay về chế độ DANH SÁCH.
   *
   * Đổi kết cục ở S17-CHAT-UX2-FE-5: với cửa sổ nổi, đóng hội thoại = không còn gì trên màn hình nên
   * hai việc trùng nhau. Với drawer, "‹ quay lại" và "✕ đóng hẳn" là hai ý định khác nhau và người dùng
   * bấm ‹ nhiều hơn hẳn — trả họ về màn hình trống là bắt mở lại drawer sau mỗi lần liếc một phòng.
   */
  closeRoom: (roomId: string) => void;
  /** Mở drawer, giữ nguyên hội thoại đang có (nếu có). */
  openDrawer: () => void;
  /** Đóng drawer nhưng GIỮ `openRoomIds` — mở lại là về đúng chỗ đang đọc dở. */
  closeDrawer: () => void;
  /** Lối vào từ `ChatBadge`: bấm lần nữa là đóng. */
  toggleDrawer: () => void;
  /**
   * Dọn sạch — mirror `resetChatStore` của FE-1, và giống nó ở cả chỗ CHƯA có caller sản phẩm: đăng
   * xuất là hard navigation nên trình duyệt huỷ luôn cả tab (xem cleanup của `useChatRealtime`). Giữ
   * hàm này để test cô lập được giữa các ca, và để có sẵn đường dọn nếu về sau có đổi-phiên tại chỗ.
   */
  resetChatDock: () => void;
}

const createInitialState = () => ({
  isOpen: false,
  openRoomIds: [] as readonly string[],
});

export const useChatDockStore = create<ChatDockState>((set) => ({
  ...createInitialState(),

  openRoom: (roomId) =>
    set((state) => {
      if (state.openRoomIds.includes(roomId)) {
        // ⚠️ `isOpen: true` KHÔNG được bỏ qua ở nhánh này (S17-CHAT-UX2-FE-5). Trước đây nhánh "đã mở
        // sẵn" trả nguyên `state` khi không có gì đổi — vô hại với cửa sổ nổi, nhưng với drawer nó biến
        // `openRoom()` thành NO-OP đúng lúc người dùng bấm vào phòng họ đang mở dở: drawer đã đóng,
        // `openRoomIds` vẫn còn id đó, nên "mở phòng" không mở gì cả. Một nút bấm không phản hồi.
        return { isOpen: true };
      }

      const next = [...state.openRoomIds, roomId];
      if (next.length <= MAX_DOCK_WINDOWS) return { isOpen: true, openRoomIds: next };

      // Vượt trần: cắt phần đầu. Bị đẩy ra và tự đóng phải là CÙNG một kết cục — để lại hai loại tàn
      // dư khác nhau thì không ai lần được.
      //
      // Store này KHÔNG còn map phụ nào để dọn kèm: `resolvedNames` gỡ ở S17-CHAT-UX2-FE-1 (tên phòng
      // đến thẳng từ `GET /chat/rooms`), `minimizedRoomIds` gỡ ở S17-CHAT-UX2-FE-5 (drawer chỉ có
      // mở/đóng, không có "thu nhỏ"). Nhờ vậy "dọn sạch tàn dư" không còn là việc phải nhớ làm.
      return {
        isOpen: true,
        openRoomIds: next.slice(next.length - MAX_DOCK_WINDOWS),
      };
    }),

  openDrawer: () => set((state) => (state.isOpen ? state : { isOpen: true })),

  // GIỮ `openRoomIds`: xem docblock `isOpen`. Đóng drawer là cất nó đi, không phải rời phòng.
  closeDrawer: () => set((state) => (state.isOpen ? { isOpen: false } : state)),

  toggleDrawer: () => set((state) => ({ isOpen: !state.isOpen })),

  closeRoom: (roomId) =>
    set((state) => {
      if (!state.openRoomIds.includes(roomId)) return state;
      // `isOpen` KHÔNG đổi: đây là nút ‹ "quay lại danh sách", không phải nút đóng drawer.
      return { openRoomIds: state.openRoomIds.filter((id) => id !== roomId) };
    }),

  resetChatDock: () => set(createInitialState()),
}));
