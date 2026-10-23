/**
 * S16-SOCIAL-FILEOPENUX-1 L-2 — danh sách «Tệp» của bảng thông tin phòng.
 *
 * Tệp không phải ảnh được server phục vụ dạng TẢI XUỐNG ⇒ ô tệp mang tên trợ năng «Tải xuống <tên>». Ảnh
 * (đối chứng) giữ nguyên: mở ở tab mới. Cách lấy URL (gắn lúc render) KHÔNG đổi ở WO này — thuộc
 * S19-FE-SIGNEDTAB-2.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { ChatRoomFileDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import type { RoomFilesState } from "./room-info/use-room-files";

const state: { current: RoomFilesState } = {
  current: {
    files: [],
    isLoading: false,
    isLoadingMore: false,
    hasError: false,
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
  },
};

vi.mock("./room-info/use-room-files", () => ({
  useRoomFiles: () => state.current,
}));

import { RoomFilesTab } from "./RoomFilesTab";

const ROOM = "11111111-1111-4111-8111-111111111111";

function file(over: Partial<ChatRoomFileDto>): ChatRoomFileDto {
  return {
    id: "aaaaaaa1-1111-4111-8111-111111111111",
    fileId: "aaaaaaa2-1111-4111-8111-111111111111",
    name: "bao-cao.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    isImage: false,
    url: "https://storage/signed-pdf",
    thumbnailUrl: null,
    messageId: "aaaaaaa3-1111-4111-8111-111111111111",
    roomSeq: 7,
    senderId: "aaaaaaa4-1111-4111-8111-111111111111",
    senderName: "Nguyễn Văn A",
    createdAt: "2026-10-20T03:00:00.000Z",
    ...over,
  };
}

function renderTab(files: readonly ChatRoomFileDto[]) {
  state.current = { ...state.current, files };
  return render(
    <I18nextProvider i18n={i18n}>
      <RoomFilesTab roomId={ROOM} onJumpToMessage={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("RoomFilesTab — nhãn ô tệp (S16-SOCIAL-FILEOPENUX-1 L-2)", () => {
  it("[RED] ô tệp PDF ⇒ tên trợ năng «Tải xuống <tên>»", () => {
    const { container } = renderTab([file({})]);
    const link = container.querySelector('a[href="https://storage/signed-pdf"]');
    expect(link?.getAttribute("aria-label")).toBe("Tải xuống bao-cao.pdf");
    expect(screen.getByRole("link", { name: "Tải xuống bao-cao.pdf" })).toBe(link);
  });

  it("[allow] ô ẢNH ⇒ vẫn `target=_blank`, không thêm nhãn «Tải xuống»", () => {
    const { container } = renderTab([
      file({
        name: "anh.png",
        mimeType: "image/png",
        isImage: true,
        url: "https://storage/anh",
        thumbnailUrl: "https://storage/anh-thumb",
      }),
    ]);
    const link = container.querySelector('a[href="https://storage/anh"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("aria-label")).toBeNull();
  });

  it("[allow] tệp bị từ chối ký (`url = null`) ⇒ không có liên kết tải", () => {
    const { container } = renderTab([file({ url: null })]);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByTestId("chat-file-unavailable")).toBeTruthy();
  });
});
