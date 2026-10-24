/**
 * S5-GOAL-FE-1 — GoalListPage (GOAL-SCREEN-001). Trạng thái UI + gate:
 *  (a) không view:goal → forbidden (nội dung ẩn), 0 lời gọi dữ liệu.
 *  (b) tree: loading → data (tên goal + tiến độ).
 *  (c) tree rỗng → empty state.
 *  (d) nút "Tạo mục tiêu" gate create:goal.
 *
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-03) — bộ lọc sống trên URL, đo qua ROUTER THẬT (`createMemoryHistory`):
 *  (e) URL trống ⇒ kỳ = quý hiện tại theo giờ công ty + phòng của tôi (scope view:goal > Own), URL ghi lại.
 *  (f) scope Own ⇒ KHÔNG đặt phòng, KHÔNG gọi /auth/me.
 *  (g) tham số rác ⇒ dùng mặc định, không màn lỗi.
 *  (h) lựa chọn gần nhất (localStorage) khi URL trống; Back từ chi tiết khôi phục y nguyên.
 *      (h4) Back RỜI `/goals` (về chi tiết, về /home) ⇒ URL trang đích y nguyên: trang danh sách còn
 *      mount lúc chuyển KHÔNG được ghi mặc định lên URL trang khác. (h5) bấm dòng ⇒ chi tiết KHÔNG mang
 *      bộ lọc của danh sách.
 *  (i) «Của tôi» ⇒ GET /me/goals kèm kỳ, KHÔNG ?employeeId=; rỗng ⇒ «Xem kỳ trước».
 *  (j) chip kỳ ghi `period` lên URL.
 *
 * Quyền dùng store THẬT (`useAuthStore` capabilities + scopes) — không mock `useCan`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
} from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    goalApi: { ...actual.goalApi, listGoals: vi.fn(), getTree: vi.fn() },
    meApi: { ...actual.meApi, getGoals: vi.fn() },
    authApi: { ...actual.authApi, me: vi.fn() },
    hrApi: { ...actual.hrApi, listDepartments: vi.fn(), listEmployees: vi.fn() },
  };
});

import { authApi, goalApi, hrApi, meApi, useAuthStore } from "@mediaos/web-core";
import { GoalListPage } from "./GoalListPage";

const mockListGoals = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockGetTree = goalApi.getTree as ReturnType<typeof vi.fn>;
const mockMeGoals = meApi.getGoals as ReturnType<typeof vi.fn>;
const mockAuthMe = authApi.me as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;

const DEPT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DEPT_ID = "22222222-2222-4222-8222-222222222222";
/** 23/10/2026 10:00 giờ Việt Nam — quý 4 theo giờ công ty. */
const NOW = new Date("2026-10-23T03:00:00.000Z");
const Q4 = "2026-10-01..2026-12-31";
const Q3 = "2026-07-01..2026-09-30";
const YEAR_2026 = "2026-01-01..2026-12-31";
const REMEMBER_KEY = "mediaos.goals.list.last";

const TREE_NODE = {
  id: "g-1",
  companyId: "co-1",
  goalCode: "GOAL-0001",
  name: "Tăng doanh thu 20%",
  description: null,
  level: "department",
  departmentId: DEPT_ID,
  projectId: null,
  employeeId: null,
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
  children: [],
};
const { children: _children, ...GOAL_ROW } = TREE_NODE;

function login(caps: Record<string, boolean>, viewScopes: string[] = ["Department"]) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", companyId: "co-1", email: "ql@demo.local", fullName: "QL", status: "Active" },
    capabilities: caps,
    scopes: caps["view:goal"] ? { "view:goal": viewScopes as never } : {},
  });
}

/** Trang giả có link «Mục tiêu» sang `/goals` (không kèm search — như link sidebar). */
function StubPage({ testId }: { testId: string }) {
  return (
    <div data-testid={testId}>
      <Link to="/goals">Mục tiêu</Link>
    </div>
  );
}

/**
 * Dựng `/goals` + `/goals/$goalId` (chi tiết giả) + `/home` (giả) trên router THẬT; trả history để đọc
 * URL đã ghi.
 */
function mountAt(href: string) {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals",
    component: GoalListPage,
    errorComponent: ({ error }) => <p data-testid="route-error">{error.message}</p>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/$goalId",
    component: () => <StubPage testId="goal-detail-stub" />,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <StubPage testId="home-stub" />,
  });
  const history = createMemoryHistory({ initialEntries: [href] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute, homeRoute]),
    history,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return history;
}

function searchOf(history: ReturnType<typeof createMemoryHistory>): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(history.location.search));
}

