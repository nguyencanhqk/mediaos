import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { TaskChecklistPanel } from "./TaskChecklistPanel";
import type { TaskChecklistResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      listChecklists: vi.fn(),
      createChecklist: vi.fn(),
      updateChecklist: vi.fn(),
      deleteChecklist: vi.fn(),
      addChecklistItem: vi.fn(),
      updateChecklistItem: vi.fn(),
      deleteChecklistItem: vi.fn(),
    },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_CHECKLIST: TaskChecklistResponseDto = {
  id: "cl-001",
  taskId: "task-001",
  title: "Chuẩn bị",
  description: null,
  isRequiredForDone: false,
  orderIndex: 0,
  items: [
    {
      id: "item-001",
      checklistId: "cl-001",
      title: "Soạn tài liệu",
      isDone: false,
      doneBy: null,
      doneAt: null,
      orderIndex: 0,
    },
  ],
  createdAt: "2026-07-01T00:00:00.000Z",
};

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

describe("TaskChecklistPanel", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([MOCK_CHECKLIST]);
  });

  // ── DENY-PATH: read-only khi useCan(update:task)=false (BE quyết cuối; grant emp/mgr đã nới 0501) ──
  it("renders read-only (no add/tick/delete controls) without update:task", async () => {
    setCapabilities({});
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());

    expect(screen.queryByText(/thêm checklist/i)).not.toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Soạn tài liệu" });
    expect(checkbox).toBeDisabled();
  });

  // ── ALLOW-PATH: tick item gọi API ────────────────────────────────────────────
  it("ticks an item and calls updateChecklistItem with update:task", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.updateChecklistItem).mockResolvedValue({
      ...MOCK_CHECKLIST.items[0],
      isDone: true,
    });
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());

    const checkbox = screen.getByRole("checkbox", { name: "Soạn tài liệu" });
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(taskCollabApi.updateChecklistItem).toHaveBeenCalledWith(
        "task-001",
        "cl-001",
        "item-001",
        { isDone: true },
      ),
    );
  });

  // ── Progress hiển thị đúng số lượng hoàn thành ──────────────────────────────
  it("shows checklist progress summary", async () => {
    setCapabilities({});
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());
    expect(screen.getByText(/0\/1/)).toBeInTheDocument();
  });

  // ── Xóa checklist yêu cầu dialog xác nhận ───────────────────────────────────
  it("requires confirm dialog before deleting a checklist group", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.deleteChecklist).mockResolvedValue(undefined);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /xóa checklist/i }));
    expect(screen.getByText(/checklist "chuẩn bị" và các hạng mục/i)).toBeInTheDocument();
    expect(taskCollabApi.deleteChecklist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /xác nhận xóa/i }));
    await waitFor(() =>
      expect(taskCollabApi.deleteChecklist).toHaveBeenCalledWith("task-001", "cl-001"),
    );
  });

  // ── Empty state ──────────────────────────────────────────────────────────────
  it("shows empty state when there are no checklists", async () => {
    setCapabilities({});
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có checklist/i)).toBeInTheDocument());
  });
});

