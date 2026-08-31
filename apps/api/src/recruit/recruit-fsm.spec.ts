import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type {
  CandidateStage,
  InterviewStatus,
  JobOpeningStatus,
  OfferStatus,
} from "../db/schema/recruit";
import {
  assertInterviewTransition,
  assertJobOpeningTransition,
  assertOfferTransition,
  assertStageTransition,
} from "./recruit-fsm";

/**
 * S12-RECRUIT-BE-1 — 100% ma trận 4 FSM (plan §3.1–3.4, §9.2). Assert theo MÃ trong payload
 * HttpException (`error-details-must-be-errordetail-array`), không theo câu chữ.
 */

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof HttpException) {
      const res = err.getResponse() as { code?: string };
      return res.code ?? "NO-CODE";
    }
    throw err;
  }
}

const STAGES: CandidateStage[] = ["New", "Screening", "Interview", "Offer", "Hired", "Rejected"];

/** Ma trận §13.1 — ô ✓ qua đường `move` (Hired KHÔNG bao giờ ✓ qua move). */
const MOVE_OK: ReadonlyArray<[CandidateStage, CandidateStage]> = [
  ["New", "Screening"],
  ["New", "Rejected"],
  ["Screening", "Interview"],
  ["Screening", "Rejected"],
  ["Interview", "Screening"],
  ["Interview", "Offer"],
  ["Interview", "Rejected"],
  ["Offer", "Interview"],
  ["Offer", "Rejected"],
  ["Rejected", "Screening"],
];

describe("assertStageTransition — §13.1 (6×6, via move + convert)", () => {
  it("đủ ô ✓ qua move", () => {
    for (const [from, to] of MOVE_OK) {
      expect(
        codeOf(() => assertStageTransition(from, to, "move")),
        `${from}→${to}`,
      ).toBeNull();
    }
  });

  it("mọi ô còn lại qua move = 409 001, RIÊNG Offer→Hired = 014", () => {
    for (const from of STAGES) {
      for (const to of STAGES) {
        if (MOVE_OK.some(([f, t]) => f === from && t === to)) continue;
        const code = codeOf(() => assertStageTransition(from, to, "move"));
        if (from === "Offer" && to === "Hired") {
          expect(code, "Offer→Hired tay phải là mã RIÊNG 014").toBe("RECRUIT-ERR-014");
        } else {
          expect(code, `${from}→${to} (kể cả from===to)`).toBe("RECRUIT-ERR-001");
        }
      }
    }
  });

  it("via=convert: CHỈ Offer→Hired hợp lệ, mọi đích Hired khác vẫn 001", () => {
    expect(codeOf(() => assertStageTransition("Offer", "Hired", "convert"))).toBeNull();
    expect(codeOf(() => assertStageTransition("Interview", "Hired", "convert"))).toBe(
      "RECRUIT-ERR-001",
    );
    expect(codeOf(() => assertStageTransition("Hired", "Hired", "convert"))).toBe(
      "RECRUIT-ERR-001",
    );
  });
});

describe("assertJobOpeningTransition — §13.2 (Closed terminal)", () => {
  const ALL: JobOpeningStatus[] = ["Draft", "Open", "Paused", "Closed"];
  const OK: ReadonlyArray<[JobOpeningStatus, JobOpeningStatus]> = [
    ["Draft", "Open"],
    ["Draft", "Closed"],
    ["Open", "Paused"],
    ["Open", "Closed"],
    ["Paused", "Open"],
    ["Paused", "Closed"],
  ];
  it("đủ 4×4", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const code = codeOf(() => assertJobOpeningTransition(from, to));
        if (OK.some(([f, t]) => f === from && t === to)) {
          expect(code, `${from}→${to}`).toBeNull();
        } else {
          expect(code, `${from}→${to}`).toBe("RECRUIT-ERR-002");
        }
      }
    }
  });
});

describe("assertOfferTransition — §13.3 (3 terminal)", () => {
  const ALL: OfferStatus[] = ["Draft", "Sent", "Accepted", "Declined", "Withdrawn"];
  const OK: ReadonlyArray<[OfferStatus, OfferStatus]> = [
    ["Draft", "Sent"],
    ["Draft", "Withdrawn"],
    ["Sent", "Accepted"],
    ["Sent", "Declined"],
    ["Sent", "Withdrawn"],
  ];
  it("đủ 5×5", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const code = codeOf(() => assertOfferTransition(from, to));
        if (OK.some(([f, t]) => f === from && t === to)) {
          expect(code, `${from}→${to}`).toBeNull();
        } else {
          expect(code, `${from}→${to}`).toBe("RECRUIT-ERR-003");
        }
      }
    }
  });
});

describe("assertInterviewTransition — §13.4 (2 terminal)", () => {
  const ALL: InterviewStatus[] = ["Scheduled", "Completed", "Cancelled"];
  const OK: ReadonlyArray<[InterviewStatus, InterviewStatus]> = [
    ["Scheduled", "Completed"],
    ["Scheduled", "Cancelled"],
  ];
  it("đủ 3×3", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const code = codeOf(() => assertInterviewTransition(from, to));
        if (OK.some(([f, t]) => f === from && t === to)) {
          expect(code, `${from}→${to}`).toBeNull();
        } else {
          expect(code, `${from}→${to}`).toBe("RECRUIT-ERR-004");
        }
      }
    }
  });
});
