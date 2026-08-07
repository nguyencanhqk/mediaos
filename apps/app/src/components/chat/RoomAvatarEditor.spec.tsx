/**
 * S8-CHAT-UX-FE-2 — `RoomAvatarEditor`: BỐN nhánh CHAT-DEC-016 (SPEC-15 §11b).
 *
 * Đây là test file quan trọng nhất của WO. SPEC-15 §9 CHAT-SCREEN-004 cấm "hiện nút rồi để server trả
 * 403", nên mỗi nhánh phải kiểm CẢ HAI chiều: đủ tư cách ⇒ HIỆN, thiếu tư cách ⇒ **không render gì**.
 * Chỉ kiểm chiều "hiện" là để một bản vá nới AND→OR đi lọt (memory `reviewer-proposed-fix-can-open-holes`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const getProject = vi.fn();
const uploadRoomAvatar = vi.fn();
const removeRoomAvatar = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    taskProjectApi: { ...actual.taskProjectApi, getProject: (...a: unknown[]) => getProject(...a) },
    chatRoomAvatarApi: {
      uploadRoomAvatar: (...a: unknown[]) => uploadRoomAvatar(...a),
      removeRoomAvatar: (...a: unknown[]) => removeRoomAvatar(...a),
    },
  };
});

import { ApiError, useCan } from "@mediaos/web-core";
import { RoomAvatarEditor } from "./RoomAvatarEditor";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng A",
    roomCode: "CHAT-A",
    description: null,
    lastMessageAt: "2026-08-07T09:00:00.000Z",
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function renderEditor(
  over: Partial<ChatRoomDto> = {},
  myRole: "member" | "admin" | null = "admin",
  onChanged = vi.fn(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RoomAvatarEditor
          room={room(over)}
          label="Phòng A"
          myRole={myRole}
          onChanged={onChanged}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onChanged };
}

/** Cổng mở/đóng = khối có render hay không. `null` nghĩa là người xem không thấy MỘT nút nào. */
const editorShown = () => screen.queryByTestId("chat-room-avatar-editor") !== null;

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  getProject.mockReset();
  uploadRoomAvatar.mockReset();
  removeRoomAvatar.mockReset();
});

describe("CHAT-DEC-016 · nhánh `direct` — KHÔNG AI đặt được", () => {
  it("phòng direct: không render dù có đủ mọi cặp quyền và là admin", () => {
    mockUseCan.mockReturnValue(true);
    renderEditor({ roomType: "direct", name: null }, "admin");

    expect(editorShown()).toBe(false);
  });
});

describe("CHAT-DEC-016 · nhánh `group` — admin PHÒNG", () => {
  it("là admin phòng + có `update:chat-room` ⇒ hiện", () => {
    renderEditor({ roomType: "group" }, "admin");

    expect(editorShown()).toBe(true);
  });

  it("chỉ là thành viên thường ⇒ KHÔNG hiện (cặp quyền không thay được tư cách phòng)", () => {
    mockUseCan.mockReturnValue(true);
    renderEditor({ roomType: "group" }, "member");

    expect(editorShown()).toBe(false);
  });

  it("là admin phòng nhưng THIẾU `update:chat-room` ⇒ KHÔNG hiện (điều kiện CẦN)", () => {
    mockUseCan.mockImplementation((_a: string, resource: string) => resource !== "chat-room");
    renderEditor({ roomType: "group" }, "admin");

    expect(editorShown()).toBe(false);
  });

  it("phòng ĐÃ LƯU TRỮ ⇒ KHÔNG hiện (phòng lưu trữ chỉ đọc — server ném CHAT-ERR-005)", () => {
    renderEditor({ roomType: "group", isArchived: true }, "admin");

    expect(editorShown()).toBe(false);
  });
});

describe("CHAT-DEC-016 · nhánh `department` — cặp `update:org_unit`", () => {
  it("có `update:org_unit` ⇒ hiện, DÙ không phải admin phòng (phòng dẫn xuất có 0 admin)", () => {
    mockUseCan.mockReturnValue(true);
    renderEditor({ roomType: "department" }, "member");

    expect(editorShown()).toBe(true);
    expect(mockUseCan).toHaveBeenCalledWith("update", "org_unit");
  });

  it("thiếu `update:org_unit` ⇒ KHÔNG hiện, kể cả khi là admin phòng", () => {
    mockUseCan.mockImplementation((_a: string, resource: string) => resource !== "org_unit");
    renderEditor({ roomType: "department" }, "admin");

    expect(editorShown()).toBe(false);
  });
});

