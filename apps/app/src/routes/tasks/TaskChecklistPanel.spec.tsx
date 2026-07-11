import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi } from "@mediaos/web-core";
import { TaskChecklistPanel } from "./TaskChecklistPanel";
import type { TaskChecklistResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      listChecklists: vi.fn(),
      createChecklist: vi.fn(),
      updateChecklist: vi.fn(),
      deleteChecklist: vi.fn(),
      addChecklistItem: vi.fn(),
      updateChecklistItem: vi.fn(),
      deleteChecklistItem: vi.fn(),
    },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_CHECKLIST: TaskChecklistResponseDto = {
  id: "cl-001",
  taskId: "task-001",
  title: "Chuẩn bị",
  description: null,
  isRequiredForDone: false,
  orderIndex: 0,
  items: [
    {
      id: "item-001",
      checklistId: "cl-001",
      title: "Soạn tài liệu",
      isDone: false,
      doneBy: null,
      doneAt: null,
      orderIndex: 0,
    },
  ],
  createdAt: "2026-07-01T00:00:00.000Z",
};

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

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

describe("TaskChecklistPanel", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([MOCK_CHECKLIST]);
  });

  // ── DENY-PATH: read-only khi thiếu update:task (mirror TASK_DEFERRED_GRANTS) ──
  it("renders read-only (no add/tick/delete controls) without update:task", async () => {
    setCapabilities({});
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());

    expect(screen.queryByText(/thêm checklist/i)).not.toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Soạn tài liệu" });
    expect(checkbox).toBeDisabled();
  });

  // ── ALLOW-PATH: tick item gọi API ────────────────────────────────────────────
  it("ticks an item and calls updateChecklistItem with update:task", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.updateChecklistItem).mockResolvedValue({
      ...MOCK_CHECKLIST.items[0],
      isDone: true,
    });
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());

    const checkbox = screen.getByRole("checkbox", { name: "Soạn tài liệu" });
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(taskCollabApi.updateChecklistItem).toHaveBeenCalledWith(
        "task-001",
        "cl-001",
        "item-001",
        { isDone: true },
      ),
    );
  });

  // ── Progress hiển thị đúng số lượng hoàn thành ──────────────────────────────
  it("shows checklist progress summary", async () => {
    setCapabilities({});
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());
    expect(screen.getByText(/0\/1/)).toBeInTheDocument();
  });

  // ── Xóa checklist yêu cầu dialog xác nhận ───────────────────────────────────
  it("requires confirm dialog before deleting a checklist group", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.deleteChecklist).mockResolvedValue(undefined);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /xóa checklist/i }));
    expect(screen.getByText(/checklist "chuẩn bị" và các hạng mục/i)).toBeInTheDocument();
    expect(taskCollabApi.deleteChecklist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /xác nhận xóa/i }));
    await waitFor(() =>
      expect(taskCollabApi.deleteChecklist).toHaveBeenCalledWith("task-001", "cl-001"),
    );
  });

  // ── Empty state ──────────────────────────────────────────────────────────────
  it("shows empty state when there are no checklists", async () => {
    setCapabilities({});
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có checklist/i)).toBeInTheDocument());
  });
});
