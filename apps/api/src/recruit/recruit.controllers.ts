import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { RECRUIT_ROUTE_PAIRS as P } from "./recruit-route-pairs.const";
import {
  CandidateSummaryQueryDto,
  ChangeInterviewStatusDto,
  ChangeJobOpeningStatusDto,
  ChangeOfferStatusDto,
  CheckDuplicateQueryDto,
  CreateCandidateDto,
  CreateCandidateNoteDto,
  CreateInterviewDto,
  CreateInterviewFeedbackDto,
  CreateJobOpeningDto,
  CreateOfferDto,
  ExportCandidatesQueryDto,
  ListCandidateSubQueryDto,
  ListCandidatesQueryDto,
  ListInterviewsQueryDto,
  ListJobOpeningsQueryDto,
  ListOffersQueryDto,
  MoveCandidateStageDto,
  RecruitPickerQueryDto,
  UpdateCandidateDto,
  UpdateCandidateNoteDto,
  UpdateInterviewDto,
  UpdateInterviewFeedbackDto,
  UpdateJobOpeningDto,
  UpdateOfferDto,
} from "./recruit.dto";
import { CandidatesService } from "./candidates.service";
import { InterviewsService } from "./interviews.service";
import { JobOpeningsService } from "./job-openings.service";
import { OffersService } from "./offers.service";
import { RecruitConvertService } from "./recruit-convert.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S12-RECRUIT-BE-1 — 5 controller RECRUIT (RECRUIT-API-001..032). MỎNG — chỉ định tuyến.
 *
 * Cặp `@RequirePermission` đọc TỪ `RECRUIT_ROUTE_PAIRS` (KHÔNG literal — census 2 tầng so cả
 * decorator lẫn service với CÙNG bảng hằng, plan §5/§9.3). Tầng 2 assert lại trong service qua
 * `RecruitAccessService.resolveActor`.
 *
 * ⚠️ THỨ TỰ ROUTE CandidatesController: `check-duplicate` · `summary` · `export` khai TRƯỚC `:id`
 * (Nest nuốt segment tĩnh thành `:id` — bài học `goals/tree`).
 */
@Controller("job-openings")
export class JobOpeningsController {
  constructor(private readonly jobs: JobOpeningsService) {}

  /** 001 — GET /job-openings. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.jobOpeningList.action, P.jobOpeningList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListJobOpeningsQueryDto) {
    return this.jobs.list(req.user, query);
  }

  /** 002 — POST /job-openings. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.jobOpeningCreate.action, P.jobOpeningCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateJobOpeningDto) {
    return this.jobs.create(req.user, dto);
  }

  /** 003 — GET /job-openings/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.jobOpeningDetail.action, P.jobOpeningDetail.resourceType)
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.jobs.get(req.user, id);
  }

  /** 004 — PATCH /job-openings/:id (`.strict()`; đổi recruiter ⇒ NOTI-016). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.jobOpeningUpdate.action, P.jobOpeningUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobOpeningDto,
  ) {
    return this.jobs.update(req.user, id, dto);
  }

  /** 005 — POST /job-openings/:id/change-status (FSM §13.2). */
  @Post(":id/change-status")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.jobOpeningChangeStatus.action, P.jobOpeningChangeStatus.resourceType)
  @UsePipes(ZodValidationPipe)
  changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeJobOpeningStatusDto,
  ) {
    return this.jobs.changeStatus(req.user, id, dto);
  }
}

@Controller("candidates")
export class CandidatesController {
  constructor(
    private readonly candidates: CandidatesService,
    private readonly convert: RecruitConvertService,
  ) {}

  /** 006 — GET /candidates (masking qua mapper — single exit). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateList.action, P.candidateList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListCandidatesQueryDto) {
    return this.candidates.list(req.user, query);
  }

  /** 008 — GET /candidates/check-duplicate. KHAI TRƯỚC ':id'. */
  @Get("check-duplicate")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateCheckDuplicate.action, P.candidateCheckDuplicate.resourceType)
  @UsePipes(ZodValidationPipe)
  checkDuplicate(@Req() req: AuthenticatedRequest, @Query() query: CheckDuplicateQueryDto) {
    return this.candidates.checkDuplicate(req.user, query);
  }

  /** 009 — GET /candidates/summary. KHAI TRƯỚC ':id'. */
  @Get("summary")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateSummary.action, P.candidateSummary.resourceType)
  @UsePipes(ZodValidationPipe)
  summary(@Req() req: AuthenticatedRequest, @Query() _query: CandidateSummaryQueryDto) {
    return this.candidates.summary(req.user);
  }

  /** 010 — GET /candidates/export (đòi CẢ export + view — tầng 2; trần 10k = 422 015). */
  @Get("export")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateExport.action, P.candidateExport.resourceType)
  @UsePipes(ZodValidationPipe)
  export(@Req() req: AuthenticatedRequest, @Query() query: ExportCandidatesQueryDto) {
    return this.candidates.export(req.user, query);
  }

  /** 007 — POST /candidates (@Idempotent — FE sinh key). */
  @Post()
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateCreate.action, P.candidateCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCandidateDto) {
    return this.candidates.create(req.user, dto);
  }

  /** 011 — GET /candidates/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateDetail.action, P.candidateDetail.resourceType)
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.candidates.get(req.user, id);
  }

  /** 012 — PATCH /candidates/:id (`.strict()` — KHÔNG stage/employeeId). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateUpdate.action, P.candidateUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.candidates.update(req.user, id, dto);
  }

  /** 013 — POST /candidates/:id/move-stage (FSM §13.1; →Hired tay = 014). */
  @Post(":id/move-stage")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateMoveStage.action, P.candidateMoveStage.resourceType)
  @UsePipes(ZodValidationPipe)
  moveStage(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MoveCandidateStageDto,
  ) {
    return this.candidates.moveStage(req.user, id, dto);
  }

  /** 014 — GET /candidates/:id/stage-events. */
  @Get(":id/stage-events")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateStageEvents.action, P.candidateStageEvents.resourceType)
  @UsePipes(ZodValidationPipe)
  stageEvents(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListCandidateSubQueryDto,
  ) {
    return this.candidates.listStageEvents(req.user, id, query);
  }

  /** 015 — GET /candidates/:id/notes. */
  @Get(":id/notes")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateNotesList.action, P.candidateNotesList.resourceType)
  @UsePipes(ZodValidationPipe)
  notes(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListCandidateSubQueryDto,
  ) {
    return this.candidates.listNotes(req.user, id, query);
  }

  /** 016 — POST /candidates/:id/notes. */
  @Post(":id/notes")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateNoteCreate.action, P.candidateNoteCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  createNote(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateCandidateNoteDto,
  ) {
    return this.candidates.createNote(req.user, id, dto);
  }

  /** 017 — PATCH /candidates/:id/notes/:noteId (CỦA MÌNH; khác ⇒ 404 chung). */
  @Patch(":id/notes/:noteId")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateNoteUpdate.action, P.candidateNoteUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  updateNote(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("noteId", ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateCandidateNoteDto,
  ) {
    return this.candidates.updateNote(req.user, id, noteId, dto);
  }

  /** 029 — POST /candidates/:id/convert (@Idempotent; 3 pha — plan §6.1). */
  @Post(":id/convert")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateConvert.action, P.candidateConvert.resourceType)
  convertCandidate(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.convert.convert(req.user, id);
  }
}

