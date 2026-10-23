import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAuthStore,
  taskCollabApi,
  taskCoreApi,
  taskProjectApi,
  hrApi,
  ApiError,
} from "@mediaos/web-core";
import { TaskCommentThread } from "./TaskCommentThread";
import type {
  TaskCommentResponseDto,
  TaskCoreResponseDto,
  TaskWatcherResponseDto,
} from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      listComments: vi.fn(),
      addComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
    },
    // S20-TASK-QUICKENTRY-1 — nguồn gợi ý @ = người tham gia việc (chi tiết việc + người theo dõi +
    // thành viên dự án), danh bạ HR chỉ bổ sung khi có read:employee.
    taskCoreApi: {
      getTask: vi.fn(),
      listWatchers: vi.fn(),
    },
    taskProjectApi: {
      listMembers: vi.fn(),
    },
    hrApi: {
      listEmployees: vi.fn(),
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

const MOCK_COMMENT: TaskCommentResponseDto = {
  id: "cmt-001",
  taskId: "task-001",
  userId: "u1",
  userName: "Test User",
  content: "Bình luận đầu tiên",
  mentions: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: null,
};

const DIRECTORY = {
  items: [
    { id: "emp-001", fullName: "Nguyễn Văn A", userId: "u-001" },
    { id: "emp-002", fullName: "Trần Thị B", userId: "u-002" },
  ],
  meta: {},
};

function makeTask(overrides: Partial<TaskCoreResponseDto> = {}): TaskCoreResponseDto {
  return {
    id: "task-001",
    companyId: "co-001",
    title: "Việc",
    description: null,
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    parentTaskId: null,
    subtaskTotal: 0,
    subtaskDone: 0,
    ...overrides,
  };
}

function makeWatcher(
  employeeId: string,
  employeeName: string | null,
  userId: string | null,
): TaskWatcherResponseDto {
  return {
    id: `w-${employeeId}`,
    taskId: "task-001",
    employeeId,
    employeeName,
    userId,
    watcherType: "Manual",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z",
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

describe("TaskCommentThread", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    vi.mocked(taskCollabApi.listComments).mockResolvedValue([]);
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask());
    vi.mocked(taskCoreApi.listWatchers).mockResolvedValue([]);
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue([]);
    vi.mocked(hrApi.listEmployees).mockResolvedValue(
      DIRECTORY as unknown as Awaited<ReturnType<typeof hrApi.listEmployees>>,
    );
    // jsdom KHÔNG implement scrollIntoView — stub cho deep-link highlight test.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  // ── DENY-PATH: composer ẩn khi thiếu comment:task ──────────────────────────
  it("hides composer when user lacks comment:task", async () => {
    setCapabilities({});
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có bình luận/i)).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/viết bình luận/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: hiển thị danh sách + gửi bình luận mới ──────────────────────
  it("renders comment list and submits a new comment", async () => {
    setCapabilities({ "comment:task": true, "read:employee": true });
    vi.mocked(taskCollabApi.listComments).mockResolvedValue([MOCK_COMMENT]);
    vi.mocked(taskCollabApi.addComment).mockResolvedValue({
      ...MOCK_COMMENT,
      id: "cmt-002",
      content: "Nội dung mới",
    });
    renderWithQuery(<TaskCommentThread taskId="task-001" />);

    await waitFor(() => expect(screen.getByText("Bình luận đầu tiên")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/viết bình luận/i);
    fireEvent.change(textarea, { target: { value: "Nội dung mới" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi/i }));

    await waitFor(() =>
      expect(taskCollabApi.addComment).toHaveBeenCalledWith("task-001", {
        content: "Nội dung mới",
        mentionEmployeeIds: [],
      }),
    );
  });

  // ── Mention autocomplete: gõ "@" lọc gợi ý, chọn chèn tên + chip ────────────
  it("shows mention suggestions when typing @ and inserts selected employee", async () => {
    setCapabilities({ "comment:task": true, "read:employee": true });
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có bình luận/i)).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/viết bình luận/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@Nguy" } });

    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Nguyễn Văn A"));

    await waitFor(() => expect(textarea.value).toBe("@Nguyễn Văn A "));
    expect(screen.getByRole("button", { name: "Bỏ nhắc Nguyễn Văn A" })).toBeInTheDocument();
  });

  // ── Xóa bình luận PHẢI qua dialog xác nhận (comment của chính mình) ─────────
  it("requires confirm dialog before deleting own comment", async () => {
    setCapabilities({ "comment:task": true });
    vi.mocked(taskCollabApi.listComments).mockResolvedValue([MOCK_COMMENT]);
    vi.mocked(taskCollabApi.deleteComment).mockResolvedValue(undefined);
    renderWithQuery(<TaskCommentThread taskId="task-001" />);

    await waitFor(() => expect(screen.getByText("Bình luận đầu tiên")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /xóa bình luận/i }));

    // Dialog xác nhận hiện ra — API CHƯA bị gọi cho tới khi bấm "Xác nhận xóa".
    expect(screen.getByText(/bình luận này sẽ bị xóa mềm/i)).toBeInTheDocument();
    expect(taskCollabApi.deleteComment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /xác nhận xóa/i }));
    await waitFor(() =>
      expect(taskCollabApi.deleteComment).toHaveBeenCalledWith("task-001", "cmt-001"),
    );
  });

  // ── Deep link ?comment_id= highlight đúng bình luận ─────────────────────────
  it("highlights the comment matching ?comment_id= from the URL", async () => {
    setCapabilities({});
    window.history.pushState({}, "", "/tasks/task-001?comment_id=cmt-001");
    vi.mocked(taskCollabApi.listComments).mockResolvedValue([MOCK_COMMENT]);
    renderWithQuery(<TaskCommentThread taskId="task-001" />);

    await waitFor(() => expect(screen.getByText("Bình luận đầu tiên")).toBeInTheDocument());
    const row = document.getElementById("comment-cmt-001");
    expect(row?.className).toContain("border-brand");

    window.history.pushState({}, "", "/");
  });
});

