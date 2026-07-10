// @vitest-environment jsdom
/**
 * NotificationDetailPage tests (S4-FE-NOTI-1, NOTI-API-004).
 * Phủ: forbidden (deny-path) · loading · not-found (404) · error · render chi tiết +
 * gọi detail(id, {auto_mark_read:true}) · target_url an toàn → nút "Đi tới nội dung liên quan" điều
 * hướng qua router (route đích tự kiểm quyền) · delete gate (useCan(delete) = false → KHÔNG hiện nút xoá).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    useCan: vi.fn(),
    myNotificationApi: {
      detail: vi.fn(),
      remove: vi.fn(),
    },
    notificationKeys: {
      detail: (id: string) => ["notifications", "detail", id],
    },
    notificationInvalidation: {
      markRead: (id: string) => [
        ["notifications", "list"],
        ["notifications", "detail", id],
      ],
      remove: (id: string) => [
        ["notifications", "list"],
        ["notifications", "detail", id],
      ],
    },
  };
});

import { useCan, myNotificationApi, ApiError } from "@mediaos/web-core";
import { NotificationDetailPage } from "./NotificationDetailPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockDetail = myNotificationApi.detail as ReturnType<typeof vi.fn>;
const mockRemove = myNotificationApi.remove as ReturnType<typeof vi.fn>;

const DETAIL = {
  notification_id: "noti-1",
  title: "Đơn nghỉ đã được duyệt",
  content: "Đơn nghỉ LEAVE-001 của bạn đã được duyệt.",
  short_content: "Đơn LEAVE-001 đã được duyệt.",
  notification_type: "Leave",
  priority: "Normal",
  status: "Read",
  is_read: true,
  source_module: "LEAVE",
  event_code: "LEAVE_REQUEST_APPROVED",
  target: {
    target_module: "LEAVE",
    target_type: "leave_request",
    target_id: "req-1",
    target_url: "/leave/me/requests/req-1",
  },
  payload: null,
  created_at: "2026-07-01T09:00:00.000Z",
  read_at: "2026-07-01T09:05:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(id = "noti-1") {
  const qc = buildQC();
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <NotificationDetailPage notificationId={id} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("NotificationDetailPage — gate", () => {
  it("useCan(read, notification) = false → forbidden, KHÔNG fetch", () => {
    mockUseCan.mockReturnValue(false);
    renderPage();
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockDetail).not.toHaveBeenCalled();
  });
});

describe("NotificationDetailPage — data states", () => {
  it("gọi detail(id, {auto_mark_read:true}) VÀ render nội dung", async () => {
    mockDetail.mockResolvedValue(DETAIL);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Đơn nghỉ đã được duyệt")).toBeTruthy();
    });
    expect(mockDetail).toHaveBeenCalledWith("noti-1", { auto_mark_read: true });
  });

  it("404 → not-found EmptyState (KHÔNG error chung)", async () => {
    mockDetail.mockRejectedValue(new ApiError(404, "ERR", "not found"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tìm thấy thông báo/i)).toBeTruthy();
    });
  });

  it("lỗi khác (500) → error EmptyState + nút thử lại", async () => {
    mockDetail.mockRejectedValue(new ApiError(500, "ERR", "boom"));
    renderPage();
    // retry fn của trang (count<2) chạy exponential backoff thật trước khi isError=true → timeout dài hơn
    // mặc định (mirror LeaveRequestDetailPage.spec.tsx ghi chú "non-ApiError errors retry 2×").
    await waitFor(
      () => {
        expect(screen.getByText(/không thể tải chi tiết thông báo/i)).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("target_url an toàn → nút deep link điều hướng qua router (module gốc tự kiểm quyền)", async () => {
    mockDetail.mockResolvedValue(DETAIL);
    renderPage();
    const link = await screen.findByRole("button", { name: /đi tới nội dung liên quan/i });
    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/leave/me/requests/req-1" }),
    );
  });

  it("target.target_url = null → KHÔNG render nút deep link, hiện thông điệp thay thế", async () => {
    mockDetail.mockResolvedValue({
      ...DETAIL,
      target: { target_module: null, target_type: null, target_id: null, target_url: null },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Đơn nghỉ đã được duyệt")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /đi tới nội dung liên quan/i })).toBeNull();
    expect(screen.getByText(/không có liên kết/i)).toBeTruthy();
  });
});

describe("NotificationDetailPage — delete gate", () => {
  it("useCan(delete, notification) = false → KHÔNG hiện nút xoá", async () => {
    mockUseCan.mockImplementation((action: string) => action !== "delete");
    mockDetail.mockResolvedValue(DETAIL);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Đơn nghỉ đã được duyệt")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /^xoá$/i })).toBeNull();
  });

  it("useCan(delete, notification) = true → hiện nút xoá, click 2 lần → gọi remove(id)", async () => {
    mockDetail.mockResolvedValue(DETAIL);
    mockRemove.mockResolvedValue(undefined);
    renderPage();
    const deleteBtn = await screen.findByRole("button", { name: /^xoá$/i });
    fireEvent.click(deleteBtn);
    const confirmBtn = await screen.findByRole("button", { name: /^xoá$/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith("noti-1");
    });
  });
});
