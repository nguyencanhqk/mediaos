/**
 * S17-CHAT-UX2-FE-2 — `done_when #5`, thanh đầu hội thoại v2 (SPEC-15 §9 CHAT-SCREEN-001).
 *
 * Trọng tâm là **ba giá trị của `peerOnline`** (`null` · `true` · `false`). Bản S7 dùng boolean, và ở
 * phòng nhóm nó luôn là `false` — tức "không biết" bị trình bày y hệt "đang offline". Sự kiện
 * `chat:presence` CỐ Ý chỉ fan-out tới peer DM (phát trạng thái online của mọi người tới mọi phòng là
 * rò lịch làm việc), nên "không biết" là trạng thái có thật và phải hiện ra khác đi.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";
import { ConversationHeader } from "./ConversationHeader";

const room = (over: Partial<ChatRoomDto> = {}): ChatRoomDto => ({
  id: "11111111-1111-4111-8111-111111111111",
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
});

function renderHeader(props: Partial<Parameters<typeof ConversationHeader>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ConversationHeader
        room={room()}
        title="Phòng thử"
        memberCount={12}
        peerOnline={null}
        peerAvatarUrl={null}
        isInfoOpen={false}
        {...props}
      />
    </I18nextProvider>,
  );
}

describe("ConversationHeader · dòng trạng thái", () => {
  it("phòng nhóm (peerOnline = null) ⇒ hiện SỐ THÀNH VIÊN, không chấm online", () => {
    renderHeader();
    expect(screen.getByText(/12 thành viên/)).toBeTruthy();
    expect(screen.queryByTestId("chat-peer-online-dot")).toBeNull();
  });

  it("DM đang online ⇒ chấm + CHỮ 'Đang hoạt động' (chấm màu không nói gì với trình đọc màn hình)", () => {
    renderHeader({ room: room({ roomType: "direct", name: null }), peerOnline: true });
    expect(screen.getByTestId("chat-peer-online-dot")).toBeTruthy();
    expect(screen.getByText(/Đang hoạt động/)).toBeTruthy();
  });

  it("DM offline (peerOnline = false) ⇒ KHÔNG chấm, và KHÔNG nói 'Đang hoạt động'", () => {
    renderHeader({ room: room({ roomType: "direct", name: null }), peerOnline: false });
    expect(screen.queryByTestId("chat-peer-online-dot")).toBeNull();
    expect(screen.queryByText(/Đang hoạt động/)).toBeNull();
  });

  it("chưa tải xong `getRoom` (memberCount = 0) ⇒ rơi về LOẠI phòng, không hiện '0 thành viên'", () => {
    renderHeader({ memberCount: 0 });
    expect(screen.queryByText(/0 thành viên/)).toBeNull();
  });
});

describe("ConversationHeader · avatar", () => {
  it("phòng nhóm ⇒ dùng RoomAvatar (ảnh phòng)", () => {
    renderHeader();
    expect(screen.getByTestId("chat-room-avatar")).toBeTruthy();
    expect(screen.queryByTestId("chat-header-avatar")).toBeNull();
  });

  it("phòng direct ⇒ avatar NGƯỜI ĐỐI THOẠI từ roster, không phải ảnh phòng", () => {
    // `chk_chat_rooms_direct_no_avatar` (mig 0543) ép phòng direct KHÔNG có avatarUrl riêng — ảnh DM
    // luôn là dẫn xuất từ người kia.
    renderHeader({
      room: room({ roomType: "direct", name: null }),
      title: "Trần B",
      peerAvatarUrl: "https://r2.local/signed/b.png",
    });
    const node = screen.getByTestId("chat-header-avatar");
    expect(node.querySelector("img")?.getAttribute("src")).toBe("https://r2.local/signed/b.png");
    expect(screen.queryByTestId("chat-room-avatar")).toBeNull();
  });
});

describe("ConversationHeader · cụm nút", () => {
  it("có `onSearchInRoom` ⇒ hiện nút tìm-trong-phòng và bấm được", () => {
    const onSearchInRoom = vi.fn();
    renderHeader({ onSearchInRoom });
    screen.getByTestId("chat-header-search").click();
    expect(onSearchInRoom).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG có `onSearchInRoom` (drawer chưa có cột tìm kiếm) ⇒ ẩn hẳn nút, không hiện nút chết", () => {
    renderHeader();
    expect(screen.queryByTestId("chat-header-search")).toBeNull();
  });

  it("`callSlot` do caller dựng — thanh đầu KHÔNG tự gọi CallProvider", () => {
    renderHeader({ callSlot: <button data-testid="fake-call">gọi</button> });
    expect(screen.getByTestId("fake-call")).toBeTruthy();
  });

  it("nút ⓘ phản ánh trạng thái bảng thông tin qua `aria-pressed`", () => {
    const onToggleInfo = vi.fn();
    const { rerender } = renderHeader({ isInfoOpen: true, onToggleInfo });
    expect(screen.getByLabelText(/Đóng thông tin phòng/).getAttribute("aria-pressed")).toBe("true");

    rerender(
      <I18nextProvider i18n={i18n}>
        <ConversationHeader
          room={room()}
          title="Phòng thử"
          memberCount={12}
          peerOnline={null}
          peerAvatarUrl={null}
          isInfoOpen={false}
          onToggleInfo={onToggleInfo}
        />
      </I18nextProvider>,
    );
    expect(screen.getByLabelText(/Thông tin phòng/).getAttribute("aria-pressed")).toBe("false");
  });
});
