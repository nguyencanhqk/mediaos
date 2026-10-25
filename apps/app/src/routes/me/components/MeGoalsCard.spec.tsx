// @vitest-environment jsdom
/**
 * S5-GOAL-FE-2 — MeGoalsCard ("Mục tiêu của tôi" trong Tổng quan ME, GOAL-API-013).
 *
 * Mirror MeTrainingCard: SELF-GATE (thiếu access:goal → render null + KHÔNG fetch), query RIÊNG
 * (GET /me/goals) fail-soft độc lập khỏi getOverview. Tiến độ LUÔN qua GoalProgressBar — NULL là
 * "chưa đo", KHÔNG in "0%" (SPEC-10 §13.2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { goalApi, useAuthStore } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeGoalsCard } from "./MeGoalsCard";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    meApi: { ...actual.meApi, getGoals: vi.fn() },
    // S20-GOAL-QUICKSTART-1 — «Kích hoạt» trên thẻ = PATCH {status} qua hook dùng chung.
    goalApi: { ...actual.goalApi, updateGoal: vi.fn() },
  };
});

import { meApi } from "@mediaos/web-core";
const mockGetGoals = meApi.getGoals as ReturnType<typeof vi.fn>;
const mockUpdateGoal = goalApi.updateGoal as ReturnType<typeof vi.fn>;

function makeGoal(over: Partial<GoalCoreResponseDto> = {}): GoalCoreResponseDto {
  return {
    id: "g-1",
    companyId: "co-1",
    goalCode: "GOAL-0001",
    name: "Tăng doanh thu 20%",
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: "emp-1",
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
    ...over,
  };
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeGoalsCard />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  mockGetGoals.mockResolvedValue([]);
});

describe("MeGoalsCard — self-gate access:goal", () => {
  it("thiếu access:goal → render null + KHÔNG gọi meApi.getGoals", () => {
    setCaps({ "access:me": true });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetGoals).not.toHaveBeenCalled();
  });
});

describe("MeGoalsCard — trạng thái dữ liệu", () => {
  beforeEach(() => setCaps({ "access:goal": true, "checkin:goal": true }));

  it("rỗng → empty-state (không lỗi)", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText(/chưa có mục tiêu/i)).toBeInTheDocument());
  });

  it("lỗi → fail-soft error (KHÔNG kéo sập trang)", async () => {
    mockGetGoals.mockRejectedValue(new Error("500"));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/không tải được mục tiêu của bạn/i)).toBeInTheDocument(),
    );
  });

  it("progress NULL → 'chưa đo' qua GoalProgressBar, TUYỆT ĐỐI không in '0%'", async () => {
    mockGetGoals.mockResolvedValue([makeGoal({ progressPercent: null })]);
    renderCard();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("progress có số → progressbar đúng giá trị", async () => {
    mockGetGoals.mockResolvedValue([makeGoal({ progressPercent: 40 })]);
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"),
    );
  });
});

describe("MeGoalsCard — check-in nhanh gate ('checkin','goal')", () => {
  it("thiếu checkin:goal → nút check-in nhanh KHÔNG render (card vẫn hiện)", async () => {
    setCaps({ "access:goal": true });
    mockGetGoals.mockResolvedValue([makeGoal()]);
    renderCard();
    await waitFor(() => expect(screen.getByText("Tăng doanh thu 20%")).toBeInTheDocument());
    expect(screen.queryByTestId("me-goal-checkin-g-1")).not.toBeInTheDocument();
  });

  it("có checkin:goal → nút check-in nhanh hiện", async () => {
    setCaps({ "access:goal": true, "checkin:goal": true });
    mockGetGoals.mockResolvedValue([makeGoal()]);
    renderCard();
    expect(await screen.findByTestId("me-goal-checkin-g-1")).toBeInTheDocument();
  });

  it("mục tiêu đã chốt kỳ → nút check-in nhanh DISABLED", async () => {
    setCaps({ "access:goal": true, "checkin:goal": true });
    mockGetGoals.mockResolvedValue([makeGoal({ finalizedAt: "2026-04-01T00:00:00.000Z" })]);
    renderCard();
    expect(await screen.findByTestId("me-goal-checkin-g-1")).toBeDisabled();
  });
});

// ── S20-GOAL-QUICKSTART-1 (US-GOAL-NV-04) — thẻ thấy cả Nháp, theo kỳ, tối đa 5 dòng ────────────────
describe("MeGoalsCard — kỳ hiện tại, cả Nháp (NV-04)", () => {
  const OPEN_CAPS = { "access:goal": true, "checkin:goal": true, "update:goal": true };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:00 ngày 01/10/2026 giờ công ty (máy múi tây vẫn ở 30/09) ⇒ kỳ hiện tại = Q4/2026.
    vi.setSystemTime(new Date("2026-09-30T18:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(c1) gọi /me/goals với periodFrom/periodTo quý hiện tại (giờ công ty), limit 20, KHÔNG lọc status", async () => {
    setCaps(OPEN_CAPS);
    renderCard();
    await waitFor(() => expect(mockGetGoals).toHaveBeenCalled());
    expect(mockGetGoals).toHaveBeenCalledWith({
      periodFrom: "2026-10-01",
      periodTo: "2026-12-31",
      limit: 20,
    });
  });

  it("(c2) 2 Active + 1 Nháp (+ Completed/Cancelled) ⇒ hiện 3; Nháp có badge, «Kích hoạt», Check-in khoá có lý do", async () => {
    setCaps(OPEN_CAPS);
    mockGetGoals.mockResolvedValue([
      makeGoal({ id: "a-1", name: "Active một" }),
      makeGoal({ id: "a-2", name: "Active hai" }),
      makeGoal({ id: "d-1", name: "Nháp một", status: "Draft" }),
      makeGoal({ id: "x-1", name: "Xong rồi", status: "Completed" }),
      makeGoal({ id: "x-2", name: "Đã huỷ", status: "Cancelled" }),
    ]);
    renderCard();
    const draftRow = (await screen.findByText("Nháp một")).closest("li") as HTMLElement;
    expect(screen.getByText("Active một")).toBeInTheDocument();
    expect(screen.getByText("Active hai")).toBeInTheDocument();
    expect(screen.queryByText("Xong rồi")).not.toBeInTheDocument();
    expect(screen.queryByText("Đã huỷ")).not.toBeInTheDocument();
    expect(within(draftRow).getByText("Nháp")).toBeInTheDocument();
    expect(within(draftRow).getByRole("button", { name: "Kích hoạt" })).toBeEnabled();
    expect(screen.getByTestId("me-goal-checkin-d-1")).toBeDisabled();
    expect(within(draftRow).getByText(/Mục tiêu đang ở Nháp/)).toBeInTheDocument();
    expect(screen.getByTestId("me-goal-checkin-a-1")).toBeEnabled();
    expect(screen.getByRole("button", { name: /Xem tất cả \(3\)/ })).toBeInTheDocument();
  });

  it("(c3) 7 mục đang mở ⇒ 5 dòng + «Xem tất cả (7)» → /goals?mine=1", async () => {
    setCaps(OPEN_CAPS);
    mockGetGoals.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => makeGoal({ id: `g-${i}`, name: `Mục tiêu ${i}` })),
    );
    renderCard();
    await screen.findByText("Mục tiêu 0");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Mục tiêu 5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem tất cả \(7\)/ }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/goals", search: { mine: 1 } });
  });

  it("(c4) bấm tên ⇒ mở chi tiết; nhãn kỳ Q4/2026", async () => {
    setCaps(OPEN_CAPS);
    mockGetGoals.mockResolvedValue([
      makeGoal({ periodStart: "2026-10-01", periodEnd: "2026-12-31", periodType: "quarter" }),
    ]);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Tăng doanh thu 20%/ }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/goals/$goalId", params: { goalId: "g-1" } });
    expect(screen.getByText("Q4/2026")).toBeInTheDocument();
  });

  it("(c5) rỗng ⇒ «Tạo mục tiêu» chỉ khi có create:goal", async () => {
    setCaps({ ...OPEN_CAPS, "create:goal": true });
    const view = renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Tạo mục tiêu" }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/goals/new" });
    view.unmount();

    setCaps(OPEN_CAPS);
    renderCard();
    await screen.findByText(/chưa có mục tiêu/i);
    expect(screen.queryByRole("button", { name: "Tạo mục tiêu" })).not.toBeInTheDocument();
  });

  it("(c6) thiếu update:goal ⇒ mục Nháp không có «Kích hoạt»", async () => {
    setCaps({ "access:goal": true, "checkin:goal": true });
    mockGetGoals.mockResolvedValue([makeGoal({ status: "Draft" })]);
    renderCard();
    await screen.findByText("Tăng doanh thu 20%");
    expect(screen.queryByRole("button", { name: "Kích hoạt" })).not.toBeInTheDocument();
  });

  it("(c7) «Kích hoạt» ⇒ PATCH {status:'Active'} qua hook dùng chung", async () => {
    setCaps(OPEN_CAPS);
    mockGetGoals.mockResolvedValue([makeGoal({ status: "Draft" })]);
    mockUpdateGoal.mockReturnValue(new Promise(() => undefined));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Kích hoạt" }));
    // mutationFn chạy SAU onMutate (huỷ query đang chạy + ghi lạc quan) ⇒ chờ một nhịp.
    await waitFor(() => expect(mockUpdateGoal).toHaveBeenCalledWith("g-1", { status: "Active" }));
    await waitFor(() => expect(screen.getByTestId("me-goal-checkin-g-1")).toBeEnabled());
  });

  it("(c8) API lỗi ⇒ «Thử lại» gọi lại /me/goals", async () => {
    setCaps(OPEN_CAPS);
    mockGetGoals.mockRejectedValue(new Error("500"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Thử lại/ }));
    await waitFor(() => expect(mockGetGoals).toHaveBeenCalledTimes(2));
  });
});
