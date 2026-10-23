// @vitest-environment jsdom
/**
 * S17-CHAT-UX2-FE-5 — drawer chat (CHAT-SCREEN-002 v2 · CHAT-DEC-026).
 *
 * Kế thừa 5/6 khẳng định của `ChatDock.spec.tsx` (ca `pointer-events-none` chết theo dải cố định đáy
 * màn) và thêm những chỗ chỉ drawer mới có: hai chế độ danh sách ↔ hội thoại, nút ‹, và ba đường đóng
 * (Esc · ✕ · nền) — trong đó **nền cố ý KHÔNG đóng**.
 *
 * Bài này KHÔNG mock `ChatDrawerBody`: phần lớn giá trị nằm ở chỗ ghép — cổng `view:chat-room` bọc thân,
 * `useChatConversation` đăng ký/gỡ đúng lúc push/pop, và dấu `data-escape-claim` của `ConversationPanel`
 * có thật sự chặn được `Sheet` hay không. Mock thân đi là bỏ mất cả ba.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const navigate = vi.fn();
let pathname = "/hr/employees";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname } }),
  };
});

const getMessages = vi.fn();
const getRoom = vi.fn();
const sendMessage = vi.fn();
const openDirect = vi.fn();
const createRoom = vi.fn();
const listEmployees = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    hrApi: { ...actual.hrApi, listEmployees: (...a: unknown[]) => listEmployees(...a) },
    chatApi: {
      ...actual.chatApi,
      openDirect: (...a: unknown[]) => openDirect(...a),
      createRoom: (...a: unknown[]) => createRoom(...a),
      getRoom: (...a: unknown[]) => getRoom(...a),
      getMessages: (...a: unknown[]) => getMessages(...a),
      sendMessage: (...a: unknown[]) => sendMessage(...a),
      // Hàm thường, KHÔNG `vi.fn()`: `vi.restoreAllMocks()` ở afterEach trả `vi.fn` về rỗng ⇒ ping trả
      // `undefined` và `.catch` của nó ném ở ca sau.
      pingTyping: () => Promise.resolve(undefined),
      listRooms: vi.fn().mockResolvedValue([]),
      listRoomFiles: vi.fn().mockResolvedValue([]),
      getPinned: vi.fn().mockResolvedValue([]),
      markRead: vi.fn().mockResolvedValue({ roomId: "", lastReadSeq: 0, unreadCount: 0 }),
    },
  };
});

import { useAuthStore, useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";
import { ChatDrawer } from "./ChatDrawer";
import { ConversationPanel } from "./ConversationPanel";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

/**
 * Cổng theo TỪNG CẶP, không phải một `mockReturnValue(bool)` chăn.
 *
 * `access:chat` (cổng nav) và `view:chat-room` (cổng đọc) là hai cặp khác nhau và WO này cố tình để
 * chúng gác hai tầng khác nhau. Một mock trả cùng giá trị cho mọi cặp thì ca «có `access` nhưng thiếu
 * `view`» đơn giản không tồn tại được — và đó lại là ca duy nhất chứng minh cổng đọc có thật.
 */
function grant(pairs: { access?: boolean; viewRoom?: boolean; createRoom?: boolean }): void {
  const { access = true, viewRoom = true, createRoom: canCreate = true } = pairs;
  mockUseCan.mockImplementation((action: string, resourceType: string) => {
    if (action === "access" && resourceType === "chat") return access;
    if (action === "view" && resourceType === "chat-room") return viewRoom;
    if (action === "create" && resourceType === "chat-room") return canCreate;
    return true;
  });
}

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

