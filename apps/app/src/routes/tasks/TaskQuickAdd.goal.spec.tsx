import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Toaster, toast } from "@mediaos/ui";
import i18n from "@/i18n";

/**
 * S20-GOAL-SUGGEST-1 — tạo nhanh một dòng (cũng là ô của KanbanQuickCreate): toast «Đã tạo ‹mã› · Tính
 * vào ‹G›?» khi có ĐÚNG 1 ứng viên; chạm mới gắn; thiếu quyền ⇒ không toast, không GET /goals.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { createTask: vi.fn() },
    authApi: { ...actual.authApi, me: vi.fn() },
    goalApi: { ...actual.goalApi, listGoals: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn() },
  };
});

import { useAuthStore, taskCoreApi, goalApi, ApiError } from "@mediaos/web-core";
import { TaskQuickAdd } from "./TaskQuickAdd";

const mockCreate = taskCoreApi.createTask as ReturnType<typeof vi.fn>;
const mockList = goalApi.listGoals as ReturnType<typeof vi.fn>;
const mockLink = goalApi.linkTasks as ReturnType<typeof vi.fn>;
const mockUnlink = goalApi.unlinkTask as ReturnType<typeof vi.fn>;

const GOAL = {
  id: "g-prj",
  goalCode: "G-0007",
  name: "Ra mắt",
  level: "project",
  departmentId: null,
  projectId: "p-1",
  employeeId: null,
  ownerEmployeeId: "emp-x",
  periodStart: "2020-01-01",
  periodEnd: "2099-12-31",
  progressMode: "tasks",
  status: "Active",
  finalizedAt: null,
} as unknown as GoalCoreResponseDto;

const CREATED = {
  id: "t-9",

  title: "Gọi khách",
  projectId: "p-1",
  mainAssigneeEmployeeId: "emp-me",
  departmentId: null,
  dueAt: null,
} as unknown as TaskCoreResponseDto;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co-1" },
  });
}

function renderQuickAdd() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <Toaster />
        <TaskQuickAdd
          id="qa"
          projectId="p-1"
          fixedAssigneeEmployeeId="emp-me"
          placeholder="Thêm việc"
          hint="Enter"
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function typeAndEnter(title: string) {
  const input = screen.getByTestId("qa-input");
  fireEvent.change(input, { target: { value: title } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => toast.clear());
  setCaps({ "update:task": true, "update:goal": true, "create:task": true });
  mockCreate.mockResolvedValue(CREATED);
  mockList.mockImplementation(async (q: { projectId?: string }) => (q.projectId ? [GOAL] : []));
  mockLink.mockResolvedValue({ goalId: "g-prj", linked: 1, alreadyLinked: 0, warnings: [] });
  mockUnlink.mockResolvedValue(undefined);
});

describe("TaskQuickAdd — gợi ý mục tiêu sau khi tạo", () => {
  it("đúng 1 ứng viên ⇒ toast đề xuất; chạm «Tính vào» mới gắn, rồi «Đã gắn … · Gỡ» gỡ được", async () => {
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    expect(await screen.findByText(/Đã tạo «Gọi khách» · Tính vào G-0007/)).toBeInTheDocument();
    expect(mockLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Tính vào" }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith("g-prj", { taskIds: ["t-9"] }));
    expect(await screen.findByText(/Đã gắn vào G-0007/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Gỡ" }));
    await waitFor(() => expect(mockUnlink).toHaveBeenCalledWith("g-prj", "t-9"));
  });

  it("chạm mà server từ chối ⇒ «chưa gắn: …», không báo thành công", async () => {
    mockLink.mockRejectedValueOnce(new ApiError(422, "GOAL-ERR-005", "Kỳ đã chốt."));
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    fireEvent.click(await screen.findByRole("button", { name: "Tính vào" }));
    expect(
      await screen.findByText(/Đã tạo việc «Gọi khách» nhưng chưa gắn: mục tiêu đã chốt kỳ/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Đã gắn vào/)).toBeNull();
  });

  it("một truy vấn ứng viên hỏng ⇒ KHÔNG đề xuất (tránh «chỉ một» sai) và có log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockList.mockImplementation(async (q: { projectId?: string }) => {
      if (q.projectId) return [GOAL];
      throw new Error("boom");
    });
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByText(/Tính vào/)).toBeNull();
    warn.mockRestore();
  });

  it("server trả cảnh báo mềm ⇒ toast cảnh báo kèm nội dung, không «Đã gắn vào» trơn", async () => {
    mockLink.mockResolvedValue({
      goalId: "g-prj",
      linked: 1,
      alreadyLinked: 0,
      warnings: [
        { taskId: "t-9", taskCode: null, message: "Việc không thuộc phòng của mục tiêu." },
      ],
    });
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    fireEvent.click(await screen.findByRole("button", { name: "Tính vào" }));
    expect(
      await screen.findByText(/Đã gắn vào G-0007. Lưu ý: Việc không thuộc phòng của mục tiêu./),
    ).toBeInTheDocument();
  });

  it("linked = 0 (đã gắn từ trước) ⇒ không báo «Đã gắn vào» giả", async () => {
    mockLink.mockResolvedValue({ goalId: "g-prj", linked: 0, alreadyLinked: 1, warnings: [] });
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    fireEvent.click(await screen.findByRole("button", { name: "Tính vào" }));
    expect(await screen.findByText(/đã được gắn vào G-0007 từ trước/)).toBeInTheDocument();
    expect(screen.queryByText(/^Đã gắn vào/)).toBeNull();
  });

  it("không ứng viên ⇒ không toast gợi ý", async () => {
    mockList.mockResolvedValue([]);
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText(/Tính vào/)).toBeNull();
  });

  it("2 ứng viên ⇒ không toast gợi ý", async () => {
    mockList.mockResolvedValue([GOAL, { ...GOAL, id: "g-2", goalCode: "G-0008" }]);
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText(/Tính vào/)).toBeNull();
  });

  it("thiếu update:goal ⇒ không gọi GET /goals, không toast", async () => {
    setCaps({ "update:task": true, "create:task": true });
    renderQuickAdd();
    typeAndEnter("Gọi khách");
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.queryByText(/Tính vào/)).toBeNull();
  });
});
