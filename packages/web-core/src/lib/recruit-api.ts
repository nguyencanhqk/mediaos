import { z } from "zod";
import {
  jobOpeningResponseSchema,
  type JobOpeningResponseDto,
  candidateListItemResponseSchema,
  type CandidateListItemResponseDto,
  candidateDetailResponseSchema,
  type CandidateDetailResponseDto,
  candidateDuplicateResponseSchema,
  type CandidateDuplicateResponseDto,
  candidateSummaryResponseSchema,
  type CandidateSummaryResponseDto,
  candidateStageEventResponseSchema,
  type CandidateStageEventResponseDto,
  candidateNoteResponseSchema,
  type CandidateNoteResponseDto,
  candidateNoteUpdateResponseSchema,
  type CandidateNoteUpdateResponseDto,
  interviewResponseSchema,
  type InterviewResponseDto,
  interviewDetailResponseSchema,
  type InterviewDetailResponseDto,
  interviewFeedbackResponseSchema,
  type InterviewFeedbackResponseDto,
  offerResponseSchema,
  type OfferResponseDto,
  convertCandidateResponseSchema,
  type ConvertCandidateResponseDto,
  recruitEmployeePickerItemSchema,
  type RecruitEmployeePickerItemDto,
  recruitUserPickerItemSchema,
  type RecruitUserPickerItemDto,
  type ListJobOpeningsQuery,
  type CreateJobOpeningInput,
  type UpdateJobOpeningInput,
  type ChangeJobOpeningStatusInput,
  type ListCandidatesQuery,
  type ExportCandidatesQuery,
  type CheckDuplicateQuery,
  type CreateCandidateInput,
  type UpdateCandidateInput,
  type MoveCandidateStageInput,
  type CreateCandidateNoteInput,
  type UpdateCandidateNoteInput,
  type ListCandidateSubQuery,
  type ListInterviewsQuery,
  type CreateInterviewInput,
  type UpdateInterviewInput,
  type ChangeInterviewStatusInput,
  type CreateInterviewFeedbackInput,
  type UpdateInterviewFeedbackInput,
  type ListOffersQuery,
  type CreateOfferInput,
  type UpdateOfferInput,
  type ChangeOfferStatusInput,
  type RecruitPickerQuery,
} from "@mediaos/contracts";
import { apiFetch, apiFetchPaginated, type PaginatedResult } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S12-RECRUIT-FE-1 — RECRUIT API client (SPEC-12 §15, RECRUIT-API-001..032). MIRROR BE 5 controller:
 * `JobOpeningsController` · `CandidatesController` · `InterviewsController` · `OffersController` ·
 * `RecruitPickersController`.
 *
 * ⚠️ PHÂN TRANG: mọi list RECRUIT trả `PaginatedResult` (page/per_page, envelope API-01 §7.2) ⇒ dùng
 * `apiFetchPaginated` (memory `apifetch-drops-pagination-bare-array`). Ngoại lệ đi `apiFetch`:
 * check-duplicate/summary/export/picker (mảng/object trần) + chi tiết.
 *
 * Masking là việc của SERVER (recruit.mapper — single exit): email/phone đã che khi thiếu
 * ('update','candidate') — vì vậy schema email KHÔNG `.email()`; `salary` VẮNG MẶT khi thiếu
 * ('manage','offer') — schema `.optional()`. KHÔNG siết lại ở client.
 *
 * `idempotencyKey` cho các POST tạo (@Idempotent BE) do CLIENT sinh khi mở form — tham số BẮT BUỘC
 * (không `?`) như khuôn assignAsset: quên gửi thì bấm-đúp tạo hai bản ghi mà không có gì đỏ.
 */
