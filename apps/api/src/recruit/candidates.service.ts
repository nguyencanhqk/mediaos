import { Injectable } from "@nestjs/common";
import {
  RECRUIT_EXPORT_MAX_ROWS,
  type CheckDuplicateQuery,
  type CreateCandidateInput,
  type CreateCandidateNoteInput,
  type ExportCandidatesQuery,
  type ListCandidateSubQuery,
  type ListCandidatesQuery,
  type MoveCandidateStageInput,
  type UpdateCandidateInput,
  type UpdateCandidateNoteInput,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { Candidate } from "../db/schema/recruit";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { paginated, toPagination } from "../common/pagination";
import { assertStageTransition } from "./recruit-fsm";
import { RecruitAccessService } from "./recruit-access.service";
import { CandidatesRepository } from "./candidates.repository";
import {
  mapRecruitPgError,
  recruitConflict,
  recruitDetails,
  recruitNotFound,
  recruitUnprocessable,
  RECRUIT_ERR,
} from "./recruit.errors";
import { toCandidateDetail, toCandidateListItem } from "./recruit.mapper";
import {
  RECRUIT_ACTOR_FALLBACK,
  RECRUIT_EVENT_STAGE_CHANGED,
  type RecruitStageChangedPayload,
} from "./recruit-noti.payload";
import { RecruitPeopleRepository } from "./recruit-people.repository";
import type { RecruitRequestUser } from "./recruit.types";

/** Ngưỡng export — test-only override qua env (RECRUIT-ERR-015 phải có ca THẬT, plan §2.2). */
export function recruitExportMaxRows(): number {
  const raw = process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return RECRUIT_EXPORT_MAX_ROWS;
}

/**
 * S12-RECRUIT-BE-1 — nghiệp vụ ứng viên (RECRUIT-API-006..017). Guard tầng 2 + cờ masking qua
 * `access.resolveActor` (7 cặp `candidate` sensitive — isSensitive:true trong access service);
 * masking DUY NHẤT qua `recruit.mapper` (single exit — plan §4.4); FSM §13.1; audit `candidate`;
 * NOTI-018 khi move tay.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly repo: CandidatesRepository,
    private readonly people: RecruitPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(user: RecruitRequestUser, query: ListCandidatesQuery) {
    const actor = await this.access.resolveActor(user, "candidateList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, query);
      return paginated(
        rows.map((r) => toCandidateListItem(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  async get(user: RecruitRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "candidateDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw recruitNotFound();
      return toCandidateDetail(row, actor);
    });
  }

  /** 008 — KHÔNG BAO GIỜ trả email/phone của hồ sơ khớp, bất kể quyền caller (plan §4.4). */
  async checkDuplicate(user: RecruitRequestUser, query: CheckDuplicateQuery) {
    await this.access.resolveActor(user, "candidateCheckDuplicate");
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.findDuplicatesTx(tx, user.companyId, query.email, query.phone).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          fullName: r.fullName,
          stage: r.stage,
          jobOpeningTitle: r.jobTitle,
          deleted: r.deleted,
        })),
      ),
    );
  }

  async summary(user: RecruitRequestUser) {
    await this.access.resolveActor(user, "candidateSummary");
    return this.db.withTenant(user.companyId, (tx) => this.repo.summaryTx(tx, user.companyId));
  }

  /**
   * 010 — đòi CẢ HAI cặp: decorator gate `('export','candidate')`, tầng 2 assert thêm
   * `('view','candidate')` (SPEC-12 §18 — export không được rộng hơn quyền đọc). COUNT(*) TRƯỚC
   * stream; vượt trần ⇒ 422 `015`. Audit payload = filter + số dòng, KHÔNG dữ liệu.
   */
  async export(user: RecruitRequestUser, query: ExportCandidatesQuery) {
    const actor = await this.access.resolveActor(user, "candidateExport");
    // Cặp THỨ HAI của route 010 — thiếu view ⇒ 403 (không phải wildcard nào cứu được: sensitive).
    await this.access.resolveActor(user, "candidateList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const total = await this.repo.countByFilterTx(tx, user.companyId, query);
      const max = recruitExportMaxRows();
      if (total > max) {
        throw recruitUnprocessable(
          "EXPORT_LIMIT",
          RECRUIT_ERR.EXPORT_LIMIT(total, max),
          recruitDetails("export-too-large", { total, max }),
        );
      }
      const rows = await this.repo.listAllByFilterTx(tx, user.companyId, query);
      await this.audit.record(tx, {
        action: "export",
        objectType: "candidate",
        actorUserId: user.id,
        before: null,
        after: { filter: query, rows: total },
      });
      return rows.map((r) => toCandidateListItem(r, actor));
    });
  }

  async create(user: RecruitRequestUser, dto: CreateCandidateInput) {
    const actor = await this.access.resolveActor(user, "candidateCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertJobOpen(tx, user.companyId, dto.jobOpeningId);
      const row = await this.repo.createTx(tx, user.companyId, {
        jobOpeningId: dto.jobOpeningId,
        fullName: dto.fullName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        source: dto.source ?? null,
        note: dto.note ?? null,
        createdBy: user.id,
      });
      await this.audit.record(tx, {
        action: "create",
        objectType: "candidate",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG email/phone trong audit (BẤT BIẾN #3 / plan §9.1 audit).
        after: { fullName: row.fullName, jobOpeningId: row.jobOpeningId, stage: row.stage },
      });
      return toCandidateDetail(row, actor);
    });
  }

  async update(user: RecruitRequestUser, id: string, dto: UpdateCandidateInput) {
    const actor = await this.access.resolveActor(user, "candidateUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      if (dto.jobOpeningId && dto.jobOpeningId !== before.jobOpeningId) {
        await this.assertJobOpen(tx, user.companyId, dto.jobOpeningId);
      }
      const patch: Partial<
        Pick<Candidate, "jobOpeningId" | "fullName" | "email" | "phone" | "source" | "note">
      > = {};
      if (dto.jobOpeningId !== undefined) patch.jobOpeningId = dto.jobOpeningId;
      if (dto.fullName !== undefined) patch.fullName = dto.fullName;
      if (dto.email !== undefined) patch.email = dto.email ?? null;
      if (dto.phone !== undefined) patch.phone = dto.phone ?? null;
      if (dto.source !== undefined) patch.source = dto.source ?? null;
      if (dto.note !== undefined) patch.note = dto.note ?? null;
      const row = await this.repo.updateTx(tx, user.companyId, id, patch, user.id);
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "candidate",
        objectId: row.id,
        actorUserId: user.id,
        before: { fullName: before.fullName, jobOpeningId: before.jobOpeningId },
        after: { fullName: row.fullName, jobOpeningId: row.jobOpeningId },
      });
      return toCandidateDetail(row, actor);
    });
  }

  /** 013 — FSM §13.1; `→Hired` tay = 014 (mã sống — Zod giữ đủ 6 giá trị). NOTI-018 khi thành công. */
  async moveStage(user: RecruitRequestUser, id: string, dto: MoveCandidateStageInput) {
    const actor = await this.access.resolveActor(user, "candidateMoveStage");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      assertStageTransition(before.stage, dto.toStage, "move");
      let moved;
      try {
        moved = await this.repo.moveStageTx(
          tx,
          user.companyId,
          id,
          before.stage,
          dto.toStage,
          "move",
          dto.reason,
          user.id,
        );
      } catch (err) {
        throw mapRecruitPgError(err) ?? err;
      }
      // 0 hàng = race (stage đã đổi giữa SELECT và UPDATE) — trả 001 theo trạng thái MỚI nhất.
      if (!moved) {
        throw recruitConflict(
          "STAGE_TRANSITION",
          RECRUIT_ERR.STAGE_TRANSITION(before.stage, dto.toStage),
          recruitDetails("invalid-stage-transition", { from: before.stage, to: dto.toStage }),
        );
      }
      await this.audit.record(tx, {
        action: "move-stage",
        objectType: "candidate",
        objectId: id,
        actorUserId: user.id,
        before: { stage: before.stage },
        after: { stage: moved.candidate.stage, reason: dto.reason },
      });
      const job = await this.repo.jobStatusTx(tx, user.companyId, moved.candidate.jobOpeningId);
      const actorRef = (await this.people.namesByUserIdsTx(tx, actor, [user.id])).get(user.id);
      const payload: RecruitStageChangedPayload = {
        stageEventId: moved.stageEvent.id,
        candidateId: id,
        jobOpeningId: moved.candidate.jobOpeningId,
        actorUserId: user.id,
        actor_name: actorRef?.displayName ?? RECRUIT_ACTOR_FALLBACK,
        candidate_name: moved.candidate.fullName,
        job_title: job?.title ?? "",
        from_stage: before.stage,
        to_stage: moved.candidate.stage,
        candidate_id: id,
      };
      await this.outbox.enqueue(tx, { eventType: RECRUIT_EVENT_STAGE_CHANGED, payload });
      return toCandidateDetail(moved.candidate, actor);
    });
  }

  async listStageEvents(user: RecruitRequestUser, id: string, query: ListCandidateSubQuery) {
    await this.access.resolveActor(user, "candidateStageEvents");
    return this.db.withTenant(user.companyId, async (tx) => {
      const cand = await this.repo.findTx(tx, user.companyId, id);
      if (!cand) throw recruitNotFound();
      const { rows, total } = await this.repo.listStageEventsTx(
        tx,
        user.companyId,
        id,
        query.page,
        query.per_page,
      );
      return paginated(
        rows.map((r) => ({
          id: r.id,
          fromStage: r.fromStage,
          toStage: r.toStage,
          action: r.action,
          reason: r.reason,
          actedBy: r.actedBy ?? null,
          actedAt: r.actedAt.toISOString(),
        })),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  async listNotes(user: RecruitRequestUser, id: string, query: ListCandidateSubQuery) {
    await this.access.resolveActor(user, "candidateNotesList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const cand = await this.repo.findTx(tx, user.companyId, id);
      if (!cand) throw recruitNotFound();
      const { rows, total } = await this.repo.listNotesTx(
        tx,
        user.companyId,
        id,
        query.page,
        query.per_page,
      );
      return paginated(
        rows.map((r) => ({
          id: r.id,
          body: r.body,
          createdBy: r.createdBy ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  async createNote(user: RecruitRequestUser, id: string, dto: CreateCandidateNoteInput) {
    await this.access.resolveActor(user, "candidateNoteCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const cand = await this.repo.findTx(tx, user.companyId, id);
      if (!cand) throw recruitNotFound();
      const row = await this.repo.createNoteTx(tx, user.companyId, id, dto.body, user.id);
      // Gói vào aggregate cha `candidate`, payload kèm noteId (audit CHECK không có type riêng).
      await this.audit.record(tx, {
        action: "comment",
        objectType: "candidate",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { noteId: row.id },
      });
      return {
        id: row.id,
        body: row.body,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** 017 — chỉ ghi chú CỦA MÌNH; của người khác/không tồn tại ⇒ CÙNG 404 `010` (không lộ oracle). */
  async updateNote(
    user: RecruitRequestUser,
    id: string,
    noteId: string,
    dto: UpdateCandidateNoteInput,
  ) {
    await this.access.resolveActor(user, "candidateNoteUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const cand = await this.repo.findTx(tx, user.companyId, id);
      if (!cand) throw recruitNotFound();
      const row = await this.repo.updateOwnNoteTx(tx, user.companyId, id, noteId, user.id, {
        body: dto.body,
        softDelete: dto.delete === true,
      });
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: dto.delete ? "delete-comment" : "update-comment",
        objectType: "candidate",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { noteId: row.id, deleted: dto.delete === true },
      });
      return dto.delete === true
        ? { id: row.id, deleted: true }
        : {
            id: row.id,
            body: row.body,
            createdBy: row.createdBy ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
    });
  }

  /** Job phải tồn tại-sống và KHÔNG Closed — 404 `010` khi thiếu, 409 `005` khi Closed. */
  private async assertJobOpen(
    tx: TenantTx,
    companyId: string,
    jobOpeningId: string,
  ): Promise<void> {
    const job = await this.repo.jobStatusTx(tx, companyId, jobOpeningId);
    if (!job) throw recruitNotFound();
    if (job.status === "Closed") {
      throw recruitConflict("JOB_CLOSED", RECRUIT_ERR.JOB_CLOSED, recruitDetails("job-closed"));
    }
  }
}
