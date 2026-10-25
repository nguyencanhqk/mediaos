import React from "react";
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
  todayLocal,
  useAuthStore,
} from "@mediaos/web-core";
import { OverdueTasksPage } from "./OverdueTasksPage";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks — useNavigate (mở drawer `?task=`) + taskCoreApi + danh sách người cho picker.
// ---------------------------------------------------------------------------
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      listTasks: vi.fn(),
      changeStatus: vi.fn(),
      changeDeadline: vi.fn(),
      assign: vi.fn(),
      updateTask: vi.fn(),
    },
    hrApi: { listEmployees: vi.fn() },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeTask(
  id: string,
  title: string,
  dueAt: string,
  overrides: Partial<TaskCoreResponseDto> = {},
): TaskCoreResponseDto {
  return {
    id,
    companyId: "co-001",
    title,
    description: null,
    taskType: "office",
    status: "In Progress",
    priority: "High",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt,
    startAt: null,
    completedAt: null,
    isOverdue: true,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OverdueTasksPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  it("renders forbidden state and does NOT fetch when user lacks read:task", () => {
    setCapabilities({});
    renderWithQuery(<OverdueTasksPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.listTasks).not.toHaveBeenCalled();
  });

  it("fetches with overdue=true pinned filter", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() => expect(taskCoreApi.listTasks).toHaveBeenCalled());
    expect(taskCoreApi.listTasks).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }));
  });

  it("sorts rows by due_at ASC (most urgent first) + shows total count", async () => {
    setCapabilities({ "read:task": true });
    // Trả về SAI thứ tự (muộn trước) — component phải sort tăng dần.
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([
      makeTask("t-late", "Task muộn hơn", "2026-09-01T00:00:00.000Z"),
      makeTask("t-early", "Task gấp hơn", "2026-08-01T00:00:00.000Z"),
    ]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() => expect(screen.getByText("Task gấp hơn")).toBeInTheDocument());

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Task gấp hơn")).toBeLessThan(body.indexOf("Task muộn hơn"));
    expect(screen.getByText(/2 công việc quá hạn/i)).toBeInTheDocument();
  });

  it("shows empty state when there are no overdue tasks", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() =>
      expect(screen.getByText(/không có công việc quá hạn/i)).toBeInTheDocument(),
    );
  });

  it("shows error state when the fetch fails", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách task quá hạn/i)).toBeInTheDocument(),
    );
  });

  // S20-TASK-QUICKEDIT-1 — cột Trạng thái + Hạn sửa được tại chỗ khi có cặp quyền, tĩnh khi không.
  describe("sửa nhanh trên dòng", () => {
    const ROW = makeTask("t-1", "Task gấp", "2026-08-01T00:00:00.000Z");

    it("thiếu update-status / update-deadline ⇒ badge và hạn tĩnh, không nút", async () => {
      setCapabilities({ "read:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([ROW]);
      renderWithQuery(<OverdueTasksPage />);
      await waitFor(() => expect(screen.getByText("Task gấp")).toBeInTheDocument());
      expect(screen.queryByTestId("task-row-status-t-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("task-row-deadline-t-1")).not.toBeInTheDocument();
    });

    it("có cặp ⇒ «Xoá hạn» gọi change-deadline null; đổi trạng thái gọi change-status", async () => {
      setCapabilities({
        "read:task": true,
        "update-status:task": true,
        "update-deadline:task": true,
      });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([ROW]);
      vi.mocked(taskCoreApi.changeDeadline).mockReturnValue(new Promise(() => {}));
      vi.mocked(taskCoreApi.changeStatus).mockReturnValue(new Promise(() => {}));
      renderWithQuery(<OverdueTasksPage />);
      await waitFor(() => expect(screen.getByText("Task gấp")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("task-row-deadline-t-1"));
      fireEvent.click(screen.getByTestId("task-row-deadline-t-1-clear"));
      await waitFor(() =>
        expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("t-1", { dueAt: null }),
      );

      fireEvent.click(screen.getByTestId("task-row-status-t-1"));
      fireEvent.click(screen.getByRole("option", { name: "Chờ review" }));
      await waitFor(() =>
        expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("t-1", { status: "In Review" }),
      );
    });
  });
  // S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — bàn xử lý: cột «Trễ», dời hạn / đổi người trên dòng, lọc.
  describe("bàn xử lý việc quá hạn", () => {
    const DAY_MS = 86_400_000;
    const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();
    const EMPLOYEES = {
      items: [
        { id: "emp-001", fullName: "Nguyễn Văn A" },
        { id: "emp-002", fullName: "Trần Thị B" },
      ],
      meta: {},
    };
    const assigned = (overrides: Partial<TaskCoreResponseDto> = {}) =>
      makeTask("t-1", "Task gấp", daysAgo(3), {
        mainAssigneeEmployeeId: "emp-001",
        assigneeName: "Nguyễn Văn A",
        ...overrides,
      });
    /** +1 ngày = NGÀY MAI 17:00 giờ công ty, tính độc lập bằng helper US-X-92. */
    const plusOneDay = () => {
      const tz = companyTimeZone();
      return deadlineAt(
        addDaysToLocalDate(todayLocal(new Date(), tz), 1),
        "17:00",
        tz,
      ).toISOString();
    };
    const lateCell = (id: string) => screen.getByTestId(`overdue-late-${id}`);

    it("cột «Trễ»: hạn cách 5 ngày ⇒ «5 ngày», việc trễ lâu nhất đứng đầu", async () => {
      setCapabilities({ "read:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([
        makeTask("t-2", "Trễ hai ngày", daysAgo(2)),
        makeTask("t-5", "Trễ năm ngày", daysAgo(5)),
      ]);
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Trễ năm ngày");

      expect(screen.getByRole("columnheader", { name: "Trễ" })).toBeInTheDocument();
      expect(lateCell("t-5")).toHaveTextContent("5 ngày");
      expect(lateCell("t-2")).toHaveTextContent("2 ngày");
      const body = document.body.textContent ?? "";
      expect(body.indexOf("Trễ năm ngày")).toBeLessThan(body.indexOf("Trễ hai ngày"));
    });

    it("bấm tiêu đề ⇒ mở drawer `?task=` tại chỗ", async () => {
      setCapabilities({ "read:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      renderWithQuery(<OverdueTasksPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Task gấp" }));

      const nav = navigateMock.mock.calls.at(-1)?.[0] as {
        search: (prev: Record<string, unknown>) => Record<string, unknown>;
      };
      expect(nav.search({})).toEqual({ task: "t-1" });
    });

    it("«+1 ngày» trả 200 ⇒ change-deadline đúng mốc; dòng rời danh sách SAU khi server xác nhận", async () => {
      setCapabilities({ "read:task": true, "update-deadline:task": true });
      const row = assigned();
      // Refetch sau khi lưu không bao giờ về ⇒ dòng chỉ rời nhờ chính phản hồi của server.
      vi.mocked(taskCoreApi.listTasks)
        .mockResolvedValueOnce([row])
        .mockReturnValue(new Promise(() => {}));
      let confirm: (value: unknown) => void = () => {};
      vi.mocked(taskCoreApi.changeDeadline).mockReturnValue(
        new Promise((resolve) => {
          confirm = resolve;
        }) as never,
      );
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-deadline-t-1"));
      fireEvent.click(screen.getByTestId("task-row-deadline-t-1-preset-plus1d"));
      const dueAt = plusOneDay();
      await waitFor(() =>
        expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("t-1", { dueAt }),
      );
      expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
      // Server chưa xác nhận ⇒ dòng vẫn ở lại.
      expect(screen.getByText("Task gấp")).toBeInTheDocument();

      await act(async () => {
        confirm({ task: { ...row, dueAt, isOverdue: false }, warnings: [] });
      });
      await waitFor(() => expect(screen.queryByText("Task gấp")).not.toBeInTheDocument());
    });

    it("mốc của trang: +1 ngày · +3 ngày · Thứ Sáu · Tuỳ chỉnh (chọn ngày)", async () => {
      setCapabilities({ "read:task": true, "update-deadline:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-deadline-t-1"));
      const group = screen.getByRole("group", { name: "Mốc hạn nhanh" });
      expect(within(group).getByTestId("task-row-deadline-t-1-preset-plus1d")).toHaveTextContent(
        "+1 ngày",
      );
      expect(within(group).getByTestId("task-row-deadline-t-1-preset-plus3d")).toHaveTextContent(
        "+3 ngày",
      );
      expect(within(group).getByTestId("task-row-deadline-t-1-preset-friday")).toHaveTextContent(
        /Thứ Sáu/,
      );
      expect(within(group).getByTestId("task-row-deadline-t-1-custom")).toBeInTheDocument();
      expect(screen.queryByTestId("task-row-deadline-t-1-preset-today")).not.toBeInTheDocument();
    });

    it("403 khi dời hạn ⇒ rollback, dòng ở lại, thông báo không có quyền", async () => {
      setCapabilities({ "read:task": true, "update-deadline:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
        new ApiError({ status: 403, code: "AUTH-ERR-403", message: "Forbidden" }),
      );
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-deadline-t-1"));
      fireEvent.click(screen.getByTestId("task-row-deadline-t-1-preset-plus1d"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền đổi hạn/i);
      expect(screen.getByText("Task gấp")).toBeInTheDocument();
      expect(lateCell("t-1")).toHaveTextContent("3 ngày");
    });

    it("lỗi CHECK due_at >= start_at ⇒ rollback, dòng ở lại, câu giải thích", async () => {
      setCapabilities({ "read:task": true, "update-deadline:task": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
        new ApiError({
          status: 400,
          code: "VALIDATION-ERR-001",
          message: "TASK-ERR-INVALID-DATE-RANGE: hạn chót không được sớm hơn ngày bắt đầu.",
        }),
      );
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-deadline-t-1"));
      fireEvent.click(screen.getByTestId("task-row-deadline-t-1-preset-plus3d"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/sớm hơn ngày bắt đầu/i);
      expect(screen.getByText("Task gấp")).toBeInTheDocument();
      expect(lateCell("t-1")).toHaveTextContent("3 ngày");
    });

    it("ô Người: chọn người gọi /assign (không PATCH), tên mới hiện ngay", async () => {
      setCapabilities({ "read:task": true, "assign:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      vi.mocked(hrApi.listEmployees).mockResolvedValue(EMPLOYEES as never);
      vi.mocked(taskCoreApi.assign).mockReturnValue(new Promise(() => {}));
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-assignee-t-1"));
      const panel = await screen.findByRole("dialog");
      fireEvent.click(await within(panel).findByText("Trần Thị B"));

      await waitFor(() =>
        expect(taskCoreApi.assign).toHaveBeenCalledWith("t-1", { assigneeEmployeeId: "emp-002" }),
      );
      expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
      expect(screen.getByTestId("task-row-assignee-t-1")).toHaveTextContent("Trần Thị B");
    });

    it("ô Người: 403 ⇒ rollback về người cũ + thông báo", async () => {
      setCapabilities({ "read:task": true, "assign:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      vi.mocked(hrApi.listEmployees).mockResolvedValue(EMPLOYEES as never);
      vi.mocked(taskCoreApi.assign).mockRejectedValue(
        new ApiError({ status: 403, code: "AUTH-ERR-403", message: "Forbidden" }),
      );
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      fireEvent.click(screen.getByTestId("task-row-assignee-t-1"));
      const panel = await screen.findByRole("dialog");
      fireEvent.click(await within(panel).findByText("Trần Thị B"));

      expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền đổi người/i);
      expect(screen.getByTestId("task-row-assignee-t-1")).toHaveTextContent("Nguyễn Văn A");
    });

    it("không có update-deadline:task / assign:task ⇒ ô Hạn và ô Người chỉ đọc", async () => {
      setCapabilities({ "read:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.listTasks).mockResolvedValue([assigned()]);
      renderWithQuery(<OverdueTasksPage />);
      await screen.findByText("Task gấp");

      expect(screen.queryByTestId("task-row-deadline-t-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("task-row-assignee-t-1")).not.toBeInTheDocument();
      expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0);
    });

    describe("lọc client-side", () => {
      const ROWS = [
        makeTask("t-a", "Việc A", daysAgo(4), {
          projectId: "p-1",
          projectName: "Dự án 1",
          mainAssigneeEmployeeId: "emp-001",
          assigneeName: "Nguyễn Văn A",
          creatorUserId: "u1",
        }),
        makeTask("t-b", "Việc B", daysAgo(3), {
          projectId: "p-2",
          projectName: "Dự án 2",
          mainAssigneeEmployeeId: "emp-002",
          assigneeName: "Trần Thị B",
          creatorUserId: "u-other",
        }),
        makeTask("t-c", "Việc C", daysAgo(2), { creatorUserId: "u-other" }),
      ];
      const visible = () =>
        ["Việc A", "Việc B", "Việc C"].filter((title) => screen.queryByText(title) !== null);

      async function renderRows(rows: TaskCoreResponseDto[] = ROWS) {
        setCapabilities({ "read:task": true });
        vi.mocked(taskCoreApi.listTasks).mockResolvedValue(rows);
        renderWithQuery(<OverdueTasksPage />);
        await screen.findByText(rows[0]?.title ?? "");
      }

      it("theo Dự án / theo Người (lựa chọn lấy từ các dòng đã tải, không gọi thêm API)", async () => {
        await renderRows();
        fireEvent.change(screen.getByTestId("overdue-filter-project"), {
          target: { value: "p-1" },
        });
        expect(visible()).toEqual(["Việc A"]);

        fireEvent.change(screen.getByTestId("overdue-filter-project"), { target: { value: "" } });
        fireEvent.change(screen.getByTestId("overdue-filter-assignee"), {
          target: { value: "emp-002" },
        });
        expect(visible()).toEqual(["Việc B"]);
        expect(taskCoreApi.listTasks).toHaveBeenCalledTimes(1);
        expect(hrApi.listEmployees).not.toHaveBeenCalled();
      });

      it("«Tôi giao» = việc có creatorUserId là tôi", async () => {
        await renderRows();
        fireEvent.click(screen.getByTestId("overdue-filter-mine"));
        expect(screen.getByTestId("overdue-filter-mine")).toHaveAttribute("aria-pressed", "true");
        expect(visible()).toEqual(["Việc A"]);
      });

      it("«Tôi giao» rỗng ⇒ thông điệp riêng", async () => {
        await renderRows(ROWS.filter((r) => r.creatorUserId !== "u1"));
        fireEvent.click(screen.getByTestId("overdue-filter-mine"));
        expect(visible()).toEqual([]);
        expect(screen.getByText("Không có việc trễ trong số việc bạn giao")).toBeInTheDocument();
      });

      it("lọc khác không khớp ⇒ trạng thái rỗng có «Xoá bộ lọc»", async () => {
        await renderRows();
        fireEvent.change(screen.getByTestId("overdue-filter-project"), {
          target: { value: "p-1" },
        });
        fireEvent.change(screen.getByTestId("overdue-filter-assignee"), {
          target: { value: "emp-002" },
        });
        expect(visible()).toEqual([]);
        expect(screen.getByText("Không có việc trễ khớp bộ lọc")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Xoá bộ lọc" }));
        expect(visible()).toEqual(["Việc A", "Việc B", "Việc C"]);
      });
    });
  });
});
