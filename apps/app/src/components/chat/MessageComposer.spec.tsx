/**
 * S7-CHAT-FE-2 — MessageComposer. Ba lời khẳng định đắt nhất của WO:
 *  (a) §14 gửi lỗi ⇒ **KHÔNG mất nội dung đang soạn**;
 *  (b) `clientMessageId` sinh MỘT LẦN — lần gửi thứ hai của CÙNG nháp phải mang ĐÚNG khoá cũ, nếu không
 *      server coi là tin mới và dedupe mất tác dụng hoàn toàn;
 *  (c) **S7-CHAT-BE-8** — nút đính kèm gate bằng cặp CHAT `send:chat-message`, và **KHÔNG** hỏi cặp
 *      FOUNDATION `upload:foundation-file` nữa. Test khẳng định ĐÚNG ĐỐI SỐ truyền vào `useCan` chứ
 *      không chỉ khẳng định nút ẩn/hiện: hỏi lại cặp FOUNDATION là khoá tính năng cho gần hết công ty
 *      (cặp đó chỉ có ở SA · company-admin · QUẢN LÝ CẤP CAO), mà nút ẩn/hiện thì vẫn "đúng" trong một
 *      test mà `useCan` luôn trả true.
 */
import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, useCan: vi.fn(() => true) };
});

import { useCan } from "@mediaos/web-core";
import { MessageComposer } from "./MessageComposer";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;
const ROOM = "11111111-1111-4111-8111-111111111111";

function renderComposer(props: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(true);
  render(
    <I18nextProvider i18n={i18n}>
      <MessageComposer
        roomId={ROOM}
        isArchived={false}
        replyTo={null}
        onCancelReply={vi.fn()}
        {...props}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit };
}

const textbox = () => screen.getByRole("textbox");
const sendButton = () => screen.getByLabelText("Gửi tin nhắn");

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
});

