import "reflect-metadata";
/**
 * S5-LMS-BE-3 (RED trước) — LmsProgressClient: client server-to-server ĐỌC tiến độ học từ LMS
 * (`GET /api/mediaos/progress?email=`). Khoá hành vi phòng thủ:
 *   - thiếu env (LMS_BASE_URL / LMS_PROGRESS_TOKEN) → isEnabled()=false; gọi khi tắt → THROW (không im lặng);
 *   - timeout/network → THROW (không treo request — AbortSignal.timeout);
 *   - HTTP 404 → { found:false } (LMS: email CHƯA TỪNG có tài khoản — KHÔNG phải lỗi);
 *   - HTTP non-2xx khác → THROW, KHÔNG đọc/log body;
 *   - content-type không phải JSON hoặc content-length vượt trần → THROW TRƯỚC khi parse;
 *   - MỌI nhánh lỗi: KHÔNG log token, KHÔNG log email, KHÔNG log body (BẤT BIẾN #3).
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmsProgressClient } from "./lms-progress-client.service";

// Fixture giống-secret: GHÉP CHUỖI (CLAUDE.md §5) — literal high-entropy sẽ trip gitleaks generic-api-key.
const TOKEN = ["test", "lms", "progress", "token", "x".repeat(32)].join("-");
const BASE_URL = "https://lms.test.local";
const EMAIL = "nhan.vien@congty.test";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(
  body: unknown,
  init?: { status?: number; contentType?: string; length?: string },
) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    headers: new Headers({
      "content-type": init?.contentType ?? "application/json; charset=utf-8",
      ...(init?.length ? { "content-length": init.length } : {}),
    }),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("LmsProgressClient", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.LMS_BASE_URL = BASE_URL;
    process.env.LMS_PROGRESS_TOKEN = TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  /** Gộp mọi thứ đã log để chứng minh không rò secret/PII. */
  function loggedText(): string {
    return JSON.stringify(warnSpy.mock.calls);
  }

  describe("cấu hình", () => {
    it("đủ env → isEnabled() = true", () => {
      expect(new LmsProgressClient().isEnabled()).toBe(true);
    });

    it("thiếu LMS_PROGRESS_TOKEN → isEnabled() = false", () => {
      delete process.env.LMS_PROGRESS_TOKEN;
      expect(new LmsProgressClient().isEnabled()).toBe(false);
    });

    it("thiếu LMS_BASE_URL → isEnabled() = false", () => {
      delete process.env.LMS_BASE_URL;
      expect(new LmsProgressClient().isEnabled()).toBe(false);
    });

    it("KHÔNG fallback sang LMS_SYNC_TOKEN (token quyền-ghi) khi thiếu LMS_PROGRESS_TOKEN", async () => {
      delete process.env.LMS_PROGRESS_TOKEN;
      process.env.LMS_SYNC_TOKEN = [TOKEN, "sync"].join("-");
      const client = new LmsProgressClient();
      expect(client.isEnabled()).toBe(false);
      await expect(client.fetchProgress(EMAIL)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gọi fetchProgress khi CHƯA cấu hình → THROW (bảo vệ gọi nhầm, không im lặng)", async () => {
      delete process.env.LMS_BASE_URL;
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("request", () => {
    it("GET đúng URL + Bearer token + timeout signal; email lowercase + encode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ version: 1 }));
      await new LmsProgressClient().fetchProgress("  Nhan.Vien+A@CongTy.Test  ");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith(`${BASE_URL}/api/mediaos/progress?email=`)).toBe(true);
      expect(url).toContain(encodeURIComponent("nhan.vien+a@congty.test"));
      expect(url).not.toContain("+A@");
      expect(init.method ?? "GET").toBe("GET");
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.signal).toBeDefined();
    });

    it("2xx JSON → { found:true, body } (body TRẢ NGUYÊN, validate là việc của service)", async () => {
      const body = { version: 1, courses: [] };
      fetchMock.mockResolvedValue(jsonResponse(body));
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).resolves.toEqual({
        found: true,
        body,
      });
    });

    it("404 → { found:false } (chưa từng có tài khoản LMS — KHÔNG throw)", async () => {
      const res = jsonResponse({ message: "Not found" }, { status: 404 });
      fetchMock.mockResolvedValue(res);
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).resolves.toEqual({ found: false });
      expect(res.json as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
  });

  describe("nhánh lỗi — THROW sạch, không rò secret/PII", () => {
    it("timeout/abort → THROW (không treo)", async () => {
      fetchMock.mockRejectedValue(new DOMException("The operation was aborted.", "TimeoutError"));
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(loggedText()).not.toContain(TOKEN);
      expect(loggedText()).not.toContain(EMAIL);
    });

    it("HTTP 500 → THROW, KHÔNG đọc body", async () => {
      const res = jsonResponse({ secret: "leak" }, { status: 500 });
      fetchMock.mockResolvedValue(res);
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(res.json as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      expect(loggedText()).not.toContain(TOKEN);
      expect(loggedText()).not.toContain(EMAIL);
    });

    it("HTTP 401 (sai token) → THROW, KHÔNG log token", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "Unauthorized" }, { status: 401 }));
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(loggedText()).not.toContain(TOKEN);
    });

    it("content-type không phải JSON (proxy trả HTML) → THROW trước khi parse", async () => {
      const res = jsonResponse("<html/>", { contentType: "text/html" });
      fetchMock.mockResolvedValue(res);
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(res.json as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it("content-length vượt trần → THROW trước khi parse (không nuốt bộ nhớ tiến trình API)", async () => {
      const res = jsonResponse({ version: 1 }, { length: String(50 * 1024 * 1024) });
      fetchMock.mockResolvedValue(res);
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(res.json as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it("body không parse được JSON → THROW, KHÔNG log message của SyntaxError (chứa tiền tố body)", async () => {
      const res = jsonResponse(null);
      (res.json as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SyntaxError(`Unexpected token < in JSON at position 0 — ${EMAIL}`),
      );
      fetchMock.mockResolvedValue(res);
      await expect(new LmsProgressClient().fetchProgress(EMAIL)).rejects.toThrow();
      expect(loggedText()).not.toContain(EMAIL);
      expect(loggedText()).not.toContain(TOKEN);
    });
  });
});
