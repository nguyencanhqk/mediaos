import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  addDaysToLocalDate,
  ApiError,
  companyTimeZone,
  deadlineAt,
  hrApi,
  taskCoreApi,
  taskKeys,
  todayLocal,
  useAuthStore,
} from "@mediaos/web-core";
import type { MyTaskItemDto } from "@mediaos/contracts";
import { nextWorkingDay } from "../tasks/deadline-presets";
import { LeaveTaskHandoff } from "./LeaveTaskHandoff";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { getMyTasks: vi.fn(), changeDeadline: vi.fn(), assign: vi.fn() },
    hrApi: { listEmployees: vi.fn() },
  };
});

const TZ = companyTimeZone();
const TODAY = todayLocal(new Date(), TZ);
const END = addDaysToLocalDate(TODAY, 4);
const REQUEST = { status: "Approved", startDate: TODAY, endDate: END };
const dueOn = (offset: number) =>
  deadlineAt(addDaysToLocalDate(TODAY, offset), "17:00", TZ).toISOString();

function item(id: string, offset: number, over: Partial<MyTaskItemDto> = {}): MyTaskItemDto {
  return {
    id,
    companyId: "co-001",
    title: `Việc ${id}`,
    description: null,
    taskType: "office",
    status: "In Progress",
    priority: "High",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: "emp-me",
    assigneeName: "Tôi",
    creatorUserId: "u2",
    creatorName: "Người giao",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: dueOn(offset),
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u2",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: "assigned",
    ...over,
  } as MyTaskItemDto;
}

function caps(c: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: c,
    user: { id: "u1", email: "a@b.local", fullName: "T", status: "Active", companyId: "co-001" },
  });
}