describe("MessageComposer · §14 gửi lỗi KHÔNG mất nháp", () => {
  it("onSubmit trả false ⇒ chữ người dùng gõ CÒN NGUYÊN + hiện thông điệp lỗi", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderComposer({ onSubmit });

    fireEvent.change(textbox(), { target: { value: "báo cáo quý 3 đã xong" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((textbox() as HTMLTextAreaElement).value).toBe("báo cáo quý 3 đã xong");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("onSubmit trả true ⇒ nháp được dọn", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    fireEvent.change(textbox(), { target: { value: "ok" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect((textbox() as HTMLTextAreaElement).value).toBe(""));
  });
});

describe("MessageComposer · khoá idempotency", () => {
  it("gửi lại CÙNG nháp sau khi lỗi ⇒ ĐÚNG `clientMessageId` cũ (không sinh khoá mới)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderComposer({ onSubmit });

    fireEvent.change(textbox(), { target: { value: "thử gửi" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const first = onSubmit.mock.calls[0][0].clientMessageId;
    const second = onSubmit.mock.calls[1][0].clientMessageId;
    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("tin MỚI sau khi gửi thành công ⇒ khoá KHÁC", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    fireEvent.change(textbox(), { target: { value: "tin 1" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    fireEvent.change(textbox(), { target: { value: "tin 2" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(onSubmit.mock.calls[1][0].clientMessageId).not.toBe(
      onSubmit.mock.calls[0][0].clientMessageId,
    );
  });
});

describe("MessageComposer · cổng quyền + trạng thái phòng", () => {
  it("S7-CHAT-BE-8: KHÔNG hỏi cặp FOUNDATION nữa — chỉ `send:chat-message`", () => {
    renderComposer();
    expect(mockUseCan).toHaveBeenCalledWith("send", "chat-message");
    // Đường upload giờ là `/chat/files/*` (gate `send:chat-message`). Hỏi lại cặp FOUNDATION là ẩn nút
    // của đúng những người mà server sẵn sàng phục vụ — lỗi cũ mà BE-8 sinh ra để xoá.
    expect(mockUseCan).not.toHaveBeenCalledWith("upload", "foundation-file");
  });

  it("có `send:chat-message` ⇒ hiện nút đính kèm (không cần cặp foundation nào)", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => action === "send" && resource === "chat-message",
    );
    renderComposer();
    expect(screen.getByLabelText("Chọn tệp đính kèm")).toBeTruthy();
  });

  it("thiếu `send:chat-message` ⇒ ô soạn KHOÁ + placeholder nói rõ lý do + KHÔNG hiện nút đính kèm", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "send" && resource === "chat-message"),
    );
    renderComposer();
    const box = textbox() as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toMatch(/không có quyền/i);
    // Cổng của nút đính kèm ĐÚNG BẰNG cổng của ô soạn: không gửi được thì tải tệp lên cũng vô nghĩa.
    expect(screen.queryByLabelText("Chọn tệp đính kèm")).toBeNull();
  });

  it("§14 phòng ĐÃ LƯU TRỮ ⇒ khoá ô soạn + nhãn chỉ-đọc", () => {
    renderComposer({ isArchived: true });
    expect((textbox() as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/đã lưu trữ/i)).toBeTruthy();
  });
});

describe("MessageComposer · nhập liệu", () => {
  it("nháp rỗng ⇒ nút gửi khoá (không gửi tin trắng)", () => {
    renderComposer();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("vượt 4000 ký tự ⇒ báo lỗi + khoá nút gửi", () => {
    renderComposer();
    fireEvent.change(textbox(), { target: { value: "x".repeat(4001) } });
    expect(screen.getByText(/tối đa 4000 ký tự/i)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("Enter gửi, Shift+Enter KHÔNG gửi", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    fireEvent.change(textbox(), { target: { value: "gửi bằng Enter" } });
    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("đang trả lời ⇒ payload mang `replyToMessageId`", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const replyTo = {
      id: "00000009-1111-4111-8111-111111111111",
      senderName: "Trần B",
      body: "tin gốc",
    } as never;
    renderComposer({ onSubmit, replyTo });

    fireEvent.change(textbox(), { target: { value: "trả lời đây" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].replyToMessageId).toBe("00000009-1111-4111-8111-111111111111");
  });
});

/**
 * Ca đối chứng ALLOW của `isMountedRef` (docblock trên khai báo ref trong `MessageComposer.tsx`): "đã
 * tháo thì không setState" (CI đã bắt gián tiếp) cần một ca "còn gắn thì PHẢI setState" đi kèm, nếu
 * không nhánh guard là một ca DENY không có ALLOW đối chứng — xanh rỗng, chặn nhầm CẢ đường hợp lệ.
 *
 * `<StrictMode>` (bọc toàn app ở `main.tsx`) chạy MỌI effect hai lần lúc dev: mount → cleanup → mount.
 * Nếu effect chỉ gán `isMountedRef.current = false` ở cleanup mà không gán lại `true` ở thân effect của
 * lần mount kế tiếp, ref kẹt `false` VĨNH VIỄN dù cây đang gắn bình thường — `handleSubmit` sẽ thoát sớm
 * ngay sau `await onSubmit(...)` mỗi lần gửi, dù tin ĐÃ gửi thành công: spinner không tắt, nháp không bị
 * dọn, người dùng gõ tiếp mà nút Gửi không bao giờ bật lại.
 */
describe("MessageComposer · StrictMode double-effect KHÔNG được kẹt isMountedRef", () => {
  it("gửi thành công dưới <StrictMode> ⇒ nháp XOÁ + isSending về false (nút Gửi bật lại khi có chữ mới)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <MessageComposer
            roomId={ROOM}
            isArchived={false}
            replyTo={null}
            onCancelReply={vi.fn()}
            onSubmit={onSubmit}
          />
        </I18nextProvider>
      </StrictMode>,
    );

    fireEvent.change(textbox(), { target: { value: "tin dưới StrictMode" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Nếu `isMountedRef` kẹt `false` (bug bị mở lại), TOÀN BỘ khối sau `await onSubmit(...)` — bao gồm
    // `setDraft("")` — không bao giờ chạy: nháp vẫn còn nguyên "tin dưới StrictMode".
    await waitFor(() => expect((textbox() as HTMLTextAreaElement).value).toBe(""));

    // `isSending` phải thật sự về `false`: gõ chữ MỚI thì nút Gửi phải BẬT LẠI. Nếu `isSending` kẹt
    // `true` vĩnh viễn (cùng nguyên nhân), nút này khoá mãi mãi dù nháp có nội dung hợp lệ.
    fireEvent.change(textbox(), { target: { value: "tin kế tiếp" } });
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
  });
});
