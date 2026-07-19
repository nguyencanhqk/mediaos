import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { TaskActivityTimeline } from "./TaskActivityTimeline";
import type { TaskActivityLogResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      listActivity: vi.fn(),
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

const MOCK_LOG: TaskActivityLogResponseDto = {
  id: "log-001",
  taskId: "task-001",
  projectId: null,
  action: "TASK_STATUS_CHANGED",
  targetType: "Task",
  targetId: "task-001",
  actorUserId: "u1",
  actorName: "Test User",
  oldValues: { status: "Todo" },
  newValues: { status: "In Progress" },
  message: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

function setUser() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: {},
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

// S5-TASK-DETAIL-1 (D-29): timeline KHÔNG còn gate client theo pair sensitive — server quyết
// (involvement HOẶC pair audit). Client luôn thử tải; 403 → ẩn hẳn card.
describe("TaskActivityTimeline", () => {
  beforeEach(() => {
    setUser();
    vi.clearAllMocks();
  });

  it("fetches without any client-side capability gate and renders entries (server-decides)", async () => {
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([MOCK_LOG]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() => expect(screen.getByText(/đã đổi trạng thái/i)).toBeInTheDocument());
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(taskCollabApi.listActivity).toHaveBeenCalled();
  });

  // ── GAP 1 (SPEC-06 §13.12): dòng "cũ → mới" — status dịch qua i18n enum ─────
  it("renders the old→new change line for a status change", async () => {
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([MOCK_LOG]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() => expect(screen.getByText("Cần làm")).toBeInTheDocument());
    expect(screen.getByText("Đang làm")).toBeInTheDocument();
  });

  it("renders stored state names (name-at-that-time) for a column move", async () => {
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([
      {
        ...MOCK_LOG,
        id: "log-002",
        action: "TASK_STATE_CHANGED",
        oldValues: { stateId: "s1", stateName: "Kịch bản" },
        newValues: { stateId: "s2", stateName: "Duyệt Video" },
      },
    ]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() => expect(screen.getByText("Kịch bản")).toBeInTheDocument());
    expect(screen.getByText("Duyệt Video")).toBeInTheDocument();
  });

  // ── DENY-PATH: server 403 (không liên quan + không pair audit) → ẨN HẲN ─────
  it("renders nothing when the server responds 403", async () => {
    vi.mocked(taskCollabApi.listActivity).mockRejectedValue(
      new ApiError(403, "TASK-ERR-042", "not involved"),
    );
    const { container } = renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() => expect(taskCollabApi.listActivity).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  // ── Lỗi KHÁC 403 → vẫn hiện card + error/retry (không nuốt lỗi) ─────────────
  it("shows the error state (not hidden) on a non-403 failure", async () => {
    vi.mocked(taskCollabApi.listActivity).mockRejectedValue(new ApiError(500, "SERVER", "boom"));
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() =>
      expect(screen.getByText(/không thể tải lịch sử hoạt động/i)).toBeInTheDocument(),
    );
  });

  // ── Empty state ──────────────────────────────────────────────────────────────
  it("shows empty state when there is no activity", async () => {
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có hoạt động/i)).toBeInTheDocument());
  });
});