@Controller("interviews")
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  /** 018 — GET /interviews (Own = EXISTS participant). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewList.action, P.interviewList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListInterviewsQueryDto) {
    return this.interviews.list(req.user, query);
  }

  /** 019 — POST /interviews (@Idempotent; stage=Interview ⇒ 007). */
  @Post()
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewCreate.action, P.interviewCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateInterviewDto) {
    return this.interviews.create(req.user, dto);
  }

  /** 020 — GET /interviews/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewDetail.action, P.interviewDetail.resourceType)
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.interviews.get(req.user, id);
  }

  /** 021 — PATCH /interviews/:id (chỉ Scheduled). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewUpdate.action, P.interviewUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewDto,
  ) {
    return this.interviews.update(req.user, id, dto);
  }

  /** 022 — POST /interviews/:id/change-status (FSM §13.4). */
  @Post(":id/change-status")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewChangeStatus.action, P.interviewChangeStatus.resourceType)
  @UsePipes(ZodValidationPipe)
  changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeInterviewStatusDto,
  ) {
    return this.interviews.changeStatus(req.user, id, dto);
  }

  /** 023 — POST /interviews/:id/feedback (Own MỌI role; 010/011 theo view-scope — plan §4.3). */
  @Post(":id/feedback")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewFeedbackCreate.action, P.interviewFeedbackCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  createFeedback(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateInterviewFeedbackDto,
  ) {
    return this.interviews.createFeedback(req.user, id, dto);
  }

  /** 024 — PATCH /interviews/:id/feedback (CỦA MÌNH — không nhận id feedback). */
  @Patch(":id/feedback")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.interviewFeedbackUpdate.action, P.interviewFeedbackUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  updateFeedback(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewFeedbackDto,
  ) {
    return this.interviews.updateFeedback(req.user, id, dto);
  }
}

@Controller("offers")
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** 025 — GET /offers (`salary` chỉ khi manage:offer). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.offerList.action, P.offerList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListOffersQueryDto) {
    return this.offers.list(req.user, query);
  }

  /** 026 — POST /offers (@Idempotent; 1 offer sống ⇒ 006). */
  @Post()
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.offerCreate.action, P.offerCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateOfferDto) {
    return this.offers.create(req.user, dto);
  }

  /** 030 — GET /offers/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.offerDetail.action, P.offerDetail.resourceType)
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.offers.get(req.user, id);
  }

  /** 027 — PATCH /offers/:id (chỉ Draft ⇒ 003). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.offerUpdate.action, P.offerUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(req.user, id, dto);
  }

  /** 028 — POST /offers/:id/change-status (FSM §13.3; terminal ghi responded_at cùng câu). */
  @Post(":id/change-status")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.offerChangeStatus.action, P.offerChangeStatus.resourceType)
  @UsePipes(ZodValidationPipe)
  changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChangeOfferStatusDto,
  ) {
    return this.offers.changeStatus(req.user, id, dto);
  }
}

@Controller("recruit/pickers")
export class RecruitPickersController {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly jobs: JobOpeningsService,
  ) {}

  /** 031 — GET /recruit/pickers/employees (gate cặp GHI manage:interview — SPEC §15). */
  @Get("employees")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pickerEmployees.action, P.pickerEmployees.resourceType)
  @UsePipes(ZodValidationPipe)
  employees(@Req() req: AuthenticatedRequest, @Query() query: RecruitPickerQueryDto) {
    return this.interviews.employeePicker(req.user, query);
  }

  /** 032 — GET /recruit/pickers/recruiter-users (gate update:job-opening). */
  @Get("recruiter-users")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pickerRecruiterUsers.action, P.pickerRecruiterUsers.resourceType)
  @UsePipes(ZodValidationPipe)
  recruiterUsers(@Req() req: AuthenticatedRequest, @Query() query: RecruitPickerQueryDto) {
    return this.jobs.recruiterUserPicker(req.user, query);
  }
}
