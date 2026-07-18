// @vitest-environment jsdom
/**
 * S5-ME-FE-4 — AvatarUploadCard tests (dùng ở /hr/me/profile). Phủ: render tiêu đề · gate nút theo
 * update:avatar · chọn ảnh hợp lệ → uploadAvatar · file sai loại → lỗi + KHÔNG upload · đã có avatar →
 * hiện ảnh + Gỡ gọi removeAvatar. Giữ web-core THẬT (useCan/useMeAvatar/meKeys), chỉ stub meApi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { AvatarUploadCard } from "./AvatarUploadCard";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: {
      getAvatar: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
    },
  };
});

import { meApi } from "@mediaos/web-core";
const mockGetAvatar = meApi.getAvatar as ReturnType<typeof vi.fn>;
const mockUpload = meApi.uploadAvatar as ReturnType<typeof vi.fn>;
const mockRemove = meApi.removeAvatar as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ isAuthenticated: true, capabilities: caps });
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AvatarUploadCard name="Trần Văn Test" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const pngFile = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
const txtFile = () => new File([new Uint8Array([1, 2, 3])], "a.txt", { type: "text/plain" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAvatar.mockResolvedValue(null);
  mockUpload.mockResolvedValue({
    fileId: "f1",
    downloadUrl: "https://s3/get.png",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  mockRemove.mockResolvedValue(undefined);
  setCaps({ "update:avatar": true });
});

describe("AvatarUploadCard", () => {
  it("hiện tiêu đề + nút Đổi ảnh khi có quyền update:avatar", async () => {
    renderCard();
    expect(await screen.findByText("Ảnh đại diện")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Đổi ảnh/ })).toBeTruthy();
  });

  it("ẨN nút quản lý khi THIẾU update:avatar (server vẫn là chốt)", async () => {
    setCaps({});
    renderCard();
    expect(await screen.findByText("Ảnh đại diện")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Đổi ảnh/ })).toBeNull();
  });

  it("chọn ảnh hợp lệ → gọi meApi.uploadAvatar với file", async () => {
    const { container } = renderCard();
    await screen.findByText("Ảnh đại diện");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = pngFile();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file));
  });

  it("file SAI loại → hiện lỗi + KHÔNG gọi uploadAvatar", async () => {
    const { container } = renderCard();
    await screen.findByText("Ảnh đại diện");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [txtFile()] } });
    expect(await screen.findByText(/Chỉ chấp nhận ảnh/)).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("file VƯỢT dung lượng → hiện lỗi kích thước + KHÔNG upload", async () => {
    const { container } = renderCard();
    await screen.findByText("Ảnh đại diện");
    const big = pngFile();
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 }); // > 5MB
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/vượt quá/i)).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("upload thất bại → hiện thông điệp lỗi (KHÔNG nuốt)", async () => {
    mockUpload.mockRejectedValue(new Error("boom"));
    const { container } = renderCard();
    await screen.findByText("Ảnh đại diện");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect(await screen.findByText(/Tải ảnh lên thất bại/)).toBeTruthy();
  });

  it("khi ĐÃ có avatar → hiện ảnh + nút Gỡ gọi removeAvatar", async () => {
    mockGetAvatar.mockResolvedValue({
      fileId: "f1",
      downloadUrl: "https://s3/get.png",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    renderCard();
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("https://s3/get.png");
    fireEvent.click(screen.getByRole("button", { name: /Gỡ ảnh/ }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });
});
