/**
 * S5-GOAL-FE-1 — GoalDetailPage (GOAL-SCREEN-002). Trọng tâm:
 *  (a) goal đã chốt kỳ → badge khóa + ghi chú + nút Sửa/Xóa DISABLED (§13.4/GOAL-ERR-005).
 *  (b) goal chưa chốt → Sửa/Xóa enabled.
 *  (c) chuyển tab "Công việc gắn" → query linked-tasks chạy (lazy theo tab active).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Inline TRONG factory (vi.mock hoisted lên đầu file — biến top-level chưa khởi tạo lúc chạy factory).
  ApiError: class ApiError extends Error {
    status = 0;
  },
  goalApi: {
    getGoal: vi.fn(),
    deleteGoal: vi.fn(),
    listLinkedTasks: vi.fn(),
    listUpdates: vi.fn(),
    listGoals: vi.fn(),
  },
  goalInvalidation: { remove: () => [["goals", "list"]] },
  goalKeys: {
    detail: (id: string) => ["goals", "detail", id],
    linkedTasks: (id: string) => ["goals", "linked-tasks", id],
    updates: (id: string, p?: unknown) => ["goals", "updates", id, p],
    list: (p?: unknown) => ["goals", "list", p],
  },
  hrApi: { listEmployees: vi.fn() },
  hrKeys: { employees: { list: (p?: unknown) => ["hr", "employees", "list", p] } },
}));

import { goalApi } from "@mediaos/web-core";
import { GoalDetailPage } from "./GoalDetailPage";

const mockGetGoal = goalApi.getGoal as ReturnType<typeof vi.fn>;
const mockListLinkedTasks = goalApi.listLinkedTasks as ReturnType<typeof vi.fn>;
const mockListUpdates = goalApi.listUpdates as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockListEmployees = (await import("@mediaos/web-core")).hrApi.listEmployees as ReturnType<
  typeof vi.fn
>;

const BASE_GOAL = {
  id: "g-1",
  companyId: "co-1",
  goalCode: "GOAL-0001",
  name: "Tăng doanh thu 20%",
  description: "Mục tiêu quý 1",
  level: "department",
  departmentId: "dept-1",
  projectId: null,
  employeeId: null,
  parentGoalId: null,
  ownerEmployeeId: "emp-1",
  periodType: "quarter",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  measureType: "percent",
  targetValue: 20,
  currentValue: 8,
  unit: "%",
  progressMode: "manual",
  progressPercent: 40,
  weight: 1,
  status: "Active",
  finalizedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  parent: null,
  childCount: 0,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalDetailPage goalId="g-1" onEdit={vi.fn()} onBack={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGoal.mockResolvedValue(BASE_GOAL);
  mockListLinkedTasks.mockResolvedValue([]);
  mockListUpdates.mockResolvedValue([]);
  mockListGoals.mockResolvedValue([]);
  mockListEmployees.mockResolvedValue({ items: [], meta: {} });
});

describe("GoalDetailPage — đã chốt kỳ (finalized)", () => {
  it("(a) badge khóa + ghi chú + Sửa/Xóa disabled", async () => {
    mockGetGoal.mockResolvedValue({ ...BASE_GOAL, finalizedAt: "2026-04-01T00:00:00.000Z" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getAllByText("Đã chốt kỳ").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Mục tiêu đã chốt kỳ — số liệu đóng băng, mọi thao tác ghi bị khóa."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sửa/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Xóa/ })).toBeDisabled();
  });
});

describe("GoalDetailPage — chưa chốt kỳ", () => {
  it("(b) Sửa/Xóa enabled + KHÔNG có ghi chú khóa", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Sửa/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Xóa/ })).toBeEnabled();
    expect(screen.queryByText(/số liệu đóng băng/)).not.toBeInTheDocument();
  });
});

describe("GoalDetailPage — tab lazy", () => {
  it("(c) chuyển tab 'Công việc gắn' → query linked-tasks chạy", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(mockListLinkedTasks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Công việc gắn" }));
    await waitFor(() => expect(mockListLinkedTasks).toHaveBeenCalledWith("g-1"));
  });
});
