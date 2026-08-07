/**
 * S7-CHAT-FE-2 — RoomListPanel (cột trái).
 *
 * Ca quan trọng nhất không phải "vẽ đúng danh sách" mà là hai điều dễ hỏng im lặng:
 *  (a) rổ **đã lưu trữ** phải `syncRoomList(rooms, TRUE)` — truyền `false` sẽ GỠ SẠCH phòng chưa lưu trữ
 *      khỏi store chỉ vì payload này không chứa chúng;
 *  (b) nút tạo phòng hỏi ĐÚNG cặp `create:chat-room`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const listRooms = vi.fn();
const pinRoom = vi.fn();
const unpinRoom = vi.fn();
const muteRoom = vi.fn();
const markRoomUnread = vi.fn();
const archiveRoom = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      listRooms: (...a: unknown[]) => listRooms(...a),
      pinRoom: (...a: unknown[]) => pinRoom(...a),
      unpinRoom: (...a: unknown[]) => unpinRoom(...a),
      muteRoom: (...a: unknown[]) => muteRoom(...a),
      markRoomUnread: (...a: unknown[]) => markRoomUnread(...a),
      archiveRoom: (...a: unknown[]) => archiveRoom(...a),
    },
  };
});

import { ApiError, useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { RoomListPanel } from "./RoomListPanel";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function renderPanel(props: Partial<Parameters<typeof RoomListPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelectRoom = props.onSelectRoom ?? vi.fn();
  const onCreateRoom = props.onCreateRoom ?? vi.fn();
  const onOpenSearch = props.onOpenSearch ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomListPanel
          selectedRoomId={null}
          resolvedNames={{}}
          isBootstrapping={false}
          {...props}
          onSelectRoom={onSelectRoom}
          onCreateRoom={onCreateRoom}
          onOpenSearch={onOpenSearch}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onSelectRoom, onCreateRoom, onOpenSearch };
}

beforeEach(() => {
  listRooms.mockReset();
  listRooms.mockResolvedValue([]);
  for (const fn of [pinRoom, unpinRoom, muteRoom, markRoomUnread, archiveRoom]) fn.mockReset();
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  useChatStore.getState().resetChatStore();
});

describe("RoomListPanel · danh sách + badge chưa đọc", () => {
  it("vẽ phòng theo thứ tự của store và hiện badge do SERVER tính", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("a", { unreadCount: 3, lastMessageAt: "2026-08-04T09:00:00.000Z" }),
        room("b", { unreadCount: 0, lastMessageAt: "2026-08-04T11:00:00.000Z" }),
      ]);
    renderPanel();

    const items = screen.getAllByTestId("chat-room-item");
    expect(items).toHaveLength(2);
    // `lastMessageAt` giảm dần ⇒ phòng b trước.
    expect(items[0].textContent).toContain("Phòng b");
    expect(screen.getByLabelText("3 tin chưa đọc")).toBeTruthy();
  });

  it("badge > 99 hiển thị '99+' (không phá layout hàng)", () => {
    useChatStore.getState().hydrateRooms([room("a", { unreadCount: 250 })]);
    renderPanel();
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("bấm một phòng ⇒ gọi onSelectRoom với đúng id", () => {
    useChatStore.getState().hydrateRooms([room("a")]);
    const { onSelectRoom } = renderPanel();
    fireEvent.click(screen.getAllByTestId("chat-room-item")[0]);
    expect(onSelectRoom).toHaveBeenCalledWith("a");
  });

  it("phòng direct chưa dựng được tên ⇒ nhãn MÃ PHÒNG, không bịa tên", () => {
    useChatStore.getState().hydrateRooms([room("a", { roomType: "direct", name: null })]);
    renderPanel();
    expect(screen.getByText(/CHAT-a/)).toBeTruthy();
  });

  it("có `resolvedNames` ⇒ dùng tên đã dựng", () => {
    useChatStore.getState().hydrateRooms([room("a", { roomType: "direct", name: null })]);
    renderPanel({ resolvedNames: { a: "Nguyễn Văn A" } });
    expect(screen.getByText("Nguyễn Văn A")).toBeTruthy();
  });
});

describe("RoomListPanel · tìm + rổ lưu trữ", () => {
  it("lọc theo tên/mã ở client; không khớp ⇒ nói rõ từ khoá", () => {
    useChatStore
      .getState()
      .hydrateRooms([room("a", { name: "Kế toán" }), room("b", { name: "Kỹ thuật" })]);
    renderPanel();

    fireEvent.change(screen.getByLabelText("Tìm phòng theo tên hoặc mã"), {
      target: { value: "kế" },
    });
    expect(screen.getAllByTestId("chat-room-item")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Tìm phòng theo tên hoặc mã"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/không có phòng nào khớp “zzz”/i)).toBeTruthy();
  });

  it("bật rổ lưu trữ ⇒ gọi listRooms({archived:true}) và syncRoomList KHÔNG gỡ phòng đang hoạt động", async () => {
    useChatStore.getState().hydrateRooms([room("live", { isArchived: false })]);
    listRooms.mockResolvedValue([room("old", { isArchived: true })]);
    renderPanel();

    fireEvent.click(screen.getByText("Xem phòng đã lưu trữ"));

    await waitFor(() => expect(listRooms).toHaveBeenCalledWith({ archived: true }));
    // Phòng đang hoạt động PHẢI còn trong store — nếu bị gỡ, quay lại rổ thường sẽ trống trơn.
    await waitFor(() => expect(useChatStore.getState().roomsById["live"]).toBeDefined());
    await waitFor(() => expect(screen.getAllByTestId("chat-room-item")).toHaveLength(1));
    expect(screen.getAllByTestId("chat-room-item")[0].textContent).toContain("Phòng old");
  });

  it("rổ lưu trữ rỗng ⇒ thông điệp riêng, không dùng lại chữ của rổ thường", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Xem phòng đã lưu trữ"));
    expect(await screen.findByText("Không có phòng nào đã lưu trữ.")).toBeTruthy();
  });
});

/**
 * S8-CHAT-UX-FE-1 — chia mục theo loại phòng (CHAT-DEC-013).
 *
 * Luật chia rổ đã có test riêng trên DỮ LIỆU ở `room-list-sections.spec.ts`. Ở đây chỉ kiểm những thứ
 * chỉ DOM mới trả lời được: đếm NODE thật (không phải "code render 1 element"), thu/mở, và dấu vết tin
 * chưa đọc khi mục bị thu.
 */
