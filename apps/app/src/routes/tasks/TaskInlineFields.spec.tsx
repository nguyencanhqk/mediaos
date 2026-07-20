import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, hrApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  TaskStatusField,
  TaskPriorityField,
  TaskDeadlineField,
  TaskAssigneeField,
} from "./TaskInlineFields";

/**
 * S5-TASK-INLINE-1 — bộ ô sửa-tại-chỗ của màn chi tiết.
 *
 * Hai thứ được khoá chặt ở đây vì chúng là ranh giới QUYỀN, không phải chuyện giao diện:
 *   1. Mỗi ô gate bằng ĐÚNG cặp của endpoint nó gọi — thiếu quyền phải là chữ chỉ-đọc, không phải
 *      control disabled (control disabled vẫn mời gọi, và dễ bị bỏ `disabled` lúc refactor sau).
 *   2. Người phụ trách đi route `assign` (assign:task), KHÔNG đi PATCH (update:task) — đi nhầm cửa
 *      là lặng lẽ nới quyền cho nhân viên thường.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      assign: vi.fn(),
      changeStatus: vi.fn(),
      changePriority: vi.fn(),
      changeDeadline: vi.fn(),
      updateTask: vi.fn(),
    },
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({
        items: [
          { id: "emp-001", fullName: "Nguyễn Văn A" },
          { id: "emp-002", fullName: "Trần Thị B" },
        ],
        meta: {},
      }),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

const TASK = {
  id: "task-001",
  title: "Việc thử",
  status: "Todo",
  priority: "Medium",
  dueAt: null,
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
} as unknown as TaskCoreResponseDto;

describe("TaskInlineFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  // ── Trạng thái ─────────────────────────────────────────────────────────────
  describe("TaskStatusField", () => {
    it("đổi là LƯU NGAY, không cần nút", async () => {
      setCapabilities({ "update-status:task": true });
      vi.mocked(taskCoreApi.changeStatus).mockResolvedValue({ id: "task-001" } as never);
      renderWithQuery(<TaskStatusField task={TASK} />);

      fireEvent.change(screen.getByLabelText(/trạng thái/i), { target: { value: "Done" } });
      await waitFor(() =>
        expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("task-001", { status: "Done" }),
      );
    });

    it("thiếu update-status:task ⇒ chỉ-đọc, KHÔNG render control", () => {
      setCapabilities({});
      renderWithQuery(<TaskStatusField task={TASK} />);
      expect(screen.queryByLabelText(/trạng thái/i)).not.toBeInTheDocument();
    });
  });

  // ── Ưu tiên ────────────────────────────────────────────────────────────────
  describe("TaskPriorityField", () => {
    it("đổi là lưu ngay", async () => {
      setCapabilities({ "update-priority:task": true });
      vi.mocked(taskCoreApi.changePriority).mockResolvedValue({ id: "task-001" } as never);
      renderWithQuery(<TaskPriorityField task={TASK} />);

      fireEvent.change(screen.getByLabelText(/ưu tiên/i), { target: { value: "High" } });
      await waitFor(() =>
        expect(taskCoreApi.changePriority).toHaveBeenCalledWith("task-001", { priority: "High" }),
      );
    });

    it("thiếu update-priority:task ⇒ chỉ-đọc", () => {
      setCapabilities({});
      renderWithQuery(<TaskPriorityField task={TASK} />);
      expect(screen.queryByLabelText(/ưu tiên/i)).not.toBeInTheDocument();
    });
  });

  // ── Deadline ───────────────────────────────────────────────────────────────
  describe("TaskDeadlineField", () => {
    it("lưu khi RỜI ô, không lưu theo từng lần gõ", async () => {
      setCapabilities({ "update-deadline:task": true });
      vi.mocked(taskCoreApi.changeDeadline).mockResolvedValue({ id: "task-001" } as never);
      renderWithQuery(<TaskDeadlineField task={TASK} />);

      const input = screen.getByLabelText(/deadline/i);
      fireEvent.change(input, { target: { value: "2026-08-01T09:00" } });
      // Gõ xong CHƯA gọi API — nếu gọi, mỗi mảnh ngày dở dang sẽ thành một request.
      expect(taskCoreApi.changeDeadline).not.toHaveBeenCalled();

      fireEvent.blur(input);
      await waitFor(() => expect(taskCoreApi.changeDeadline).toHaveBeenCalledTimes(1));
    });

    it("rời ô mà KHÔNG đổi gì ⇒ không gọi API", () => {
      setCapabilities({ "update-deadline:task": true });
      renderWithQuery(<TaskDeadlineField task={TASK} />);
      fireEvent.blur(screen.getByLabelText(/deadline/i));
      expect(taskCoreApi.changeDeadline).not.toHaveBeenCalled();
    });

    it("thiếu update-deadline:task ⇒ chỉ-đọc", () => {
      setCapabilities({});
      renderWithQuery(<TaskDeadlineField task={TASK} />);
      expect(screen.queryByLabelText(/deadline/i)).not.toBeInTheDocument();
    });
  });

  // ── Người phụ trách ────────────────────────────────────────────────────────
  // S5-TASK-LAYOUT-1 — đổi từ <select> sang picker avatar+tên (EmployeePicker): danh sách người nằm
  // trong popover, chỉ TẢI khi mở. Ràng buộc quyền không đổi và vẫn là thứ được khoá chặt ở đây.
  describe("TaskAssigneeField", () => {
    const openPicker = () => fireEvent.click(screen.getByTestId("task-assignee-picker"));

    it("hiện avatar + TÊN người phụ trách (không phải ô select trần)", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      renderWithQuery(<TaskAssigneeField task={TASK} />);
      expect(screen.getByTestId("task-assignee-picker")).toHaveTextContent("Nguyễn Văn A");
    });

    it("KHÔNG tải danh sách người cho tới khi MỞ picker", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      renderWithQuery(<TaskAssigneeField task={TASK} />);
      expect(hrApi.listEmployees).not.toHaveBeenCalled();

      openPicker();
      await waitFor(() => expect(hrApi.listEmployees).toHaveBeenCalled());
    });

    it("chọn người là gán NGAY — không có nút xác nhận", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.assign).mockResolvedValue({ id: "task-001" } as never);
      renderWithQuery(<TaskAssigneeField task={TASK} />);

      openPicker();
      await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Trần Thị B"));

      await waitFor(() =>
        expect(taskCoreApi.assign).toHaveBeenCalledWith("task-001", {
          assigneeEmployeeId: "emp-002",
        }),
      );
    });

    it("đi route assign, KHÔNG đi PATCH — sai cửa là nới quyền cho nhân viên thường", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      vi.mocked(taskCoreApi.assign).mockResolvedValue({ id: "task-001" } as never);
      renderWithQuery(<TaskAssigneeField task={TASK} />);

      openPicker();
      await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Trần Thị B"));

      await waitFor(() => expect(taskCoreApi.assign).toHaveBeenCalled());
      expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
    });

    it("chọn LẠI đúng người đang giữ ⇒ không gọi API", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      renderWithQuery(<TaskAssigneeField task={TASK} />);

      openPicker();
      await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
      // Tên hiện ở HAI chỗ (nút bấm + dòng trong danh sách) — phải nhắm đúng dòng trong popover.
      const panel = screen.getByRole("dialog");
      fireEvent.click(within(panel).getByText("Nguyễn Văn A"));
      expect(taskCoreApi.assign).not.toHaveBeenCalled();
    });

    it("KHÔNG mời gọi 'bỏ chọn' — route assign đòi uuid nên không gỡ được người phụ trách", async () => {
      setCapabilities({ "assign:task": true, "read:employee": true });
      renderWithQuery(<TaskAssigneeField task={TASK} />);

      openPicker();
      await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
      expect(screen.queryByText(/bỏ chọn người/i)).not.toBeInTheDocument();
    });

    it("thiếu assign:task ⇒ chỉ-đọc, bấm không mở picker, không gọi API danh sách", () => {
      setCapabilities({ "read:employee": true });
      renderWithQuery(<TaskAssigneeField task={TASK} />);

      const trigger = screen.getByTestId("task-assignee-picker");
      expect(trigger).toBeDisabled();
      expect(trigger).toHaveTextContent("Nguyễn Văn A");
      fireEvent.click(trigger);
      expect(screen.queryByTestId("task-assignee-picker-search")).not.toBeInTheDocument();
      expect(hrApi.listEmployees).not.toHaveBeenCalled();
    });
  });
});
