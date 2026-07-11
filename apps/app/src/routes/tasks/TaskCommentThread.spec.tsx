import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi } from "@mediaos/web-core";
import { TaskCommentThread } from "./TaskCommentThread";
import type { TaskCommentResponseDto } from "@mediaos/contracts";

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
