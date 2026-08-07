/**
 * S8-CHAT-UX-FE-3 — ping "đang gõ" (`done_when #4`: FE tiết lưu 3 s, KHÔNG mỗi phím một request).
 *
 * Đây là bài test về SỐ LƯỢNG REQUEST, không phải về giao diện. Không có nó thì hồi quy "mỗi phím một
 * `POST`" hoàn toàn vô hình ở FE: giao diện y hệt, và triệu chứng duy nhất là tải server tăng theo tốc độ
 * gõ của cả công ty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: { ...actual.chatApi, pingTyping: vi.fn().mockResolvedValue(undefined) },
  };
});

import { chatApi } from "@mediaos/web-core";
import { MessageComposer } from "./MessageComposer";
import { TYPING_PING_THROTTLE_MS } from "@/routes/chat/constants";

const pingTyping = chatApi.pingTyping as unknown as ReturnType<typeof vi.fn>;
const ROOM = "11111111-1111-4111-8111-111111111111";

function renderComposer(over: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <MessageComposer
        roomId={ROOM}
        isArchived={false}
        replyTo={null}
        onCancelReply={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(true)}
        {...over}
      />
    </I18nextProvider>,
  );
}

const type = (value: string): void => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
};

beforeEach(() => {
  pingTyping.mockClear();
  pingTyping.mockResolvedValue(undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-07T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("tiết lưu ping đang gõ", () => {
  it("5 phím liên tiếp trong cùng một khoảnh khắc ⇒ ĐÚNG 1 request", () => {
    renderComposer();
    for (const value of ["x", "xi", "xin", "xin ", "xin c"]) type(value);
    expect(pingTyping).toHaveBeenCalledTimes(1);
    expect(pingTyping).toHaveBeenCalledWith(ROOM);
  });

  it("gõ tiếp SAU khi hết khoảng tiết lưu ⇒ ping lần hai", () => {
    renderComposer();
    type("a");
    expect(pingTyping).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + TYPING_PING_THROTTLE_MS + 1);
    type("ab");
    expect(pingTyping).toHaveBeenCalledTimes(2);
  });

  it("leading-edge: phím ĐẦU TIÊN bắn ngay, không chờ hết 3 s", () => {
    renderComposer();
    type("a");
    // Không `advanceTimers` mà đã có request ⇒ đúng leading-edge. Trailing-edge sẽ là 0 ở đây, và người
    // nhận chỉ thấy chỉ báo sau khi người kia đã gõ xong nửa câu.
    expect(pingTyping).toHaveBeenCalledTimes(1);
  });

  it("xoá sạch nháp (ô rỗng) KHÔNG ping", () => {
    renderComposer();
    type("a");
    pingTyping.mockClear();
    vi.setSystemTime(Date.now() + TYPING_PING_THROTTLE_MS + 1);
    type("");
    expect(pingTyping).not.toHaveBeenCalled();
  });

  it("phòng đã LƯU TRỮ ⇒ không ping (ô soạn bị khoá, không có gì để báo)", () => {
    renderComposer({ isArchived: true });
    type("a");
    expect(pingTyping).not.toHaveBeenCalled();
  });

  it("ping hỏng ⇒ KHÔNG hiện lỗi cho người dùng, và lần gõ sau vẫn thử lại", async () => {
    pingTyping.mockRejectedValueOnce(new Error("mạng chập"));
    renderComposer();
    type("a");
    // Nhả microtask để `.catch` chạy (không dùng `advanceTimers` — đây là promise, không phải timer).
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByRole("alert")).toBeNull();

    // Mốc tiết lưu đã được NHẢ ⇒ phím kế tiếp ping lại NGAY, không phải chờ hết 3 s vô ích.
    type("ab");
    expect(pingTyping).toHaveBeenCalledTimes(2);
  });
});
