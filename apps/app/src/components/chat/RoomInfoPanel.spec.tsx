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
const listRoomFiles = vi.fn();
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
      listRoomFiles: (...a: unknown[]) => listRoomFiles(...a),
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

const MSG_ID = "00000007-1111-4111-8111-111111111111";

/** S7-CHAT-FE-4 — một dòng của tab Tệp (`ChatRoomFileDto`). */
function file(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    fileId: "88888888-8888-4888-8888-888888888888",
    name: "anh.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    isImage: false,
    url: "https://storage.example/x?sig=1",
    thumbnailUrl: null,
    messageId: MSG_ID,
    roomSeq: 7,
    senderId: OTHER,
    senderName: "Trần B",
    createdAt: "2026-08-04T10:00:00.000Z",
    ...over,
  };
}

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
          onJumpToMessage={vi.fn()}
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
  listRoomFiles.mockReset().mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("RoomInfoPanel · tab", () => {
  it("BA tab: Thành viên + Tệp + Tin ghim (tab Tệp mở ở S7-CHAT-FE-4)", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "Thành viên" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tệp" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tin ghim" })).toBeTruthy();
  });

  /**
   * S7-CHAT-FE-4 — mỗi lần gọi `/rooms/:id/files` là một lô URL ký hạn ngắn **và** một lô bản ghi
   * `file_access_logs`. Nạp sẵn ở nền cho người chỉ mở tab Thành viên là ghi vào nhật ký truy cập một
   * hành vi người dùng KHÔNG làm — bản ghi đó về sau không phân biệt được với truy cập thật.
   */
  it("KHÔNG gọi /files khi tab Tệp chưa mở", () => {
    renderPanel();
    expect(listRoomFiles).not.toHaveBeenCalled();
  });

  it("mở tab Tệp ⇒ gọi listRoomFiles; ảnh có xem trước, tệp thường hiện tên + cỡ", async () => {
    listRoomFiles.mockResolvedValue([
      file({ isImage: true, thumbnailUrl: "https://s/thumb.png", name: "anh.png" }),
      file({
        id: "f2",
        name: "bao-cao.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        messageId: "00000009-1111-4111-8111-111111111111",
        roomSeq: 9,
      }),
    ]);
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Tệp" }));

    await waitFor(() => expect(listRoomFiles).toHaveBeenCalledWith(ROOM_ID, { limit: 30 }));
    expect(await screen.findByAltText("anh.png")).toBeTruthy();
    expect(screen.getByText("bao-cao.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("tệp bị TỪ CHỐI ký (`url: null`) ⇒ nói 'không tải được', KHÔNG dựng liên kết chết", async () => {
    listRoomFiles.mockResolvedValue([file({ url: null, thumbnailUrl: null, name: "cam.docx" })]);
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Tệp" }));

    expect(await screen.findByTestId("chat-file-unavailable")).toBeTruthy();
    expect(screen.getByText("Tệp không tải được")).toBeTruthy();
    expect(document.querySelector('a[href="null"]')).toBeNull();
  });

  it("bấm 'Xem trong hội thoại' ⇒ báo lên trang KÈM roomSeq (con trỏ để nạp ngữ cảnh)", async () => {
    listRoomFiles.mockResolvedValue([file({ messageId: MSG_ID, roomSeq: 42 })]);
    const onJumpToMessage = vi.fn();
    renderPanel({ onJumpToMessage });
    fireEvent.click(screen.getByRole("tab", { name: "Tệp" }));

    fireEvent.click(await screen.findByText("Xem trong hội thoại"));
    expect(onJumpToMessage).toHaveBeenCalledWith(MSG_ID, 42);
  });

  it("tab Tệp lỗi ⇒ báo + cho thử lại, không im lặng để danh sách trống", async () => {
    listRoomFiles.mockRejectedValue(new Error("mạng chập"));
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Tệp" }));

    expect(await screen.findByText("Không tải được danh sách tệp.")).toBeTruthy();
    listRoomFiles.mockResolvedValue([file({ name: "lai-duoc.pdf" })]);
    fireEvent.click(screen.getByText("Thử lại"));
    expect(await screen.findByText("lai-duoc.pdf")).toBeTruthy();
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

/**
 * S7-CHAT-FE-4 — "đã xem tới đâu" (SPEC-15 §13.2), dẫn xuất từ `last_read_seq` của từng thành viên.
 *
 * Ca `undefined` là ca quan trọng nhất: trường này `.optional()` trong hợp đồng, và gộp nó với `0` sẽ
 * bêu "Chưa xem tin nào" lên CẢ phòng ngay khi payload thiếu trường — một lời khẳng định sai về người
 * thật, đọc như thể đồng nghiệp đang phớt lờ nhau.
 */
describe("RoomInfoPanel · đã xem tới đâu", () => {
  const seenMembers = (over: Array<Record<string, unknown>>) =>
    [
      { id: "m1", roomId: ROOM_ID, userId: ME, role: "admin", joinedAt: "", userName: "Tôi" },
      ...over.map((o, i) => ({
        id: `s${i}`,
        roomId: ROOM_ID,
        userId: `${OTHER.slice(0, -1)}${i}`,
        role: "member",
        joinedAt: "",
        ...o,
      })),
    ] as unknown as ChatRoomMemberDto[];

  it("đọc tới tin cuối ⇒ 'Đã xem tin mới nhất'", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 10 }]),
    });
    expect(screen.getByText(/Đã xem tin mới nhất/)).toBeTruthy();
  });

  it("đọc dở ⇒ nói CÒN BAO NHIÊU tin chưa xem (không phơi số hiệu tin ra UI)", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 7 }]),
    });
    expect(screen.getByText(/Chưa xem 3 tin/)).toBeTruthy();
  });

  it("`lastReadSeq: 0` ⇒ 'Chưa xem tin nào'", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 0 }]),
    });
    expect(screen.getByText(/Chưa xem tin nào/)).toBeTruthy();
  });

  it("server KHÔNG gửi `lastReadSeq` ⇒ 'chưa rõ', KHÔNG khẳng định họ chưa đọc", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B" }]),
    });
    // CẢ HAI hàng (mình + Trần B) đều thiếu trường ⇒ cả hai phải nói "chưa rõ", không hàng nào bị
    // khẳng định là chưa đọc.
    expect(screen.getAllByText(/Chưa rõ đã xem tới đâu/)).toHaveLength(2);
    expect(screen.queryByText(/Chưa xem tin nào/)).toBeNull();
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
