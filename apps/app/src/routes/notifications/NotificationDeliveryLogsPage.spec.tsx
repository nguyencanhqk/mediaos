// @vitest-environment jsdom
/**
 * [deny-path] NotificationDeliveryLogsPage — S4-FE-NOTI-3.
 *
 * Gate: view:notification-delivery-log (cặp seed thật mig 0481, is_sensitive=TRUE, company-admin scope
 * Company). Trang dùng useCanExact (KHÔNG wildcard fallback) — deny-path mock useCanExact=false.
 *  - THIẾU quyền → forbidden EmptyState, KHÔNG gọi notificationDeliveryLogApi.list.
 *  - Có quyền → list render; loading/error/empty states; filter channel/status → refetch với query param.
 * BẤT BIẾN #2 (APPEND-ONLY): page KHÔNG có nút sửa/xoá/retry (server chỉ có route GET) — assert KHÔNG có
 * testid mutate nào render. BẤT BIẾN #3: DTO notificationDeliveryLogAdminItemSchema WHITELIST — test dùng
 * field an toàn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  notificationDeliveryLogApi: {
    list: vi.fn(),
  },
  notificationKeys: {
    deliveryLogs: (params?: unknown) => ["notifications", "delivery-logs", params],
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import {
  useCanExact,
  notificationDeliveryLogApi,
  type NotificationDeliveryLogAdminItem,
} from "@mediaos/web-core";
import { NotificationDeliveryLogsPage } from "./NotificationDeliveryLogsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockList = notificationDeliveryLogApi.list as ReturnType<typeof vi.fn>;

const LOG: NotificationDeliveryLogAdminItem = {
  id: "dlog-1",
  notification_id: "noti-1",
  recipient_user_id: "user-001",
  channel: "EMAIL",
  provider: "ses",
  delivery_status: "Delivered",
  attempt_no: 1,
  max_attempts: 3,
  error_code: null,
  error_message: null,
  sent_at: "2026-06-25T10:00:00.000Z",
  failed_at: null,
  created_at: "2026-06-25T10:00:00.000Z",
};

const FAILED_LOG: NotificationDeliveryLogAdminItem = {
  ...LOG,
  id: "dlog-2",
  channel: "PUSH",
  delivery_status: "Failed",
  error_code: "PROVIDER_TIMEOUT",
  error_message: "Provider timed out",
  sent_at: null,
  failed_at: "2026-06-25T10:05:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <NotificationDeliveryLogsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationDeliveryLogsPage", () => {
  it("[deny] no view:notification-delivery-log → forbidden EmptyState + list NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("notification-delivery-logs-forbidden")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("view → renders rows (masked DTO fields only) + NO mutate/retry controls (append-only)", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue([LOG, FAILED_LOG]);

    renderPage(buildQC());

    await waitFor(() => {
      const table = document.querySelector("table") as HTMLTableElement;
      expect(within(table).getByText("EMAIL")).toBeInTheDocument();
    });
    const table = document.querySelector("table") as HTMLTableElement;
    expect(within(table).getByText("Provider timed out")).toBeInTheDocument();
    // BẤT BIẾN #2: append-only viewer — KHÔNG nút sửa/xoá/retry.
    expect(
      screen.queryByRole("button", { name: /sửa|xoá|retry|gửi lại/i }),
    ).not.toBeInTheDocument();
  });

  it("shows table while fetching (loading state)", () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockReturnValue(new Promise(() => {}));
    renderPage(buildQC());
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  it("shows error EmptyState when notificationDeliveryLogApi.list fails", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải nhật ký gửi thông báo/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/không có nhật ký gửi thông báo/i).length).toBeGreaterThan(0);
    });
  });

  it("filter by delivery_status → re-queries with delivery_status param", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockList.mockResolvedValue([LOG]);

    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("EMAIL")).toBeInTheDocument());

    const statusSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(statusSelect, { target: { value: "Failed" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const calls = mockList.mock.calls;
      expect(
        calls.some((c) => (c[0] as { delivery_status?: string })?.delivery_status === "Failed"),
      ).toBe(true);
    });
  });
});
