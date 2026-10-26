/**
 * S5-GOAL-FE-1 — GoalFormPage (GOAL-SCREEN-003). Trọng tâm:
 *  (a) chọn level=department → field neo "Phòng ban" (select) hiện.
 *  (b) chọn level=project → field neo "Dự án" hiện.
 *  (c) chọn level=employee → EmployeePicker (#251) hiện.
 *  (d) submit khi thiếu tên/cấp → lỗi validate (RHF+Zod, GOAL-ERR-001).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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
    // S20-GOAL-QUICKSTART-1 — mặc định đọc phạm vi create:goal + hồ sơ của mình từ store phiên THẬT
    // (lượt /auth/me lúc khởi động). `authApi.me` là spy để khoá «mở form không gọi lại /auth/me».
    useAuthStore: actual.useAuthStore,
    authApi: { me: vi.fn() },
    authKeys: actual.authKeys,
  };
});

vi.mock("@/routes/tasks/EmployeePicker", () => ({
  EmployeePicker: ({ testId }: { testId: string }) => <div data-testid={testId}>picker</div>,
}));

import { ApiError, authApi, goalApi, hrApi, taskProjectApi, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { GoalFormPage } from "./GoalFormPage";

const mockCreateGoal = goalApi.createGoal as ReturnType<typeof vi.fn>;
const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;
const mockListProjects = taskProjectApi.listProjects as ReturnType<typeof vi.fn>;
const mockMe = authApi.me as ReturnType<typeof vi.fn>;
const SELF_ID = "44444444-4444-4444-8444-444444444444";

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
  mockMe.mockResolvedValue({ employee: { id: SELF_ID } });
  useAuthStore.setState({ scopes: {}, user: selfUser(SELF_ID) });
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

/** S20-GOAL-PARENTPICKER-1 — ô chọn cha là combobox có tìm; ô hiện «mã — tên» của cha đang chọn. */
const PARENT_LABEL = "GOAL-0009 — Doanh thu phòng Kinh doanh Q4";
function parentInput(): HTMLInputElement {
  return screen.getByRole("combobox", { name: /Mục tiêu cha/ }) as HTMLInputElement;
}

