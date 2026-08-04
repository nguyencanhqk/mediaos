/**
 * S7-CHAT-FE-2 — RoomInfoPanel (CHAT-SCREEN-004).
 *
 * Cổng ở đây là TÍCH của hai điều kiện: cặp quyền **VÀ** loại phòng (+ vai trò trong phòng). Bỏ vế thứ
 * hai là hiện nút "Thêm thành viên" trên phòng phòng-ban/dự án — thao tác mà server luôn chặn bằng
 * CHAT-ERR-012 vì thành viên ở đó DẪN XUẤT từ nhân sự/dự án (§13.3).
 *
 * Tab "Tệp" CỐ Ý chưa có (thuộc `S7-CHAT-FE-4`) — có ca đóng đinh điều đó để không ai dựng tab rỗng.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";

const leaveRoom = vi.fn();
const archiveRoom = vi.fn();
const getPinned = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      leaveRoom: (...a: unknown[]) => leaveRoom(...a),
      archiveRoom: (...a: unknown[]) => archiveRoom(...a),
      getPinned: (...a: unknown[]) => getPinned(...a),
    },
  };
});

import { useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { RoomInfoPanel } from "./RoomInfoPanel";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng thử",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: null,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const members = [
  { id: "m1", roomId: ROOM_ID, userId: ME, role: "admin", joinedAt: "", userName: "Tôi" },
  { id: "m2", roomId: ROOM_ID, userId: OTHER, role: "member", joinedAt: "", userName: "Trần B" },
] as unknown as ChatRoomMemberDto[];

function renderPanel(props: Partial<Parameters<typeof RoomInfoPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRoomLeft = props.onRoomLeft ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomInfoPanel
          room={room()}
          members={members}
          myRole="admin"
          isLoading={false}
          loadError={false}
          onChanged={vi.fn()}
          onJumpToMessage={() => true}
          {...props}
          onRoomLeft={onRoomLeft}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onRoomLeft };
}

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  leaveRoom.mockReset().mockResolvedValue({ left: true });
  archiveRoom.mockReset().mockResolvedValue(room({ isArchived: true }));
  getPinned.mockReset().mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("RoomInfoPanel · tab", () => {
  it("chỉ có HAI tab: Thành viên + Tin ghim — KHÔNG có tab Tệp (thuộc S7-CHAT-FE-4)", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "Thành viên" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tin ghim" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Tệp" })).toBeNull();
  });

  it("mở tab Tin ghim ⇒ gọi getPinned; rỗng ⇒ nói rõ", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Tin ghim" }));
    await waitFor(() => expect(getPinned).toHaveBeenCalledWith(ROOM_ID));
    expect(await screen.findByText("Chưa có tin nào được ghim.")).toBeTruthy();
  });

  it("tin ghim ĐÃ THU HỒI hiện 'đã được thu hồi', không hiện nội dung cũ", async () => {
    getPinned.mockResolvedValue([
      {
        id: "00000005-1111-4111-8111-111111111111",
        senderName: "Trần B",
        body: null,
        recalledAt: "2026-08-04T10:05:00.000Z",
        createdAt: "2026-08-04T10:00:00.000Z",
      },
    ]);
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Tin ghim" }));
    expect(await screen.findByText("Tin nhắn đã được thu hồi")).toBeTruthy();
  });
});

describe("RoomInfoPanel · cổng = cặp quyền VÀ loại phòng", () => {
  it("phòng NHÓM + admin phòng + `manage:chat-member` ⇒ hiện 'Thêm thành viên'", () => {
    renderPanel();
    expect(screen.getByText("Thêm thành viên")).toBeTruthy();
    expect(mockUseCan).toHaveBeenCalledWith("manage", "chat-member");
  });

  it("phòng DẪN XUẤT (department) ⇒ KHÔNG hiện nút thành viên, thay bằng lời giải thích", () => {
    renderPanel({ room: room({ roomType: "department" }) });
    expect(screen.queryByText("Thêm thành viên")).toBeNull();
    expect(screen.getByText(/do hệ thống đồng bộ tự động/i)).toBeTruthy();
  });

  it("chỉ là thành viên thường (myRole=member) ⇒ KHÔNG hiện thao tác quản trị thành viên", () => {
    renderPanel({ myRole: "member" });
    expect(screen.queryByText("Thêm thành viên")).toBeNull();
    expect(screen.queryByLabelText("Bớt khỏi phòng")).toBeNull();
  });

  it("thiếu `update:chat-room` ⇒ KHÔNG hiện nút đổi tên/mô tả", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "update" && resource === "chat-room"),
    );
    renderPanel();
    expect(screen.queryByText("Đổi tên / mô tả")).toBeNull();
  });

  it("thiếu `archive:chat-room` ⇒ KHÔNG hiện nút lưu trữ", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "archive" && resource === "chat-room"),
    );
    renderPanel();
    expect(screen.queryByText("Lưu trữ phòng")).toBeNull();
  });

  it("phòng ĐÃ lưu trữ ⇒ không mời lưu trữ lần nữa, không mời sửa", () => {
    renderPanel({ room: room({ isArchived: true }) });
    expect(screen.queryByText("Lưu trữ phòng")).toBeNull();
    expect(screen.queryByText("Đổi tên / mô tả")).toBeNull();
  });

  it("phòng DIRECT ⇒ không có nút 'Rời phòng' (chỉ phòng nhóm rời được — CHAT-API-008)", () => {
    renderPanel({ room: room({ roomType: "direct", name: null }) });
    expect(screen.queryByText("Rời phòng")).toBeNull();
  });
});

describe("RoomInfoPanel · rời phòng", () => {
  it("xác nhận rồi rời ⇒ gọi API, DỌN store ngay và báo cho trang", async () => {
    useChatStore.getState().hydrateRooms([room()]);
    const { onRoomLeft } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
    fireEvent.click(screen.getByRole("button", { name: "Rời khỏi phòng" }));

    await waitFor(() => expect(leaveRoom).toHaveBeenCalledWith(ROOM_ID));
    // Không chờ sự kiện `chat:room`: nó có thể rơi đúng lúc WS đứt và để lại một phòng ma.
    await waitFor(() => expect(useChatStore.getState().roomsById[ROOM_ID]).toBeUndefined());
    expect(onRoomLeft).toHaveBeenCalled();
  });

  it("API lỗi ⇒ báo lỗi và KHÔNG dọn phòng khỏi store", async () => {
    useChatStore.getState().hydrateRooms([room()]);
    leaveRoom.mockRejectedValue(new Error("500"));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
    fireEvent.click(screen.getByRole("button", { name: "Rời khỏi phòng" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(useChatStore.getState().roomsById[ROOM_ID]).toBeDefined();
  });
});
