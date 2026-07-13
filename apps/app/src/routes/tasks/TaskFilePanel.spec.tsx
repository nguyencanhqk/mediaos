/**
 * TaskFilePanel.spec.tsx — S4-FE-TASK-4 (SPEC-06 §16.1/§9, TASK-SCREEN-007).
 *
 * Deny-path TRƯỚC (crown pattern): thiếu read:task → forbidden, KHÔNG gọi getTaskFiles. Upload/Delete đều
 * gate qua PermissionGate/useCan (nút ẩn khi thiếu quyền tương ứng) — mirror EmployeeFilesTab.spec.tsx.
 * Download gọi taskFileApi.downloadTaskFile (apiFetchBlob boundary) + triggerBlobDownload.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskFileApi } from "@mediaos/web-core";
import type { TaskFileDto } from "@mediaos/contracts";
import { TaskFilePanel } from "./TaskFilePanel";
import { triggerBlobDownload } from "./download-blob";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskFileApi: {
      getTaskFiles: vi.fn(),
      uploadTaskFile: vi.fn(),
      deleteTaskFile: vi.fn(),
      downloadTaskFile: vi.fn(),
    },
  };
});

vi.mock("./download-blob", () => ({ triggerBlobDownload: vi.fn() }));
const mockTriggerDownload = triggerBlobDownload as ReturnType<typeof vi.fn>;

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

const FILE_A: TaskFileDto = {
  linkId: "link-1",
  fileId: "file-1",
  originalName: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  scanStatus: "Clean",
  uploadStatus: "Uploaded",
  uploadedAt: "2026-07-01T00:00:00.000Z",
  category: "Spec",
};

describe("TaskFilePanel (gate = read/file-upload/file-delete:task)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(taskFileApi.getTaskFiles).mockResolvedValue([FILE_A]);
  });

  // ── DENY-PATH: thiếu read:task → forbidden, KHÔNG fetch ─────────────────────
  it("shows forbidden and does not fetch without read:task", () => {
    setCaps({});
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskFileApi.getTaskFiles).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: read:task → list hiển thị, KHÔNG có nút Tải lên/Xóa ──────────
  it("renders file list read-only with read:task only (no upload/delete)", async () => {
    setCaps({ "read:task": true });
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /tải lên/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^xóa$/i })).not.toBeInTheDocument();
  });

  // ── EMPTY state ───────────────────────────────────────────────────────────
  it("shows empty state when list is empty", async () => {
    setCaps({ "read:task": true });
    vi.mocked(taskFileApi.getTaskFiles).mockResolvedValue([]);
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText(/chưa có file nào/i)).toBeInTheDocument());
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state with retry when fetch fails", async () => {
    setCaps({ "read:task": true });
    vi.mocked(taskFileApi.getTaskFiles).mockRejectedValue(new Error("boom"));
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách file/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });

  // ── UPLOAD gate: nút hiện với file-upload:task, gọi taskFileApi.uploadTaskFile ──
  it("uploads a selected file when user has file-upload:task", async () => {
    setCaps({ "read:task": true, "file-upload:task": true });
    vi.mocked(taskFileApi.uploadTaskFile).mockResolvedValue({
      ...FILE_A,
      fileId: "file-2",
      originalName: "new.pdf",
    });
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());

    const uploadButton = screen.getByRole("button", { name: /tải lên/i });
    expect(uploadButton).toBeInTheDocument();

    const input = screen.getByTestId("task-file-upload-input") as HTMLInputElement;
    const file = new File(["hello"], "new.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(taskFileApi.uploadTaskFile).toHaveBeenCalledTimes(1));
    const [calledTaskId, calledFile] = vi.mocked(taskFileApi.uploadTaskFile).mock.calls[0];
    expect(calledTaskId).toBe("task-1");
    expect(calledFile).toBe(file);
  });

  it("hides Upload control without file-upload:task", async () => {
    setCaps({ "read:task": true });
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());
    expect(screen.queryByTestId("task-file-upload-input")).not.toBeInTheDocument();
  });

  // ── DELETE gate: confirm dialog → deleteTaskFile ─────────────────────────
  it("deletes a file after confirm when user has file-delete:task", async () => {
    setCaps({ "read:task": true, "file-delete:task": true });
    vi.mocked(taskFileApi.deleteTaskFile).mockResolvedValue(undefined);
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^xóa$/i }));
    expect(screen.getByText(/không thể hoàn tác/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-file-delete-confirm"));

    await waitFor(() =>
      expect(taskFileApi.deleteTaskFile).toHaveBeenCalledWith("task-1", "file-1"),
    );
  });

  it("hides delete action without file-delete:task", async () => {
    setCaps({ "read:task": true });
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^xóa$/i })).not.toBeInTheDocument();
  });

  // ── DOWNLOAD: read:task đủ để tải (cùng gate BE) — apiFetchBlob boundary + triggerBlobDownload ──
  it("downloads a file via taskFileApi.downloadTaskFile + triggerBlobDownload when user has read:task", async () => {
    setCaps({ "read:task": true });
    const blob = new Blob(["x"]);
    vi.mocked(taskFileApi.downloadTaskFile).mockResolvedValue({ blob, filename: "spec.pdf" });
    renderWithQuery(<TaskFilePanel taskId="task-1" />);
    await waitFor(() => expect(screen.getByText("spec.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /tải xuống/i }));

    await waitFor(() =>
      expect(taskFileApi.downloadTaskFile).toHaveBeenCalledWith("task-1", "file-1"),
    );
    await waitFor(() => expect(mockTriggerDownload).toHaveBeenCalledWith(blob, "spec.pdf"));
  });
});
