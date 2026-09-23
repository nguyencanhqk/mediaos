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
    meApi: { getPreferences: vi.fn(), patchAppearance: vi.fn(), patchPreferences: vi.fn() },
  };
});

import { meApi } from "@mediaos/web-core";
const mockGetPreferences = meApi.getPreferences as ReturnType<typeof vi.fn>;
const mockPatchAppearance = meApi.patchAppearance as ReturnType<typeof vi.fn>;
const mockPatchPreferences = meApi.patchPreferences as ReturnType<typeof vi.fn>;

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
    showBirthday: null,
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

/**
 * S16-SOCIAL-FE-1 — cờ ẩn sinh nhật (SOC-DEC-007). Khối này sinh ra từ một lỗi THẬT mà FULL gate bắt
 * được ngày 23/09/2026: công tắc từng bị gác sau `useCan("view","feed")`, nên nhân viên KHÔNG có
 * `view:feed` vẫn bị widget liệt kê (vị từ ở `social-discovery.repository.ts:109-123` không hề xét
 * quyền của người BỊ LIỆT KÊ) mà không còn màn nào để tự ẩn. Ca đầu tiên dưới đây là lưới chống tái
 * phát — nó phải ĐỎ nếu ai đó gác lại khối này sau bất kỳ cặp `feed-*` nào.
 */
describe("MeAppearancePage — cờ ẩn sinh nhật (own-scope, KHÔNG sau cổng feed)", () => {
  it("🔴 chỉ có access:me, KHÔNG có view:feed → công tắc VẪN hiện (own-scope, không gác cặp feed)", async () => {
    setCaps({ "access:me": true });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("me-show-birthday-toggle")).toBeInTheDocument();
    });
  });

  it("showBirthday = null (chưa đụng vào) → ĐANG HIỆN, không phải đang tắt", async () => {
    setCaps({ "access:me": true });
    renderPage();
    // ⚠️ PHẢI chờ ô tick HẾT disabled, không chỉ chờ nó XUẤT HIỆN. Thẻ render NGAY với
    // `value = data?.showBirthday ?? null` (= null) trong lúc query còn đang chạy, nên
    // `findByTestId` trả về ở trạng thái ĐANG TẢI và ca này sẽ đo nhầm nhánh dự phòng.
    const toggle = await screen.findByTestId("me-show-birthday-toggle");
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    // `Boolean(null)` = false sẽ làm ca này đỏ — đó chính là điều nó canh.
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it("showBirthday = false → đang tắt", async () => {
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
      showBirthday: false,
      updatedAt: null,
    });
    setCaps({ "access:me": true });
    renderPage();
    const toggle = await screen.findByTestId("me-show-birthday-toggle");
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
  });

  it("bấm tắt → patchPreferences({showBirthday:false}); KHÔNG đi patchAppearance (đường .strict() trả 400)", async () => {
    mockPatchPreferences.mockResolvedValue({
      locale: "vi",
      timezone: "Asia/Ho_Chi_Minh",
      theme: "system",
      dateFormat: null,
      timeFormat: null,
      defaultLanding: null,
      density: null,
      favoriteModules: null,
      meLayoutConfig: null,
      showBirthday: false,
      updatedAt: null,
    });
    setCaps({ "access:me": true });
    renderPage();
    const toggle = await screen.findByTestId("me-show-birthday-toggle");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockPatchPreferences).toHaveBeenCalled();
    });
    expect(mockPatchPreferences.mock.calls[0][0]).toEqual({ showBirthday: false });
    expect(mockPatchAppearance).not.toHaveBeenCalled();
  });
});

/**
 * Hai ca dưới bịt lỗ "thành công RỖNG" trên một cờ QUYỀN RIÊNG TƯ: ô tick là controlled theo dữ liệu
 * server, nên cả khi ĐỌC hỏng lẫn khi GHI hỏng, nó tự vẽ về một trạng thái trông hoàn toàn bình
 * thường. Không có hai ca này thì người dùng tin rằng đã ẩn ngày sinh khỏi widget toàn công ty.
 */
describe("MeAppearancePage — cờ ẩn sinh nhật: hai nhánh hỏng phải NÓI RA", () => {
  it("GET /me/preferences lỗi → công tắc bị khoá + nói rõ CHƯA ĐỌC ĐƯỢC (không vẽ 'đang hiện')", async () => {
    mockGetPreferences.mockRejectedValue(new Error("network"));
    setCaps({ "access:me": true });
    renderPage();

    const toggle = await screen.findByTestId("me-show-birthday-toggle");
    await waitFor(() => {
      expect(screen.getByText(/chưa đọc được thiết lập này/i)).toBeInTheDocument();
    });
    // Khoá lại: cho bấm trong khi không biết trạng thái thật = mời người dùng ghi đè mù.
    expect((toggle as HTMLInputElement).disabled).toBe(true);
  });

  it("PATCH lỗi → hiện lỗi; ô tick nhảy về trạng thái cũ nhưng KHÔNG im lặng", async () => {
    mockPatchPreferences.mockRejectedValue(new Error("boom"));
    setCaps({ "access:me": true });
    renderPage();

    const toggle = await screen.findByTestId("me-show-birthday-toggle");
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText(/không lưu được thiết lập/i)).toBeInTheDocument();
    });
    // Vẫn đang HIỆN — đúng sự thật phía server, và người dùng được báo là chưa lưu được.
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });
});
