/**
 * G8-3 — Deny-path + behaviour suite for EvaluationService (mock DB/Audit/Outbox/Permission).
 *
 * E1 — createTemplate/updateCriteria thiếu manage:evaluation-template → ForbiddenException, KHÔNG ghi row.
 * E2 — recordScores thiếu score:evaluation → Forbidden, KHÔNG ghi result/scores.
 * E3 — tổng trọng số tiêu chí ≠ 100 → ConflictException (chốt service, kể cả khi qua Zod).
 * E4 — chấm điểm gọi audit.record object_type='evaluation_result' CÙNG tx + outbox.enqueue.
 * E5 — score ngoài [min,max] của criteria → reject (BadRequestException), KHÔNG ghi.
 * E6 — chấm lại trùng (result,criteria) → 23505 → ConflictException 409.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { EvaluationService } from "./evaluation.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const TEMPLATE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const STEP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CRIT_1 = "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1";
const CRIT_2 = "c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2";
const PG_UNIQUE_VIOLATION = "23505";

function criterion(id: string, weight: number, min = 0, max = 10) {
  return {
    id,
    companyId: COMPANY_ID,
    templateId: TEMPLATE_ID,
    name: `crit-${id.slice(0, 4)}`,
    weight: String(weight),
    minScore: String(min),
    maxScore: String(max),
    sortOrder: 0,
  };
}

function makeRepo(
  overrides: {
    template?: unknown;
    criteria?: ReturnType<typeof criterion>[];
    insertScoreImpl?: () => Promise<unknown>;
  } = {},
) {
  const template = overrides.template ?? { id: TEMPLATE_ID, companyId: COMPANY_ID, name: "tpl" };
  const criteria = overrides.criteria ?? [criterion(CRIT_1, 60), criterion(CRIT_2, 40)];
  return {
    listTemplates: vi.fn().mockResolvedValue([]),
    findTemplateByIdTx: vi.fn().mockResolvedValue(template),
    findActiveCriteriaTx: vi.fn().mockResolvedValue(criteria),
    insertTemplateTx: vi.fn().mockResolvedValue({ id: TEMPLATE_ID, name: "tpl" }),
    insertCriterionTx: vi.fn().mockResolvedValue({ id: "new-crit" }),
    softDeleteCriteriaTx: vi.fn().mockResolvedValue(undefined),
    touchTemplateTx: vi.fn().mockResolvedValue(undefined),
    insertResultTx: vi.fn().mockResolvedValue({ id: "new-result", totalScore: "80.00" }),
    insertScoreTx: overrides.insertScoreImpl
      ? vi.fn().mockImplementation(overrides.insertScoreImpl)
      : vi.fn().mockResolvedValue({ id: "new-score" }),
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

function makePermissions(allow: boolean) {
  return {
    can: vi.fn().mockResolvedValue({ allow, reason: allow ? "allow" : "no_grant" }),
  };
}

function makeService(
  opts: {
    allow?: boolean;
    repo?: ReturnType<typeof makeRepo>;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb(repo);
  const permissions = makePermissions(opts.allow ?? true);
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
  const svc = new EvaluationService(
    db as never,
    repo as never,
    permissions as never,
    audit as never,
    outbox as never,
  );
  return { svc, repo, db, permissions, audit, outbox };
}

const validTemplateDto = {
  name: "Đánh giá video",
  criteria: [
    { name: "Nội dung", weight: 60, minScore: 0, maxScore: 10, sortOrder: 0 },
    { name: "Kỹ thuật", weight: 40, minScore: 0, maxScore: 10, sortOrder: 1 },
  ],
};

const validScoresDto = {
  templateId: TEMPLATE_ID,
  workflowStepId: STEP_ID,
  scores: [
    { criteriaId: CRIT_1, score: 8 },
    { criteriaId: CRIT_2, score: 6 },
  ],
};

describe("EvaluationService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── E1: deny manage:evaluation-template ───────────────────────────────────
  describe("E1 — createTemplate/updateCriteria require manage:evaluation-template (fail-closed)", () => {
    it("createTemplate throws ForbiddenException and writes NO row when denied", async () => {
      const { svc, repo, db } = makeService({ allow: false });
      await expect(svc.createTemplate(COMPANY_ID, USER_ID, validTemplateDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(repo.insertTemplateTx).not.toHaveBeenCalled();
    });

    it("updateCriteria throws ForbiddenException when denied (no tx)", async () => {
      const { svc, db } = makeService({ allow: false });
      await expect(
        svc.updateCriteria(COMPANY_ID, USER_ID, TEMPLATE_ID, {
          criteria: validTemplateDto.criteria,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(db.withTenant).not.toHaveBeenCalled();
    });
  });

  // ─── E2: deny score:evaluation ──────────────────────────────────────────────
  describe("E2 — recordScores requires score:evaluation (fail-closed)", () => {
    it("throws ForbiddenException and writes NO result/scores when denied", async () => {
      const { svc, repo, db } = makeService({ allow: false });
      await expect(svc.recordScores(COMPANY_ID, USER_ID, validScoresDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(repo.insertResultTx).not.toHaveBeenCalled();
      expect(repo.insertScoreTx).not.toHaveBeenCalled();
    });
  });

  // ─── E3: weight sum must be 100 ─────────────────────────────────────────────
  describe("E3 — total criteria weight must equal 100", () => {
    it("createTemplate throws ConflictException when weights do not sum to 100", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.createTemplate(COMPANY_ID, USER_ID, {
          name: "x",
          criteria: [
            { name: "a", weight: 60, minScore: 0, maxScore: 10, sortOrder: 0 },
            { name: "b", weight: 30, minScore: 0, maxScore: 10, sortOrder: 1 },
          ],
        }),
      ).rejects.toThrow(ConflictException);
      expect(repo.insertTemplateTx).not.toHaveBeenCalled();
    });
  });

  // ─── E4: audit + outbox in-tx on scoring ────────────────────────────────────
  describe("E4 — recordScores audits evaluation_result + enqueues outbox in the same tx", () => {
    it("calls audit.record(evaluation_result) and outbox.enqueue once", async () => {
      const { svc, audit, outbox, repo } = makeService();
      await svc.recordScores(COMPANY_ID, USER_ID, validScoresDto);
      expect(repo.insertResultTx).toHaveBeenCalledTimes(1);
      expect(repo.insertScoreTx).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(
        repo,
        expect.objectContaining({
          action: "EvaluationScored",
          objectType: "evaluation_result",
        }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        repo,
        expect.objectContaining({ eventType: "evaluation.scored" }),
      );
    });
  });

  // ─── E5: score out of range ─────────────────────────────────────────────────
  describe("E5 — score outside [min,max] is rejected", () => {
    it("throws BadRequestException and writes NO result when a score is above max", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.recordScores(COMPANY_ID, USER_ID, {
          templateId: TEMPLATE_ID,
          workflowStepId: STEP_ID,
          scores: [
            { criteriaId: CRIT_1, score: 99 }, // max is 10
            { criteriaId: CRIT_2, score: 6 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.insertResultTx).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when a score references an unknown criteria", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.recordScores(COMPANY_ID, USER_ID, {
          templateId: TEMPLATE_ID,
          workflowStepId: STEP_ID,
          scores: [
            { criteriaId: CRIT_1, score: 8 },
            { criteriaId: "ffffffff-ffff-ffff-ffff-ffffffffffff", score: 6 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.insertResultTx).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when not all active criteria are scored", async () => {
      const { svc, repo } = makeService();
      await expect(
        svc.recordScores(COMPANY_ID, USER_ID, {
          templateId: TEMPLATE_ID,
          workflowStepId: STEP_ID,
          scores: [{ criteriaId: CRIT_1, score: 8 }], // only 1 of 2
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.insertResultTx).not.toHaveBeenCalled();
    });
  });

  // ─── E6: append-only duplicate score → 23505 → 409 ──────────────────────────
  describe("E6 — duplicate (result,criteria) maps 23505 → ConflictException 409", () => {
    it("maps a unique-violation from insertScoreTx to ConflictException", async () => {
      const repo = makeRepo({
        insertScoreImpl: () => Promise.reject({ code: PG_UNIQUE_VIOLATION }),
      });
      const { svc } = makeService({ repo });
      await expect(svc.recordScores(COMPANY_ID, USER_ID, validScoresDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
