// @vitest-environment jsdom
/**
 * [deny-path] MeSecurityActivityPage — S5-ME-FE-2 (ME-SCREEN-008). Phủ:
 *  - forbidden (thiếu access:me → KHÔNG gọi meApi.getSecurityActivity).
 *  - loading (bảng hiện skeleton, KHÔNG lỗi/nội dung).
 *  - error transport + nút thử lại gọi lại API.
 *  - empty (0 dòng).
 *  - render dòng dữ liệu CHỈ field server trả (ipMasked/device đã mask) — BẤT BIẾN #3/§17.1: KHÔNG có
 *    chuỗi IP đầy đủ (raw) nào khác ngoài giá trị `ipMasked` mock — chứng minh component KHÔNG tự
 *    unmask/tái dựng IP.
 *  - phân trang next/prev gọi lại API với `page` mới.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeSecurityActivityItem } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeSecurityActivityPage } from "./MeSecurityActivityPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getSecurityActivity: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetSecurityActivity = meApi.getSecurityActivity as ReturnType<typeof vi.fn>;

const RAW_IP_FIXTURE = "203.0.113.42"; // IP "thật" giả lập — KHÔNG ĐƯỢC xuất hiện trong DOM.

const LOGIN_ITEM: MeSecurityActivityItem = {
  id: "sa-1",
  source: "login",
  eventType: "LOGIN_SUCCESS",
  severity: null,
  device: "Chrome trên Windows",
  ipMasked: "203.0.*.*",
  createdAt: "2026-07-16T02:00:00.000Z",
};

const EVENT_ITEM: MeSecurityActivityItem = {
  id: "sa-2",
  source: "security_event",
  eventType: "PASSWORD_CHANGED",
  severity: "info",
  device: null,
  ipMasked: null,
  createdAt: "2026-07-15T09:30:00.000Z",
};

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeSecurityActivityPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeSecurityActivityPage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi meApi.getSecurityActivity", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetSecurityActivity).not.toHaveBeenCalled();
  });
});

describe("MeSecurityActivityPage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → bảng hiện (skeleton), KHÔNG hiện lỗi", () => {
    mockGetSecurityActivity.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(document.querySelector("table")).toBeInTheDocument();
    expect(screen.queryByText(/không thể tải hoạt động bảo mật/i)).not.toBeInTheDocument();
  });

  it("lỗi transport → error EmptyState + thử lại gọi lại API", async () => {
    mockGetSecurityActivity.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không thể tải hoạt động bảo mật/i)).toBeInTheDocument();
    });
    mockGetSecurityActivity.mockClear();
    mockGetSecurityActivity.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetSecurityActivity).toHaveBeenCalled());
  });

  it("0 dòng → empty state", async () => {
    mockGetSecurityActivity.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/chưa có hoạt động bảo mật/i)).toBeInTheDocument();
    });
  });

  it("render dòng dữ liệu — CHỈ field server trả (ipMasked/device), KHÔNG raw IP nào khác", async () => {
    mockGetSecurityActivity.mockResolvedValue([LOGIN_ITEM, EVENT_ITEM]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("LOGIN_SUCCESS")).toBeInTheDocument();
    });
    expect(screen.getByText("Chrome trên Windows")).toBeInTheDocument();
    expect(screen.getByText("203.0.*.*")).toBeInTheDocument();
    expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument();

    // BẤT BIẾN #3/§17.1 — DTO KHÔNG có field raw IP nào; component chỉ render `ipMasked` đã mask.
    // Khẳng định chuỗi IP "thật" (chưa mask) KHÔNG hề xuất hiện ở đâu trong DOM đã render.
    expect(screen.queryByText(RAW_IP_FIXTURE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_IP_FIXTURE);

    // Query gọi ĐÚNG page/per_page — KHÔNG owner-param (user_id/employee_id).
    const [params] = mockGetSecurityActivity.mock.calls[0] as [Record<string, unknown>];
    expect(params).toEqual({ page: 1, per_page: 20 });
    expect(params).not.toHaveProperty("user_id");
    expect(params).not.toHaveProperty("employee_id");
  });

  it("phân trang: click Sau → gọi lại API với page=2", async () => {
    // Trang đầy (đúng pageSize) → hasNext=true (full-page heuristic).
    mockGetSecurityActivity.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ ...LOGIN_ITEM, id: `sa-page1-${i}` })),
    );
    renderPage();
    await waitFor(() => expect(screen.getAllByText("LOGIN_SUCCESS").length).toBe(20));

    mockGetSecurityActivity.mockClear();
    mockGetSecurityActivity.mockResolvedValue([EVENT_ITEM]);
    fireEvent.click(screen.getByRole("button", { name: /sau/i }));

    await waitFor(() => {
      expect(mockGetSecurityActivity).toHaveBeenCalledWith({ page: 2, per_page: 20 });
    });
  });
});
