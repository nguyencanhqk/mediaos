/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-13) — phím tắt chuyển phòng + nhảy sang phòng chưa đọc kế tiếp.
 *
 * Hai tầng kiểm:
 *  1. hàm THUẦN — phát hiện nền tảng, khớp tổ hợp (Windows Alt+↑/↓ · Alt+Shift+↓; macOS ⌘⌥ — KHÔNG
 *     Option+↑/↓, vì đó là phím di con trỏ trong ô soạn), chọn phòng đích theo thứ tự danh sách;
 *  2. `RoomShortcuts` gắn thật trên `document` — ô soạn có chữ không bị chèn ký tự/di con trỏ, popover
 *     hay dialog đang mở thì nhường phím, 3 phòng chưa đọc + 3 lần nhấn mở lần lượt, lần 4 «Đã đọc hết»,
 *     tên phòng mới đọc qua `aria-live`, phòng bị lọc ẩn không bao giờ là đích.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { toast } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import type { RoomFilterChip } from "./room-list-filter";
import {
  detectShortcutPlatform,
  matchRoomShortcut,
  roomShortcutTarget,
  type ShortcutPlatform,
} from "./use-room-shortcuts";
import { RoomShortcuts } from "./use-room-shortcuts.help";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function room(id: string, minute: number, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    // Phút lớn hơn ⇒ hoạt động gần hơn ⇒ đứng TRÊN trong danh sách.
    lastMessageAt: `2026-08-04T10:${String(minute).padStart(2, "0")}:00.000Z`,
    lastMessageSeq: 10,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const key = (over: Partial<KeyboardEvent>) => ({
  key: "ArrowDown",
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...over,
});

describe("detectShortcutPlatform", () => {
  it("macOS / iPadOS ⇒ mac; Windows / Linux / không rõ ⇒ other", () => {
    expect(detectShortcutPlatform({ platform: "MacIntel", userAgent: "" })).toBe("mac");
    expect(detectShortcutPlatform({ userAgentData: { platform: "macOS" }, userAgent: "" })).toBe(
      "mac",
    );
    expect(
      detectShortcutPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)" }),
    ).toBe("mac");
    expect(detectShortcutPlatform({ platform: "Win32", userAgent: "Windows NT 10.0" })).toBe(
      "other",
    );
    expect(detectShortcutPlatform({ platform: "Linux x86_64", userAgent: "" })).toBe("other");
    expect(detectShortcutPlatform(undefined)).toBe("other");
  });
});

describe("matchRoomShortcut", () => {
  it("Windows: Alt+↑ / Alt+↓ / Alt+Shift+↓", () => {
    expect(matchRoomShortcut(key({ key: "ArrowUp", altKey: true }), "other")).toBe("prev");
    expect(matchRoomShortcut(key({ altKey: true }), "other")).toBe("next");
    expect(matchRoomShortcut(key({ altKey: true, shiftKey: true }), "other")).toBe("nextUnread");
    // Không phải tổ hợp của ta ⇒ null (để ô soạn / trình duyệt xử lý như thường).
    expect(matchRoomShortcut(key({}), "other")).toBeNull();
    expect(matchRoomShortcut(key({ altKey: true, ctrlKey: true }), "other")).toBeNull();
    expect(
      matchRoomShortcut(key({ key: "ArrowUp", altKey: true, shiftKey: true }), "other"),
    ).toBeNull();
    expect(matchRoomShortcut(key({ key: "k", ctrlKey: true }), "other")).toBeNull();
  });

  it("macOS: ⌘⌥↑ / ⌘⌥↓ / ⌘⌥⇧↓ — Option+↑/↓ đơn thuần KHÔNG bị bắt", () => {
    const mac: ShortcutPlatform = "mac";
    expect(matchRoomShortcut(key({ key: "ArrowUp", altKey: true, metaKey: true }), mac)).toBe(
      "prev",
    );
    expect(matchRoomShortcut(key({ altKey: true, metaKey: true }), mac)).toBe("next");
    expect(matchRoomShortcut(key({ altKey: true, metaKey: true, shiftKey: true }), mac)).toBe(
      "nextUnread",
    );
    expect(matchRoomShortcut(key({ key: "ArrowUp", altKey: true }), mac)).toBeNull();
    expect(matchRoomShortcut(key({ altKey: true }), mac)).toBeNull();
    expect(matchRoomShortcut(key({ altKey: true, shiftKey: true }), mac)).toBeNull();
    expect(matchRoomShortcut(key({ key: "k", metaKey: true }), mac)).toBeNull();
  });
});

