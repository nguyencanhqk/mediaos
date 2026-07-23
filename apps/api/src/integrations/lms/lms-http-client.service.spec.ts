import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmsHttpClient } from "./lms-http-client.service";

// Token giả ghép chuỗi (>=32) — tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const TOKEN = ["test-lms-sync-token", "unit-only-not-a-real-secret-pad-32ch"].join("-");
const BASE = "https://lms.example.test";

/** users giả đủ N phần tử — bất biến tổng 6 counter kiểm theo `users.length`. */
function usersOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ email: `u${i}@b.co`, active: true }));
}

/** Response 200 mang body JSON tuỳ ý (kể cả shape sai). */
function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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
        .mockResolvedValue(okJson({ ok: true, summary: { created: 0, existing: 1 } }));
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

    // ── S5-LMS-BE-4 §5 ca 1-9: đọc summary (chỉ success path), fail-safe `unknown` ──

    it("1) body hợp lệ → trả đúng 6 counter, unknown:false", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({
          ok: true,
          summary: { created: 1, existing: 2, reactivated: 1, deactivated: 1, skipped: 0 },
        }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(5));
      expect(s).toEqual({
        created: 1,
        existing: 2,
        reactivated: 1,
        deactivated: 1,
        skipped: 0,
        alreadyDisabled: 0,
        unknown: false,
      });
    });

    it("2) body không phải JSON → unknown:true, KHÔNG throw", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<html>not json</html>", { status: 200 }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(1));
      expect(s.unknown).toBe(true);
    });

    it("2b) body null → unknown:true, KHÔNG throw", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(null));
      expect((await new LmsHttpClient().syncUsers(usersOf(1))).unknown).toBe(true);
    });

    it("3) thiếu hẳn `summary` → unknown:true", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ ok: true }));
      expect((await new LmsHttpClient().syncUsers(usersOf(1))).unknown).toBe(true);
    });

    it("4) field NGOÀI phân hoạch (durationMs) + đủ 6 counter khớp tổng → bỏ qua, unknown VẪN false", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({
          ok: true,
          summary: {
            created: 1,
            existing: 0,
            reactivated: 0,
            deactivated: 0,
            skipped: 0,
            durationMs: 12,
          },
        }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(1));
      expect(s.unknown).toBe(false);
      expect(s).not.toHaveProperty("durationMs");
    });

    it("4b) `alreadyDisabled` là HỢP ĐỒNG (thuộc phân hoạch) → unknown:false, không tính vào thay đổi", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({
          ok: true,
          summary: {
            created: 0,
            existing: 33,
            reactivated: 0,
            deactivated: 0,
            skipped: 11,
            alreadyDisabled: 1,
          },
        }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(45));
      expect(s.unknown).toBe(false);
      expect(s.alreadyDisabled).toBe(1);
      expect(s.created + s.reactivated + s.deactivated).toBe(0);
    });

    it("4c) LMS bản CŨ (không gửi alreadyDisabled) → mặc định 0, tổng vẫn khớp ⇒ tương thích ngược", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({
          ok: true,
          summary: { created: 0, existing: 34, reactivated: 0, deactivated: 0, skipped: 11 },
        }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(45));
      expect(s.unknown).toBe(false);
      expect(s.alreadyDisabled).toBe(0);
    });

    it("5) tổng 6 counter ≠ users.length (thiếu) → unknown:true", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({ ok: true, summary: { created: 1, existing: 1 } }),
      );
      expect((await new LmsHttpClient().syncUsers(usersOf(5))).unknown).toBe(true);
    });

    it("5) tổng > users.length → unknown:true", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({ ok: true, summary: { created: 9, existing: 0 } }),
      );
      expect((await new LmsHttpClient().syncUsers(usersOf(1))).unknown).toBe(true);
    });

    // Ca CHỐT của plan-review vòng 4 BLOCKING #2: sai kiểu NHƯNG tổng vẫn khớp. Đây là fixture duy nhất
    // phân biệt "bắt tại chỗ" với "suy ra từ phép trừ tổng" (cách suy ra sẽ NUỐT MẤT 1 lần khoá tài khoản).
    it("5b) counter sai kiểu string NHƯNG tổng vẫn khớp → VẪN unknown:true (bắt tại chỗ)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({
          ok: true,
          summary: {
            created: 0,
            existing: 0,
            reactivated: 0,
            deactivated: "1",
            skipped: 1,
            alreadyDisabled: 1,
          },
        }),
      );
      const s = await new LmsHttpClient().syncUsers(usersOf(2));
      expect(s.unknown).toBe(true);
    });

    it.each([
      ["âm", -1],
      ["thập phân", 1.5],
      ["null", null],
      ["boolean", true],
      ["mảng", [1]],
    ])("5b) counter sai kiểu (%s) → unknown:true", async (_label, bad) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        okJson({ ok: true, summary: { created: bad, existing: 1 } }),
      );
      expect((await new LmsHttpClient().syncUsers(usersOf(1))).unknown).toBe(true);
    });

    it("6) res.json() reject (AbortError) → unknown:true, KHÔNG throw (2xx không bị hạ cấp)", async () => {
      const res = new Response(null, { status: 200 });
      vi.spyOn(res, "json").mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(res);

      const s = await new LmsHttpClient().syncUsers(usersOf(1));
      expect(s.unknown).toBe(true);
    });

    it("7) catch body-read KHÔNG log nội dung body (chỉ chuỗi cố định)", async () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      // V8 nhét tiền tố body vào message của SyntaxError → nếu log err.message là RÒ.
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response('{"leak":"nhanvien@funtime.vn"', { status: 200 }),
      );

      await new LmsHttpClient().syncUsers(usersOf(1));

      const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(" ");
      expect(logged).not.toContain("nhanvien@funtime.vn");
      expect(logged).not.toContain("leak");
    });

    it("8) !ok (HTTP 500) → throw VÀ KHÔNG đọc body", async () => {
      const res = new Response("secret-echo", { status: 500 });
      const json = vi.spyOn(res, "json");
      const text = vi.spyOn(res, "text");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(res);

      await expect(
        new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }]),
      ).rejects.toThrow(/HTTP 500/);
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
    });

    it("network error/timeout → throw", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aborted"));
      await expect(
        new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }]),
      ).rejects.toThrow(/network error/);
    });

    it("chưa cấu hình → throw (gọi nhầm lúc tắt = lỗi lập trình, không im lặng)", async () => {
      delete process.env.LMS_SYNC_TOKEN;
      await expect(
        new LmsHttpClient().syncUsers([{ email: "a@b.co", active: true }]),
      ).rejects.toThrow(/chưa cấu hình/);
    });

    it("9) users rỗng → summary toàn 0 + unknown:false, KHÔNG gọi fetch", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      const s = await new LmsHttpClient().syncUsers([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(s).toEqual({
        created: 0,
        existing: 0,
        reactivated: 0,
        deactivated: 0,
        skipped: 0,
        alreadyDisabled: 0,
        unknown: false,
      });
    });
  });
});
