/**
 * S5-GOAL-FE-1 — GoalFormPage (GOAL-SCREEN-003). Trọng tâm:
 *  (a) chọn level=department → field neo "Phòng ban" (select) hiện.
 *  (b) chọn level=project → field neo "Dự án" hiện.
 *  (c) chọn level=employee → EmployeePicker (#251) hiện.
 *  (d) submit khi thiếu tên/cấp → lỗi validate (RHF+Zod, GOAL-ERR-001).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// S18-FE-DEPTQUERYKEY-1 — `hrKeys` lấy BẢN THẬT (xem ghi chú cùng tên ở GoalListPage.spec.tsx).
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
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
    hrKeys: actual.hrKeys,
    // S20-GOAL-LISTURL-1 — chọn Quý/Năm tự điền ngày theo giờ công ty (hàm thuần, lấy bản THẬT).
    companyTimeZone: actual.companyTimeZone,
    quarterRange: actual.quarterRange,
    yearRange: actual.yearRange,
    taskProjectApi: { listProjects: vi.fn() },
    taskKeys: { projects: { list: (p?: unknown) => ["tasks", "projects", "list", p] } },
  };
});

vi.mock("@/routes/tasks/EmployeePicker", () => ({
  EmployeePicker: ({ testId }: { testId: string }) => <div data-testid={testId}>picker</div>,
}));

import { ApiError, goalApi, hrApi, taskProjectApi } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { GoalFormPage } from "./GoalFormPage";

const mockCreateGoal = goalApi.createGoal as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;
const mockListProjects = taskProjectApi.listProjects as ReturnType<typeof vi.fn>;

type FormProps = Partial<React.ComponentProps<typeof GoalFormPage>>;

function renderForm(props: FormProps = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalFormPage onSuccess={vi.fn()} onCancel={vi.fn()} {...props} />
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

// ── S20-GOAL-LISTURL-1 (US-GOAL-QL-04) — prefill /goals/new + «Lưu và thêm tiếp» ──────────────────
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const DEPT_ID = "11111111-1111-4111-8111-111111111111";
const PARENT = {
  id: PARENT_ID,
  companyId: "co-1",
  goalCode: "GOAL-0009",
  name: "Doanh thu phòng Kinh doanh Q4",
  description: null,
  level: "department",
  departmentId: DEPT_ID,
  projectId: null,
  employeeId: null,
  parentGoalId: null,
  ownerEmployeeId: null,
  periodType: "quarter",
  periodStart: "2026-10-01",
  periodEnd: "2026-12-31",
  measureType: "percent",
  targetValue: null,
  currentValue: null,
  unit: null,
  progressMode: "children",
  progressPercent: null,
  weight: 1,
  status: "Active",
  finalizedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  parent: null,
  childCount: 0,
};
const CHILD_PREFILL = {
  parentGoalId: PARENT_ID,
  level: "employee" as const,
  departmentId: DEPT_ID,
  periodType: "quarter" as const,
  periodStart: "2026-10-01",
  periodEnd: "2026-12-31",
};
const mockGetGoal = goalApi.getGoal as ReturnType<typeof vi.fn>;
/** ApiError của mock nhận chuỗi (kiểu THẬT nhận ApiErrorInput) — dựng lỗi HTTP kèm status. */
function httpError(status: number, message: string): Error {
  const MockApiError = ApiError as unknown as new (m: string) => Error;
  return Object.assign(new MockApiError(message), { status });
}

function field(name: RegExp): HTMLInputElement | HTMLSelectElement {
  return screen.getByLabelText(name) as HTMLInputElement | HTMLSelectElement;
}