function seededMessage() {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: "a",
    senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    senderName: "Trần B",
    body: "xin chào",
    messageType: "text" as const,
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-08-04T10:00:00.000Z",
  };
}

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ChatDrawer />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/**
 * Nạp SẴN chunk của thân drawer trước khi chạy ca đầu tiên.
 *
 * `ChatDrawer` kéo thân bằng `React.lazy` (nó nằm ở app shell — xem docblock ở đó). Trong vitest, lần
 * `import()` đầu phải transform cả cây `RoomListPanel` → `ConversationPanel` → `MessageList` →
 * `MessageComposer`, lâu hơn 1000ms mặc định của `findBy*` ⇒ ca ĐẦU TIÊN của file đọc phải `Suspense
 * fallback` và đỏ, còn các ca sau xanh vì module đã nằm trong registry. Một bài test xanh/đỏ theo THỨ TỰ
 * chạy là bài test không nói lên điều gì.
 *
 * Không phải nới timeout: dùng chung một promise `import()` đã resolve thì `lazy` trả ngay, và ta vẫn đo
 * đúng cây thật (KHÔNG mock thân).
 */
beforeAll(async () => {
  await import("./drawer/ChatDrawerBody");
});

beforeEach(() => {
  // jsdom KHÔNG implement `scrollIntoView` — thiếu stub thì effect NÉM và cả cây component chết.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  navigate.mockClear();
  pathname = "/hr/employees";
  grant({});
  getRoom.mockReset();
  getRoom.mockResolvedValue({ ...room("a"), members: [], myRole: "member" });
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  sendMessage.mockReset();
  sendMessage.mockRejectedValue(new Error("mạng đứt"));
  useChatDockStore.getState().resetChatDock();
  useChatStore.getState().resetChatStore();
  // S20-CHAT-DRAFT-1 — dọn nháp bằng CHÍNH chốt sản phẩm (đổi người đăng nhập), không gọi thẳng store:
  // ca nào để lại nháp mà chốt reset hỏng thì ca sau đỏ theo, đúng như người dùng sau sẽ thấy.
  useAuthStore.getState().setUser(
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      companyId: "c",
      email: "d@x.test",
      fullName: null,
      status: "active",
    },
    {},
  );
  useAuthStore.getState().logout();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatDrawer · cổng quyền", () => {
  it("thiếu access:chat ⇒ không render gì", () => {
    grant({ access: false });
    useChatDockStore.getState().openDrawer();

    const { container } = renderDrawer();
    expect(container).toBeEmptyDOMElement();
  });

  it("có access:chat nhưng THIẾU view:chat-room ⇒ §14 'không có quyền', KHÔNG hiện danh sách phòng", async () => {
    grant({ viewRoom: false });
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm Kế toán" })], false);
    // `isOpen` bật + `access:chat` bật ⇒ ca này chỉ có thể đỏ/xanh vì ĐÚNG cặp đang đo. Thiếu hai vế đó
    // thì nó xanh nhờ một cổng khác và không chứng minh gì (cổng chồng nhau).
    useChatDockStore.getState().openDrawer();

    renderDrawer();
    expect(await screen.findByText(/không có quyền xem tin nhắn nội bộ/i)).toBeTruthy();
    expect(screen.queryByTestId("chat-room-list")).toBeNull();
  });

  it("ĐỐI CHỨNG: đủ cả hai cặp ⇒ danh sách phòng hiện", async () => {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm Kế toán" })], false);
    useChatDockStore.getState().openDrawer();

    renderDrawer();
    expect(await screen.findByTestId("chat-room-list")).toBeTruthy();
    expect(screen.getByText("Nhóm Kế toán")).toBeTruthy();
  });
});

