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
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: { ...actual.chatApi, listRooms: (...a: unknown[]) => listRooms(...a) },
  };
});

import { useCan } from "@mediaos/web-core";
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

  it("chưa có cột pinned_at ⇒ KHÔNG vẽ mục 'Đã ghim' (không bịa mục ma)", () => {
    seedFourTypes();
    renderPanel();

    expect(
      screen.getAllByTestId("chat-room-section").map((s) => s.getAttribute("data-section")),
    ).not.toContain("pinned");
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
