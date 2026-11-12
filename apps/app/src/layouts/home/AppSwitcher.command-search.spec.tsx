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
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
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
    type("a");
    type("an");
    await screen.findByText("Nguyễn An");
    fireEvent.click(screen.getByText("Nguyễn An"));
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

  it("mũi tên + Enter mở drawer việc; click mở hồ sơ người", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    const input = screen.getByRole("combobox");
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

  it("ArrowUp từ trạng thái đầu chọn mục CUỐI; ArrowDown ở cuối quay về đầu", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    const input = screen.getByRole("combobox");
    type("an");
    await screen.findByText("Nguyễn An");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(`cmdk-people-${EMP_ID}`);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(`cmdk-tasks-${TASK_ID}`);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(`cmdk-people-${EMP_ID}`);
  });

  it("combobox ARIA: aria-controls/expanded/autocomplete, aria-activedescendant khớp option, listbox chỉ chứa group", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    type("an");
    await screen.findByText("Nguyễn An");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant") ?? "";
    expect(document.getElementById(activeId)?.getAttribute("role")).toBe("option");
    expect(document.getElementById(activeId)?.getAttribute("aria-selected")).toBe("true");
    for (const group of listbox.querySelectorAll(":scope > * > [role=group]")) {
      expect(group.getAttribute("aria-labelledby")).toBeTruthy();
    }
    const bad = Array.from(listbox.querySelectorAll("h3, p, button, section"));
    expect(bad).toHaveLength(0);
  });

  it("vùng trạng thái polite báo số kết quả", async () => {
    setCaps(ALL_CAPS);
    renderOpen();
    type("an");
    await screen.findByText("Nguyễn An");
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("3 kết quả");
  });

  it("không có quyền đọc nào + từ khoá không khớp ứng dụng ⇒ hiện «Không tìm thấy», không để trống", async () => {
    setCaps({ "DASH.DASHBOARD.VIEW": true });
    renderOpen();
    type("zzzzqq");
    await wait(450);
    expect(screen.getByText("Không tìm thấy “zzzzqq”")).toBeInTheDocument();
    expect(listTasksMock).not.toHaveBeenCalled();
  });

  it("Enter trên người mở hồ sơ (bàn phím, không chỉ chuột)", async () => {
    setCaps({ "read:employee": true, "DASH.DASHBOARD.VIEW": true });
    renderOpen();
    const input = screen.getByRole("combobox");
    type("an");
    await screen.findByText("Nguyễn An");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateMock).toHaveBeenCalledWith({ to: `/hr/employees/${EMP_ID}` });
  });

  it("phản hồi về lệch thứ tự: «ab» chậm về sau «abc» không đè kết quả", async () => {
    setCaps({ "read:task": true, "DASH.DASHBOARD.VIEW": true });
    let resolveAb: (v: unknown) => void = () => undefined;
    listTasksMock.mockImplementation(({ search }: { search: string }) =>
      search === "ab"
        ? new Promise((r) => {
            resolveAb = r;
          })
        : Promise.resolve([{ id: TASK_ID, title: "Kết quả abc", projectName: null, status: "todo" }]),
    );
    renderOpen();
    type("ab");
    await wait(300);
    type("abc");
    expect(await screen.findByText("Kết quả abc")).toBeInTheDocument();
    await act(async () => {
      resolveAb([{ id: EMP_ID, title: "Kết quả ab muộn", projectName: null, status: "todo" }]);
    });
    expect(screen.getByText("Kết quả abc")).toBeInTheDocument();
    expect(screen.queryByText("Kết quả ab muộn")).not.toBeInTheDocument();
  });

  it("bấm gợi ý «Mở danh sách việc» ⇒ điều hướng /tasks kèm search", async () => {
    setCaps(ALL_CAPS);
    listTasksMock.mockResolvedValue([]);
    listProjectsMock.mockResolvedValue([]);
    listEmployeesMock.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 5, total: 0 } });
    renderOpen();
    type("zzzz");
    fireEvent.click(await screen.findByText("Mở danh sách việc để tìm tiếp"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]?.[0]).toMatchObject({ search: { search: "zzzz" } });
  });

  it("form dirty: chọn dự án / người phải xác nhận trước khi rời", async () => {
    setCaps(ALL_CAPS);
    useLayoutStore.setState({ dirtyFormState: { message: "Chưa lưu" } as never });
    renderOpen();
    type("an");
    fireEvent.click(await screen.findByText("Dự án Alpha"));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("Chưa lưu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển ứng dụng" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: `/tasks/projects/${PROJECT_ID}` });

    navigateMock.mockClear();
    act(() => useLayoutStore.getState().openAppSwitcher());
    type("an");
    fireEvent.click(await screen.findByText("Nguyễn An"));
    expect(navigateMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển ứng dụng" }));
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
