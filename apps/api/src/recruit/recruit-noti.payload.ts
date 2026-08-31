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

/**
 * ⚠️ BIẾN TEMPLATE PHẢI KHỚP NGUYÊN VĂN variables_schema của 0561 (snake_case) — thiếu khoá thì
 * renderer giữ nguyên `{placeholder}` trong target_url ⇒ `assertInternalTargetUrl` từ chối ⇒ MỌI
 * NOTI RECRUIT dead-letter câm (bug chặn merge do recruit-be1-noti.int-spec bắt được 31/08/2026).
 * Khoá camelCase giữ SONG SONG cho neo/dedupe của registrar.
 */
export interface RecruitJobAssignedPayload {
  jobOpeningId: string;
  newRecruiterUserId: string;
  /** RETURNING `updated_at` của CHÍNH câu UPDATE gán recruiter — nửa khoá dedupe (plan §8). */
  assignedAtIso: string;
  actorUserId: string;
  // Template 0561: actor_name · job_title · job_opening_id.
  actor_name: string;
  job_title: string;
  job_opening_id: string;
  [key: string]: unknown;
}

export interface RecruitInterviewScheduledPayload {
  interviewId: string;
  candidateId: string;
  actorUserId: string;
  // Template 0561: actor_name · candidate_name · round · job_title · time_range · candidate_id.
  actor_name: string;
  candidate_name: string;
  round: number;
  job_title: string;
  time_range: string;
  candidate_id: string;
  [key: string]: unknown;
}

export interface RecruitStageChangedPayload {
  stageEventId: string;
  candidateId: string;
  jobOpeningId: string;
  actorUserId: string;
  // Template 0561: actor_name · candidate_name · job_title · from_stage · to_stage · candidate_id.
  actor_name: string;
  candidate_name: string;
  job_title: string;
  from_stage: string;
  to_stage: string;
  candidate_id: string;
  [key: string]: unknown;
}

export interface RecruitCandidateHiredPayload {
  candidateId: string;
  employeeId: string;
  jobOpeningId: string;
  actorUserId: string;
  // Template 0561: candidate_name · job_title · candidate_id.
  candidate_name: string;
  job_title: string;
  candidate_id: string;
  [key: string]: unknown;
}

/** Nhãn trung tính khi `users.full_name` NULL — không quy hành động cho "Hệ thống" (khuôn ASSET). */
export const RECRUIT_ACTOR_FALLBACK = "Bộ phận tuyển dụng";

/**
 * `time_range` cho template 017 — giờ VN mặc định hệ thống (FE cũng chạy DEFAULT_TIMEZONE).
 *
 * FULL gate silent-failure F1: `DEFAULT_TIMEZONE` KHÔNG qua env.schema — giá trị rác làm `Intl` ném
 * RangeError ĐỒNG BỘ giữa business tx (interview đã insert) ⇒ rollback oan + 500 vô danh vì một mối
 * bận tâm ĐỊNH DẠNG. Suy thoái ĐÚNG chiều: lỗi format ⇒ fallback ISO thô (noti xấu nhưng tx sống).
 */
export function formatInterviewTimeRange(startsAt: Date, endsAt: Date): string {
  try {
    const tz = process.env.DEFAULT_TIMEZONE || "Asia/Ho_Chi_Minh";
    const time = new Intl.DateTimeFormat("vi-VN", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    });
    const day = new Intl.DateTimeFormat("vi-VN", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return `${time.format(startsAt)}–${time.format(endsAt)} ${day.format(startsAt)}`;
  } catch {
    return `${startsAt.toISOString()} – ${endsAt.toISOString()}`;
  }
}
