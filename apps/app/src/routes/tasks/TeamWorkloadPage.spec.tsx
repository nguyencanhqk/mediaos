import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hrApi, taskCoreApi, taskProjectApi, useAuthStore } from "@mediaos/web-core";
import { TeamWorkloadPage } from "./TeamWorkloadPage";
import type { TaskWorkloadResponse } from "@mediaos/contracts";

// Link → <a href> đọc được (không dựng router thật); chỉ cần kiểm đích bấm.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      search,
      children,
      ...rest
    }: {
      to: string;
      search?: Record<string, unknown>;
      children: React.ReactNode;
    }) => {
      const qs = new URLSearchParams(
        Object.entries(search ?? {}).map(([k, v]) => [k, String(v)]),
      ).toString();
      return (
        <a href={`${to}?${qs}`} {...rest}>
          {children}
        </a>
      );
    },
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { getWorkload: vi.fn() },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    hrApi: { listDepartments: vi.fn().mockResolvedValue([]) },
  };
});

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const counts = {
  activeCount: 4,
  overdueCount: 0,
  dueSoon7dCount: 1,
  inReviewCount: 0,
  maxOverdueDays: null as number | null,
};

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co-1" },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeamWorkloadPage />
    </QueryClientProvider>,
  );
}

const getWorkload = vi.mocked(taskCoreApi.getWorkload);
const respond = (r: TaskWorkloadResponse) => getWorkload.mockResolvedValue(r);

describe("TeamWorkloadPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCaps({ "read:task": true });
  });

  it("DENY: thiếu read:task ⇒ báo không có quyền và KHÔNG gọi API", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Bạn không có quyền xem công việc")).toBeInTheDocument();
    expect(getWorkload).not.toHaveBeenCalled();
  });

  it("giữ thứ tự của server (quá hạn giảm dần) và «Chưa giao» ghim cuối, KHÔNG có liên kết", async () => {
    respond({
      items: [
        { employeeId: ID_A, displayName: "An", ...counts, overdueCount: 3, maxOverdueDays: 5 },
        { employeeId: ID_B, displayName: "Bình", ...counts },
      ],
      unassigned: { ...counts, overdueCount: 2, maxOverdueDays: 1 },
      truncated: false,
    });
    renderPage();
    await screen.findByTestId("team-workload-table");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      `team-row-${ID_A}`,
      `team-row-${ID_B}`,
      "team-row-unassigned",
    ]);
    expect(screen.getByTestId("team-row-unassigned").querySelector("a")).toBeNull();
  });

  it("«Quá hạn: 3» dẫn tới /tasks?assignee=…&overdue=true; «Chờ duyệt» dẫn tới status=In Review", async () => {
    respond({
      items: [
        {
          employeeId: ID_A,
          displayName: "An",
          ...counts,
          overdueCount: 3,
          inReviewCount: 2,
          maxOverdueDays: 2,
        },
      ],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    const overdue = await screen.findByTestId(`team-overdue-${ID_A}`);
    expect(overdue).toHaveTextContent("Quá hạn: 3");
    expect(overdue.getAttribute("href")).toBe(`/tasks?assignee=${ID_A}&overdue=true`);
    expect(screen.getByTestId(`team-review-${ID_A}`).getAttribute("href")).toBe(
      `/tasks?assignee=${ID_A}&status=In+Review`,
    );
  });

  it("đang lọc dự án + phòng ban ⇒ liên kết mang đủ project/department", async () => {
    const PROJ = "00000000-0000-4000-8000-0000000000p1".replace("p", "1");
    const DEPT = "00000000-0000-4000-8000-0000000000d1".replace("d", "2");
    setCaps({ "read:task": true, "read:project": true, "read:department": true });
    vi.mocked(taskProjectApi.listProjects).mockResolvedValue([{ id: PROJ, name: "Dự án 1" }] as never);
    vi.mocked(hrApi.listDepartments).mockResolvedValue([{ id: DEPT, name: "Phòng 1" }] as never);
    respond({
      items: [{ employeeId: ID_A, displayName: "An", ...counts, overdueCount: 3, maxOverdueDays: 2 }],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    await screen.findByTestId(`team-overdue-${ID_A}`);
    await screen.findByRole("option", { name: "Dự án 1" });
    await screen.findByRole("option", { name: "Phòng 1" });
    fireEvent.change(screen.getByTestId("team-filter-project"), { target: { value: PROJ } });
    fireEvent.change(screen.getByTestId("team-filter-department"), { target: { value: DEPT } });
    await waitFor(() =>
      expect(getWorkload).toHaveBeenLastCalledWith({ projectId: PROJ, departmentId: DEPT }),
    );
    const link = await screen.findByTestId(`team-overdue-${ID_A}`);
    expect(link.getAttribute("href")).toBe(
      `/tasks?assignee=${ID_A}&overdue=true&project=${PROJ}&department=${DEPT}`,
    );
  });

  it("số quá hạn = 0 ⇒ không có liên kết (DENY: không dẫn tới danh sách rỗng)", async () => {
    respond({
      items: [{ employeeId: ID_B, displayName: "Bình", ...counts }],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    await screen.findByTestId("team-workload-table");
    expect(screen.queryByTestId(`team-overdue-${ID_B}`)).toBeNull();
  });

  it("displayName = null ⇒ «(Không rõ tên)»", async () => {
    respond({
      items: [{ employeeId: ID_C, displayName: null, ...counts }],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    expect(await screen.findByText("(Không rõ tên)")).toBeInTheDocument();
  });

  it("rỗng ⇒ «Đội đang không có việc mở»", async () => {
    respond({ items: [], unassigned: null, truncated: false });
    renderPage();
    expect(await screen.findByText("Đội đang không có việc mở")).toBeInTheDocument();
    expect(screen.queryByTestId("team-workload-table")).toBeNull();
  });

  it("chỉ có «Chưa giao» thì KHÔNG phải trạng thái rỗng", async () => {
    respond({ items: [], unassigned: { ...counts }, truncated: false });
    renderPage();
    expect(await screen.findByTestId("team-row-unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Đội đang không có việc mở")).toBeNull();
  });

  it("lỗi mạng ⇒ nút Thử lại gọi lại API; thành công thì không còn nút (DENY)", async () => {
    getWorkload.mockRejectedValueOnce(new Error("network"));
    respond({
      items: [{ employeeId: ID_A, displayName: "An", ...counts }],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    const retry = await screen.findByRole("button", { name: /thử lại/i });
    fireEvent.click(retry);
    await waitFor(() => expect(getWorkload).toHaveBeenCalledTimes(2));
    await screen.findByTestId("team-workload-table");
    expect(screen.queryByRole("button", { name: /thử lại/i })).toBeNull();
  });

  it("truncated ⇒ hiện nhắc lọc; không truncated ⇒ không hiện", async () => {
    respond({
      items: [{ employeeId: ID_A, displayName: "An", ...counts }],
      unassigned: null,
      truncated: true,
    });
    renderPage();
    expect(await screen.findByTestId("team-truncated")).toBeInTheDocument();
  });

  it("response có khoá lạ ⇒ vẫn render (FE parse không strict ở web-core)", async () => {
    respond({
      items: [{ employeeId: ID_A, displayName: "An", ...counts, extra: "x" } as never],
      unassigned: null,
      truncated: false,
    });
    renderPage();
    expect(await screen.findByText("An")).toBeInTheDocument();
  });
});
