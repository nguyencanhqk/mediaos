/**
 * S7-CHAT-FE-2 — MessageBubble. Ba nhóm, theo đúng thứ tự rủi ro:
 *  (a) BẤT BIẾN RENDER: `body` là chuỗi người dùng gõ ⇒ ra CHỮ, không ra thẻ. Có ca đối chứng chứng minh
 *      phép khẳng định thật sự bắt được thẻ nếu nó xuất hiện (chống test xanh-giả).
 *  (b) §14 "tin đã thu hồi": chữ xám CÓ NỘI DUNG, không phải khoảng trắng.
 *  (c) đính kèm BA trạng thái của `attachmentUrl` — mỗi trạng thái một giao diện khác nhau.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Mot nguoi da doc toi tin — hinh dang `SeenByViewer` cua S17 (id · ten · anh roster). */
const SEEN_TRAN_B = {
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Trần B",
  avatarUrl: null,
};

const actions: MessageBubbleActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
  onCopy: vi.fn(),
};

function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: "11111111-1111-4111-8111-111111111111",
    senderId: ME,
    senderName: "Nguyễn Văn A",
    body: "xin chào",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-08-04T10:00:00.000Z",
    ...over,
  };
}

function renderBubble(
  over: Partial<StoredChatMessage> = {},
  props: Partial<Parameters<typeof MessageBubble>[0]> = {},
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MessageBubble
        message={message(over)}
        isMine
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
        {...props}
      />
    </I18nextProvider>,
  );
}