export const recruitApi = {
  // ── Vị trí tuyển (RECRUIT-API-001..005) ─────────────────────────────────────────────────────────

  /** GET /job-openings — danh sách (`view:job-opening`), CÓ phân trang. */
  listJobOpenings: (
    query?: Partial<ListJobOpeningsQuery>,
  ): Promise<PaginatedResult<JobOpeningResponseDto[]>> =>
    apiFetchPaginated(
      `/job-openings${buildQueryString(query ?? {})}`,
      z.array(jobOpeningResponseSchema),
    ),

  /** POST /job-openings — tạo vị trí (`create:job-opening`). */
  createJobOpening: (body: CreateJobOpeningInput): Promise<JobOpeningResponseDto> =>
    apiFetch("/job-openings", jobOpeningResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /job-openings/:id — chi tiết (`view:job-opening`). */
  getJobOpening: (id: string): Promise<JobOpeningResponseDto> =>
    apiFetch(`/job-openings/${id}`, jobOpeningResponseSchema),

  /** PATCH /job-openings/:id — sửa (`update:job-opening`); KHÔNG nhận `status` (schema strict). */
  updateJobOpening: (id: string, body: UpdateJobOpeningInput): Promise<JobOpeningResponseDto> =>
    apiFetch(`/job-openings/${id}`, jobOpeningResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /job-openings/:id/change-status — FSM §13.2 (`update:job-opening`). */
  changeJobOpeningStatus: (
    id: string,
    body: ChangeJobOpeningStatusInput,
  ): Promise<JobOpeningResponseDto> =>
    apiFetch(`/job-openings/${id}/change-status`, jobOpeningResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Ứng viên (RECRUIT-API-006..017, 029) ────────────────────────────────────────────────────────

  /** GET /candidates — danh sách (`view:candidate` — SENSITIVE, gate FE bằng useCanExact), CÓ phân trang. */
  listCandidates: (
    query?: Partial<ListCandidatesQuery>,
  ): Promise<PaginatedResult<CandidateListItemResponseDto[]>> =>
    apiFetchPaginated(
      `/candidates${buildQueryString(query ?? {})}`,
      z.array(candidateListItemResponseSchema),
    ),

  /** POST /candidates — tạo ứng viên (`create:candidate`, @Idempotent). */
  createCandidate: (
    body: CreateCandidateInput,
    idempotencyKey: string,
  ): Promise<CandidateDetailResponseDto> =>
    apiFetch(
      "/candidates",
      candidateDetailResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /candidates/check-duplicate?email=&phone= — cảnh báo trùng, KHÔNG chặn cứng (REC-SCREEN-004). */
  checkDuplicate: (query: CheckDuplicateQuery): Promise<CandidateDuplicateResponseDto[]> =>
    apiFetch(
      `/candidates/check-duplicate${buildQueryString(query)}`,
      z.array(candidateDuplicateResponseSchema),
    ),

  /** GET /candidates/summary — đếm theo stage + số vị trí Open (`view:candidate`). Object trần. */
  getCandidateSummary: (): Promise<CandidateSummaryResponseDto> =>
    apiFetch("/candidates/summary", candidateSummaryResponseSchema),

  /**
   * GET /candidates/export — toàn tập theo filter, MẢNG TRẦN (không phân trang; BE chặn trần 10k =
   * RECRUIT-ERR-015). Đòi CẢ ('export','candidate') + ('view','candidate') ở BE. CSV dựng ở client.
   */
  exportCandidates: (
    query?: Partial<ExportCandidatesQuery>,
  ): Promise<CandidateListItemResponseDto[]> =>
    apiFetch(
      `/candidates/export${buildQueryString(query ?? {})}`,
      z.array(candidateListItemResponseSchema),
    ),

  /** GET /candidates/:id — chi tiết (`view:candidate`). */
  getCandidate: (id: string): Promise<CandidateDetailResponseDto> =>
    apiFetch(`/candidates/${id}`, candidateDetailResponseSchema),

  /** PATCH /candidates/:id — sửa hồ sơ (`update:candidate`); KHÔNG nhận stage/employeeId. */
  updateCandidate: (id: string, body: UpdateCandidateInput): Promise<CandidateDetailResponseDto> =>
    apiFetch(`/candidates/${id}`, candidateDetailResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /candidates/:id/move-stage — FSM §13.1 (`move-stage:candidate`); →Hired tay = ERR-014. */
  moveCandidateStage: (
    id: string,
    body: MoveCandidateStageInput,
  ): Promise<CandidateDetailResponseDto> =>
    apiFetch(`/candidates/${id}/move-stage`, candidateDetailResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /candidates/:id/stage-events — timeline stage (`view:candidate`), CÓ phân trang. */
  listStageEvents: (
    id: string,
    query?: Partial<ListCandidateSubQuery>,
  ): Promise<PaginatedResult<CandidateStageEventResponseDto[]>> =>
    apiFetchPaginated(
      `/candidates/${id}/stage-events${buildQueryString(query ?? {})}`,
      z.array(candidateStageEventResponseSchema),
    ),

  /** GET /candidates/:id/notes — ghi chú (`view:candidate`), CÓ phân trang. */
  listCandidateNotes: (
    id: string,
    query?: Partial<ListCandidateSubQuery>,
  ): Promise<PaginatedResult<CandidateNoteResponseDto[]>> =>
    apiFetchPaginated(
      `/candidates/${id}/notes${buildQueryString(query ?? {})}`,
      z.array(candidateNoteResponseSchema),
    ),

  /** POST /candidates/:id/notes — thêm ghi chú (`comment:candidate`). */
  createCandidateNote: (
    id: string,
    body: CreateCandidateNoteInput,
  ): Promise<CandidateNoteResponseDto> =>
    apiFetch(`/candidates/${id}/notes`, candidateNoteResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /candidates/:id/notes/:noteId — sửa/soft-delete ghi chú CỦA MÌNH (khác ⇒ 404 chung). */
  updateCandidateNote: (
    id: string,
    noteId: string,
    body: UpdateCandidateNoteInput,
  ): Promise<CandidateNoteUpdateResponseDto> =>
    apiFetch(`/candidates/${id}/notes/${noteId}`, candidateNoteUpdateResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /candidates/:id/convert — chuyển thành nhân viên 1 bước (`convert:candidate`, @Idempotent).
   * Không body; BE tự kiểm: employee_id NULL → stage=Offer → tồn tại offer Accepted (SPEC-12 §13.5).
   */
  convertCandidate: (id: string, idempotencyKey: string): Promise<ConvertCandidateResponseDto> =>
    apiFetch(
      `/candidates/${id}/convert`,
      convertCandidateResponseSchema,
      { method: "POST" },
      { idempotencyKey },
    ),

  // ── Phỏng vấn (RECRUIT-API-018..024) ────────────────────────────────────────────────────────────

  /** GET /interviews — danh sách theo scope (`view:interview`; Own = lượt MÌNH được xếp), CÓ phân trang. */
  listInterviews: (
    query?: Partial<ListInterviewsQuery>,
  ): Promise<PaginatedResult<InterviewResponseDto[]>> =>
    apiFetchPaginated(
      `/interviews${buildQueryString(query ?? {})}`,
      z.array(interviewResponseSchema),
    ),

  /** POST /interviews — tạo lượt (`manage:interview`, @Idempotent); candidate phải ở stage Interview. */
  createInterview: (
    body: CreateInterviewInput,
    idempotencyKey: string,
  ): Promise<InterviewResponseDto> =>
    apiFetch(
      "/interviews",
      interviewResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /interviews/:id — chi tiết + bảng feedback (`view:interview`). */
  getInterview: (id: string): Promise<InterviewDetailResponseDto> =>
    apiFetch(`/interviews/${id}`, interviewDetailResponseSchema),

  /** PATCH /interviews/:id — sửa lượt, chỉ khi Scheduled (`manage:interview`). */
  updateInterview: (id: string, body: UpdateInterviewInput): Promise<InterviewResponseDto> =>
    apiFetch(`/interviews/${id}`, interviewResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /interviews/:id/change-status — Completed/Cancelled (FSM §13.4, `manage:interview`). */
  changeInterviewStatus: (
    id: string,
    body: ChangeInterviewStatusInput,
  ): Promise<InterviewResponseDto> =>
    apiFetch(`/interviews/${id}/change-status`, interviewResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /interviews/:id/feedback — feedback CỦA MÌNH (`feedback:interview`, Own theo participant). */
  createInterviewFeedback: (
    id: string,
    body: CreateInterviewFeedbackInput,
  ): Promise<InterviewFeedbackResponseDto> =>
    apiFetch(`/interviews/${id}/feedback`, interviewFeedbackResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /interviews/:id/feedback — sửa feedback CỦA MÌNH (không nhận id feedback). */
  updateInterviewFeedback: (
    id: string,
    body: UpdateInterviewFeedbackInput,
  ): Promise<InterviewFeedbackResponseDto> =>
    apiFetch(`/interviews/${id}/feedback`, interviewFeedbackResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Offer (RECRUIT-API-025..028, 030) ───────────────────────────────────────────────────────────

  /** GET /offers — danh sách (`view:offer`; `salary` chỉ hiện khi ('manage','offer')), CÓ phân trang. */
  listOffers: (query?: Partial<ListOffersQuery>): Promise<PaginatedResult<OfferResponseDto[]>> =>
    apiFetchPaginated(`/offers${buildQueryString(query ?? {})}`, z.array(offerResponseSchema)),

  /** POST /offers — tạo offer (`manage:offer`, @Idempotent); 1 offer sống/candidate (ERR-006). */
  createOffer: (body: CreateOfferInput, idempotencyKey: string): Promise<OfferResponseDto> =>
    apiFetch(
      "/offers",
      offerResponseSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey },
    ),

  /** GET /offers/:id — chi tiết (`view:offer`). */
  getOffer: (id: string): Promise<OfferResponseDto> =>
    apiFetch(`/offers/${id}`, offerResponseSchema),

  /** PATCH /offers/:id — sửa, chỉ khi Draft (`manage:offer`, ERR-003). */
  updateOffer: (id: string, body: UpdateOfferInput): Promise<OfferResponseDto> =>
    apiFetch(`/offers/${id}`, offerResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /offers/:id/change-status — FSM §13.3 (`manage:offer`); terminal ghi respondedAt. */
  changeOfferStatus: (id: string, body: ChangeOfferStatusInput): Promise<OfferResponseDto> =>
    apiFetch(`/offers/${id}/change-status`, offerResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Picker (RECRUIT-API-031..032) ───────────────────────────────────────────────────────────────

  /** GET /recruit/pickers/employees — chọn interviewer (`manage:interview`) — KHÔNG gọi API HR. */
  pickerEmployees: (query?: Partial<RecruitPickerQuery>): Promise<RecruitEmployeePickerItemDto[]> =>
    apiFetch(
      `/recruit/pickers/employees${buildQueryString(query ?? {})}`,
      z.array(recruitEmployeePickerItemSchema),
    ),

  /** GET /recruit/pickers/recruiter-users — chọn recruiter (`update:job-opening`). */
  pickerRecruiterUsers: (
    query?: Partial<RecruitPickerQuery>,
  ): Promise<RecruitUserPickerItemDto[]> =>
    apiFetch(
      `/recruit/pickers/recruiter-users${buildQueryString(query ?? {})}`,
      z.array(recruitUserPickerItemSchema),
    ),
};
