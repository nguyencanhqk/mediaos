/**
 * EmployeeFilesTab.spec.tsx — S2-FE-HR-9 (UI-HR-SCREEN-015).
 *
 * Deny-path TRƯỚC (crown pattern): thiếu file-view:employee → forbidden, KHÔNG gọi getEmployeeFiles.
 * Upload/Delete/Download đều gate qua PermissionGate/useCan (nút ẩn khi thiếu quyền tương ứng) — mirror
 * EmployeeContractsPage.spec.tsx (setCaps + mock @mediaos/web-core tại ranh giới module).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, employeeFilesApi, filesApi } from "@mediaos/web-core";
import type { EmployeeFileDto } from "@mediaos/contracts";
import { EmployeeFilesTab } from "./EmployeeFilesTab";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    employeeFilesApi: {
      getEmployeeFiles: vi.fn(),
      uploadEmployeeFile: vi.fn(),
      deleteEmployeeFile: vi.fn(),
    },
    filesApi: {
      getDownloadUrl: vi.fn(),
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

const FILE_A: EmployeeFileDto = {
  linkId: "link-1",
  fileId: "file-1",
  originalName: "cccd.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  scanStatus: "Clean",
  uploadStatus: "Uploaded",
  uploadedAt: "2026-07-01T00:00:00.000Z",
  category: "CCCD",
};

describe("EmployeeFilesTab (gate = file-view/file-upload/file-delete:employee)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(employeeFilesApi.getEmployeeFiles).mockResolvedValue([FILE_A]);
  });

  // ── DENY-PATH: thiếu file-view:employee → forbidden, KHÔNG fetch ────────────
  it("shows forbidden and does not fetch without file-view:employee", () => {
    setCaps({});
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(employeeFilesApi.getEmployeeFiles).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: file-view:employee → list hiển thị, KHÔNG có nút Upload/Xóa ──
  it("renders file list read-only with file-view:employee only (no upload/delete)", async () => {
    setCaps({ "file-view:employee": true });
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /tải lên/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^xóa$/i })).not.toBeInTheDocument();
  });

  // ── EMPTY state ───────────────────────────────────────────────────────────
  it("shows empty state when list is empty", async () => {
    setCaps({ "file-view:employee": true });
    vi.mocked(employeeFilesApi.getEmployeeFiles).mockResolvedValue([]);
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText(/chưa có file nào/i)).toBeInTheDocument());
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state with retry when fetch fails", async () => {
    setCaps({ "file-view:employee": true });
    vi.mocked(employeeFilesApi.getEmployeeFiles).mockRejectedValue(new Error("boom"));
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách file/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });

  // ── UPLOAD gate: nút hiện với file-upload:employee, gọi employeeFilesApi.uploadEmployeeFile ──
  it("uploads a selected file when user has file-upload:employee", async () => {
    setCaps({ "file-view:employee": true, "file-upload:employee": true });
    vi.mocked(employeeFilesApi.uploadEmployeeFile).mockResolvedValue({
      ...FILE_A,
      fileId: "file-2",
      originalName: "new.pdf",
    });
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());

    const uploadButton = screen.getByRole("button", { name: /tải lên/i });
    expect(uploadButton).toBeInTheDocument();

    const input = screen.getByTestId("employee-file-upload-input") as HTMLInputElement;
    const file = new File(["hello"], "new.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(employeeFilesApi.uploadEmployeeFile).toHaveBeenCalledTimes(1));
    const [calledEmployeeId, calledFile] = vi.mocked(employeeFilesApi.uploadEmployeeFile).mock
      .calls[0];
    expect(calledEmployeeId).toBe("emp-1");
    expect(calledFile).toBe(file);
  });

  it("hides Upload control without file-upload:employee", async () => {
    setCaps({ "file-view:employee": true });
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());
    expect(screen.queryByTestId("employee-file-upload-input")).not.toBeInTheDocument();
  });

  // ── DELETE gate: confirm dialog → deleteEmployeeFile ─────────────────────────
  it("deletes a file after confirm when user has file-delete:employee", async () => {
    setCaps({ "file-view:employee": true, "file-delete:employee": true });
    vi.mocked(employeeFilesApi.deleteEmployeeFile).mockResolvedValue(undefined);
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^xóa$/i }));
    expect(screen.getByText(/không thể hoàn tác/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("employee-file-delete-confirm"));

    await waitFor(() =>
      expect(employeeFilesApi.deleteEmployeeFile).toHaveBeenCalledWith("emp-1", "file-1"),
    );
  });

  it("hides delete action without file-delete:employee", async () => {
    setCaps({ "file-view:employee": true });
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^xóa$/i })).not.toBeInTheDocument();
  });

  // ── DOWNLOAD gate: download:foundation-file → filesApi.getDownloadUrl + window.open ──
  it("opens download URL when user has download:foundation-file", async () => {
    setCaps({ "file-view:employee": true, "download:foundation-file": true });
    vi.mocked(filesApi.getDownloadUrl).mockResolvedValue({
      url: "https://storage.local/signed",
      expiresAt: "2026-07-09T00:10:00.000Z",
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /tải xuống/i }));

    await waitFor(() => expect(filesApi.getDownloadUrl).toHaveBeenCalledWith("file-1"));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        "https://storage.local/signed",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    openSpy.mockRestore();
  });

  it("hides download action without download:foundation-file", async () => {
    setCaps({ "file-view:employee": true });
    renderWithQuery(<EmployeeFilesTab employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("cccd.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /tải xuống/i })).not.toBeInTheDocument();
  });
});