describe("ChatDrawer · KHÔNG chồng lên trang /chat", () => {
  it("trên /chat: không render, nhưng GIỮ nguyên trạng thái drawer", () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    pathname = "/chat";

    renderDrawer();
    expect(screen.queryByTestId("chat-drawer")).toBeNull();
    // Vế thứ hai bắt buộc: "dọn sạch state khi vào /chat" cũng làm vế đầu xanh, mà nó lại làm người
    // dùng mất hội thoại đang đọc dở mỗi lần ghé trang chat.
    expect(useChatDockStore.getState().isOpen).toBe(true);
    expect(useChatDockStore.getState().openRoomIds).toEqual(["a"]);
  });

  it("trên /chat/<id> (sub-route) cũng KHÔNG render", () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    pathname = "/chat/11111111-1111-4111-8111-111111111111";

    renderDrawer();
    // `startsWith` chứ không `===`. Mất vế này là mở lại cửa cho HAI instance `useChatConversation`
    // cùng một phòng — cái unmount trước giết lưới bù tin của cái còn sống, im lặng tuyệt đối.
    expect(screen.queryByTestId("chat-drawer")).toBeNull();
  });
});

describe("ChatDrawer · mở / đóng", () => {
  it("isOpen=false ⇒ không render gì; openDrawer() ⇒ hiện ở chế độ DANH SÁCH", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);

    const { rerender, container } = renderDrawer();
    expect(container).toBeEmptyDOMElement();

    useChatDockStore.getState().openDrawer();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <ChatDrawer />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    // Chế độ đọc từ NỘI DUNG (danh sách phòng có mặt), không từ một thuộc tính đánh dấu: thuộc tính có
    // thể đúng trong khi thân render nhầm thứ.
    expect(await screen.findByTestId("chat-room-list")).toBeTruthy();
    expect(screen.queryByTestId("chat-drawer-conversation")).toBeNull();
  });

  it("panel toàn màn dưới md (max-w-none) và 400px từ md trở lên", async () => {
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    // ⚠️ Đây là khẳng định CHUỖI CLASS, không phải bố cục: jsdom không tính CSS. Nó bắt được việc ai đó
    // gỡ mất `max-w-none` (khi ấy `max-w-2xl` mặc định của Sheet thắng và drawer hụt bề ngang trên điện
    // thoại), nhưng KHÔNG chứng minh được trình duyệt vẽ ra sao.
    const panel = await screen.findByTestId("chat-drawer");
    expect(panel.className).toContain("max-w-none");
    expect(panel.className).toContain("md:max-w-[400px]");
  });

  it("bấm NỀN không đóng (chống mất nháp), bấm ✕ thì đóng", async () => {
    useChatDockStore.getState().openDrawer();
    const { container } = renderDrawer();
    await screen.findByTestId("chat-drawer");

    fireEvent.click(container.querySelector('[role="presentation"]')!);
    expect(useChatDockStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });

  it("Esc đóng drawer khi không có việc gì đang dở", async () => {
    useChatDockStore.getState().openDrawer();
    renderDrawer();
    await screen.findByTestId("chat-drawer");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });
});

