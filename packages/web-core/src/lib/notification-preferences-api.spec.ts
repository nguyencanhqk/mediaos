/**
 * notification-preferences-api.spec.ts — contract/URL boundary tests (S5-ME-FE-3, ME-SCREEN-013).
 *
 * Mock `apiFetch` tại ranh giới `./api-client` (cùng pattern me-api.spec.ts) để kiểm chứng
 * notificationPreferencesApi gọi ĐÚNG path/method/body + xử lý QUIRK BE (PUT trả mảng) + DENY-PATH:
 * BE 400 khi cố tắt loại mandatory → lỗi PHẢI nổi lên caller (KHÔNG bị nuốt — silent-failure-hunter).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationPreferencesApi } from "./notification-preferences-api";
import { ApiError } from "./api-client";
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

const PREF_ROW = {
  id: "pref-1",
  companyId: "co-1",
  userId: "u-1",
  notificationType: "general" as const,
  enabled: true,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("notificationPreferencesApi", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("list() → GET /notifications/preferences, không method/body override", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([PREF_ROW] as never);
    const result = await notificationPreferencesApi.list();
    const [url, schema, init] = lastCall();
    expect(url).toBe("/notifications/preferences");
    expect(schema).toBeDefined();
    expect(init).toBeUndefined();
    expect(result).toEqual([PREF_ROW]);
  });

  it("upsert(body) → PUT /notifications/preferences kèm body {notificationType,enabled}, bóc phần tử đầu của mảng trả về", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([PREF_ROW] as never);
    const result = await notificationPreferencesApi.upsert({
      notificationType: "general",
      enabled: true,
    });
    const [url, , init] = lastCall();
    expect(url).toBe("/notifications/preferences");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ notificationType: "general", enabled: true });
    expect(result).toEqual(PREF_ROW);
  });

  it("upsert() mảng rỗng (contract drift) → ném lỗi tường minh, KHÔNG trả undefined im lặng", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await expect(
      notificationPreferencesApi.upsert({ notificationType: "general", enabled: true }),
    ).rejects.toThrow(/contract drift/);
  });

  it("DENY-PATH: upsert(enabled=false) loại mandatory → BE 400 → lỗi nổi lên caller (KHÔNG bị nuốt)", async () => {
    const beError = new ApiError(400, "HTTP_ERROR", "mandatory notification cannot be disabled");
    vi.mocked(apiClient.apiFetch).mockRejectedValue(beError);

    await expect(
      notificationPreferencesApi.upsert({ notificationType: "task_assigned", enabled: false }),
    ).rejects.toBe(beError);
  });
});
