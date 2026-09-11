/**
 * S17-CHAT-UX2-QA-1 — `RoomMembersSheet`: cổng thao tác thành viên + nhãn "đã xem tới đâu".
 *
 * Trước QA-1 file này ở **22% hàm** — vỏ Sheet có render, nhưng KHÔNG ca nào bấm vào hai nút thao
 * tác, tức phần duy nhất có hậu quả ngoài màn hình chưa từng chạy.
 *
 * Hai luật được canh ở đây:
 *
 * (a) **Cổng bốn vế `canManageMember && isGroup && isRoomAdmin && member.userId !== myUserId`.**
 *     SPEC-15 §9 SCREEN-004 cấm "hiện nút rồi để server trả 403/CHAT-ERR-012". Bốn vế được đo bằng
 *     cách **tắt ĐÚNG MỘT vế, ba vế kia BẬT** — nếu ca nào cũng tắt nhiều vế cùng lúc thì cổng bị
 *     CHỒNG NHAU và spec sẽ xanh dù một vế bị gỡ (memory `overdetermined-gate-makes-deny-spec-vacuous`).
 *     Kèm một ca ALLOW đủ-bốn-vế, thiếu nó thì mọi ca DENY xanh RỖNG
 *     (memory `deny-cases-vacuous-without-allow-case`).
 *
 * (b) **`seenLabel`: `undefined` KHÁC `0`.** `lastReadSeq` là `.optional()` — `undefined` = "server
 *     không nói gì", `0` = "chưa đọc tin nào". Nhập hai cái làm một sẽ bêu "Chưa xem tin nào" lên
 *     người thật, tức một lời khẳng định SAI về một đồng nghiệp. Ca đo cả bốn nhánh.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, ChatRoomMemberDto } from "@mediaos/contracts";

const removeMember = vi.fn();
const updateMember = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      removeMember: (...a: unknown[]) => removeMember(...a),
      updateMember: (...a: unknown[]) => updateMember(...a),
    },
  };
});

import { useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { RoomMembersSheet, seenLabel } from "./RoomMembersSheet";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const BINH = "22222222-2222-4222-8222-222222222222";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Nhóm Kế toán",
    roomCode: "CHAT-KT",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: 10,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as ChatRoomDto;
}

function member(over: Partial<ChatRoomMemberDto> = {}): ChatRoomMemberDto {
  return {
    id: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm",
    roomId: ROOM_ID,
    userId: BINH,
    role: "member",
    joinedAt: "2026-09-01T00:00:00.000Z",
    userName: "Lê Bình",
    lastReadSeq: 10,
    ...over,
  } as ChatRoomMemberDto;
}

function renderSheet(over: Partial<Parameters<typeof RoomMembersSheet>[0]> = {}): {
  onChanged: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  // Luôn tự tạo: hai prop này được đặt SAU `{...over}` trong JSX nên `over` không đè được, và nhận
  // chúng qua `over` sẽ làm kiểu trả về rộng thành `(() => void) | Mock`.
  const onChanged = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomMembersSheet
          open
          room={room()}
          members={[member()]}
          myRole="admin"
          isLoading={false}
          loadError={false}
          {...over}
          onChanged={onChanged}
          onClose={onClose}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onChanged, onClose };
}

const promoteBtn = () => screen.queryByRole("button", { name: "Phong quản trị phòng" });
const demoteBtn = () => screen.queryByRole("button", { name: "Hạ xuống thành viên" });
const removeBtn = () => screen.queryByRole("button", { name: "Bớt khỏi phòng" });

beforeEach(() => {
  cleanup();
  removeMember.mockReset().mockResolvedValue({ removed: true });
  updateMember.mockReset().mockResolvedValue(member({ role: "admin" }));
  mockUseCan.mockReset().mockReturnValue(true);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("seenLabel — `undefined` KHÁC `0`", () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts === undefined ? key : `${key}:${String(opts.count)}`;

  it("undefined ⇒ 'chưa rõ' (server không nói gì), KHÔNG phải 'chưa xem tin nào'", () => {
    expect(seenLabel(undefined, 10, t)).toBe("info.members.seenUnknown");
  });

  it("0 ⇒ 'chưa xem tin nào'", () => {
    expect(seenLabel(0, 10, t)).toBe("info.members.seenNone");
  });

  it("bằng hoặc vượt con trỏ phòng ⇒ 'đã xem tin mới nhất'", () => {
    expect(seenLabel(10, 10, t)).toBe("info.members.seenLatest");
    // Vượt: xảy ra thật khi phòng vừa có tin mới mà `room.lastMessageSeq` của trang chưa refetch.
    expect(seenLabel(12, 10, t)).toBe("info.members.seenLatest");
  });

  it("tụt sau ⇒ đếm ĐÚNG số tin còn lại", () => {
    expect(seenLabel(4, 10, t)).toBe("info.members.seenBehind:6");
  });
});

describe("RoomMembersSheet — cổng bốn vế (tắt ĐÚNG một vế mỗi ca)", () => {
  it("ĐỦ bốn vế ⇒ hiện cả nút đổi vai trò lẫn nút bớt khỏi phòng", () => {
    renderSheet();

    expect(promoteBtn()).toBeInTheDocument();
    expect(removeBtn()).toBeInTheDocument();
  });

  it("thiếu cặp quyền manage:chat-member ⇒ ẩn (ba vế kia vẫn bật)", () => {
    mockUseCan.mockReturnValue(false);

    renderSheet();

    expect(promoteBtn()).not.toBeInTheDocument();
    expect(removeBtn()).not.toBeInTheDocument();
    // Hàng vẫn hiện — ẩn NÚT, không ẩn người.
    expect(screen.getByText("Lê Bình")).toBeInTheDocument();
  });

  it("phòng DẪN XUẤT (department/project) ⇒ ẩn + nêu lý do đồng bộ tự động", () => {
    renderSheet({ room: room({ roomType: "department" }) });

    expect(promoteBtn()).not.toBeInTheDocument();
    expect(removeBtn()).not.toBeInTheDocument();
    expect(screen.getByText(/do hệ thống đồng bộ tự động/)).toBeInTheDocument();
  });

  it("phòng direct ⇒ ẩn, và KHÔNG hiện lời nhắn phòng dẫn xuất", () => {
    renderSheet({ room: room({ roomType: "direct" }) });

    expect(promoteBtn()).not.toBeInTheDocument();
    expect(screen.queryByText(/do hệ thống đồng bộ tự động/)).not.toBeInTheDocument();
  });

  it("tôi chỉ là thành viên thường của phòng ⇒ ẩn", () => {
    renderSheet({ myRole: "member" });

    expect(promoteBtn()).not.toBeInTheDocument();
    expect(removeBtn()).not.toBeInTheDocument();
  });

  it("hàng của CHÍNH TÔI ⇒ ẩn (không tự bớt / tự phong qua màn này)", () => {
    renderSheet({ members: [member({ userId: ME, userName: "Tôi" })] });

    expect(screen.getByText(/\(Bạn\)/)).toBeInTheDocument();
    expect(promoteBtn()).not.toBeInTheDocument();
    expect(removeBtn()).not.toBeInTheDocument();
  });
});

describe("RoomMembersSheet — đổi vai trò", () => {
  it("thành viên ⇒ phong quản trị", async () => {
    const { onChanged } = renderSheet();

    fireEvent.click(promoteBtn()!);

    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(ROOM_ID, BINH, { role: "admin" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("quản trị ⇒ hạ xuống thành viên (nhãn nút đổi theo vai trò hiện tại)", async () => {
    renderSheet({ members: [member({ role: "admin" })] });
    expect(promoteBtn()).not.toBeInTheDocument();

    fireEvent.click(demoteBtn()!);

    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(ROOM_ID, BINH, { role: "member" }),
    );
  });

  it("thao tác lỗi ⇒ báo ở vùng role=alert, KHÔNG gọi onChanged", async () => {
    updateMember.mockRejectedValue(new Error("500"));
    const { onChanged } = renderSheet();

    fireEvent.click(promoteBtn()!);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Không thực hiện được thao tác thành viên.",
      ),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("RoomMembersSheet — bớt khỏi phòng", () => {
  it("bấm nút ⇒ HỎI LẠI kèm tên, chưa gọi server", () => {
    renderSheet();

    fireEvent.click(removeBtn()!);

    expect(screen.getByRole("heading", { name: "Bớt Lê Bình khỏi phòng?" })).toBeInTheDocument();
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("xác nhận ⇒ gọi removeMember rồi đóng hộp hỏi lại", async () => {
    const { onChanged } = renderSheet();
    fireEvent.click(removeBtn()!);

    fireEvent.click(screen.getAllByRole("button", { name: "Bớt khỏi phòng" }).at(-1)!);

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(ROOM_ID, BINH));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Bớt Lê Bình khỏi phòng?" })).not.toBeInTheDocument(),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("huỷ ⇒ đóng hộp, KHÔNG gọi server", () => {
    renderSheet();
    fireEvent.click(removeBtn()!);

    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));

    expect(screen.queryByRole("heading", { name: "Bớt Lê Bình khỏi phòng?" })).not.toBeInTheDocument();
    expect(removeMember).not.toHaveBeenCalled();
  });
});

describe("RoomMembersSheet — loading / lỗi / rỗng / presence", () => {
  it("đang tải ⇒ khung xương có aria-busy, chưa hiện hàng nào", () => {
    renderSheet({ isLoading: true });

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByTestId("chat-member-row")).toHaveLength(0);
  });

  it("lỗi tải ⇒ báo, không im lặng để danh sách trống", () => {
    renderSheet({ loadError: true });

    expect(screen.getByText("Không tải được danh sách thành viên.")).toBeInTheDocument();
  });

  it("phòng rỗng ⇒ nói rõ là rỗng", () => {
    renderSheet({ members: [] });

    expect(screen.getByText("Phòng chưa có thành viên nào.")).toBeInTheDocument();
  });

  it("chấm online đọc TỪ STORE, và chỉ hiện cho người đang online", () => {
    useChatStore.getState().hydratePresence([{ userId: BINH, isOnline: false }]);
    renderSheet();
    expect(screen.queryByTestId("chat-member-online-dot")).not.toBeInTheDocument();

    cleanup();
    useChatStore.getState().hydratePresence([{ userId: BINH, isOnline: true }]);
    renderSheet();

    expect(screen.getByTestId("chat-member-online-dot")).toBeInTheDocument();
  });
});
