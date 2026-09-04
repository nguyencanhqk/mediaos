import { z } from "zod";

/**
 * S12-RECRUIT-DB-1 — enum/hằng chuẩn module RECRUIT (SPEC-12 · DB-14 §7). NGUỒN SỰ THẬT cho DTO của
 * S12-RECRUIT-BE-1 (API-17).
 *
 * 4 enum FSM MIRROR ĐÚNG BẰNG CHECK của migration 0559 — HAI CHIỀU: không chặt hơn (giá trị DB hợp lệ mà
 * Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 check-violation vô danh —
 * `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `recruit.spec.ts` (mảng literal chép
 * từ migration, cố ý KHÔNG import từ schema drizzle).
 *
 * Chỉ ENUM/HẰNG ở WO DB (chưa có consumer DTO); request/response schema viết ở WO BE cùng API-17.
 * Tên export prefix `recruit*`/`candidate*`/`jobOpening*`/`interview*`/`offer*` — không đụng barrel park
 * (`contracts-barrel-collides-with-parked-media`).
 */

/** `chk_candidates_stage` + `chk_cse_from/to` — SPEC-01 §17.11. FSM §13.1 ép ở service. */
export const candidateStageSchema = z.enum([
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
]);
export type CandidateStageDto = z.infer<typeof candidateStageSchema>;

/**
 * ⚠️ HỢP ĐỒNG cho BE-1 (plan-review DOC-1 B2): Zod của move-stage `toStage` dùng CHÍNH
 * `candidateStageSchema` — ĐỦ 6 giá trị, KHÔNG cắt `Hired` ở biên. Chặn `Hired` bằng tay là việc của
 * SERVICE với mã RECRUIT-ERR-014 (409) — cắt ở Zod là 014 thành mã CHẾT
 * (`equal-caps-at-zod-and-service-make-dead-error-code`).
 */
export const candidateMoveStageTargetSchema = candidateStageSchema;

/** `chk_job_openings_status` — SPEC-01 §17.12. `Closed` là terminal v1 (FSM §13.2 ở service). */
export const jobOpeningStatusSchema = z.enum(["Draft", "Open", "Paused", "Closed"]);
export type JobOpeningStatusDto = z.infer<typeof jobOpeningStatusSchema>;

/** `chk_interviews_status` — SPEC-01 §17.13. Hai đích terminal (FSM §13.4 ở service). */
export const interviewStatusSchema = z.enum(["Scheduled", "Completed", "Cancelled"]);
export type InterviewStatusDto = z.infer<typeof interviewStatusSchema>;

/** `chk_offers_status` — SPEC-01 §17.14. Accepted/Declined/Withdrawn terminal (FSM §13.3 ở service). */
export const offerStatusSchema = z.enum(["Draft", "Sent", "Accepted", "Declined", "Withdrawn"]);
export type OfferStatusDto = z.infer<typeof offerStatusSchema>;

/** `chk_cse_action` — hàng convert là `Offer → Hired` duy nhất (SPEC-12 §13.1). */
export const candidateStageActionSchema = z.enum(["move", "convert"]);
export type CandidateStageActionDto = z.infer<typeof candidateStageActionSchema>;

/** `chk_feedback_reco` — khuyến nghị per-interviewer (DB-14 §6.7). */
export const interviewRecommendationSchema = z.enum(["Hire", "No Hire", "Consider"]);
export type InterviewRecommendationDto = z.infer<typeof interviewRecommendationSchema>;

/** `chk_feedback_rating` — 1..5 (DB-14 §6.7). */
export const RECRUIT_FEEDBACK_RATING_MIN = 1;
export const RECRUIT_FEEDBACK_RATING_MAX = 5;
export const interviewFeedbackRatingSchema = z
  .number()
  .int()
  .min(RECRUIT_FEEDBACK_RATING_MIN)
  .max(RECRUIT_FEEDBACK_RATING_MAX);

/** SPEC-12 §13.1 — `reason` bắt buộc cho mọi lần move (kanban luôn mở hộp lý do). */
export const RECRUIT_MOVE_REASON_MIN = 3;

/** SPEC-12 §19 / RECRUIT-ERR-015 — trần export theo filter hiện hành (422 khi vượt). */
export const RECRUIT_EXPORT_MAX_ROWS = 10_000;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S12-RECRUIT-BE-1 — request/response schema cho 32 route API-17 (§15). Query dùng `page`/`per_page`
// (envelope API-01 §7.2, khuôn ASSET); PATCH `.strict()` — field lạ ⇒ 400 tại biên.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const recruitText = (max: number) => z.string().trim().min(1).max(max);
const recruitNullableText = (max: number) => z.string().trim().min(1).max(max).nullish();
/** `YYYY-MM-DD` (date cột PG) — không coerce Date để giữ nguyên chuỗi at-rest. */
const recruitDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
/** ISO datetime có offset — timestamp with time zone. */
const recruitInstantSchema = z.string().datetime({ offset: true });

