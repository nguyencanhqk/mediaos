// @vitest-environment jsdom
/**
 * S5-ME-FE-4 — MeBannerAvatar tests (nút đổi ảnh nhanh trên banner /me). Phủ: hiện ảnh thật khi có ·
 * ẩn nút camera khi thiếu update:avatar · chọn ảnh hợp lệ → uploadAvatar · file sai loại → lỗi + KHÔNG upload.
 * Giữ web-core THẬT (useCan/useMeAvatar), chỉ stub meApi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { MeBannerAvatar } from "./MeBannerAvatar";

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

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ isAuthenticated: true, capabilities: caps });
}

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeBannerAvatar name="Trần Văn Test" />
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
  setCaps({ "update:avatar": true });
});

describe("MeBannerAvatar", () => {
  it("hiện ảnh thật khi GET /me/avatar trả downloadUrl", async () => {
    mockGetAvatar.mockResolvedValue({
      fileId: "f1",
      downloadUrl: "https://s3/get.png",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    renderBanner();
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("https://s3/get.png");
  });

  it("hiện nút camera 'Đổi ảnh' khi có update:avatar", () => {
    renderBanner();
    expect(screen.getByRole("button", { name: /Đổi ảnh/ })).toBeTruthy();
  });

  it("ẨN nút camera khi THIẾU update:avatar", () => {
    setCaps({});
    renderBanner();
    expect(screen.queryByRole("button", { name: /Đổi ảnh/ })).toBeNull();
  });

  it("chọn ảnh hợp lệ → gọi meApi.uploadAvatar", async () => {
    const { container } = renderBanner();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = pngFile();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file));
  });

  it("file SAI loại → hiện lỗi + KHÔNG upload", async () => {
    const { container } = renderBanner();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [txtFile()] } });
    expect(await screen.findByText(/Chỉ chấp nhận ảnh/)).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
