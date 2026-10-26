/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-05) — «Đọc hết» trên chip «Chưa đọc» + «Đánh dấu đã đọc» một phòng.
 *
 * Mỗi ca khoá một tiêu chí chấp nhận của story: badge về 0 NGAY (lạc quan, kể cả badge tổng), chỉ phòng
 * ĐANG HIỂN THỊ, trần 4 lời gọi song song, lỗi một phần ⇒ phòng lỗi khôi phục badge + thông báo có
 * «Thử lại», không có phòng chưa đọc ⇒ nút vô hiệu, và số gửi đi là `lastMessageSeq` thật của từng phòng.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatMarkReadResultDto, ChatRoomDto } from "@mediaos/contracts";

const markRead = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      listRooms: vi.fn().mockResolvedValue([]),
      markRead: (...a: unknown[]) => markRead(...a),
    },
  };
});

import { ApiError } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { useChatStore } from "@/stores/chat.store";
import { totalUnreadCount } from "./chat-unread";
import { READ_ALL_CONCURRENCY } from "./chat-unread-batch";
import { RoomListPanel } from "./RoomListPanel";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function room(id: string, over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 10,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

/** Phản hồi thật của POST /read: con trỏ về đúng số đã gửi. */
function readOk(roomId: string, body: { seq: number }): Promise<ChatMarkReadResultDto> {
  return Promise.resolve({ roomId, lastReadSeq: body.seq, unreadCount: 0 });
}

function chip(key: string): HTMLElement {
  const found = screen
    .getAllByTestId("chat-room-chip")
    .find((el) => el.getAttribute("data-chip") === key);
  if (!found) throw new Error(`không thấy chip "${key}"`);
  return found;
}

function renderPanel(props: Partial<Parameters<typeof RoomListPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomListPanel
          selectedRoomId={null}
          isBootstrapping={false}
          onSelectRoom={vi.fn()}
          {...props}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const unreadOf = (id: string): number | undefined =>
  useChatStore.getState().roomsById[id]?.unreadCount;

let toastError: MockInstance<typeof toast.error>;

beforeEach(() => {
  markRead.mockReset();
  markRead.mockImplementation(readOk);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  toastError = vi.spyOn(toast, "error");
});

afterEach(() => {
  toastError.mockRestore();
  toast.clear();
});

describe("RoomListPanel · «Đọc hết»", () => {
  it("6 phòng chưa đọc ⇒ một lần bấm: 6 badge + badge tổng về 0 NGAY, mỗi phòng gửi đúng lastMessageSeq", async () => {
    const rooms = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
      room(id, { unreadCount: i + 1, lastMessageSeq: 20 + i }),
    );
    useChatStore.getState().hydrateRooms(rooms);
    renderPanel();

    // «Đọc hết» chỉ có khi chip «Chưa đọc» bật.
    expect(screen.queryByTestId("chat-read-all")).toBeNull();
    fireEvent.click(chip("unread"));
    fireEvent.click(screen.getByTestId("chat-read-all"));

    // Lạc quan: chưa có phản hồi nào mà badge đã về 0.
    for (const r of rooms) expect(unreadOf(r.id)).toBe(0);
    expect(totalUnreadCount(useChatStore.getState().roomsById)).toBe(0);

    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(6));
    for (const r of rooms) {
      expect(markRead).toHaveBeenCalledWith(r.id, { seq: r.lastMessageSeq });
    }
  });

  it(`không quá ${READ_ALL_CONCURRENCY} lời gọi cùng bay`, async () => {
    expect(READ_ALL_CONCURRENCY).toBe(4);
    const resolvers: Array<() => void> = [];
    markRead.mockImplementation(
      (roomId: string, body: { seq: number }) =>
        new Promise<ChatMarkReadResultDto>((resolve) => {
          resolvers.push(() => resolve({ roomId, lastReadSeq: body.seq, unreadCount: 0 }));
        }),
    );
    useChatStore
      .getState()
      .hydrateRooms(["a", "b", "c", "d", "e", "f"].map((id) => room(id, { unreadCount: 2 })));
    renderPanel();
    fireEvent.click(chip("unread"));
    fireEvent.click(screen.getByTestId("chat-read-all"));

    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(4));
    await act(async () => {
      resolvers[0]();
      await Promise.resolve();
    });
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(5));
    await act(async () => {
      for (const resolve of resolvers.slice(1)) resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(6));
  });

  it("đang tìm ⇒ chỉ đánh dấu phòng đang hiển thị; phòng bị lọc đi GIỮ badge", async () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("p1", { name: "Dự án Alpha", unreadCount: 2 }),
        room("p2", { name: "Dự án Beta", unreadCount: 3 }),
        room("d1", { name: "Lan", roomType: "direct", unreadCount: 5 }),
      ]);
    renderPanel();
    fireEvent.click(chip("unread"));
    fireEvent.change(screen.getByLabelText("Tìm phòng theo tên hoặc mã"), {
      target: { value: "Dự án" },
    });
    fireEvent.click(screen.getByTestId("chat-read-all"));

    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    expect(markRead.mock.calls.map((c) => c[0]).sort()).toEqual(["p1", "p2"]);
    expect(unreadOf("d1")).toBe(5);
  });

  it("lỗi một phần ⇒ phòng thành công vẫn đã đọc, phòng lỗi khôi phục badge + thông báo có «Thử lại»", async () => {
    markRead.mockImplementation((roomId: string, body: { seq: number }) =>
      roomId === "bad"
        ? Promise.reject(new ApiError(503, "CHAT-ERR-000", "down"))
        : readOk(roomId, body),
    );
    useChatStore
      .getState()
      .hydrateRooms([
        room("ok1", { unreadCount: 2 }),
        room("bad", { unreadCount: 7, mentionUnreadCount: 1 }),
        room("ok2", { unreadCount: 1 }),
      ]);
    renderPanel();
    fireEvent.click(chip("unread"));
    fireEvent.click(screen.getByTestId("chat-read-all"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(unreadOf("ok1")).toBe(0);
    expect(unreadOf("ok2")).toBe(0);
    expect(unreadOf("bad")).toBe(7);
    expect(useChatStore.getState().roomsById.bad?.mentionUnreadCount).toBe(1);

    const [message, options] = toastError.mock.calls[0];
    expect(message).toBe("Không đánh dấu được 1 phòng");
    expect(options?.action?.label).toBe("Thử lại");

    // «Thử lại» chỉ gửi lại phòng lỗi — không nện lại phòng đã thành công.
    markRead.mockClear();
    markRead.mockImplementation(readOk);
    act(() => options?.action?.onClick());
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead).toHaveBeenCalledWith("bad", { seq: 10 });
    await waitFor(() => expect(unreadOf("bad")).toBe(0));
  });

  it("không còn phòng chưa đọc ⇒ «Đọc hết» vô hiệu, không gọi API", () => {
    useChatStore.getState().hydrateRooms([room("a", { unreadCount: 0 })]);
    renderPanel();
    fireEvent.click(chip("unread"));
    const button = screen.getByTestId("chat-read-all") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe("RoomListPanel · «Đánh dấu đã đọc» một phòng", () => {
  it("phòng đánh dấu tay (badge 0) ⇒ gửi lastMessageSeq thật, hết in đậm", async () => {
    useChatStore
      .getState()
      .hydrateRooms([
        room("m", { unreadCount: 0, lastMessageSeq: 33, markedUnreadAt: "2026-08-04T10:05:00Z" }),
      ]);
    renderPanel();
    const name = screen.getByTestId("chat-room-name");
    expect(name.className).toContain("font-semibold");

    fireEvent.click(screen.getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-read"));

    expect(markRead).toHaveBeenCalledWith("m", { seq: 33 });
    await waitFor(() =>
      expect(screen.getByTestId("chat-room-name").className).not.toContain("font-semibold"),
    );
    expect(useChatStore.getState().roomsById.m?.markedUnreadAt).toBeNull();
  });

  it("404 (phòng không còn) ⇒ khôi phục + thông báo, không im lặng", async () => {
    markRead.mockRejectedValue(new ApiError(404, "CHAT-ERR-001", "not found"));
    useChatStore.getState().hydrateRooms([room("x", { unreadCount: 4 })]);
    renderPanel();
    const row = screen.getByTestId("chat-room-item").parentElement as HTMLElement;
    fireEvent.click(within(row).getByTestId("chat-room-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-room-menu-read"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(unreadOf("x")).toBe(4);
    expect(toastError.mock.calls[0][0]).toBe("Không đánh dấu được 1 phòng");
  });
});