export const RECRUIT_PAGE_DEFAULT = 20;
export const RECRUIT_PAGE_MAX = 100;
const recruitPageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(RECRUIT_PAGE_MAX).default(RECRUIT_PAGE_DEFAULT),
};

/** CSV hoặc lặp key → mảng enum (memory `zod-query-param-double-pipe-idempotent` — idempotent). */
const csvEnumList = <T extends z.ZodTypeAny>(item: T) =>
  z
    .preprocess((v) => {
      if (v === undefined || v === null || v === "") return undefined;
      if (Array.isArray(v)) return v;
      if (typeof v === "string") return v.split(",").map((s) => s.trim());
      return v;
    }, z.array(item).min(1))
    .optional();

// ── Job openings (001–005) ──────────────────────────────────────────────────────────────────────

export const listJobOpeningsQuerySchema = z.object({
  status: csvEnumList(jobOpeningStatusSchema),
  orgUnitId: z.string().uuid().optional(),
  recruiterUserId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  ...recruitPageQuery,
});
export type ListJobOpeningsQuery = z.infer<typeof listJobOpeningsQuerySchema>;

export const createJobOpeningSchema = z.object({
  title: recruitText(255),
  description: recruitNullableText(10_000),
  orgUnitId: z.string().uuid(),
  positionId: z.string().uuid().nullish(),
  headcount: z.number().int().min(1).default(1),
  recruiterUserId: z.string().uuid().nullish(),
});
export type CreateJobOpeningInput = z.infer<typeof createJobOpeningSchema>;

/** KHÔNG `status` (đổi trạng thái đi route 005) — field lạ ⇒ 400. */
export const updateJobOpeningSchema = z
  .object({
    title: recruitText(255).optional(),
    description: recruitNullableText(10_000).optional(),
    positionId: z.string().uuid().nullish().optional(),
    headcount: z.number().int().min(1).optional(),
    recruiterUserId: z.string().uuid().nullish().optional(),
  })
  .strict();
export type UpdateJobOpeningInput = z.infer<typeof updateJobOpeningSchema>;

export const changeJobOpeningStatusSchema = z.object({
  toStatus: jobOpeningStatusSchema,
  reason: recruitNullableText(500),
});
export type ChangeJobOpeningStatusInput = z.infer<typeof changeJobOpeningStatusSchema>;

// ── Candidates (006–017, 029) ───────────────────────────────────────────────────────────────────

export const listCandidatesQuerySchema = z.object({
  jobOpeningId: z.string().uuid().optional(),
  stage: csvEnumList(candidateStageSchema),
  source: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  ...recruitPageQuery,
});
export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;

/**
 * Export (010) — KHÔNG nhận `page`/`per_page`: client gửi ⇒ 400 Zod (field lạ, chặn ở biên, KHÔNG
 * âm thầm bỏ qua). Trần RECRUIT_EXPORT_MAX_ROWS đo bằng COUNT(*) ở service (RECRUIT-ERR-015).
 */
export const exportCandidatesQuerySchema = listCandidatesQuerySchema
  .omit({ page: true, per_page: true })
  .strict();
export type ExportCandidatesQuery = z.infer<typeof exportCandidatesQuerySchema>;

export const createCandidateSchema = z.object({
  jobOpeningId: z.string().uuid(),
  fullName: recruitText(255),
  email: z.string().trim().email().max(255).nullish(),
  phone: recruitNullableText(30),
  source: recruitNullableText(120),
  note: recruitNullableText(10_000),
});
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;

/** KHÔNG `stage`/`employeeId` (move-stage/convert là route riêng) — field lạ ⇒ 400. */
export const updateCandidateSchema = z
  .object({
    jobOpeningId: z.string().uuid().optional(),
    fullName: recruitText(255).optional(),
    email: z.string().trim().email().max(255).nullish().optional(),
    phone: recruitNullableText(30).optional(),
    source: recruitNullableText(120).optional(),
    note: recruitNullableText(10_000).optional(),
  })
  .strict();
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

/** Thiếu CẢ HAI tham số ⇒ 400 (service không đoán). */
export const checkDuplicateQuerySchema = z
  .object({
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().min(3).max(30).optional(),
  })
  .refine((v) => v.email !== undefined || v.phone !== undefined, {
    message: "cần ít nhất một trong email/phone",
    path: ["email"],
  });
