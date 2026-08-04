/**
 * S7-CHAT-FE-5 🔒 — CHAT-SCREEN-007. Bốn thứ file này phải chứng minh (mọi thứ khác là phụ):
 *   1. Tài khoản chỉ giữ wildcard `*:*` KHÔNG thấy màn này và KHÔNG gọi API nào (SPEC-15 §20 ca 12).
 *   2. Hộp thoại xác nhận KHÔNG phải trang trí: `018b`/`018c` chỉ chạy SAU khi bấm Xác nhận.
 *   3. Phòng mở ra là CHỈ ĐỌC: 0 ô soạn tin, 0 nút ghim/thu hồi/sửa thành viên.
 *   4. Đính kèm KHÔNG có link tải — CHAT-DEC-004 không mở đường tải tệp.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useAuthStore } from "@mediaos/web-core";
import { ChatOversightPage } from "./chat-oversight-page";
import { OversightRoomView } from "./oversight-room-view";

const searchRooms = vi.fn();
const getRoom = vi.fn();
const listMessages = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...mod,
    chatOversightApi: {
      searchRooms: (...args: unknown[]) => searchRooms(...args),
      getRoom: (...args: unknown[]) => getRoom(...args),
      listMessages: (...args: unknown[]) => listMessages(...args),
      listAudit: vi.fn(),
    },
  };
});

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

const ROOM = {
  id: ROOM_ID,
  roomCode: "ROOM-001",
  name: "Phòng Kỹ thuật",
  roomType: "group" as const,
  isArchived: false,
  memberCount: 7,
  lastMessageAt: "2026-08-04T01:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const MESSAGE = {
  id: "33333333-3333-4333-8333-333333333333",
  roomId: ROOM_ID,
  senderId: "22222222-2222-4222-8222-222222222222",
  senderName: "Nguyễn Văn A",
  body: "nội dung riêng tư",
  messageType: "text" as const,
  mentions: [],
  pinnedAt: null,
  replyToMessageId: null,
  recalledAt: null,
  attachmentCount: 1,
  attachments: [
    {
      fileId: "88888888-8888-4888-8888-888888888888",
      name: "bao-cao.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      isImage: false,
    },
  ],
  roomSeq: 12,
  createdAt: "2026-08-04T01:00:00.000Z",
};

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<>{node}</>, { wrapper });
}

/** Gõ từ khoá rồi bấm Tìm. `fireEvent` (không `user-event`: console không có gói đó). */
function submitSearch(q: string) {
  fireEvent.change(screen.getByLabelText("Tra phòng theo mã hoặc tên"), { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: /Tìm/ }));
}

beforeEach(() => {
  searchRooms.mockReset().mockResolvedValue({ data: [ROOM], truncated: false });
  getRoom.mockReset().mockResolvedValue({ ...ROOM, description: null, members: [] });
  listMessages.mockReset().mockResolvedValue([MESSAGE]);
});

