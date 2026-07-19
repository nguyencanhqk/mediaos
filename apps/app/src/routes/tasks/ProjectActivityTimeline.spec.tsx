import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi } from "@mediaos/web-core";
import { ProjectActivityTimeline } from "./ProjectActivityTimeline";
import type { TaskActivityLogResponseDto } from "@mediaos/contracts";

// S5-TASK-WORKSPACE-1 — tab "Hoạt động" workspace dự án (GET /projects/:id/activity, TASK-API-601,
// view:task-audit-log SENSITIVE → useCanExact fail-closed).

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      listProjectActivity: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeLog(overrides: Partial<TaskActivityLogResponseDto>): TaskActivityLogResponseDto {
  return {
    id: "log-1",
    taskId: null,
    projectId: "proj-001",
    action: "PROJECT_CREATED",
    targetType: "Project",
    targetId: null,
    actorUserId: "u1",
    actorName: "Nguyễn Văn A",
    oldValues: null,
    newValues: null,
    message: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
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

describe("ProjectActivityTimeline", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  // ── DENY-PATH: thiếu cặp EXACT → forbidden, KHÔNG fetch (kể cả có wildcard) ──
  it("renders forbidden and never fetches without EXACT view:task-audit-log", () => {
    setCapabilities({ "*:*": true });
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    expect(screen.getByText(/không có quyền xem lịch sử hoạt động/i)).toBeInTheDocument();
    expect(taskCollabApi.listProjectActivity).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: render sự kiện project-level + task con (nhãn từ activity-labels) ──
  it("renders project-level and task-level events with actor + label", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listProjectActivity).mockResolvedValue([
      makeLog({ id: "log-1", action: "PROJECT_CREATED" }),
      makeLog({ id: "log-2", action: "TASK_CREATED", taskId: "task-1", targetType: "Task" }),
      makeLog({ id: "log-3", action: "UNKNOWN_ACTION_X" }),
    ]);
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText(/đã tạo dự án/i)).toBeInTheDocument());
    expect(screen.getByText(/đã tạo công việc/i)).toBeInTheDocument();
    // Action lạ → fallback in thẳng mã action, không vỡ UI.
    expect(screen.getByText(/UNKNOWN_ACTION_X/)).toBeInTheDocument();
    expect(taskCollabApi.listProjectActivity).toHaveBeenCalledWith("proj-001", {
      limit: 20,
      offset: 0,
    });
  });

  // ── message ưu tiên hơn nhãn action ──
  it("prefers server message over action label when present", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listProjectActivity).mockResolvedValue([
      makeLog({ message: 'đã tạo dự án "Website Revamp"' }),
    ]);
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    await waitFor(() =>
      expect(screen.getByText(/đã tạo dự án "Website Revamp"/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ──
  it("shows empty state when feed has no rows", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listProjectActivity).mockResolvedValue([]);
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    await waitFor(() =>
      expect(screen.getByText(/dự án chưa có hoạt động nào/i)).toBeInTheDocument(),
    );
  });

  // ── ERROR + retry ──
  it("shows error with retry on load failure", async () => {
    setCapabilities({ "view:task-audit-log": true });
    vi.mocked(taskCollabApi.listProjectActivity).mockRejectedValueOnce(new Error("network"));
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải lịch sử hoạt động/i)).toBeInTheDocument(),
    );
    vi.mocked(taskCollabApi.listProjectActivity).mockResolvedValueOnce([makeLog({})]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(screen.getByText(/đã tạo dự án/i)).toBeInTheDocument());
  });

  // ── Phân trang "trang kế" khi trả đủ PAGE_SIZE ──
  it("paginates with next page offset when a full page is returned", async () => {
    setCapabilities({ "view:task-audit-log": true });
    const fullPage = Array.from({ length: 20 }, (_, i) => makeLog({ id: `log-${i}` }));
    vi.mocked(taskCollabApi.listProjectActivity).mockResolvedValue(fullPage);
    renderWithQuery(<ProjectActivityTimeline projectId="proj-001" />);
    await waitFor(() => expect(screen.getAllByText(/đã tạo dự án/i).length).toBe(20));

    fireEvent.click(screen.getByRole("button", { name: /sau/i }));
    await waitFor(() =>
      expect(taskCollabApi.listProjectActivity).toHaveBeenCalledWith("proj-001", {
        limit: 20,
        offset: 20,
      }),
    );
  });
});