describe("roomShortcutTarget", () => {
  const a = room("a", 5);
  const b = room("b", 4, { unreadCount: 2 });
  const c = room("c", 3);
  const d = room("d", 2, { markedUnreadAt: "2026-08-04T10:00:00Z" });
  const order = [a, b, c, d];

  it("trên/dưới theo thứ tự danh sách; chưa chọn phòng ⇒ dưới = phòng đầu, trên = phòng cuối", () => {
    expect(roomShortcutTarget(order, "b", "next")).toBe("c");
    expect(roomShortcutTarget(order, "b", "prev")).toBe("a");
    expect(roomShortcutTarget(order, null, "next")).toBe("a");
    expect(roomShortcutTarget(order, null, "prev")).toBe("d");
    // Ở mép ⇒ đứng yên (null), không vòng.
    expect(roomShortcutTarget(order, "d", "next")).toBeNull();
    expect(roomShortcutTarget(order, "a", "prev")).toBeNull();
  });

  it("chưa đọc kế tiếp: tiến từ phòng hiện tại, vòng lại đầu, bỏ qua chính nó; tính cả cờ đánh dấu tay", () => {
    expect(roomShortcutTarget(order, "a", "nextUnread")).toBe("b");
    expect(roomShortcutTarget(order, "b", "nextUnread")).toBe("d");
    expect(roomShortcutTarget(order, "d", "nextUnread")).toBe("b");
    expect(roomShortcutTarget([a, c], "a", "nextUnread")).toBeNull();
  });

  it("phòng hiện tại bị lọc ẩn (không có trong danh sách) ⇒ coi như chưa chọn", () => {
    expect(roomShortcutTarget([a, c], "b", "next")).toBe("a");
    expect(roomShortcutTarget([a, b], "zz", "nextUnread")).toBe("b");
  });

  it("danh sách rỗng ⇒ null, không ném", () => {
    expect(roomShortcutTarget([], null, "next")).toBeNull();
    expect(roomShortcutTarget([], "a", "prev")).toBeNull();
    expect(roomShortcutTarget([], "a", "nextUnread")).toBeNull();
  });
});

// ── Gắn thật ───────────────────────────────────────────────────────────────

/** Vai trang `/chat`: giữ phòng đang mở; mở phòng ⇒ phòng đó thành đã đọc (như cuộn tới đáy). */
function Harness({
  chip = "all",
  platform = "other",
  onOpen,
}: {
  chip?: RoomFilterChip;
  platform?: ShortcutPlatform;
  onOpen?: (roomId: string) => void;
}): React.ReactElement {
  const [current, setCurrent] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <I18nextProvider i18n={i18n}>
      <div data-testid="current">{current ?? "none"}</div>
      <textarea data-testid="composer" defaultValue="" />
      <RoomShortcuts
        chip={chip}
        query=""
        currentRoomId={current}
        platform={platform}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onOpenRoom={(id) => {
          onOpen?.(id);
          setCurrent(id);
          useChatStore.getState().applyReadEvent({ roomId: id, userId: ME, lastReadSeq: 10 });
        }}
      />
    </I18nextProvider>
  );
}

const pressNextUnread = (target: Element = document.body) =>
  fireEvent.keyDown(target, { key: "ArrowDown", altKey: true, shiftKey: true });

let toastSuccess: MockInstance<typeof toast.success>;

beforeEach(() => {
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  toastSuccess = vi.spyOn(toast, "success");
});

afterEach(() => {
  toastSuccess.mockRestore();
  toast.clear();
  document.querySelectorAll("[data-test-layer]").forEach((el) => el.remove());
});

