/**
 * S5-GOAL-FE-1 — GoalFormPage (GOAL-SCREEN-003). Trọng tâm:
 *  (a) chọn level=department → field neo "Phòng ban" (select) hiện.
 *  (b) chọn level=project → field neo "Dự án" hiện.
 *  (c) chọn level=employee → EmployeePicker (#251) hiện.
 *  (d) submit khi thiếu tên/cấp → lỗi validate (RHF+Zod, GOAL-ERR-001).
 */
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
  // Inline TRONG factory (vi.mock hoisted — biến top-level chưa khởi tạo lúc chạy factory).
  ApiError: class ApiError extends Error {
    status = 0;
  },
  goalApi: {
    getGoal: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    listGoals: vi.fn(),
  },
  goalInvalidation: { create: () => [["goals", "list"]], update: () => [["goals", "list"]] },
  goalKeys: {
    detail: (id: string) => ["goals", "detail", id],
    list: (p?: unknown) => ["goals", "list", p],
  },
  hrApi: { listDepartments: vi.fn(), listEmployees: vi.fn() },
  hrKeys: {
    departments: { list: (p?: unknown) => ["hr", "departments", "list", p] },
    employees: { list: (p?: unknown) => ["hr", "employees", "list", p] },
  },
  taskProjectApi: { listProjects: vi.fn() },
  taskKeys: { projects: { list: (p?: unknown) => ["tasks", "projects", "list", p] } },
}));

vi.mock("@/routes/tasks/EmployeePicker", () => ({
  EmployeePicker: ({ testId }: { testId: string }) => <div data-testid={testId}>picker</div>,
}));

import { goalApi, hrApi, taskProjectApi } from "@mediaos/web-core";
import { GoalFormPage } from "./GoalFormPage";

const mockCreateGoal = goalApi.createGoal as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;
const mockListProjects = taskProjectApi.listProjects as ReturnType<typeof vi.fn>;

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalFormPage onSuccess={vi.fn()} onCancel={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function levelSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: /Cấp mục tiêu/ }) as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateGoal.mockResolvedValue({ id: "g-new" });
  mockListGoals.mockResolvedValue([]);
  mockListDepartments.mockResolvedValue([{ id: "dept-1", name: "Kỹ thuật" }]);
  mockListEmployees.mockResolvedValue({ items: [], meta: {} });
  mockListProjects.mockResolvedValue([{ id: "prj-1", name: "Dự án A" }]);
});

describe("GoalFormPage — chọn cấp → field neo tương ứng (GOAL-SCREEN-003)", () => {
  it("(a) level=department → field 'Phòng ban' hiện", async () => {
    renderForm();
    fireEvent.change(levelSelect(), { target: { value: "department" } });
    await waitFor(() => expect(screen.getByText("Chọn phòng ban")).toBeInTheDocument());
    // KHÔNG hiện field dự án / picker nhân viên.
    expect(screen.queryByText("Chọn dự án")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-employee-anchor")).not.toBeInTheDocument();
  });

  it("(b) level=project → field 'Dự án' hiện", async () => {
    renderForm();
    fireEvent.change(levelSelect(), { target: { value: "project" } });
    await waitFor(() => expect(screen.getByText("Chọn dự án")).toBeInTheDocument());
  });

  it("(c) level=employee → EmployeePicker (#251) hiện", async () => {
    renderForm();
    fireEvent.change(levelSelect(), { target: { value: "employee" } });
    await waitFor(() => expect(screen.getByTestId("goal-employee-anchor")).toBeInTheDocument());
  });
});

describe("GoalFormPage — validate RHF+Zod", () => {
  it("(d) submit khi thiếu tên → lỗi 'Tên mục tiêu là bắt buộc', KHÔNG gọi createGoal", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Tạo mục tiêu/ }));
    await waitFor(() => expect(screen.getByText(/Tên mục tiêu là bắt buộc/)).toBeInTheDocument());
    expect(mockCreateGoal).not.toHaveBeenCalled();
  });
});
