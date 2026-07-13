/**
 * notificationAdminApi + notificationDeliveryLogApi — contract/URL boundary tests (S4-FE-NOTI-2/3).
 *
 * KHÔNG mock ở tầng transport thật; chỉ mock `apiFetch` tại ranh giới `./api-client` (cùng pattern
 * my-notification-api.spec.ts / hr-audit-api.spec.ts / leave-api.spec.ts) — `buildQueryString` (từ
 * `./api-params`) GIỮ THẬT để kiểm chứng listEvents/updateEvent + delivery-logs list gọi ĐÚNG
 * URL/method/query-string/body THẬT của NotificationAdminController (NOTI-API-301 GET
 * /notifications/events · NOTI-API-302 PATCH /notifications/events/:id · NOTI-API-401 GET
 * /notifications/delivery-logs, S4-NOTI-BE-3/BE-4). Test TÁCH BIỆT với FE page spec.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationAdminApi, notificationDeliveryLogApi } from "./notification-admin-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, unknown, { method?: string; body?: string }?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
});

describe("notificationAdminApi — route thật (S4-NOTI-BE-3/BE-4)", () => {
  it("listEvents() → GET /notifications/events (KHÔNG gắn query khi rỗng)", async () => {
    await notificationAdminApi.listEvents();
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/events");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("listEvents(query) → gắn query-string module_code/event_code/enabled/search/per_page", async () => {
    await notificationAdminApi.listEvents({
      module_code: "TASK",
      event_code: "TASK-EVENT-001",
      enabled: true,
      search: "assigned",
      per_page: 100,
    });
    const [url] = lastCall();
    expect(url.startsWith("/notifications/events?")).toBe(true);
    expect(url).toContain("module_code=TASK");
    expect(url).toContain("event_code=TASK-EVENT-001");
    expect(url).toContain("enabled=true");
    expect(url).toContain("search=assigned");
    expect(url).toContain("per_page=100");
  });

  it("updateEvent(id, {is_enabled}) → PATCH /notifications/events/:id + body JSON.stringify", async () => {
    await notificationAdminApi.updateEvent("evt-1", { is_enabled: false });
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/events/evt-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ is_enabled: false }));
  });
});

// ---------------------------------------------------------------------------
// notificationAdminApi — listTemplates/getTemplate/updateTemplate (S4-FE-NOTI-4, NOTI-API-303,
// S4-NOTI-BE-5 GET /notifications/templates · BE-3/BE-4 GET/PATCH /notifications/templates/:id).
// ---------------------------------------------------------------------------

describe("notificationAdminApi — templates (S4-FE-NOTI-4 / S4-NOTI-BE-5)", () => {
  it("listTemplates() → GET /notifications/templates (KHÔNG gắn query khi rỗng)", async () => {
    await notificationAdminApi.listTemplates();
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/templates");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("listTemplates(query) → gắn query-string event_id/event_code/channel/locale/per_page", async () => {
    await notificationAdminApi.listTemplates({
      event_id: "11111111-1111-1111-1111-111111111111",
      event_code: "TASK_ASSIGNED",
      channel: "EMAIL",
      locale: "vi-VN",
      per_page: 100,
    });
    const [url] = lastCall();
    expect(url.startsWith("/notifications/templates?")).toBe(true);
    expect(url).toContain("event_id=11111111-1111-1111-1111-111111111111");
    expect(url).toContain("event_code=TASK_ASSIGNED");
    expect(url).toContain("channel=EMAIL");
    expect(url).toContain("locale=vi-VN");
    expect(url).toContain("per_page=100");
  });

  it("getTemplate(id) → GET /notifications/templates/:id", async () => {
    await notificationAdminApi.getTemplate("tpl-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/templates/tpl-1");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("updateTemplate(id, body) → PATCH /notifications/templates/:id + body JSON.stringify", async () => {
    await notificationAdminApi.updateTemplate("tpl-1", {
      title_template: "Tiêu đề mới",
      body_template: "Nội dung mới {{name}}",
    });
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/templates/tpl-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(
      JSON.stringify({ title_template: "Tiêu đề mới", body_template: "Nội dung mới {{name}}" }),
    );
  });
});

// ---------------------------------------------------------------------------
// notificationDeliveryLogApi — S4-FE-NOTI-3 (URL + query string; append-only viewer).
// ---------------------------------------------------------------------------

describe("notificationDeliveryLogApi (URL + query string; append-only — KHÔNG mutate method)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("list() không tham số → GET /notifications/delivery-logs (không query string)", async () => {
    await notificationDeliveryLogApi.list();
    const [url] = lastCall();
    expect(url).toBe("/notifications/delivery-logs");
  });

  it("list(params) → gắn query string filter + phân trang, KHÔNG companyId", async () => {
    await notificationDeliveryLogApi.list({
      page: 2,
      per_page: 20,
      channel: "Email",
      delivery_status: "Failed",
      recipient_user_id: "11111111-1111-1111-1111-111111111111",
    });
    const [url] = lastCall();
    expect(url).toContain("/notifications/delivery-logs?");
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=20");
    expect(url).toContain("channel=Email");
    expect(url).toContain("delivery_status=Failed");
    expect(url).toContain("recipient_user_id=11111111-1111-1111-1111-111111111111");
    expect(url).not.toContain("companyId");
    expect(url).not.toContain("company_id");
  });

  it("append-only — module KHÔNG export create/update/remove", () => {
    expect(Object.keys(notificationDeliveryLogApi)).toEqual(["list"]);
  });
});