function renderBlock(request = REQUEST) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <LeaveTaskHandoff request={request} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe("LeaveTaskHandoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.mocked(hrApi.listEmployees).mockResolvedValue({ items: [] } as never);
  });

  it("hiện đúng việc trong kỳ nghỉ: 2 việc, loại việc Done và việc ngoài kỳ", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([
      item("a", 1),
      item("b", 3),
      item("far", 10),
      item("done", 2, { status: "Done" }),
    ]);
    renderBlock();
    expect(await screen.findByText(/Việc đến hạn trong kỳ nghỉ \(2\)/)).toBeInTheDocument();
    expect(screen.getByTestId("leave-handoff-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("leave-handoff-row-b")).toBeInTheDocument();
    expect(screen.queryByTestId("leave-handoff-row-far")).not.toBeInTheDocument();
    expect(screen.queryByTestId("leave-handoff-row-done")).not.toBeInTheDocument();
  });

  it("dòng rời danh sách khi đang giữ focus ⇒ focus về tiêu đề khối, vùng status báo số mới", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1), item("b", 3)]);
    const { client } = renderBlock();
    const open = await screen.findByTestId("leave-handoff-open-a");
    open.focus();
    expect(open).toHaveFocus();
    expect(screen.getByTestId("leave-handoff-status")).toHaveTextContent(
      "Còn 2 việc đến hạn trong kỳ nghỉ",
    );
    // Dời hạn «Sau kỳ nghỉ» ⇒ optimistic patch đưa việc a ra khỏi kỳ ⇒ dòng a unmount.
    act(() => {
      client.setQueryData(taskKeys.my(), [item("b", 3)]);
    });
    await waitFor(() => expect(screen.queryByTestId("leave-handoff-row-a")).not.toBeInTheDocument());
    expect(screen.getByTestId("leave-handoff-title")).toHaveFocus();
    expect(screen.getByTestId("leave-handoff-status")).toHaveTextContent(
      "Còn 1 việc đến hạn trong kỳ nghỉ",
    );
  });

  it("dòng rời danh sách khi focus đang ở chỗ khác thì KHÔNG cướp focus", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1), item("b", 3)]);
    const { client } = renderBlock();
    const other = await screen.findByTestId("leave-handoff-open-b");
    other.focus();
    act(() => {
      client.setQueryData(taskKeys.my(), [item("b", 3)]);
    });
    await waitFor(() => expect(screen.queryByTestId("leave-handoff-row-a")).not.toBeInTheDocument());
    expect(other).toHaveFocus();
  });

  it("deny: thiếu read:task thì không có khối và KHÔNG gọi /tasks/my", () => {
    caps({});
    renderBlock();
    expect(screen.queryByTestId("leave-task-handoff")).not.toBeInTheDocument();
    expect(taskCoreApi.getMyTasks).not.toHaveBeenCalled();
  });

  it.each(["Draft", "Rejected", "Cancelled"])(
    "đơn %s thì không có khối, không gọi API",
    (status) => {
      caps({ "read:task": true });
      renderBlock({ ...REQUEST, status });
      expect(screen.queryByTestId("leave-task-handoff")).not.toBeInTheDocument();
      expect(taskCoreApi.getMyTasks).not.toHaveBeenCalled();
    },
  );

  it("kỳ nghỉ đã qua thì không có khối", () => {
    caps({ "read:task": true });
    renderBlock({
      status: "Approved",
      startDate: addDaysToLocalDate(TODAY, -5),
      endDate: addDaysToLocalDate(TODAY, -1),
    });
    expect(screen.queryByTestId("leave-task-handoff")).not.toBeInTheDocument();
    expect(taskCoreApi.getMyTasks).not.toHaveBeenCalled();
  });

  it("không có việc thì hiện câu trống riêng", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("far", 10)]);
    renderBlock();
    expect(
      await screen.findByText("Không có việc nào của bạn đến hạn trong kỳ nghỉ"),
    ).toBeInTheDocument();
  });

  it("/tasks/my lỗi thì khối báo lỗi và Thử lại gọi lại", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockRejectedValueOnce(new Error("boom"));
    renderBlock();
    expect(await screen.findByText("Không tải được danh sách việc của bạn.")).toBeInTheDocument();
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    expect(await screen.findByTestId("leave-handoff-row-a")).toBeInTheDocument();
  });

  it("tiêu đề mở drawer ?task=; Báo người giao mở tab bình luận (cần comment:task)", async () => {
    caps({ "read:task": true, "comment:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    renderBlock();
    fireEvent.click(await screen.findByTestId("leave-handoff-open-a"));
    const open = navigateMock.mock.calls[0]?.[0] as { search: (p: object) => object };
    expect(open.search({})).toEqual({ task: "a" });
    fireEvent.click(screen.getByTestId("leave-handoff-notify-a"));
    const notify = navigateMock.mock.calls[1]?.[0] as { search: (p: object) => object };
    expect(notify.search({})).toEqual({ task: "a", taskTab: "comment" });
  });

  it("deny: thiếu comment:task thì không có nút Báo người giao", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    renderBlock();
    await screen.findByTestId("leave-handoff-row-a");
    expect(screen.queryByTestId("leave-handoff-notify-a")).not.toBeInTheDocument();
  });

  it("chip Sau kỳ nghỉ dời hạn sang ngày làm việc kế tiếp 17:00, chỉ khi người dùng bấm", async () => {
    caps({ "read:task": true, "update-deadline:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    vi.mocked(taskCoreApi.changeDeadline).mockResolvedValue({ task: item("a", 5) } as never);
    renderBlock();
    await screen.findByTestId("leave-handoff-row-a");
    expect(taskCoreApi.changeDeadline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("task-row-deadline-a"));
    fireEvent.click(screen.getByTestId("task-row-deadline-a-preset-afterLeave"));
    const expected = deadlineAt(nextWorkingDay(END), "17:00", TZ).toISOString();
    await waitFor(() =>
      expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("a", { dueAt: expected }),
    );
    expect(taskCoreApi.assign).not.toHaveBeenCalled();
  });

  it("deny: thiếu update-deadline:task thì không có popover dời hạn", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    renderBlock();
    await screen.findByTestId("leave-handoff-row-a");
    expect(screen.queryByTestId("task-row-deadline-a")).not.toBeInTheDocument();
  });

  it("server từ chối dời hạn (403) thì hiện lý do", async () => {
    caps({ "read:task": true, "update-deadline:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
      new ApiError({ status: 403, code: "AUTH-ERR-403", message: "Forbidden" }),
    );
    renderBlock();
    await screen.findByTestId("leave-handoff-row-a");
    fireEvent.click(screen.getByTestId("task-row-deadline-a"));
    fireEvent.click(screen.getByTestId("task-row-deadline-a-preset-afterLeave"));
    expect(await screen.findByText("Bạn không có quyền đổi hạn việc này")).toBeInTheDocument();
  });

  it("Đổi người chỉ khi có assign:task", async () => {
    caps({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
    const first = renderBlock();
    await screen.findByTestId("leave-handoff-row-a");
    expect(screen.queryByTestId("task-row-assignee-a")).not.toBeInTheDocument();
    first.unmount();
    caps({ "read:task": true, "assign:task": true });
    renderBlock();
    expect(await screen.findByTestId("task-row-assignee-a")).toBeInTheDocument();
  });

  describe("lỗi server hiện ở mức KHỐI (dòng có thể đã rời danh sách khi vá lạc quan)", () => {
    const afterLeave = async () => {
      await screen.findByTestId("leave-handoff-row-a");
      fireEvent.click(screen.getByTestId("task-row-deadline-a"));
      fireEvent.click(screen.getByTestId("task-row-deadline-a-preset-afterLeave"));
    };
    const arrange = (reject: () => Promise<never>) => {
      caps({ "read:task": true, "update-deadline:task": true });
      vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
      vi.mocked(taskCoreApi.changeDeadline).mockImplementation(reject);
    };
    const forbidden = () =>
      Promise.reject(
        new ApiError({
          status: 403,
          code: "AUTH-ERR-403",
          message: "Bạn không có quyền đổi hạn việc này",
        }),
      );
    const delayed = (make: () => Promise<never>) => () =>
      new Promise<never>((_, reject) => setTimeout(() => make().catch(reject), 60));

    it("403 tức thì: lý do ở khối, role=alert, dòng quay lại", async () => {
      arrange(forbidden);
      renderBlock();
      await afterLeave();
      const alert = await screen.findByTestId("leave-handoff-failure");
      expect(alert).toHaveAttribute("role", "alert");
      expect(alert).toHaveTextContent(/không có quyền/i);
      expect(await screen.findByTestId("leave-handoff-row-a")).toBeInTheDocument();
    });

    it("403 trễ: dòng đã bị gỡ lạc quan vẫn để lại lý do ở khối", async () => {
      arrange(delayed(forbidden));
      renderBlock();
      await afterLeave();
      await waitFor(() =>
        expect(screen.queryByTestId("leave-handoff-row-a")).not.toBeInTheDocument(),
      );
      expect(await screen.findByText(/không có quyền/i)).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });

    it("lỗi mạng (không message): chuỗi chung, tức thì và trễ", async () => {
      const network = () => Promise.reject(new TypeError("Failed to fetch"));
      arrange(network);
      const first = renderBlock();
      await afterLeave();
      const instant = await screen.findByTestId("leave-handoff-failure");
      expect(instant.textContent ?? "").not.toBe("");
      expect(instant).not.toHaveTextContent(/không có quyền/i);
      first.unmount();

      arrange(delayed(network));
      renderBlock();
      await afterLeave();
      expect((await screen.findByTestId("leave-handoff-failure")).textContent ?? "").not.toBe("");
    });

    it("lý do giữ tới khi người dùng thao tác tiếp", async () => {
      arrange(forbidden);
      renderBlock();
      await afterLeave();
      await screen.findByTestId("leave-handoff-failure");
      fireEvent.click(screen.getByTestId("leave-handoff-open-a"));
      expect(screen.queryByTestId("leave-handoff-failure")).not.toBeInTheDocument();
    });

    it("đổi người bị 403: lý do ở khối, không lặp ở dòng", async () => {
      caps({ "read:task": true, "assign:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([item("a", 1)]);
      vi.mocked(hrApi.listEmployees).mockResolvedValue({
        items: [{ id: "emp-002", fullName: "Trần Thị B" }],
        meta: {},
      } as never);
      vi.mocked(taskCoreApi.assign).mockRejectedValue(
        new ApiError({ status: 403, code: "AUTH-ERR-403", message: "Forbidden" }),
      );
      renderBlock();
      await screen.findByTestId("leave-handoff-row-a");
      fireEvent.click(screen.getByTestId("task-row-assignee-a"));
      const panel = await screen.findByRole("dialog");
      fireEvent.click(await within(panel).findByText("Trần Thị B"));
      expect(await screen.findByTestId("leave-handoff-failure")).toHaveTextContent(
        /không có quyền đổi người/i,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });
  });
});