export type CheckDuplicateQuery = z.infer<typeof checkDuplicateQuerySchema>;

export const candidateSummaryQuerySchema = z.object({});
export type CandidateSummaryQuery = z.infer<typeof candidateSummaryQuerySchema>;

/**
 * Move-stage (013) — `toStage` ĐỦ 6 giá trị (`candidateMoveStageTargetSchema`): `Hired` bị chặn ở
 * SERVICE bằng RECRUIT-ERR-014, KHÔNG cắt ở Zod (mã 014 phải SỐNG).
 */
export const moveCandidateStageSchema = z.object({
  toStage: candidateMoveStageTargetSchema,
  reason: z.string().trim().min(RECRUIT_MOVE_REASON_MIN).max(500),
});
export type MoveCandidateStageInput = z.infer<typeof moveCandidateStageSchema>;

export const createCandidateNoteSchema = z.object({ body: recruitText(10_000) });
export type CreateCandidateNoteInput = z.infer<typeof createCandidateNoteSchema>;

/** `delete: true` = soft-delete ghi chú CỦA MÌNH (UPDATE `deleted_at`, không route DELETE). */
export const updateCandidateNoteSchema = z
  .object({
    body: recruitText(10_000).optional(),
    delete: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.body !== undefined || v.delete === true, {
    message: "cần body hoặc delete",
    path: ["body"],
  });
export type UpdateCandidateNoteInput = z.infer<typeof updateCandidateNoteSchema>;

export const listCandidateSubQuerySchema = z.object({ ...recruitPageQuery });
export type ListCandidateSubQuery = z.infer<typeof listCandidateSubQuerySchema>;

// ── Interviews (018–024) ────────────────────────────────────────────────────────────────────────

export const listInterviewsQuerySchema = z.object({
  candidateId: z.string().uuid().optional(),
  from: recruitInstantSchema.optional(),
  to: recruitInstantSchema.optional(),
  status: csvEnumList(interviewStatusSchema),
  ...recruitPageQuery,
});
export type ListInterviewsQuery = z.infer<typeof listInterviewsQuerySchema>;

export const createInterviewSchema = z.object({
  candidateId: z.string().uuid(),
  round: z.number().int().min(1).default(1),
  startsAt: recruitInstantSchema,
  endsAt: recruitInstantSchema,
  location: recruitNullableText(500),
  note: recruitNullableText(10_000),
  participantEmployeeIds: z.array(z.string().uuid()).min(1).max(20),
});
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;

/** Chỉ khi `Scheduled` (RECRUIT-ERR-004 ở service); KHÔNG participantEmployeeIds (sổ chỉ-INSERT). */
export const updateInterviewSchema = z
  .object({
    round: z.number().int().min(1).optional(),
    startsAt: recruitInstantSchema.optional(),
    endsAt: recruitInstantSchema.optional(),
    location: recruitNullableText(500).optional(),
    note: recruitNullableText(10_000).optional(),
  })
  .strict();
export type UpdateInterviewInput = z.infer<typeof updateInterviewSchema>;

export const changeInterviewStatusSchema = z.object({
  toStatus: z.enum(["Completed", "Cancelled"]),
  note: recruitNullableText(500),
});
export type ChangeInterviewStatusInput = z.infer<typeof changeInterviewStatusSchema>;

export const createInterviewFeedbackSchema = z.object({
  rating: interviewFeedbackRatingSchema,
  comment: recruitNullableText(10_000),
  recommendation: interviewRecommendationSchema,
});
export type CreateInterviewFeedbackInput = z.infer<typeof createInterviewFeedbackSchema>;

export const updateInterviewFeedbackSchema = z
  .object({
    rating: interviewFeedbackRatingSchema.optional(),
    comment: recruitNullableText(10_000).optional(),
    recommendation: interviewRecommendationSchema.optional(),
  })
  .strict();
export type UpdateInterviewFeedbackInput = z.infer<typeof updateInterviewFeedbackSchema>;

// ── Offers (025–028, 030) ───────────────────────────────────────────────────────────────────────

export const listOffersQuerySchema = z.object({
  candidateId: z.string().uuid().optional(),
  status: csvEnumList(offerStatusSchema),
  ...recruitPageQuery,
});
export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;

/** `salary` chuỗi numeric (precision 18,2) — không float (mirror moneySchema ASSET). */
export const recruitSalarySchema = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "expected numeric string");

