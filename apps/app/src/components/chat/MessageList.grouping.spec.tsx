/**
 * S8-CHAT-UX-FE-3 — `done_when #1` + `#2`, đo bằng **ĐẾM NODE AVATAR**.
 *
 * ══ VÌ SAO PHẢI ĐẾM NODE, KHÔNG PHẢI KIỂM CỜ `isGrouped` ══
 * Thuật toán gộp có từ S7 và đang đúng; thứ WO này thêm vào là **ảnh thật** trên đúng cái node đó. Một
 * bài test kiểm `isGrouped` chỉ chứng minh biến được tính đúng — nó vẫn XANH nếu ai đó vẽ avatar ở cả tin
 * gộp (ví dụ: chuyển `<Avatar>` ra ngoài nhánh `!isGrouped` để "canh lề cho đẹp"). Đếm node đo đúng thứ
 * người dùng nhìn thấy.
 *
 * `data-testid` nằm trên chính `<Avatar>`, KHÔNG trên ô bọc: ô bọc `w-8` luôn được vẽ (nó giữ chỗ thụt lề
 * cho tin gộp), nên đếm ô bọc sẽ luôn ra đúng số tin và bài test không bao giờ đỏ.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageList } from "./MessageList";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ANNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BINH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const room: ChatRoomDto = {
  id: ROOM_ID,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  refId: null,
  roomType: "group",
  name: "Phòng thử",
  roomCode: "CHAT-0001",
  description: null,
  lastMessageAt: "2026-08-04T10:00:00.000Z",
  lastMessageSeq: 10,
  isArchived: false,
  unreadCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const actions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
};

function message(
  seq: number,
  over: Partial<StoredChatMessage> & { minute?: number } = {},
): StoredChatMessage {
  const { minute = seq, ...rest } = over;
  return {
    id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
    companyId: room.companyId,
    roomId: ROOM_ID,
    senderId: ANNA,
    senderName: "An",
    body: `tin ${seq}`,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    createdAt: `2026-08-04T10:${String(minute).padStart(2, "0")}:00.000Z`,
    ...rest,
  };
}

function renderList(
  messages: readonly StoredChatMessage[],
  avatarByUser?: ReadonlyMap<string, string | null>,
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageList
        room={room}
        messages={messages}
        pending={[]}
        members={[]}
        myUserId={ANNA}
        myRole="member"
        canRecallPair={false}
        canPinPair={false}
        hasMoreOlder={false}
        isLoadingOlder={false}
        historyLimitReached={false}
        avatarByUser={avatarByUser}
        onLoadOlder={() => Promise.resolve(0)}
        onMarkRead={vi.fn()}
        onResendPending={vi.fn()}
        onDiscardPending={vi.fn()}
        actions={actions}
      />
    </I18nextProvider>,
  );
}

const avatarCount = (): number => screen.queryAllByTestId("chat-sender-avatar").length;

describe("S8-CHAT-UX-FE-3 — gộp tin liên tiếp (done_when #1)", () => {
  it("3 tin liên tiếp CÙNG người trong cửa sổ 5 phút ⇒ ĐÚNG 1 avatar", () => {
    renderList([message(1, { minute: 0 }), message(2, { minute: 1 }), message(3, { minute: 2 })]);
    expect(screen.getAllByTestId("chat-message")).toHaveLength(3);
    expect(avatarCount()).toBe(1);
  });

  it("tin thứ 3 cách tin thứ 2 QUÁ 5 phút ⇒ mở cụm mới ⇒ 2 avatar", () => {
    renderList([
      message(1, { minute: 0 }),
      message(2, { minute: 1 }),
      // 1 → 7 = 6 phút > GROUP_WINDOW_MS (5'). Đo ở NGƯỠNG chứ không ở một số bất kỳ: đây là chỗ một lần
      // đổi hằng số sẽ trôi mà không ai thấy.
      message(3, { minute: 7 }),
    ]);
    expect(avatarCount()).toBe(2);
  });

  it("xen một tin của NGƯỜI KHÁC ⇒ mỗi tin một cụm ⇒ 3 avatar", () => {
    renderList([
      message(1, { minute: 0 }),
      message(2, { minute: 1, senderId: BINH, senderName: "Bình" }),
      message(3, { minute: 2 }),
    ]);
    expect(avatarCount()).toBe(3);
  });

  it("chỉ tin ĐẦU của cụm hiện TÊN người gửi", () => {
    renderList([message(1, { minute: 0 }), message(2, { minute: 1 })]);
    expect(screen.getAllByText("An")).toHaveLength(1);
  });
});

describe("S8-CHAT-UX-FE-3 — tin hệ thống (done_when #2)", () => {
  it("tin `system` KHÔNG có avatar", () => {
    renderList([
      message(1, { minute: 0, messageType: "system", body: "An đã vào phòng", senderName: null }),
    ]);
    expect(screen.getByTestId("chat-system-message")).toBeTruthy();
    expect(avatarCount()).toBe(0);
  });

  it("tin `system` KHÔNG gộp: hai tin của An kẹp một tin hệ thống ⇒ vẫn 2 avatar", () => {
    renderList([
      message(1, { minute: 0 }),
      message(2, { minute: 1, messageType: "system", body: "Bình đã vào phòng", senderName: null }),
      message(3, { minute: 2 }),
    ]);
    // Nếu tin hệ thống bị bỏ qua khi tính gộp thì tin 3 sẽ gộp vào tin 1 và chỉ còn 1 avatar — đúng cái
    // hành vi `done_when #2` cấm.
    expect(avatarCount()).toBe(2);
  });
});

describe("S8-CHAT-UX-FE-3 — avatar người gửi lấy từ ROSTER (CHAT-DEC-019)", () => {
  it("có URL trong roster ⇒ render <img>, KHÔNG phải chữ cái đầu", () => {
    renderList([message(1, { minute: 0 })], new Map([[ANNA, "https://r2.local/signed/anna.png"]]));
    const img = screen.getByTestId("chat-sender-avatar").querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://r2.local/signed/anna.png");
  });

  it("roster CHƯA về (không có bản đồ) ⇒ rơi về chữ cái đầu, KHÔNG trắng khung chat", () => {
    renderList([message(1, { minute: 0 })]);
    const node = screen.getByTestId("chat-sender-avatar");
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toBe("An".slice(0, 2).toUpperCase());
  });

  it("người gửi VẮNG trong roster ⇒ chữ cái đầu, không ký nhầm ảnh của người khác", () => {
    renderList(
      [message(1, { minute: 0, senderId: BINH, senderName: "Bình" })],
      new Map([[ANNA, "https://r2.local/signed/anna.png"]]),
    );
    expect(screen.getByTestId("chat-sender-avatar").querySelector("img")).toBeNull();
  });
});