beforeEach(() => {
  // Router thật khôi phục cuộn khi điều hướng — jsdom không có scrollTo.
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  login({ "view:goal": true, "create:goal": true });
  mockListGoals.mockResolvedValue([]);
  mockGetTree.mockResolvedValue([TREE_NODE]);
  mockMeGoals.mockResolvedValue([]);
  mockAuthMe.mockResolvedValue({ employee: { departmentId: DEPT_ID } });
  mockListDepartments.mockResolvedValue([
    { id: DEPT_ID, name: "Kinh doanh" },
    { id: OTHER_DEPT_ID, name: "Kỹ thuật" },
  ]);
  mockListEmployees.mockResolvedValue({ items: [], meta: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(window.scrollTo).mockRestore();
});

describe("GoalListPage — gate view:goal", () => {
  it("(a) không view:goal → forbidden, KHÔNG gọi list/tree/me-goals//auth/me", async () => {
    login({ "create:goal": true });
    mountAt("/goals");
    expect(await screen.findByText("Bạn không có quyền xem mục tiêu")).toBeInTheDocument();
    expect(mockGetTree).not.toHaveBeenCalled();
    expect(mockListGoals).not.toHaveBeenCalled();
    expect(mockMeGoals).not.toHaveBeenCalled();
    expect(mockAuthMe).not.toHaveBeenCalled();
  });
});

describe("GoalListPage — tree view (mặc định)", () => {
  it("(b) loading → data: hiện tên goal + %", async () => {
    mountAt(`/goals?period=${Q4}`);
    expect(await screen.findByText("Tăng doanh thu 20%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("(c) tree rỗng → empty state", async () => {
    mockGetTree.mockResolvedValue([]);
    mountAt(`/goals?period=${Q4}`);
    expect(await screen.findByText("Chưa có mục tiêu kỳ này")).toBeInTheDocument();
  });
});

describe("GoalListPage — nút Tạo gate create:goal", () => {
  it("(d) có create:goal → nút hiện", async () => {
    mountAt(`/goals?period=${Q4}`);
    await screen.findByText("Tăng doanh thu 20%");
    expect(screen.getAllByText("Tạo mục tiêu").length).toBeGreaterThan(0);
  });

  it("(d) không create:goal → nút Tạo ẩn", async () => {
    login({ "view:goal": true });
    mountAt(`/goals?period=${Q4}`);
    await screen.findByText("Tăng doanh thu 20%");
    expect(screen.queryByText("Tạo mục tiêu")).not.toBeInTheDocument();
  });
});

describe("GoalListPage — mặc định khi URL trống (US-GOAL-QL-03 TC1)", () => {
  it("(e) QL phòng Kinh doanh, 23/10/2026: kỳ 01/10–31/12/2026 + phòng của tôi, URL phản ánh", async () => {
    const history = mountAt("/goals");
    await waitFor(() => expect(searchOf(history)).toEqual({ period: Q4, departmentId: DEPT_ID }));
    await waitFor(() =>
      expect(mockGetTree).toHaveBeenCalledWith({
        departmentId: DEPT_ID,
        periodFrom: "2026-10-01",
        periodTo: "2026-12-31",
      }),
    );
    // Không có lượt tải «mọi kỳ» trước khi URL nhận mặc định.
    for (const [params] of mockGetTree.mock.calls) expect(params).toHaveProperty("periodFrom");
  });

  it("(f) scope view:goal = Own ⇒ chỉ đặt kỳ, KHÔNG đặt phòng, KHÔNG gọi /auth/me", async () => {
    login({ "view:goal": true }, ["Own"]);
    const history = mountAt("/goals");
    await waitFor(() => expect(searchOf(history)).toEqual({ period: Q4 }));
    expect(mockAuthMe).not.toHaveBeenCalled();
  });

  it("(g) tham số rác ⇒ bỏ qua, dùng mặc định, không màn lỗi (TC6)", async () => {
    const history = mountAt("/goals?period=abc&departmentId=xyz&status=xyz");
    await waitFor(() => expect(searchOf(history)).toEqual({ period: Q4, departmentId: DEPT_ID }));
    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
    expect(await screen.findByText("Tăng doanh thu 20%")).toBeInTheDocument();
  });

  it("(h1) URL trống + có lựa chọn gần nhất ⇒ khôi phục (kỳ vẫn là quý hiện tại), không đặt phòng", async () => {
    window.localStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ view: "list", status: "Active", period: Q3 }),
    );
    const history = mountAt("/goals");
    await waitFor(() =>
      expect(searchOf(history)).toEqual({ view: "list", status: "Active", period: Q4 }),
    );
    expect(mockAuthMe).not.toHaveBeenCalled();
  });

  it("(h2) localStorage hỏng ⇒ coi như chưa nhớ, không màn lỗi", async () => {
    window.localStorage.setItem(REMEMBER_KEY, "{không phải json");
    const history = mountAt("/goals");
    await waitFor(() => expect(searchOf(history)).toEqual({ period: Q4, departmentId: DEPT_ID }));
  });
});

describe("GoalListPage — bộ lọc trên URL (TC2)", () => {
  it("(h3) danh sách + Active: mở chi tiết rồi Back ⇒ góc nhìn y nguyên, lựa chọn được nhớ", async () => {
    mockListGoals.mockResolvedValue([GOAL_ROW]);
    const href = `/goals?period=${Q4}&view=list&status=Active`;
    const history = mountAt(href);
    await waitFor(() =>
      expect(mockListGoals).toHaveBeenCalledWith(
        expect.objectContaining({ status: "Active", periodFrom: "2026-10-01" }),
      ),
    );
    fireEvent.click(await screen.findByText("Tăng doanh thu 20%"));
    await screen.findByTestId("goal-detail-stub");
    history.back();
    await waitFor(() =>
      expect(searchOf(history)).toEqual({ period: Q4, view: "list", status: "Active" }),
    );
    expect(await screen.findByText("Tăng doanh thu 20%")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(REMEMBER_KEY) ?? "{}")).toMatchObject({
      view: "list",
      status: "Active",
    });
  });

  it("(j) chip «Năm nay» / «Kỳ trước» ghi period lên URL (push)", async () => {
    const history = mountAt(`/goals?period=${Q4}`);
    fireEvent.click(await screen.findByRole("button", { name: "Năm nay" }));
    await waitFor(() => expect(searchOf(history).period).toBe(YEAR_2026));
    fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));
    await waitFor(() => expect(searchOf(history).period).toBe(Q3));
    expect(screen.getByRole("button", { name: "Kỳ trước" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/** Chờ hết lượt effect/điều hướng sau khi trang đích đã hiện (ghi sai — nếu có — đã xảy ra). */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("GoalListPage — rời /goals KHÔNG ghi bộ lọc lên trang khác (F5 · Back · Quay lại)", () => {
  it.each([
    ["/goals/g-1", "goal-detail-stub"],
    ["/home", "home-stub"],
  ])(
    "(h4) %s → link /goals (mặc định được ghi) → Back ⇒ URL trang trước y nguyên, 0 replace",
    async (start, testId) => {
      const history = mountAt(start);
      fireEvent.click(await screen.findByRole("link", { name: "Mục tiêu" }));
      await waitFor(() => expect(searchOf(history)).toEqual({ period: Q4, departmentId: DEPT_ID }));
      const replace = vi.spyOn(history, "replace");
      history.back();
      await screen.findByTestId(testId);
      await settle();
      expect({ pathname: history.location.pathname, search: history.location.search }).toEqual({
        pathname: start,
        search: "",
      });
      expect(replace.mock.calls.map(([href]) => String(href))).toEqual([]);
    },
  );

  it("(h5) bấm dòng ở chế độ danh sách ⇒ chi tiết KHÔNG mang bộ lọc danh sách", async () => {
    mockListGoals.mockResolvedValue([GOAL_ROW]);
    const history = mountAt(`/goals?period=${Q4}&view=list&status=Active`);
    fireEvent.click(await screen.findByText("Tăng doanh thu 20%"));
    await screen.findByTestId("goal-detail-stub");
    await settle();
    expect({ pathname: history.location.pathname, search: history.location.search }).toEqual({
      pathname: "/goals/g-1",
      search: "",
    });
  });
});

describe("GoalListPage — «Của tôi» (TC4, TC5, TC7)", () => {
  it("(i1) ?mine=1 ⇒ GET /me/goals kèm kỳ, KHÔNG list/tree, KHÔNG employeeId", async () => {
    mockMeGoals.mockResolvedValue([GOAL_ROW]);
    mountAt(`/goals?mine=1&period=${Q4}`);
    expect(await screen.findByText("Tăng doanh thu 20%")).toBeInTheDocument();
    expect(mockMeGoals).toHaveBeenCalledWith(
      expect.objectContaining({ periodFrom: "2026-10-01", periodTo: "2026-12-31" }),
    );
    for (const [params] of mockMeGoals.mock.calls) expect(params).not.toHaveProperty("employeeId");
    expect(mockListGoals).not.toHaveBeenCalled();
    expect(mockGetTree).not.toHaveBeenCalled();
  });

  it("(i2) link ?mine=1 không kèm kỳ ⇒ kỳ = quý hiện tại, KHÔNG đặt phòng", async () => {
    const history = mountAt("/goals?mine=1");
    await waitFor(() => expect(searchOf(history)).toEqual({ mine: "1", period: Q4 }));
    await waitFor(() =>
      expect(mockMeGoals).toHaveBeenCalledWith(
        expect.objectContaining({ periodFrom: "2026-10-01" }),
      ),
    );
  });

  it("(i3) «Của tôi» rỗng ⇒ thông điệp + Tạo + «Xem kỳ trước» chuyển kỳ", async () => {
    const history = mountAt(`/goals?mine=1&period=${Q4}`);
    expect(await screen.findByText("Bạn chưa có mục tiêu trong kỳ này")).toBeInTheDocument();
    expect(screen.getAllByText("Tạo mục tiêu").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Xem kỳ trước" }));
    await waitFor(() => expect(searchOf(history).period).toBe(Q3));
  });

  it("(i4) bấm «Của tôi» ⇒ URL có mine=1", async () => {
    const history = mountAt(`/goals?period=${Q4}`);
    fireEvent.click(await screen.findByRole("button", { name: "Của tôi" }));
    await waitFor(() => expect(searchOf(history).mine).toBe("1"));
  });
});