// ── S20-TASK-QUICKENTRY-1 (US-TASK-NV-10) — nhập liên tiếp + dán nhiều dòng ──────
describe("TaskChecklistPanel — nhập nhanh bằng bàn phím", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  async function findQuickInput(): Promise<HTMLTextAreaElement> {
    return (await screen.findByRole("textbox", { name: "Thêm mục" })) as HTMLTextAreaElement;
  }

  function submitWithEnter(input: HTMLElement, value: string) {
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("chưa có checklist vẫn hiện ô «Thêm mục»; mục đầu tiên tạo nhóm «Checklist» kèm items[] trong MỘT request", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    vi.mocked(taskCollabApi.createChecklist).mockResolvedValue({
      ...MOCK_CHECKLIST,
      id: "cl-new",
      title: "Checklist",
    });
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    submitWithEnter(await findQuickInput(), "Gọi khách");

    await waitFor(() => expect(taskCollabApi.createChecklist).toHaveBeenCalledTimes(1));
    expect(taskCollabApi.createChecklist).toHaveBeenCalledWith("task-001", {
      title: "Checklist",
      isRequiredForDone: false,
      items: ["Gọi khách"],
    });
    expect(taskCollabApi.addChecklistItem).not.toHaveBeenCalled();
  });

  it("dán 5 dòng (1 dòng trống) ⇒ 4 mục đúng thứ tự, vẫn MỘT request", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    vi.mocked(taskCollabApi.createChecklist).mockResolvedValue({ ...MOCK_CHECKLIST, id: "cl-new" });
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    submitWithEnter(await findQuickInput(), "Một\r\nHai\n\n  Ba  \nBốn");

    await waitFor(() => expect(taskCollabApi.createChecklist).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCollabApi.createChecklist).mock.calls[0]?.[1]).toMatchObject({
      items: ["Một", "Hai", "Ba", "Bốn"],
    });
  });

  it("dán 60 dòng ⇒ không gửi, lỗi «tối đa 50 mục mỗi lần»", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    const input = await findQuickInput();
    const sixtyLines = Array.from({ length: 60 }, (_, i) => `Mục ${i + 1}`).join("\n");
    submitWithEnter(input, sixtyLines);

    expect(await screen.findByRole("alert")).toHaveTextContent(/tối đa 50 mục mỗi lần/i);
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào checklist" }));
    expect(taskCollabApi.createChecklist).not.toHaveBeenCalled();
    expect(taskCollabApi.addChecklistItem).not.toHaveBeenCalled();
    expect(input.value).toBe(sixtyLines);
  });

  it("tạo bị 403 ⇒ ô giữ nội dung đã gõ + hiện lỗi", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    vi.mocked(taskCollabApi.createChecklist).mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "forbidden"),
    );
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    const input = await findQuickInput();
    submitWithEnter(input, "Gọi khách\nGửi báo giá");

    expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền/i);
    expect(input.value).toBe("Gọi khách\nGửi báo giá");
  });

  it("không có update:task ⇒ ô «Thêm mục» không hiện (kể cả khi chưa có checklist)", async () => {
    setCapabilities({});
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([]);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có checklist/i)).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: "Thêm mục" })).not.toBeInTheDocument();
  });

  it("checklist đã có: dán 2 dòng vào ô của nhóm ⇒ thêm lần lượt đúng thứ tự, ô trống và vẫn focus", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([MOCK_CHECKLIST]);
    vi.mocked(taskCollabApi.addChecklistItem).mockResolvedValue(MOCK_CHECKLIST.items[0]);
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    const input = await findQuickInput();
    input.focus();
    submitWithEnter(input, "Đặt phòng\nIn tài liệu");

    await waitFor(() => expect(taskCollabApi.addChecklistItem).toHaveBeenCalledTimes(2));
    expect(vi.mocked(taskCollabApi.addChecklistItem).mock.calls.map((c) => c[2])).toEqual([
      { title: "Đặt phòng" },
      { title: "In tài liệu" },
    ]);
    expect(taskCollabApi.createChecklist).not.toHaveBeenCalled();
    await waitFor(() => expect(input.value).toBe(""));
    expect(input).toHaveFocus();
  });

  it("checklist đã có: mục thứ hai bị 403 ⇒ ô giữ đúng phần CHƯA lưu + hiện lỗi", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCollabApi.listChecklists).mockResolvedValue([MOCK_CHECKLIST]);
    vi.mocked(taskCollabApi.addChecklistItem)
      .mockResolvedValueOnce(MOCK_CHECKLIST.items[0])
      .mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "forbidden"));
    renderWithQuery(<TaskChecklistPanel taskId="task-001" />);

    const input = await findQuickInput();
    submitWithEnter(input, "Đặt phòng\nIn tài liệu\nGửi thư mời");

    expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền/i);
    expect(taskCollabApi.addChecklistItem).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("In tài liệu\nGửi thư mời");
  });
});
