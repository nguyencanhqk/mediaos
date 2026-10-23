// @vitest-environment jsdom
/**
 * NotificationListPage tests (S4-FE-NOTI-1, NOTI-SCREEN-LIST).
 * Phủ: forbidden (deny-path useCan=false → KHÔNG fetch) · loading/empty/error/list render · mark-read gate.
 *
 * S20-NOTI-LISTNAV-1 (US-X-13): bấm dòng ⇒ mark-read + đi thẳng `target_url` (đích việc ⇒ drawer
 * `?task=`), đích rỗng/không an toàn ⇒ trang chi tiết như cũ, mark-read lỗi vẫn điều hướng và giữ chưa
 * đọc · chip nguồn/mức ưu tiên đọc-ghi URL · lọc rỗng + «Bỏ lọc» · «đánh dấu đã đọc» theo phạm vi
 * endpoint hỗ trợ.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { MyNotificationListItem } from "@mediaos/contracts";
import i18n from "@/i18n";

const { searchRef, mockNavigate } = vi.hoisted(() => ({
  searchRef: { current: {} as Record<string, unknown> },
  mockNavigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
      select({ location: { pathname: "/notifications", search: searchRef.current } }),
  };
});

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

type Cell = { cell?: (ctx: { row: { original: unknown } }) => React.ReactNode };

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
    DataTable: ({
      data,
      columns,
      emptyState,
    }: {
      data: unknown[];
      columns: Cell[];
      emptyState?: React.ReactNode;
    }) =>
      data.length === 0 ? (
        emptyState
      ) : (
        <table>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} data-testid="noti-row">
                {columns.map((col, j) => (
                  <td key={j}>{col.cell ? col.cell({ row: { original: row } }) : null}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ),
  };
});

import { useCan, myNotificationApi } from "@mediaos/web-core";
import { NotificationListPage } from "./NotificationListPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockList = myNotificationApi.list as ReturnType<typeof vi.fn>;
const mockMarkRead = myNotificationApi.markRead as ReturnType<typeof vi.fn>;
const mockMarkAllRead = myNotificationApi.markAllRead as ReturnType<typeof vi.fn>;

const TASK_UUID = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";
const LEAVE_UUID = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<MyNotificationListItem>): MyNotificationListItem {
  return {
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
    target_id: null,
    target_url: "/tasks/my-tasks",
    created_at: "2026-07-01T09:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

function buildQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

/** navigate({to:".", search: fn}) gần nhất ⇒ áp fn lên `prev`. */
function lastSearchPatch(prev: Record<string, unknown>) {
  const call = mockNavigate.mock.calls.at(-1)?.[0] as {
    to: string;
    search: (p: Record<string, unknown>) => Record<string, unknown>;
  };
  expect(call.to).toBe(".");
  return call.search(prev);
}

