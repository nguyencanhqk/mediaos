import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi } from "@mediaos/web-core";
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
  oldValues: null,
  newValues: null,
  message: null,
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

describe("TaskActivityTimeline", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: SENSITIVE (view:task-audit-log) — ẨN HẲN, không gọi API ──────
  it("renders nothing and does not call the API without view:task-audit-log", () => {
    setCapabilities({});
    const { container } = renderWithQuery(<TaskActivityTimeline taskId="task-001" />);
    expect(container).toBeEmptyDOMElement();
    expect(taskCollabApi.listActivity).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: wildcard grant KHÔNG đủ (sensitive PHẢI khớp cặp CHÍNH XÁC) ──
  it("stays hidden even with an unrelated wildcard grant (useCanExact, no fallback)", () => {
    setCapabilities({ "*:*": true });
    const { container } = renderWithQuery(<TaskActivityTimeline taskId="task-001" />);
    expect(container).toBeEmptyDOMElement();
  });

  // ── ALLOW-PATH: hr/company-admin thấy nhật ký hoạt động ─────────────────────
  it("renders activity log entries with view:task-audit-log", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([MOCK_LOG]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);

    await waitFor(() => expect(screen.getByText(/đã đổi trạng thái/i)).toBeInTheDocument());
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  // ── Empty state ──────────────────────────────────────────────────────────────
  it("shows empty state when there is no activity", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listActivity).mockResolvedValue([]);
    renderWithQuery(<TaskActivityTimeline taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có hoạt động/i)).toBeInTheDocument());
  });
});
