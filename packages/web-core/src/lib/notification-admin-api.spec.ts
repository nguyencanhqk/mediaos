/**
 * notificationAdminApi — contract/URL boundary tests (S4-FE-NOTI-2).
 *
 * KHÔNG mock ở tầng transport thật; chỉ mock `apiFetch` tại ranh giới `./api-client` (cùng pattern
 * my-notification-api.spec.ts / hr-audit-api.spec.ts / leave-api.spec.ts) — `buildQueryString` (từ
 * `./api-params`) GIỮ THẬT để kiểm chứng listEvents/updateEvent gọi ĐÚNG URL/method/query-string/body
 * THẬT của NotificationAdminController (NOTI-API-301 GET /notifications/events ·
 * NOTI-API-302 PATCH /notifications/events/:id, S4-NOTI-BE-3/BE-4). Đây là bài test TÁCH BIỆT với FE
 * page spec — phủ code THẬT của notification-admin-api.ts (URL, query-string, body PATCH).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationAdminApi } from "./notification-admin-api";
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