beforeEach(() => {
  vi.clearAllMocks();
  searchRef.current = {};
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
    expect(screen.queryByRole("button", { name: "Bỏ lọc" })).toBeNull();
  });

  it("render danh sách thông báo", async () => {
    mockList.mockResolvedValue([item({ target_id: TASK_UUID, target_url: `/tasks/${TASK_UUID}` })]);
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

describe("NotificationListPage — bấm dòng đi thẳng tới đích (S20-NOTI-LISTNAV-1)", () => {
  it("đích nội bộ, chưa đọc ⇒ mark-read + navigate(target_url), KHÔNG qua trang chi tiết", async () => {
    mockMarkRead.mockResolvedValue({});
    mockList.mockResolvedValue([
      item({
        notification_id: "n-leave",
        title: "Đơn nghỉ đã duyệt",
        source_module: "LEAVE",
        target_url: `/leave/me/requests/${LEAVE_UUID}`,
      }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Đơn nghỉ đã duyệt/ }));

    // Điều hướng đồng bộ, KHÔNG chờ mark-read; mark-read chạy nền ngay sau đó.
    expect(mockNavigate).toHaveBeenCalledWith({ to: `/leave/me/requests/${LEAVE_UUID}` });
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n-leave"));
    expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/notifications/n-leave" });
  });

  it("TASK_ASSIGNED (đích /tasks/<uuid>) ⇒ mark-read + mở drawer `?task=` tại chỗ, giữ bộ lọc", async () => {
    mockMarkRead.mockResolvedValue({});
    mockList.mockResolvedValue([
      item({
        notification_id: "n-task",
        title: "Bạn được giao việc",
        event_code: "TASK_ASSIGNED",
        target_id: TASK_UUID,
        target_url: `/tasks/${TASK_UUID}`,
      }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Bạn được giao việc/ }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(lastSearchPatch({ source: "TASK" })).toEqual({ source: "TASK", task: TASK_UUID });
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n-task"));
  });

  it.each([
    ["rỗng (null)", null],
    ["chuỗi rỗng", ""],
    ["tuyệt đối", "https://evil.example.com/phish"],
    ["protocol-relative", "//evil.example.com"],
  ])("target_url %s ⇒ mở trang chi tiết như cũ", async (_label, target) => {
    mockList.mockResolvedValue([
      item({ notification_id: "n-x", title: "Thông báo hệ thống", target_url: target }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Thông báo hệ thống/ }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/notifications/n-x" });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("mark-read lỗi ⇒ vẫn điều hướng, dòng vẫn «Chưa đọc»", async () => {
    mockMarkRead.mockRejectedValue(new Error("500"));
    mockList.mockResolvedValue([
      item({ notification_id: "n-err", title: "Việc đổi hạn", target_url: "/tasks/my-tasks" }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Việc đổi hạn/ }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/my-tasks" });
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n-err"));
    const row = screen.getByTestId("noti-row");
    await waitFor(() => expect(within(row).getByText("Chưa đọc")).toBeTruthy());
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("dòng đã đọc ⇒ điều hướng, KHÔNG gọi mark-read", async () => {
    mockList.mockResolvedValue([
      item({ title: "Đã xem rồi", status: "Read", is_read: true, target_url: "/tasks/my-tasks" }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Đã xem rồi/ }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/my-tasks" });
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("thiếu quyền mark_read ⇒ vẫn điều hướng, KHÔNG gọi mark-read", async () => {
    mockUseCan.mockImplementation((action: string) => action !== "mark_read");
    mockList.mockResolvedValue([item({ title: "Không đánh dấu", target_url: "/tasks/my-tasks" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Không đánh dấu/ }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/my-tasks" });
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("nút «Chi tiết thông báo» phụ vẫn mở trang chi tiết", async () => {
    mockList.mockResolvedValue([item({ notification_id: "n-d", target_url: "/tasks/my-tasks" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Chi tiết thông báo" }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/notifications/n-d" });
    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});

describe("NotificationListPage — chip lọc trên URL (S20-NOTI-LISTNAV-1)", () => {
  it("`?source=CHAT` ⇒ API nhận source_module = CHAT, chip «Tin nhắn» đang bật", async () => {
    searchRef.current = { source: "CHAT" };
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const [query] = mockList.mock.calls[0] as [Record<string, unknown>];
    expect(query.source_module).toBe("CHAT");
    const group = screen.getByRole("group", { name: "Nguồn" });
    expect(
      within(group).getByRole("button", { name: "Tin nhắn" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(group).getByRole("button", { name: "Tất cả" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("`?priority=Urgent&page=2` ⇒ API nhận priority + page", async () => {
    searchRef.current = { priority: "Urgent", page: 2 };
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const [query] = mockList.mock.calls[0] as [Record<string, unknown>];
    expect(query).toMatchObject({ priority: "Urgent", page: 2 });
  });

  it("tham số rác ⇒ không vỡ trang, bỏ qua", async () => {
    searchRef.current = { source: "HR", priority: "xyz", page: "abc", status: 7 };
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const [query] = mockList.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({ page: 1, per_page: 20 });
  });

  it("bấm chip «Mục tiêu» ⇒ ghi `source=GOAL` lên URL, về trang 1, giữ tham số khác", async () => {
    searchRef.current = { page: 3 };
    mockList.mockResolvedValue([]);
    renderPage();
    const group = screen.getByRole("group", { name: "Nguồn" });
    fireEvent.click(within(group).getByRole("button", { name: "Mục tiêu" }));

    expect(lastSearchPatch({ page: 3, task: TASK_UUID })).toEqual({
      task: TASK_UUID,
      source: "GOAL",
    });
  });

  it("chip «Tất cả» nguồn ⇒ bỏ `source`", async () => {
    searchRef.current = { source: "LEAVE" };
    mockList.mockResolvedValue([]);
    renderPage();
    const group = screen.getByRole("group", { name: "Nguồn" });
    fireEvent.click(within(group).getByRole("button", { name: "Tất cả" }));

    expect(lastSearchPatch({ source: "LEAVE", priority: "High" })).toEqual({ priority: "High" });
  });

  it("bấm chip mức «Cao» ⇒ ghi `priority=High`", async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    const group = screen.getByRole("group", { name: "Mức ưu tiên" });
    fireEvent.click(within(group).getByRole("button", { name: "Cao" }));

    expect(lastSearchPatch({})).toEqual({ priority: "High" });
  });

  it("lọc rỗng ⇒ «Không có thông báo nào trong mục này» + «Bỏ lọc» xoá bộ lọc", async () => {
    searchRef.current = { source: "CHAT", priority: "Low" };
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Không có thông báo nào trong mục này")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    expect(lastSearchPatch({ source: "CHAT", priority: "Low", task: TASK_UUID })).toEqual({
      task: TASK_UUID,
    });
  });
});

describe("NotificationListPage — đánh dấu đã đọc theo bộ lọc (S20-NOTI-LISTNAV-1)", () => {
  it("không lọc ⇒ «Đánh dấu tất cả đã đọc» gọi mark-all-read không điều kiện", async () => {
    mockMarkAllRead.mockResolvedValue({});
    mockList.mockResolvedValue([item({})]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Đánh dấu tất cả đã đọc" }));

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalledTimes(1));
    expect(mockMarkAllRead.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("chỉ lọc nguồn ⇒ mark-all-read theo source_module (endpoint hỗ trợ)", async () => {
    searchRef.current = { source: "TASK" };
    mockMarkAllRead.mockResolvedValue({});
    mockList.mockResolvedValue([item({})]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Đánh dấu đã đọc tất cả trong bộ lọc này" }),
    );

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalledWith({ source_module: "TASK" }));
    expect(screen.queryByRole("button", { name: "Đánh dấu tất cả đã đọc" })).toBeNull();
  });

  it("có lọc mức ưu tiên ⇒ chỉ đánh dấu các dòng chưa đọc TRONG TRANG (endpoint không lọc priority)", async () => {
    searchRef.current = { priority: "High" };
    mockMarkRead.mockResolvedValue({});
    mockList.mockResolvedValue([
      item({ notification_id: "u1", title: "Việc A", priority: "High" }),
      item({
        notification_id: "r1",
        title: "Việc B",
        priority: "High",
        status: "Read",
        is_read: true,
      }),
      item({ notification_id: "u2", title: "Việc C", priority: "High" }),
    ]);
    renderPage();
    // Chờ dữ liệu: lúc đang tải nút bị vô hiệu (chưa có dòng nào).
    await screen.findByRole("button", { name: /^Việc C/ });
    fireEvent.click(await screen.findByRole("button", { name: "Đánh dấu đã đọc trong trang này" }));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledTimes(2));
    expect(mockMarkRead).toHaveBeenCalledWith("u1");
    expect(mockMarkRead).toHaveBeenCalledWith("u2");
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  it("lọc mức ưu tiên, trang không còn dòng chưa đọc ⇒ nút đánh dấu trong trang bị vô hiệu", async () => {
    searchRef.current = { priority: "Low" };
    mockList.mockResolvedValue([
      item({ title: "Thông báo đã xem", priority: "Low", status: "Read", is_read: true }),
    ]);
    renderPage();
    await screen.findByRole("button", { name: /^Thông báo đã xem/ });
    const button = await screen.findByRole("button", { name: "Đánh dấu đã đọc trong trang này" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