describe("GoalFormPage — prefill từ mục tiêu cha (QL-04 TC1, TC5)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(p1) cha hợp lệ ⇒ cha · kỳ Q4 · cấp Nhân viên · Active điền sẵn", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    renderForm({ prefill: CHILD_PREFILL });
    await waitFor(() => expect(parentInput().value).toBe(PARENT_LABEL));
    expect(levelSelect().value).toBe("employee");
    expect(field(/Trạng thái/).value).toBe("Active");
    expect(field(/Loại kỳ/).value).toBe("quarter");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    expect(screen.queryByText(/Mục tiêu cha không hợp lệ/)).not.toBeInTheDocument();
  });

  it("(p1b) mở từ cha, chưa chạm ô Trạng thái ⇒ đổi cấp vẫn giữ Active (không ghi đè theo cấp)", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    renderForm({ prefill: CHILD_PREFILL });
    await waitFor(() => expect(parentInput().value).toBe(PARENT_LABEL));

    fireEvent.change(levelSelect(), { target: { value: "department" } });
    await waitFor(() => expect(levelSelect().value).toBe("department"));
    expect(field(/Trạng thái/).value).toBe("Active");
  });

  it("(p2) cha không tồn tại ⇒ cảnh báo, bỏ prefill cha (giữ kỳ)", async () => {
    mockGetGoal.mockRejectedValue(httpError(404, "not found"));
    renderForm({ prefill: CHILD_PREFILL });
    expect(await screen.findByText(/Mục tiêu cha không hợp lệ/)).toBeInTheDocument();
    expect(parentInput().value).toBe("");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
  });

  it("(p3) cha đã chốt kỳ ⇒ cảnh báo, bỏ prefill cha", async () => {
    mockGetGoal.mockResolvedValue({ ...PARENT, finalizedAt: "2026-12-31T10:00:00.000Z" });
    renderForm({ prefill: CHILD_PREFILL });
    expect(await screen.findByText(/Mục tiêu cha không hợp lệ/)).toBeInTheDocument();
    expect(parentInput().value).toBe("");
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
    await waitFor(() => expect(parentInput().value).toBe(PARENT_LABEL));
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
    expect(parentInput().value).toBe(PARENT_LABEL);
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCreatedFromParent).not.toHaveBeenCalled();
  });

  it("(p5) tạo từ cha (nút chính) ⇒ về tab Mục tiêu con của cha", async () => {
    mockGetGoal.mockResolvedValue(PARENT);
    mockCreateGoal.mockResolvedValue({ ...PARENT, id: "g-child", parentGoalId: PARENT_ID });
    const onCreatedFromParent = vi.fn();
    renderForm({ prefill: { ...CHILD_PREFILL, level: "department" }, onCreatedFromParent });
    await waitFor(() => expect(parentInput().value).toBe(PARENT_LABEL));
    fillChild();
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    await waitFor(() => expect(onCreatedFromParent).toHaveBeenCalledWith(PARENT_ID));
  });

  it("(p6) BE từ chối quyền (403) ⇒ form báo lỗi quyền", async () => {
    mockCreateGoal.mockRejectedValue(httpError(403, "Forbidden"));
    mockGetGoal.mockResolvedValue(PARENT);
    renderForm({ prefill: { ...CHILD_PREFILL, level: "department" } });
    await waitFor(() => expect(parentInput().value).toBe(PARENT_LABEL));
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

// ── S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — mặc định thông minh của /goals/new ───────────────────
describe("GoalFormPage — mặc định thông minh (NV-01)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:00 ngày 01/10/2026 giờ công ty — giờ máy múi tây vẫn ở 30/09.
    vi.setSystemTime(new Date("2026-09-30T18:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(q1) create:goal chỉ Own ⇒ ẩn Cấp + Chủ thể, quý hiện tại, Active; lưu gửi neo chính mình", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Own"] } });
    const onSuccess = vi.fn();
    mockCreateGoal.mockResolvedValue({ id: "g-new", parentGoalId: null, name: "Doanh số" });
    renderForm({ onSuccess });

    expect(screen.queryByRole("combobox", { name: /Cấp mục tiêu/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("goal-employee-anchor")).not.toBeInTheDocument(),
    );
    expect(field(/Loại kỳ/).value).toBe("quarter");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
    expect(field(/Trạng thái/).value).toBe("Active");

    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Doanh số" } });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("g-new"));
    expect(mockCreateGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "employee",
        employeeId: SELF_ID,
        periodType: "quarter",
        periodStart: "2026-10-01",
        periodEnd: "2026-12-31",
        status: "Active",
      }),
    );
  });

  it("(q2) chỉ Own nhưng không lấy được hồ sơ ⇒ ô Chủ thể hiện để chọn tay + thông báo, form không bị chặn", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Own"] }, user: selfUser(null) });
    renderForm();

    expect(await screen.findByText(/Không lấy được hồ sơ nhân sự của bạn/)).toBeInTheDocument();
    expect(screen.getByTestId("goal-employee-anchor")).toBeInTheDocument();
    expect(field(/Tên mục tiêu/)).toBeEnabled();
  });

  it("(q3) phạm vi rộng hơn ⇒ Cấp + Chủ thể vẫn hiện để sửa; đổi cấp ⇒ trạng thái theo Q11 = B", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Own", "Department"] } });
    renderForm();

    expect(levelSelect().value).toBe("employee");
    expect(await screen.findByTestId("goal-employee-anchor")).toBeInTheDocument();
    expect(field(/Trạng thái/).value).toBe("Active");
    fireEvent.change(levelSelect(), { target: { value: "department" } });
    await waitFor(() => expect(field(/Trạng thái/).value).toBe("Draft"));
    fireEvent.change(levelSelect(), { target: { value: "employee" } });
    await waitFor(() => expect(field(/Trạng thái/).value).toBe("Active"));
  });

  it("(q4) đã chọn trạng thái bằng tay ⇒ đổi cấp KHÔNG ghi đè", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Department"] } });
    renderForm();

    fireEvent.change(field(/Trạng thái/), { target: { value: "Draft" } });
    fireEvent.change(levelSelect(), { target: { value: "project" } });
    fireEvent.change(levelSelect(), { target: { value: "employee" } });
    await waitFor(() => expect(levelSelect().value).toBe("employee"));
    expect(field(/Trạng thái/).value).toBe("Draft");
  });

  it("(q5) Năm ⇒ 01/01–31/12; Tuỳ chỉnh giữ ngày đang có", async () => {
    renderForm();

    fireEvent.change(field(/Loại kỳ/), { target: { value: "year" } });
    await waitFor(() => expect(field(/Bắt đầu kỳ/).value).toBe("2026-01-01"));
    fireEvent.change(field(/Bắt đầu kỳ/), { target: { value: "2026-02-01" } });
    fireEvent.change(field(/Loại kỳ/), { target: { value: "custom" } });
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-02-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
  });

  it("(q6) mở form tạo KHÔNG gọi /auth/me — hồ sơ của mình lấy từ phiên đã nạp lúc khởi động", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Own"] }, user: selfUser(SELF_ID) });
    const onSuccess = vi.fn();
    renderForm({ onSuccess });

    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Doanh số" } });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("g-new"));
    expect(mockCreateGoal).toHaveBeenCalledWith(
      expect.objectContaining({ level: "employee", employeeId: SELF_ID }),
    );
    expect(mockMe).not.toHaveBeenCalled();
  });

  it("(q7) «Đơn vị đo» chọn MỘT chạm (nhóm lựa chọn, không phải dropdown) ⇒ lưu gửi kiểu đo đã chọn", async () => {
    useAuthStore.setState({ scopes: { "create:goal": ["Own"] }, user: selfUser(SELF_ID) });
    const onSuccess = vi.fn();
    renderForm({ onSuccess });

    const group = screen.getByRole("group", { name: "Đơn vị đo" });
    expect(within(group).getByRole("radio", { name: "Phần trăm (%)" })).toBeChecked();
    fireEvent.click(within(group).getByText("Con số"));
    expect(within(group).getByRole("radio", { name: "Con số" })).toBeChecked();
    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Hợp đồng mới" } });
    fireEvent.change(field(/Giá trị mục tiêu/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo mục tiêu$/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("g-new"));
    expect(mockCreateGoal).toHaveBeenCalledWith(
      expect.objectContaining({ measureType: "number", targetValue: 12 }),
    );
  });
});

