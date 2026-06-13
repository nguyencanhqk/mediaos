import { describe, expect, it } from "vitest";
import {
  createEvaluationTemplateSchema,
  criterionInputSchema,
  recordScoresSchema,
  scoreInputSchema,
  updateCriteriaSchema,
} from "./evaluation";

/**
 * G8-3 — Contract test (nguồn sự thật DTO TRƯỚC controller). Parse hợp lệ + reject input xấu:
 * weight âm, score ngoài range / không hữu hạn, thiếu criteriaId, tổng trọng số ≠ 100, trùng criteria.
 */

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

describe("evaluation contracts", () => {
  describe("criterionInputSchema", () => {
    it("parses a valid criterion", () => {
      const parsed = criterionInputSchema.parse({
        name: "Chất lượng kịch bản",
        weight: 50,
        minScore: 0,
        maxScore: 10,
      });
      expect(parsed.weight).toBe(50);
      expect(parsed.sortOrder).toBe(0); // default
    });

    it("rejects a negative weight", () => {
      expect(() =>
        criterionInputSchema.parse({ name: "x", weight: -5, minScore: 0, maxScore: 10 }),
      ).toThrow();
    });

    it("rejects weight > 100", () => {
      expect(() =>
        criterionInputSchema.parse({ name: "x", weight: 101, minScore: 0, maxScore: 10 }),
      ).toThrow();
    });

    it("rejects maxScore <= minScore", () => {
      expect(() =>
        criterionInputSchema.parse({ name: "x", weight: 10, minScore: 10, maxScore: 10 }),
      ).toThrow();
    });
  });

  describe("createEvaluationTemplateSchema", () => {
    it("parses a template whose criteria weights sum to 100", () => {
      const parsed = createEvaluationTemplateSchema.parse({
        name: "Đánh giá video",
        criteria: [
          { name: "Nội dung", weight: 60, minScore: 0, maxScore: 10 },
          { name: "Kỹ thuật", weight: 40, minScore: 0, maxScore: 10 },
        ],
      });
      expect(parsed.criteria).toHaveLength(2);
    });

    it("rejects when total weight != 100", () => {
      expect(() =>
        createEvaluationTemplateSchema.parse({
          name: "x",
          criteria: [
            { name: "a", weight: 60, minScore: 0, maxScore: 10 },
            { name: "b", weight: 30, minScore: 0, maxScore: 10 },
          ],
        }),
      ).toThrow();
    });

    it("rejects empty criteria", () => {
      expect(() => createEvaluationTemplateSchema.parse({ name: "x", criteria: [] })).toThrow();
    });
  });

  describe("updateCriteriaSchema", () => {
    it("rejects when weights do not sum to 100", () => {
      expect(() =>
        updateCriteriaSchema.parse({
          criteria: [{ name: "a", weight: 99, minScore: 0, maxScore: 10 }],
        }),
      ).toThrow();
    });
  });

  describe("scoreInputSchema", () => {
    it("rejects a missing criteriaId", () => {
      expect(() => scoreInputSchema.parse({ score: 5 })).toThrow();
    });

    it("rejects a non-finite score", () => {
      expect(() =>
        scoreInputSchema.parse({ criteriaId: UUID, score: Number.POSITIVE_INFINITY }),
      ).toThrow();
    });
  });

  describe("recordScoresSchema", () => {
    it("parses valid scores", () => {
      const parsed = recordScoresSchema.parse({
        templateId: UUID,
        workflowStepId: UUID2,
        scores: [
          { criteriaId: UUID, score: 8 },
          { criteriaId: UUID2, score: 6 },
        ],
      });
      expect(parsed.scores).toHaveLength(2);
    });

    it("rejects duplicate criteriaId", () => {
      expect(() =>
        recordScoresSchema.parse({
          templateId: UUID,
          workflowStepId: UUID2,
          scores: [
            { criteriaId: UUID, score: 8 },
            { criteriaId: UUID, score: 6 },
          ],
        }),
      ).toThrow();
    });

    it("rejects empty scores", () => {
      expect(() =>
        recordScoresSchema.parse({ templateId: UUID, workflowStepId: UUID2, scores: [] }),
      ).toThrow();
    });
  });
});
