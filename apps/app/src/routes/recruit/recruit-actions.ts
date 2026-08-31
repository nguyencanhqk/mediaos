/**
 * S12-RECRUIT-FE-1 — suy hành động hợp lệ từ **FSM ∩ quyền** (SPEC-12 §13, khuôn `asset-actions.ts`).
 *
 * Bốn bảng chuyển tiếp dưới đây MIRROR ĐÚNG `apps/api/src/recruit/recruit-fsm.ts` (nguồn sự thật —
 * `apps/app` KHÔNG import được `apps/api`, phải copy literal; `recruit-fsm.spec.ts` phía BE giữ căn
 * cước 100% ma trận, ở đây chỉ cần đúng THEO BẢNG). Hàm THUẦN, không đụng React — spec neo được toàn bộ
 * ma trận mà không cần dựng DOM.
 *
 * ⚠️ Move-stage (`via='move'`) KHÔNG BAO GIỜ cho đích `Hired` — kể cả khi `STAGE_EDGES.Offer` liệt kê
 * `Hired` ở BE (đường đó CHỈ mở cho `via='convert'`, mã RIÊNG RECRUIT-ERR-014). `availableStageMoveTargets`
 * vì vậy loại `Hired` khỏi MỌI đích, bất kể from là gì.
 */
import type {
  CandidateStageDto,
  JobOpeningStatusDto,
  OfferStatusDto,
  InterviewStatusDto,
} from "@mediaos/contracts";

// ── §13.1 candidate — STAGE_EDGES mirror recruit-fsm.ts (đích `Hired` bị lọc riêng, xem docblock) ──
const STAGE_EDGES: Record<CandidateStageDto, readonly CandidateStageDto[]> = {
  New: ["Screening", "Rejected"],
  Screening: ["Interview", "Rejected"],
  Interview: ["Screening", "Offer", "Rejected"],
  Offer: ["Interview", "Hired", "Rejected"],
  Hired: [],
  Rejected: ["Screening"],
};

/** Đích move-stage hợp lệ (thuần FSM, CHƯA xét quyền) — luôn loại `Hired` (chỉ đạt qua convert). */
export function availableStageMoveTargets(from: CandidateStageDto): readonly CandidateStageDto[] {
  return STAGE_EDGES[from].filter((s) => s !== "Hired");
}

export function isStageMoveAllowed(from: CandidateStageDto, to: CandidateStageDto): boolean {
  return availableStageMoveTargets(from).includes(to);
}

// ── §13.2 job opening — Closed terminal ─────────────────────────────────────────────────────────
const JOB_EDGES: Record<JobOpeningStatusDto, readonly JobOpeningStatusDto[]> = {
  Draft: ["Open", "Closed"],
  Open: ["Paused", "Closed"],
  Paused: ["Open", "Closed"],
  Closed: [],
};

export function availableJobOpeningStatusTargets(
  from: JobOpeningStatusDto,
): readonly JobOpeningStatusDto[] {
  return JOB_EDGES[from];
}

export function isJobOpeningStatusAllowed(
  from: JobOpeningStatusDto,
  to: JobOpeningStatusDto,
): boolean {
  return JOB_EDGES[from].includes(to);
}

// ── §13.3 offer — Accepted/Declined/Withdrawn terminal ──────────────────────────────────────────
const OFFER_EDGES: Record<OfferStatusDto, readonly OfferStatusDto[]> = {
  Draft: ["Sent", "Withdrawn"],
  Sent: ["Accepted", "Declined", "Withdrawn"],
  Accepted: [],
  Declined: [],
  Withdrawn: [],
};

export function availableOfferStatusTargets(from: OfferStatusDto): readonly OfferStatusDto[] {
  return OFFER_EDGES[from];
}

export function isOfferStatusAllowed(from: OfferStatusDto, to: OfferStatusDto): boolean {
  return OFFER_EDGES[from].includes(to);
}

// ── §13.4 interview — hai đích terminal ─────────────────────────────────────────────────────────
const INTERVIEW_EDGES: Record<InterviewStatusDto, readonly InterviewStatusDto[]> = {
  Scheduled: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

export function availableInterviewStatusTargets(
  from: InterviewStatusDto,
): readonly InterviewStatusDto[] {
  return INTERVIEW_EDGES[from];
}

export function isInterviewStatusAllowed(
  from: InterviewStatusDto,
  to: InterviewStatusDto,
): boolean {
  return INTERVIEW_EDGES[from].includes(to);
}

/** Lát cắt tối thiểu cần cho `canConvert` (SPEC-12 §13.5). */
export interface ConvertCandidateSubject {
  readonly stage: CandidateStageDto;
  readonly employeeId: string | null;
}
export interface ConvertOfferSubject {
  readonly status: OfferStatusDto;
}

/**
 * Convert = §13.5: stage `Offer` **VÀ** chưa gắn nhân viên (`employeeId===null`, tránh
 * `uq_candidates_company_employee`) **VÀ** có ít nhất một offer `Accepted` **VÀ** có quyền
 * `convert:candidate` (SENSITIVE — caller truyền kết quả `useCanExact`, KHÔNG suy ở đây).
 */
export function canConvert(
  candidate: ConvertCandidateSubject,
  offers: readonly ConvertOfferSubject[],
  canConvertPerm: boolean,
): boolean {
  return (
    canConvertPerm &&
    candidate.stage === "Offer" &&
    candidate.employeeId === null &&
    offers.some((o) => o.status === "Accepted")
  );
}
