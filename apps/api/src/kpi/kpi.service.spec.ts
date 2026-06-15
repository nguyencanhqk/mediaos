import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
// 🔴 RED-first: kpi.service.ts CHƯA tồn tại → CẢ suite ĐỎ đúng lý do (module-not-found) trước implement.
import {
  KPI_SCORE_MAX,
  KPI_SCORE_MIN,
  aggregateComponentScores,
  computeKpiTotalScore,
  type KpiRawMetrics,
} from "./kpi.formula";

/**
 * G8-4 — UNIT công thức KPI (biên BR-007 + math). Test TRƯỚC (RED). KHÔNG đụng DB.
 *
 *  K1 chia-cho-0: mẫu số task-đến-hạn rỗng → tỷ-lệ = 0 (KHÔNG NaN/Infinity).
 *  K2 thiếu dữ liệu thành phần (không evaluation/defect) → điểm thành phần xác định (0/100), không vỡ.
 *  K3 tổng trọng số ≠ 100 → ConflictException.
 *  K4 clamp điểm tổng vào [0,100].
 *  K5/K6/K7 (append-only/confirm BR-007) — kiểm ở int-spec (DB thật). Ở đây test thuần công thức.
 */
describe("G8-4 KPI formula (pure)", () => {
  const fullWeights = {
    tasksDone: 20,
    onTimeRate: 20,
    evaluationScore: 20,
    defectScore: 20,
    firstPassApprovalRate: 20,
  };

  // ── K1: chia cho 0 (mẫu số rỗng) ────────────────────────────────────────────
  describe("K1 chia-cho-0 (mẫu số task-đến-hạn rỗng)", () => {
    it("0 task đến hạn → tasksDone=0, onTimeRate=0 (KHÔNG NaN/Infinity)", () => {
      const raw: KpiRawMetrics = {
        tasksDue: 0,
        tasksDone: 0,
        tasksOnTime: 0,
        evaluationAvg: null,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 0,
        approvalsFirstPass: 0,
      };
      const c = aggregateComponentScores(raw);
      expect(Number.isFinite(c.tasksDone)).toBe(true);
      expect(Number.isFinite(c.onTimeRate)).toBe(true);
      expect(c.tasksDone).toBe(0);
      expect(c.onTimeRate).toBe(0);
    });

    it("0 approval → firstPassApprovalRate=0 (không Infinity)", () => {
      const raw: KpiRawMetrics = {
        tasksDue: 5,
        tasksDone: 5,
        tasksOnTime: 5,
        evaluationAvg: 80,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 0,
        approvalsFirstPass: 0,
      };
      const c = aggregateComponentScores(raw);
      expect(Number.isFinite(c.firstPassApprovalRate)).toBe(true);
      expect(c.firstPassApprovalRate).toBe(0);
    });
  });

  // ── K2: thiếu dữ liệu thành phần ────────────────────────────────────────────
  describe("K2 thiếu dữ liệu thành phần (không evaluation/defect)", () => {
    it("evaluationAvg=null → evaluationScore=0 (xác định, không vỡ)", () => {
      const raw: KpiRawMetrics = {
        tasksDue: 4,
        tasksDone: 4,
        tasksOnTime: 4,
        evaluationAvg: null,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 2,
        approvalsFirstPass: 2,
      };
      const c = aggregateComponentScores(raw);
      expect(c.evaluationScore).toBe(0);
    });

    it("0 defect → defectScore=100 (không lỗi = điểm tối đa, xác định)", () => {
      const raw: KpiRawMetrics = {
        tasksDue: 4,
        tasksDone: 4,
        tasksOnTime: 4,
        evaluationAvg: 90,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 2,
        approvalsFirstPass: 2,
      };
      const c = aggregateComponentScores(raw);
      expect(c.defectScore).toBe(100);
    });

    it("nhiều lỗi → defectScore giảm nhưng KHÔNG âm (clamp ≥0)", () => {
      const raw: KpiRawMetrics = {
        tasksDue: 4,
        tasksDone: 4,
        tasksOnTime: 4,
        evaluationAvg: 90,
        defectsType1: 50,
        defectsType2: 50,
        approvalsTotal: 2,
        approvalsFirstPass: 2,
      };
      const c = aggregateComponentScores(raw);
      expect(c.defectScore).toBeGreaterThanOrEqual(0);
      expect(c.defectScore).toBeLessThanOrEqual(100);
    });
  });

  // ── K3: tổng trọng số ≠ 100 → ConflictException ─────────────────────────────
  describe("K3 tổng trọng số ≠ 100", () => {
    const components = {
      tasksDone: 100,
      onTimeRate: 100,
      evaluationScore: 100,
      defectScore: 100,
      firstPassApprovalRate: 100,
    };

    it("tổng trọng số 90 → ConflictException", () => {
      expect(() =>
        computeKpiTotalScore({ ...fullWeights, firstPassApprovalRate: 10 }, components),
      ).toThrow(ConflictException);
    });

    it("tổng trọng số 110 → ConflictException", () => {
      expect(() =>
        computeKpiTotalScore({ ...fullWeights, firstPassApprovalRate: 30 }, components),
      ).toThrow(ConflictException);
    });

    it("tổng = 100 → KHÔNG ném", () => {
      expect(() => computeKpiTotalScore(fullWeights, components)).not.toThrow();
    });
  });

  // ── K4: clamp [0,100] ───────────────────────────────────────────────────────
  describe("K4 clamp điểm tổng vào [0,100]", () => {
    it("mọi thành phần 100 + trọng số tổng 100 → totalScore = 100 (không >100)", () => {
      const total = computeKpiTotalScore(fullWeights, {
        tasksDone: 100,
        onTimeRate: 100,
        evaluationScore: 100,
        defectScore: 100,
        firstPassApprovalRate: 100,
      });
      expect(total).toBe(100);
      expect(total).toBeLessThanOrEqual(KPI_SCORE_MAX);
    });

    it("mọi thành phần 0 → totalScore = 0 (không âm)", () => {
      const total = computeKpiTotalScore(fullWeights, {
        tasksDone: 0,
        onTimeRate: 0,
        evaluationScore: 0,
        defectScore: 0,
        firstPassApprovalRate: 0,
      });
      expect(total).toBe(0);
      expect(total).toBeGreaterThanOrEqual(KPI_SCORE_MIN);
    });

    it("weighted average: thành phần lệch → totalScore trong [0,100]", () => {
      const total = computeKpiTotalScore(fullWeights, {
        tasksDone: 100,
        onTimeRate: 50,
        evaluationScore: 80,
        defectScore: 100,
        firstPassApprovalRate: 0,
      });
      // 20*(100+50+80+100+0)/100 = 66
      expect(total).toBeCloseTo(66, 5);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(100);
    });
  });

  // ── rate clamp: tỷ lệ không vượt 100 dù dữ liệu bẩn ──────────────────────────
  describe("rate clamp (dữ liệu bẩn không phá thang [0,100])", () => {
    it("tasksDone > tasksDue (bẩn) → tasksDone clamp 100", () => {
      const c = aggregateComponentScores({
        tasksDue: 2,
        tasksDone: 5,
        tasksOnTime: 5,
        evaluationAvg: null,
        defectsType1: 0,
        defectsType2: 0,
        approvalsTotal: 0,
        approvalsFirstPass: 0,
      });
      expect(c.tasksDone).toBeLessThanOrEqual(100);
      expect(c.onTimeRate).toBeLessThanOrEqual(100);
    });
  });
});