export const createOfferSchema = z.object({
  candidateId: z.string().uuid(),
  title: recruitNullableText(255),
  startDate: recruitDateSchema,
  salary: recruitSalarySchema,
  note: recruitNullableText(10_000),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

/** Chỉ khi `Draft` (RECRUIT-ERR-003 ở service). */
export const updateOfferSchema = z
  .object({
    title: recruitNullableText(255).optional(),
    startDate: recruitDateSchema.optional(),
    salary: recruitSalarySchema.optional(),
    note: recruitNullableText(10_000).optional(),
  })
  .strict();
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export const changeOfferStatusSchema = z.object({
  toStatus: offerStatusSchema,
  note: recruitNullableText(500),
});
export type ChangeOfferStatusInput = z.infer<typeof changeOfferStatusSchema>;

// ── Pickers (031–032) ───────────────────────────────────────────────────────────────────────────

export const recruitPickerQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RecruitPickerQuery = z.infer<typeof recruitPickerQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S12-RECRUIT-FE-1 — response schema (mirror recruit.mapper.ts — điểm masking DUY NHẤT phía BE).
// FE validate Zod ở biên (khuôn asset-api). HAI quy tắc masking KHÔNG được siết lại ở đây:
//   • `email` là CHUỖI THƯỜNG, KHÔNG `.email()`: thiếu ('update','candidate') server trả dạng mask
//     "d***@***.vn" — schema .email() sẽ ZodError trắng trang đúng cho người đang bị che.
//   • `salary` `.optional()` (KHÔNG nullable): thiếu ('manage','offer') server cho khoá VẮNG MẶT
//     (memory `server-masking-needs-optional-fe-schema`).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const jobOpeningResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  orgUnitId: z.string().uuid(),
  positionId: z.string().uuid().nullable(),
  headcount: z.number().int(),
  recruiterUserId: z.string().uuid().nullable(),
  recruiterName: z.string().nullable(),
  status: jobOpeningStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobOpeningResponseDto = z.infer<typeof jobOpeningResponseSchema>;

export const candidateListItemResponseSchema = z.object({
  id: z.string().uuid(),
  jobOpeningId: z.string().uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string().nullable(),
  stage: candidateStageSchema,
  employeeId: z.string().uuid().nullable(),
  /** true = email/phone đang bị server che (caller thiếu ('update','candidate')). */
  piiMasked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CandidateListItemResponseDto = z.infer<typeof candidateListItemResponseSchema>;

export const candidateDetailResponseSchema = candidateListItemResponseSchema.extend({
  note: z.string().nullable(),
});
export type CandidateDetailResponseDto = z.infer<typeof candidateDetailResponseSchema>;

/** Embed trong interview (018/020) — CHỈ fullName + stage, KHÔNG PII (SPEC-12 §4.6). */
export const candidateEmbedResponseSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  stage: candidateStageSchema,
});
export type CandidateEmbedResponseDto = z.infer<typeof candidateEmbedResponseSchema>;

export const interviewParticipantResponseSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string().nullable(),
  employeeCode: z.string().nullable(),
});
export type InterviewParticipantResponseDto = z.infer<typeof interviewParticipantResponseSchema>;

export const interviewResponseSchema = z.object({
  id: z.string().uuid(),
  candidate: candidateEmbedResponseSchema,
  round: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  location: z.string().nullable(),
  note: z.string().nullable(),
  status: interviewStatusSchema,
  participants: z.array(interviewParticipantResponseSchema),
  createdAt: z.string(),
});
export type InterviewResponseDto = z.infer<typeof interviewResponseSchema>;