// ── S20-TASK-QUICKENTRY-1 (US-TASK-NV-11) — Ctrl+Enter gửi, gợi ý @ từ người tham gia việc ──
describe("TaskCommentThread — gợi ý @ và phím tắt gửi", () => {
  // A phụ trách · B giao việc · C theo dõi · chính tôi (u1) theo dõi · một người theo dõi không tên.
  const PARTICIPANT_TASK = makeTask({
    mainAssigneeEmployeeId: "emp-a",
    assigneeName: "An Phụ Trách",
    reporterEmployeeId: "emp-b",
    reporterName: "Bình Giao Việc",
  });
  const PARTICIPANT_WATCHERS = [
    makeWatcher("emp-c", "Cường Theo Dõi", "u-c"),
    makeWatcher("emp-me", "Test User", "u1"),
    makeWatcher("emp-noname", null, "u-x"),
  ];

  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    vi.mocked(taskCollabApi.listComments).mockResolvedValue([]);
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(PARTICIPANT_TASK);
    vi.mocked(taskCoreApi.listWatchers).mockResolvedValue(PARTICIPANT_WATCHERS);
    vi.mocked(taskProjectApi.listMembers).mockResolvedValue([]);
    vi.mocked(hrApi.listEmployees).mockResolvedValue(
      DIRECTORY as unknown as Awaited<ReturnType<typeof hrApi.listEmployees>>,
    );
  });

  async function composer(): Promise<HTMLTextAreaElement> {
    await waitFor(() => expect(screen.getByText(/chưa có bình luận/i)).toBeInTheDocument());
    return screen.getByPlaceholderText(/viết bình luận/i) as HTMLTextAreaElement;
  }

  function suggestionNames(): string[] {
    const list = screen.getByTestId("mention-suggestions");
    return within(list)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
  }

  it("không có read:employee: gõ «@» gợi ý A, B, C (bỏ chính mình, bỏ mục không tên), lọc theo ký tự gõ; không gọi danh bạ HR", async () => {
    setCapabilities({ "comment:task": true, "watch:task": true });
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    // Chờ đủ nguồn (chi tiết việc + người theo dõi) rồi mới gõ.
    await waitFor(() => expect(taskCoreApi.listWatchers).toHaveBeenCalled());
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() =>
      expect(suggestionNames()).toEqual(["An Phụ Trách", "Bình Giao Việc", "Cường Theo Dõi"]),
    );
    expect(hrApi.listEmployees).not.toHaveBeenCalled();

    // Lọc không phân biệt dấu: «cuong» khớp «Cường».
    fireEvent.change(textarea, { target: { value: "@cuong" } });
    await waitFor(() => expect(suggestionNames()).toEqual(["Cường Theo Dõi"]));

    fireEvent.click(screen.getByRole("button", { name: "Cường Theo Dõi" }));
    await waitFor(() => expect(textarea.value).toBe("@Cường Theo Dõi "));
    expect(screen.getByRole("button", { name: "Bỏ nhắc Cường Theo Dõi" })).toBeInTheDocument();
  });

  it("có read:employee: người tham gia việc xếp trước, danh bạ xếp sau, không trùng, không có chính mình", async () => {
    setCapabilities({ "comment:task": true, "watch:task": true, "read:employee": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue({
      items: [
        { id: "emp-z", fullName: "Ánh Danh Bạ", userId: "u-z" },
        { id: "emp-a", fullName: "An Phụ Trách", userId: "u-a" },
        { id: "emp-me", fullName: "Test User", userId: "u1" },
      ],
      meta: {},
    } as unknown as Awaited<ReturnType<typeof hrApi.listEmployees>>);
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    await waitFor(() => expect(hrApi.listEmployees).toHaveBeenCalled());
    await waitFor(() => expect(taskCoreApi.listWatchers).toHaveBeenCalled());
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() =>
      expect(suggestionNames()).toEqual([
        "An Phụ Trách",
        "Bình Giao Việc",
        "Cường Theo Dõi",
        "Ánh Danh Bạ",
      ]),
    );
  });

  it("Ctrl+Enter gửi và xoá ô; Cmd+Enter cũng gửi; Enter đơn KHÔNG gửi (để xuống dòng)", async () => {
    setCapabilities({ "comment:task": true });
    vi.mocked(taskCollabApi.addComment).mockResolvedValue(MOCK_COMMENT);
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    fireEvent.change(textarea, { target: { value: "Dòng một" } });
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter" });
    expect(notPrevented).toBe(true);
    expect(taskCollabApi.addComment).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(taskCollabApi.addComment).toHaveBeenCalledWith("task-001", {
        content: "Dòng một",
        mentionEmployeeIds: [],
      }),
    );
    await waitFor(() => expect(textarea.value).toBe(""));

    fireEvent.change(textarea, { target: { value: "Lần hai" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await waitFor(() => expect(taskCollabApi.addComment).toHaveBeenCalledTimes(2));
  });

  it("ô rỗng hoặc chỉ khoảng trắng: Ctrl+Enter không gửi", async () => {
    setCapabilities({ "comment:task": true });
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    fireEvent.change(textarea, { target: { value: "   \n  " } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(taskCollabApi.addComment).not.toHaveBeenCalled();
  });

  it("server từ chối mention ⇒ giữ nội dung đã gõ + nói rõ lý do", async () => {
    setCapabilities({ "comment:task": true });
    vi.mocked(taskCollabApi.addComment).mockRejectedValue(
      new ApiError(
        403,
        "FORBIDDEN",
        "TASK-ERR-MENTION-OUT-OF-SCOPE: người được nhắc không có quyền xem công việc này.",
      ),
    );
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    fireEvent.change(textarea, { target: { value: "Nhờ anh xem giúp" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /người được nhắc không có quyền xem công việc này/i,
    );
    expect(textarea.value).toBe("Nhờ anh xem giúp");
  });

  it("403 thường ⇒ giữ nội dung đã gõ + hiện lỗi quyền", async () => {
    setCapabilities({ "comment:task": true });
    vi.mocked(taskCollabApi.addComment).mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "forbidden"),
    );
    renderWithQuery(<TaskCommentThread taskId="task-001" />);
    const textarea = await composer();

    fireEvent.change(textarea, { target: { value: "Nội dung" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền/i);
    expect(textarea.value).toBe("Nội dung");
  });
});
