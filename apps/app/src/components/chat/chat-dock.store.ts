/**
 * S7-CHAT-FE-3 — trạng thái UI của panel chat nổi (SPEC-15 §9 CHAT-SCREEN-002).
 *
 * ⚠️ Store này KHÔNG giữ phòng và KHÔNG giữ tin. Nguồn dữ liệu duy nhất vẫn là `useChatStore` (FE-1) —
 * đó là điều làm cho lời hứa "panel nổi và trang /chat dùng CHUNG store, CHUNG một kết nối WS" đúng
 * theo nghĩa đen. Ở đây chỉ có ba câu hỏi thuần giao diện: cửa sổ nào đang mở, cái nào đang thu nhỏ, và
 * phòng `direct` đó tên gì.
 *
 * BẤT BIẾN: mọi cập nhật tạo object MỚI (Zustand so sánh tham chiếu).
 */
import { create } from "zustand";

/**
 * Trần cửa sổ mở cùng lúc — SPEC-15 §9 CHAT-SCREEN-002: **đúng MỘT hội thoại tại một thời điểm**.
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
   * Hội thoại đang mở. Ở trần hiện tại (`MAX_DOCK_WINDOWS === 1`) mảng này dài tối đa MỘT phần tử.
   *
   * Vẫn là MẢNG chứ không phải `string | null`: thứ tự "mở gần đây nhất nằm CUỐI" là thứ luật đẩy cửa sổ
   * cũ ra dựa vào, và đổi kiểu ở đây sẽ bắt viết lại `openRoom`/`closeRoom` nếu trần được nới lại.
   */
  openRoomIds: readonly string[];
  minimizedRoomIds: Readonly<Record<string, true>>;
  /**
   * Tên hiển thị đã dựng của phòng `direct`, cache theo `roomId`.
   *
   * `GET /chat/rooms` KHÔNG kèm `members` và phòng `direct` không có `name` (mig 0538) ⇒ tên chỉ dựng
   * được sau khi mở phòng (`getRoom` trả `members[]`). Cache ở ĐÂY chứ không ở component để badge trên
   * header và cửa sổ dock gọi cùng một phòng bằng CÙNG một cái tên — hai nhãn khác nhau cho một người
   * là cách chắc chắn làm người dùng nhắn nhầm.
   *
   * Không có tên thì call-site dùng nhãn dự phòng mang mã phòng; TUYỆT ĐỐI không bịa tên.
   */
  resolvedNames: Readonly<Record<string, string>>;

  /**
   * Mở (hoặc đưa ra trước mắt) một hội thoại.
   *
   * Đã mở sẵn ⇒ chỉ BỎ thu nhỏ, GIỮ NGUYÊN vị trí: nhảy cửa sổ sang chỗ khác ngay lúc người dùng vừa
   * bấm vào nó làm con trỏ chuột trỏ vào một phòng khác so với thứ họ định mở.
   *
   * Quá trần ⇒ đẩy cái CŨ NHẤT (index 0) ra, KHÔNG từ chối mở. Từ chối là một nút bấm không phản hồi:
   * người dùng vừa chọn một phòng và không có gì xảy ra, không lời giải thích. Ở trần 1, "đẩy cái cũ
   * nhất ra" chính là hành vi THAY CHỖ mà người dùng mong đợi — phòng vừa bấm chiếm khung, phòng trước
   * đó đóng lại.
   */
  openRoom: (roomId: string) => void;
  closeRoom: (roomId: string) => void;
  toggleMinimize: (roomId: string) => void;
  setResolvedName: (roomId: string, name: string) => void;
  /**
   * Dọn sạch — mirror `resetChatStore` của FE-1, và giống nó ở cả chỗ CHƯA có caller sản phẩm: đăng
   * xuất là hard navigation nên trình duyệt huỷ luôn cả tab (xem cleanup của `useChatRealtime`). Giữ
   * hàm này để test cô lập được giữa các ca, và để có sẵn đường dọn nếu về sau có đổi-phiên tại chỗ.
   */
  resetChatDock: () => void;
}

