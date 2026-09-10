/**
 * S7-CHAT-FE-3 — store trạng thái panel nổi (trần 1 cửa sổ, đổi 2026-08-05).
 *
 * Bốn ca đáng test không phải "mở/đóng chạy được" mà là những chỗ hỏng IM LẶNG:
 *  (a) mở phòng KHÁC phải THAY CHỖ phòng đang mở, KHÔNG thêm khung thứ hai và cũng KHÔNG từ chối mở
 *      (từ chối = nút bấm không phản hồi) — đây chính là triệu chứng owner báo: "cứ bấm là mở thêm
 *      khung, không ẩn phần chat cũ";
 *  (b) mở lại phòng đang thu nhỏ phải BUNG nó ra, chứ không "đã có rồi, thôi";
 *  (c) `closeRoom` phải dọn CẢ ba map — sót một cái là phòng mở lại hiện ra ở trạng thái thu nhỏ của
 *      lần trước, hoặc mang tên của một phiên đã quên;
 *  (d) cửa sổ bị THAY CHỖ phải để lại đúng bằng KHÔNG state như khi bị đóng tay (cùng lý do (c)) — ở
 *      trần 1 nhánh này chạy mỗi lần đổi phòng, nên sót một map là rò rỉ theo số lần bấm.
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

  it("mở lại CHÍNH phòng đang thu nhỏ thì bung ra, không đóng-mở lại", () => {
    store().openRoom("a");
    store().toggleMinimize("a");
    expect(store().minimizedRoomIds.a).toBe(true);

    store().openRoom("a");
    expect(store().minimizedRoomIds.a).toBeUndefined();
    // Vẫn là cùng một cửa sổ: không đi qua nhánh thay-chỗ nên tin/nháp đang có không bị dựng lại.
    expect(store().openRoomIds).toEqual(["a"]);
  });

  // S17-CHAT-UX2-FE-1 — trước đây là "CẢ BA map"; `resolvedNames` đã gỡ khỏi store (tên DM nay đến
  // thẳng từ `room.peer.name`). Ca GIỮ NGUYÊN mục đích: đóng cửa sổ không được để lại tàn dư nào.
  it("closeRoom dọn CẢ HAI map (openRoomIds · minimized)", () => {
    store().openRoom("a");
    store().toggleMinimize("a");
    expect(store().minimizedRoomIds.a).toBe(true);

    store().closeRoom("a");
    expect(store().openRoomIds).toEqual([]);
    expect(store().minimizedRoomIds.a).toBeUndefined();
  });

  it("cửa sổ bị THAY CHỖ để lại đúng bằng KHÔNG state (như khi đóng tay)", () => {
    store().openRoom("a");
    store().toggleMinimize("a");

    store().openRoom("b"); // "a" bị thay chỗ

    expect(store().openRoomIds).toEqual(["b"]);
    // Sót cờ này thì mở lại "a" sẽ hiện ra ở trạng thái thu nhỏ, không ai hiểu vì sao.
    expect(store().minimizedRoomIds.a).toBeUndefined();
  });

  it("toggleMinimize KHÔNG tạo trạng thái cho phòng chưa mở", () => {
    store().toggleMinimize("khong-mo");
    expect(store().minimizedRoomIds).toEqual({});
    expect(store().openRoomIds).toEqual([]);
  });

  it("resetChatDock trả về trạng thái khởi tạo", () => {
    store().openRoom("a");
    store().toggleMinimize("a");

    store().resetChatDock();
    expect(store().openRoomIds).toEqual([]);
    expect(store().minimizedRoomIds).toEqual({});
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
