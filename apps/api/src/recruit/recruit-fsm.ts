import type {
  CandidateStage,
  InterviewStatus,
  JobOpeningStatus,
  OfferStatus,
} from "../db/schema/recruit";
import { RECRUIT_ERR, recruitConflict, recruitDetails } from "./recruit.errors";

/**
 * S12-RECRUIT-BE-1 — 4 FSM RECRUIT (SPEC-12 §13.1–13.4), HÀM THUẦN — controller/service KHÔNG tự
 * kiểm chuyển tiếp. Unit-test 100% ma trận ở `recruit-fsm.spec.ts`.
 *
 * Ô ✗ ⇒ 409 với mã RIÊNG từng đối tượng (001/002/003/004). `Offer→Hired` với `via='move'` ⇒ mã
 * RIÊNG 014 (không gộp vào 001 — SPEC-12 §13.1: `Hired` chỉ đạt qua convert).
 */

/** §13.1 — candidate. `from === to` cũng là ✗ (001). */
const STAGE_EDGES: Record<CandidateStage, readonly CandidateStage[]> = {
  New: ["Screening", "Rejected"],
  Screening: ["Interview", "Rejected"],
  Interview: ["Screening", "Offer", "Rejected"],
  Offer: ["Interview", "Hired", "Rejected"], // Hired CHỈ qua via='convert'
  Hired: [],
  Rejected: ["Screening"], // reopen kèm lý do (Zod đã ép reason)
};

export function assertStageTransition(
  from: CandidateStage,
  to: CandidateStage,
  via: "move" | "convert",
): void {
  if (from === "Offer" && to === "Hired" && via === "move") {
    // Mã 014 RIÊNG — nhánh phân biệt TRƯỚC khi rơi vào bảng ✗ chung.
    throw recruitConflict(
      "MOVE_TO_HIRED",
      RECRUIT_ERR.MOVE_TO_HIRED,
      recruitDetails("hired-via-convert-only", { from, to }),
    );
  }
  if (to === "Hired" && via === "convert" && from === "Offer") return;
  if (!STAGE_EDGES[from].includes(to) || to === "Hired") {
    throw recruitConflict(
      "STAGE_TRANSITION",
      RECRUIT_ERR.STAGE_TRANSITION(from, to),
      recruitDetails("invalid-stage-transition", { from, to }),
    );
  }
}

/** §13.2 — job opening. Closed terminal; KHÔNG guard "còn ứng viên sống" khi đóng. */
const JOB_EDGES: Record<JobOpeningStatus, readonly JobOpeningStatus[]> = {
  Draft: ["Open", "Closed"],
  Open: ["Paused", "Closed"],
  Paused: ["Open", "Closed"],
  Closed: [],
};

export function assertJobOpeningTransition(from: JobOpeningStatus, to: JobOpeningStatus): void {
  if (!JOB_EDGES[from].includes(to)) {
    throw recruitConflict(
      "JOB_TRANSITION",
      RECRUIT_ERR.JOB_TRANSITION(from, to),
      recruitDetails("invalid-job-opening-transition", { from, to }),
    );
  }
}

/** §13.3 — offer. Accepted/Declined/Withdrawn terminal. */
const OFFER_EDGES: Record<OfferStatus, readonly OfferStatus[]> = {
  Draft: ["Sent", "Withdrawn"],
  Sent: ["Accepted", "Declined", "Withdrawn"],
  Accepted: [],
  Declined: [],
  Withdrawn: [],
};

export function assertOfferTransition(from: OfferStatus, to: OfferStatus): void {
  if (!OFFER_EDGES[from].includes(to)) {
    throw recruitConflict(
      "OFFER_TRANSITION",
      RECRUIT_ERR.OFFER_TRANSITION(from, to),
      recruitDetails("invalid-offer-transition", { from, to }),
    );
  }
}

/** Trạng thái terminal của offer ⇒ `responded_at` NOT NULL (chk_offers_responded_pair). */
export const OFFER_TERMINAL_STATUSES: ReadonlySet<OfferStatus> = new Set([
  "Accepted",
  "Declined",
  "Withdrawn",
]);

/** §13.4 — interview. Hai đích terminal. */
const INTERVIEW_EDGES: Record<InterviewStatus, readonly InterviewStatus[]> = {
  Scheduled: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

export function assertInterviewTransition(from: InterviewStatus, to: InterviewStatus): void {
  if (!INTERVIEW_EDGES[from].includes(to)) {
    throw recruitConflict(
      "INTERVIEW_TRANSITION",
      RECRUIT_ERR.INTERVIEW_TRANSITION(from, to),
      recruitDetails("invalid-interview-transition", { from, to }),
    );
  }
}
