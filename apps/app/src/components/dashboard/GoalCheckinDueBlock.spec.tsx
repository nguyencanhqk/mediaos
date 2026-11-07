// @vitest-environment jsdom
/**
 * S20-DASH-TODAY-1 — khối «Mục tiêu cần check-in» của dashboard Employee. Deny-path trước: thiếu MỘT trong
 * `access:goal` / `checkin:goal` ⇒ không render + 0 lời gọi `GET /me/goals`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { GoalCheckinDueBlock } from "./GoalCheckinDueBlock";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
vi.mock("@/routes/goals/components/GoalCheckinDialog", () => ({
  GoalCheckinDialog: ({ goal }: { goal: { id: string } }) => (
    <div data-testid="checkin-dialog">{goal.id}</div>
  ),
}));
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
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: 20,
    currentValue: 8,
    unit: "%",
    progressMode: "manual",
    progressPercent: 40,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderBlock(othersClear = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <GoalCheckinDueBlock othersClear={othersClear} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const BOTH = { "access:goal": true, "checkin:goal": true };

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
  mockGetGoals.mockResolvedValue([]);
});

describe("GoalCheckinDueBlock — gate", () => {
  it.each([
    ["thiếu access:goal", { "checkin:goal": true }],
    ["thiếu checkin:goal", { "access:goal": true }],
    ["thiếu cả hai", {}],
  ])("%s ⇒ không render, 0 lời gọi /me/goals", (_label, caps) => {
    setCaps(caps);
    const { container } = renderBlock();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetGoals).not.toHaveBeenCalled();
  });
});

describe("GoalCheckinDueBlock — mốc đổi quý", () => {
  afterEach(() => vi.useRealTimers());

  it("render lại sau mốc đổi quý ⇒ hỏi lại theo quý MỚI (khoá query đổi)", async () => {
    setCaps(BOTH);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T05:00:00.000Z"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GoalCheckinDueBlock />
        </I18nextProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui);
    await waitFor(() => expect(mockGetGoals).toHaveBeenCalledTimes(2));
    const from = (i: number) =>
      (mockGetGoals.mock.calls[i][0] as { periodFrom: string }).periodFrom;
    const firstFrom = from(0);
    vi.setSystemTime(new Date("2027-01-02T05:00:00.000Z"));
    rerender(ui);
    await waitFor(() => expect(mockGetGoals).toHaveBeenCalledTimes(4));
    expect(from(2)).not.toBe(firstFrom);
  });
});

describe("GoalCheckinDueBlock — dữ liệu", () => {
  beforeEach(() => setCaps(BOTH));

  it("hỏi server theo từng trạng thái đang mở (Active, Draft)", async () => {
    renderBlock();
    await waitFor(() => expect(mockGetGoals).toHaveBeenCalledTimes(2));
    const statuses = mockGetGoals.mock.calls.map((c) => (c[0] as { status: string }).status);
    expect(statuses.sort()).toEqual(["Active", "Draft"]);
  });

  it("tối đa 5 mục + «Xem tất cả» → /goals?mine=1; mục đã đóng bị ẩn", async () => {
    const active = Array.from({ length: 7 }, (_, i) =>
      makeGoal({ id: `g-${i}`, goalCode: `GOAL-000${i}`, name: `Mục tiêu ${i}` }),
    );
    mockGetGoals.mockImplementation((p: { status: string }) =>
      Promise.resolve(
        p.status === "Active"
          ? [...active, makeGoal({ id: "done", name: "Đã xong", status: "Completed" })]
          : [],
      ),
    );
    renderBlock();
    await screen.findByText("Mục tiêu 0");
    expect(screen.getAllByTestId(/^dash-goal-checkin-/)).toHaveLength(5);
    expect(screen.queryByText("Đã xong")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem tất cả/ }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/goals", search: { mine: 1 } });
  });

  it("«Check-in» mở GoalCheckinDialog của đúng mục tiêu", async () => {
    mockGetGoals.mockImplementation((p: { status: string }) =>
      Promise.resolve(p.status === "Active" ? [makeGoal({ id: "g-9" })] : []),
    );
    renderBlock();
    fireEvent.click(await screen.findByTestId("dash-goal-checkin-g-9"));
    expect(screen.getByTestId("checkin-dialog")).toHaveTextContent("g-9");
  });

  it("mục Nháp ⇒ Check-in bị khoá kèm lý do", async () => {
    mockGetGoals.mockImplementation((p: { status: string }) =>
      Promise.resolve(p.status === "Draft" ? [makeGoal({ id: "g-d", status: "Draft" })] : []),
    );
    renderBlock();
    const btn = await screen.findByTestId("dash-goal-checkin-g-d");
    expect(btn).toBeDisabled();
    const hintId = btn.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent?.trim()).not.toBe("");
  });

  it("một nguồn lỗi ⇒ khối báo lỗi + Thử lại; bấm Thử lại gọi lại", async () => {
    mockGetGoals.mockImplementation((p: { status: string }) =>
      p.status === "Draft" ? Promise.reject(new Error("boom")) : Promise.resolve([]),
    );
    renderBlock();
    expect(await screen.findByText("Không tải được mục tiêu cần check-in")).toBeInTheDocument();
    const before = mockGetGoals.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetGoals.mock.calls.length).toBeGreaterThan(before));
  });

  it("rỗng: nguồn khác còn việc ⇒ thông báo thường; nguồn khác cũng rỗng ⇒ «Hôm nay bạn đã xong hết»", async () => {
    const first = renderBlock(false);
    expect(await screen.findByText(/Chưa có mục tiêu nào cần check-in/)).toBeInTheDocument();
    first.unmount();
    renderBlock(true);
    expect(await screen.findByText("Hôm nay bạn đã xong hết")).toBeInTheDocument();
  });
});
