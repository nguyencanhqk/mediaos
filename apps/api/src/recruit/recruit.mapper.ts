import type {
  Candidate,
  Interview,
  InterviewFeedback,
  JobOpening,
  Offer,
} from "../db/schema/recruit";
import type { RecruitActor, RecruitPeopleMap } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — recruit.mapper: ĐIỂM MASKING PII DUY NHẤT của toàn module (plan §4.4 — single
 * exit). MỌI đường trả về hàng `candidates` (006 list · 011 detail · 010 export · embed interview
 * 018/020) đi qua `toCandidateListItem`/`toCandidateDetail` — cấm repository/controller tự chọn
 * `email`/`phone` ra response.
 *
 *   • `actor.canSeeCandidatePii` = `('update','candidate')` isSensitive:true (chống bypass `*:*`).
 *   • `actor.canSeeSalary` = `('manage','offer')` isSensitive:false (REC-DEC-004) — thiếu ⇒ khoá
 *     `salary` VẮNG MẶT (không `null` — memory `server-masking-needs-optional-fe-schema`).
 *   • `candidates.fullName` là cột CANDIDATE (không phải `users`) — projection được phép lộ trên
 *     đường `view:interview` + NOTI, KHÔNG kèm email/phone/source/note (SPEC-12 §18/§4.6).
 */

/** `d***@***.vn` — giữ ký tự đầu local-part + TLD; hàm THUẦN, biên rỗng/null an toàn. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email[0];
  const domain = email.slice(at + 1);
  const lastDot = domain.lastIndexOf(".");
  const tld = lastDot > 0 ? domain.slice(lastDot) : "";
  return `${first}***@***${tld}`;
}

/** `09** *** *45` — giữ 2 số đầu + 2 số cuối; ngắn quá ⇒ che hết. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9+]/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 2)}** *** *${digits.slice(-2)}`;
}

export interface CandidateListItemDto {
  id: string;
  jobOpeningId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: string;
  employeeId: string | null;
  piiMasked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateDetailDto extends CandidateListItemDto {
  note: string | null;
}

const candidateBase = (row: Candidate, actor: RecruitActor): CandidateListItemDto => {
  const open = actor.canSeeCandidatePii;
  return {
    id: row.id,
    jobOpeningId: row.jobOpeningId,
    fullName: row.fullName,
    email: open ? (row.email ?? null) : maskEmail(row.email ?? null),
    phone: open ? (row.phone ?? null) : maskPhone(row.phone ?? null),
    source: row.source ?? null,
    stage: row.stage,
    employeeId: row.employeeId ?? null,
    piiMasked: !open,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

export function toCandidateListItem(row: Candidate, actor: RecruitActor): CandidateListItemDto {
  return candidateBase(row, actor);
}

export function toCandidateDetail(row: Candidate, actor: RecruitActor): CandidateDetailDto {
  return { ...candidateBase(row, actor), note: row.note ?? null };
}

/** Embed trong DTO interview (018/020) — CHỈ fullName + stage, KHÔNG PII/nguồn/ghi chú (§4.6). */
export interface CandidateEmbedDto {
  id: string;
  fullName: string;
  stage: string;
}
export function toCandidateEmbed(row: {
  id: string;
  fullName: string;
  stage: string;
}): CandidateEmbedDto {
  return { id: row.id, fullName: row.fullName, stage: row.stage };
}

export interface JobOpeningDto {
  id: string;
  title: string;
  description: string | null;
  orgUnitId: string;
  positionId: string | null;
  headcount: number;
  recruiterUserId: string | null;
  recruiterName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function toJobOpeningDto(
  row: JobOpening & { title: string },
  people: RecruitPeopleMap,
): JobOpeningDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    orgUnitId: row.orgUnitId,
    positionId: row.positionId ?? null,
    headcount: row.headcount,
    recruiterUserId: row.recruiterUserId ?? null,
    recruiterName: row.recruiterUserId
      ? (people.get(row.recruiterUserId)?.displayName ?? null)
      : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface InterviewParticipantDto {
  employeeId: string;
  fullName: string | null;
  employeeCode: string | null;
}

export interface InterviewDto {
  id: string;
  candidate: CandidateEmbedDto;
  round: number;
  startsAt: string;
  endsAt: string;
  location: string | null;
  note: string | null;
  status: string;
  participants: InterviewParticipantDto[];
  createdAt: string;
}

export function toInterviewDto(
  row: Interview,
  candidate: { id: string; fullName: string; stage: string },
  participants: Array<{ employeeId: string; userId: string | null }>,
  people: RecruitPeopleMap,
): InterviewDto {
  return {
    id: row.id,
    candidate: toCandidateEmbed(candidate),
    round: row.round,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location ?? null,
    note: row.note ?? null,
    status: row.status,
    participants: participants.map((p) => {
      const ref = p.userId ? people.get(p.userId) : undefined;
      return {
        employeeId: p.employeeId,
        fullName: ref?.displayName ?? null,
        employeeCode: ref?.employeeCode ?? null,
      };
    }),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface FeedbackDto {
  id: string;
  interviewId: string;
  interviewerEmployeeId: string;
  rating: number;
  comment: string | null;
  recommendation: string;
  createdAt: string;
  updatedAt: string;
}

export function toFeedbackDto(row: InterviewFeedback): FeedbackDto {
  return {
    id: row.id,
    interviewId: row.interviewId,
    interviewerEmployeeId: row.interviewerEmployeeId,
    rating: row.rating,
    comment: row.comment ?? null,
    recommendation: row.recommendation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `salary` — khoá VẮNG MẶT khi thiếu `('manage','offer')` (FE schema `.optional()`). */
export interface OfferDto {
  id: string;
  candidateId: string;
  title: string | null;
  startDate: string;
  salary?: string;
  note: string | null;
  status: string;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOfferDto(row: Offer, actor: RecruitActor): OfferDto {
  const base: OfferDto = {
    id: row.id,
    candidateId: row.candidateId,
    title: row.title ?? null,
    startDate: row.startDate,
    note: row.note ?? null,
    status: row.status,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (actor.canSeeSalary) base.salary = String(row.salary);
  return base;
}