describe("RoomShortcuts · gắn trên document", () => {
  it("3 phòng chưa đọc + 3 lần nhấn ⇒ mở lần lượt theo danh sách; lần 4 ⇒ «Đã đọc hết»; tên đọc qua aria-live", () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("r1", 9, { unreadCount: 1 }),
        room("x", 8),
        room("r2", 7, { unreadCount: 4 }),
        room("r3", 6, { markedUnreadAt: "2026-08-04T10:00:00Z", unreadCount: 2 }),
      ]);
    render(<Harness />);

    pressNextUnread();
    expect(screen.getByTestId("current").textContent).toBe("r1");
    expect(screen.getByTestId("room-shortcut-live").textContent).toContain("Phòng r1");
    pressNextUnread();
    expect(screen.getByTestId("current").textContent).toBe("r2");
    pressNextUnread();
    expect(screen.getByTestId("current").textContent).toBe("r3");
    expect(screen.getByTestId("room-shortcut-live").textContent).toContain("Phòng r3");
    expect(toastSuccess).not.toHaveBeenCalled();

    pressNextUnread();
    expect(screen.getByTestId("current").textContent).toBe("r3");
    expect(toastSuccess).toHaveBeenCalledWith("Đã đọc hết", expect.anything());
  });

  it("ô soạn có chữ ⇒ phím bị nuốt (không chèn ký tự, không di con trỏ), chữ còn nguyên", () => {
    useChatStore.getState().hydrateRooms([room("a", 5), room("b", 4)]);
    render(<Harness />);
    const composer = screen.getByTestId("composer") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Anh xem giúp" } });
    composer.setSelectionRange(3, 3);

    const notCancelled = fireEvent.keyDown(composer, { key: "ArrowDown", altKey: true });
    expect(notCancelled).toBe(false);
    expect(screen.getByTestId("current").textContent).toBe("a");
    expect(composer.value).toBe("Anh xem giúp");
    expect(composer.selectionStart).toBe(3);
  });

  it("macOS: Option+↓ trong ô soạn KHÔNG bị bắt (để di con trỏ như thường); ⌘⌥↓ thì đổi phòng", () => {
    useChatStore.getState().hydrateRooms([room("a", 5), room("b", 4)]);
    render(<Harness platform="mac" />);
    const composer = screen.getByTestId("composer");

    expect(fireEvent.keyDown(composer, { key: "ArrowDown", altKey: true })).toBe(true);
    expect(screen.getByTestId("current").textContent).toBe("none");

    fireEvent.keyDown(composer, { key: "ArrowDown", altKey: true, metaKey: true });
    expect(screen.getByTestId("current").textContent).toBe("a");
  });

  it("popover @/emoji đang mở ⇒ phím thuộc về popover, không đổi phòng", () => {
    useChatStore.getState().hydrateRooms([room("a", 5)]);
    render(<Harness />);
    const layer = document.createElement("div");
    layer.setAttribute("data-floating-layer", "open");
    layer.setAttribute("data-test-layer", "");
    document.body.appendChild(layer);

    expect(fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true })).toBe(true);
    expect(screen.getByTestId("current").textContent).toBe("none");
  });

  it("dialog đang mở ⇒ phím thuộc về dialog", () => {
    useChatStore.getState().hydrateRooms([room("a", 5)]);
    render(<Harness />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("data-test-layer", "");
    document.body.appendChild(dialog);

    pressNextUnread();
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    expect(screen.getByTestId("current").textContent).toBe("none");
  });

  it("không nhảy sang phòng bị lọc ẩn (chip «Riêng» giấu phòng nhóm chưa đọc)", () => {
    const onOpen = vi.fn();
    useChatStore
      .getState()
      .hydrateRooms([
        room("g", 9, { unreadCount: 5 }),
        room("d1", 8, { roomType: "direct", unreadCount: 1 }),
      ]);
    render(<Harness chip="direct" onOpen={onOpen} />);

    pressNextUnread();
    pressNextUnread();
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(["d1"]);
  });

  it("không có phòng nào ⇒ nhấn phím không lỗi, không mở gì", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("«?» ngoài ô soạn mở bảng gợi ý phím; trong ô soạn thì là ký tự bình thường", () => {
    useChatStore.getState().hydrateRooms([room("a", 5)]);
    render(<Harness />);

    expect(fireEvent.keyDown(screen.getByTestId("composer"), { key: "?", shiftKey: true })).toBe(
      true,
    );
    expect(screen.queryByTestId("room-shortcut-help")).toBeNull();

    act(() => {
      fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    });
    const help = screen.getByTestId("room-shortcut-help");
    expect(help.textContent).toContain("Alt");
    expect(help.textContent).toContain("Phòng chưa đọc kế tiếp");
  });
});