export const interviewFeedbackResponseSchema = z.object({
  id: z.string().uuid(),
  interviewId: z.string().uuid(),
  interviewerEmployeeId: z.string().uuid(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  recommendation: interviewRecommendationSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InterviewFeedbackResponseDto = z.infer<typeof interviewFeedbackResponseSchema>;

/** 020 — detail = interview + bảng feedback per-interviewer. */
export const interviewDetailResponseSchema = interviewResponseSchema.extend({
  feedbacks: z.array(interviewFeedbackResponseSchema),
});
export type InterviewDetailResponseDto = z.infer<typeof interviewDetailResponseSchema>;

export const offerResponseSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  title: z.string().nullable(),
  startDate: z.string(),
  /** VẮNG MẶT khi caller thiếu ('manage','offer') — REC-DEC-004, KHÔNG đổi thành nullable. */
  salary: recruitSalarySchema.optional(),
  note: z.string().nullable(),
  status: offerStatusSchema,
  respondedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OfferResponseDto = z.infer<typeof offerResponseSchema>;

/** 008 — check-duplicate: bó hẹp, KHÔNG PII (kể cả email/phone khớp cũng không echo lại). */
export const candidateDuplicateResponseSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  stage: candidateStageSchema,
  jobOpeningTitle: z.string(),
  deleted: z.boolean(),
});
export type CandidateDuplicateResponseDto = z.infer<typeof candidateDuplicateResponseSchema>;

/** 009 — summary: byStage chỉ chứa stage CÓ ứng viên (khoá vắng = 0). */
export const candidateSummaryResponseSchema = z.object({
  byStage: z.record(z.number().int()),
  openJobOpenings: z.number().int(),
});
export type CandidateSummaryResponseDto = z.infer<typeof candidateSummaryResponseSchema>;

export const candidateStageEventResponseSchema = z.object({
  id: z.string().uuid(),
  fromStage: candidateStageSchema,
  toStage: candidateStageSchema,
  action: candidateStageActionSchema,
  reason: z.string(),
  actedBy: z.string().uuid().nullable(),
  actedAt: z.string(),
});
export type CandidateStageEventResponseDto = z.infer<typeof candidateStageEventResponseSchema>;

export const candidateNoteResponseSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CandidateNoteResponseDto = z.infer<typeof candidateNoteResponseSchema>;

/** 017 — `{delete:true}` trả `{id,deleted:true}`; sửa body trả note đầy đủ. */
export const candidateNoteUpdateResponseSchema = z.union([
  z.object({ id: z.string().uuid(), deleted: z.literal(true) }),
  candidateNoteResponseSchema,
]);
export type CandidateNoteUpdateResponseDto = z.infer<typeof candidateNoteUpdateResponseSchema>;

/** 029 — convert 1 bước (REC-DEC-005): stage sau LUÔN là Hired. */
export const convertCandidateResponseSchema = z.object({
  candidateId: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  stage: z.literal("Hired"),
});
export type ConvertCandidateResponseDto = z.infer<typeof convertCandidateResponseSchema>;

/** 031 — picker interviewer (id = employee_profiles.id, trường bó hẹp — RecruitPeopleRepository). */
export const recruitEmployeePickerItemSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  employeeCode: z.string().nullable(),
});
export type RecruitEmployeePickerItemDto = z.infer<typeof recruitEmployeePickerItemSchema>;

/** 032 — picker recruiter (id = users.id). */
export const recruitUserPickerItemSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
});
export type RecruitUserPickerItemDto = z.infer<typeof recruitUserPickerItemSchema>;

// ─── Tệp CV ứng viên (033–037, S14-RECRUIT-FILEGRANT-1) ────────────────────────────────────────

/**
 * 035 — `POST /candidates/:id/files/upload-url`. Đăng ký metadata + xin presigned-PUT.
 *
 * KHÔNG nhận `visibility`/`moduleCode`/`entityType`/`entityId` từ client: cả bốn do SERVER đặt
 * (`Private` + `RECRUIT`/`candidate`/`:id` của URL). Client khai được `visibility` là mở đường đưa CV
 * — PII ứng viên — lên `Public`; khai được module/entity là tạo link "ma" trỏ sang module khác.
 * `.strict()` ⇒ field lạ ăn 400 tại biên thay vì bị bỏ qua trong im lặng.
 */
export const recruitCandidateFileUploadUrlInputSchema = z
  .object({
    originalName: z.string().trim().min(1).max(500),
    declaredMimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();
export type RecruitCandidateFileUploadUrlInput = z.infer<
  typeof recruitCandidateFileUploadUrlInputSchema
>;

/**
 * 033/037 — một tệp CV đã gắn vào ứng viên (compose từ `file_links ⋈ files`, khuôn `employeeFileDto`).
 *
 * KHÔNG lộ storage internals (BẤT BIẾN #2.3): storagePath/storedName/checksum/bucket đều vắng mặt.
 * `originalName` CỐ Ý **không mask** — SPEC-12 §18 buộc che email/phone ở DTO có cấu trúc, nhưng người
 * đọc được tệp này có `view:candidate` nên đọc được TOÀN VĂN CV; che tên tệp trong khi phục vụ chính
 * tệp đó là hình thức (plan §3.9).
 */
export const recruitCandidateFileSchema = z.object({
  linkId: z.string().uuid(),
  fileId: z.string().uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  scanStatus: z.string(),
  uploadStatus: z.string(),
  uploadedAt: z.string(),
  /** `file_links.purpose` — luôn `'CV'` ở luồng hiện tại, giữ nullable cho tệp gắn tay trước đây. */
  purpose: z.string().nullable(),
});
export type RecruitCandidateFileDto = z.infer<typeof recruitCandidateFileSchema>;