// ── S20-GOAL-PARENTPICKER-1 (US-GOAL-NV-12) — chọn cha có tìm, kỳ theo cha, cảnh báo lệch kỳ ──────
describe("GoalFormPage — chọn mục tiêu cha bằng ô tìm (NV-12)", () => {
  const { parent: _drop, childCount: _count, ...PARENT_CORE } = PARENT;
  const PARENT_2027 = {
    ...PARENT_CORE,
    id: "55555555-5555-4555-8555-555555555555",
    goalCode: "GOAL-0010",
    name: "Doanh thu năm 2027",
    periodType: "year" as const,
    periodStart: "2027-01-01",
    periodEnd: "2027-12-31",
  };

  async function pickParent(query: string, name: RegExp) {
    fireEvent.change(parentInput(), { target: { value: query } });
    const list = await screen.findByRole("listbox");
    fireEvent.click(await within(list).findByRole("option", { name }));
  }

  beforeEach(() => {
    mockListGoals.mockResolvedValue([PARENT_CORE, PARENT_2027]);
  });

  it("(n1) kỳ còn mặc định ⇒ chọn cha tự điền loại kỳ + hai ngày theo cha", async () => {
    renderForm();
    await pickParent("2027", /GOAL-0010/);
    expect(parentInput().value).toBe("GOAL-0010 — Doanh thu năm 2027");
    expect(field(/Loại kỳ/).value).toBe("year");
    expect(field(/Bắt đầu kỳ/).value).toBe("2027-01-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2027-12-31");
    expect(screen.queryByText("Kỳ nằm ngoài kỳ của mục tiêu cha")).not.toBeInTheDocument();
  });

  it("(n1b) đổi sang cha khác khi vẫn chưa sửa tay ⇒ kỳ theo cha mới", async () => {
    renderForm();
    await pickParent("2027", /GOAL-0010/);
    await pickParent("goal-0009", /GOAL-0009/);
    expect(field(/Loại kỳ/).value).toBe("quarter");
    expect(field(/Bắt đầu kỳ/).value).toBe("2026-10-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2026-12-31");
  });

  it("(n2) đã sửa tay sang Q1/2027 rồi chọn cha Q4/2026 ⇒ giữ kỳ, cảnh báo vàng, VẪN lưu được", async () => {
    mockCreateGoal.mockResolvedValue({ ...PARENT, id: "g-new", parentGoalId: PARENT_ID });
    renderForm();
    fireEvent.change(field(/Loại kỳ/), { target: { value: "custom" } });
    fireEvent.change(field(/Bắt đầu kỳ/), { target: { value: "2027-01-01" } });
    fireEvent.change(field(/Kết thúc kỳ/), { target: { value: "2027-03-31" } });
    await pickParent("doanh", /GOAL-0009/);

    expect(field(/Bắt đầu kỳ/).value).toBe("2027-01-01");
    expect(field(/Kết thúc kỳ/).value).toBe("2027-03-31");
    expect(await screen.findByText("Kỳ nằm ngoài kỳ của mục tiêu cha")).toBeInTheDocument();

    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Doanh số Q1" } });
    fireEvent.click(screen.getByRole("button", { name: /Tạo mục tiêu/ }));
    await waitFor(() =>
      expect(mockCreateGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          parentGoalId: PARENT_ID,
          periodStart: "2027-01-01",
          periodEnd: "2027-03-31",
        }),
      ),
    );
  });

  it("(n3) sửa kỳ ra ngoài kỳ cha SAU khi chọn ⇒ cảnh báo hiện; sửa lại vào trong ⇒ cảnh báo tắt", async () => {
    renderForm();
    await pickParent("goal-0009", /GOAL-0009/);
    fireEvent.change(field(/Kết thúc kỳ/), { target: { value: "2027-01-15" } });
    expect(await screen.findByText("Kỳ nằm ngoài kỳ của mục tiêu cha")).toBeInTheDocument();
    fireEvent.change(field(/Kết thúc kỳ/), { target: { value: "2026-12-31" } });
    await waitFor(() =>
      expect(screen.queryByText("Kỳ nằm ngoài kỳ của mục tiêu cha")).not.toBeInTheDocument(),
    );
  });

  it("(n4) không khớp ⇒ «Không tìm thấy»; chọn «Không có» ⇒ lưu không có cha", async () => {
    renderForm();
    await pickParent("goal-0009", /GOAL-0009/);
    fireEvent.change(parentInput(), { target: { value: "khong-co-muc-nay" } });
    const list = await screen.findByRole("listbox");
    expect(await screen.findByText("Không tìm thấy")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("option", { name: /Không có/ }));
    expect(parentInput().value).toBe("");
    fireEvent.change(field(/Tên mục tiêu/), { target: { value: "Mục tiêu gốc" } });
    fireEvent.click(screen.getByRole("button", { name: /Tạo mục tiêu/ }));
    await waitFor(() => expect(mockCreateGoal).toHaveBeenCalled());
    expect(mockCreateGoal.mock.calls[0][0].parentGoalId ?? null).toBeNull();
  });

  it("(n5) gợi ý mặc định = cùng phòng của mình + cùng kỳ đang chọn (GET /goals sẵn có)", async () => {
    useAuthStore.setState({
      scopes: {},
      user: { ...selfUser(SELF_ID), employee: { id: SELF_ID, departmentId: DEPT_ID } },
    });
    renderForm();
    fireEvent.keyDown(parentInput(), { key: "ArrowDown" });
    await screen.findByRole("listbox");
    const period = { from: field(/Bắt đầu kỳ/).value, to: field(/Kết thúc kỳ/).value };
    await waitFor(() =>
      expect(mockListGoals).toHaveBeenCalledWith(
        expect.objectContaining({
          departmentId: DEPT_ID,
          periodFrom: period.from,
          periodTo: period.to,
        }),
      ),
    );
  });
});

/** Phiên đã nạp lúc khởi động (bootstrapSession ghi `/auth/me` vào store). */
function selfUser(employeeId: string | null) {
  return {
    id: "u-self",
    companyId: "c-1",
    email: "nv@example.test",
    fullName: "NV",
    status: "Active",
    employee: employeeId === null ? null : { id: employeeId, departmentId: null },
  };
}