describe("ChatDrawer · danh sách ↔ hội thoại (push/pop)", () => {
  it("bấm một phòng ⇒ hội thoại + nút ‹; bấm ‹ ⇒ về danh sách, drawer VẪN mở", async () => {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm Kế toán" })], false);
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    fireEvent.click(await screen.findByText("Nhóm Kế toán"));

    expect(await screen.findByTestId("chat-drawer-conversation")).toBeTruthy();
    // Danh sách phòng phải BIẾN — push, không phải chồng lên nhau.
    expect(screen.queryByTestId("chat-room-list")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-drawer-back"));

    expect(await screen.findByTestId("chat-room-list")).toBeTruthy();
    expect(screen.queryByTestId("chat-drawer-conversation")).toBeNull();
    expect(useChatDockStore.getState().isOpen).toBe(true);
  });

  it("push rồi pop ⇒ theo dõi phòng được GỠ (không rò lưới bù tin 10 giây)", async () => {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm Kế toán" })], false);
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    fireEvent.click(await screen.findByText("Nhóm Kế toán"));
    await waitFor(() => expect(useChatStore.getState().subscribedRoomIds["a"]).toBeDefined());

    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    // Đếm KHOÁ trong store chứ không đếm lời gọi trên một mock: `unsubscribeFromRoom` có được GỌI hay
    // không là chuyện khác với `pollIntervalId` có thật sự bị `clearInterval` hay không.
    await waitFor(() => expect(useChatStore.getState().subscribedRoomIds["a"]).toBeUndefined());
  });

  it("bấm phòng KHÁC ⇒ vẫn ĐÚNG MỘT hội thoại, và là phòng vừa bấm", async () => {
    useChatStore
      .getState()
      .syncRoomList([room("a", { name: "Nhóm A" }), room("b", { name: "Nhóm B" })], false);
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    fireEvent.click(await screen.findByText("Nhóm A"));
    await screen.findByTestId("chat-drawer-conversation");

    // Quay lại danh sách rồi chọn phòng khác — đường người dùng thật đi.
    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    fireEvent.click(await screen.findByText("Nhóm B"));

    const panes = await screen.findAllByTestId("chat-drawer-conversation");
    // ĐẾM NODE, không hỏi nội dung: bài "đổi phòng ⇒ nội dung đổi" vẫn xanh suốt thời gian một khung cũ
    // nằm lại trong DOM (lớp lỗi đã ra PROD ở `/chat`).
    expect(panes).toHaveLength(1);
    expect(panes[0]).toHaveAttribute("data-room-id", "b");
  });

  it("hai lần openRoom LIÊN TIẾP (không qua ‹) ⇒ DOM vẫn đúng MỘT hội thoại", async () => {
    /*
     * Ca trên đi qua giao diện, nên nó KHÔNG chạm được nhánh "thay chỗ" của store: trong drawer, muốn
     * chọn phòng khác thì phải bấm ‹ trước, và `openRoomIds` đã rỗng lúc đó. Nhánh thay-chỗ vẫn có
     * đường vào THẬT — `ChatBadge` (mở phòng khi drawer đang đóng), deep-link, thông báo — nên phải có
     * một ca đi thẳng qua store.
     *
     * Đây cũng là ca DUY NHẤT chứng minh thân drawer chiếu ĐÚNG state: thân `.map` toàn mảng
     * `openRoomIds` (không đọc mỗi phần tử cuối), nên nới `MAX_DOCK_WINDOWS` lên 2 làm ca này ĐỎ với
     * hai node. Nếu thân chỉ đọc phần tử cuối thì không đột biến nào giết được nó.
     */
    useChatStore
      .getState()
      .syncRoomList([room("a", { name: "Nhóm A" }), room("b", { name: "Nhóm B" })], false);
    useChatDockStore.getState().openRoom("a");
    useChatDockStore.getState().openRoom("b");
    renderDrawer();

    const panes = await screen.findAllByTestId("chat-drawer-conversation");
    expect(panes).toHaveLength(1);
    expect(panes[0]).toHaveAttribute("data-room-id", "b");
  });

  it("⤢ đang mở phòng a ⇒ điều hướng /chat/a (GIỮ phòng đang đọc) VÀ đóng drawer", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();

    fireEvent.click(await screen.findByTestId("chat-drawer-expand"));

    expect(navigate).toHaveBeenCalledWith({ to: "/chat/$roomId", params: { roomId: "a" } });
    // Không đóng thì lúc rời `/chat` sang trang khác, drawer tự bung ra dù người dùng chưa mở nó.
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });

  it("⤢ ở chế độ danh sách (chưa chọn phòng) ⇒ điều hướng /chat", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    fireEvent.click(await screen.findByTestId("chat-drawer-expand"));

    expect(navigate).toHaveBeenCalledWith({ to: "/chat" });
  });

  it("S20-CHAT-DEEPLINK-1 — mở một phòng KHÔNG có trong danh sách ⇒ không hỏi chi tiết phòng đó", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("lạ");
    renderDrawer();

    await screen.findByTestId("chat-drawer");
    expect(getRoom).not.toHaveBeenCalledWith("lạ");
  });

  it("S20-CHAT-DEEPLINK-1 — mở phòng trong drawer ⇒ ô soạn có tiêu điểm", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();

    const composer = await screen.findByTestId("chat-composer");
    await waitFor(() => expect(composer.contains(document.activeElement)).toBe(true));
  });
});

