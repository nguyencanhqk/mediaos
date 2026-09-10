/**
 * S17-CHAT-UX2-FE-4 — `RoomLinksList` (CHAT-API-031).
 *
 * Bốn điều của hợp đồng mà đọc lướt là hiểu ngược, mỗi điều một ca:
 *   1. **Trang RỖNG ≠ hết.** `nextCursor !== null` ⇒ còn, dù `data` rỗng (server chạm trần QUÉT).
 *   2. **Con trỏ opaque** đi thẳng vào lời gọi kế — không tự chế `offset`, không tự suy `beforeSeq`.
 *   3. **Không dedupe URL.** Cùng một địa chỉ gửi hai lần là HAI dòng, mỗi dòng một người gửi/mốc giờ.
 *   4. **Khoá `${messageId}:${linkIndex}`.** Một tin nhiều link ⇒ trùng `messageId`; trùng `key` là rò
 *      node DOM (memory `duplicate-sibling-key-leaks-dom-node`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const listRoomLinks = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: { ...actual.chatApi, listRoomLinks: (...a: unknown[]) => listRoomLinks(...a) },
  };
});

import { RoomLinksList } from "./RoomLinksList";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const SENDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MSG_A = "00000007-1111-4111-8111-111111111111";
const MSG_B = "00000008-1111-4111-8111-111111111111";

function link(over: Record<string, unknown> = {}) {
  return {
    messageId: MSG_A,
    roomSeq: 12,
    linkIndex: 0,
    url: "https://mediaos.vn/a",
    senderId: SENDER,
    senderName: "Trần B",
    createdAt: "2026-08-04T10:00:00.000Z",
    ...over,
  };
}

function renderList(onJumpToMessage = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <RoomLinksList roomId={ROOM_ID} onJumpToMessage={onJumpToMessage} />
    </I18nextProvider>,
  );
  return { onJumpToMessage };
}

beforeEach(() => {
  listRoomLinks.mockReset().mockResolvedValue({ data: [], nextCursor: null, truncated: false });
});

describe("RoomLinksList · hợp đồng keyset", () => {
  it("trang rỗng + `nextCursor: null` ⇒ NÓI THẲNG phòng chưa có liên kết", async () => {
    renderList();
    expect(await screen.findByText("Phòng chưa có liên kết nào được chia sẻ.")).toBeTruthy();
    expect(screen.queryByTestId("chat-links-scan-more")).toBeNull();
  });

  it("trang rỗng + CÒN con trỏ ⇒ mời quét tiếp, KHÔNG kết luận phòng không có liên kết", async () => {
    listRoomLinks.mockResolvedValue({ data: [], nextCursor: "cur-1", truncated: true });
    renderList();

    expect(await screen.findByText(/Mới quét tới đây/)).toBeTruthy();
    expect(screen.queryByText("Phòng chưa có liên kết nào được chia sẻ.")).toBeNull();
  });

  it("bấm «Quét tiếp» ⇒ gửi ĐÚNG con trỏ opaque server trả, rồi hiện dữ liệu trang sau", async () => {
    listRoomLinks.mockResolvedValueOnce({ data: [], nextCursor: "cur-1", truncated: true });
    listRoomLinks.mockResolvedValueOnce({
      data: [link({ url: "https://mediaos.vn/muon-hon" })],
      nextCursor: null,
      truncated: false,
    });
    renderList();

    fireEvent.click(await screen.findByTestId("chat-links-scan-more"));

    await waitFor(() =>
      expect(listRoomLinks).toHaveBeenLastCalledWith(ROOM_ID, { limit: 30, cursor: "cur-1" }),
    );
    expect(await screen.findByText("https://mediaos.vn/muon-hon")).toBeTruthy();
  });

  it("«Xem liên kết cũ hơn» NỐI vào danh sách đang có, không thay thế nó", async () => {
    listRoomLinks.mockResolvedValueOnce({
      data: [link({ url: "https://mediaos.vn/moi" })],
      nextCursor: "cur-2",
      truncated: false,
    });
    listRoomLinks.mockResolvedValueOnce({
      data: [link({ messageId: MSG_B, roomSeq: 3, url: "https://mediaos.vn/cu" })],
      nextCursor: null,
      truncated: false,
    });
    renderList();

    fireEvent.click(await screen.findByTestId("chat-links-load-more"));

    expect(await screen.findByText("https://mediaos.vn/cu")).toBeTruthy();
    expect(screen.getByText("https://mediaos.vn/moi")).toBeTruthy();
    expect(screen.getAllByTestId("chat-link-row")).toHaveLength(2);
    // Hết con trỏ ⇒ không còn mời lật tiếp.
    expect(screen.queryByTestId("chat-links-load-more")).toBeNull();
  });
});

describe("RoomLinksList · trình bày", () => {
  it("cùng một tin có HAI liên kết ⇒ hai dòng RIÊNG, khoá KHÔNG trùng nhau", async () => {
    listRoomLinks.mockResolvedValue({
      data: [
        link({ linkIndex: 0, url: "https://mediaos.vn/a" }),
        link({ linkIndex: 1, url: "https://mediaos.vn/b" }),
      ],
      nextCursor: null,
      truncated: false,
    });
    // Trùng `key` KHÔNG làm vỡ render — nó chỉ hiện ra ở cảnh báo của React rồi để lại node DOM
    // mồ côi (memory `duplicate-sibling-key-leaks-dom-node`). Đếm hai dòng thôi là ca xanh-RỖNG:
    // phải bắt ĐÚNG cảnh báo đó.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderList();

    await waitFor(() => expect(screen.getAllByTestId("chat-link-row")).toHaveLength(2));
    expect(screen.getByText("https://mediaos.vn/a")).toBeTruthy();
    expect(screen.getByText("https://mediaos.vn/b")).toBeTruthy();
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("same key")),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("URL TRÙNG NHAU gửi hai lần ⇒ vẫn HAI dòng (server cố ý không dedupe)", async () => {
    listRoomLinks.mockResolvedValue({
      data: [
        link({ messageId: MSG_A, roomSeq: 12, senderName: "Trần B" }),
        link({ messageId: MSG_B, roomSeq: 20, senderName: "Lê C" }),
      ],
      nextCursor: null,
      truncated: false,
    });
    renderList();

    await waitFor(() => expect(screen.getAllByTestId("chat-link-row")).toHaveLength(2));
    expect(screen.getByText("Trần B")).toBeTruthy();
    expect(screen.getByText("Lê C")).toBeTruthy();
  });

  it("bấm 'Xem trong hội thoại' ⇒ báo lên KÈM roomSeq", async () => {
    listRoomLinks.mockResolvedValue({
      data: [link({ messageId: MSG_A, roomSeq: 42 })],
      nextCursor: null,
      truncated: false,
    });
    const { onJumpToMessage } = renderList();

    fireEvent.click(await screen.findByText("Xem trong hội thoại"));
    expect(onJumpToMessage).toHaveBeenCalledWith(MSG_A, 42);
  });

  /**
   * Allowlist `http(s)` lặp lại ở FE dù server đã chỉ trích `https?://`: nếu một ngày đường trích ở BE
   * lỏng ra, dòng này hiện dưới dạng CHỮ chứ KHÔNG bao giờ thành `href` — cùng luật `splitTextWithLinks`.
   */
  it("địa chỉ KHÔNG phải http(s) ⇒ hiện dạng chữ, KHÔNG dựng href", async () => {
    listRoomLinks.mockResolvedValue({
      data: [link({ url: "javascript:alert(1)" })],
      nextCursor: null,
      truncated: false,
    });
    renderList();

    const plain = await screen.findByTestId("chat-link-not-http");
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    // Cả HAI nhánh (link thật và chữ thường) đều phải cô lập chiều viết — nhánh này còn dễ quên
    // hơn vì nó không phải `<a>`.
    expect(plain.getAttribute("dir")).toBe("ltr");
  });

  it("lỗi mạng ⇒ báo + cho thử lại, không im lặng để danh sách trống", async () => {
    listRoomLinks.mockRejectedValueOnce(new Error("mạng chập"));
    renderList();

    expect(await screen.findByText("Không tải được danh sách liên kết.")).toBeTruthy();
    listRoomLinks.mockResolvedValue({
      data: [link({ url: "https://mediaos.vn/lai-duoc" })],
      nextCursor: null,
      truncated: false,
    });
    fireEvent.click(screen.getByText("Thử lại"));
    expect(await screen.findByText("https://mediaos.vn/lai-duoc")).toBeTruthy();
  });
});