describe("RoomListPanel · chia mục theo loại phòng", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  function seedFourTypes() {
    useChatStore
      .getState()
      .hydrateRooms([
        room("d1", { roomType: "direct", name: null, unreadCount: 2 }),
        room("g1", { roomType: "group", unreadCount: 5 }),
        room("dep1", { roomType: "department" }),
        room("p1", { roomType: "project" }),
      ]);
  }

  it("vẽ MỘT mục cho mỗi loại phòng có mặt, theo thứ tự Riêng → Nhóm → Phòng ban → Dự án", () => {
    seedFourTypes();
    renderPanel();

    const sections = screen.getAllByTestId("chat-room-section");
    expect(sections.map((s) => s.getAttribute("data-section"))).toEqual([
      "direct",
      "group",
      "department",
      "project",
    ]);
  });

  it("mục KHÔNG có phòng nào thì KHÔNG vẽ tiêu đề trống", () => {
    useChatStore.getState().hydrateRooms([room("g1", { roomType: "group" })]);
    renderPanel();

    expect(
      screen.getAllByTestId("chat-room-section").map((s) => s.getAttribute("data-section")),
    ).toEqual(["group"]);
  });

  it("mỗi phòng có ĐÚNG MỘT node trong DOM — chia mục không nhân bản dòng", () => {
    seedFourTypes();
    renderPanel();

    // ĐẾM NODE, không đếm phần tử React: hai anh em cùng `key` render ra hai node mà React không hề
    // cảnh báo (memory duplicate-sibling-key-leaks-dom-node).
    const items = screen.getAllByTestId("chat-room-item");
    expect(items).toHaveLength(4);
    const labels = items.map((el) => el.textContent);
    expect(new Set(labels).size).toBe(4);
  });

  it("bấm tiêu đề mục ⇒ THU mục đó, các phòng của nó rời khỏi DOM; mục khác không đổi", () => {
    seedFourTypes();
    renderPanel();

    const groupToggle = screen
      .getAllByTestId("chat-room-section-toggle")
      .find((b) => b.textContent?.includes("Nhóm"))!;
    fireEvent.click(groupToggle);

    expect(screen.getAllByTestId("chat-room-item")).toHaveLength(3);
    expect(screen.queryByText("Phòng g1")).toBeNull();
    expect(screen.getByText("Phòng dep1")).toBeTruthy();
  });

  it("mục ĐANG THU vẫn hiện tổng tin chưa đọc — thu lại không được làm mất dấu vết", () => {
    seedFourTypes();
    renderPanel();

    fireEvent.click(
      screen
        .getAllByTestId("chat-room-section-toggle")
        .find((b) => b.textContent?.includes("Nhóm"))!,
    );

    expect(screen.getByLabelText("5 tin chưa đọc trong mục Nhóm")).toBeTruthy();
  });

  it("aria-expanded phản ánh đúng trạng thái thu/mở", () => {
    seedFourTypes();
    renderPanel();

    const toggle = screen
      .getAllByTestId("chat-room-section-toggle")
      .find((b) => b.textContent?.includes("Nhóm"))!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(
      screen
        .getAllByTestId("chat-room-section-toggle")
        .find((b) => b.textContent?.includes("Nhóm"))!
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("trạng thái thu được NHỚ qua lần mở lại (localStorage)", () => {
    seedFourTypes();
    const first = renderPanel();
    expect(first).toBeTruthy();
    fireEvent.click(
      screen
        .getAllByTestId("chat-room-section-toggle")
        .find((b) => b.textContent?.includes("Nhóm"))!,
    );
    cleanup();

    renderPanel();
    expect(screen.queryByText("Phòng g1")).toBeNull();
    expect(screen.getAllByTestId("chat-room-item")).toHaveLength(3);
  });

  it("ĐANG LỌC thì mở hết — kết quả khớp không được nằm trong mục đã thu từ trước", () => {
    seedFourTypes();
    renderPanel();

    fireEvent.click(
      screen
        .getAllByTestId("chat-room-section-toggle")
        .find((b) => b.textContent?.includes("Nhóm"))!,
    );
    expect(screen.queryByText("Phòng g1")).toBeNull();

    fireEvent.change(screen.getByLabelText("Tìm phòng theo tên hoặc mã"), {
      target: { value: "g1" },
    });

    expect(screen.getByText("Phòng g1")).toBeTruthy();
    // Chỉ mục CÓ kết quả mới hiện.
    expect(screen.getAllByTestId("chat-room-section")).toHaveLength(1);
  });

  it("không phòng nào ghim ⇒ KHÔNG vẽ mục 'Đã ghim' (mục rỗng không có tiêu đề)", () => {
    seedFourTypes();
    renderPanel();

    expect(
      screen.getAllByTestId("chat-room-section").map((s) => s.getAttribute("data-section")),
    ).not.toContain("pinned");
  });

  it("có `pinnedAt` ⇒ mục 'Đã ghim' đứng ĐẦU và phòng đó rời khỏi mục loại của nó", () => {
    seedFourTypes();
    useChatStore.getState().patchRoomPrefs("g1", { pinnedAt: "2026-08-07T01:00:00.000Z" });
    renderPanel();

    const keys = screen
      .getAllByTestId("chat-room-section")
      .map((s) => s.getAttribute("data-section"));
    expect(keys[0]).toBe("pinned");
    expect(keys).not.toContain("group"); // g1 là phòng `group` DUY NHẤT ⇒ mục group rỗng, bị loại
    // Vẫn đúng 4 dòng: ghim là CHUYỂN mục, không phải nhân bản (memory duplicate-sibling-key-leaks-dom-node).
    expect(screen.getAllByTestId("chat-room-item")).toHaveLength(4);
  });
});

/**
 * S8-CHAT-UX-FE-2 — menu ngữ cảnh + dấu hiệu trên dòng.
 *
 * Ca đáng tiền ở đây là **hoàn nguyên**: cập nhật lạc quan mà lỗi lại im lặng thì người dùng thấy phòng
 * nhảy lên mục "Đã ghim" rồi nhảy về, không một chữ giải thích — và không test nào khác bắt được.
 */
describe("RoomListPanel · menu ngữ cảnh mỗi hội thoại", () => {
  function seedOne(over: Partial<ChatRoomDto> = {}) {
    useChatStore.getState().hydrateRooms([room("a", over)]);
  }

  it("mở được bằng NÚT `…` — lối bàn phím, không chỉ chuột phải", () => {
    seedOne();
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));

    expect(screen.getByTestId("chat-room-menu-pin")).toBeTruthy();
    expect(screen.getByTestId("chat-room-menu-unread")).toBeTruthy();
  });

  it("mở được bằng CHUỘT PHẢI trên hàng (lối tắt, có cả hai)", () => {
    seedOne();
    renderPanel();

    fireEvent.contextMenu(screen.getByTestId("chat-room-item"));

    expect(screen.getByTestId("chat-room-menu-pin")).toBeTruthy();
  });

  it("ghim: cập nhật LẠC QUAN ngay, rồi nhận giá trị server trả", async () => {
    seedOne();
    pinRoom.mockResolvedValue(room("a", { pinnedAt: "2026-08-07T03:00:00.000Z" }));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-pin"));

    // Lạc quan: store có mốc TRƯỚC khi promise resolve.
    expect(useChatStore.getState().roomsById["a"].pinnedAt).not.toBeNull();
    await waitFor(() => expect(pinRoom).toHaveBeenCalledWith("a"));
    await waitFor(() =>
      expect(useChatStore.getState().roomsById["a"].pinnedAt).toBe("2026-08-07T03:00:00.000Z"),
    );
  });

  it("ghim LỖI ⇒ HOÀN NGUYÊN về giá trị trước + báo lỗi (không im lặng)", async () => {
    seedOne({ pinnedAt: null });
    pinRoom.mockRejectedValue(new Error("mạng chập"));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-pin"));

    await waitFor(() => expect(useChatStore.getState().roomsById["a"].pinnedAt).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("trở về như cũ");
  });

  it("vượt trần 10 ghim (409 CHAT-ERR-021) ⇒ thông điệp NÊU RÕ số 10, không phải lỗi chung", async () => {
    seedOne({ pinnedAt: null });
    pinRoom.mockRejectedValue(new ApiError(409, "CHAT-ERR-021", "vượt trần ghim"));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-pin"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("10");
    expect(alert.textContent).toContain("bỏ ghim bớt");
    await waitFor(() => expect(useChatStore.getState().roomsById["a"].pinnedAt).toBeNull());
  });

  it("phòng ĐANG GHIM ⇒ mục menu là 'Bỏ ghim' và gọi unpinRoom", async () => {
    seedOne({ pinnedAt: "2026-08-07T01:00:00.000Z" });
    unpinRoom.mockResolvedValue(room("a", { pinnedAt: null }));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    expect(screen.getByTestId("chat-room-menu-pin").textContent).toContain("Bỏ ghim");
    fireEvent.click(screen.getByTestId("chat-room-menu-pin"));

    await waitFor(() => expect(unpinRoom).toHaveBeenCalledWith("a"));
    expect(pinRoom).not.toHaveBeenCalled();
  });

  it("tắt thông báo: gửi MỐC TƯƠNG LAI (server chuẩn hoá mốc đã qua về null)", async () => {
    seedOne();
    muteRoom.mockResolvedValue(room("a", { mutedUntil: "2099-01-01T00:00:00.000Z" }));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-mute-8h"));

    await waitFor(() => expect(muteRoom).toHaveBeenCalled());
    const [roomId, body] = muteRoom.mock.calls[0] as [string, { mutedUntil: string }];
    expect(roomId).toBe("a");
    expect(Date.parse(body.mutedUntil)).toBeGreaterThan(Date.now());
  });

  it("phòng ĐANG TẮT ⇒ menu chỉ mời 'Bật lại' và gửi mutedUntil = null", async () => {
    seedOne({ mutedUntil: "2099-01-01T00:00:00.000Z" });
    muteRoom.mockResolvedValue(room("a", { mutedUntil: null }));
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    expect(screen.queryByTestId("chat-room-menu-mute-1h")).toBeNull();
    fireEvent.click(screen.getByTestId("chat-room-menu-unmute"));

    await waitFor(() => expect(muteRoom).toHaveBeenCalledWith("a", { mutedUntil: null }));
  });

  it("đánh dấu chưa đọc: KHÔNG bịa thêm badge — chỉ đặt cờ", async () => {
    seedOne({ unreadCount: 0 });
    markRoomUnread.mockResolvedValue(
      room("a", { unreadCount: 0, markedUnreadAt: "2026-08-07T03:00:00.000Z" }),
    );
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-unread"));

    await waitFor(() => expect(markRoomUnread).toHaveBeenCalledWith("a"));
    await waitFor(() =>
      expect(useChatStore.getState().roomsById["a"].markedUnreadAt).not.toBeNull(),
    );
    // Badge KHÔNG được tự tăng: server cố ý giữ nguyên `unreadCount` (con trỏ chỉ-tiến, SPEC-15 §13.2).
    expect(useChatStore.getState().roomsById["a"].unreadCount).toBe(0);
    expect(screen.queryByLabelText(/tin chưa đọc$/)).toBeNull();
  });

  it("mục 'Lưu trữ phòng' chỉ hiện khi có cặp `archive:chat-room`", () => {
    seedOne();
    mockUseCan.mockImplementation((action: string) => action !== "archive");
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));

    expect(screen.queryByTestId("chat-room-menu-archive")).toBeNull();
    // Ba mục tuỳ chọn CÁ NHÂN vẫn còn — chúng KHÔNG đứng sau cặp quản trị nào.
    expect(screen.getByTestId("chat-room-menu-pin")).toBeTruthy();
    expect(screen.getByTestId("chat-room-menu-unread")).toBeTruthy();
    expect(screen.getByTestId("chat-room-menu-mute-1h")).toBeTruthy();
  });
});

