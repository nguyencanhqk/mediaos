/**
 * myNotificationApi — contract/URL boundary tests (S4-FE-NOTI-1).
 *
 * KHÔNG mock ở tầng transport thật; chỉ mock `apiFetch` tại ranh giới `./api-client` (cùng pattern
 * hr-audit-api.spec.ts / leave-api.spec.ts) để kiểm chứng mỗi hàm gọi ĐÚNG URL/method THẬT của
 * MyNotificationsController (S4-NOTI-BE-1) — KHÔNG đoán route cũ (PATCH /notifications/:id/read đã gỡ).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { myNotificationApi } from "./my-notification-api";
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

describe("myNotificationApi — route thật (S4-NOTI-BE-1)", () => {
  it("list() → GET /notifications (KHÔNG /notifications/dropdown)", async () => {
    await myNotificationApi.list();
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("list({page,per_page,status}) → gắn query string", async () => {
    await myNotificationApi.list({ page: 2, per_page: 10, status: "Unread" });
    const [url] = lastCall();
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=10");
    expect(url).toContain("status=Unread");
  });

  it("dropdown() → GET /notifications/dropdown (route TĨNH, KHÔNG bị :id nuốt)", async () => {
    await myNotificationApi.dropdown({ limit: 5 });
    const [url] = lastCall();
    expect(url).toBe("/notifications/dropdown?limit=5");
  });

  it("unreadCount() → GET /notifications/unread-count (KHÔNG gọi list() để đếm)", async () => {
    await myNotificationApi.unreadCount();
    const [url] = lastCall();
    expect(url).toBe("/notifications/unread-count");
  });

  it("detail(id) → GET /notifications/:id", async () => {
    await myNotificationApi.detail("noti-1");
    const [url] = lastCall();
    expect(url).toBe("/notifications/noti-1");
  });

  it("detail(id, {auto_mark_read:true}) → gắn query", async () => {
    await myNotificationApi.detail("noti-1", { auto_mark_read: true });
    const [url] = lastCall();
    expect(url).toBe("/notifications/noti-1?auto_mark_read=true");
  });

  it("markRead(id) → POST /notifications/:id/mark-read (KHÔNG PATCH /:id/read cũ)", async () => {
    await myNotificationApi.markRead("noti-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/noti-1/mark-read");
    expect(init?.method).toBe("POST");
  });

  it("markAllRead() → POST /notifications/mark-all-read (KHÔNG PATCH /read-all cũ)", async () => {
    await myNotificationApi.markAllRead();
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/mark-all-read");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
  });

  it("remove(id) → DELETE /notifications/:id", async () => {
    await myNotificationApi.remove("noti-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/noti-1");
    expect(init?.method).toBe("DELETE");
  });
});
