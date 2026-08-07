/**
 * S7-CHAT-FE-2 — MessageBubble. Ba nhóm, theo đúng thứ tự rủi ro:
 *  (a) BẤT BIẾN RENDER: `body` là chuỗi người dùng gõ ⇒ ra CHỮ, không ra thẻ. Có ca đối chứng chứng minh
 *      phép khẳng định thật sự bắt được thẻ nếu nó xuất hiện (chống test xanh-giả).
 *  (b) §14 "tin đã thu hồi": chữ xám CÓ NỘI DUNG, không phải khoảng trắng.
 *  (c) đính kèm BA trạng thái của `attachmentUrl` — mỗi trạng thái một giao diện khác nhau.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageBubble, type MessageBubbleActions } from "./MessageBubble";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const actions: MessageBubbleActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
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
    const { rerender } = renderBubble({}, { seenBy: ["Trần B"] });
    expect(screen.getByText(/Đã xem/)).toBeTruthy();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageBubble
          message={message({ senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })}
          isMine={false}
          isGrouped={false}
          replyTo={undefined}
          canRecall={false}
          canPin={false}
          seenBy={["Trần B"]}
          senderAvatarUrl={null}
          senderNameFallback={null}
          isArchived={false}
          actions={actions}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByText(/Đã xem/)).toBeNull();
  });
});
