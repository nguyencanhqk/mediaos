/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-05) — mục «Đánh dấu đã đọc» trong menu ngữ cảnh của MỘT hội thoại.
 *
 * Hai điều phải khoá ở đây, cả hai đều hỏng im lặng:
 *  (a) mục hiện khi phòng TRÔNG chưa đọc — badge > 0 HOẶC `markedUnreadAt ≠ null` (đánh dấu tay không
 *      đổi badge, nên chỉ hỏi badge là bỏ rơi đúng phòng người dùng vừa tự đánh dấu);
 *  (b) phòng không có `lastMessageSeq` (server cũ) ⇒ KHÔNG có mục: FE không có số thật để gửi, và gửi
 *      một số «sentinel» là đúng điều `done_when` cấm.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";
import { RoomRowMenu } from "./RoomRowMenu";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng thử",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 12,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function renderMenu(target: ChatRoomDto) {
  const onMarkRead = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <RoomRowMenu
        room={target}
        label="Phòng thử"
        open
        onOpenChange={onOpenChange}
        canArchive={false}
        isBusy={false}
        onTogglePin={vi.fn()}
        onMute={vi.fn()}
        onMarkUnread={vi.fn()}
        onMarkRead={onMarkRead}
        onArchive={vi.fn()}
      />
    </I18nextProvider>,
  );
  return { onMarkRead, onOpenChange };
}

describe("RoomRowMenu · «Đánh dấu đã đọc»", () => {
  it("phòng có badge ⇒ có mục; bấm ⇒ đóng menu rồi gọi onMarkRead với đúng phòng", () => {
    const target = room({ unreadCount: 4 });
    const { onMarkRead, onOpenChange } = renderMenu(target);

    const item = screen.getByTestId("chat-room-menu-read");
    expect(item.textContent).toContain("Đánh dấu đã đọc");
    fireEvent.click(item);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onMarkRead).toHaveBeenCalledWith(target);
  });

  it("đánh dấu chưa đọc tay (badge 0, markedUnreadAt ≠ null) ⇒ VẪN có mục", () => {
    renderMenu(room({ unreadCount: 0, markedUnreadAt: "2026-08-04T10:05:00.000Z" }));
    expect(screen.getByTestId("chat-room-menu-read")).toBeTruthy();
  });

  it("phòng đã đọc hết, không cờ ⇒ KHÔNG có mục", () => {
    renderMenu(room({ unreadCount: 0, markedUnreadAt: null }));
    expect(screen.queryByTestId("chat-room-menu-read")).toBeNull();
    // Mục cũ vẫn ở đó — thêm một mục không được làm rơi «Đánh dấu chưa đọc».
    expect(screen.getByTestId("chat-room-menu-unread")).toBeTruthy();
  });

  it("server cũ không trả lastMessageSeq ⇒ KHÔNG có mục (không bịa số sentinel)", () => {
    renderMenu(room({ unreadCount: 3, lastMessageSeq: undefined }));
    expect(screen.queryByTestId("chat-room-menu-read")).toBeNull();
  });
});
