/**
 * S7-CHAT-FE-2 → **v2 ở S17-CHAT-UX2-FE-4** — RoomInfoPanel (CHAT-SCREEN-004 v2 · CHAT-DEC-025).
 *
 * Ba nhóm ca KHÔNG được rơi khi đổi vỏ tab → dọc:
 *
 *  1. **Cổng = cặp quyền VÀ loại phòng** (+ vai trò trong phòng). Bỏ vế thứ hai là hiện «Thêm thành
 *     viên» trên phòng phòng-ban/dự án — thao tác server luôn chặn bằng CHAT-ERR-012 (§13.3).
 *  2. **Tuỳ chọn CÁ NHÂN không sau cổng quyền.** «Tắt thông báo» + «Ghim» phải còn nguyên với người
 *     chỉ có `view:chat-room` (memory `personal-prefs-must-not-sit-behind-permission-gate`). Ca này
 *     đi KÈM ca đối chứng «Thêm thành viên» BIẾN MẤT — thiếu vế đối chứng thì một `useCan` luôn trả
 *     `true` cũng làm ca xanh (memory `deny-cases-vacuous-without-allow-case`).
 *  3. **Khối đóng ⇒ KHÔNG gọi API.** Mỗi lần đọc đường tệp là một hàng `file_access_logs`; render sẵn
 *     ở nền là ghi nhật ký truy cập cho thứ người dùng chưa mở.
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
const listRoomLinks = vi.fn();
const pinRoom = vi.fn();
const unpinRoom = vi.fn();
const muteRoom = vi.fn();
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
      listRoomLinks: (...a: unknown[]) => listRoomLinks(...a),
      pinRoom: (...a: unknown[]) => pinRoom(...a),
      unpinRoom: (...a: unknown[]) => unpinRoom(...a),
      muteRoom: (...a: unknown[]) => muteRoom(...a),
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

/** S7-CHAT-FE-4 — một dòng của khối Tệp (`ChatRoomFileDto`). */
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

