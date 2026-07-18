// @vitest-environment jsdom
/**
 * /me/profile/edit — sửa hồ sơ own-scope rồi GỬI DUYỆT.
 *
 * Phủ luồng người dùng mô tả: sửa ô → Gửi yêu cầu → thông báo "chờ HR/Quản trị viên duyệt" có nút OK →
 * OK điều hướng /me/profile/change-requests. Kèm 2 deny/guard path dễ hỏng âm thầm:
 * không-đổi-gì và xoá-trắng (cả hai KHÔNG được gọi API mà phải báo rõ).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, hrApi } from "@mediaos/web-core";
import type { HrMeProfile } from "@mediaos/contracts";
import { MyProfileEditPage } from "./MyProfileEditPage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

// Dirty-form guard kéo route state (không có RouterProvider trong unit test) → no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => undefined }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      getMyProfile: vi.fn(),
      createProfileChangeRequest: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "e@demo.local", fullName: "E", status: "Active", companyId: "co-1" },
  });
}

const PROFILE = {
  id: "emp-001",
  employeeCode: "EMP0001",
  fullName: "Nguyễn Văn A",
  email: "a@demo.local",
  phone: "0901234567",
  personalEmail: null,
  currentAddress: null,
  permanentAddress: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  gender: null,
  dateOfBirth: null,
  maritalStatus: null,
  identityNumber: null,
  identityIssueDate: null,
  identityIssuePlace: null,
} as unknown as HrMeProfile;

const ALLOWED = { "create:profile-change-request": true, "view-sensitive:employee": true };

async function renderLoaded(caps: Record<string, boolean> = ALLOWED) {
  setCapabilities(caps);
  vi.mocked(hrApi.getMyProfile).mockResolvedValue(PROFILE);
  renderWithQuery(<MyProfileEditPage />);
  await waitFor(() =>
    expect((document.querySelector("#edit-phone") as HTMLInputElement)?.value).toBe("0901234567"),
  );
}

describe("MyProfileEditPage", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  // ── DENY: thiếu cặp quyền tạo yêu cầu ──────────────────────────────────────
  it("thiếu create:profile-change-request → chặn, KHÔNG gọi API hồ sơ", async () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<MyProfileEditPage />);

    // EmptyState có cả title lẫn description chứa "không có quyền" → dùng getAllByText.
    expect((await screen.findAllByText(/không có quyền/i)).length).toBeGreaterThan(0);
    expect(document.querySelector("#edit-phone")).toBeNull();
    expect(hrApi.getMyProfile).not.toHaveBeenCalled();
  });

  // ── Chỉ mở ô cho field ĐƯỢC PHÉP đề nghị ───────────────────────────────────
  it("chỉ render ô cho field được phép, KHÔNG có ô mã NV/phòng ban/lương", async () => {
    await renderLoaded();

    expect(document.querySelector("#edit-phone")).not.toBeNull();
    expect(document.querySelector("#edit-identity_number")).not.toBeNull();
    // Ngoài PROFILE_CHANGE_ALLOWED_FIELDS — server sẽ chặn (HR-ERR-040), không được mời user gõ.
    expect(document.querySelector("#edit-employeeCode")).toBeNull();
    expect(document.querySelector("#edit-orgUnitId")).toBeNull();
    expect(document.querySelector("#edit-baseSalary")).toBeNull();
  });

  // ── LUỒNG CHÍNH: sửa → gửi → thông báo chờ duyệt → OK → điều hướng ─────────
  it("sửa 1 ô → gửi → hiện thông báo chờ duyệt → OK điều hướng danh sách yêu cầu", async () => {
    await renderLoaded();
    vi.mocked(hrApi.createProfileChangeRequest).mockResolvedValue({ id: "pcr-1" } as never);

    fireEvent.change(document.querySelector("#edit-phone")!, { target: { value: "0909999999" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi yêu cầu/i }));

    // Gửi ĐÚNG field đã đổi — không kèm field khác.
    await waitFor(() =>
      expect(hrApi.createProfileChangeRequest).toHaveBeenCalledWith({
        changedFields: ["phone"],
        newValues: { phone: "0909999999" },
        reason: undefined,
      }),
    );

    // Thông báo chờ HR/Quản trị viên duyệt.
    expect(await screen.findByText(/chờ hr hoặc quản trị viên duyệt/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/profile/change-requests" });
  });

  it("kèm lý do → lý do đi cùng DTO", async () => {
    await renderLoaded();
    vi.mocked(hrApi.createProfileChangeRequest).mockResolvedValue({ id: "pcr-2" } as never);

    fireEvent.change(document.querySelector("#edit-phone")!, { target: { value: "0908888888" } });
    fireEvent.change(document.querySelector("#reason")!, { target: { value: "Đổi số mới" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi yêu cầu/i }));

    await waitFor(() =>
      expect(hrApi.createProfileChangeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "Đổi số mới" }),
      ),
    );
  });

  // ── GUARD: không đổi gì → báo, KHÔNG gọi API (server sẽ trả 400 khó hiểu) ──
  it("không sửa gì mà bấm gửi → báo 'chưa thay đổi', KHÔNG gọi API", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /gửi yêu cầu/i }));

    expect(await screen.findByText(/chưa thay đổi thông tin nào/i)).toBeInTheDocument();
    expect(hrApi.createProfileChangeRequest).not.toHaveBeenCalled();
  });

  // ── GUARD: xoá trắng → báo rõ thay vì im lặng bỏ qua field đó ──────────────
  it("xoá trắng ô đang có giá trị → báo lỗi, KHÔNG gọi API", async () => {
    await renderLoaded();

    fireEvent.change(document.querySelector("#edit-phone")!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi yêu cầu/i }));

    expect(await screen.findByText(/không thể xoá trắng/i)).toBeInTheDocument();
    expect(hrApi.createProfileChangeRequest).not.toHaveBeenCalled();
  });

  // ── Masking: giá trị bị ẩn → nói rõ, tránh hiểu nhầm "hồ sơ trống" ─────────
  it("thiếu view-identity → nhóm Giấy tờ hiện cảnh báo giá trị đang bị ẩn", async () => {
    await renderLoaded({ "create:profile-change-request": true, "view-sensitive:employee": true });

    expect(screen.getAllByText(/đang bị ẩn do phân quyền/i).length).toBeGreaterThan(0);
  });

  // ── Lỗi submit phải hiện (không nuốt) ─────────────────────────────────────
  it("API lỗi → hiện thông báo lỗi, KHÔNG hiện màn chờ duyệt", async () => {
    await renderLoaded();
    vi.mocked(hrApi.createProfileChangeRequest).mockRejectedValue(new Error("boom"));

    fireEvent.change(document.querySelector("#edit-phone")!, { target: { value: "0907777777" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi yêu cầu/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/chờ hr hoặc quản trị viên duyệt/i)).not.toBeInTheDocument();
  });
});
