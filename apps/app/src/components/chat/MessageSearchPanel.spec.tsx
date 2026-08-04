/**
 * S7-CHAT-FE-4 — MessageSearchPanel + useMessageSearch (CHAT-SCREEN-005 · CHAT-API-015).
 *
 * Ba nhóm ca ở đây tương ứng ba cách hỏng IM LẶNG của một ô tìm kiếm:
 *   1. gõ-là-gọi (mỗi ký tự một truy vấn toàn văn, và `q` 1 ký tự thì server trả 422);
 *   2. response về trái thứ tự gửi ⇒ kết quả của câu CŨ ghi đè câu MỚI;
 *   3. FE tự "giúp" bằng cách bỏ dấu ⇒ lệch với `f_unaccent` của server (SPEC-15 §13.7).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatSearchResultDto } from "@mediaos/contracts";

const search = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, chatApi: { ...actual.chatApi, search: (...a: unknown[]) => search(...a) } };
});

import { MessageSearchPanel } from "./MessageSearchPanel";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const MSG_ID = "22222222-2222-4222-8222-222222222222";

function result(over: Partial<ChatSearchResultDto> = {}): ChatSearchResultDto {
  return {
    id: MSG_ID,
    roomId: ROOM_ID,
    roomName: "Phòng Kỹ thuật",
    roomType: "group",
    roomSeq: 42,
    senderId: "33333333-3333-4333-8333-333333333333",
    senderName: "Trần B",
    body: "báo cáo tuần này đã gửi",
    createdAt: "2026-08-04T10:00:00.000Z",
    attachmentCount: 0,
    ...over,
  };
}

function renderPanel(props: Partial<Parameters<typeof MessageSearchPanel>[0]> = {}) {
  const onOpenResult = props.onOpenResult ?? vi.fn();
  const onQueryChange = props.onQueryChange ?? vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MessageSearchPanel
        query=""
        scope={{ roomId: null, roomLabel: "Phòng Kỹ thuật" }}
        onScopeChange={vi.fn()}
        onClose={vi.fn()}
        activeMessageId={null}
        {...props}
        onQueryChange={onQueryChange}
        onOpenResult={onOpenResult}
      />
    </I18nextProvider>,
  );
  return { ...view, onOpenResult, onQueryChange };
}

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({ data: [], nextCursor: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageSearchPanel · ngưỡng 2 ký tự", () => {
  it("truy vấn 1 ký tự ⇒ nhắc tại chỗ và KHÔNG gọi API", async () => {
    vi.useFakeTimers();
    renderPanel({ query: "b" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText(/ít nhất 2 ký tự/i)).toBeTruthy();
  });

  it("chuỗi TOÀN KHOẢNG TRẮNG cũng bị chặn — `trim` trước khi đếm, y như chatSearchQuerySchema", async () => {
    vi.useFakeTimers();
    renderPanel({ query: "     " });
    await vi.advanceTimersByTimeAsync(2000);
    expect(search).not.toHaveBeenCalled();
  });

  it("đủ 2 ký tự ⇒ gọi API sau chống dội, gửi `q` NGUYÊN VĂN có dấu", async () => {
    vi.useFakeTimers();
    renderPanel({ query: "báo cáo" });
    expect(search).not.toHaveBeenCalled(); // chưa hết cửa sổ chống dội

    await vi.advanceTimersByTimeAsync(400);
    expect(search).toHaveBeenCalledWith({ q: "báo cáo", limit: 20 });
  });

  it("phạm vi MỘT phòng ⇒ kèm roomId; phạm vi tất cả ⇒ KHÔNG kèm", async () => {
    vi.useFakeTimers();
    const { rerender } = renderPanel({
      query: "báo cáo",
      scope: { roomId: ROOM_ID, roomLabel: "Phòng Kỹ thuật" },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(search).toHaveBeenLastCalledWith({ q: "báo cáo", limit: 20, roomId: ROOM_ID });

    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageSearchPanel
          query="báo cáo"
          scope={{ roomId: null, roomLabel: "Phòng Kỹ thuật" }}
          onQueryChange={vi.fn()}
          onScopeChange={vi.fn()}
          onOpenResult={vi.fn()}
          onClose={vi.fn()}
          activeMessageId={null}
        />
      </I18nextProvider>,
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(search).toHaveBeenLastCalledWith({ q: "báo cáo", limit: 20 });
  });
});

describe("MessageSearchPanel · kết quả", () => {
  it("vẽ từng dòng: phòng · trích · người gửi; bấm ⇒ báo lên trang KÈM roomSeq", async () => {
    search.mockResolvedValue({ data: [result()], nextCursor: null });
    const { onOpenResult } = renderPanel({ query: "báo cáo" });

    const row = await screen.findByTestId("chat-search-result");
    expect(row.textContent).toContain("Phòng Kỹ thuật");
    expect(row.textContent).toContain("báo cáo tuần này đã gửi");
    expect(row.textContent).toContain("Trần B");

    fireEvent.click(row);
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({ roomSeq: 42, id: MSG_ID }));
  });

  it("0 kết quả ⇒ nói rõ ĐANG NÓI VỀ CÂU NÀO (người dùng đã gõ tiếp trong lúc chờ)", async () => {
    renderPanel({ query: "khong co gi" });
    expect(await screen.findByText(/Không có tin nhắn nào khớp “khong co gi”/)).toBeTruthy();
  });

  it("lỗi ⇒ báo + cho thử lại", async () => {
    search.mockRejectedValue(new Error("mạng chập"));
    renderPanel({ query: "báo cáo" });
    expect(await screen.findByText(/Không tìm được/)).toBeTruthy();

    search.mockResolvedValue({ data: [result()], nextCursor: null });
    fireEvent.click(screen.getByText("Thử lại"));
    expect(await screen.findByTestId("chat-search-result")).toBeTruthy();
  });

  it("`nextCursor` khác null ⇒ nút tải thêm NỐI vào danh sách, không thay thế", async () => {
    search.mockResolvedValueOnce({ data: [result()], nextCursor: "cur-1" });
    renderPanel({ query: "báo cáo" });
    await screen.findByTestId("chat-search-result");

    search.mockResolvedValueOnce({
      data: [result({ id: "44444444-4444-4444-8444-444444444444", body: "báo cáo tháng" })],
      nextCursor: null,
    });
    fireEvent.click(screen.getByText("Tải thêm kết quả"));

    await waitFor(() => expect(screen.getAllByTestId("chat-search-result")).toHaveLength(2));
    expect(search).toHaveBeenLastCalledWith({ q: "báo cáo", limit: 20, cursor: "cur-1" });
    expect(screen.queryByText("Tải thêm kết quả")).toBeNull(); // hết trang
  });

  it("KHÔNG tô sáng từ khoá — trích đoạn giữ nguyên văn server trả về", async () => {
    search.mockResolvedValue({ data: [result({ body: "báo cáo <b>đậm</b>" })], nextCursor: null });
    const { container } = renderPanel({ query: "báo cáo" });
    await screen.findByTestId("chat-search-result");
    // `<b>` phải là CHỮ, không phải thẻ: `body` là chuỗi người dùng gõ.
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("báo cáo <b>đậm</b>")).toBeTruthy();
  });
});

describe("MessageSearchPanel · đua giữa hai câu", () => {
  it("response của câu CŨ về SAU không được ghi đè kết quả của câu MỚI", async () => {
    vi.useFakeTimers();
    // Hộp chứa thay vì biến trần: gán trong callback thì TS thu hẹp biến `let` về `null` và lời gọi
    // ở cuối bài test thành "not callable" — lỗi của phép suy kiểu, không phải của bài test.
    const old: { resolve?: (v: unknown) => void } = {};
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old.resolve = resolve;
        }),
    );

    const { rerender } = renderPanel({ query: "báo" });
    await vi.advanceTimersByTimeAsync(400); // câu cũ bay đi

    search.mockResolvedValueOnce({
      data: [result({ body: "kết quả của câu MỚI" })],
      nextCursor: null,
    });
    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageSearchPanel
          query="báo cáo"
          scope={{ roomId: null, roomLabel: null }}
          onQueryChange={vi.fn()}
          onScopeChange={vi.fn()}
          onOpenResult={vi.fn()}
          onClose={vi.fn()}
          activeMessageId={null}
        />
      </I18nextProvider>,
    );
    await vi.advanceTimersByTimeAsync(400);

    // Giờ mới trả câu CŨ — nó phải bị VỨT.
    old.resolve?.({ data: [result({ body: "kết quả của câu CŨ" })], nextCursor: null });
    await vi.advanceTimersByTimeAsync(50);

    expect(screen.getByText("kết quả của câu MỚI")).toBeTruthy();
    expect(screen.queryByText("kết quả của câu CŨ")).toBeNull();
  });

  it("xoá hết ô nhập ⇒ dọn kết quả cũ ngay (không để lại kết quả của câu đã xoá)", async () => {
    search.mockResolvedValue({ data: [result()], nextCursor: null });
    const { rerender } = renderPanel({ query: "báo cáo" });
    await screen.findByTestId("chat-search-result");

    rerender(
      <I18nextProvider i18n={i18n}>
        <MessageSearchPanel
          query=""
          scope={{ roomId: null, roomLabel: null }}
          onQueryChange={vi.fn()}
          onScopeChange={vi.fn()}
          onOpenResult={vi.fn()}
          onClose={vi.fn()}
          activeMessageId={null}
        />
      </I18nextProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("chat-search-result")).toBeNull());
  });
});
