// @vitest-environment jsdom
/**
 * NotificationTemplatesPage tests (S4-FE-NOTI-4, UI-NOTI-SCREEN-005 / SPEC-08 §13.4 NOTI-SCREEN-006).
 * Phủ: [deny-path] useCanExact('view','notification-template')=false → forbidden + listTemplates KHÔNG
 * gọi · render danh mục (event_id thô khi thiếu view:notification-config) · enrichment event_code khi
 * CÓ view:notification-config · gate nút Sửa (update:notification-template thiếu → ẨN, kể cả
 * PermissionGate bọc dialog) · sửa + submit → updateTemplate đúng payload · error/empty state ·
 * deep-link `?event=` khởi tạo filter.
 *
 * Dùng REAL useAuthStore (mirror DashboardConfigPage.spec.tsx) — KHÔNG mock useCanExact/PermissionGate:
 * cả 2 đọc CÙNG store `capabilities`, mock rời sẽ lệch với PermissionGate thật ⇒ dialog "Sửa" không bao
 * giờ mở được trong test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore, notificationAdminApi } from "@mediaos/web-core";
import type { NotificationTemplateAdminItem, NotificationEventAdminItem } from "@mediaos/contracts";
import i18n from "@/i18n";
import { NotificationTemplatesPage } from "./NotificationTemplatesPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    notificationAdminApi: {
      ...actual.notificationAdminApi,
      listTemplates: vi.fn(),
      updateTemplate: vi.fn(),
      listEvents: vi.fn(),
    },
  };
});

const mockListTemplates = notificationAdminApi.listTemplates as ReturnType<typeof vi.fn>;
const mockUpdateTemplate = notificationAdminApi.updateTemplate as ReturnType<typeof vi.fn>;
const mockListEvents = notificationAdminApi.listEvents as ReturnType<typeof vi.fn>;

const TEMPLATE: NotificationTemplateAdminItem = {
  id: "tpl-1",
  company_id: null,
  is_company_override: false,
  event_id: "11111111-1111-1111-1111-111111111111",
  template_code: "TASK_ASSIGNED_IN_APP",
  channel: "IN_APP",
  locale: "vi-VN",
  title_template: "Bạn được giao việc {{task_name}}",
  body_template: "Nội dung: {{task_name}}",
  short_body_template: null,
  action_label_template: null,
  target_url_template: null,
  variables_schema: null,
  status: "Active",
  is_default: true,
  version: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

const EVENT: NotificationEventAdminItem = {
  id: "11111111-1111-1111-1111-111111111111",
  company_id: null,
  is_company_override: false,
  module_code: "TASK",
  event_code: "TASK_ASSIGNED",
  event_name: "Giao việc",
  description: null,
  notification_type: "Task",
  default_priority: "Normal",
  default_channels: ["IN_APP"],
  dedupe_strategy: "None",
  dedupe_window_seconds: null,
  is_enabled: true,
  is_system_event: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "admin@demo.local",
      fullName: "Admin",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <NotificationTemplatesPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCapabilities();
  mockListEvents.mockResolvedValue([]);
  window.history.pushState({}, "", "/notifications/templates");
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("NotificationTemplatesPage — gate", () => {
  it("[deny-path] thiếu view:notification-template → forbidden EmptyState, KHÔNG gọi listTemplates", () => {
    setCapabilities({});
    renderPage();

    expect(screen.getByText("Không có quyền xem mẫu thông báo")).toBeInTheDocument();
    expect(mockListTemplates).not.toHaveBeenCalled();
  });

  it("canView=true, canUpdate=false → render danh sách nhưng ẨN nút Sửa", async () => {
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("TASK_ASSIGNED_IN_APP")).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`template-edit-btn-${TEMPLATE.id}`)).not.toBeInTheDocument();
  });
});

describe("NotificationTemplatesPage — data states", () => {
  it("empty → EmptyState danh mục trống", async () => {
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Chưa có mẫu thông báo nào")).toBeInTheDocument();
    });
  });

  it("lỗi fetch → error EmptyState + nút thử lại", async () => {
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockRejectedValue(new Error("network"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Không thể tải danh mục mẫu thông báo")).toBeInTheDocument();
    });
  });

  it("render danh mục — event_id THÔ khi thiếu view:notification-config (KHÔNG tự gọi listEvents)", async () => {
    setCapabilities({ "view:notification-template": true, "update:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("TASK_ASSIGNED_IN_APP")).toBeInTheDocument();
    });
    expect(screen.getByText(TEMPLATE.event_id)).toBeInTheDocument();
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("enrichment: CÓ view:notification-config → gọi listEvents + hiện event_code thay vì event_id thô", async () => {
    setCapabilities({
      "view:notification-template": true,
      "view:notification-config": true,
    });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockListEvents.mockResolvedValue([EVENT]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("TASK_ASSIGNED")).toBeInTheDocument();
    });
    expect(screen.queryByText(TEMPLATE.event_id)).not.toBeInTheDocument();
    expect(mockListEvents).toHaveBeenCalled();
  });

  it("badge scope: is_company_override=false → 'Toàn hệ thống'; is_default=true → badge Mặc định", async () => {
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Toàn hệ thống")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Mặc định").length).toBeGreaterThan(0);
  });
});

describe("NotificationTemplatesPage — deep-link ?event=", () => {
  it("window.location.search có ?event=X → khởi tạo filter event_code=X, gọi listTemplates đúng query", async () => {
    window.history.pushState({}, "", "/notifications/templates?event=TASK_ASSIGNED");
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    renderPage();

    await waitFor(() => {
      expect(mockListTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ event_code: "TASK_ASSIGNED" }),
      );
    });
    expect(screen.getByDisplayValue("TASK_ASSIGNED")).toBeInTheDocument();
  });
});

describe("NotificationTemplatesPage — sửa mẫu (dialog)", () => {
  it("có update:notification-template → click Sửa mở dialog qua PermissionGate + submit gọi updateTemplate đúng payload", async () => {
    setCapabilities({ "view:notification-template": true, "update:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockUpdateTemplate.mockResolvedValue({ ...TEMPLATE, title_template: "Tiêu đề mới" });
    renderPage();

    const editBtn = await screen.findByTestId(`template-edit-btn-${TEMPLATE.id}`);
    fireEvent.click(editBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const titleInput = screen.getByLabelText("Tiêu đề");
    fireEvent.change(titleInput, { target: { value: "Tiêu đề mới" } });

    fireEvent.click(screen.getByTestId("template-form-submit"));

    await waitFor(() => {
      expect(mockUpdateTemplate).toHaveBeenCalledWith("tpl-1", {
        title_template: "Tiêu đề mới",
        body_template: TEMPLATE.body_template,
        short_body_template: null,
        action_label_template: null,
        target_url_template: null,
        status: "Active",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("thiếu update:notification-template → PermissionGate chặn dialog dù editing state được set (defense-in-depth)", async () => {
    setCapabilities({ "view:notification-template": true });
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("TASK_ASSIGNED_IN_APP")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`template-edit-btn-${TEMPLATE.id}`)).not.toBeInTheDocument();
  });
});