const createInitialState = () => ({
  openRoomIds: [] as readonly string[],
  minimizedRoomIds: {} as Readonly<Record<string, true>>,
  resolvedNames: {} as Readonly<Record<string, string>>,
});

/** Gỡ một khoá khỏi map, trả về CHÍNH map cũ khi khoá không có (caller bỏ qua được `set()` thừa). */
function omitKey<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (map[key] === undefined) return map;
  const { [key]: _dropped, ...rest } = map;
  return rest;
}

export const useChatDockStore = create<ChatDockState>((set) => ({
  ...createInitialState(),

  openRoom: (roomId) =>
    set((state) => {
      if (state.openRoomIds.includes(roomId)) {
        // Đang thu nhỏ ⇒ bung ra. Đang mở sẵn ⇒ không có gì đổi, trả nguyên state để khỏi re-render.
        const minimizedRoomIds = omitKey(state.minimizedRoomIds, roomId);
        return minimizedRoomIds === state.minimizedRoomIds ? state : { minimizedRoomIds };
      }

      const next = [...state.openRoomIds, roomId];
      if (next.length <= MAX_DOCK_WINDOWS) return { openRoomIds: next };

      // Vượt trần: cắt phần đầu và dọn state của những cửa sổ vừa bị đẩy ra ĐÚNG NHƯ `closeRoom` — bị
      // đẩy ra và tự đóng là cùng một kết cục, để lại hai loại tàn dư khác nhau thì không ai lần được.
      //
      //  · cờ thu nhỏ: giữ lại ⇒ lần sau mở lại chính phòng ấy nó hiện ra ở trạng thái thu nhỏ của một
      //    phiên đã quên;
      //  · tên đã dựng: giữ lại ⇒ tích luỹ khoá chết suốt phiên. Ở trần 1, MỖI lần đổi phòng đều đi qua
      //    nhánh này (không còn là ca hiếm như hồi trần 3), nên rò rỉ ở đây là rò rỉ theo số lần bấm.
      const evicted = next.slice(0, next.length - MAX_DOCK_WINDOWS);
      let minimizedRoomIds = state.minimizedRoomIds;
      let resolvedNames = state.resolvedNames;
      for (const id of evicted) {
        minimizedRoomIds = omitKey(minimizedRoomIds, id);
        resolvedNames = omitKey(resolvedNames, id);
      }
      return {
        openRoomIds: next.slice(next.length - MAX_DOCK_WINDOWS),
        minimizedRoomIds,
        resolvedNames,
      };
    }),

  closeRoom: (roomId) =>
    set((state) => {
      if (!state.openRoomIds.includes(roomId)) return state;
      // Gỡ khỏi CẢ BA map. `resolvedNames` cũng đi theo: nó là bộ nhớ đệm của một cửa sổ đang mở, và
      // giữ nó lại sau khi đóng chỉ tích luỹ khoá chết suốt phiên (đóng/mở 200 phòng = 200 khoá).
      return {
        openRoomIds: state.openRoomIds.filter((id) => id !== roomId),
        minimizedRoomIds: omitKey(state.minimizedRoomIds, roomId),
        resolvedNames: omitKey(state.resolvedNames, roomId),
      };
    }),

  toggleMinimize: (roomId) =>
    set((state) => {
      if (!state.openRoomIds.includes(roomId)) return state; // không thu nhỏ được cửa sổ không tồn tại
      if (state.minimizedRoomIds[roomId]) {
        return { minimizedRoomIds: omitKey(state.minimizedRoomIds, roomId) };
      }
      return { minimizedRoomIds: { ...state.minimizedRoomIds, [roomId]: true as const } };
    }),

  setResolvedName: (roomId, name) =>
    set((state) => {
      // Tên rỗng KHÔNG được ghi đè tên đang có: nó biến nhãn phòng thành ô trắng, tệ hơn nhãn mã phòng.
      if (name.length === 0 || state.resolvedNames[roomId] === name) return state;
      return { resolvedNames: { ...state.resolvedNames, [roomId]: name } };
    }),

  resetChatDock: () => set(createInitialState()),
}));
