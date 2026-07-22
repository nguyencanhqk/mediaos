// @vitest-environment jsdom
/**
 * S5-BRAND-FE-2 — BrandLogo (logo công ty trên GlobalTopbar).
 *
 * Trọng tâm là FAIL-SOFT: vỏ app KHÔNG được vỡ/nhấp nháy vì branding. Phủ: chưa tải xong → wordmark
 * (KHÔNG spinner) · lỗi/401 → wordmark · chưa đặt logo → wordmark · có logo → <img> · ảnh 404 →
 * lật về wordmark · logo MỚI sau khi ảnh cũ hỏng vẫn được thử lại (chống kẹt cờ failed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationKeys } from "@mediaos/web-core";
import { BrandLogo } from "./BrandLogo";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, brandingApi: { getBranding: vi.fn() } };
});

import { brandingApi } from "@mediaos/web-core";
const mockGet = brandingApi.getBranding as ReturnType<typeof vi.fn>;

const WORDMARK = "FUNTIME MEDIA";
const logoAsset = (url: string) => ({
  source: "file" as const,
  fileId: "11111111-1111-4111-8111-111111111111",
  url,
  expiresAt: "2026-07-22T10:00:00.000Z",
});

function renderLogo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrandLogo />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: true, capabilities: {} });
});

describe("BrandLogo — fail-soft về wordmark", () => {
  it("đang tải → wordmark ngay, KHÔNG spinner (topbar không nhấp nháy)", () => {
    mockGet.mockReturnValue(new Promise(() => {})); // pending mãi
    renderLogo();
    expect(screen.getByText(WORDMARK)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("API lỗi (vd 401) → wordmark, không ném", async () => {
    mockGet.mockRejectedValue(new Error("401"));
    renderLogo();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByText(WORDMARK)).toBeInTheDocument();
  });

  it("công ty chưa đặt logo → wordmark", async () => {
    mockGet.mockResolvedValue({ logo: null, favicon: null });
    renderLogo();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByText(WORDMARK)).toBeInTheDocument();
  });
});

describe("BrandLogo — có logo", () => {
  it("render <img> với url server trả, không còn wordmark", async () => {
    mockGet.mockResolvedValue({ logo: logoAsset("https://storage.local/a.png"), favicon: null });
    renderLogo();

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", "https://storage.local/a.png");
    expect(screen.queryByText(WORDMARK)).not.toBeInTheDocument();
  });

  it("ảnh hỏng (404 / presigned hết hạn) → lật về wordmark, KHÔNG để icon ảnh vỡ", async () => {
    mockGet.mockResolvedValue({ logo: logoAsset("https://storage.local/dead.png"), favicon: null });
    renderLogo();

    const img = await screen.findByRole("img");
    fireEvent.error(img);

    await waitFor(() => expect(screen.getByText(WORDMARK)).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("logo MỚI sau khi ảnh cũ hỏng VẪN được thử lại (không kẹt cờ failed)", async () => {
    mockGet.mockResolvedValue({ logo: logoAsset("https://storage.local/dead.png"), favicon: null });
    // GIỮ NGUYÊN client + component instance: chỉ đổi DỮ LIỆU query. Rerender với client MỚI sẽ reset
    // cache về pending ⇒ test hoá ra chỉ chứng minh "mount lại thì hết lỗi", KHÔNG chứng minh state
    // failedUrl thoát kẹt — đúng thứ ta cần khoá ở đây.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BrandLogo />
      </QueryClientProvider>,
    );

    fireEvent.error(await screen.findByRole("img"));
    await waitFor(() => expect(screen.getByText(WORDMARK)).toBeInTheDocument());

    // Admin đổi ảnh / refetch cấp presigned tươi → URL khác URL đã hỏng ⇒ phải render lại <img>.
    act(() => {
      client.setQueryData(foundationKeys.company.branding(), {
        logo: logoAsset("https://storage.local/fresh.png"),
        favicon: null,
      });
    });

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", "https://storage.local/fresh.png");
  });
});
