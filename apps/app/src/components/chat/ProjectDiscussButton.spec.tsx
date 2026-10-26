/**
 * S20-CHAT-DISCUSS-1 (US-CHAT-NV-11) — nút «Thảo luận» mở phòng chat của dự án trong drawer.
 *
 * Quyền đo bằng `useCan` THẬT trên `useAuthStore.capabilities` (không mock hook): cặp sai một chữ thì
 * ca ALLOW đỏ. Mỗi ca DENY tắt ĐÚNG MỘT vế, các vế kia bật — có ca ALLOW đi kèm nên ca DENY không rỗng.
 * Mạng đo bằng spy trên `fetch` thật: nút chỉ đọc danh sách phòng đã có trong store, không tự hỏi server.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { useAuthStore } from "@mediaos/web-core";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";
import { ProjectDiscussButton } from "./ProjectDiscussButton";

const PROJECT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_PROJECT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAT_CAPS = { "access:chat": true, "view:chat-room": true };

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: PROJECT_ID,
    roomType: "project",
    name: "Phòng dự án Bí mật",
    roomCode: "CHAT-PRJ",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: 3,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as ChatRoomDto;
}

function setCaps(caps: Record<string, boolean>): void {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function renderButton(props: { expectsRoom?: boolean } = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectDiscussButton projectId={PROJECT_ID} {...props} />
    </I18nextProvider>,
  );
}

const discussBtn = () => screen.queryByRole("button", { name: /Thảo luận/ });

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  cleanup();
  useChatStore.getState().resetChatStore();
  useChatDockStore.getState().resetChatDock();
  setCaps(CHAT_CAPS);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("ProjectDiscussButton — phòng dự án có trong danh sách của tôi", () => {
  it("bấm «Thảo luận» ⇒ drawer mở đúng phòng của dự án, không gọi API nào", () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderButton();

    const button = discussBtn();
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    fireEvent.click(button!);

    const dock = useChatDockStore.getState();
    expect(dock.isOpen).toBe(true);
    expect(dock.openRoomIds).toEqual([ROOM_ID]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chọn ĐÚNG phòng khi danh sách có phòng của dự án khác và phòng nhóm trùng refId", () => {
    useChatStore
      .getState()
      .syncRoomList(
        [
          room({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", refId: OTHER_PROJECT_ID }),
          room({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", roomType: "group" }),
          room(),
        ],
        false,
      );
    renderButton();

    fireEvent.click(discussBtn()!);

    expect(useChatDockStore.getState().openRoomIds).toEqual([ROOM_ID]);
  });
});

describe("ProjectDiscussButton — không có nút", () => {
  it("phòng của dự án không có trong danh sách của tôi ⇒ không nút, không lộ tên phòng, 0 lời gọi API", () => {
    useChatStore.getState().syncRoomList([room({ refId: OTHER_PROJECT_ID })], false);
    const { container } = renderButton();

    expect(discussBtn()).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Bí mật/)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("phòng nhóm (không phải phòng dự án) trùng refId ⇒ không nút", () => {
    useChatStore.getState().syncRoomList([room({ roomType: "group" })], false);
    renderButton();

    expect(discussBtn()).not.toBeInTheDocument();
  });

  it("thiếu cặp `view:chat-room` (cặp còn lại bật) ⇒ ẩn dù phòng có trong danh sách", () => {
    useChatStore.getState().syncRoomList([room()], false);
    setCaps({ "access:chat": true });
    renderButton({ expectsRoom: true });

    expect(discussBtn()).not.toBeInTheDocument();
    expect(screen.queryByText("Phòng dự án đang được tạo")).not.toBeInTheDocument();
  });

  it("thiếu cặp `access:chat` (không có drawer để mở) ⇒ ẩn dù phòng có trong danh sách", () => {
    useChatStore.getState().syncRoomList([room()], false);
    setCaps({ "view:chat-room": true });
    renderButton({ expectsRoom: true });

    expect(discussBtn()).not.toBeInTheDocument();
  });

  it("danh sách phòng chưa về ⇒ chưa hiện gì, không tự gọi API", () => {
    const { container } = renderButton({ expectsRoom: true });

    expect(container).toBeEmptyDOMElement();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ProjectDiscussButton — phòng dự án chưa đồng bộ xong", () => {
  it("tôi là thành viên dự án mà phòng chưa có ⇒ nút vô hiệu kèm «Phòng dự án đang được tạo»", () => {
    useChatStore.getState().syncRoomList([], false);
    renderButton({ expectsRoom: true });

    const button = discussBtn();
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(screen.getByText("Phòng dự án đang được tạo")).toBeInTheDocument();
    fireEvent.click(button!);
    expect(useChatDockStore.getState().isOpen).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("phòng về sau (sự kiện `chat:room`) ⇒ nút tự bật, bấm được", () => {
    useChatStore.getState().syncRoomList([], false);
    renderButton({ expectsRoom: true });
    expect(discussBtn()).toBeDisabled();

    act(() => useChatStore.getState().syncRoomList([room()], false));

    expect(discussBtn()).not.toBeDisabled();
    expect(screen.queryByText("Phòng dự án đang được tạo")).not.toBeInTheDocument();
  });
});
