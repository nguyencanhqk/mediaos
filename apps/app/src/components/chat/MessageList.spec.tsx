/**
 * S7-CHAT-FE-2 — MessageList. Điểm dễ hỏng nhất của WO: **neo cuộn khi prepend**.
 *
 * jsdom KHÔNG có layout: `scrollHeight`/`clientHeight` luôn là 0. Vì vậy ba số đó được ĐỊNH NGHĨA tay
 * trên chính phần tử cuộn, và bài test mô phỏng đúng thứ tự đời thực: cuộn lên đỉnh → nạp trang cũ →
 * `scrollHeight` mọc thêm → phép bù phải giữ nguyên tin đang nằm dưới mắt người dùng.
 *
 * Không mô phỏng được điều này thì bug "nhảy phắt xuống đáy" chỉ lộ ra trên trình duyệt thật, tức là
 * lộ ra với người dùng.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";
import type { PendingChatMessage, StoredChatMessage } from "@/stores/chat.store";
import { MessageList } from "./MessageList";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function message(seq: number): StoredChatMessage {
  return {
    id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
    companyId: room.companyId,
    roomId: ROOM_ID,
    senderId: ME,
    senderName: "Tôi",
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
    createdAt: `2026-08-04T10:${String(seq).padStart(2, "0")}:00.000Z`,
  };
}

const noopActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
};

interface HarnessProps {
  messages: readonly StoredChatMessage[];
  pending?: readonly PendingChatMessage[];
  members?: readonly ChatRoomMemberDto[];
  hasMoreOlder?: boolean;
  historyLimitReached?: boolean;
  onLoadOlder?: () => Promise<number>;
  onMarkRead?: (seq: number) => void;
  highlightMessageId?: string | null;
}

function renderList(props: HarnessProps) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageList
        room={room}
        messages={props.messages}
        pending={props.pending ?? []}
        members={props.members ?? []}
        myUserId={ME}
        myRole="member"
        canRecallPair={false}
        canPinPair={false}
        hasMoreOlder={props.hasMoreOlder ?? false}
        isLoadingOlder={false}
        historyLimitReached={props.historyLimitReached ?? false}
        onLoadOlder={props.onLoadOlder ?? (() => Promise.resolve(0))}
        onMarkRead={props.onMarkRead ?? vi.fn()}
        highlightMessageId={props.highlightMessageId ?? null}
        onResendPending={vi.fn()}
        onDiscardPending={vi.fn()}
        actions={noopActions}
      />
    </I18nextProvider>,
  );
}

/** Gắn hình học giả lên phần tử cuộn (jsdom không có layout). `scrollTop` là thuộc tính GHI ĐƯỢC. */
function stubGeometry(el: HTMLElement, scrollHeight: number, clientHeight = 300) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

