import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalDetailResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Toaster, toast } from "@mediaos/ui";
import i18n from "@/i18n";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-93) — việc con đề xuất «Tính vào ‹mục tiêu của việc cha›».
 * Tiêu chí 1–2 (bật mới gắn, mặc định KHÔNG chọn sẵn — Q28 = A), 3 (thiếu quyền ⇒ không ô), 4 (đã chốt kỳ ⇒
 * không ô), 5 (mục tiêu cá nhân ⇒ khoá kèm lý do).
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { createTask: vi.fn() },
    goalApi: { ...actual.goalApi, getGoal: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn() },
  };
});

import { useAuthStore, taskCoreApi, goalApi, ApiError } from "@mediaos/web-core";
import { SubtaskQuickAdd } from "./TaskSubtaskPanelQuickAdd";

const mockCreate = taskCoreApi.createTask as ReturnType<typeof vi.fn>;
const mockGet = goalApi.getGoal as ReturnType<typeof vi.fn>;
const mockLink = goalApi.linkTasks as ReturnType<typeof vi.fn>;

const PROJECT_GOAL = {
  id: "g-prj",
  goalCode: "G-0007",
  name: "Ra mắt",
  level: "project",
  departmentId: null,
  projectId: "p-1",
  employeeId: null,
  ownerEmployeeId: "emp-x",
  progressMode: "tasks",
  status: "Active",
  finalizedAt: null,
} as unknown as GoalDetailResponseDto;

const CHILD = {
  id: "t-child",

  title: "Việc con",
  projectId: "p-1",
} as unknown as TaskCoreResponseDto;

const ALL_CAPS = { "update:task": true, "update:goal": true, "view:goal": true };

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co-1" },
  });
}

async function openBox(parentGoalId: string | null = "g-prj") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <Toaster />
        <SubtaskQuickAdd parentTaskId="t-parent" projectId="p-1" parentGoalId={parentGoalId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Thêm việc con/ }));
  return screen.findByRole("textbox");
}

function enter(input: HTMLElement, title: string) {
  fireEvent.change(input, { target: { value: title } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => toast.clear());
  setCaps(ALL_CAPS);
  mockGet.mockResolvedValue(PROJECT_GOAL);
  mockCreate.mockResolvedValue(CHILD);
  mockLink.mockResolvedValue({ goalId: "g-prj", linked: 1, alreadyLinked: 0, warnings: [] });
});

describe("SubtaskQuickAdd — ô «Tính vào mục tiêu của việc cha»", () => {
  it("mặc định KHÔNG chọn sẵn (Q28 = A); không bật ⇒ việc con không gắn mục tiêu", async () => {
    const input = await openBox();
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByTestId("subtask-goal-option")).toHaveTextContent("G-0007 — Ra mắt");
    expect(screen.getByTestId("subtask-goal-option")).toHaveTextContent(
      "Mục tiêu đếm từng việc: việc cha và việc con đều được tính.",
    );
    enter(input, "Việc con");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("bật ô rồi Enter ⇒ tạo việc con rồi gắn vào mục tiêu của cha, toast «Đã gắn … · Gỡ»", async () => {
    const input = await openBox();
    fireEvent.click(await screen.findByRole("checkbox"));
    enter(input, "Việc con");
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith("g-prj", { taskIds: ["t-child"] }));
    expect(await screen.findByText(/Đã gắn vào G-0007/)).toBeInTheDocument();
  });

  it("bước gắn lỗi ⇒ toast «Đã tạo việc … nhưng chưa gắn: …» kèm «Thử gắn lại»", async () => {
    mockLink.mockRejectedValueOnce(new ApiError(422, "GOAL-ERR-005", "Kỳ đã chốt."));
    const input = await openBox();
    fireEvent.click(await screen.findByRole("checkbox"));
    enter(input, "Việc con");
    expect(
      await screen.findByText(/Đã tạo việc «Việc con» nhưng chưa gắn: mục tiêu đã chốt kỳ/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử gắn lại" }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(2));
  });

  it("mục tiêu cá nhân ⇒ ô khoá kèm lý do, không gắn", async () => {
    mockGet.mockResolvedValue({
      ...PROJECT_GOAL,
      level: "employee",
      projectId: null,
      employeeId: "emp-a",
    });
    const input = await openBox();
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId("subtask-goal-option")).toHaveTextContent(
      "Mục tiêu cá nhân chỉ nhận việc do chủ mục tiêu phụ trách",
    );
    enter(input, "Việc con");
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("thiếu update:goal ⇒ không có ô, KHÔNG gọi GET /goals/:id; tạo việc con như cũ", async () => {
    setCaps({ "update:task": true, "view:goal": true });
    const input = await openBox();
    enter(input, "Việc con");
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("mục tiêu của cha đã chốt kỳ ⇒ không có ô", async () => {
    mockGet.mockResolvedValue({ ...PROJECT_GOAL, finalizedAt: "2026-11-01T00:00:00.000Z" });
    await openBox();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("việc cha không gắn mục tiêu ⇒ không có ô, không gọi GET", async () => {
    await openBox(null);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
