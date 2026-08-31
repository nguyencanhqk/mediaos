/**
 * S12-RECRUIT-BE-1 — payload outbox cho 4 event RECRUIT (SPEC-12 §17, seed 0561). Chỉ tên ứng viên +
 * tên vị trí + stage/giờ hẹn + id neo — KHÔNG email/phone/lương (§18). Registrar
 * (`notifications/recruit-noti-bridge.registrar.ts`) map `eventType` nội bộ → `eventCode` catalog và
 * dựng `dedupeKey` content-derived từ các trường dưới đây (KHÔNG `auditLogId` — plan §8).
 */
export const RECRUIT_EVENT_JOB_ASSIGNED = "recruit.job_assigned";
export const RECRUIT_EVENT_INTERVIEW_SCHEDULED = "recruit.interview_scheduled";
export const RECRUIT_EVENT_STAGE_CHANGED = "recruit.stage_changed";
export const RECRUIT_EVENT_CANDIDATE_HIRED = "recruit.candidate_hired";

export interface RecruitJobAssignedPayload {
  jobOpeningId: string;
  newRecruiterUserId: string;
  /** RETURNING `updated_at` của CHÍNH câu UPDATE gán recruiter — nửa khoá dedupe (plan §8). */
  assignedAtIso: string;
  actorUserId: string;
  job_title: string;
  [key: string]: unknown;
}

export interface RecruitInterviewScheduledPayload {
  interviewId: string;
  candidateId: string;
  actorUserId: string;
  candidate_name: string;
  job_title: string;
  starts_at: string;
  [key: string]: unknown;
}

export interface RecruitStageChangedPayload {
  stageEventId: string;
  candidateId: string;
  jobOpeningId: string;
  actorUserId: string;
  candidate_name: string;
  from_stage: string;
  to_stage: string;
  [key: string]: unknown;
}

export interface RecruitCandidateHiredPayload {
  candidateId: string;
  employeeId: string;
  jobOpeningId: string;
  actorUserId: string;
  candidate_name: string;
  job_title: string;
  [key: string]: unknown;
}
