import { createZodDto } from "nestjs-zod";
import {
  candidateSummaryQuerySchema,
  changeInterviewStatusSchema,
  changeJobOpeningStatusSchema,
  changeOfferStatusSchema,
  checkDuplicateQuerySchema,
  createCandidateNoteSchema,
  createCandidateSchema,
  createInterviewFeedbackSchema,
  createInterviewSchema,
  createJobOpeningSchema,
  createOfferSchema,
  exportCandidatesQuerySchema,
  listCandidateSubQuerySchema,
  listCandidatesQuerySchema,
  listInterviewsQuerySchema,
  listJobOpeningsQuerySchema,
  listOffersQuerySchema,
  moveCandidateStageSchema,
  recruitPickerQuerySchema,
  updateCandidateNoteSchema,
  updateCandidateSchema,
  updateInterviewFeedbackSchema,
  updateInterviewSchema,
  updateJobOpeningSchema,
  updateOfferSchema,
} from "@mediaos/contracts";

/**
 * S12-RECRUIT-BE-1 — DTO biên module RECRUIT. Nguồn sự thật = Zod ở `@mediaos/contracts/recruit`
 * (`createZodDto` ⇒ metatype lúc chạy ⇒ `ZodValidationPipe` cấp METHOD chiếu được schema — KI-068;
 * query DTO cũng validate qua cùng cơ chế, khuôn ASSET).
 */

// ── Job openings (001–005) ──
export class ListJobOpeningsQueryDto extends createZodDto(listJobOpeningsQuerySchema) {}
export class CreateJobOpeningDto extends createZodDto(createJobOpeningSchema) {}
/** `.strict()` — KHÔNG `status` (đổi trạng thái đi 005); field lạ ⇒ 400 tại biên. */
export class UpdateJobOpeningDto extends createZodDto(updateJobOpeningSchema) {}
export class ChangeJobOpeningStatusDto extends createZodDto(changeJobOpeningStatusSchema) {}

// ── Candidates (006–017, 029) ──
export class ListCandidatesQueryDto extends createZodDto(listCandidatesQuerySchema) {}
/** KHÔNG `page`/`per_page` — client gửi ⇒ 400 (export toàn tập, RECRUIT-ERR-015 chặn trần). */
export class ExportCandidatesQueryDto extends createZodDto(exportCandidatesQuerySchema) {}
export class CheckDuplicateQueryDto extends createZodDto(checkDuplicateQuerySchema) {}
export class CandidateSummaryQueryDto extends createZodDto(candidateSummaryQuerySchema) {}
export class CreateCandidateDto extends createZodDto(createCandidateSchema) {}
/** `.strict()` — KHÔNG `stage`/`employeeId`. */
export class UpdateCandidateDto extends createZodDto(updateCandidateSchema) {}
/** `toStage` ĐỦ 6 giá trị — `Hired` chặn ở SERVICE (RECRUIT-ERR-014 sống). */
export class MoveCandidateStageDto extends createZodDto(moveCandidateStageSchema) {}
export class CreateCandidateNoteDto extends createZodDto(createCandidateNoteSchema) {}
export class UpdateCandidateNoteDto extends createZodDto(updateCandidateNoteSchema) {}
export class ListCandidateSubQueryDto extends createZodDto(listCandidateSubQuerySchema) {}

// ── Interviews (018–024) ──
export class ListInterviewsQueryDto extends createZodDto(listInterviewsQuerySchema) {}
export class CreateInterviewDto extends createZodDto(createInterviewSchema) {}
export class UpdateInterviewDto extends createZodDto(updateInterviewSchema) {}
export class ChangeInterviewStatusDto extends createZodDto(changeInterviewStatusSchema) {}
export class CreateInterviewFeedbackDto extends createZodDto(createInterviewFeedbackSchema) {}
export class UpdateInterviewFeedbackDto extends createZodDto(updateInterviewFeedbackSchema) {}

// ── Offers (025–028, 030) ──
export class ListOffersQueryDto extends createZodDto(listOffersQuerySchema) {}
export class CreateOfferDto extends createZodDto(createOfferSchema) {}
export class UpdateOfferDto extends createZodDto(updateOfferSchema) {}
export class ChangeOfferStatusDto extends createZodDto(changeOfferStatusSchema) {}

// ── Pickers (031–032) ──
export class RecruitPickerQueryDto extends createZodDto(recruitPickerQuerySchema) {}
