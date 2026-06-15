import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ @mediaos/contracts khi kpi.ts CHƯA re-export ở index → ĐỎ
//    đúng lý do (module export thiếu) trước implement.
import {
  KPI_WEIGHT_SUM,
  KPI_SCORE_MAX,
  KPI_SCORE_MIN,
  confirmKpiResultSchema,
  computeKpiRequestSchema,
  createKpiDefinitionSchema,
  kpiComponentWeightsSchema,
  kpiDefinitionSchema,
  kpiResultSchema,
} from "./index";

/**
 * G8-4 KPI — contract test. kiểm: trọng số 5 thành phần (refine TỔNG=100 → reject ≠100),
 * computeKpiRequest (chủ thể XOR + kỳ hợp lệ), confirmKpiResult, kpiResult (snapshot fields nullable).
 */
describe("G8-4 KPI contracts", () => {
  const validWeights = {
    tasksDone: 20,
    onTimeRate: 20,
    evaluationScore: 20,
    defectScore: 20,
    firstPassApprovalRate: 20,
  };

  describe("kpiComponentWeightsSchema (tổng = 100)", () => {
    it("chấp nhận trọng số 5 thành phần tổng = 100", () => {
      expect(kpiComponentWeightsSchema.parse(validWeights)).toEqual(validWeights);
      expect(KPI_WEIGHT_SUM).toBe(100);
    });

    it("REJECT khi tổng trọng số ≠ 100 (vd 90)", () => {
      const bad = { ...validWeights, firstPassApprovalRate: 10 }; // tổng 90
      expect(() => kpiComponentWeightsSchema.parse(bad)).toThrow();
    });

    it("REJECT khi tổng vượt 100 (vd 110)", () => {
      const bad = { ...validWeights, firstPassApprovalRate: 30 }; // tổng 110
      expect(() => kpiComponentWeightsSchema.parse(bad)).toThrow();
    });

    it("REJECT khi 1 trọng số âm", () => {
      const bad = { ...validWeights, tasksDone: -5, onTimeRate: 25 };
      expect(() => kpiComponentWeightsSchema.parse(bad)).toThrow();
    });
  });

  describe("createKpiDefinitionSchema", () => {
    it("chấp nhận name + weights hợp lệ", () => {
      const out = createKpiDefinitionSchema.parse({ name: "KPI Editor", weights: validWeights });
      expect(out.name).toBe("KPI Editor");
    });

    it("REJECT name rỗng", () => {
      expect(() =>
        createKpiDefinitionSchema.parse({ name: "", weights: validWeights }),
      ).toThrow();
    });

    it("REJECT weights tổng ≠ 100", () => {
      expect(() =>
        createKpiDefinitionSchema.parse({
          name: "x",
          weights: { ...validWeights, tasksDone: 0 }, // tổng 80
        }),
      ).toThrow();
    });
  });

  describe("kpiDefinitionSchema (đọc)", () => {
    it("parse đầy đủ field", () => {
      const dto = {
        id: "11111111-1111-1111-1111-111111111111",
        companyId: "22222222-2222-2222-2222-222222222222",
        name: "KPI",
        description: null,
        weights: validWeights,
        isActive: true,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      };
      expect(kpiDefinitionSchema.parse(dto).weights.tasksDone).toBe(20);
    });
  });

  describe("computeKpiRequestSchema (chủ thể XOR + kỳ hợp lệ)", () => {
    const base = {
      definitionId: "33333333-3333-3333-3333-333333333333",
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
    };

    it("chấp nhận subjectUserId (không team)", () => {
      const out = computeKpiRequestSchema.parse({
        ...base,
        subjectUserId: "44444444-4444-4444-4444-444444444444",
      });
      expect(out.subjectUserId).toBeDefined();
    });

    it("chấp nhận subjectTeamId (không user)", () => {
      const out = computeKpiRequestSchema.parse({
        ...base,
        subjectTeamId: "55555555-5555-5555-5555-555555555555",
      });
      expect(out.subjectTeamId).toBeDefined();
    });

    it("REJECT khi có CẢ user và team (không XOR)", () => {
      expect(() =>
        computeKpiRequestSchema.parse({
          ...base,
          subjectUserId: "44444444-4444-4444-4444-444444444444",
          subjectTeamId: "55555555-5555-5555-5555-555555555555",
        }),
      ).toThrow();
    });

    it("REJECT khi KHÔNG có chủ thể nào", () => {
      expect(() => computeKpiRequestSchema.parse(base)).toThrow();
    });

    it("REJECT khi periodEnd <= periodStart", () => {
      expect(() =>
        computeKpiRequestSchema.parse({
          ...base,
          subjectUserId: "44444444-4444-4444-4444-444444444444",
          periodEnd: base.periodStart,
        }),
      ).toThrow();
    });
  });

  describe("confirmKpiResultSchema", () => {
    it("parse kpiResultId", () => {
      const out = confirmKpiResultSchema.parse({
        kpiResultId: "66666666-6666-6666-6666-666666666666",
      });
      expect(out.kpiResultId).toBeDefined();
    });

    it("REJECT khi thiếu kpiResultId", () => {
      expect(() => confirmKpiResultSchema.parse({})).toThrow();
    });
  });

  describe("kpiResultSchema (snapshot — confirmed* nullable)", () => {
    const base = {
      id: "77777777-7777-7777-7777-777777777777",
      companyId: "22222222-2222-2222-2222-222222222222",
      definitionId: "33333333-3333-3333-3333-333333333333",
      subjectUserId: "44444444-4444-4444-4444-444444444444",
      subjectTeamId: null,
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      components: {
        tasksDone: 100,
        onTimeRate: 90,
        evaluationScore: 80,
        defectScore: 100,
        firstPassApprovalRate: 75,
      },
      totalScore: 89,
      computedBy: "44444444-4444-4444-4444-444444444444",
      createdAt: "2026-06-14T00:00:00.000Z",
    };

    it("BR-007: confirmedBy/confirmedAt NULL = chưa xác nhận (THAM KHẢO)", () => {
      const out = kpiResultSchema.parse({ ...base, confirmedBy: null, confirmedAt: null });
      expect(out.confirmedBy).toBeNull();
      expect(out.confirmedAt).toBeNull();
    });

    it("snapshot đã xác nhận: confirmedBy/confirmedAt có giá trị", () => {
      const out = kpiResultSchema.parse({
        ...base,
        confirmedBy: "88888888-8888-8888-8888-888888888888",
        confirmedAt: "2026-06-14T01:00:00.000Z",
      });
      expect(out.confirmedBy).not.toBeNull();
      expect(out.confirmedAt).not.toBeNull();
    });

    it("totalScore trong [0,100]", () => {
      expect(KPI_SCORE_MIN).toBe(0);
      expect(KPI_SCORE_MAX).toBe(100);
      const out = kpiResultSchema.parse({ ...base, confirmedBy: null, confirmedAt: null });
      expect(out.totalScore).toBeGreaterThanOrEqual(KPI_SCORE_MIN);
      expect(out.totalScore).toBeLessThanOrEqual(KPI_SCORE_MAX);
    });
  });
});
