import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ @mediaos/contracts khi ai.ts CHƯA re-export ở index → ĐỎ
//    đúng lý do (module export thiếu) trước implement.
import { AI_MODEL_IDS, aiInsightQuerySchema, aiInsightSchema, aiModelIdSchema } from "./index";

/**
 * AI-1 — contract test. kiểm: model id allowlist (KHÔNG id ngoài 2 model + KHÔNG hậu tố ngày), query
 * default an toàn (period/scope/limit), output KHÔNG field tiền thô (chỉ summary + meta + cờ mask).
 */
describe("AI-1 AI insight contracts", () => {
  describe("aiModelIdSchema (allowlist)", () => {
    it("chấp nhận đúng 2 model id allowlist", () => {
      expect(AI_MODEL_IDS).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
      expect(aiModelIdSchema.parse("claude-opus-4-8")).toBe("claude-opus-4-8");
      expect(aiModelIdSchema.parse("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    });

    it("REJECT model id có hậu tố ngày (404 trap)", () => {
      expect(() => aiModelIdSchema.parse("claude-opus-4-8-20251114")).toThrow();
    });

    it("REJECT model id ngoài allowlist", () => {
      expect(() => aiModelIdSchema.parse("claude-3-opus")).toThrow();
      expect(() => aiModelIdSchema.parse("gpt-4")).toThrow();
    });
  });

  describe("aiInsightQuerySchema (default an toàn + clamp)", () => {
    it("rỗng → default period=month, scope=company, limit=20", () => {
      const out = aiInsightQuerySchema.parse({});
      expect(out.period).toBe("month");
      expect(out.scope).toBe("company");
      expect(out.limit).toBe(20);
    });

    it("clamp limit (>100 → reject; coerce string)", () => {
      expect(aiInsightQuerySchema.parse({ limit: "50" }).limit).toBe(50);
      expect(() => aiInsightQuerySchema.parse({ limit: 101 })).toThrow();
      expect(() => aiInsightQuerySchema.parse({ limit: 0 })).toThrow();
    });

    it("REJECT period/scope ngoài enum", () => {
      expect(() => aiInsightQuerySchema.parse({ period: "decade" })).toThrow();
      expect(() => aiInsightQuerySchema.parse({ scope: "everyone" })).toThrow();
    });

    it("REJECT subjectUserId không phải uuid", () => {
      expect(() => aiInsightQuerySchema.parse({ subjectUserId: "not-a-uuid" })).toThrow();
    });
  });

  describe("aiInsightSchema (output — KHÔNG field tiền thô)", () => {
    const base = {
      summary: "Tổng quan KPI tháng này ổn định.",
      model: "claude-opus-4-8" as const,
      period: "month" as const,
      scope: "company" as const,
      financeMasked: true,
      kpiCount: 5,
      costCount: 0,
      generatedAt: new Date().toISOString(),
    };

    it("chấp nhận output hợp lệ", () => {
      expect(aiInsightSchema.parse(base)).toMatchObject({
        summary: base.summary,
        financeMasked: true,
      });
    });

    it("KHÔNG có field amount/tiền thô trong shape output", () => {
      const out = aiInsightSchema.parse(base) as Record<string, unknown>;
      expect("amount" in out).toBe(false);
      expect("costAmount" in out).toBe(false);
      expect("revenue" in out).toBe(false);
    });

    it("REJECT model id ngoài allowlist trong output", () => {
      expect(() => aiInsightSchema.parse({ ...base, model: "claude-opus-4-8-20251114" })).toThrow();
    });
  });
});