describe("CHAT-DEC-016 · nhánh `project` — vai trò quản lý dự án", () => {
  it("Owner/Manager của dự án neo ⇒ hiện", async () => {
    getProject.mockResolvedValue({ id: PROJECT_ID, myProjectRole: "Manager" });
    renderEditor({ roomType: "project", refId: PROJECT_ID }, "member");

    await waitFor(() => expect(editorShown()).toBe(true));
    expect(getProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("Member/Viewer ⇒ KHÔNG hiện", async () => {
    getProject.mockResolvedValue({ id: PROJECT_ID, myProjectRole: "Member" });
    renderEditor({ roomType: "project", refId: PROJECT_ID }, "admin");

    await waitFor(() => expect(getProject).toHaveBeenCalled());
    expect(editorShown()).toBe(false);
  });

  /** Không đọc được dự án (`read:project` ngoài data-scope) là câu trả lời HỢP LỆ: fail-closed. */
  it("không đọc được dự án (403) ⇒ KHÔNG hiện — fail-closed, không phải lỗi để báo", async () => {
    getProject.mockRejectedValue(new ApiError(403, "AUTH-ERR-FORBIDDEN", "cấm"));
    renderEditor({ roomType: "project", refId: PROJECT_ID }, "admin");

    await waitFor(() => expect(getProject).toHaveBeenCalled());
    expect(editorShown()).toBe(false);
  });

  it("phòng `project` thiếu neo `refId` ⇒ KHÔNG hiện và KHÔNG gọi API dự án", () => {
    renderEditor({ roomType: "project", refId: null }, "admin");

    expect(editorShown()).toBe(false);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("KHÔNG hỏi vai trò dự án cho phòng `group` — không gọi API thừa", () => {
    renderEditor({ roomType: "group" }, "admin");

    expect(getProject).not.toHaveBeenCalled();
  });
});

describe("đặt / gỡ ảnh", () => {
  it("chọn tệp ⇒ upload rồi `onChanged()` (phải tải lại để lấy URL ký TƯƠI)", async () => {
    uploadRoomAvatar.mockResolvedValue({ fileId: "f1" });
    const { onChanged } = renderEditor({ roomType: "group" }, "admin");

    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("chat-room-avatar-input"), { target: { files: [file] } });

    await waitFor(() => expect(uploadRoomAvatar).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("ảnh quá lớn ⇒ báo NGAY ở client, KHÔNG gọi API", () => {
    renderEditor({ roomType: "group" }, "admin");

    const big = new File([new Uint8Array(6 * 1024 * 1024)], "to.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("chat-room-avatar-input"), { target: { files: [big] } });

    expect(uploadRoomAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("MB");
  });

  it("nút GỠ chỉ hiện khi phòng ĐANG có ảnh", () => {
    renderEditor({ roomType: "group", avatarUrl: null }, "admin");
    expect(screen.queryByTestId("chat-room-avatar-remove")).toBeNull();
  });

  it("gỡ ảnh ⇒ gọi removeRoomAvatar rồi `onChanged()`", async () => {
    removeRoomAvatar.mockResolvedValue(undefined);
    const { onChanged } = renderEditor(
      { roomType: "group", avatarUrl: "https://storage.example/a.png" },
      "admin",
    );

    fireEvent.click(screen.getByTestId("chat-room-avatar-remove"));

    await waitFor(() => expect(removeRoomAvatar).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  /**
   * Ca lệch của xấp xỉ `department` (custom-role `update:org_unit@Department`): server vẫn là người
   * quyết cuối. Thông điệp phải nói ĐÚNG "không đủ tư cách", không nuốt thành "có lỗi xảy ra".
   */
  it("server từ chối 403 (CHAT-ERR-023) ⇒ thông điệp nói rõ 'không đủ tư cách'", async () => {
    uploadRoomAvatar.mockRejectedValue(new ApiError(403, "CHAT-ERR-023", "cấm"));
    renderEditor({ roomType: "department" }, "member");

    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("chat-room-avatar-input"), { target: { files: [file] } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("không đủ tư cách");
  });

  it("server trả 422 (CHAT-ERR-022) ⇒ thông điệp KHÁC 403 — hai việc khác nhau với người dùng", async () => {
    uploadRoomAvatar.mockRejectedValue(new ApiError(422, "CHAT-ERR-022", "direct"));
    renderEditor({ roomType: "group" }, "admin");

    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("chat-room-avatar-input"), { target: { files: [file] } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("không có ảnh đại diện riêng");
  });
});