describe("RoomListPanel · avatar + dấu hiệu trên dòng", () => {
  it("mỗi dòng có ĐÚNG MỘT avatar — đếm NODE, không đếm phần tử React", () => {
    useChatStore
      .getState()
      .hydrateRooms([room("a"), room("b", { lastMessageAt: "2026-08-04T09:00:00.000Z" })]);
    renderPanel();

    expect(screen.getAllByTestId("chat-room-avatar")).toHaveLength(2);
  });

  it("có `avatarUrl` ⇒ render ảnh; không có ⇒ chữ cái đầu (không vỡ dòng vì thiếu ảnh)", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("a", { name: "Kế toán", avatarUrl: "https://storage.example/signed/a.png" }),
        room("b", { name: "Kỹ thuật", avatarUrl: null }),
      ]);
    renderPanel();

    const avatars = screen.getAllByTestId("chat-room-avatar");
    expect(avatars.some((el) => el.querySelector("img") !== null)).toBe(true);
    expect(avatars.some((el) => el.querySelector("img") === null)).toBe(true);
  });

  it("đang tắt thông báo ⇒ chuông-gạch NGAY TRÊN DÒNG (không phải chỉ trong menu)", () => {
    useChatStore.getState().hydrateRooms([room("a", { mutedUntil: "2099-01-01T00:00:00.000Z" })]);
    renderPanel();

    expect(screen.getByTestId("chat-room-muted-icon")).toBeTruthy();
    expect(screen.getByLabelText("Đang tắt thông báo")).toBeTruthy();
  });

  it("mốc tắt ĐÃ QUA (hết hạn trong cache) ⇒ KHÔNG vẽ chuông-gạch", () => {
    useChatStore.getState().hydrateRooms([room("a", { mutedUntil: "2020-01-01T00:00:00.000Z" })]);
    renderPanel();

    expect(screen.queryByTestId("chat-room-muted-icon")).toBeNull();
  });

  it("đánh dấu chưa đọc thủ công ⇒ dòng hiện ĐẬM dù badge = 0", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("a", { name: "Kế toán", unreadCount: 0, markedUnreadAt: "2026-08-07T03:00:00.000Z" }),
      ]);
    renderPanel();

    expect(screen.getByText("Kế toán").className).toContain("font-semibold");
  });
});

describe("RoomListPanel · cổng quyền", () => {
  it("nút tạo phòng hỏi ĐÚNG cặp `create:chat-room`", () => {
    renderPanel();
    expect(mockUseCan).toHaveBeenCalledWith("create", "chat-room");
  });

  it("thiếu `create:chat-room` ⇒ KHÔNG hiện nút tạo (và gợi ý 'bấm Tin nhắn mới' cũng biến mất)", () => {
    mockUseCan.mockReturnValue(false);
    renderPanel();
    expect(screen.queryByLabelText("Tạo cuộc trò chuyện mới")).toBeNull();
    expect(screen.queryByText(/Bấm “Tin nhắn mới”/)).toBeNull();
  });
});
