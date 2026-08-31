import { Injectable } from "@nestjs/common";
import type {
  ChangeInterviewStatusInput,
  CreateInterviewFeedbackInput,
  CreateInterviewInput,
  ListInterviewsQuery,
  RecruitPickerQuery,
  UpdateInterviewFeedbackInput,
  UpdateInterviewInput,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { Interview } from "../db/schema/recruit";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { paginated, toPagination } from "../common/pagination";
import { assertInterviewTransition } from "./recruit-fsm";
import { RecruitAccessService } from "./recruit-access.service";
import { InterviewsRepository } from "./interviews.repository";
import { RecruitPeopleRepository } from "./recruit-people.repository";
import { CandidatesRepository } from "./candidates.repository";
import {
  mapRecruitPgError,
  recruitConflict,
  recruitDetails,
  recruitForbidden,
  recruitNotFound,
  recruitPeopleRefNotFound,
  recruitUnprocessable,
  RECRUIT_ERR,
} from "./recruit.errors";
import { toFeedbackDto, toInterviewDto } from "./recruit.mapper";
import {
  formatInterviewTimeRange,
  RECRUIT_ACTOR_FALLBACK,
  RECRUIT_EVENT_INTERVIEW_SCHEDULED,
  type RecruitInterviewScheduledPayload,
} from "./recruit-noti.payload";
import type { RecruitActor, RecruitRequestUser } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — nghiệp vụ phỏng vấn + feedback (RECRUIT-API-018..024) + picker 031.
 *
 * Own-scope theo NGƯỜI THAM GIA (`interview_participants` — người ĐƯỢC XẾP, không phải người tạo).
 * Feedback: tầm nhìn lượt resolve từ `('view','interview')` TRƯỚC (plan §4.3 — quyết định 010 vs
 * 011): không thấy lượt ⇒ 404 `010`; thấy ở Company mà không phải participant ⇒ 403 `011`.
 */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly repo: InterviewsRepository,
    private readonly people: RecruitPeopleRepository,
    private readonly candidates: CandidatesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(user: RecruitRequestUser, query: ListInterviewsQuery) {
    const actor = await this.access.resolveActor(user, "interviewList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const ownFilter = await this.ownFilterFor(tx, actor);
      const { rows, total } = await this.repo.listTx(tx, user.companyId, query, ownFilter);
      const dtos = await this.toDtos(tx, actor, rows);
      return paginated(dtos, toPagination(total, query.page, query.per_page));
    });
  }

  async get(user: RecruitRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "interviewDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const ownFilter = await this.ownFilterFor(tx, actor);
      const row = await this.repo.findScopedTx(tx, user.companyId, id, ownFilter);
      if (!row) throw recruitNotFound();
      const [dto] = await this.toDtos(tx, actor, [row]);
      const feedbacks = await this.repo.feedbacksByInterviewTx(tx, user.companyId, id);
      return { ...dto, feedbacks: feedbacks.map(toFeedbackDto) };
    });
  }

  /** 019 — stage phải `Interview` (409 `007`); giờ hợp lệ (422 `013`); interviewer sống (422/404 `009`). */
  async create(user: RecruitRequestUser, dto: CreateInterviewInput) {
    const actor = await this.access.resolveActor(user, "interviewCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const candidate = await this.candidates.findTx(tx, user.companyId, dto.candidateId);
      if (!candidate) throw recruitNotFound();
      if (candidate.stage !== "Interview") {
        throw recruitConflict(
          "STAGE_PRECONDITION",
          RECRUIT_ERR.NOT_IN_INTERVIEW_STAGE,
          recruitDetails("not-in-interview-stage", { stage: candidate.stage }),
        );
      }
      const startsAt = new Date(dto.startsAt);
      const endsAt = new Date(dto.endsAt);
      if (endsAt.getTime() <= startsAt.getTime()) {
        throw recruitUnprocessable(
          "INVALID_VALUE",
          RECRUIT_ERR.INVALID_TIME_RANGE,
          recruitDetails("invalid-time-range"),
        );
      }
      const ids = [...new Set(dto.participantEmployeeIds)];
      const statuses = await this.people.employeeStatusesTx(tx, user.companyId, ids);
      for (const employeeId of ids) {
        const status = statuses.get(employeeId);
        if (status === undefined) {
          // không tồn tại/khác tenant/xoá mềm — 404 mã 009 kind employee-not-found (SPEC-12 §12).
          throw recruitPeopleRefNotFound(
            RECRUIT_ERR.PEOPLE_REF_INVALID("không tìm thấy nhân viên trong công ty"),
            recruitDetails("employee-not-found"),
          );
        }
        if (status !== "active") {
          throw recruitUnprocessable(
            "PEOPLE_REF_INVALID",
            RECRUIT_ERR.PEOPLE_REF_INVALID("interviewer không còn làm việc"),
            recruitDetails("employee-inactive", { employeeId }),
          );
        }
      }
      let row: Interview;
      try {
        row = await this.repo.createTx(tx, user.companyId, {
          candidateId: dto.candidateId,
          round: dto.round,
          startsAt,
          endsAt,
          location: dto.location ?? null,
          note: dto.note ?? null,
          createdBy: user.id,
          participantEmployeeIds: ids,
        });
      } catch (err) {
        throw mapRecruitPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "interview",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { candidateId: row.candidateId, round: row.round, startsAt: dto.startsAt },
      });
      const job = await this.candidates.jobStatusTx(tx, user.companyId, candidate.jobOpeningId);
      const actorRef = (await this.people.namesByUserIdsTx(tx, actor, [user.id])).get(user.id);
      const payload: RecruitInterviewScheduledPayload = {
        interviewId: row.id,
        candidateId: row.candidateId,
        actorUserId: user.id,
        actor_name: actorRef?.displayName ?? RECRUIT_ACTOR_FALLBACK,
        candidate_name: candidate.fullName,
        round: row.round,
        job_title: job?.title ?? "",
        time_range: formatInterviewTimeRange(row.startsAt, row.endsAt),
        candidate_id: row.candidateId,
      };
      await this.outbox.enqueue(tx, { eventType: RECRUIT_EVENT_INTERVIEW_SCHEDULED, payload });
      const [out] = await this.toDtos(tx, actor, [row]);
      return out;
    });
  }

  /** 021 — chỉ khi `Scheduled` (409 `004`); ownFilter KHÔNG áp cho route ghi (gate = manage). */
  async update(user: RecruitRequestUser, id: string, dto: UpdateInterviewInput) {
    const actor = await this.access.resolveActor(user, "interviewUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findScopedTx(tx, user.companyId, id, null);
      if (!before) throw recruitNotFound();
      if (before.status !== "Scheduled") {
        throw recruitConflict(
          "INTERVIEW_TRANSITION",
          RECRUIT_ERR.INTERVIEW_NOT_SCHEDULED,
          recruitDetails("not-scheduled", { status: before.status }),
        );
      }
      const startsAt = dto.startsAt ? new Date(dto.startsAt) : before.startsAt;
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : before.endsAt;
      if (endsAt.getTime() <= startsAt.getTime()) {
        throw recruitUnprocessable(
          "INVALID_VALUE",
          RECRUIT_ERR.INVALID_TIME_RANGE,
          recruitDetails("invalid-time-range"),
        );
      }
      let row: Interview | null;
      try {
        row = await this.repo.updateTx(
          tx,
          user.companyId,
          id,
          {
            ...(dto.round !== undefined ? { round: dto.round } : {}),
            ...(dto.startsAt !== undefined ? { startsAt } : {}),
            ...(dto.endsAt !== undefined ? { endsAt } : {}),
            ...(dto.location !== undefined ? { location: dto.location ?? null } : {}),
            ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
          },
          user.id,
        );
      } catch (err) {
        throw mapRecruitPgError(err) ?? err;
      }
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "interview",
        objectId: row.id,
        actorUserId: user.id,
        before: { startsAt: before.startsAt.toISOString() },
        after: { startsAt: row.startsAt.toISOString() },
      });
      const [out] = await this.toDtos(tx, actor, [row]);
      return out;
    });
  }

  /** 022 — FSM §13.4. */
  async changeStatus(user: RecruitRequestUser, id: string, dto: ChangeInterviewStatusInput) {
    const actor = await this.access.resolveActor(user, "interviewChangeStatus");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findScopedTx(tx, user.companyId, id, null);
      if (!before) throw recruitNotFound();
      assertInterviewTransition(before.status, dto.toStatus);
      const row = await this.repo.setStatusTx(tx, user.companyId, id, dto.toStatus, user.id);
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "change-status",
        objectType: "interview",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status },
        after: { status: row.status, note: dto.note ?? null },
      });
      const [out] = await this.toDtos(tx, actor, [row]);
      return out;
    });
  }

  /**
   * 023 — Own cho MỌI role. Thứ tự (plan §4.3): (1) `view:interview` quyết định THẤY lượt hay không
   * (null/ngoài-Own ⇒ 404 `010`); (2) thấy mà không phải participant ⇒ 403 `011`; (3) lượt Cancelled
   * ⇒ 409 `004`; (4) trùng ⇒ 409 `012` (UNIQUE là chốt cuối).
   */
  async createFeedback(user: RecruitRequestUser, id: string, dto: CreateInterviewFeedbackInput) {
    const actor = await this.access.resolveActor(user, "interviewFeedbackCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { interview, callerEmployeeId } = await this.resolveFeedbackTarget(tx, actor, id);
      if (interview.status === "Cancelled") {
        throw recruitConflict(
          "INTERVIEW_TRANSITION",
          RECRUIT_ERR.INTERVIEW_TRANSITION(interview.status, "Completed"),
          recruitDetails("interview-cancelled"),
        );
      }
      let row;
      try {
        row = await this.repo.createFeedbackTx(tx, user.companyId, id, callerEmployeeId, {
          rating: dto.rating,
          comment: dto.comment ?? null,
          recommendation: dto.recommendation,
        });
      } catch (err) {
        throw mapRecruitPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "feedback",
        objectType: "interview",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { feedbackId: row.id, recommendation: row.recommendation },
      });
      return toFeedbackDto(row);
    });
  }

  /** 024 — sửa feedback CỦA MÌNH; chưa có/ngoài scope ⇒ 404 `010`. */
  async updateFeedback(user: RecruitRequestUser, id: string, dto: UpdateInterviewFeedbackInput) {
    const actor = await this.access.resolveActor(user, "interviewFeedbackUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { callerEmployeeId } = await this.resolveFeedbackTarget(tx, actor, id);
      const row = await this.repo.updateOwnFeedbackTx(tx, user.companyId, id, callerEmployeeId, {
        rating: dto.rating,
        comment: dto.comment === undefined ? undefined : (dto.comment ?? null),
        recommendation: dto.recommendation,
      });
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "update-feedback",
        objectType: "interview",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { feedbackId: row.id, recommendation: row.recommendation },
      });
      return toFeedbackDto(row);
    });
  }

  /** Picker 031 — nhân viên active (gate `('manage','interview')`). */
  async employeePicker(user: RecruitRequestUser, query: RecruitPickerQuery) {
    const actor = await this.access.resolveActor(user, "pickerEmployees");
    return this.db.withTenant(user.companyId, (tx) =>
      this.people.activeEmployeePickerTx(tx, actor, query.q, query.limit),
    );
  }

  /**
   * Vế chung 023/024 (plan §4.3): resolve tầm nhìn lượt từ `('view','interview')`, rồi participant.
   * Trả interview + employee id SỐNG của caller; mọi nhánh "không thấy" ⇒ 404 `010`.
   */
  private async resolveFeedbackTarget(
    tx: TenantTx,
    actor: RecruitActor,
    interviewId: string,
  ): Promise<{ interview: Interview; callerEmployeeId: string }> {
    // `view:interview` quyết định 010 vs 011 — KHÔNG suy ngầm từ cặp feedback (plan §4.3).
    if (actor.interviewViewScope === null) throw recruitNotFound();
    const callerEmployeeId = await this.people.callerEmployeeIdTx(
      tx,
      actor.companyId,
      actor.actorUserId,
    );
    const isCompany = RecruitAccessService.isCompany(actor.interviewViewScope);
    const ownFilter = isCompany ? null : this.repo.ownCond(actor.companyId, callerEmployeeId);
    const interview = await this.repo.findScopedTx(tx, actor.companyId, interviewId, ownFilter);
    if (!interview) throw recruitNotFound();
    if (
      callerEmployeeId === null ||
      !(await this.repo.isParticipantTx(tx, actor.companyId, interviewId, callerEmployeeId))
    ) {
      if (isCompany) {
        throw recruitForbidden(
          "NOT_PARTICIPANT",
          RECRUIT_ERR.NOT_PARTICIPANT,
          recruitDetails("not-participant"),
        );
      }
      throw recruitNotFound();
    }
    return { interview, callerEmployeeId };
  }

  /** Own khi scope `('view','interview')` = Own; caller không hồ sơ ⇒ vị từ FALSE (rỗng, M3). */
  private async ownFilterFor(tx: TenantTx, actor: RecruitActor) {
    if (RecruitAccessService.isCompany(actor.interviewViewScope)) return null;
    const callerEmployeeId = await this.people.callerEmployeeIdTx(
      tx,
      actor.companyId,
      actor.actorUserId,
    );
    return this.repo.ownCond(actor.companyId, callerEmployeeId);
  }

  private async toDtos(tx: TenantTx, actor: RecruitActor, rows: Interview[]) {
    if (rows.length === 0) return [];
    const participantsByInterview = await this.repo.participantsTx(
      tx,
      actor.companyId,
      rows.map((r) => r.id),
    );
    const allEmployeeIds = [...participantsByInterview.values()].flat().map((p) => p.employeeId);
    const employeeToUser = await this.people.userIdsByEmployeeIdsTx(
      tx,
      actor.companyId,
      allEmployeeIds,
    );
    const people = await this.people.namesByUserIdsTx(
      tx,
      actor,
      [...employeeToUser.values()].filter((x): x is string => Boolean(x)),
    );
    const out = [];
    for (const row of rows) {
      const candidate = await this.repo.candidateEmbedTx(tx, actor.companyId, row.candidateId);
      const participants = (participantsByInterview.get(row.id) ?? []).map((p) => ({
        employeeId: p.employeeId,
        userId: employeeToUser.get(p.employeeId) ?? null,
      }));
      out.push(
        toInterviewDto(
          row,
          candidate ?? { id: row.candidateId, fullName: "", stage: "" },
          participants,
          people,
        ),
      );
    }
    return out;
  }
}
