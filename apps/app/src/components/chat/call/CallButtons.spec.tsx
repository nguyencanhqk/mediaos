/**
 * CallButtons.spec.tsx — hai cổng của nút gọi (S7-CALL-FE-1, plan §0.1 + §7).
 *
 * ⚠️ Mỗi cổng có **ca ALLOW đi kèm ca DENY**. Ca DENY một mình sẽ xanh cả khi component lỡ trả `null`
 * trong MỌI trường hợp — lúc đó bài test đóng đinh một tính năng đã chết chứ không đóng đinh một cổng
 * (memory `deny-cases-vacuous-without-allow-case`).
 *
 * Cổng 1-1 tồn tại vì BE seed hàng participant cho MỌI thành viên active khi có lời mời, và §12 chốt
 * đúng 30 mã lỗi — **không có mã nào** cho "cuộc gọi đã đủ người". Ràng buộc 1-1 vì thế là topology
 * media do FE giữ; bỏ nó là bấm gọi ở phòng phòng-ban 40 người rung chuông 40 máy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, useCan: vi.fn(() => true) };
});

import { useCan } from "@mediaos/web-core";
import { CallButtons } from "./CallButtons";
import { CHAT_PAIRS } from "@/routes/chat/constants";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

const DIRECT_ROOM: ChatRoomDto = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "44444444-4444-4444-8444-444444444444",
  refId: null,
  roomType: "direct",
  name: null,
  roomCode: "DM-001",
  description: null,
  lastMessageAt: null,
  lastMessageSeq: 0,
  isArchived: false,
  unreadCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
} as ChatRoomDto;

const TWO_MEMBERS = [{ userId: "u1" }, { userId: "u2" }];

function renderButtons(
  overrides: {
    room?: ChatRoomDto;
    members?: { userId: string; leftAt?: string | null }[];
    isBusy?: boolean;
  } = {},
) {
  const onStartCall = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <CallButtons
        room={overrides.room ?? DIRECT_ROOM}
        members={overrides.members ?? TWO_MEMBERS}
        isBusy={overrides.isBusy ?? false}
        onStartCall={onStartCall}
      />
    </I18nextProvider>,
  );
  return { onStartCall };
}

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
});

describe("cổng quyền `call:chat-room`", () => {
  it("ALLOW — có quyền + phòng 1-1 ⇒ hiện ĐỦ hai nút", () => {
    renderButtons();
    expect(screen.getByTestId("chat-call-audio")).toBeTruthy();
    expect(screen.getByTestId("chat-call-video")).toBeTruthy();
  });

  it("DENY — thiếu quyền ⇒ KHÔNG render nút nào (không phải render rồi `disabled`)", () => {
    mockUseCan.mockReturnValue(false);
    renderButtons();
    expect(screen.queryByTestId("chat-call-audio")).toBeNull();
    expect(screen.queryByTestId("chat-call-video")).toBeNull();
  });

  it("hỏi ĐÚNG cặp quyền mà BE bắt buộc (`call` × `chat-room`)", () => {
    // Cặp sai thì cổng UI mở/đóng NGƯỢC với server mà không test nào khác đỏ
    // (memory `s1-fnd-module-metadata-seed-drift`).
    renderButtons();
    expect(mockUseCan).toHaveBeenCalledWith(CHAT_PAIRS.CALL.action, CHAT_PAIRS.CALL.resourceType);
    expect(CHAT_PAIRS.CALL).toEqual({ action: "call", resourceType: "chat-room" });
  });
});

describe("cổng topology 1-1 (plan §0.1)", () => {
  it("DENY — phòng `direct` nhưng có 3 thành viên CHƯA RỜI ⇒ 0 nút", () => {
    renderButtons({ members: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }] });
    expect(screen.queryByTestId("chat-call-audio")).toBeNull();
  });

  it("DENY — phòng `group` (dù chỉ 2 người) ⇒ 0 nút", () => {
    renderButtons({ room: { ...DIRECT_ROOM, roomType: "group" } as ChatRoomDto });
    expect(screen.queryByTestId("chat-call-audio")).toBeNull();
  });

  it("ALLOW — người thứ ba ĐÃ RỜI thì phòng lại là 1-1 ⇒ hiện nút", () => {
    // Roster GỒM CẢ người đã rời (`use-room-roster`). Đếm thẳng `members.length` sẽ tắt nút vĩnh viễn
    // ở mọi phòng DM từng có người rời — một lỗi chỉ lộ ra sau vài tháng dùng thật.
    renderButtons({
      members: [
        { userId: "u1" },
        { userId: "u2" },
        { userId: "u3", leftAt: "2026-08-01T00:00:00.000Z" },
      ],
    });
    expect(screen.getByTestId("chat-call-audio")).toBeTruthy();
  });
});

describe("hành vi bấm", () => {
  it("bấm gọi thoại/gọi hình báo đúng `kind` lên trên", () => {
    const { onStartCall } = renderButtons();
    screen.getByTestId("chat-call-audio").click();
    expect(onStartCall).toHaveBeenCalledWith("audio");
    screen.getByTestId("chat-call-video").click();
    expect(onStartCall).toHaveBeenCalledWith("video");
  });

  it("đang có cuộc gọi khác ⇒ nút bị vô hiệu (BE trả 409 nếu bấm được)", () => {
    renderButtons({ isBusy: true });
    expect(screen.getByTestId<HTMLButtonElement>("chat-call-audio").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("chat-call-video").disabled).toBe(true);
  });
});