describe("MessageList · neo cuộn khi nạp tin cũ", () => {
  it("bù ĐÚNG phần chiều cao vừa mọc thêm ở phía trên (không nhảy khung nhìn)", async () => {
    const older = [message(1), message(2), message(3)];
    const initial = [message(4), message(5)];
    let resolveLoad: (n: number) => void = () => {};
    const onLoadOlder = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { rerender } = renderList({ messages: initial, hasMoreOlder: true, onLoadOlder });
    const scroller = screen.getByTestId("chat-message-scroll");

    // Trước khi nạp: nội dung cao 1000, người dùng đang ở gần ĐỈNH (scrollTop = 40).
    stubGeometry(scroller, 1000);
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // Trang cũ về: nội dung cao thêm 600px và 3 tin được chèn LÊN ĐẦU.
    stubGeometry(scroller, 1600);
    await act(async () => {
      resolveLoad(3);
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageList
          room={room}
          messages={[...older, ...initial]}
          pending={[]}
          members={[]}
          myUserId={ME}
          myRole="member"
          canRecallPair={false}
          canPinPair={false}
          hasMoreOlder
          isLoadingOlder={false}
          historyLimitReached={false}
          onLoadOlder={onLoadOlder}
          onMarkRead={vi.fn()}
          onResendPending={vi.fn()}
          onDiscardPending={vi.fn()}
          actions={noopActions}
        />
      </I18nextProvider>,
    );

    // 1600 − 1000 + 40 = 640. Không bù thì scrollTop vẫn 40 và người dùng bị đẩy về đầu lịch sử.
    expect(scroller.scrollTop).toBe(640);
  });

  it("trang cũ RỖNG (added = 0) ⇒ mỏ neo bị bỏ, KHÔNG áp phép bù ở lần render sau", async () => {
    const onLoadOlder = vi.fn().mockResolvedValue(0);
    const { rerender } = renderList({
      messages: [message(4), message(5)],
      hasMoreOlder: true,
      onLoadOlder,
    });
    const scroller = screen.getByTestId("chat-message-scroll");

    stubGeometry(scroller, 1000);
    scroller.scrollTop = 30;
    await act(async () => {
      fireEvent.scroll(scroller);
    });

    // Một lần render vì lý do KHÁC (tin mới) không được kéo khung nhìn theo mỏ neo cũ.
    stubGeometry(scroller, 1200);
    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageList
          room={room}
          messages={[message(4), message(5), message(6)]}
          pending={[]}
          members={[]}
          myUserId={ME}
          myRole="member"
          canRecallPair={false}
          canPinPair={false}
          hasMoreOlder
          isLoadingOlder={false}
          historyLimitReached={false}
          onLoadOlder={onLoadOlder}
          onMarkRead={vi.fn()}
          onResendPending={vi.fn()}
          onDiscardPending={vi.fn()}
          actions={noopActions}
        />
      </I18nextProvider>,
    );
    expect(scroller.scrollTop).not.toBe(230);
  });

  it("chạm trần lịch sử ⇒ ngừng MỜI tải thêm và nói rõ (không âm thầm cắt)", () => {
    renderList({ messages: [message(4)], hasMoreOlder: true, historyLimitReached: true });
    expect(screen.queryByText("Tải tin cũ hơn")).toBeNull();
    expect(screen.getByText(/Đã tải tối đa/)).toBeTruthy();
  });

  it("hết lịch sử ⇒ báo 'đầu cuộc trò chuyện', không còn nút tải thêm", () => {
    renderList({ messages: [message(1)], hasMoreOlder: false });
    expect(screen.getByText(/phần đầu của cuộc trò chuyện/i)).toBeTruthy();
  });
});

describe("MessageList · đánh dấu đã đọc", () => {
  it("ở gần đáy ⇒ báo đọc tới `roomSeq` của tin CUỐI", () => {
    const onMarkRead = vi.fn();
    renderList({ messages: [message(4), message(5)], onMarkRead });
    expect(onMarkRead).toHaveBeenCalledWith(5);
  });

  it("tab đang ở NỀN ⇒ KHÔNG báo đọc (mở 5 tab không được tắt sạch badge)", () => {
    const spy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const onMarkRead = vi.fn();
    renderList({ messages: [message(4), message(5)], onMarkRead });
    expect(onMarkRead).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("MessageList · bong bóng lạc quan (§14)", () => {
  it("đang gửi ⇒ hiện nội dung + nhãn 'Đang gửi…', KHÔNG có nút gửi lại", () => {
    renderList({
      messages: [message(4)],
      pending: [
        {
          clientMessageId: "c1",
          roomId: ROOM_ID,
          body: "đang bay",
          createdAt: "2026-08-04T10:06:00.000Z",
          status: "sending",
        },
      ],
    });
    expect(screen.getByTestId("chat-pending-sending")).toBeTruthy();
    expect(screen.getByText("đang bay")).toBeTruthy();
    expect(screen.queryByText("Gửi lại")).toBeNull();
  });

  it("gửi lỗi ⇒ GIỮ nguyên nội dung + có 'Gửi lại' và 'Bỏ tin này'", () => {
    const onResend = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <MessageList
          room={room}
          messages={[message(4)]}
          pending={[
            {
              clientMessageId: "c2",
              roomId: ROOM_ID,
              body: "nội dung quý giá",
              createdAt: "2026-08-04T10:06:00.000Z",
              status: "failed",
            },
          ]}
          members={[]}
          myUserId={ME}
          myRole="member"
          canRecallPair={false}
          canPinPair={false}
          hasMoreOlder={false}
          isLoadingOlder={false}
          historyLimitReached={false}
          onLoadOlder={() => Promise.resolve(0)}
          onMarkRead={vi.fn()}
          onResendPending={onResend}
          onDiscardPending={vi.fn()}
          actions={noopActions}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("nội dung quý giá")).toBeTruthy();
    fireEvent.click(screen.getByText("Gửi lại"));
    expect(onResend).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: "c2" }));
    expect(screen.getByText("Bỏ tin này")).toBeTruthy();
  });
});

