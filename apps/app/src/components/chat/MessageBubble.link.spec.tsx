/**
 * S20-CHAT-INTERNALLINK-1 (US-X-11) — link trong bong bóng tin: nội bộ mở NGAY trong ứng dụng, còn lại
 * giữ nguyên tab mới.
 *
 * Đo «ứng dụng có nhận lượt bấm không» bằng `defaultPrevented` mà một listener ở `window` đọc được — nó
 * chạy SAU handler của React (gắn ở gốc cây) rồi tự chặn để jsdom không thử điều hướng thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";

const mockNavigate = vi.fn();
const mockOpenChatRoom = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));
// Luật mở phòng theo liên kết (quyền · phòng của tôi · trang/drawer) đã có spec riêng ở S20-CHAT-DEEPLINK-1.
vi.mock("@/components/notifications/use-chat-room-link-opener", () => ({
  useChatRoomLinkOpener: () => mockOpenChatRoom,
}));

import i18n from "@/i18n";
import type { StoredChatMessage } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

const O = window.location.origin;
const TASK = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ROOM = "2e3f4051-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const MSG = "3f405162-7c8d-4e9f-8a1b-2c3d4e5f6071";
const GOAL = "40516273-8d9e-4f0a-9b2c-3d4e5f607182";
const EXTERNAL_REL = "noopener noreferrer nofollow";

const actions: MessageBubbleActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
  onCopy: vi.fn(),
};

function message(body: string): StoredChatMessage {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM,
    senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    senderName: "Trần B",
    body,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-10-24T10:00:00.000Z",
  };
}

function renderLink(url: string): HTMLAnchorElement {
  render(
    <I18nextProvider i18n={i18n}>
      <MessageBubble
        message={message(`xem ${url} nhé`)}
        isMine={false}
        isGrouped={false}
        isLastOfGroup
        replyTo={undefined}
        canRecall={false}
        canPin={false}
        seenBy={[]}
        senderAvatarUrl={null}
        senderNameFallback={null}
        isArchived={false}
        actions={actions}
      />
    </I18nextProvider>,
  );
  return screen.getByRole("link", { name: url }) as HTMLAnchorElement;
}

/** Bấm link; trả `true` khi ỨNG DỤNG đã nhận lượt bấm (chặn hành vi mặc định của trình duyệt). */
function clickTaken(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  let taken = false;
  const sink = (event: Event) => {
    taken = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", sink);
  try {
    fireEvent.click(link, init);
  } finally {
    window.removeEventListener("click", sink);
  }
  return taken;
}

function expectBrowserDefault(link: HTMLAnchorElement, init: MouseEventInit = {}): void {
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe(EXTERNAL_REL);
  expect(clickTaken(link, init)).toBe(false);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockOpenChatRoom).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockOpenChatRoom.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessageBubble · link NỘI BỘ mở trong ứng dụng", () => {
  it("link việc cùng origin ⇒ thêm `?task=` vào URL đang đứng (drawer tại chỗ), drawer chat giữ nguyên", () => {
    const dockBefore = useChatDockStore.getState();
    const link = renderLink(`${O}/tasks/${TASK}`);

    expect(clickTaken(link)).toBe(true);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      replace: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe(".");
    expect(call.replace).toBe(false);
    // Tham số của trang phía sau còn nguyên — chỉ THÊM `task`.
    expect(call.search({ tab: "members" })).toEqual({ tab: "members", task: TASK });
    expect(useChatDockStore.getState()).toBe(dockBefore);
    expect(mockOpenChatRoom).not.toHaveBeenCalled();
  });

  it("link việc người xem KHÔNG có quyền ⇒ bong bóng chỉ hiện chuỗi người gửi gõ, 0 lời gọi mạng; drawer (server) quyết", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const url = `${O}/tasks/${TASK}`;
    const link = renderLink(url);

    expect(link.textContent).toBe(url);
    expect(clickTaken(link)).toBe(true);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // Không tra tiêu đề việc ở bong bóng: «Không mở được việc này» là việc của drawer, đã có spec riêng.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("link phòng chat ⇒ luật mở phòng theo liên kết (giữ `?msg=`)", () => {
    const link = renderLink(`${O}/chat/${ROOM}?msg=${MSG}`);
    expect(clickTaken(link)).toBe(true);
    expect(mockOpenChatRoom).toHaveBeenCalledWith({ roomId: ROOM, messageId: MSG });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("link mục tiêu ⇒ router điều hướng trong ứng dụng (không tải lại trang)", () => {
    const link = renderLink(`${O}/goals/${GOAL}`);
    expect(clickTaken(link)).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith({ href: `/goals/${GOAL}` });
  });
});

describe("MessageBubble · lượt bấm ứng dụng KHÔNG nhận (trình duyệt mở tab mới như cũ)", () => {
  it.each([
    ["Ctrl+click", { ctrlKey: true }],
    ["⌘+click", { metaKey: true }],
    ["Shift+click", { shiftKey: true }],
    ["chuột giữa", { button: 1 }],
  ])("link nội bộ + %s", (_label, init) => {
    expectBrowserDefault(renderLink(`${O}/tasks/${TASK}`), init);
  });

  it.each([
    ["link ngoài", `https://example.com/tasks/${TASK}`],
    ["khác origin (khác cổng)", `${O.replace(/:\d+$/, "")}:1/tasks/${TASK}`],
    ["gạch chéo ngược", `${O}/tasks\\${TASK}`],
    ["`%5C` trong đường", `${O}/tasks/%5C${TASK}`],
    ["ngoài allowlist", `${O}/admin/users`],
  ])("%s ⇒ `target=_blank` + rel cũ, bấm thường vẫn để trình duyệt", (_label, url) => {
    expectBrowserDefault(renderLink(url));
  });
});