describe("ChatDrawer · Esc nhường cho việc đang dở", () => {
  it("đang soạn câu trả lời ⇒ Esc HUỶ trả lời, drawer VẪN mở; Esc lần hai mới đóng", async () => {
    getMessages.mockResolvedValue([seededMessage()]);
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm Kế toán" })], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();

    fireEvent.click(await screen.findByLabelText("Trả lời"));
    expect(await screen.findByText(/Trả lời Trần B/)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText(/Trả lời Trần B/)).toBeNull());
    // Vế quyết định: một lần Esc = một ý định. Đóng luôn drawer là bỏ tệp chờ đang soạn dở (chữ nháp
    // thì `chat-draft.store` giữ từ S20-CHAT-DRAFT-1, tệp chờ vẫn chỉ ở state cục bộ của `MessageComposer`).
    expect(useChatDockStore.getState().isOpen).toBe(true);

    // ĐỐI CHỨNG: hết việc đang dở thì Esc lại đóng bình thường — nếu không, drawer thành cái bẫy.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });
});

describe("ChatDrawer · phòng biến khỏi store", () => {
  it("phòng bị bớt/tự rời ⇒ pop về danh sách, drawer VẪN mở", async () => {
    useChatStore.getState().syncRoomList([room("a"), room("b")], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();
    await screen.findByTestId("chat-drawer-conversation");

    useChatStore.getState().removeRoomForSelf("a");

    // Không có vế này thì hội thoại "ma" đứng lại và nện `GET /chat/rooms/:id/messages` (nay 404) theo
    // nhịp lưới bù, vô thời hạn.
    await waitFor(() => expect(useChatDockStore.getState().openRoomIds).toEqual([]));
    expect(useChatDockStore.getState().isOpen).toBe(true);
  });

  it("CHƯA nạp xong danh sách phòng ⇒ KHÔNG pop (chống 'drawer tự quên' sau mỗi lần F5)", async () => {
    // `hasLoadedRooms === false`: `GET /chat/rooms` chưa trả về nên `roomsById` rỗng với MỌI phòng.
    useChatDockStore.getState().openRoom("a");
    expect(useChatStore.getState().hasLoadedRooms).toBe(false);

    renderDrawer();
    await screen.findByTestId("chat-drawer");

    expect(useChatDockStore.getState().openRoomIds).toEqual(["a"]);
  });
});

describe("ChatDrawer · nháp theo phòng (S20-CHAT-DRAFT-1)", () => {
  const composerBox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
  const typeDraft = (value: string) => fireEvent.change(composerBox(), { target: { value } });

  it("gõ dở ở A, ‹ về danh sách ⇒ dòng A hiện «Nháp: …»; mở lại A ⇒ ô soạn còn nguyên", async () => {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm A" })], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();
    await screen.findByTestId("chat-drawer-conversation");

    typeDraft("Anh xem giúp báo cáo");
    fireEvent.click(screen.getByTestId("chat-drawer-back"));

    expect((await screen.findByTestId("chat-room-draft")).textContent).toBe(
      "Nháp: Anh xem giúp báo cáo",
    );

    fireEvent.click(screen.getByText("Nhóm A"));
    await screen.findByTestId("chat-drawer-conversation");
    expect(composerBox().value).toBe("Anh xem giúp báo cáo");
  });

  it("khung «đang trả lời» còn sau khi ‹ rồi mở lại phòng", async () => {
    getMessages.mockResolvedValue([seededMessage()]);
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm A" })], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();

    fireEvent.click(await screen.findByLabelText("Trả lời"));
    expect(await screen.findByText(/Trả lời Trần B/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    fireEvent.click(await screen.findByText("Nhóm A"));

    expect(await screen.findByText(/Trả lời Trần B/)).toBeTruthy();
  });

  it("tin đang trả lời bị THU HỒI khi đang ở phòng khác ⇒ quay lại, khung trả lời KHÔNG còn thân tin cũ", async () => {
    getMessages.mockResolvedValue([seededMessage()]);
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm A" })], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();

    fireEvent.click(await screen.findByLabelText("Trả lời"));
    expect(await screen.findByText(/Trả lời Trần B/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    await screen.findByTestId("chat-room-list");

    // `chat:message-recalled` tới qua WS; lần nạp lại khi mở phòng cũng trả bản ĐÃ che như server thật.
    const recalledAt = "2026-08-04T10:05:00.000Z";
    useChatStore
      .getState()
      .applyMessageRecalled({ roomId: "a", messageId: seededMessage().id, recalledAt });
    getMessages.mockResolvedValue([{ ...seededMessage(), body: null, recalledAt }]);

    fireEvent.click(await screen.findByText("Nhóm A"));
    const composer = await screen.findByTestId("chat-composer");
    expect(await within(composer).findByText(/Trả lời Trần B/)).toBeTruthy();
    // Nhất quán với trích dẫn trong `MessageBubble`: tin thu hồi hiện chữ xám, không bao giờ thân cũ.
    expect(within(composer).queryByText("xin chào")).toBeNull();
    expect(within(composer).getByText("Tin nhắn đã được thu hồi")).toBeTruthy();
  });

  it("⤢ sang /chat ⇒ hội thoại cùng phòng ở trang đầy đủ còn NGUYÊN nháp", async () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    const drawer = renderDrawer();
    await screen.findByTestId("chat-drawer-conversation");

    typeDraft("gõ trong drawer");
    fireEvent.click(screen.getByTestId("chat-drawer-expand"));
    drawer.unmount();

    // `/chat/A` dựng ĐÚNG `ConversationPanel` này (ChatPage, khe 2) — dựng nó trực tiếp để ca không phụ
    // thuộc router; thứ được đo là nháp đi theo store dùng chung, không phải cây route.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <ConversationPanel room={room("a")} members={[]} myRole="member" />
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(composerBox().value).toBe("gõ trong drawer");
  });

  it("gửi LỖI ⇒ nhãn «Nháp:» còn; gửi THÀNH CÔNG ⇒ ô trống và nhãn biến mất", async () => {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm A" })], false);
    useChatDockStore.getState().openRoom("a");
    renderDrawer();
    await screen.findByTestId("chat-drawer-conversation");

    typeDraft("báo cáo quý");
    fireEvent.click(screen.getByLabelText("Gửi tin nhắn"));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Không gửi được tin/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    expect((await screen.findByTestId("chat-room-draft")).textContent).toBe("Nháp: báo cáo quý");

    sendMessage.mockImplementation((_roomId: string, body: { clientMessageId: string }) =>
      Promise.resolve({
        ...seededMessage(),
        id: "00000002-1111-4111-8111-111111111112",
        senderId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        body: "báo cáo quý",
        roomSeq: 6,
        clientMessageId: body.clientMessageId,
      }),
    );
    fireEvent.click(screen.getByText("Nhóm A"));
    await screen.findByTestId("chat-drawer-conversation");
    fireEvent.click(screen.getByLabelText("Gửi tin nhắn"));
    await waitFor(() => expect(composerBox().value).toBe(""));

    fireEvent.click(screen.getByTestId("chat-drawer-back"));
    await screen.findByTestId("chat-room-list");
    expect(screen.queryByTestId("chat-room-draft")).toBeNull();
  });
});

/**
 * S20-CHAT-NEWROOM-1 — «Cuộc trò chuyện mới» ngay trong drawer (US-CHAT-NV-91): «+» trên header danh sách
 * mở CÙNG `CreateRoomDialog` với /chat; tạo xong ⇒ `openRoom` trong drawer, trang phía sau giữ nguyên.
 */
describe("ChatDrawer · cuộc trò chuyện mới (S20-CHAT-NEWROOM-1)", () => {
  const AN = "55555555-5555-4555-8555-555555555555";
  const anEmployee = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    userId: AN,
    employeeCode: "NV001",
    fullName: "Nguyễn Văn An",
    email: null,
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    status: "active",
    avatarUrl: null,
  };
  const pageOf = (items: unknown[]) => ({
    items,
    meta: {
      page: 1,
      pageSize: 8,
      total: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  });

  beforeEach(() => {
    openDirect.mockReset().mockResolvedValue(room("dm-an", { roomType: "direct", name: null }));
    createRoom.mockReset();
    listEmployees.mockReset().mockResolvedValue(pageOf([anEmployee]));
  });

  async function openCreateDialog(): Promise<void> {
    useChatStore.getState().syncRoomList([room("a", { name: "Nhóm A" })], false);
    useChatDockStore.getState().openDrawer();
    renderDrawer();
    fireEvent.click(await screen.findByTestId("chat-create-room"));
    await screen.findByRole("searchbox", { name: "Tìm người" });
  }

  it("«+» mở dialog; gõ tên → chọn ⇒ DM mở NGAY trong drawer, không điều hướng, drawer vẫn mở", async () => {
    await openCreateDialog();
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm người" }), {
      target: { value: "An" },
    });
    fireEvent.click(
      within(await screen.findByRole("list", { name: "Kết quả tìm người" })).getByRole("button", {
        name: /Nguyễn Văn An/,
      }),
    );

    expect(await screen.findByTestId("chat-drawer-conversation")).toBeTruthy();
    expect(openDirect).toHaveBeenCalledWith({ peerUserId: AN });
    expect(useChatDockStore.getState().openRoomIds).toEqual(["dm-an"]);
    expect(useChatDockStore.getState().isOpen).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("searchbox", { name: "Tìm người" })).toBeNull();
  });

  it("thiếu `create:chat-room` ⇒ KHÔNG có «+» trong drawer", async () => {
    grant({ createRoom: false });
    useChatDockStore.getState().openDrawer();
    renderDrawer();

    await screen.findByTestId("chat-room-list");
    expect(screen.queryByTestId("chat-create-room")).toBeNull();
  });

  it("server từ chối ⇒ dialog giữ, báo lỗi; drawer KHÔNG chuyển sang phòng rỗng", async () => {
    openDirect.mockRejectedValue(new Error("422"));
    await openCreateDialog();
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm người" }), {
      target: { value: "An" },
    });
    fireEvent.click(
      within(await screen.findByRole("list", { name: "Kết quả tìm người" })).getByRole("button", {
        name: /Nguyễn Văn An/,
      }),
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nguyễn Văn An"));
    expect(screen.getByRole("searchbox", { name: "Tìm người" })).toBeTruthy();
    expect(useChatDockStore.getState().openRoomIds).toEqual([]);
    expect(screen.queryByTestId("chat-drawer-conversation")).toBeNull();
  });

  it("Esc đóng DIALOG trước, drawer vẫn mở; Esc lần hai mới đóng drawer", async () => {
    await openCreateDialog();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("searchbox", { name: "Tìm người" })).toBeNull());
    expect(useChatDockStore.getState().isOpen).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useChatDockStore.getState().isOpen).toBe(false);
  });

  it("ngoài phạm vi danh bạ ⇒ «Không tìm thấy…» kèm gợi ý; KHÔNG gọi endpoint nào khác để «tìm hộ»", async () => {
    listEmployees.mockResolvedValue(pageOf([]));
    await openCreateDialog();
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm người" }), {
      target: { value: "Bình" },
    });

    expect(await screen.findByText("Không tìm thấy trong danh bạ bạn được xem.")).toBeTruthy();
    expect(screen.getByText(/Nhắn riêng từ một phòng chung/i)).toBeTruthy();
    expect(listEmployees).toHaveBeenCalledTimes(1);
    expect(openDirect).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
  });
});
