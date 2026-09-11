/**
 * S7-CHAT-FE-3 — store trạng thái panel nổi (trần 1 cửa sổ, đổi 2026-08-05).
 *
 * Bốn ca đáng test không phải "mở/đóng chạy được" mà là những chỗ hỏng IM LẶNG:
 *  (a) mở phòng KHÁC phải THAY CHỖ phòng đang mở, KHÔNG thêm khung thứ hai và cũng KHÔNG từ chối mở
 *      (từ chối = nút bấm không phản hồi) — đây chính là triệu chứng owner báo: "cứ bấm là mở thêm
 *      khung, không ẩn phần chat cũ";
 *
 * S17-CHAT-UX2-FE-5 đã XOÁ bốn ca cũ, tất cả vì cùng một lý do: sau khi `minimizedRoomIds` +
 * `toggleMinimize` bị gỡ (cửa sổ nổi có "thu nhỏ", drawer chỉ có mở/đóng), chúng KHÔNG CÒN KHẲNG ĐỊNH
 * GÌ mà ca khác chưa nói —
 *   · «mở lại phòng đang thu nhỏ thì bung ra» và «toggleMinimize không tạo state cho phòng chưa mở»:
 *     thao tác không còn tồn tại;
 *   · «THAY CHỖ để lại đúng bằng KHÔNG state» và «closeRoom dọn CẢ HAI map»: sau khi map phụ biến mất,
 *     cả hai thành bản sao của ca (a) ở trên và của ca «closeRoom = ‹ quay lại» bên dưới ⇒ xanh-RỖNG.
 * Phần drawer nằm ở `describe` thứ hai.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { MAX_DOCK_WINDOWS, useChatDockStore } from "./chat-dock.store";

const store = () => useChatDockStore.getState();

describe("chat-dock.store", () => {
  beforeEach(() => {
    store().resetChatDock();
  });

  it("chỉ MỘT hội thoại mở: bấm phòng khác THAY CHỖ phòng đang mở (không cộng dồn khung)", () => {
    expect(MAX_DOCK_WINDOWS).toBe(1);

    store().openRoom("a");
    expect(store().openRoomIds).toEqual(["a"]);

    store().openRoom("b");
    // "b" PHẢI có mặt (người dùng vừa bấm vào nó) và "a" PHẢI biến mất — không có khung thứ hai.
    expect(store().openRoomIds).toEqual(["b"]);

    store().openRoom("c");
    expect(store().openRoomIds).toEqual(["c"]);
    expect(store().openRoomIds).toHaveLength(MAX_DOCK_WINDOWS);
  });

  it("resetChatDock trả về trạng thái khởi tạo", () => {
    store().openRoom("a");

    store().resetChatDock();
    expect(store().openRoomIds).toEqual([]);
    expect(store().isOpen).toBe(false);
  });

  /**
   * S17-CHAT-UX2-FE-1 — ratchet: `chat-dock.store` **không được** mọc lại một cache tên phòng.
   *
   * Nó từng có (`resolvedNames` + `setResolvedName`) và đã gỡ vì `room.peer.name` đến thẳng từ
   * `GET /chat/rooms`. Ca này ĐỎ nếu ai đó thêm lại một map thứ ba — thứ chỉ hỏng khi hai nhãn của cùng
   * một người lệch nhau, tức là ở đúng chỗ không ai nhìn.
   */
  it("KHÔNG có cache tên phòng nào trong store (đã gỡ ở S17-CHAT-UX2-FE-1)", () => {
    const keys = Object.keys(store());
    expect(keys).not.toContain("resolvedNames");
    expect(keys).not.toContain("setResolvedName");
  });
});

/**
 * S17-CHAT-UX2-FE-5 — `isOpen`: drawer mở/đóng, ĐỘC LẬP với "đang mở hội thoại nào" (CHAT-DEC-026).
 *
 * Ba chỗ hỏng im lặng nếu hai trục này bị trộn làm một:
 *  (a) drawer phải mở được ở chế độ DANH SÁCH — trạng thái mà cửa sổ nổi không có;
 *  (b) bấm ‹ (`closeRoom`) là QUAY LẠI danh sách, không phải đóng cả drawer;
 *  (c) `openRoom` trên phòng ĐANG nằm sẵn trong `openRoomIds` vẫn phải mở drawer — nhánh này trước đây
 *      `return state` và sẽ thành một nút bấm không phản hồi.
 */
describe("chat-dock.store — drawer (S17-CHAT-UX2-FE-5)", () => {
  beforeEach(() => {
    store().resetChatDock();
  });

  it("mặc định drawer ĐÓNG và chưa có hội thoại nào", () => {
    expect(store().isOpen).toBe(false);
    expect(store().openRoomIds).toEqual([]);
  });

  it("openDrawer mở ở chế độ DANH SÁCH — không tự chọn phòng nào", () => {
    store().openDrawer();
    expect(store().isOpen).toBe(true);
    // Vế thứ hai mới là vế đáng giá: trộn hai trục thì "mở drawer" sẽ phải kèm một roomId nào đó.
    expect(store().openRoomIds).toEqual([]);
  });

  it("toggleDrawer đảo trạng thái (lối vào từ ChatBadge)", () => {
    store().toggleDrawer();
    expect(store().isOpen).toBe(true);
    store().toggleDrawer();
    expect(store().isOpen).toBe(false);
  });

  it("openRoom MỞ LUÔN drawer (bấm phòng từ badge không cần hai bước)", () => {
    store().openRoom("a");
    expect(store().isOpen).toBe(true);
    expect(store().openRoomIds).toEqual(["a"]);
  });

  it("openRoom trên phòng ĐANG mở sẵn vẫn bật isOpen (chống nút bấm không phản hồi)", () => {
    store().openRoom("a");
    store().closeDrawer();
    expect(store().isOpen).toBe(false);
    expect(store().openRoomIds).toEqual(["a"]); // phòng vẫn còn đó — đúng chỗ nhánh cũ `return state`

    store().openRoom("a");
    expect(store().isOpen).toBe(true);
  });

  it("closeRoom = ‹ quay lại danh sách: gỡ hội thoại nhưng drawer VẪN mở", () => {
    store().openRoom("a");
    store().closeRoom("a");

    expect(store().openRoomIds).toEqual([]);
    // Thiếu vế này thì "đóng sạch cả drawer" cũng xanh — mà đó là hành vi CŨ của cửa sổ nổi.
    expect(store().isOpen).toBe(true);
  });

  it("closeDrawer GIỮ hội thoại đang mở (mở lại là về đúng chỗ đang đọc dở)", () => {
    store().openRoom("a");
    store().closeDrawer();

    expect(store().isOpen).toBe(false);
    expect(store().openRoomIds).toEqual(["a"]);

    store().openDrawer();
    expect(store().openRoomIds).toEqual(["a"]);
  });

  it("resetChatDock dọn CẢ isOpen", () => {
    store().openRoom("a");
    store().resetChatDock();

    expect(store().isOpen).toBe(false);
    expect(store().openRoomIds).toEqual([]);
  });
});
