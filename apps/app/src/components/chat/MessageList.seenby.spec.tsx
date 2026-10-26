/**
 * S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — `MessageList` nối `seenByStatusOf` vào bong bóng CỦA TÔI.
 *
 * Đo ở tầng danh sách vì đây là nơi luật «người nhận của MỘT tin» gặp dữ liệu thật: `roomSeq` +
 * `createdAt` của từng tin, `members` của phòng, và trạng thái tải roster do trang truyền xuống.
 * Tin của người khác không được có nút mở bảng — kể cả khi roster đầy đủ.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageList } from "./MessageList";
import type { SeenByRosterStatus } from "./seen-by-status";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "u0";
const SENT_AT = "2026-10-20T09:00:00.000Z";

const room: ChatRoomDto = {
  id: ROOM_ID,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  refId: null,
  roomType: "department",
  name: "Phòng ban",
  roomCode: "CHAT-0009",
  description: null,
  lastMessageAt: SENT_AT,
  lastMessageSeq: 51,
  isArchived: false,
  unreadCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function message(seq: number, senderId: string, body: string): StoredChatMessage {
  return {
    id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
    companyId: room.companyId,
    roomId: ROOM_ID,
    senderId,
    senderName: senderId === ME ? "Tôi" : "Người 0",
    body,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    createdAt: SENT_AT,
  };
}

function member(userId: string, lastReadSeq: number, joinedAt = "2026-10-01T00:00:00.000Z") {
  return {
    id: `m-${userId}`,
    roomId: ROOM_ID,
    userId,
    role: "member",
    joinedAt,
    userName: userId === ME ? "Tôi" : `Người ${userId.slice(1)}`,
    lastReadSeq,
  } as ChatRoomMemberDto;
}

/** Phòng 10 người: tôi + 9 người, 7 người (u0…u6) đã đọc tới tin 50, u7 · u8 thì chưa. */
const TEN_PEOPLE: ChatRoomMemberDto[] = [
  member(ME, 51),
  ...Array.from({ length: 9 }, (_, i) => member(`u${i}`, i < 7 ? 51 : 49)),
];

function renderList(
  messages: readonly StoredChatMessage[],
  members: readonly ChatRoomMemberDto[],
  membersStatus?: SeenByRosterStatus,
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageList
        room={room}
        messages={messages}
        pending={[]}
        members={members}
        membersStatus={membersStatus}
        myUserId={ME}
        myRole="member"
        canRecallPair={false}
        canPinPair={false}
        hasMoreOlder={false}
        isLoadingOlder={false}
        historyLimitReached={false}
        onLoadOlder={() => Promise.resolve(0)}
        onMarkRead={vi.fn()}
        onResendPending={vi.fn()}
        onDiscardPending={vi.fn()}
        actions={{
          onReply: vi.fn(),
          onPin: vi.fn(),
          onUnpin: vi.fn(),
          onRecall: vi.fn(),
          onToggleReaction: vi.fn(),
          onCopy: vi.fn(),
        }}
      />
    </I18nextProvider>,
  );
}

describe("MessageList · «Đã xem · Chưa xem» trên tin của tôi", () => {
  it("phòng 10 người, 7 đã đọc ⇒ «Đã xem (7)» / «Chưa xem (2)», không tính tôi", () => {
    renderList([message(50, ME, "thông báo họp")], TEN_PEOPLE);

    fireEvent.click(screen.getByTestId("chat-seen-by"));

    expect(screen.getByRole("tab", { name: "Đã xem (7)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Chưa xem (2)" }));
    const rows = screen.getAllByTestId("chat-unseen-row").map((r) => r.textContent ?? "");
    expect(rows).toEqual([expect.stringContaining("Người 7"), expect.stringContaining("Người 8")]);
    expect(rows.join(" ")).not.toContain("Tôi");
  });

  it("người vào phòng SAU lúc gửi không nằm trong «Chưa xem»", () => {
    renderList(
      [message(50, ME, "thông báo họp")],
      [...TEN_PEOPLE, member("u9", 0, "2026-10-20T10:00:00.000Z")],
    );

    fireEvent.click(screen.getByTestId("chat-seen-by"));
    fireEvent.click(screen.getByRole("tab", { name: "Chưa xem (2)" }));
    const panel = screen.getByTestId("chat-seen-panel");
    expect(within(panel).queryByText(/Người 9/)).toBeNull();
  });

  it("tin của người khác ⇒ không có nút mở bảng, dù roster đầy đủ", () => {
    renderList([message(50, OTHER, "tin của người 0")], TEN_PEOPLE);
    expect(screen.queryByTestId("chat-seen-by")).toBeNull();
  });

  it("roster lỗi ⇒ bảng báo «Không tải được danh sách», không vẽ tên ai", () => {
    renderList([message(50, ME, "thông báo họp")], TEN_PEOPLE, "error");

    fireEvent.click(screen.getByTestId("chat-seen-by"));
    const panel = screen.getByTestId("chat-seen-panel");
    expect(panel.textContent).toContain("Không tải được danh sách");
    expect(panel.textContent).not.toMatch(/Người \d/);
  });

  it("roster đang tải ⇒ bảng báo đang tải, không có tab", () => {
    renderList([message(50, ME, "thông báo họp")], [], "loading");

    fireEvent.click(screen.getByTestId("chat-seen-by"));
    expect(screen.getByTestId("chat-seen-panel").textContent).toContain("Đang tải danh sách");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
