import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { AiClient } from "./ai-client";

/**
 * AI-1 — unit RED cho AiClient. Chốt:
 *  - model id từ env/allowlist {claude-opus-4-8, claude-sonnet-4-6}; env lạ → fallback default (KHÔNG 404).
 *  - thiếu ANTHROPIC_API_KEY → throw ServiceUnavailableException TRƯỚC khi gọi API (KHÔNG fail-open).
 *  - KHÔNG log API key (env key không lọt vào logger/console).
 */
describe("AI-1 AiClient", () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevModel = process.env.AI_MODEL;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_MODEL;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevModel;
  });

  describe("resolveModel (env/allowlist)", () => {
    it("không env → default claude-opus-4-8", () => {
      const c = new AiClient();
      expect(c.resolveModel()).toBe("claude-opus-4-8");
    });

    it("AI_MODEL=claude-sonnet-4-6 (allowlist) → dùng đúng", () => {
      process.env.AI_MODEL = "claude-sonnet-4-6";
      const c = new AiClient();
      expect(c.resolveModel()).toBe("claude-sonnet-4-6");
    });

    it("AI_MODEL ngoài allowlist (vd hậu tố ngày) → fallback default (KHÔNG 404)", () => {
      process.env.AI_MODEL = "claude-opus-4-8-20251114";
      const c = new AiClient();
      expect(c.resolveModel()).toBe("claude-opus-4-8");
    });

    it("override hợp lệ thắng env", () => {
      process.env.AI_MODEL = "claude-opus-4-8";
      const c = new AiClient();
      expect(c.resolveModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    });
  });

  describe("thiếu ANTHROPIC_API_KEY → fail-fast (KHÔNG fail-open)", () => {
    it("summarize() ném ServiceUnavailableException khi thiếu key (KHÔNG gọi API)", async () => {
      const c = new AiClient();
      await expect(c.summarize("xin chào")).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("key rỗng/whitespace cũng bị từ chối", async () => {
      process.env.ANTHROPIC_API_KEY = "   ";
      const c = new AiClient();
      await expect(c.summarize("xin chào")).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe("KHÔNG log API key", () => {
    it("không in API key ra console khi fail-fast", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret-key-DO-NOT-LOG";
      const c = new AiClient();
      const seen: string[] = [];
      const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => {
        const orig = console[m];
        // eslint không cần disable: ghi lại rồi gọi orig (không nuốt).
        console[m] = (...args: unknown[]) => {
          seen.push(args.map((a) => String(a)).join(" "));
          return (orig as (...a: unknown[]) => void)(...args);
        };
        return () => {
          console[m] = orig;
        };
      });

      try {
        // resolveModel + (nếu có) khởi tạo client KHÔNG được log key. Không gọi summarize thật (API thật).
        c.resolveModel();
        // chạm getClient gián tiếp: gọi summarize với prompt rỗng sẽ cố gọi API → bắt lỗi mạng, nhưng key
        // KHÔNG được lọt vào console TRƯỚC đó. Bọc try để không phụ thuộc kết quả mạng.
        await c.summarize("x").catch(() => undefined);
      } finally {
        spies.forEach((restore) => restore());
      }

      const joined = seen.join("\n");
      expect(joined).not.toContain("sk-ant-super-secret-key-DO-NOT-LOG");
    });
  });
});
