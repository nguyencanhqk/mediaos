/**
 * TaskSidebarTree — S5-TASK-NAV-TREE-1 (đợt B): cây phòng ban + dự án trong sidebar TASK.
 *
 * Phủ done_when:
 *  - loading / error(+retry) / empty.
 *  - Dự án lồng đúng phòng ban theo departmentId; cây sâu 3 cấp; phòng ban 0 dự án VẪN hiện;
 *    dự án không phòng ban (null / trỏ ngoài cây) vào nhóm "Chưa phân phòng ban".
 *  - Menu ⋯: "Thêm dự án" ẨN khi thiếu create:project; có quyền → mở drawer prefill departmentId;
 *    "Xem báo cáo" deep-link /tasks/projects?departmentId=X.
 *  - Không có read:project → không render gì.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgTreeNode } from "@mediaos/web-core";
import type { TaskProjectListItemDto } from "@mediaos/contracts";
import { TaskSidebarTree } from "./TaskSidebarTree";

// ---------------------------------------------------------------------------
// Mocks (vi.mock hoisted → state mutable qua vi.hoisted)
// ---------------------------------------------------------------------------

const { allowedPairs, historyPushMock, getTreeMock, listProjectsMock } = vi.hoisted(() => ({
  allowedPairs: { current: new Set<string>() },
  historyPushMock: vi.fn(),
  getTreeMock: vi.fn(),
  listProjectsMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to, title }: { children: ReactNode; to: string; title?: string }) => (
      <a href={to} title={title}>
        {children}
      </a>
    ),
    useRouter: () => ({ history: { push: historyPushMock, replace: vi.fn() } }),
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/tasks" } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  const pairKey = (action: string, resourceType: string) => `${action}:${resourceType}`;
  return {
    ...actual,
    useCan: (action: string, resourceType: string) =>
      allowedPairs.current.has(pairKey(action, resourceType)),
    PermissionGate: ({
      action,
      resourceType,
      children,
    }: {
      action: string;
      resourceType: string;
      children: ReactNode;
    }) => (allowedPairs.current.has(pairKey(action, resourceType)) ? <>{children}</> : null),
    orgApi: { getTree: getTreeMock },
    taskProjectApi: { ...actual.taskProjectApi, listProjects: listProjectsMock },
  };
});

vi.mock("@/routes/tasks/ProjectFormDrawer", () => ({
  ProjectFormDrawer: ({
    mode,
    initialDepartmentId,
  }: {
    mode: string;
    initialDepartmentId?: string;
  }) => <div data-testid="project-form-drawer">{`${mode}:${initialDepartmentId ?? ""}`}</div>,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unit(
  id: string,
  name: string,
  children: OrgTreeNode[] = [],
  type = "department",
): OrgTreeNode {
  return {
    id,
    parentId: null,
    name,
    type,
    code: null,
    status: "active",
    headUserName: null,
    children,
  };
}

function project(
  id: string,
  name: string,
  departmentId: string | null,
  createdAt: string,
  myProjectRole: TaskProjectListItemDto["myProjectRole"] = null,
): TaskProjectListItemDto {
  return {
    id,
    companyId: "c1",
    code: null,
    name,
    ownerEmployeeId: null,
    ownerName: null,
    departmentId,
    departmentName: null,
    priority: null,
    status: "Active",
    startDate: null,
    endDate: null,
    memberCount: 0,
    myProjectRole,
    createdBy: null,
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
  };
}

// Cây 3 cấp: Phòng A > Phòng A1 > Phòng A2; Phòng B (0 dự án).
const TREE: OrgTreeNode[] = [
  unit("d-a", "Phòng A", [unit("d-a1", "Phòng A1", [unit("d-a2", "Phòng A2")])]),
  unit("d-b", "Phòng B"),
];

const PROJECTS: TaskProjectListItemDto[] = [
  project("p-a", "Dự án A", "d-a", "2026-07-01T00:00:00.000Z"),
  project("p-a1", "Dự án A1", "d-a1", "2026-07-02T00:00:00.000Z"),
  project("p-a2", "Dự án A2", "d-a2", "2026-07-03T00:00:00.000Z"),
  project("p-null", "Dự án mồ côi", null, "2026-07-04T00:00:00.000Z"),
  project("p-ghost", "Dự án phòng ma", "d-ghost", "2026-07-05T00:00:00.000Z"),
];

function renderTree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskSidebarTree />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  allowedPairs.current = new Set(["read:project"]);
  getTreeMock.mockResolvedValue(TREE);
  listProjectsMock.mockResolvedValue(PROJECTS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskSidebarTree", () => {
  it("loading: hiện skeleton khi query chưa xong", () => {
    getTreeMock.mockReturnValue(new Promise(() => {}));
    listProjectsMock.mockReturnValue(new Promise(() => {}));
    renderTree();
    expect(screen.getByLabelText("sidebarTree.loading")).toBeInTheDocument();
  });

  it("error: hiện thông báo + nút thử lại gọi refetch", async () => {
    getTreeMock.mockRejectedValue(new Error("boom"));
    renderTree();
    expect(await screen.findByRole("alert")).toHaveTextContent("sidebarTree.error");

    const before = getTreeMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /actions\.retry/ }));
    await waitFor(() => expect(getTreeMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("empty: không phòng ban + không dự án → thông báo trống", async () => {
    getTreeMock.mockResolvedValue([]);
    listProjectsMock.mockResolvedValue([]);
    renderTree();
    expect(await screen.findByText("sidebarTree.empty")).toBeInTheDocument();
  });

  it("render cây 3 cấp, dự án lồng đúng phòng ban, phòng ban 0 dự án vẫn hiện, nhóm chưa phân", async () => {
    renderTree();
    expect(await screen.findByText("Phòng A")).toBeInTheDocument();
    expect(screen.getByText("Phòng A1")).toBeInTheDocument();
    expect(screen.getByText("Phòng A2")).toBeInTheDocument();
    // Phòng ban 0 dự án VẪN hiện
    expect(screen.getByText("Phòng B")).toBeInTheDocument();
    // Dự án lồng đúng cấp
    expect(screen.getByText("Dự án A")).toBeInTheDocument();
    expect(screen.getByText("Dự án A1")).toBeInTheDocument();
    expect(screen.getByText("Dự án A2")).toBeInTheDocument();
    // Chưa phân phòng ban: departmentId null + trỏ ngoài cây
    expect(screen.getByText("sidebarTree.unassigned")).toBeInTheDocument();
    expect(screen.getByText("Dự án mồ côi")).toBeInTheDocument();
    expect(screen.getByText("Dự án phòng ma")).toBeInTheDocument();
  });

  it("gập phòng ban → dự án + phòng ban con biến mất (giữ node cha)", async () => {
    renderTree();
    await screen.findByText("Phòng A");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.collapse:Phòng A" }));
    expect(screen.queryByText("Dự án A")).not.toBeInTheDocument();
    expect(screen.queryByText("Phòng A1")).not.toBeInTheDocument();
    expect(screen.getByText("Phòng A")).toBeInTheDocument();
  });

  it("menu ⋯: 'Thêm dự án' ẨN khi thiếu create:project", async () => {
    renderTree();
    await screen.findByText("Phòng B");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.menuLabel:Phòng B" }));
    expect(screen.getByRole("menuitem", { name: /sidebarTree\.menu\.report/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /sidebarTree\.menu\.addProject/ }),
    ).not.toBeInTheDocument();
  });

  it("menu ⋯: có create:project → 'Thêm dự án' mở drawer prefill departmentId", async () => {
    allowedPairs.current = new Set(["read:project", "create:project"]);
    renderTree();
    await screen.findByText("Phòng B");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.menuLabel:Phòng B" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sidebarTree\.menu\.addProject/ }));
    expect(screen.getByTestId("project-form-drawer")).toHaveTextContent("create:d-b");
  });

  it("menu ⋯: 'Xem báo cáo' deep-link /tasks/projects?departmentId=X", async () => {
    renderTree();
    await screen.findByText("Phòng B");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.menuLabel:Phòng B" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sidebarTree\.menu\.report/ }));
    expect(historyPushMock).toHaveBeenCalledWith("/tasks/projects?departmentId=d-b");
  });

  // ── S5-TASK-PROJROLE-1 (đợt C) — menu ⋯ node DỰ ÁN: "Cài đặt quyền" (HIỆN khi manage-member:project
  // HOẶC myProjectRole==='Owner'; ẨN cả nút ⋯ nếu thiếu cả hai — UI-02 §5.3) ─────────────────────
  it("menu ⋯ node dự án ẨN khi thiếu manage-member:project và myProjectRole không phải Owner", async () => {
    renderTree();
    await screen.findByText("Dự án A");
    expect(
      screen.queryByRole("button", { name: "sidebarTree.projectMenuLabel:Dự án A" }),
    ).not.toBeInTheDocument();
  });

  it("menu ⋯ node dự án HIỆN khi có manage-member:project → 'Cài đặt quyền' điều hướng ?tab=members", async () => {
    allowedPairs.current = new Set(["read:project", "manage-member:project"]);
    renderTree();
    await screen.findByText("Dự án A");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.projectMenuLabel:Dự án A" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /sidebarTree\.projectMenu\.permissionSettings/ }),
    );
    expect(historyPushMock).toHaveBeenCalledWith("/tasks/projects/p-a?tab=members");
  });

  it("menu ⋯ node dự án HIỆN khi myProjectRole==='Owner' dù thiếu manage-member:project", async () => {
    listProjectsMock.mockResolvedValue([
      project("p-a", "Dự án A", "d-a", "2026-07-01T00:00:00.000Z", "Owner"),
    ]);
    renderTree();
    await screen.findByText("Dự án A");
    fireEvent.click(screen.getByRole("button", { name: "sidebarTree.projectMenuLabel:Dự án A" }));
    expect(
      screen.getByRole("menuitem", { name: /sidebarTree\.projectMenu\.permissionSettings/ }),
    ).toBeInTheDocument();
  });

  it("menu ⋯ node dự án ẨN khi myProjectRole='Manager' (không phải Owner) và thiếu pair", async () => {
    listProjectsMock.mockResolvedValue([
      project("p-a", "Dự án A", "d-a", "2026-07-01T00:00:00.000Z", "Manager"),
    ]);
    renderTree();
    await screen.findByText("Dự án A");
    expect(
      screen.queryByRole("button", { name: "sidebarTree.projectMenuLabel:Dự án A" }),
    ).not.toBeInTheDocument();
  });

  it("không có read:project → không render gì, không gọi API", () => {
    allowedPairs.current = new Set();
    const { container } = renderTree();
    expect(container.textContent).toBe("");
    expect(getTreeMock).not.toHaveBeenCalled();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it("node KHÔNG phải department (team) bị bỏ, con department được kéo lên; dự án của team vào 'Chưa phân'", async () => {
    getTreeMock.mockResolvedValue([
      unit("t-1", "Team Video", [unit("d-in-team", "Phòng trong team")], "team"),
      unit("d-b", "Phòng B"),
    ]);
    listProjectsMock.mockResolvedValue([
      project("p-team", "Dự án của team", "t-1", "2026-07-01T00:00:00.000Z"),
      project("p-promoted", "Dự án phòng trong team", "d-in-team", "2026-07-02T00:00:00.000Z"),
    ]);
    renderTree();
    // Team không render; department con được kéo lên cấp gốc
    expect(await screen.findByText("Phòng trong team")).toBeInTheDocument();
    expect(screen.queryByText("Team Video")).not.toBeInTheDocument();
    // Dự án của department kéo-lên vẫn lồng đúng; dự án trỏ team rơi vào nhóm chưa phân
    expect(screen.getByText("Dự án phòng trong team")).toBeInTheDocument();
    expect(screen.getByText("sidebarTree.unassigned")).toBeInTheDocument();
    expect(screen.getByText("Dự án của team")).toBeInTheDocument();
  });
});
