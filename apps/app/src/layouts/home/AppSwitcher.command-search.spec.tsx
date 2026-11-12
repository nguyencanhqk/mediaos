/**
 * S20-FE-CMDKSEARCH-1 — bảng lệnh Ctrl+K: tìm việc / dự án / đồng nghiệp theo đúng quyền.
 * Deny-path trước: thiếu quyền ⇒ không có nhóm và KHÔNG có request; dưới 2 ký tự ⇒ 0 request.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, listTasksMock, listProjectsMock, listEmployeesMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  listTasksMock: vi.fn(),
  listProjectsMock: vi.fn(),
  listEmployeesMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/home" } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { ...actual.taskCoreApi, listTasks: listTasksMock },
    taskProjectApi: { ...actual.taskProjectApi, listProjects: listProjectsMock },
    hrApi: { ...actual.hrApi, listEmployees: listEmployeesMock },
  };
});

import { useAuthStore } from "@mediaos/web-core";
import { AppSwitcher } from "./AppSwitcher";
import { useLayoutStore } from "@/stores/layout.store";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const EMP_ID = "33333333-3333-4333-8333-333333333333";

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", email: "t@co.com", fullName: "T", companyId: "c1", status: "Active" },
    username: "T",
    accessToken: "tok",
    refreshToken: null,
    capabilities: caps,
    mustSetupTwoFactor: false,
  });
}

function renderOpen() {
  act(() => useLayoutStore.getState().openAppSwitcher());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppSwitcher />
    </QueryClientProvider>,
  );
}

const ALL_CAPS = {
  "read:task": true,
  "read:project": true,
  "read:employee": true,
  "DASH.DASHBOARD.VIEW": true,
};

function type(value: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
}
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

beforeEach(() => {
  listTasksMock.mockResolvedValue([
    { id: TASK_ID, title: "Soạn báo cáo quý", projectName: "Dự án A", status: "todo" },
  ]);
  listProjectsMock.mockResolvedValue([{ id: PROJECT_ID, name: "Dự án Alpha", status: "active" }]);
  listEmployeesMock.mockResolvedValue({
    items: [
      {
        id: EMP_ID,
        fullName: "Nguyễn An",
        orgUnitName: "Phòng Kinh doanh",
        avatarUrl: null,
        email: "an@co.com",
        baseSalary: 99999,
        phone: "0900000000",
      },
    ],
    meta: { page: 1, pageSize: 5, total: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState({ isAppSwitcherOpen: false, dirtyFormState: null });
});

describe("AppSwitcher — bảng lệnh tìm kiếm", () => {
  it("dưới 2 ký tự ⇒ không gọi API nào", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    type("a");
    await wait(450);
    expect(listTasksMock).not.toHaveBeenCalled();
    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(listEmployeesMock).not.toHaveBeenCalled();
  });

  it("thiếu quyền đọc hồ sơ nhân viên ⇒ không có nhóm Đồng nghiệp và KHÔNG request tới HR", async () => {
    setCaps({ ...ALL_CAPS, "read:employee": false });
    renderOpen();
    type("an");
    expect(await screen.findByText("Soạn báo cáo quý")).toBeInTheDocument();
    expect(await screen.findByText("Dự án Alpha")).toBeInTheDocument();
    expect(listEmployeesMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Đồng nghiệp")).not.toBeInTheDocument();
    expect(screen.queryByText("Nguyễn An")).not.toBeInTheDocument();
  });

  it("không có quyền việc/dự án ⇒ không gọi endpoint tương ứng", async () => {
    setCaps({ "read:employee": true, "DASH.DASHBOARD.VIEW": true });
    renderOpen();
    type("an");
    expect(await screen.findByText("Nguyễn An")).toBeInTheDocument();
    expect(listTasksMock).not.toHaveBeenCalled();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it("debounce 250ms: gõ nhanh chỉ gọi một lần, tối đa 5 kết quả/nhóm", async () => {
    setCaps(ALL_CAPS);
    listTasksMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: `11111111-1111-4111-8111-11111111111${i}`,
        title: `Việc số ${i}`,
        projectName: null,
        status: "todo",
      })),
    );
    renderOpen();
    type("ba");
    type("bao");
    type("bao c");
    await screen.findByText("Việc số 0");
    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksMock.mock.calls[0]?.[0]).toMatchObject({ search: "bao c" });
    expect(screen.queryByText("Việc số 5")).not.toBeInTheDocument();
    expect(screen.getByText("Việc số 4")).toBeInTheDocument();
  });

  it("nhóm Đồng nghiệp chỉ render tên/phòng ban, không lộ trường khác", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    type("an");
    expect(await screen.findByText("Nguyễn An")).toBeInTheDocument();
    expect(screen.getByText("Phòng Kinh doanh")).toBeInTheDocument();
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toContain("an@co.com");
    expect(text).not.toContain("99999");
    expect(text).not.toContain("0900000000");
  });

  it("không lưu truy vấn/kết quả vào storage", async () => {
    setCaps(ALL_CAPS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderOpen();
    type("an");
    await screen.findByText("Nguyễn An");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("một endpoint lỗi ⇒ nhóm đó «Không tải được», nhóm khác vẫn hiện", async () => {
    setCaps(ALL_CAPS);
    listProjectsMock.mockRejectedValue(new Error("boom"));
    renderOpen();
    type("an");
    expect(await screen.findByText("Không tải được")).toBeInTheDocument();
    expect(await screen.findByText("Soạn báo cáo quý")).toBeInTheDocument();
    expect(await screen.findByText("Nguyễn An")).toBeInTheDocument();
  });

  it("không có kết quả ⇒ «Không tìm thấy “…”» kèm gợi ý trang tìm", async () => {
    setCaps(ALL_CAPS);
    listTasksMock.mockResolvedValue([]);
    listProjectsMock.mockResolvedValue([]);
    listEmployeesMock.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 5, total: 0 } });
    renderOpen();
    type("zzzz");
    expect(await screen.findByText("Không tìm thấy “zzzz”")).toBeInTheDocument();
    expect(screen.getByText("Mở danh sách việc để tìm tiếp")).toBeInTheDocument();
  });

  it("mũi tên + Enter: việc mở drawer ?task=, người mở hồ sơ", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    const input = screen.getByRole("searchbox");
    type("an");
    await screen.findByText("Nguyễn An");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const arg = navigateMock.mock.calls[0]?.[0] as { to: string; search: (p: object) => unknown };
    expect(arg.to).toBe(".");
    expect(arg.search({})).toMatchObject({ task: TASK_ID });

    navigateMock.mockClear();
    act(() => useLayoutStore.getState().openAppSwitcher());
    type("an");
    await screen.findByText("Nguyễn An");
    fireEvent.click(screen.getByText("Nguyễn An"));
    expect(navigateMock).toHaveBeenCalledWith({ to: `/hr/employees/${EMP_ID}` });
  });

  it("Ctrl+K khi focus ở ô soạn chat không bị chặn (CHAT-DEC-027)", () => {
    setCaps(ALL_CAPS);
    const host = document.createElement("div");
    host.setAttribute("data-testid", "chat-composer");
    const ta = document.createElement("textarea");
    host.appendChild(ta);
    document.body.appendChild(host);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppSwitcher />
      </QueryClientProvider>,
    );
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(useLayoutStore.getState().isAppSwitcherOpen).toBe(false);
    const ev2 = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => void document.body.dispatchEvent(ev2));
    expect(useLayoutStore.getState().isAppSwitcherOpen).toBe(true);
    host.remove();
  });
});
