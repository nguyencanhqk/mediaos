import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskLabelsApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskLabelPickerDialog, TaskLabelStrip } from "./TaskLabelPicker";

/**
 * Gắn thẻ (labels) — UX kiểu Base. Điểm khoá:
 *   1. Gắn/gỡ đi ĐÚNG route /tasks/:id/labels/:labelId (gate update:task) — không đi PATCH.
 *   2. Tạo thẻ xong TỰ GẮN vào task (create → add) — một cú click cho thao tác lặp nhiều.
 *   3. Xoá thẻ 2 BƯỚC (✕ → "Xoá?") — xoá lan mọi task trong dự án, không cho lỡ tay.
 *   4. Thiếu pair nào control đó tự ẩn/khoá (UI-02 §5.3).
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskLabelsApi: {
      listLabels: vi.fn(),
      createLabel: vi.fn(),
      updateLabel: vi.fn(),
      deleteLabel: vi.fn(),
      addLabelToTask: vi.fn(),
      removeLabelFromTask: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

const MOCK_LABELS = [
  {
    id: "lb-1",
    companyId: "co-001",
    projectId: "proj-001",
    name: "Đã Cắt",
    color: "#eab308",
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "lb-2",
    companyId: "co-001",
    projectId: "proj-001",
    name: "Thiếu Thumbnail",
    color: "#ef4444",
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const TASK = {
  id: "task-001",
  projectId: "proj-001",
  title: "Việc thử",
  labels: [{ id: "lb-1", name: "Đã Cắt", color: "#eab308" }],
} as unknown as TaskCoreResponseDto;

describe("TaskLabelPickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.mocked(taskLabelsApi.listLabels).mockResolvedValue(MOCK_LABELS as never);
    vi.mocked(taskLabelsApi.addLabelToTask).mockResolvedValue(undefined as never);
    vi.mocked(taskLabelsApi.removeLabelFromTask).mockResolvedValue(undefined as never);
  });

  it("bấm thẻ CHƯA gắn → GẮN qua đúng route; thẻ ĐÃ gắn có aria-pressed", async () => {
    setCapabilities({ "read:label": true, "update:task": true });
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-toggle-lb-2")).toBeInTheDocument());

    expect(screen.getByTestId("label-toggle-lb-1")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("label-toggle-lb-2"));
    await waitFor(() =>
      expect(taskLabelsApi.addLabelToTask).toHaveBeenCalledWith("task-001", "lb-2"),
    );
    expect(taskLabelsApi.removeLabelFromTask).not.toHaveBeenCalled();
  });

  it("bấm thẻ ĐÃ gắn → GỠ", async () => {
    setCapabilities({ "read:label": true, "update:task": true });
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-toggle-lb-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("label-toggle-lb-1"));
    await waitFor(() =>
      expect(taskLabelsApi.removeLabelFromTask).toHaveBeenCalledWith("task-001", "lb-1"),
    );
  });

  it("Thêm thẻ: tạo xong TỰ GẮN vào task (create → add)", async () => {
    setCapabilities({ "read:label": true, "create:label": true, "update:task": true });
    vi.mocked(taskLabelsApi.createLabel).mockResolvedValue({
      ...MOCK_LABELS[0],
      id: "lb-new",
      name: "Ưu tiên",
    } as never);
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-create-open")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("label-create-open"));
    fireEvent.change(screen.getByTestId("label-create-name"), { target: { value: "Ưu tiên" } });
    fireEvent.click(screen.getByTestId("label-create-confirm"));

    await waitFor(() =>
      expect(taskLabelsApi.createLabel).toHaveBeenCalledWith("proj-001", {
        name: "Ưu tiên",
        color: "#eab308",
      }),
    );
    await waitFor(() =>
      expect(taskLabelsApi.addLabelToTask).toHaveBeenCalledWith("task-001", "lb-new"),
    );
  });

  it("xoá thẻ 2 BƯỚC: thùng rác → 'Xoá?' → bấm lần nữa mới gọi API", async () => {
    setCapabilities({ "read:label": true, "delete:label": true });
    vi.mocked(taskLabelsApi.deleteLabel).mockResolvedValue(undefined as never);
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-delete-lb-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("label-delete-lb-1"));
    expect(taskLabelsApi.deleteLabel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("label-delete-confirm-lb-1"));
    await waitFor(() => expect(taskLabelsApi.deleteLabel).toHaveBeenCalledWith("lb-1"));
  });

  it("thiếu update:task ⇒ dòng thẻ KHOÁ + hint; thiếu create:label ⇒ không có nút Thêm thẻ", async () => {
    setCapabilities({ "read:label": true });
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-toggle-lb-1")).toBeInTheDocument());

    expect(screen.getByTestId("label-toggle-lb-1")).toBeDisabled();
    expect(screen.getByText(/không có quyền gắn\/gỡ thẻ/i)).toBeInTheDocument();
    expect(screen.queryByTestId("label-create-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("label-edit-lb-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("label-delete-lb-1")).not.toBeInTheDocument();
  });

  it("sửa thẻ: đổi tên → PATCH /labels/:id", async () => {
    setCapabilities({ "read:label": true, "update:label": true });
    vi.mocked(taskLabelsApi.updateLabel).mockResolvedValue(MOCK_LABELS[0] as never);
    renderWithQuery(<TaskLabelPickerDialog task={TASK} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("label-edit-lb-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("label-edit-lb-1"));
    fireEvent.change(screen.getByLabelText("Nhập tên thẻ"), { target: { value: "Đã Dựng" } });
    fireEvent.click(screen.getByTestId("label-edit-save-lb-1"));

    await waitFor(() =>
      expect(taskLabelsApi.updateLabel).toHaveBeenCalledWith("lb-1", {
        name: "Đã Dựng",
        color: "#eab308",
      }),
    );
  });
});

describe("TaskLabelStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("hiện chip thẻ đã gắn; có update:task thì hiện nút Gắn thẻ mở dialog", async () => {
    setCapabilities({ "read:label": true, "update:task": true });
    vi.mocked(taskLabelsApi.listLabels).mockResolvedValue(MOCK_LABELS as never);
    renderWithQuery(<TaskLabelStrip task={TASK} />);

    expect(screen.getByTestId("task-label-chip-lb-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-label-open"));
    await waitFor(() => expect(screen.getByTestId("label-search")).toBeInTheDocument());
  });

  it("không thẻ + không quyền gắn ⇒ strip ẩn hẳn", () => {
    setCapabilities({});
    renderWithQuery(
      <TaskLabelStrip task={{ ...TASK, labels: [] } as unknown as TaskCoreResponseDto} />,
    );
    expect(screen.queryByTestId("task-label-strip")).not.toBeInTheDocument();
  });
});
