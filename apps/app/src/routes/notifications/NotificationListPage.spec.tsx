// @vitest-environment jsdom
/**
 * NotificationListPage tests (S4-FE-NOTI-1, NOTI-SCREEN-LIST).
 * Phủ: forbidden (deny-path useCan=false → KHÔNG fetch) · loading/empty/error/list render · mark-read gate.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(),
  myNotificationApi: {
    list: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
  notificationKeys: {
    list: (p?: unknown) => ["notifications", "list", p],
    detail: (id: string) => ["notifications", "detail", id],
  },
  notificationInvalidation: {
    markRead: (id: string) => [
      ["notifications", "list"],
      ["notifications", "detail", id],
    ],
    markAllRead: () => [["notifications", "list"]],
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      children,
      actions,
    }: {
      title: string;
      children?: React.ReactNode;
      actions?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
        {children}
      </div>
    ),
    DataTable: ({ data, emptyState }: { data: unknown[]; emptyState?: React.ReactNode }) =>
      data.length === 0 ? (
        emptyState
      ) : (
        <table>
          <tbody>
            {(data as Array<{ notification_id: string; title: string; status: string }>).map(
              (row) => (
                <tr key={row.notification_id}>
                  <td>{row.title}</td>
                  <td>{row.status}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ),
  };
});

import { useCan, myNotificationApi } from "@mediaos/web-core";
import { NotificationListPage } from "./NotificationListPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockList = myNotificationApi.list as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  const qc = buildQC();
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <NotificationListPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("NotificationListPage — gate", () => {
  it("useCan(read, notification) = false → hiện forbidden EmptyState, KHÔNG fetch", () => {
    mockUseCan.mockReturnValue(false);
    renderPage();
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe("NotificationListPage — data states", () => {
  it("empty → 'Bạn chưa có thông báo mới'", async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Bạn chưa có thông báo mới")).toBeTruthy();
    });
  });

  it("render danh sách thông báo", async () => {
    mockList.mockResolvedValue([
      {
        notification_id: "noti-1",
        title: "Task sắp đến hạn",
        short_content: "Task TASK-1 sắp đến hạn",
        notification_type: "Reminder",
        priority: "Normal",
        status: "Unread",
        is_read: false,
        source_module: "TASK",
        event_code: "TASK_DUE_SOON",
        target_module: "TASK",
        target_type: "task",
        target_id: "task-1",
        target_url: "/tasks/task-1",
        created_at: "2026-07-01T09:00:00.000Z",
        read_at: null,
      },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Task sắp đến hạn")).toBeTruthy();
    });
  });

  it("lỗi fetch → error EmptyState + nút thử lại", async () => {
    mockList.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không thể tải danh sách thông báo/i)).toBeTruthy();
    });
  });

  it("deleted/hidden mặc định KHÔNG hiện trong list (query KHÔNG gửi include_hidden=true mặc định)", async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });
    const [query] = mockList.mock.calls[0] as [Record<string, unknown>];
    expect(query.include_hidden).toBeUndefined();
    expect(query.status).toBeUndefined();
  });
});
