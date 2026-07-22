// @vitest-environment jsdom
/**
 * S5-BRAND-FE-1 — BrandingSection tests (khối "Thương hiệu" ở /system/company).
 *
 * Phủ: loading/error/empty · GATE nút theo update:foundation-company (KHÔNG hard-code role) · chọn ảnh
 * hợp lệ → uploadAsset ĐÚNG kind · file sai loại/quá lớn → báo lỗi + KHÔNG gọi API · đã có asset → hiện
 * <img> + Gỡ gọi removeAsset · logo và favicon ĐỘC LẬP (đổi logo không đụng favicon).
 *
 * Giữ web-core THẬT (useCan/useCompanyBranding/foundationKeys/validateBrandingFile) — chỉ stub `brandingApi`.
 * Mock hook gate sẽ làm test vô nghĩa (bài học: gate phải chạy thật thì mới chứng minh được ẩn/hiện đúng).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { BrandingSection } from "./BrandingSection";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    brandingApi: {
      getBranding: vi.fn(),
      uploadAsset: vi.fn(),
      removeAsset: vi.fn(),
    },
  };
});

import { brandingApi } from "@mediaos/web-core";
const mockGet = brandingApi.getBranding as ReturnType<typeof vi.fn>;
const mockUpload = brandingApi.uploadAsset as ReturnType<typeof vi.fn>;
const mockRemove = brandingApi.removeAsset as ReturnType<typeof vi.fn>;

/** Cặp quyền THẬT (mig 0435) — đúng chuỗi capabilities `/auth/me` trả. */
const CAN_UPDATE = { "update:foundation-company": true };
const VIEW_ONLY = { "view:foundation-company": true };

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ isAuthenticated: true, capabilities: caps });
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <BrandingSection />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const asset = (over: Record<string, unknown> = {}) => ({
  source: "file" as const,
  fileId: "11111111-1111-4111-8111-111111111111",
  url: "https://storage.local/logo.png",
  expiresAt: "2026-07-22T10:00:00.000Z",
  ...over,
});

const pngFile = () => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
const pdfFile = () => new File([new Uint8Array([1, 2, 3])], "x.pdf", { type: "application/pdf" });
/** 3MB > trần logo (2MB) nhưng đúng MIME ⇒ chỉ vi phạm size. */
const hugePng = () => new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" });

function fileInput(kind: "logo" | "favicon"): HTMLInputElement {
  return screen.getByTestId(`branding-input-${kind}`) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  setCaps(CAN_UPDATE);
  mockGet.mockResolvedValue({ logo: null, favicon: null });
  mockUpload.mockResolvedValue(asset());
  mockRemove.mockResolvedValue(undefined);
});

describe("BrandingSection — states", () => {
  it("chưa đặt gì → hiện trạng thái rỗng cho cả logo và favicon", async () => {
    renderSection();
    await waitFor(() => expect(screen.getAllByText(/Chưa đặt/i).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("lỗi tải → hiện thông điệp + nút thử lại (không trắng trang)", async () => {
    mockGet.mockRejectedValue(new Error("bùm"));
    renderSection();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Thử lại/i })).toBeInTheDocument();
  });

  it("đã có logo → render <img> với url server trả", async () => {
    mockGet.mockResolvedValue({ logo: asset(), favicon: null });
    renderSection();
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", "https://storage.local/logo.png");
  });
});

describe("BrandingSection — gate quyền (update:foundation-company)", () => {
  it("CHỈ có view → KHÔNG hiện nút tải lên/gỡ", async () => {
    setCaps(VIEW_ONLY);
    mockGet.mockResolvedValue({ logo: asset(), favicon: null });
    renderSection();
    await screen.findByRole("img");
    expect(screen.queryByRole("button", { name: /Tải lên|Đổi ảnh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gỡ/i })).not.toBeInTheDocument();
  });

  it("có update → hiện nút tải lên", async () => {
    renderSection();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Tải lên/i }).length).toBe(2));
  });
});

describe("BrandingSection — upload", () => {
  it("chọn PNG hợp lệ cho logo → gọi uploadAsset('logo', file)", async () => {
    renderSection();
    await screen.findByTestId("branding-input-logo");

    fireEvent.change(fileInput("logo"), { target: { files: [pngFile()] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload.mock.calls[0][0]).toBe("logo");
    expect((mockUpload.mock.calls[0][1] as File).name).toBe("logo.png");
  });

  it("chọn ảnh cho favicon → gọi ĐÚNG kind 'favicon' (2 ô độc lập)", async () => {
    renderSection();
    await screen.findByTestId("branding-input-logo");

    fireEvent.change(fileInput("favicon"), { target: { files: [pngFile()] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload.mock.calls[0][0]).toBe("favicon");
  });

  it("file sai định dạng → báo lỗi và KHÔNG gọi API (pre-check client)", async () => {
    renderSection();
    await screen.findByTestId("branding-input-logo");

    fireEvent.change(fileInput("logo"), { target: { files: [pdfFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("file vượt trần size → báo lỗi và KHÔNG gọi API", async () => {
    renderSection();
    await screen.findByTestId("branding-input-logo");

    fireEvent.change(fileInput("logo"), { target: { files: [hugePng()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("upload lỗi server → hiện thông điệp, KHÔNG nuốt lỗi", async () => {
    mockUpload.mockRejectedValue(new Error("413"));
    renderSection();
    await screen.findByTestId("branding-input-logo");

    fireEvent.change(fileInput("logo"), { target: { files: [pngFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("BrandingSection — remove", () => {
  it("bấm Gỡ ở logo → removeAsset('logo')", async () => {
    mockGet.mockResolvedValue({ logo: asset(), favicon: null });
    renderSection();
    const removeBtn = await screen.findByRole("button", { name: /Gỡ/i });

    fireEvent.click(removeBtn);

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("logo"));
  });

  it("chưa có asset → KHÔNG hiện nút Gỡ", async () => {
    renderSection();
    await screen.findByTestId("branding-input-logo");
    expect(screen.queryByRole("button", { name: /Gỡ/i })).not.toBeInTheDocument();
  });
});
