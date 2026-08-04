/**
 * S7-CHAT-FE-3 — store trạng thái panel nổi.
 *
 * Bốn ca đáng test không phải "mở/đóng chạy được" mà là những chỗ hỏng IM LẶNG:
 *  (a) mở phòng thứ 4 phải ĐẨY cái cũ nhất ra, KHÔNG từ chối (từ chối = nút bấm không phản hồi);
 *  (b) mở lại phòng đang thu nhỏ phải BUNG nó ra, chứ không "đã có rồi, thôi";
 *  (c) `closeRoom` phải dọn CẢ ba map — sót một cái là phòng mở lại hiện ra ở trạng thái thu nhỏ của
 *      lần trước, hoặc mang tên của một phiên đã quên;
 *  (d) cửa sổ bị đẩy ra vì quá trần cũng phải bị dọn cờ thu nhỏ (cùng lý do (c)).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { MAX_DOCK_WINDOWS, useChatDockStore } from "./chat-dock.store";

const store = () => useChatDockStore.getState();

describe("chat-dock.store", () => {
  beforeEach(() => {
    store().resetChatDock();
  });

  it("mở tối đa 3 hội thoại, phòng thứ 4 đẩy cái CŨ NHẤT ra (không từ chối)", () => {
    store().openRoom("a");
    store().openRoom("b");
    store().openRoom("c");
    expect(store().openRoomIds).toEqual(["a", "b", "c"]);
    expect(store().openRoomIds).toHaveLength(MAX_DOCK_WINDOWS);

    store().openRoom("d");
    // "d" PHẢI có mặt — người dùng vừa bấm vào nó.
    expect(store().openRoomIds).toEqual(["b", "c", "d"]);
  });

  it("mở lại phòng ĐANG THU NHỎ thì bung ra và GIỮ NGUYÊN vị trí", () => {
    store().openRoom("a");
    store().openRoom("b");
    store().toggleMinimize("a");
    expect(store().minimizedRoomIds.a).toBe(true);

    store().openRoom("a");
    expect(store().minimizedRoomIds.a).toBeUndefined();
    // Không nhảy sang cuối: cửa sổ đổi chỗ ngay lúc bấm làm con trỏ trỏ vào phòng khác.
    expect(store().openRoomIds).toEqual(["a", "b"]);
  });

  it("closeRoom dọn CẢ ba map (openRoomIds · minimized · resolvedNames)", () => {
    store().openRoom("a");
    store().toggleMinimize("a");
    store().setResolvedName("a", "Nguyễn Văn A");
    expect(store().resolvedNames.a).toBe("Nguyễn Văn A");

    store().closeRoom("a");
    expect(store().openRoomIds).toEqual([]);
    expect(store().minimizedRoomIds.a).toBeUndefined();
    expect(store().resolvedNames.a).toBeUndefined();
  });

  it("cửa sổ bị đẩy ra vì quá trần cũng bị dọn cờ thu nhỏ", () => {
    store().openRoom("a");
    store().toggleMinimize("a");
    store().openRoom("b");
    store().openRoom("c");
    store().openRoom("d"); // đẩy "a" ra

    expect(store().openRoomIds).not.toContain("a");
    // Sót cờ này thì mở lại "a" sẽ hiện ra ở trạng thái thu nhỏ, không ai hiểu vì sao.
    expect(store().minimizedRoomIds.a).toBeUndefined();
  });

  it("toggleMinimize KHÔNG tạo trạng thái cho phòng chưa mở", () => {
    store().toggleMinimize("khong-mo");
    expect(store().minimizedRoomIds).toEqual({});
    expect(store().openRoomIds).toEqual([]);
  });

  it("setResolvedName bỏ qua tên RỖNG (không biến nhãn phòng thành ô trắng)", () => {
    store().openRoom("a");
    store().setResolvedName("a", "Trần Thị B");
    store().setResolvedName("a", "");
    expect(store().resolvedNames.a).toBe("Trần Thị B");
  });

  it("resetChatDock trả về trạng thái khởi tạo", () => {
    store().openRoom("a");
    store().toggleMinimize("a");
    store().setResolvedName("a", "X");

    store().resetChatDock();
    expect(store().openRoomIds).toEqual([]);
    expect(store().minimizedRoomIds).toEqual({});
    expect(store().resolvedNames).toEqual({});
  });
});
