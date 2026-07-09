// @vitest-environment jsdom
/**
 * ExportAttendanceButton — gate useCanExact('export','attendance') + tải CSV (S3-ATT-EXPORT-1).
 *
 * Cặp NHẠY CẢM (is_sensitive) → gate fail-closed exact-match. Deny-path (crown): (a) không cap → ẩn;
 * (b) CHỈ `*:*` wildcard → ẩn (chứng minh sensitive KHÔNG kế thừa wildcard, khớp BE fail-closed);
 * (c) có cap khác nhưng KHÔNG export:attendance → ẩn. Có cap exact → nút render. Có quyền → click gọi
 * exportCompanyRecords → triggerBlobDownload. Lỗi (vd 422 vượt cap) → hiện thông điệp người-đọc, KHÔNG
 * tải file.
 *
 * useCanExact/useAuthStore/mapApiErrorToUi = THẬT (KHÔNG mock hook gate, KHÔNG hand-inject cap giả):
 * cap được nạp qua store setState (đường thật /me → store) rồi để useCanExact đọc; chỉ mock
 * attendanceApi + download-blob (ranh giới I/O).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { useAuthStore, attendanceApi, ApiError } from "@mediaos/web-core";
import { triggerBlobDownload } from "./download-blob";
import { ExportAttendanceButton } from "./ExportAttendanceButton";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: { exportCompanyRecords: vi.fn() },
  };
});

vi.mock("./download-blob", () => ({ triggerBlobDownload: vi.fn() }));

const mockExport = attendanceApi.exportCompanyRecords as ReturnType<typeof vi.fn>;
const mockDownload = triggerBlobDownload as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderButton(query = { fromDate: "2026-07-01", toDate: "2026-08-01" }) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ExportAttendanceButton query={query} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
});

describe("ExportAttendanceButton", () => {
  // ── CROWN deny-path (fail-closed): cặp NHẠY CẢM cần cap EXACT ────────────────
  it("[crown deny] không có cap nào → nút KHÔNG render", () => {
    setCaps({}); // rỗng
    renderButton();
    expect(screen.queryByTestId("export-attendance-button")).not.toBeInTheDocument();
  });

  it("[crown deny] có cap khác nhưng KHÔNG export:attendance → nút KHÔNG render", () => {
    setCaps({ "view-company:attendance": true }); // xem company nhưng KHÔNG export
    renderButton();
    expect(screen.queryByTestId("export-attendance-button")).not.toBeInTheDocument();
  });

  // RED-first: với <PermissionGate>/useCan cũ (wildcard-aware) case này SẼ render (fail);
  // useCanExact fail-closed → ẩn. Chứng minh sensitive KHÔNG kế thừa `*:*`, khớp BE 403.
  it("[crown deny] CHỈ `*:*` wildcard → nút KHÔNG render (sensitive không kế thừa wildcard)", () => {
    setCaps({ "*:*": true });
    renderButton();
    expect(screen.queryByTestId("export-attendance-button")).not.toBeInTheDocument();
  });

  it("có cap EXACT export:attendance → nút render", () => {
    setCaps({ "export:attendance": true });
    renderButton();
    expect(screen.getByTestId("export-attendance-button")).toBeInTheDocument();
  });

  // ── Happy: click → export + download ───────────────────────────────────────
  it("click → gọi exportCompanyRecords(query) + triggerBlobDownload(blob, filename)", async () => {
    setCaps({ "export:attendance": true });
    const blob = new Blob(["a,b\n1,2\n"], { type: "text/csv" });
    mockExport.mockResolvedValue({ blob, filename: "cham-cong.csv" });

    renderButton({ fromDate: "2026-07-01", toDate: "2026-08-01" });
    fireEvent.click(screen.getByTestId("export-attendance-button"));

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockExport).toHaveBeenCalledWith({ fromDate: "2026-07-01", toDate: "2026-08-01" });
    expect(mockDownload).toHaveBeenCalledWith(blob, "cham-cong.csv");
  });

  it("server không gửi filename → dùng tên file mặc định", async () => {
    setCaps({ "export:attendance": true });
    const blob = new Blob(["x"], { type: "text/csv" });
    mockExport.mockResolvedValue({ blob, filename: null });

    renderButton();
    fireEvent.click(screen.getByTestId("export-attendance-button"));

    await waitFor(() => expect(mockDownload).toHaveBeenCalled());
    expect(mockDownload).toHaveBeenCalledWith(blob, "attendance-records.csv");
  });

  // ── [cap RED] 422 vượt cap → hiện lỗi, KHÔNG tải ───────────────────────────
  it("[cap] 422 vượt cap → hiện thông điệp người-đọc + KHÔNG triggerBlobDownload", async () => {
    setCaps({ "export:attendance": true });
    mockExport.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "ATT-ERR-EXPORT-TOO-LARGE",
        message: "Vui lòng thu hẹp khoảng ngày",
      }),
    );

    renderButton();
    fireEvent.click(screen.getByTestId("export-attendance-button"));

    await waitFor(() =>
      expect(screen.getByTestId("export-error")).toHaveTextContent("Vui lòng thu hẹp khoảng ngày"),
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });

  // ── Loading: đang xuất → nút disabled ──────────────────────────────────────
  it("đang xuất → nút disabled (chống double-submit)", async () => {
    setCaps({ "export:attendance": true });
    let resolveExport: (v: { blob: Blob; filename: string | null }) => void = () => {};
    mockExport.mockReturnValue(
      new Promise((r) => {
        resolveExport = r;
      }),
    );

    renderButton();
    const btn = screen.getByTestId("export-attendance-button");
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    resolveExport({ blob: new Blob(["x"]), filename: null });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