/** Mở khối accordion theo nhãn — khối ĐÓNG thì thân KHÔNG mount (đó là cách luật «đóng ⇒ không gọi API» được ép). */
function openSection(name: "Ảnh / Video" | "Tệp" | "Liên kết" | "Tin ghim") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  leaveRoom.mockReset().mockResolvedValue({ left: true });
  archiveRoom.mockReset().mockResolvedValue(room({ isArchived: true }));
  getPinned.mockReset().mockResolvedValue([]);
  listRoomFiles.mockReset().mockResolvedValue([]);
  listRoomLinks.mockReset().mockResolvedValue({ data: [], nextCursor: null, truncated: false });
  pinRoom.mockReset().mockResolvedValue(room({ pinnedAt: "2026-09-01T00:00:00.000Z" }));
  unpinRoom.mockReset().mockResolvedValue(room({ pinnedAt: null }));
  muteRoom.mockReset().mockResolvedValue(room({ mutedUntil: null }));
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("RoomInfoPanel · bố cục dọc v2 (DEC-025)", () => {
  it("BỐN khối: Ảnh/Video · Tệp · Liên kết · Tin ghim (không còn tab)", () => {
    renderPanel();
    expect(screen.getByTestId("chat-info-section-media")).toBeTruthy();
    expect(screen.getByTestId("chat-info-section-files")).toBeTruthy();
    expect(screen.getByTestId("chat-info-section-links")).toBeTruthy();
    expect(screen.getByTestId("chat-info-section-pinned")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("«Tạo bởi … · ngày» hiện khi server trả `createdByName`", () => {
    renderPanel({ createdByName: "Đỗ Tiến Bắc" });
    expect(screen.getByTestId("chat-info-created-by").textContent).toContain("Đỗ Tiến Bắc");
    expect(screen.getByTestId("chat-info-created-by").textContent).toContain("01/08/2026");
  });

  it("`createdByName` vắng (phòng hệ thống / server cũ) ⇒ ẨN HẲN dòng, KHÔNG bịa 'Không rõ'", () => {
    renderPanel({ createdByName: null });
    expect(screen.queryByTestId("chat-info-created-by")).toBeNull();
    renderPanel({ createdByName: undefined });
    expect(screen.queryByTestId("chat-info-created-by")).toBeNull();
  });

  it("dòng «Thành viên (N) ›» mở Sheet, số đếm đúng theo danh sách", () => {
    renderPanel();
    expect(screen.queryByTestId("chat-members-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-info-members-row"));

    expect(screen.getByTestId("chat-members-sheet")).toBeTruthy();
    expect(screen.getAllByTestId("chat-member-row")).toHaveLength(2);
  });
});

describe("RoomInfoPanel · khối đóng KHÔNG gọi API", () => {
  /**
   * Mỗi lời gọi `/rooms/:id/files` là một lô URL ký hạn ngắn **và** một lô bản ghi `file_access_logs`.
   * Nạp sẵn ở nền cho người chưa mở khối là ghi vào nhật ký truy cập một hành vi người dùng KHÔNG làm —
   * bản ghi đó về sau không phân biệt được với truy cập thật.
   */
  it("chưa mở khối nào ⇒ KHÔNG gọi /files, KHÔNG gọi /links, KHÔNG gọi /pinned", () => {
    renderPanel();
    expect(listRoomFiles).not.toHaveBeenCalled();
    expect(listRoomLinks).not.toHaveBeenCalled();
    expect(getPinned).not.toHaveBeenCalled();
  });

  it("ĐÓNG khối lại ⇒ thân bị gỡ (mở lần nữa là một lượt nạp MỚI, không dùng DOM cũ)", async () => {
    listRoomFiles.mockResolvedValue([file({ name: "bao-cao.pdf" })]);
    renderPanel();

    openSection("Tệp");
    expect(await screen.findByText("bao-cao.pdf")).toBeTruthy();

    openSection("Tệp");
    expect(screen.queryByText("bao-cao.pdf")).toBeNull();
  });
});

describe("RoomInfoPanel · khối Ảnh/Video (kind=image, lọc ở SERVER)", () => {
  it("mở khối ⇒ gọi listRoomFiles với `kind: 'image'` (KHÔNG lọc isImage ở client)", async () => {
    listRoomFiles.mockResolvedValue([
      file({ isImage: true, thumbnailUrl: "https://s/thumb.png", name: "anh.png" }),
    ]);
    renderPanel();

    openSection("Ảnh / Video");

    await waitFor(() =>
      expect(listRoomFiles).toHaveBeenCalledWith(ROOM_ID, { limit: 30, kind: "image" }),
    );
    expect(await screen.findByAltText("anh.png")).toBeTruthy();
    expect(screen.getAllByTestId("chat-media-cell")).toHaveLength(1);
  });

  it("ảnh bị TỪ CHỐI ký (`url: null`) ⇒ ô «không tải được», KHÔNG `<img src=null>`", async () => {
    listRoomFiles.mockResolvedValue([
      file({ isImage: true, url: null, thumbnailUrl: null, name: "cam.png" }),
    ]);
    renderPanel();

    openSection("Ảnh / Video");

    expect(await screen.findByTestId("chat-media-unavailable")).toBeTruthy();
    expect(document.querySelector('img[src="null"]')).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("RoomInfoPanel · khối Tệp (kind=file)", () => {
  it("mở khối ⇒ gọi listRoomFiles với `kind: 'file'`; tệp thường hiện tên + cỡ", async () => {
    listRoomFiles.mockResolvedValue([
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

    openSection("Tệp");

    await waitFor(() =>
      expect(listRoomFiles).toHaveBeenCalledWith(ROOM_ID, { limit: 30, kind: "file" }),
    );
    expect(await screen.findByText("bao-cao.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("tệp bị TỪ CHỐI ký (`url: null`) ⇒ nói 'không tải được', KHÔNG dựng liên kết chết", async () => {
    listRoomFiles.mockResolvedValue([file({ url: null, thumbnailUrl: null, name: "cam.docx" })]);
    renderPanel();

    openSection("Tệp");

    expect(await screen.findByTestId("chat-file-unavailable")).toBeTruthy();
    expect(screen.getByText("Tệp không tải được")).toBeTruthy();
    expect(document.querySelector('a[href="null"]')).toBeNull();
  });

  it("bấm 'Xem trong hội thoại' ⇒ báo lên trang KÈM roomSeq (con trỏ để nạp ngữ cảnh)", async () => {
    listRoomFiles.mockResolvedValue([file({ messageId: MSG_ID, roomSeq: 42 })]);
    const onJumpToMessage = vi.fn();
    renderPanel({ onJumpToMessage });

    openSection("Tệp");

    fireEvent.click(await screen.findByText("Xem trong hội thoại"));
    expect(onJumpToMessage).toHaveBeenCalledWith(MSG_ID, 42);
  });

  it("khối Tệp lỗi ⇒ báo + cho thử lại, không im lặng để danh sách trống", async () => {
    listRoomFiles.mockRejectedValue(new Error("mạng chập"));
    renderPanel();

    openSection("Tệp");

    expect(await screen.findByText("Không tải được danh sách tệp.")).toBeTruthy();
    listRoomFiles.mockResolvedValue([file({ name: "lai-duoc.pdf" })]);
    fireEvent.click(screen.getByText("Thử lại"));
    expect(await screen.findByText("lai-duoc.pdf")).toBeTruthy();
  });
});

describe("RoomInfoPanel · khối Liên kết (CHAT-API-031)", () => {
  it("mở khối ⇒ gọi listRoomLinks; hiện địa chỉ với rel đủ ba giá trị", async () => {
    listRoomLinks.mockResolvedValue({
      data: [
        {
          messageId: MSG_ID,
          roomSeq: 12,
          linkIndex: 0,
          url: "https://mediaos.vn/bao-cao",
          senderId: OTHER,
          senderName: "Trần B",
          createdAt: "2026-08-04T10:00:00.000Z",
        },
      ],
      nextCursor: null,
      truncated: false,
    });
    renderPanel();

    openSection("Liên kết");

    await waitFor(() => expect(listRoomLinks).toHaveBeenCalledWith(ROOM_ID, { limit: 30 }));
    const anchor = await screen.findByText("https://mediaos.vn/bao-cao");
    const link = anchor.closest("a");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link?.getAttribute("target")).toBe("_blank");
    // `dir="ltr"` cô lập chiều viết: URL chứa ký tự đảo chiều (bidi) hiện ra có thể đọc thành một tên
    // miền KHÁC hẳn cái sẽ mở. Neo lại ở đây vì refactor `LinkAnchor` làm rơi thuộc tính này thì
    // không có gì khác đỏ (nợ gốc bidi/homograph ở docs/plans/S17-CHAT-UX2-BE-2.md).
    expect(link?.getAttribute("dir")).toBe("ltr");
  });

  it("trang RỖNG + `truncated` ⇒ mời quét tiếp, KHÔNG khẳng định 'phòng không có liên kết'", async () => {
    listRoomLinks.mockResolvedValue({ data: [], nextCursor: "cur-1", truncated: true });
    renderPanel();

    openSection("Liên kết");

    expect(await screen.findByTestId("chat-links-scan-more")).toBeTruthy();
    expect(screen.queryByText("Phòng chưa có liên kết nào được chia sẻ.")).toBeNull();
  });
});

/**
 * S7-CHAT-FE-4 — "đã xem tới đâu" (SPEC-15 §13.2), dẫn xuất từ `last_read_seq` của từng thành viên.
 *
 * Ca `undefined` là ca quan trọng nhất: trường này `.optional()` trong hợp đồng, và gộp nó với `0` sẽ
 * bêu "Chưa xem tin nào" lên CẢ phòng ngay khi payload thiếu trường — một lời khẳng định sai về người
 * thật, đọc như thể đồng nghiệp đang phớt lờ nhau.
 *
 * v2: danh sách nằm trong Sheet ⇒ mở Sheet trước. Số ca GIỮ NGUYÊN khi đổi vỏ.
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

  const openMembers = () => fireEvent.click(screen.getByTestId("chat-info-members-row"));

  it("đọc tới tin cuối ⇒ 'Đã xem tin mới nhất'", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 10 }]),
    });
    openMembers();
    expect(screen.getByText(/Đã xem tin mới nhất/)).toBeTruthy();
  });

  it("đọc dở ⇒ nói CÒN BAO NHIÊU tin chưa xem (không phơi số hiệu tin ra UI)", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 7 }]),
    });
    openMembers();
    expect(screen.getByText(/Chưa xem 3 tin/)).toBeTruthy();
  });

  it("`lastReadSeq: 0` ⇒ 'Chưa xem tin nào'", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B", lastReadSeq: 0 }]),
    });
    openMembers();
    expect(screen.getByText(/Chưa xem tin nào/)).toBeTruthy();
  });

  it("server KHÔNG gửi `lastReadSeq` ⇒ 'chưa rõ', KHÔNG khẳng định họ chưa đọc", () => {
    renderPanel({
      room: room({ lastMessageSeq: 10 }),
      members: seenMembers([{ userName: "Trần B" }]),
    });
    openMembers();
    // CẢ HAI hàng (mình + Trần B) đều thiếu trường ⇒ cả hai phải nói "chưa rõ", không hàng nào bị
    // khẳng định là chưa đọc.
    expect(screen.getAllByText(/Chưa rõ đã xem tới đâu/)).toHaveLength(2);
    expect(screen.queryByText(/Chưa xem tin nào/)).toBeNull();
  });
});

describe("RoomInfoPanel · cổng = cặp quyền VÀ loại phòng", () => {
  it("phòng NHÓM + admin phòng + `manage:chat-member` ⇒ hiện 'Thêm thành viên'", () => {
    renderPanel();
    expect(screen.getByTestId("chat-info-add-member")).toBeTruthy();
    expect(mockUseCan).toHaveBeenCalledWith("manage", "chat-member");
  });

  it("phòng DẪN XUẤT (department) ⇒ KHÔNG hiện nút thành viên, thay bằng lời giải thích", () => {
    renderPanel({ room: room({ roomType: "department" }) });
    expect(screen.queryByTestId("chat-info-add-member")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-info-members-row"));
    expect(screen.getByText(/do hệ thống đồng bộ tự động/i)).toBeTruthy();
  });

  it("chỉ là thành viên thường (myRole=member) ⇒ KHÔNG hiện thao tác quản trị thành viên", () => {
    renderPanel({ myRole: "member" });
    expect(screen.queryByTestId("chat-info-add-member")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-info-members-row"));
    expect(screen.queryByLabelText("Bớt khỏi phòng")).toBeNull();
  });

  it("thiếu `update:chat-room` ⇒ KHÔNG hiện nút đổi tên/mô tả", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "update" && resource === "chat-room"),
    );
    renderPanel();
    expect(screen.queryByTestId("chat-info-edit")).toBeNull();
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
    expect(screen.queryByTestId("chat-info-edit")).toBeNull();
  });

  it("phòng DIRECT ⇒ không có nút 'Rời phòng' (chỉ phòng nhóm rời được — CHAT-API-008)", () => {
    renderPanel({ room: room({ roomType: "direct", name: null }) });
    expect(screen.queryByText("Rời phòng")).toBeNull();
  });
});

/**
 * S17-CHAT-UX2-FE-4 — «Tắt thông báo» và «Ghim» là TUỲ CHỌN CÁ NHÂN của chính người đang xem, server
 * gate chúng bằng đúng cặp của đường đọc phòng. Bọc `PermissionGate`/`useCan` ở đây đẻ ra role "đọc
 * được phòng mà không tắt nổi thông báo của mình" (memory
 * `personal-prefs-must-not-sit-behind-permission-gate`).
 */
describe("RoomInfoPanel · tuỳ chọn cá nhân KHÔNG sau cổng quyền", () => {
  it("người chỉ có `view:chat-room` VẪN thấy «Tắt thông báo» + «Ghim» — trong khi «Thêm thành viên» biến mất", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => action === "view" && resource === "chat-room",
    );
    renderPanel();

    expect(screen.getByTestId("chat-info-mute")).toBeTruthy();
    expect(screen.getByTestId("chat-info-pin")).toBeTruthy();
    // Vế đối chứng: cùng một `useCan` giả này PHẢI đóng được cổng quản trị, nếu không hai khẳng định
    // trên là xanh-RỖNG.
    expect(screen.queryByTestId("chat-info-add-member")).toBeNull();
    expect(screen.queryByText("Lưu trữ phòng")).toBeNull();
  });

  it("bấm «Ghim» ⇒ gọi pinRoom của ĐÚNG phòng", async () => {
    useChatStore.getState().hydrateRooms([room()]);
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-info-pin"));

    await waitFor(() => expect(pinRoom).toHaveBeenCalledWith(ROOM_ID));
  });

  it("bỏ ghim LỖI ⇒ hoàn nguyên về ảnh chụp `before` TẠI ĐIỂM BẤM, không về `null`", async () => {
    const pinnedAt = "2026-08-20T03:00:00.000Z";
    useChatStore.getState().hydrateRooms([room({ pinnedAt })]);
    unpinRoom.mockRejectedValue(new Error("500"));
    renderPanel({ room: room({ pinnedAt }) });

    fireEvent.click(screen.getByTestId("chat-info-pin"));

    await waitFor(() =>
      expect(useChatStore.getState().roomsById[ROOM_ID]?.pinnedAt).toBe(pinnedAt),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("phòng ĐANG tắt thông báo ⇒ nút bật lại gọi muteRoom(null), không mở menu chọn mốc", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    useChatStore.getState().hydrateRooms([room({ mutedUntil: future })]);
    renderPanel({ room: room({ mutedUntil: future }) });

    fireEvent.click(screen.getByTestId("chat-info-mute"));

    await waitFor(() => expect(muteRoom).toHaveBeenCalledWith(ROOM_ID, { mutedUntil: null }));
  });

  it("phòng đang BẬT thông báo ⇒ bấm là mở menu MỐC (hợp đồng là `mutedUntil`, không phải cờ)", async () => {
    useChatStore.getState().hydrateRooms([room()]);
    renderPanel();

    fireEvent.click(screen.getByTestId("chat-info-mute"));
    expect(muteRoom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chat-info-mute-1h"));
    await waitFor(() => expect(muteRoom).toHaveBeenCalledTimes(1));
    expect(muteRoom.mock.calls[0][0]).toBe(ROOM_ID);
    expect(typeof (muteRoom.mock.calls[0][1] as { mutedUntil: string }).mutedUntil).toBe("string");
  });
});

describe("RoomInfoPanel · tin ghim", () => {
  it("mở khối Tin ghim ⇒ gọi getPinned; rỗng ⇒ nói rõ", async () => {
    renderPanel();
    openSection("Tin ghim");
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
    openSection("Tin ghim");
    expect(await screen.findByText("Tin nhắn đã được thu hồi")).toBeTruthy();
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