describe("MessageList · đã xem bởi (§13.2 — dẫn xuất, không bảng riêng)", () => {
  it("chỉ tính thành viên có `lastReadSeq >= roomSeq`, trừ chính mình", () => {
    renderList({
      messages: [message(5)],
      members: [
        { id: "m1", roomId: ROOM_ID, userId: ME, role: "member", joinedAt: "", lastReadSeq: 9 },
        {
          id: "m2",
          roomId: ROOM_ID,
          userId: "u2",
          role: "member",
          joinedAt: "",
          userName: "Trần B",
          lastReadSeq: 5,
        },
        {
          id: "m3",
          roomId: ROOM_ID,
          userId: "u3",
          role: "member",
          joinedAt: "",
          userName: "Lê C",
          lastReadSeq: 4,
        },
      ] as unknown as ChatRoomMemberDto[],
    });
    const seen = screen.getByText(/Đã xem/);
    expect(seen.textContent).toContain("Trần B");
    expect(seen.textContent).not.toContain("Lê C");
  });
});

/**
 * S7-CHAT-FE-4 — tin đích của một lần nhảy.
 *
 * Ca thứ hai là ca thật sự đắt: lần vẽ ĐẦU của một cửa sổ ngữ cảnh trùng đúng nhánh "tin mới tới ⇒ cuộn
 * xuống đáy" của FE-2. Không chặn nhánh đó thì người dùng bấm một kết quả ở giữa lịch sử và bị ném
 * thẳng xuống đáy cửa sổ — thao tác họ vừa làm bị huỷ bởi chính màn hình vừa mở ra cho họ.
 */
describe("MessageList · làm nổi tin đích (S7-CHAT-FE-4)", () => {
  it("chỉ tin đích được đánh dấu, và nó được cuộn tới", () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const target = message(2);

    renderList({ messages: [message(1), target, message(3)], highlightMessageId: target.id });

    const marked = document.querySelectorAll('[data-highlighted="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector(`[data-message-id="${target.id}"]`)).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("có tin đích ⇒ KHÔNG tự cuộn xuống đáy khi danh sách đổi", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    // Vẽ lần đầu KHÔNG có tin đích, rồi mới gắn hình học giả: `scrollHeight` của jsdom là 0, nên đo
    // ngay sau lần vẽ đầu thì `scrollTop` bằng 0 dù nhánh cuộn-xuống-đáy CÓ chạy — ca xanh-giả.
    const { rerender } = renderList({ messages: [message(1)] });
    const scroller = screen.getByTestId("chat-message-scroll");
    stubGeometry(scroller, 2000);

    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageList
          room={room}
          messages={[message(1), message(2)]}
          pending={[]}
          members={[]}
          myUserId={ME}
          myRole="member"
          canRecallPair={false}
          canPinPair={false}
          hasMoreOlder={false}
          isLoadingOlder={false}
          historyLimitReached={false}
          highlightMessageId={message(1).id}
          onLoadOlder={() => Promise.resolve(0)}
          onMarkRead={vi.fn()}
          onResendPending={vi.fn()}
          onDiscardPending={vi.fn()}
          actions={noopActions}
        />
      </I18nextProvider>,
    );

    // `scrollToBottom` gán `scrollTop = scrollHeight` (2000). Nhánh đó phải KHÔNG chạy.
    expect(scroller.scrollTop).toBe(0);
  });

  it("tin đích KHÔNG có trong danh sách ⇒ không cuộn, không nổ", () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderList({ messages: [message(1)], highlightMessageId: message(9).id });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
  });
});