describe("CHAT-SCREEN-007 — cổng quyền fail-closed", () => {
  it("[crown-deny-path] caps `*:*` → KHÔNG thấy màn, KHÔNG gọi API nào", async () => {
    // Đây là ca duy nhất phân biệt `useCanExact` với `useCan`: `useCan` rơi xuống `*:*` và sẽ MỞ màn
    // nguy hiểm nhất module cho mọi người giữ wildcard, trong khi BE vẫn 403.
    setCaps({ "*:*": true });
    renderWithQuery(<ChatOversightPage />);

    expect(screen.getByText("Bạn không có quyền dùng chức năng này")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tra phòng theo mã hoặc tên")).not.toBeInTheDocument();
    expect(searchRooms).not.toHaveBeenCalled();
  });

  it.each([["view:*"], ["*:chat-oversight"], ["view:chat-room"]])(
    "[crown-deny-path] caps `%s` (wildcard/cặp khác) cũng KHÔNG mở màn",
    (cap) => {
      setCaps({ [cap]: true });
      renderWithQuery(<ChatOversightPage />);
      expect(screen.getByText("Bạn không có quyền dùng chức năng này")).toBeInTheDocument();
    },
  );

  it("caps `view:chat-oversight` (khớp CHÍNH XÁC) → thấy ô tra cứu + băng-rôn cảnh báo", () => {
    setCaps({ "view:chat-oversight": true });
    renderWithQuery(<ChatOversightPage />);

    expect(screen.getByLabelText("Tra phòng theo mã hoặc tên")).toBeInTheDocument();
    // SPEC-15 §3.3 — ranh giới riêng tư phải được CÔNG BỐ, không chôn trong code.
    expect(screen.getByRole("note")).toHaveTextContent(/phòng nhắn riêng/i);
    expect(screen.getByRole("note")).toHaveTextContent(/nhật ký kiểm toán/i);
  });
});

describe("CHAT-SCREEN-007 — tra cứu → xác nhận → mở phòng", () => {
  beforeEach(() => setCaps({ "view:chat-oversight": true }));

  it("dưới 2 ký tự: nút Tìm bị khoá, KHÔNG gọi 018a (request chắc chắn 422 vẫn đốt một dòng audit)", () => {
    renderWithQuery(<ChatOversightPage />);

    fireEvent.change(screen.getByLabelText("Tra phòng theo mã hoặc tên"), {
      target: { value: "k" },
    });
    expect(screen.getByRole("button", { name: /Tìm/ })).toBeDisabled();
    expect(searchRooms).not.toHaveBeenCalled();
  });

  it("bấm Tìm → gọi 018a đúng một lần, hiện kết quả", async () => {
    renderWithQuery(<ChatOversightPage />);
    submitSearch("ky thuat");

    await waitFor(() => expect(searchRooms).toHaveBeenCalledTimes(1));
    expect(searchRooms).toHaveBeenCalledWith(expect.objectContaining({ q: "ky thuat" }));
    expect(await screen.findByText("Phòng Kỹ thuật")).toBeInTheDocument();
  });

  it("`truncated: true` → nói ra rằng kết quả bị CẮT (im lặng = người dùng kết luận sai về phạm vi)", async () => {
    searchRooms.mockResolvedValue({ data: [ROOM], truncated: true });
    renderWithQuery(<ChatOversightPage />);
    submitSearch("ky thuat");

    expect(await screen.findByRole("status")).toHaveTextContent(/đã bị cắt/i);
  });

  it("[crown] bấm 'Xem với tư cách quản trị' CHƯA gọi 018b/018c — dấu vết audit phải khớp một quyết định có ý thức", async () => {
    renderWithQuery(<ChatOversightPage />);
    submitSearch("ky thuat");
    fireEvent.click(await screen.findByRole("button", { name: /Xem với tư cách quản trị/ }));

    expect(screen.getByRole("dialog")).toHaveTextContent(/nhật ký kiểm toán/i);
    expect(getRoom).not.toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Tôi hiểu, mở phòng/ }));
    await waitFor(() => expect(getRoom).toHaveBeenCalledWith(ROOM_ID));
    expect(listMessages).toHaveBeenCalled();
  });

  it("Huỷ hộp thoại → vẫn 0 lời gọi đọc nội dung", async () => {
    renderWithQuery(<ChatOversightPage />);
    submitSearch("ky thuat");
    fireEvent.click(await screen.findByRole("button", { name: /Xem với tư cách quản trị/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Huỷ$/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getRoom).not.toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();
  });
});

describe("CHAT-SCREEN-007 — phòng ở chế độ CHỈ ĐỌC", () => {
  it("[crown] không ô soạn tin, không nút ghim/thu hồi/sửa thành viên", async () => {
    renderWithQuery(<OversightRoomView room={ROOM} onBack={() => {}} />);
    expect(await screen.findByText("nội dung riêng tư")).toBeInTheDocument();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    for (const forbidden of [/gửi/i, /ghim/i, /thu hồi/i, /thêm thành viên/i, /rời phòng/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
    expect(screen.getByText("Chỉ đọc — chế độ quản trị")).toBeInTheDocument();
  });

  it("[crown] đính kèm hiện dưới dạng CHỮ — 0 link tải (CHAT-DEC-004 không mở đường tải tệp)", async () => {
    renderWithQuery(<OversightRoomView room={ROOM} onBack={() => {}} />);
    const attachments = await screen.findByRole("list", { name: "Tệp đính kèm" });

    expect(attachments).toHaveTextContent("bao-cao.pdf");
    expect(attachments).toHaveTextContent("12.1 KB");
    expect(attachments.querySelectorAll("a")).toHaveLength(0);
    expect(attachments.querySelectorAll("img")).toHaveLength(0);
  });

  it("tin đã thu hồi vẫn bị che — đọc-vượt mở ranh giới membership, KHÔNG mở masking", async () => {
    listMessages.mockResolvedValue([
      { ...MESSAGE, body: null, recalledAt: "2026-08-04T01:05:00.000Z", attachments: [] },
    ]);
    renderWithQuery(<OversightRoomView room={ROOM} onBack={() => {}} />);

    expect(await screen.findByText("Tin đã được thu hồi")).toBeInTheDocument();
    expect(screen.queryByText("nội dung riêng tư")).not.toBeInTheDocument();
  });
});