describe("MessageBubble · body render VĂN BẢN THUẦN", () => {
  it("payload HTML hiện ra dưới dạng CHỮ, không sinh phần tử nào", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = renderBubble({ body: payload });

    expect(screen.getByText(payload)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("ĐỐI CHỨNG: phép khẳng định trên THẬT SỰ bắt được thẻ (không xanh-giả)", () => {
    // Nếu ai đó thay text node bằng `dangerouslySetInnerHTML`, `container.querySelector('img')` sẽ khác
    // null. Ca này chứng minh selector đó phân biệt được hai tình huống.
    const { container } = render(
      <div dangerouslySetInnerHTML={{ __html: '<img src="x" alt="" />' }} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("`javascript:` KHÔNG thành href — không có <a> nào trong bong bóng", () => {
    const { container } = renderBubble({ body: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
  });

  it("https thành <a> với rel noopener noreferrer nofollow + target _blank", () => {
    const { container } = renderBubble({ body: "xem https://mediaos.vn/a" });
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://mediaos.vn/a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });
});

describe("MessageBubble · §14 tin đã thu hồi", () => {
  it("hiện CHỮ 'Tin nhắn đã được thu hồi', KHÔNG phải khoảng trắng", () => {
    renderBubble({ body: null, recalledAt: "2026-08-04T10:05:00.000Z" });
    const el = screen.getByTestId("chat-message-recalled");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
    expect(el.textContent).toContain("thu hồi");
  });

  it("tin thu hồi KHÔNG render đính kèm dù mảng còn dữ liệu", () => {
    renderBubble({
      body: null,
      recalledAt: "2026-08-04T10:05:00.000Z",
      attachments: [
        {
          id: "aaaaaaa1-1111-4111-8111-111111111111",
          fileId: "aaaaaaa2-1111-4111-8111-111111111111",
          name: "hop-dong.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          isImage: false,
          url: "https://storage/x",
          thumbnailUrl: null,
        },
      ],
    });
    expect(screen.queryByText("hop-dong.pdf")).toBeNull();
  });

  it("tin đã thu hồi KHÔNG hiện nút tác vụ (không trả lời/ghim/thu hồi lần hai)", () => {
    renderBubble(
      { body: null, recalledAt: "2026-08-04T10:05:00.000Z" },
      { canPin: true, canRecall: true },
    );
    expect(screen.queryByLabelText("Trả lời")).toBeNull();
  });
});

describe("MessageBubble · đính kèm BA trạng thái", () => {
  const rest = {
    id: "aaaaaaa1-1111-4111-8111-111111111111",
    fileId: "aaaaaaa2-1111-4111-8111-111111111111",
    name: "bao-cao.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    isImage: false,
  };

  it("url = string ⇒ tải được (có <a href>)", () => {
    const { container } = renderBubble({
      attachments: [{ ...rest, url: "https://storage/signed", thumbnailUrl: null }],
    });
    expect(container.querySelector('a[href="https://storage/signed"]')).not.toBeNull();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("url = null (server TỪ CHỐI ký) ⇒ 'Tệp không tải được', KHÔNG có nút tải chết", () => {
    const { container } = renderBubble({
      attachments: [{ ...rest, url: null, thumbnailUrl: null }],
    });
    expect(screen.getByText(/không tải được/i)).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
  });

  it("url = undefined (tin đến từ WS) ⇒ 'đang lấy liên kết', KHÔNG nói 'không tải được'", () => {
    // Payload WS CỐ Ý không có khoá `url` — đây là hình dạng `wsChatAttachmentSchema`.
    renderBubble({ attachments: [{ ...rest }] });
    expect(screen.getByText(/đang lấy liên kết/i)).toBeTruthy();
    expect(screen.queryByText(/không tải được/i)).toBeNull();
  });
});

describe("MessageBubble · phụ trợ", () => {
  it("tin hệ thống: canh giữa, không avatar, không tác vụ", () => {
    renderBubble({ messageType: "system", body: "A đã được thêm vào phòng" }, { canPin: true });
    expect(screen.getByTestId("chat-system-message")).toBeTruthy();
    expect(screen.queryByLabelText("Trả lời")).toBeNull();
  });

  it("trả lời một tin NGOÀI lịch sử đã tải ⇒ nói rõ, không hiện trích dẫn rỗng", () => {
    renderBubble({ replyToMessageId: "00000009-1111-4111-8111-111111111111" });
    expect(screen.getByText(/không còn trong phần đã tải/i)).toBeTruthy();
  });

  it("'đã xem bởi' chỉ hiện trên tin CỦA MÌNH", () => {
    // S17: «đã xem» là DÃY AVATAR, không còn là text node ⇒ đo bằng nhãn trợ năng (`aria-label`) — chính là
    // thứ phải còn lại cho người đọc màn hình sau khi đổi sang ảnh.
    const { rerender } = renderBubble({}, { seenBy: [SEEN_TRAN_B] });
    expect(screen.getByLabelText(/Đã xem/)).toBeTruthy();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageBubble
          message={message({ senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })}
          isMine={false}
          isGrouped={false}
          isLastOfGroup
          replyTo={undefined}
          canRecall={false}
          canPin={false}
          seenBy={[SEEN_TRAN_B]}
          senderAvatarUrl={null}
          senderNameFallback={null}
          isArchived={false}
          actions={actions}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByLabelText(/Đã xem/)).toBeNull();
  });
});

// ── S17-CHAT-UX2-FE-2 — bố cục hai phía + thanh tác vụ nổi (CHAT-DEC-024) ────────────────────────────

describe("MessageBubble v2 · hai phía (done_when #1)", () => {
  it("tin CỦA TÔI: đánh dấu `data-mine`, KHÔNG có avatar (vị trí đã nói ai gửi)", () => {
    renderBubble();
    expect(screen.getByTestId("chat-message").getAttribute("data-mine")).toBe("true");
    expect(screen.queryByTestId("chat-sender-avatar")).toBeNull();
  });

  it("tin NGƯỜI KHÁC: có avatar bên trái + hiện TÊN người gửi", () => {
    renderBubble({}, { isMine: false });
    expect(screen.getByTestId("chat-message").getAttribute("data-mine")).toBe("false");
    expect(screen.getByTestId("chat-sender-avatar")).toBeTruthy();
    expect(screen.getByText("Nguyễn Văn A")).toBeTruthy();
  });

  it("hai phía dùng HAI nền token khác nhau (không cùng một lớp ⇒ 'hai phía' mới có nghĩa)", () => {
    const mine = renderBubble().getByTestId("chat-message-body-shell").className;
    const theirs = renderBubble({}, { isMine: false }).getAllByTestId("chat-message-body-shell")[1]
      .className;
    expect(mine).toContain("bg-bubble-mine");
    expect(theirs).toContain("bg-surface-2");
    expect(mine).not.toBe(theirs);
  });

  it("tin gộp của NGƯỜI KHÁC ⇒ không lặp avatar, nhưng NHÃN GHIM vẫn thấy được", () => {
    // Hàng tên (chỗ bám của nhãn ghim ở tin đầu cụm) không tồn tại ở tin gộp — nhãn phải chuyển vào
    // trong bong bóng, nếu không thì ghim một tin gộp là ghim xong mà không có dấu vết nào.
    renderBubble(
      { pinnedAt: "2026-08-04T10:01:00.000Z" },
      { isMine: false, isGrouped: true },
    );
    expect(screen.queryByTestId("chat-sender-avatar")).toBeNull();
    expect(screen.getByText("Đã ghim")).toBeTruthy();
  });
});

describe("MessageBubble v2 · giờ theo cụm (done_when #1)", () => {
  it("tin CUỐI cụm ⇒ giờ hiện thường trực", () => {
    renderBubble({}, { isLastOfGroup: true });
    expect(screen.getByTestId("chat-message-clock").className).toContain("opacity-100");
  });

  it("tin GIỮA cụm ⇒ giờ ẩn, chỉ lộ khi trỏ vào (không lặp cùng một con số 8 lần)", () => {
    renderBubble({}, { isLastOfGroup: false });
    const cls = screen.getByTestId("chat-message-clock").className;
    expect(cls).toContain("opacity-0");
    expect(cls).toContain("group-hover:opacity-100");
  });

  it("giờ luôn có `dateTime` máy đọc được, dù đang ẩn", () => {
    renderBubble({}, { isLastOfGroup: false });
    expect(screen.getByTestId("chat-message-clock").getAttribute("dateTime")).toBe(
      "2026-08-04T10:00:00.000Z",
    );
  });
});

describe("MessageBubble v2 · thanh tác vụ nổi (done_when #3)", () => {
  it("ẩn thì KHÔNG ăn chuột (thanh ở -top-3 chồng lên tin phía trên)", () => {
    renderBubble();
    const cls = screen.getByTestId("chat-message-actions").className;
    expect(cls).toContain("pointer-events-none");
    expect(cls).toContain("group-hover:pointer-events-auto");
    // …nhưng hiện lại khi HỘI TỤ bàn phím — đây là vế giữ tác vụ sống với người không dùng chuột.
    expect(cls).toContain("focus-within:pointer-events-auto");
    expect(cls).toContain("focus-within:opacity-100");
  });

  it("👍 nhanh gọi ĐÚNG emoji `like` kèm trạng thái hiện tại (chưa thả ⇒ currentlyMine=false)", () => {
    const onToggleReaction = vi.fn();
    renderBubble({}, { actions: { ...actions, onToggleReaction } });
    fireEvent.click(screen.getByTestId("chat-message-quick-like"));
    expect(onToggleReaction).toHaveBeenCalledWith(expect.anything(), "like", false);
  });

  it("ĐÃ thả 👍 ⇒ nút ở trạng thái bật (`aria-pressed`) và gửi currentlyMine=true để BỎ thả", () => {
    const onToggleReaction = vi.fn();
    renderBubble(
      { reactions: [{ emoji: "like", count: 1, mine: true }] },
      { actions: { ...actions, onToggleReaction } },
    );
    const btn = screen.getByTestId("chat-message-quick-like");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onToggleReaction).toHaveBeenCalledWith(expect.anything(), "like", true);
  });

  it("phòng đã LƯU TRỮ ⇒ không có 👍 nhanh (giữ đúng luật chỉ-đọc của ReactionBar)", () => {
    renderBubble({}, { isArchived: true });
    expect(screen.queryByTestId("chat-message-quick-like")).toBeNull();
  });

  it("cổng: thiếu `canPin`/`canRecall` ⇒ ẩn nút, có ⇒ hiện (ca DENY kèm ca ALLOW)", () => {
    renderBubble();
    expect(screen.queryByLabelText("Ghim")).toBeNull();
    expect(screen.queryByLabelText("Thu hồi")).toBeNull();

    renderBubble({}, { canPin: true, canRecall: true });
    expect(screen.getByLabelText("Ghim")).toBeTruthy();
    expect(screen.getByLabelText("Thu hồi")).toBeTruthy();
  });

  it("mục `⋯ › Sao chép` báo lên caller (clipboard do panel ghi, để nó báo được lỗi)", () => {
    const onCopy = vi.fn();
    renderBubble({}, { actions: { ...actions, onCopy } });
    fireEvent.click(screen.getByTestId("chat-message-more"));
    fireEvent.click(screen.getByTestId("chat-message-copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("tin KHÔNG có phần chữ (chỉ tệp) ⇒ không có mục Sao chép — không mời chép chuỗi rỗng", () => {
    renderBubble({ body: null });
    expect(screen.queryByTestId("chat-message-more")).toBeNull();
  });

  it("tin đã THU HỒI ⇒ không có thanh tác vụ nào cả", () => {
    renderBubble(
      { body: null, recalledAt: "2026-08-04T10:05:00.000Z" },
      { canPin: true, canRecall: true },
    );
    expect(screen.queryByTestId("chat-message-actions")).toBeNull();
  });
});
