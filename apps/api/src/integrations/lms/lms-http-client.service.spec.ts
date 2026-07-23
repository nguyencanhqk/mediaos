import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmsHttpClient } from "./lms-http-client.service";

// Token giả ghép chuỗi (>=32) — tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const TOKEN = ["test-lms-sync-token", "unit-only-not-a-real-secret-pad-32ch"].join("-");
const BASE = "https://lms.example.test";

describe("LmsHttpClient", () => {
  const saved = { base: process.env.LMS_BASE_URL, token: process.env.LMS_SYNC_TOKEN };
  afterEach(() => {
    process.env.LMS_BASE_URL = saved.base;
    process.env.LMS_SYNC_TOKEN = saved.token;
    vi.restoreAllMocks();
  });

  it("isEnabled=true chỉ khi có ĐỦ base URL + token", () => {
    process.env.LMS_BASE_URL = BASE;
    process.env.LMS_SYNC_TOKEN = TOKEN;
    expect(new LmsHttpClient().isEnabled()).toBe(true);

    process.env.LMS_SYNC_TOKEN = "";
    expect(new LmsHttpClient().isEnabled()).toBe(false);
    delete process.env.LMS_BASE_URL;
    process.env.LMS_SYNC_TOKEN = TOKEN;
    expect(new LmsHttpClient().isEnabled()).toBe(false);
  });

  describe("syncUsers", () => {
    beforeEach(() => {
      process.env.LMS_BASE_URL = `${BASE}/`; // client tự cắt "/"
      process.env.LMS_SYNC_TOKEN = TOKEN;
    });

    it("POST /api/admin/sync-users body {users} + Bearer đúng", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      await new LmsHttpClient().syncUsers([{ email: "a@b.co", name: "A", active: true }]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/api/admin/sync-users`);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(init?.body as string)).toEqual({
        users: [{ email: "a@b.co", name: "A", active: true }],
      });
    });

    it("!ok (HTTP 500) → throw (để outbox retry); KHÔNG đọc body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("secret-echo", { status: 500 }));
      await expect(new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }])).rejects.toThrow(
        /HTTP 500/,
      );
    });

    it("network error/timeout → throw", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aborted"));
      await expect(new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }])).rejects.toThrow(
        /network error/,
      );
    });

    it("chưa cấu hình → throw (gọi nhầm lúc tắt = lỗi lập trình, không im lặng)", async () => {
      delete process.env.LMS_SYNC_TOKEN;
      await expect(new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }])).rejects.toThrow(
        /chưa cấu hình/,
      );
    });

    it("users rỗng → KHÔNG gọi fetch", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      await new LmsHttpClient().syncUsers([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
