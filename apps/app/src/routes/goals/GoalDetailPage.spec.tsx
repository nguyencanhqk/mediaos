/**
 * S5-GOAL-FE-1 + S5-GOAL-FE-2 — GoalDetailPage (GOAL-SCREEN-002/005). Trọng tâm:
 *  (a) goal đã chốt kỳ → badge khóa + ghi chú + nút Sửa/Xóa DISABLED (§13.4/GOAL-ERR-005).
 *  (b) goal chưa chốt → Sửa/Xóa enabled.
 *  (c) chuyển tab "Công việc gắn" → query linked-tasks chạy (lazy theo tab active).
 *  (d) FE-2 deny-path: Check-in/Chốt kỳ ẩn khi thiếu cặp ('checkin','goal') / ('finalize','goal').
 *  (e) FE-2: đã chốt kỳ ⇒ Check-in DISABLED + nút đổi thành "Mở lại" (cùng cặp finalize).
 *  (f) FE-2: bấm "Chốt kỳ" chỉ MỞ hộp thoại — mutation chỉ chạy khi bấm xác nhận trong hộp thoại.
 *  (g) FE-2 two-gate: "Gắn thêm việc"/"Tháo" ẩn khi thiếu update:goal HOẶC update:task.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Tập cặp quyền BỊ THU HỒI cho từng test (mặc định rỗng = có đủ quyền). `vi.hoisted` vì factory
// vi.mock chạy TRƯỚC mọi khởi tạo top-level.
const perm = vi.hoisted(() => ({ denied: new Set<string>() }));

vi.mock("@mediaos/web-core", () => {
  const can = (action: string, resourceType: string) =>
    !perm.denied.has(`${action}:${resourceType}`);
  return {
    useCan: (action: string, resourceType: string) => can(action, resourceType),
    // PermissionGate THẬT ẩn children khi thiếu quyền — mock phải giữ đúng ngữ nghĩa đó, nếu không
    // mọi test deny-path đều xanh giả.
    PermissionGate: ({
      action,
      resourceType,
      children,
    }: {
      action: string;
      resourceType: string;
      children: React.ReactNode;
    }) => (can(action, resourceType) ? <>{children}</> : null),
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
      checkIn: vi.fn(),
      finalize: vi.fn(),
      reopen: vi.fn(),
      linkTasks: vi.fn(),
      unlinkTask: vi.fn(),
    },
    goalInvalidation: {
      remove: () => [["goals", "list"]],
      checkin: () => [["goals", "list"]],
      finalize: () => [["goals", "list"]],
      linkTasks: () => [["goals", "list"]],
    },
    goalKeys: {
      detail: (id: string) => ["goals", "detail", id],
      linkedTasks: (id: string) => ["goals", "linked-tasks", id],
      updates: (id: string, p?: unknown) => ["goals", "updates", id, p],
      updatesOf: (id: string) => ["goals", "updates", id],
      list: (p?: unknown) => ["goals", "list", p],
    },
    hrApi: { listEmployees: vi.fn() },
    hrKeys: { employees: { list: (p?: unknown) => ["hr", "employees", "list", p] } },
    taskCoreApi: { listTasks: vi.fn() },
    taskProjectApi: { listProjects: vi.fn() },
    taskKeys: {
      detail: (id: string) => ["tasks", "detail", id],
      kanban: (id: string) => ["tasks", "kanban", id],
      list: (p?: unknown) => ["tasks", "list", p],
      projects: { list: (p?: unknown) => ["tasks", "projects", "list", p] },
    },
  };
});

import { goalApi } from "@mediaos/web-core";
import { GoalDetailPage } from "./GoalDetailPage";

const mockGetGoal = goalApi.getGoal as ReturnType<typeof vi.fn>;
const mockListLinkedTasks = goalApi.listLinkedTasks as ReturnType<typeof vi.fn>;
const mockListUpdates = goalApi.listUpdates as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockFinalize = goalApi.finalize as ReturnType<typeof vi.fn>;
const mockUnlink = goalApi.unlinkTask as ReturnType<typeof vi.fn>;
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

const LINKED_TASK = {
  id: "t-1",
  companyId: "co-1",
  taskCode: "TASK-0001",
  title: "Chuẩn bị tài liệu",
  status: "Todo",
  priority: "Medium",
  projectId: "p-1",
  projectName: "Dự án A",
  mainAssigneeEmployeeId: "emp-1",
  assigneeName: "Nguyễn Văn A",
  dueAt: null,
  isOverdue: false,
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
  perm.denied.clear();
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

// ── S5-GOAL-FE-2 ───────────────────────────────────────────────────────────────
describe("GoalDetailPage — vòng đo (FE-2) deny-path quyền", () => {
  it("(d1) thiếu ('checkin','goal') → nút Check-in KHÔNG render", async () => {
    perm.denied.add("checkin:goal");
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.queryByTestId("goal-checkin-open")).not.toBeInTheDocument();
    // finalize vẫn còn (hai cặp ĐỘC LẬP)
    expect(screen.getByTestId("goal-finalize-open")).toBeInTheDocument();
  });

  it("(d2) thiếu ('finalize','goal') → nút Chốt kỳ/Mở lại KHÔNG render", async () => {
    perm.denied.add("finalize:goal");
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.queryByTestId("goal-finalize-open")).not.toBeInTheDocument();
    expect(screen.getByTestId("goal-checkin-open")).toBeInTheDocument();
  });
});

describe("GoalDetailPage — vòng đo (FE-2) trạng thái khóa", () => {
  it("(e1) đã chốt kỳ ⇒ Check-in DISABLED dù có quyền; nút finalize đổi thành 'Mở lại'", async () => {
    mockGetGoal.mockResolvedValue({ ...BASE_GOAL, finalizedAt: "2026-04-01T00:00:00.000Z" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getByTestId("goal-checkin-open")).toBeDisabled();
    expect(screen.getByTestId("goal-finalize-open")).toHaveTextContent("Mở lại");
    expect(screen.getByTestId("goal-finalize-open")).toBeEnabled();
  });

  it("(e2) status ≠ Active ⇒ Check-in DISABLED (GOAL-ERR-006 chặn ở client trước khi chạm API)", async () => {
    mockGetGoal.mockResolvedValue({ ...BASE_GOAL, status: "Draft" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.getByTestId("goal-checkin-open")).toBeDisabled();
  });
});

describe("GoalDetailPage — chốt kỳ cần xác nhận", () => {
  it("(f) bấm 'Chốt kỳ' chỉ mở hộp thoại nêu hệ quả đóng băng; API chỉ gọi khi xác nhận", async () => {
    mockFinalize.mockResolvedValue({ ...BASE_GOAL, finalizedAt: "2026-04-01T00:00:00.000Z" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("goal-finalize-open"));
    expect(screen.getByText(/đóng băng/i)).toBeInTheDocument();
    expect(mockFinalize).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("goal-finalize-submit"));
    await waitFor(() => expect(mockFinalize).toHaveBeenCalledWith("g-1", expect.any(Object)));
  });
});

describe("GoalDetailPage — tab Công việc: two-gate gắn/tháo", () => {
  beforeEach(() => {
    mockListLinkedTasks.mockResolvedValue([LINKED_TASK]);
  });

  it("(g1) đủ update:goal + update:task → hiện 'Gắn thêm việc' và nút Tháo từng dòng", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Công việc gắn" }));
    await waitFor(() => expect(screen.getByText("Chuẩn bị tài liệu")).toBeInTheDocument());
    expect(screen.getByTestId("goal-link-tasks-open")).toBeInTheDocument();
    expect(screen.getByTestId("goal-unlink-task-t-1")).toBeInTheDocument();
  });

  it("(g2) thiếu update:task → ẨN cả 'Gắn thêm việc' lẫn 'Tháo' (two-gate BE)", async () => {
    perm.denied.add("update:task");
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Công việc gắn" }));
    await waitFor(() => expect(screen.getByText("Chuẩn bị tài liệu")).toBeInTheDocument());
    expect(screen.queryByTestId("goal-link-tasks-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-unlink-task-t-1")).not.toBeInTheDocument();
  });

  it("(g3) thiếu update:goal → ẨN cả hai", async () => {
    perm.denied.add("update:goal");
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Công việc gắn" }));
    await waitFor(() => expect(screen.getByText("Chuẩn bị tài liệu")).toBeInTheDocument());
    expect(screen.queryByTestId("goal-link-tasks-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-unlink-task-t-1")).not.toBeInTheDocument();
  });

  it("(g4) goal đã chốt kỳ → mọi control ghi DISABLED (không cho tháo việc của kỳ đã đóng)", async () => {
    mockGetGoal.mockResolvedValue({ ...BASE_GOAL, finalizedAt: "2026-04-01T00:00:00.000Z" });
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Công việc gắn" }));
    await waitFor(() => expect(screen.getByText("Chuẩn bị tài liệu")).toBeInTheDocument());
    expect(screen.getByTestId("goal-link-tasks-open")).toBeDisabled();
    expect(screen.getByTestId("goal-unlink-task-t-1")).toBeDisabled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

describe("GoalDetailPage — lịch sử check-in phân trang", () => {
  it("(h) trang đầu KHÔNG cho 'Trước'; bấm 'Sau' gọi lại API với offset kế tiếp", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `u-${i}`,
      goalId: "g-1",
      updateType: "checkin",
      actorUserId: "user-1",
      oldCurrentValue: null,
      newCurrentValue: null,
      oldProgressPercent: 10,
      newProgressPercent: 20,
      confidence: 70,
      note: `Ghi chú ${i}`,
      createdAt: "2026-02-01T00:00:00.000Z",
    }));
    mockListUpdates.mockResolvedValue(rows);
    renderPage();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Lịch sử check-in" }));
    await waitFor(() =>
      expect(mockListUpdates).toHaveBeenCalledWith("g-1", { limit: 20, offset: 0 }),
    );
    const pager = await screen.findByTestId("goal-checkins-pager");
    expect(within(pager).getByTestId("goal-checkins-prev")).toBeDisabled();
    fireEvent.click(within(pager).getByTestId("goal-checkins-next"));
    await waitFor(() =>
      expect(mockListUpdates).toHaveBeenCalledWith("g-1", { limit: 20, offset: 20 }),
    );
  });
});
