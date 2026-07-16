// @vitest-environment jsdom
/**
 * MeAppearancePage tests (S5-ME-FE-3, ME-SCREEN-014). Phủ: forbidden · chọn theme gọi useTheme.setTheme
 * (áp local NGAY) + meApi.patchAppearance({theme}) (ghi server) · lỗi server KHÔNG revert theme local
 * (fail-soft tuyệt đối) · ngôn ngữ/múi giờ hiển thị READ-ONLY (không có input/control để sửa).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { MeAppearancePage } from "./MeAppearancePage";

const mockSetTheme = vi.fn();
vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    useTheme: () => ({
      theme: "system",
      resolvedTheme: "light",
      setTheme: mockSetTheme,
      toggleTheme: vi.fn(),
    }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: { getPreferences: vi.fn(), patchAppearance: vi.fn() },
  };
});

import { meApi } from "@mediaos/web-core";
const mockGetPreferences = meApi.getPreferences as ReturnType<typeof vi.fn>;
const mockPatchAppearance = meApi.patchAppearance as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeAppearancePage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  mockGetPreferences.mockResolvedValue({
    locale: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    theme: "system",
    dateFormat: null,
    timeFormat: null,
    defaultLanding: null,
    density: null,
    favoriteModules: null,
    meLayoutConfig: null,
    updatedAt: null,
  });
});

describe("MeAppearancePage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getPreferences", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetPreferences).not.toHaveBeenCalled();
  });
});

describe("MeAppearancePage — theme (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("render 3 lựa chọn theme + đọc locale/timezone read-only", async () => {
    renderPage();
    expect(screen.getByText("Theo hệ thống")).toBeInTheDocument();
    expect(screen.getByText("Sáng")).toBeInTheDocument();
    expect(screen.getByText("Tối")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Tiếng Việt")).toBeInTheDocument();
    });
    expect(screen.getByText("Asia/Ho_Chi_Minh")).toBeInTheDocument();
    // Read-only — KHÔNG có input/select để sửa locale/timezone.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("chọn 'Tối' → setTheme('dark') áp NGAY + patchAppearance({theme:'dark'}) ghi server", async () => {
    mockPatchAppearance.mockResolvedValue({
      locale: "vi",
      timezone: "Asia/Ho_Chi_Minh",
      theme: "dark",
      dateFormat: null,
      timeFormat: null,
      defaultLanding: null,
      density: null,
      favoriteModules: null,
      meLayoutConfig: null,
      updatedAt: null,
    });
    renderPage();
    fireEvent.click(screen.getByText("Tối"));

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    await waitFor(() => {
      expect(mockPatchAppearance).toHaveBeenCalled();
    });
    expect(mockPatchAppearance.mock.calls[0][0]).toEqual({ theme: "dark" });
  });

  it("patchAppearance lỗi server → setTheme local VẪN đã gọi trước đó (fail-soft, KHÔNG revert)", async () => {
    mockPatchAppearance.mockRejectedValue(new Error("network"));
    renderPage();
    fireEvent.click(screen.getByText("Sáng"));

    expect(mockSetTheme).toHaveBeenCalledWith("light");
    await waitFor(() => {
      expect(screen.getByText(/không lưu được trên máy chủ/i)).toBeInTheDocument();
    });
    // setTheme KHÔNG bị gọi lại để "revert" — chỉ 1 lần gọi duy nhất khi user chọn.
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
  });
});
