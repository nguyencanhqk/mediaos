/**
 * HrEmployeeImportPage.spec.tsx — S5-HR-IMPORT-FE-1.
 *
 * Deny-path TRƯỚC (crown pattern): thiếu import:employee → forbidden, KHÔNG gọi API. Luồng chính:
 * chọn file (client validate đuôi/dung lượng) → "Xem trước" (dryRun) → bảng lỗi từng dòng → "Áp dụng"
 * (dryRun=false, DÙNG LẠI đúng file đã chọn) → màn kết quả (created/skipped) → "Về danh sách nhân viên".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, hrApi, ApiError } from "@mediaos/web-core";
import type { HrImportReport, HrImportResult } from "@mediaos/contracts";
import { HrEmployeeImportPage } from "./HrEmployeeImportPage";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      previewEmployeeImport: vi.fn(),
      applyEmployeeImport: vi.fn(),
      downloadImportTemplate: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const PREVIEW_REPORT: HrImportReport = {
  dryRun: true,
  fileName: "employees.csv",
  counts: { ok: 2, fail: 1 },
  errors: [{ row: 3, errors: ["Phòng ban 'Ma' không tồn tại hoặc không hoạt động"] }],
};

const APPLY_RESULT: HrImportResult = {
  dryRun: false,
  fileName: "employees.csv",
  counts: { ok: 2, fail: 1 },
  created: [
    { row: 1, employeeId: "11111111-1111-1111-1111-111111111111", employeeCode: "NV0001" },
    { row: 2, employeeId: "22222222-2222-2222-2222-222222222222", employeeCode: "NV0002" },
  ],
  skipped: [{ row: 3, errors: ["Phòng ban 'Ma' không tồn tại hoặc không hoạt động"] }],
  sessionAuditId: "33333333-3333-3333-3333-333333333333",
};

function csvFile(name = "employees.csv") {
  return new File(["a,b\n1,2\n"], name, { type: "text/csv" });
}

async function selectAndPreview(file = csvFile()) {
  const input = screen.getByTestId("hr-import-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByTestId("hr-import-preview-button"));
  await waitFor(() => expect(hrApi.previewEmployeeImport).toHaveBeenCalledTimes(1));
}

describe("HrEmployeeImportPage (gate = import:employee, sensitive mig 0496)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: thiếu import:employee → forbidden, KHÔNG gọi API ────────────
  it("shows forbidden and does not call preview/apply without import:employee", () => {
    setCaps({});
    renderWithQuery(<HrEmployeeImportPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrApi.previewEmployeeImport).not.toHaveBeenCalled();
    expect(hrApi.applyEmployeeImport).not.toHaveBeenCalled();
  });

  // ── Wildcard '*:*' KHÔNG mở cổng cặp nhạy cảm (mirror BE fail-closed) ──────
  it("stays forbidden with only wildcard '*:*' (sensitive pair, no wildcard fall-through)", () => {
    setCaps({ "*:*": true });
    renderWithQuery(<HrEmployeeImportPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
  });

  // ── Client-side validation: sai đuôi file → báo lỗi, KHÔNG gọi API ─────────
  it("rejects a non .xlsx/.csv file client-side before calling the API", () => {
    setCaps({ "import:employee": true });
    renderWithQuery(<HrEmployeeImportPage />);
    const input = screen.getByTestId("hr-import-file-input") as HTMLInputElement;
    const badFile = new File(["x"], "employees.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [badFile] } });
    expect(screen.getByText(/chỉ chấp nhận file \.xlsx hoặc \.csv/i)).toBeInTheDocument();
    expect(screen.getByTestId("hr-import-preview-button")).toBeDisabled();
    expect(hrApi.previewEmployeeImport).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: chọn file hợp lệ → "Xem trước" → bảng lỗi dryRun ───────────
  it("previews a valid file (dryRun) and renders the per-row error table", async () => {
    setCaps({ "import:employee": true });
    vi.mocked(hrApi.previewEmployeeImport).mockResolvedValue(PREVIEW_REPORT);
    renderWithQuery(<HrEmployeeImportPage />);

    await selectAndPreview();

    expect(vi.mocked(hrApi.previewEmployeeImport).mock.calls[0][0]).toBeInstanceOf(File);
    await waitFor(() => expect(screen.getByText(/hợp lệ: 2/i)).toBeInTheDocument());
    expect(screen.getByText(/lỗi: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/phòng ban 'ma' không tồn tại/i)).toBeInTheDocument();
  });

  // ── Preview error → hiển thị inline, KHÔNG đổi bước ────────────────────────
  it("shows an inline error and stays on the upload step when preview fails", async () => {
    setCaps({ "import:employee": true });
    vi.mocked(hrApi.previewEmployeeImport).mockRejectedValue(
      new ApiError(400, "HR-ERR-IMPORT-FILE-TYPE", "chỉ nhận .xlsx hoặc .csv"),
    );
    renderWithQuery(<HrEmployeeImportPage />);

    await selectAndPreview();

    await waitFor(() =>
      expect(screen.getByText(/chỉ nhận \.xlsx hoặc \.csv/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("hr-import-file-input")).toBeInTheDocument(); // vẫn ở bước 1
  });

  // ── ALLOW-PATH: "Áp dụng" dùng LẠI đúng file đã chọn → màn kết quả ─────────
  it("applies the SAME file after preview and renders created/skipped result", async () => {
    setCaps({ "import:employee": true });
    const file = csvFile();
    vi.mocked(hrApi.previewEmployeeImport).mockResolvedValue(PREVIEW_REPORT);
    vi.mocked(hrApi.applyEmployeeImport).mockResolvedValue(APPLY_RESULT);
    renderWithQuery(<HrEmployeeImportPage />);

    await selectAndPreview(file);
    await waitFor(() => expect(screen.getByText(/hợp lệ: 2/i)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("hr-import-apply-button"));

    await waitFor(() => expect(hrApi.applyEmployeeImport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(hrApi.applyEmployeeImport).mock.calls[0][0]).toBe(file);

    await waitFor(() => expect(screen.getByText("NV0001")).toBeInTheDocument());
    expect(screen.getByText("NV0002")).toBeInTheDocument();
    expect(screen.getByText(/phòng ban 'ma' không tồn tại/i)).toBeInTheDocument();
  });

  // ── "Về danh sách nhân viên" điều hướng về /hr/employees ───────────────────
  it("navigates back to the employee list from the result step", async () => {
    setCaps({ "import:employee": true });
    vi.mocked(hrApi.previewEmployeeImport).mockResolvedValue(PREVIEW_REPORT);
    vi.mocked(hrApi.applyEmployeeImport).mockResolvedValue(APPLY_RESULT);
    renderWithQuery(<HrEmployeeImportPage />);

    await selectAndPreview();
    await waitFor(() => expect(screen.getByText(/hợp lệ: 2/i)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("hr-import-apply-button"));
    await waitFor(() => expect(screen.getByTestId("hr-import-back-to-list")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("hr-import-back-to-list"));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/hr/employees" });
  });

  // ── "Chọn file khác" (back) reset về bước 1 ─────────────────────────────────
  it("resets to the upload step when going back from preview", async () => {
    setCaps({ "import:employee": true });
    vi.mocked(hrApi.previewEmployeeImport).mockResolvedValue(PREVIEW_REPORT);
    renderWithQuery(<HrEmployeeImportPage />);

    await selectAndPreview();
    await waitFor(() => expect(screen.getByText(/hợp lệ: 2/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/chọn file khác/i));
    expect(screen.getByTestId("hr-import-file-input")).toBeInTheDocument();
    expect(screen.queryByText(/hợp lệ: 2/i)).not.toBeInTheDocument();
  });
});
