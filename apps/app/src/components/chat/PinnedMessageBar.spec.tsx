// @vitest-environment jsdom
/**
 * S20-CHAT-MENTIONPIN-1 — thanh tin ghim (US-CHAT-NV-08). Tiêu chí 1 (mới nhất + «1/N» + xoay), 2 (bấm ⇒
 * nạp ngữ cảnh), 4 (tin thu hồi không hiện nội dung cũ), 5 (0 tin ⇒ không vẽ), 6 (không đủ quyền ⇒ không
 * có nút bỏ ghim), 7 (`getPinned` lỗi ⇒ không vẽ) + thu gọn nhớ theo phòng bằng `localStorage` có try/catch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChatMessageDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { useChatStore } from "@/stores/chat.store";

const getPinned = vi.fn();
const getMessages = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: {
      getPinned: (...a: unknown[]) => getPinned(...a),
      getMessages: (...a: unknown[]) => getMessages(...a),
    },
  };
});

import { PinnedMessageBar, pinnedBarCollapsedKey } from "./PinnedMessageBar";

const ROOM = "11111111-1111-4111-8111-111111111111";
const SENDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function pinned(n: number, over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: `0000000${n}-1111-4111-8111-111111111111`,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM,
    senderId: SENDER,
    senderName: "Bình",
    body: `tin ghim ${n}`,
    messageType: "text",
    mentions: [],
    pinnedAt: "2026-10-23T08:00:00.000Z",
    pinnedBy: SENDER,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: n * 10,
    createdAt: "2026-10-23T07:00:00.000Z",
    ...over,
  };
}

function renderBar(props: { canUnpin?: boolean; onUnpin?: (id: string) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onUnpin = props.onUnpin ?? vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <PinnedMessageBar roomId={ROOM} canUnpin={props.canUnpin ?? false} onUnpin={onUnpin} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...view, onUnpin };
}

beforeEach(() => {
  getPinned.mockReset();
  getMessages.mockReset().mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PinnedMessageBar", () => {
  it("3 tin ghim ⇒ tin MỚI NHẤT (đầu danh sách server) + «1/3»; mũi tên xoay sang tin kế rồi vòng lại", async () => {
    getPinned.mockResolvedValue([pinned(3), pinned(2), pinned(1)]);
    renderBar();
    expect(await screen.findByTestId("chat-pinned-bar-preview")).toHaveTextContent("tin ghim 3");
    expect(screen.getByTestId("chat-pinned-bar-position")).toHaveTextContent("1/3");

    fireEvent.click(screen.getByTestId("chat-pinned-bar-next"));
    expect(screen.getByTestId("chat-pinned-bar-preview")).toHaveTextContent("tin ghim 2");
    expect(screen.getByTestId("chat-pinned-bar-position")).toHaveTextContent("2/3");

    fireEvent.click(screen.getByTestId("chat-pinned-bar-next"));
    fireEvent.click(screen.getByTestId("chat-pinned-bar-next"));
    expect(screen.getByTestId("chat-pinned-bar-position")).toHaveTextContent("1/3");
  });

  it("0 tin ghim ⇒ KHÔNG vẽ thanh", async () => {
    getPinned.mockResolvedValue([]);
    renderBar();
    await waitFor(() => expect(getPinned).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-pinned-bar")).toBeNull();
  });

  it("`getPinned` lỗi ⇒ KHÔNG vẽ thanh (hội thoại vẫn bình thường)", async () => {
    getPinned.mockRejectedValue(new Error("500"));
    renderBar();
    await waitFor(() => expect(getPinned).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("chat-pinned-bar")).toBeNull();
  });

  it("tin ghim đã thu hồi ⇒ «Tin đã thu hồi», KHÔNG nội dung cũ — kể cả khi cache còn giữ bản trước thu hồi", async () => {
    const stale = pinned(1);
    getPinned.mockResolvedValue([stale]);
    useChatStore.setState({
      messagesByRoom: {
        [ROOM]: [{ ...stale, body: null, recalledAt: "2026-10-23T09:00:00.000Z" }],
      },
    });
    renderBar();
    const preview = await screen.findByTestId("chat-pinned-bar-preview");
    expect(preview).toHaveTextContent(i18n.t("chat:message.recalled"));
    expect(screen.getByTestId("chat-pinned-bar")).not.toHaveTextContent("tin ghim 1");
  });

  it("không đủ quyền bỏ ghim ⇒ KHÔNG có nút; đủ quyền ⇒ nút gọi `onUnpin` với id tin đang hiện", async () => {
    getPinned.mockResolvedValue([pinned(2), pinned(1)]);
    const first = renderBar({ canUnpin: false });
    await screen.findByTestId("chat-pinned-bar");
    expect(screen.queryByTestId("chat-pinned-bar-unpin")).toBeNull();
    first.unmount();

    const { onUnpin } = renderBar({ canUnpin: true });
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-unpin"));
    expect(onUnpin).toHaveBeenCalledWith(pinned(2).id);
  });

  it("bấm thân thanh ⇒ nạp cửa sổ quanh tin đích (2 lời gọi) và vào chế độ ngữ cảnh làm nổi tin", async () => {
    const target = pinned(1);
    getPinned.mockResolvedValue([target]);
    getMessages.mockImplementation(async (_room: string, q: { beforeSeq?: number }) =>
      q.beforeSeq !== undefined ? [target] : [],
    );
    renderBar();
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-jump"));

    await waitFor(() =>
      expect(useChatStore.getState().contextByRoom[ROOM]?.targetMessageId).toBe(target.id),
    );
    expect(getMessages).toHaveBeenCalledWith(ROOM, { beforeSeq: target.roomSeq + 1, limit: 25 });
    expect(getMessages).toHaveBeenCalledWith(ROOM, { afterSeq: target.roomSeq, limit: 25 });
  });

  it("tin đích không còn trong cửa sổ ⇒ báo lỗi, KHÔNG vào chế độ ngữ cảnh", async () => {
    getPinned.mockResolvedValue([pinned(1)]);
    getMessages.mockResolvedValue([]);
    renderBar();
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-jump"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(useChatStore.getState().contextByRoom[ROOM]).toBeUndefined();
  });

  it("thu gọn nhớ THEO PHÒNG qua `localStorage`; dựng lại ⇒ vẫn thu gọn, mở ra ⇒ xoá khoá", async () => {
    getPinned.mockResolvedValue([pinned(1)]);
    const first = renderBar();
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-collapse"));
    expect(window.localStorage.getItem(pinnedBarCollapsedKey(ROOM))).toBe("1");
    first.unmount();

    renderBar();
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-expand"));
    expect(screen.getByTestId("chat-pinned-bar-preview")).toHaveTextContent("tin ghim 1");
    expect(window.localStorage.getItem(pinnedBarCollapsedKey(ROOM))).toBeNull();
  });

  it("`localStorage` NÉM (chế độ riêng tư) ⇒ thanh vẫn vẽ, thu gọn vẫn chạy trong phiên", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    getPinned.mockResolvedValue([pinned(1)]);
    renderBar();
    fireEvent.click(await screen.findByTestId("chat-pinned-bar-collapse"));
    expect(screen.getByTestId("chat-pinned-bar-expand")).toBeInTheDocument();
  });
});
