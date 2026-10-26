import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, useAuthStore, taskCoreApi, hrApi } from "@mediaos/web-core";
import type { SubtaskListItemDto } from "@mediaos/contracts";
import {
  SubtaskAssigneeControl,
  SubtaskDueControl,
  SubtaskStatusControl,
} from "./SubtaskInlineControls";

/**
 * S5-TASK-INLINE-1 — sửa người thực hiện + hạn NGAY trên dòng việc con.
 *
 * Điểm khoá quan trọng: `canEdit` phải bao gồm `item.canOpen` (D-39 — ĐỌC thừa hưởng từ cha nhưng
 * GHI thì KHÔNG). Con nằm ngoài phạm vi đọc riêng của actor mà vẫn cho bấm sửa thì mỗi lần bấm là
 * một 403 — đúng loại "nút mời gọi rồi từ chối" mà UI-02 §5.3 cấm.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      updateTask: vi.fn(),
      assign: vi.fn(),
      // SubtaskStatusControl — đổi trạng thái đi route change-status (không PATCH).
      changeStatus: vi.fn(),
      // S20-TASK-QUICKEDIT-1 — SubtaskDueControl lưu hạn qua route change-deadline (không PATCH).
      changeDeadline: vi.fn(),
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

const ITEM = {
  id: "sub-001",
  title: "Kịch bản",
  status: "Todo",
  priority: "Medium",
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
  dueAt: null,
  isOverdue: false,
  sortOrder: 0,
  canOpen: true,
} as unknown as SubtaskListItemDto;

const PROPS = { item: ITEM, parentTaskId: "task-parent", projectId: "proj-001", canEdit: true };

describe("SubtaskStatusControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("bấm thẻ → chọn trạng thái đổi qua ĐÚNG cửa change-status (không PATCH)", async () => {
    setCapabilities({ "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockResolvedValue({ task: { id: "sub-001" } } as never);
    renderWithQuery(<SubtaskStatusControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-status-select-sub-001"));
    fireEvent.click(screen.getByRole("option", { name: /hoàn thành/i }));

    await waitFor(() =>
      expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("sub-001", { status: "Done" }),
    );
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("thiếu update-status:task ⇒ badge tĩnh, KHÔNG render control", () => {
    setCapabilities({});
    renderWithQuery(<SubtaskStatusControl {...PROPS} />);
    expect(screen.queryByTestId("subtask-status-select-sub-001")).not.toBeInTheDocument();
    expect(screen.getByText("Cần làm")).toBeInTheDocument();
  });

  it("canEdit=false (item.canOpen=false — D-39 ghi không thừa hưởng) ⇒ badge tĩnh dù ĐỦ pair", () => {
    setCapabilities({ "update-status:task": true });
    renderWithQuery(<SubtaskStatusControl {...PROPS} canEdit={false} />);
    expect(screen.queryByTestId("subtask-status-select-sub-001")).not.toBeInTheDocument();
    expect(screen.getByText("Cần làm")).toBeInTheDocument();
  });
});

describe("SubtaskAssigneeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("bấm avatar mở danh sách chọn người", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
  });

  it("chọn người ⇒ PATCH việc con với assigneeEmployeeId", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Trần Thị B"));

    await waitFor(() =>
      expect(taskCoreApi.updateTask).toHaveBeenCalledWith("sub-001", {
        assigneeEmployeeId: "emp-002",
      }),
    );
  });

  it("có assign:task ⇒ đổi người thực hiện đi PATCH (cổng trường ở server), không gọi route assign", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Trần Thị B"));

    await waitFor(() => expect(taskCoreApi.updateTask).toHaveBeenCalled());
    expect(taskCoreApi.assign).not.toHaveBeenCalled();
  });

  it("gỡ được người thực hiện (PATCH nhận null — khác route assign đòi uuid)", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    vi.mocked(taskCoreApi.updateTask).mockResolvedValue({ id: "sub-001" } as never);
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText(/bỏ người thực hiện/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/bỏ người thực hiện/i));

    await waitFor(() =>
      expect(taskCoreApi.updateTask).toHaveBeenCalledWith("sub-001", { assigneeEmployeeId: null }),
    );
  });

  it("chọn LẠI đúng người đang giữ ⇒ không gọi API", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Nguyễn Văn A"));

    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("lọc theo ô tìm kiếm", async () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText("Trần Thị B")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("subtask-assignee-search-sub-001"), {
      target: { value: "Trần" },
    });

    expect(screen.getByText("Trần Thị B")).toBeInTheDocument();
    expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument();
  });

  it("canEdit=false ⇒ avatar không bấm được, không mở picker", () => {
    setCapabilities({ "read:employee": true, "assign:task": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} canEdit={false} />);

    const trigger = screen.getByTestId("subtask-assignee-trigger-sub-001");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("subtask-assignee-search-sub-001")).not.toBeInTheDocument();
  });

  it("thiếu read:employee ⇒ mở picker vẫn được nhưng báo thiếu quyền, không gọi API", async () => {
    setCapabilities({ "assign:task": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-assignee-trigger-sub-001"));
    await waitFor(() => expect(screen.getByText(/quyền/i)).toBeInTheDocument());
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
  });

  // S20-SEC-TASKPATCHGATE-1 — PATCH đổi người phụ trách đòi assign:task ở server (thiếu ⇒ 403 cả
  // request) ⇒ thiếu cặp thì control khoá như canEdit=false, không mời bấm rồi từ chối.
  it("thiếu assign:task ⇒ avatar khoá, không mở picker, không gọi API", () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskAssigneeControl {...PROPS} />);

    const trigger = screen.getByTestId("subtask-assignee-trigger-sub-001");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("subtask-assignee-search-sub-001")).not.toBeInTheDocument();
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });
});

describe("SubtaskDueControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  // S20-TASK-QUICKEDIT-1 — popover mốc hạn dùng chung; lưu NGAY qua change-deadline, KHÔNG PATCH.
  it("bấm ngày mở popover mốc nhanh; «Ngày mai» lưu ngay qua change-deadline, không PATCH", async () => {
    setCapabilities({ "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockResolvedValue({ task: { id: "sub-001" } } as never);
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001-preset-tomorrow"));

    await waitFor(() => expect(taskCoreApi.changeDeadline).toHaveBeenCalledTimes(1));
    const [taskId, body] = vi.mocked(taskCoreApi.changeDeadline).mock.calls[0] ?? [];
    expect(taskId).toBe("sub-001");
    expect(body?.dueAt).toMatch(/T10:00:00\.000Z$/); // 17:00 giờ công ty (UTC+7)
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
  });

  it("«Tuỳ chỉnh» + Áp dụng ⇒ change-deadline với giờ đã nhập (giờ công ty)", async () => {
    setCapabilities({ "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockResolvedValue({ task: { id: "sub-001" } } as never);
    renderWithQuery(<SubtaskDueControl {...PROPS} />);

    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001-custom"));
    fireEvent.change(screen.getByTestId("subtask-due-trigger-sub-001-custom-input"), {
      target: { value: "2026-08-01T09:00" },
    });
    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001-custom-apply"));

    await waitFor(() =>
      expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("sub-001", {
        dueAt: "2026-08-01T02:00:00.000Z",
      }),
    );
  });

  it("server từ chối 403 ⇒ báo lỗi dưới dòng", async () => {
    setCapabilities({ "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
      new ApiError({ status: 403, code: "AUTH-ERR-FORBIDDEN", message: "Forbidden" }),
    );
    renderWithQuery(<SubtaskDueControl {...PROPS} />);
    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001"));
    fireEvent.click(screen.getByTestId("subtask-due-trigger-sub-001-preset-tomorrow"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("canEdit=false ⇒ chỉ là chữ, không bấm được", () => {
    setCapabilities({ "update-deadline:task": true });
    renderWithQuery(<SubtaskDueControl {...PROPS} canEdit={false} />);
    expect(screen.queryByTestId("subtask-due-trigger-sub-001")).not.toBeInTheDocument();
  });

  // S20-SEC-TASKPATCHGATE-1 — PATCH đặt/xoá hạn đòi update-deadline:task ở server ⇒ thiếu cặp thì
  // control chỉ là chữ như canEdit=false.
  it("thiếu update-deadline:task ⇒ chỉ là chữ, không bấm được, không gọi API", () => {
    setCapabilities({ "read:employee": true });
    renderWithQuery(<SubtaskDueControl {...PROPS} />);
    expect(screen.queryByTestId("subtask-due-trigger-sub-001")).not.toBeInTheDocument();
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
    expect(taskCoreApi.changeDeadline).not.toHaveBeenCalled();
  });
});
