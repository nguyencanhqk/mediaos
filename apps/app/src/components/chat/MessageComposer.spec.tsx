/**
 * S7-CHAT-FE-2 — MessageComposer. Ba lời khẳng định đắt nhất của WO:
 *  (a) §14 gửi lỗi ⇒ **KHÔNG mất nội dung đang soạn**;
 *  (b) `clientMessageId` sinh MỘT LẦN — lần gửi thứ hai của CÙNG nháp phải mang ĐÚNG khoá cũ, nếu không
 *      server coi là tin mới và dedupe mất tác dụng hoàn toàn;
 *  (c) nút đính kèm gate bằng cặp `upload:foundation-file` (KHÔNG phải `send:chat-message`) — và test
 *      khẳng định ĐÚNG ĐỐI SỐ truyền vào `useCan`, không chỉ khẳng định nút ẩn/hiện.
 */
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
  it("nút đính kèm hỏi ĐÚNG cặp `upload:foundation-file` (không phải cặp CHAT)", () => {
    renderComposer();
    expect(mockUseCan).toHaveBeenCalledWith("upload", "foundation-file");
    expect(mockUseCan).toHaveBeenCalledWith("send", "chat-message");
  });

  it("thiếu `upload:foundation-file` ⇒ KHÔNG hiện nút đính kèm (dù vẫn gửi được chữ)", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) =>
        !(action === "upload" && resource === "foundation-file"),
    );
    renderComposer();
    expect(screen.queryByLabelText("Chọn tệp đính kèm")).toBeNull();
    expect((textbox() as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("có `upload:foundation-file` ⇒ hiện nút đính kèm", () => {
    renderComposer();
    expect(screen.getByLabelText("Chọn tệp đính kèm")).toBeTruthy();
  });

  it("thiếu `send:chat-message` ⇒ ô soạn KHOÁ + placeholder nói rõ lý do", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "send" && resource === "chat-message"),
    );
    renderComposer();
    const box = textbox() as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toMatch(/không có quyền/i);
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
