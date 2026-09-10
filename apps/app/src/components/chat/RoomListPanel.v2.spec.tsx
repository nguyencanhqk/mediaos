/**
 * S17-CHAT-UX2-FE-1 — RoomListPanel **v2**: chip lọc nhanh + dòng phòng 56px.
 *
 * File RIÊNG chứ không nối vào `RoomListPanel.spec.tsx` (đã 35 ca): cùng khuôn với
 * `MessageList.grouping.spec.tsx` / `MessageComposer.typing.spec.tsx` — mỗi mặt hành vi một file, đọc
 * được mà không phải cuộn qua ba khối không liên quan.
 *
 * Luật chia rổ của chip đã có test trên DỮ LIỆU ở `room-list-filter.spec.ts`. Ở đây chỉ kiểm thứ chỉ
 * DOM mới trả lời được: chip nào vẽ MỤC, chip nào vẽ danh sách PHẲNG, và số NODE thật của mỗi phòng —
 * hai node cùng `key` ở hai `<ul>` anh em KHÔNG sinh cảnh báo nào (memory
 * `duplicate-sibling-key-leaks-dom-node`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { useChatStore } from "@/stores/chat.store";
import { RoomListPanel } from "./RoomListPanel";

const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: COMPANY,
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

function peer(over: Partial<NonNullable<ChatRoomDto["peer"]>> = {}): ChatRoomDto["peer"] {
  return { userId: PEER_ID, name: "Nguyễn Văn A", avatarUrl: null, isActive: true, ...over };
}

function lastMessage(
  over: Partial<NonNullable<ChatRoomDto["lastMessage"]>> = {},
): ChatRoomDto["lastMessage"] {
  return {
    senderId: OTHER,
    senderName: "Trần Thị B",
    kind: "text",
    excerpt: "Cảm ơn em nhé",
    attachmentCount: 0,
    ...over,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomListPanel
          selectedRoomId={null}
          isBootstrapping={false}
          onSelectRoom={vi.fn()}
          onCreateRoom={vi.fn()}
          onOpenSearch={vi.fn()}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Chip theo KHOÁ (`data-chip`), không theo CHỮ — chữ đổi theo i18n, khoá thì không. */
function chip(key: string): HTMLElement {
  const found = screen
    .getAllByTestId("chat-room-chip")
    .find((el) => el.getAttribute("data-chip") === key);
  if (!found) throw new Error(`không thấy chip "${key}"`);
  return found;
}

beforeEach(() => {
  listRooms.mockReset();
  listRooms.mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("RoomListPanel v2 · chip lọc nhanh (CHAT-DEC-021)", () => {
  beforeEach(() => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("dm", { roomType: "direct", name: null, peer: peer(), unreadCount: 2 }),
        room("g", { roomType: "group", unreadCount: 0 }),
        room("dep", { roomType: "department", unreadCount: 0 }),
      ]);
  });

  it("hàng chip là một NHÓM có nhãn (trình đọc màn hình biết đây là bộ lọc, không phải nút rời)", () => {
    renderPanel();
    const bar = screen.getByTestId("chat-room-chips");
    expect(bar.getAttribute("role")).toBe("group");
    expect(bar.getAttribute("aria-label")).toBe("Lọc nhanh danh sách hội thoại");
  });

  it("mặc định là «Tất cả», và ở đó danh sách VẪN chia mục cố định (§9a: chip không đảo DEC-014)", () => {
    renderPanel();
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByTestId("chat-room-section").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("chat-room-flat-list")).toBeNull();
  });

  it("chip «Chưa đọc» ⇒ danh sách PHẲNG, KHÔNG còn tiêu đề mục nào", () => {
    renderPanel();
    fireEvent.click(chip("unread"));

    expect(screen.queryAllByTestId("chat-room-section")).toHaveLength(0);
    expect(screen.getByTestId("chat-room-flat-list")).toBeTruthy();
    const items = screen.getAllByTestId("chat-room-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Nguyễn Văn A");
  });

  it("quay lại «Tất cả» ⇒ mục cố định trở lại (chip không phải đường một chiều)", () => {
    renderPanel();
    fireEvent.click(chip("group"));
    expect(screen.queryAllByTestId("chat-room-section")).toHaveLength(0);

    fireEvent.click(chip("all"));
    expect(screen.getAllByTestId("chat-room-section").length).toBeGreaterThan(0);
  });

  it("chip «Lưu trữ» ⇒ hỏi ĐÚNG rổ `listRooms({archived:true})`", async () => {
    renderPanel();
    fireEvent.click(chip("archived"));
    await vi.waitFor(() => expect(listRooms).toHaveBeenCalledWith({ archived: true }));
  });

  it("phòng khớp NHIỀU tiêu chí vẫn có ĐÚNG MỘT node ở mọi chip", () => {
    useChatStore.getState().resetChatStore();
    useChatStore.getState().setMyUserId(ME);
    useChatStore.getState().hydrateRooms([
      room("both", {
        roomType: "direct",
        name: null,
        peer: peer(),
        unreadCount: 4,
        pinnedAt: "2026-08-04T09:00:00.000Z",
      }),
    ]);
    renderPanel();

    for (const key of ["all", "unread", "direct"]) {
      fireEvent.click(chip(key));
      expect(screen.getAllByTestId("chat-room-item"), `chip "${key}"`).toHaveLength(1);
    }
  });

  it("chip KHÔNG lưu — vào lại màn hình là về «Tất cả»", () => {
    renderPanel();
    fireEvent.click(chip("group"));
    expect(chip("group").getAttribute("aria-pressed")).toBe("true");
    cleanup();

    renderPanel();
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(chip("group").getAttribute("aria-pressed")).toBe("false");
  });

  it("chip lọc ra RỖNG ⇒ thông điệp RIÊNG, không dùng lại chữ «chưa có cuộc trò chuyện nào»", () => {
    useChatStore.getState().resetChatStore();
    useChatStore.getState().hydrateRooms([room("g", { unreadCount: 0 })]);
    renderPanel();

    fireEvent.click(chip("unread"));
    expect(screen.getByText("Không có hội thoại nào trong bộ lọc này.")).toBeTruthy();
  });

  it("ô tìm áp SAU chip — gõ từ khoá trong «Nhóm» không kéo phòng loại khác về", () => {
    renderPanel();
    fireEvent.click(chip("group"));
    fireEvent.change(screen.getByLabelText("Tìm phòng theo tên hoặc mã"), {
      target: { value: "phòng" },
    });
    const items = screen.getAllByTestId("chat-room-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Phòng g");
  });
});

