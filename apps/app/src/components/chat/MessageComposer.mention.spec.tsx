/**
 * S17-CHAT-UX2-FE-3 — `@mention` ở tầng component (SPEC-15 §22c CHAT-DEC-027 · §10 CHAT-FUNC-024).
 *
 * Luật thuần đã đo ở `use-mention-autocomplete.spec.ts`. File này đo đúng những gì chỉ dựng cây React
 * mới thấy được:
 *  (a) **payload** thật sự mang `mentions` nào — và mang MẢNG RỖNG sau khi người dùng xoá chữ;
 *  (b) Enter khi popover mở phải **CHỌN** gợi ý chứ KHÔNG gửi tin (gửi ở đây là gửi một tin viết dở);
 *  (c) `role="textbox"` vẫn **DUY NHẤT** — bất biến B5, cả họ spec S7 đứng trên `getByRole("textbox")`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    // Gõ chữ ⇒ ping "đang gõ" ⇒ `apiFetch` thật ⇒ 401 ⇒ `redirectToAuth` điều hướng jsdom. Tiếng ồn đó
    // không thuộc phép đo nào ở đây, và một promise bị từ chối SAU teardown đủ làm cả run đỏ
    // (memory `vitest-unhandled-rejection-after-teardown`).
    chatApi: { ...actual.chatApi, pingTyping: vi.fn().mockResolvedValue(undefined) },
  };
});

import { useCan } from "@mediaos/web-core";
import { MessageComposer } from "./MessageComposer";
import type { MentionCandidate } from "./use-mention-autocomplete";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;
const ROOM = "11111111-1111-4111-8111-111111111111";
const NAM_ID = "00000001-1111-4111-8111-111111111111";
const NGA_ID = "00000002-1111-4111-8111-111111111112";

const CANDIDATES: MentionCandidate[] = [
  { userId: NAM_ID, name: "Nguyễn Văn Nam", avatarUrl: null },
  { userId: NGA_ID, name: "Trần Nga", avatarUrl: null },
];

function renderComposer(props: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(true);
  render(
    <I18nextProvider i18n={i18n}>
      <MessageComposer
        roomId={ROOM}
        isArchived={false}
        replyTo={null}
        onCancelReply={vi.fn()}
        mentionCandidates={CANDIDATES}
        {...props}
        onSubmit={onSubmit}
      />
    </I18nextProvider>,
  );
  return { onSubmit };
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const sendButton = () => screen.getByLabelText("Gửi tin nhắn");
const type = (value: string) => fireEvent.change(textbox(), { target: { value } });

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
});

describe("MessageComposer · popover gợi ý mention", () => {
  it("gõ `@ng` ⇒ mở listbox với đúng người khớp", async () => {
    renderComposer();
    type("chào @ng");

    const list = await screen.findByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(list).toBeTruthy();
    // `textContent` gồm cả chữ cái đầu của `<Avatar>` ("NN…") — so bằng `toContain` theo TÊN, không so
    // nguyên chuỗi, để đổi cách vẽ avatar không làm đỏ một ca đang đo chuyện khác.
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Nguyễn Văn Nam");
    expect(options[1].textContent).toContain("Trần Nga");
  });

  it("`@zzz` không khớp ai ⇒ KHÔNG mở popover", () => {
    renderComposer();
    type("@zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("EMAIL `ten@congty` ⇒ KHÔNG mở popover", () => {
    renderComposer();
    type("gửi ten@congty");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("B5: popover mở mà `role=textbox` vẫn DUY NHẤT (không thêm ô nhập thứ hai)", async () => {
    renderComposer();
    type("@n");
    await screen.findByRole("listbox");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("RỜI TIÊU ĐIỂM khỏi ô soạn ⇒ popover ĐÓNG (không treo lơ lửng tới phím kế tiếp)", async () => {
    renderComposer();
    type("@ng");
    await screen.findByRole("listbox");

    fireEvent.blur(textbox());
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("a11y: `aria-activedescendant` trỏ đúng option đang chọn, tiêu điểm KHÔNG rời textarea", async () => {
    renderComposer();
    type("@n");
    await screen.findByRole("listbox");

    const options = screen.getAllByRole("option");
    expect(textbox().getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(textbox().getAttribute("aria-activedescendant")).toBe(
        screen.getAllByRole("option")[1].id,
      ),
    );
  });
});

describe("MessageComposer · chọn gợi ý ⇒ chèn chữ + gửi `mentions[]`", () => {
  it("chọn bằng chuột ⇒ nháp có `@Tên ` VÀ payload mang đúng userId", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("chào @ng");
    await screen.findByRole("listbox");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);

    await waitFor(() => expect(textbox().value).toBe("chào @Nguyễn Văn Nam "));
    // Popover phải ĐÓNG ngay sau khi chọn — con trỏ đứng sau `@Tên ` nên dò lại sẽ mở đúng cái vừa chọn.
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].mentions).toEqual([NAM_ID]);
    expect(onSubmit.mock.calls[0][0].body).toBe("chào @Nguyễn Văn Nam ");
  });

  it("Enter khi popover MỞ ⇒ CHỌN gợi ý, KHÔNG gửi tin", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("@ng");
    await screen.findByRole("listbox");
    fireEvent.keyDown(textbox(), { key: "Enter" });

    await waitFor(() => expect(textbox().value).toBe("@Nguyễn Văn Nam "));
    expect(onSubmit).not.toHaveBeenCalled();

    // …và Enter LẦN HAI (popover đã đóng) thì gửi bình thường — ca đối chứng, không có nó thì một
    // `return` vô điều kiện trong `onKeyDown` cũng làm ca trên xanh.
    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("↑↓ đổi lựa chọn rồi Enter ⇒ chèn ĐÚNG người thứ hai", async () => {
    renderComposer();
    type("@n");
    await screen.findByRole("listbox");

    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    fireEvent.keyDown(textbox(), { key: "Enter" });

    await waitFor(() => expect(textbox().value).toBe("@Trần Nga "));
  });

  it("Esc ⇒ đóng popover, Enter sau đó gửi tin", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("@ng");
    await screen.findByRole("listbox");
    fireEvent.keyDown(textbox(), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    fireEvent.keyDown(textbox(), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].body).toBe("@ng");
    expect(onSubmit.mock.calls[0][0].mentions).toEqual([]);
  });
});

describe("MessageComposer · `mentions[]` đi theo CHỮ, không theo lượt chọn", () => {
  it("chọn `@Nguyễn Văn Nam` rồi XOÁ chữ đó ⇒ payload `mentions` RỖNG", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("@ng");
    await screen.findByRole("listbox");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(textbox().value).toBe("@Nguyễn Văn Nam "));

    // Người dùng xoá đúng đoạn `@Tên` đi rồi viết lại — id KHÔNG được đi theo nữa.
    type("thôi không nhắc ai");
    fireEvent.click(sendButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].mentions).toEqual([]);
  });

  it("gửi thành công ⇒ tin KẾ TIẾP không mang lại mention của tin trước", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("@ng");
    await screen.findByRole("listbox");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(textbox().value).toBe("@Nguyễn Văn Nam "));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].mentions).toEqual([NAM_ID]);

    // Người dùng gõ LẠI đúng chuỗi đó bằng tay ở tin sau. Bảng lượt chọn đã bị dọn ⇒ không id nào.
    type("@Nguyễn Văn Nam ơi");
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].mentions).toEqual([]);
  });

  it("không nhắc ai ⇒ `mentions` là mảng RỖNG (không phải `undefined`)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderComposer({ onSubmit });

    type("tin thường");
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].mentions).toEqual([]);
  });

  it("gửi LỖI ⇒ giữ nguyên nháp VÀ mention, gửi lại mang đúng id cũ (§14 + B1)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderComposer({ onSubmit });

    type("@ng");
    await screen.findByRole("listbox");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(textbox().value).toBe("@Nguyễn Văn Nam "));

    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(onSubmit.mock.calls[1][0].mentions).toEqual([NAM_ID]);
    expect(onSubmit.mock.calls[1][0].clientMessageId).toBe(
      onSubmit.mock.calls[0][0].clientMessageId,
    );
  });
});

describe("MessageComposer · không có ứng viên ⇒ tính năng tự tắt", () => {
  it("roster rỗng (mọi người đã rời) ⇒ gõ `@` không mở gì cả", () => {
    renderComposer({ mentionCandidates: [] });
    type("@");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