describe("GoalFormPage — prefill từ mục tiêu cha (QL-04 TC1, TC5)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(p1) cha hợp lệ ⇒ cha · kỳ Q4 · cấp Nhân viên · Active điền sẵn", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    renderForm({ prefill: CHILD_PREFILL });
    await waitFor(() => expect(field(/Mục tiêu cha/).value).toBe(PARENT_ID));
    expect(levelSelect().value).toBe("employee");
    expect(field(/Trạng thái/).value).toBe("Active");
    expect(field(/Loại kỳ/).value).toBe("quarter");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    expect(screen.queryByText(/Mục tiêu cha không hợp lệ/)).not.toBeInTheDocument();
  });

  it("(p2) cha không tồn tại ⇒ cảnh báo, bỏ prefill cha (giữ kỳ)", async () => {
    mockGetGoal.mockRejectedValue(httpError(404, "not found"));
    renderForm({ prefill: CHILD_PREFILL });
    expect(await screen.findByText(/Mục tiêu cha không hợp lệ/)).toBeInTheDocument();
    expect(field(/Mục tiêu cha/).value).toBe("");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
  });

  it("(p3) cha đã chốt kỳ ⇒ cảnh báo, bỏ prefill cha", async () => {
    mockGetGoal.mockResolvedValue({ ...PARENT, finalizedAt: "2026-12-31T10:00:00.000Z" });
    renderForm({ prefill: CHILD_PREFILL });
    expect(await screen.findByText(/Mục tiêu cha không hợp lệ/)).toBeInTheDocument();
    expect(field(/Mục tiêu cha/).value).toBe("");
  });
});

describe("GoalFormPage — lưu từ cha (QL-04 TC2)", () => {
  afterEach(() => vi.restoreAllMocks());

  function fillChild() {
    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Doanh số NV A" } });
    fireEvent.change(field(/Giá trị mục tiêu/), { target: { value: "50" } });
  }

  it("(p4) «Lưu và thêm tiếp» ⇒ tạo + toast, giữ cha/kỳ, xoá tên/chỉ tiêu, KHÔNG rời form", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    mockCreateGoal.mockResolvedValue({
      ...PARENT,
      id: "g-child",
      name: "Doanh số NV A",
      parentGoalId: PARENT_ID,
    });
    const success = vi.spyOn(toast, "success");
    const onSuccess = vi.fn();
    const onCreatedFromParent = vi.fn();
    renderForm({
      prefill: { ...CHILD_PREFILL, level: "department" },
      onSuccess,
      onCreatedFromParent,
    });
    await waitFor(() => expect(field(/Mục tiêu cha/).value).toBe(PARENT_ID));
    fillChild();
    fireEvent.click(screen.getByRole("button", { name: "Lưu và thêm tiếp" }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(mockCreateGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        parentGoalId: PARENT_ID,
        status: "Active",
        periodStart: "2026-10-01",
      }),
    );
    await waitFor(() => expect(field(/Tên mục tiêu/).value).toBe(""));
    expect(field(/Giá trị mục tiêu/).value).toBe("");
    expect(field(/Mục tiêu cha/).value).toBe(PARENT_ID);
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCreatedFromParent).not.toHaveBeenCalled();
  });

  it("(p5) tạo từ cha (nút chính) ⇒ về tab Mục tiêu con của cha", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    mockCreateGoal.mockResolvedValue({ ...PARENT, id: "g-child", parentGoalId: PARENT_ID });
    const onCreatedFromParent = vi.fn();
    renderForm({ prefill: { ...CHILD_PREFILL, level: "department" }, onCreatedFromParent });
    await waitFor(() => expect(field(/Mục tiêu cha/).value).toBe(PARENT_ID));
    fillChild();
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    await waitFor(() => expect(onCreatedFromParent).toHaveBeenCalledWith(PARENT_ID));
  });

  it("(p6) BE từ chối quyền (403) ⇒ form báo lỗi quyền", async () => {
    mockCreateGoal.mockRejectedValue(httpError(403, "Forbidden"));
    mockGetGoal.mockResolvedValue(PARENT);
    renderForm({ prefill: { ...CHILD_PREFILL, level: "department" } });
    await waitFor(() => expect(field(/Mục tiêu cha/).value).toBe(PARENT_ID));
    fillChild();
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    expect(await screen.findByText(/không có quyền/)).toBeInTheDocument();
  });
});

describe("GoalFormPage — chọn Quý/Năm tự điền ngày (QL-04 TC3)", () => {
  afterEach(() => vi.useRealTimers());

  it("(p7) form trống chọn Quý ⇒ quý hiện tại theo giờ công ty; Năm ⇒ cả năm", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T03:00:00.000Z"));
    renderForm();
    fireEvent.change(field(/Loại kỳ/), { target: { value: "quarter" } });
    await waitFor(() => expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01"));
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    fireEvent.change(field(/Loại kỳ/), { target: { value: "year" } });
    await waitFor(() => expect(field(/Bắt đầu kỳ/).value).toBe("2026-01-01"));
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    // Sửa tay được.
    fireEvent.change(field(/Bắt đầu kỳ/), { target: { value: "2026-02-01" } });
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-02-01");
  });
});