describe("RoomListPanel v2 · dòng phòng (preview · peer · thời gian)", () => {
  it("phòng NHÓM ⇒ preview có tiền tố TÊN người gửi", () => {
    useChatStore.getState().hydrateRooms([room("g", { lastMessage: lastMessage() })]);
    renderPanel();
    const preview = screen.getByTestId("chat-room-preview");
    expect(preview.textContent).toContain("Trần Thị B:");
    expect(preview.textContent).toContain("Cảm ơn em nhé");
  });

  it("tin cuối của CHÍNH TÔI ⇒ tiền tố «Bạn:», kể cả ở phòng riêng", () => {
    useChatStore.getState().hydrateRooms([
      room("dm", {
        roomType: "direct",
        name: null,
        peer: peer(),
        lastMessage: lastMessage({ senderId: ME, senderName: "Tôi" }),
      }),
    ]);
    renderPanel();
    expect(screen.getByTestId("chat-room-preview").textContent).toContain("Bạn:");
  });

  it("DM + tin của NGƯỜI KIA ⇒ KHÔNG tiền tố (chỉ hai người, tên đã ở dòng trên)", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("dm", { roomType: "direct", name: null, peer: peer(), lastMessage: lastMessage() }),
      ]);
    renderPanel();
    const preview = screen.getByTestId("chat-room-preview");
    expect(preview.textContent).not.toContain("Trần Thị B:");
    expect(preview.textContent).toContain("Cảm ơn em nhé");
  });

  it("`kind:'recalled'` ⇒ hiện CHỮ, không phải khoảng trắng (SPEC-15 §14 v2)", () => {
    useChatStore
      .getState()
      .hydrateRooms([room("g", { lastMessage: lastMessage({ kind: "recalled", excerpt: null }) })]);
    renderPanel();
    expect(screen.getByTestId("chat-room-preview").textContent).toContain(
      "Tin nhắn đã được thu hồi",
    );
  });

  it("`lastMessage: null` (phòng chưa có tin) ⇒ KHÔNG vẽ dòng preview nào", () => {
    useChatStore.getState().hydrateRooms([room("g", { lastMessage: null })]);
    renderPanel();
    expect(screen.queryByTestId("chat-room-preview")).toBeNull();
  });

  it("`kind:'file'` ⇒ đếm tệp; `kind:'text'` KÈM tệp ⇒ vẫn hiện CHỮ + kẹp giấy", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("f", {
          lastMessage: lastMessage({ kind: "file", excerpt: null, attachmentCount: 3 }),
        }),
        room("t", { lastMessage: lastMessage({ attachmentCount: 2 }) }),
      ]);
    renderPanel();
    const previews = screen.getAllByTestId("chat-room-preview").map((el) => el.textContent ?? "");
    expect(previews.some((p) => p.includes("3 tệp đính kèm"))).toBe(true);
    expect(previews.some((p) => p.includes("Cảm ơn em nhé"))).toBe(true);
    // CẢ HAI dòng có kẹp giấy — ký hiệu «📎 {{count}} tệp» của SPEC-15 §14 v2 áp cho `file` lẫn `text`.
    expect(screen.getAllByTestId("chat-room-preview-clip")).toHaveLength(2);
  });

  /**
   * Gate LIGHT (`code-reviewer`, 10/09) — `chat_messages.body` NOT NULL nhưng cho phép CHUỖI RỖNG, nên
   * tin rỗng-0-tệp là hàng hợp lệ. Điều kiện ẩn cũ (`body === "" && prefix === null`) cho ca này lọt và
   * vẽ ra «Bạn: » — dòng chỉ có tiền tố, đúng thứ §14 v2 gọi là "dòng trắng gây hiểu nhầm là lỗi".
   */
  it("tin RỖNG (0 tệp) của chính mình ⇒ KHÔNG vẽ dòng cụt «Bạn: »", () => {
    useChatStore.getState().hydrateRooms([
      room("mine", {
        lastMessage: lastMessage({ senderId: ME, senderName: "Tôi", excerpt: null }),
      }),
    ]);
    renderPanel();
    expect(screen.queryByTestId("chat-room-preview")).toBeNull();
  });

  it("tin RỖNG trong phòng NHÓM ⇒ cũng không vẽ dòng cụt «{tên}: »", () => {
    useChatStore
      .getState()
      .hydrateRooms([room("g", { lastMessage: lastMessage({ excerpt: null }) })]);
    renderPanel();
    expect(screen.queryByTestId("chat-room-preview")).toBeNull();
  });

  it("tin đã THU HỒI: KHÔNG vẽ kẹp giấy dù `attachmentCount` lịch sử vẫn > 0", () => {
    useChatStore.getState().hydrateRooms([
      room("r", {
        lastMessage: lastMessage({ kind: "recalled", excerpt: null, attachmentCount: 2 }),
      }),
    ]);
    renderPanel();
    expect(screen.getByTestId("chat-room-preview").textContent).toContain(
      "Tin nhắn đã được thu hồi",
    );
    expect(screen.queryAllByTestId("chat-room-preview-clip")).toHaveLength(0);
  });

  it("`peer.isActive === false` ⇒ nhãn «Ngừng hoạt động» cạnh tên (KHÔNG khoá gì cả)", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("dm", { roomType: "direct", name: null, peer: peer({ isActive: false }) }),
      ]);
    renderPanel();
    expect(screen.getByTestId("chat-room-peer-inactive").textContent).toBe("Ngừng hoạt động");
  });

  it("peer ONLINE ⇒ ĐÚNG một chấm; phòng NHÓM không bao giờ có chấm", () => {
    useChatStore.getState().hydrateRooms([
      room("dm", { roomType: "direct", name: null, peer: peer() }),
      // `chat:presence` chỉ fan-out tới peer của phòng `direct` — phòng nhóm không có khái niệm này.
      room("g", { roomType: "group" }),
    ]);
    useChatStore.getState().hydratePresence([{ userId: PEER_ID, isOnline: true }]);
    renderPanel();
    expect(screen.getAllByTestId("chat-room-online-dot")).toHaveLength(1);
  });

  it("peer offline / chưa biết ⇒ KHÔNG chấm (vắng khoá presence = coi như offline)", () => {
    useChatStore
      .getState()
      .hydrateRooms([room("dm", { roomType: "direct", name: null, peer: peer() })]);
    renderPanel();
    expect(screen.queryAllByTestId("chat-room-online-dot")).toHaveLength(0);
  });

  it("thời gian là TƯƠNG ĐỐI, không phải `HH:mm` — hai mốc cách nhau tháng đọc khác nhau", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("a", { lastMessageAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
        room("b", { lastMessageAt: new Date(Date.now() - 60 * 86_400_000).toISOString() }),
      ]);
    renderPanel();
    const times = screen.getAllByTestId("chat-room-time").map((el) => el.textContent ?? "");
    expect(new Set(times).size).toBe(2);
    // `HH:mm` khớp mẫu này; chuỗi tương đối («2 ngày») thì không.
    expect(times.every((v) => !/^\d{2}:\d{2}$/.test(v))).toBe(true);
  });

  it("avatar DM lấy `peer.avatarUrl`, KHÔNG lấy `room.avatarUrl` (DM luôn null ở cột phòng)", () => {
    useChatStore.getState().hydrateRooms([
      room("dm", {
        roomType: "direct",
        name: null,
        avatarUrl: null,
        peer: peer({ avatarUrl: "https://cdn.test/peer.png" }),
      }),
    ]);
    renderPanel();
    const img = screen.getByTestId("chat-room-avatar").querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/peer.png");
  });
});
