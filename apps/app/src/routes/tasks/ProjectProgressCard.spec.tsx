/**
 * ProjectProgressCard.spec.tsx — S4-FE-TASK-4 (SPEC-06 §16.1, GET /projects/:id/report).
 *
 * Deny-path TRƯỚC (crown pattern, cặp SENSITIVE): thiếu view-report:project (useCanExact fail-closed) →
 * component KHÔNG render gì, KHÔNG gọi taskProjectApi.getReport — kể cả khi user có wildcard `*:*`
 * (mirror ExportEmployeesButton.spec.tsx).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskProjectApi } from "@mediaos/web-core";
import type { ProjectReportDto } from "@mediaos/contracts";
import { ProjectProgressCard } from "./ProjectProgressCard";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      getReport: vi.fn(),
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

const REPORT: ProjectReportDto = {
  projectId: "proj-1",
  countsByStatus: {
    Todo: 2,
    "In Progress": 3,
    "In Review": 1,
    Done: 5,
    Cancelled: 0,
  },
  overdueCount: 4,
  assigneeWorkload: [
    { employeeId: "emp-1", employeeName: "Nguyễn Văn A", activeCount: 3 },
    { employeeId: "emp-2", employeeName: "Trần Thị B", activeCount: 2 },
  ],
};

describe("ProjectProgressCard (gate = view-report:project SENSITIVE, useCanExact)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(taskProjectApi.getReport).mockResolvedValue(REPORT);
  });

  // ── DENY-PATH: không có cap → KHÔNG render, KHÔNG fetch ─────────────────────
  it("renders nothing and does not fetch without view-report:project", () => {
    setCaps({});
    const { container } = renderWithQuery(<ProjectProgressCard projectId="proj-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(taskProjectApi.getReport).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: wildcard `*:*` KHÔNG mở cổng cặp sensitive (fail-closed, useCanExact) ──
  it("renders nothing with wildcard *:* capability (exact-match fail-closed)", () => {
    setCaps({ "*:*": true });
    renderWithQuery(<ProjectProgressCard projectId="proj-1" />);
    expect(taskProjectApi.getReport).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: view-report:project → hiển thị report ────────────────────────
  it("renders counts by status + overdue + assignee workload with view-report:project", async () => {
    setCaps({ "view-report:project": true });
    renderWithQuery(<ProjectProgressCard projectId="proj-1" />);
    await waitFor(() => expect(taskProjectApi.getReport).toHaveBeenCalledWith("proj-1"));
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("Trần Thị B")).toBeInTheDocument();
    expect(screen.getByText(/4 quá hạn/i)).toBeInTheDocument();
  });

  // ── EMPTY state: project chưa có task nào ────────────────────────────────────
  it("shows empty state when project has no tasks", async () => {
    setCaps({ "view-report:project": true });
    vi.mocked(taskProjectApi.getReport).mockResolvedValue({
      projectId: "proj-1",
      countsByStatus: { Todo: 0, "In Progress": 0, "In Review": 0, Done: 0, Cancelled: 0 },
      overdueCount: 0,
      assigneeWorkload: [],
    });
    renderWithQuery(<ProjectProgressCard projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state with retry when fetch fails", async () => {
    setCaps({ "view-report:project": true });
    vi.mocked(taskProjectApi.getReport).mockRejectedValue(new Error("boom"));
    renderWithQuery(<ProjectProgressCard projectId="proj-1" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải báo cáo dự án/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });
});
