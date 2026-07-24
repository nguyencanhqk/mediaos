// @vitest-environment jsdom
/**
 * S5-GOAL-FE-2 — MeGoalsCard ("Mục tiêu của tôi" trong Tổng quan ME, GOAL-API-013).
 *
 * Mirror MeTrainingCard: SELF-GATE (thiếu access:goal → render null + KHÔNG fetch), query RIÊNG
 * (GET /me/goals) fail-soft độc lập khỏi getOverview. Tiến độ LUÔN qua GoalProgressBar — NULL là
 * "chưa đo", KHÔNG in "0%" (SPEC-10 §13.2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeGoalsCard } from "./MeGoalsCard";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { ...actual.meApi, getGoals: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetGoals = meApi.getGoals as ReturnType<typeof vi.fn>;

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
