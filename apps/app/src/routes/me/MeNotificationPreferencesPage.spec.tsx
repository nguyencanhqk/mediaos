// @vitest-environment jsdom
/**
 * MeNotificationPreferencesPage tests (S5-ME-FE-3, ME-SCREEN-013, SPEC-09 §10.7). Phủ: forbidden ·
 * loading · lỗi transport list + thử lại · nhóm hiển thị đủ + trạng thái mặc định enabled=true khi chưa
 * có dòng override (opt-out model) · toggle IN-APP thành công (PUT đúng payload) · DENY-PATH mandatory:
 * PUT 400 → checkbox REVERT về enabled (KHÔNG hiển thị tắt giả) + hiện giải thích + khoá control · lỗi
 * chung (không phải mandatory) → hiện thông điệp lỗi RIÊNG dòng, KHÔNG khoá vĩnh viễn · kênh Email/Push
 * LUÔN unchecked+disabled+"chưa hỗ trợ" (KHÔNG giả lập đã bật).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { NotificationPreferenceDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeNotificationPreferencesPage } from "./MeNotificationPreferencesPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    notificationPreferencesApi: { list: vi.fn(), upsert: vi.fn() },
  };
});

import { ApiError, notificationPreferencesApi } from "@mediaos/web-core";
const mockList = notificationPreferencesApi.list as ReturnType<typeof vi.fn>;
const mockUpsert = notificationPreferencesApi.upsert as ReturnType<typeof vi.fn>;

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
        <MeNotificationPreferencesPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const ROW_TASK_ASSIGNED: NotificationPreferenceDto = {
  id: "p1",
  companyId: "co1",
  userId: "u1",
  notificationType: "task_assigned",
  enabled: true,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeNotificationPreferencesPage — gate (access:me)", () => {
  it("thiếu access:me → forbidden, KHÔNG gọi notificationPreferencesApi.list", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe("MeNotificationPreferencesPage — data states (có access:me)", () => {
  beforeEach(() => setCaps({ "access:me": true }));

  it("loading → skeleton, KHÔNG hiện nhóm", () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText("Giao task")).not.toBeInTheDocument();
  });

  it("lỗi transport → error + thử lại gọi lại API", async () => {
    mockList.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không tải được tuỳ chọn thông báo/i)).toBeInTheDocument();
    });
    mockList.mockClear();
    mockList.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockList).toHaveBeenCalled());
  });

  it("render đủ 4 nhóm + loại chưa có dòng override → mặc định enabled=true (opt-out)", async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Giao task")).toBeInTheDocument();
    });
    expect(screen.getByText("Công việc & cộng tác")).toBeInTheDocument();
    expect(screen.getByText("Phê duyệt")).toBeInTheDocument();
    expect(screen.getByText("Trò chuyện & cuộc họp")).toBeInTheDocument();
    expect(screen.getByText("Khác")).toBeInTheDocument();

    const inAppCheckbox = screen.getAllByRole("checkbox", { name: "Trong ứng dụng" })[0];
    expect((inAppCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it("kênh Email/Push LUÔN unchecked+disabled+'chưa hỗ trợ' (KHÔNG giả lập đã bật)", async () => {
    mockList.mockResolvedValue([ROW_TASK_ASSIGNED]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Giao task")).toBeInTheDocument();
    });
    const emailCheckboxes = screen.getAllByRole("checkbox", { name: "Email" });
    const pushCheckboxes = screen.getAllByRole("checkbox", { name: "Push" });
    expect(emailCheckboxes.length).toBeGreaterThan(0);
    for (const cb of [...emailCheckboxes, ...pushCheckboxes]) {
      expect((cb as HTMLInputElement).checked).toBe(false);
      expect((cb as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getAllByText(/chưa hỗ trợ/i).length).toBeGreaterThan(0);
  });

  it("toggle In-app thành công → PUT đúng payload + cache cập nhật", async () => {
    mockList.mockResolvedValue([{ ...ROW_TASK_ASSIGNED, enabled: true }]);
    mockUpsert.mockResolvedValue({ ...ROW_TASK_ASSIGNED, enabled: false });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Giao task")).toBeInTheDocument();
    });

    const inAppCheckbox = screen.getAllByRole("checkbox", { name: "Trong ứng dụng" })[0];
    fireEvent.click(inAppCheckbox);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalled();
    });
    expect(mockUpsert.mock.calls[0][0]).toEqual({
      notificationType: "task_assigned",
      enabled: false,
    });
  });

  it("DENY-PATH mandatory: tắt In-app → PUT 400 → checkbox REVERT về enabled + hiện giải thích + khoá", async () => {
    mockList.mockResolvedValue([{ ...ROW_TASK_ASSIGNED, enabled: true }]);
    mockUpsert.mockRejectedValue(
      new ApiError(400, "HTTP_ERROR", "mandatory notification cannot be disabled"),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Giao task")).toBeInTheDocument();
    });

    const inAppCheckbox = screen.getAllByRole("checkbox", {
      name: "Trong ứng dụng",
    })[0] as HTMLInputElement;
    fireEvent.click(inAppCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/không thể tắt vì lý do bảo mật\/vận hành/i)).toBeInTheDocument();
    });
    // REVERT — KHÔNG hiển thị tắt giả (checked vẫn true, control khoá).
    expect(inAppCheckbox.checked).toBe(true);
    expect(inAppCheckbox.disabled).toBe(true);
  });

  it("lỗi chung (không phải mandatory) → hiện thông điệp lỗi riêng dòng, KHÔNG khoá control", async () => {
    mockList.mockResolvedValue([{ ...ROW_TASK_ASSIGNED, enabled: true }]);
    mockUpsert.mockRejectedValue(new Error("network timeout"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Giao task")).toBeInTheDocument();
    });

    const inAppCheckbox = screen.getAllByRole("checkbox", {
      name: "Trong ứng dụng",
    })[0] as HTMLInputElement;
    fireEvent.click(inAppCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/không thể cập nhật, vui lòng thử lại/i)).toBeInTheDocument();
    });
    expect(inAppCheckbox.checked).toBe(true);
    expect(inAppCheckbox.disabled).toBe(false);
  });
});
