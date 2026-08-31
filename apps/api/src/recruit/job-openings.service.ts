import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type {
  ChangeJobOpeningStatusInput,
  CreateJobOpeningInput,
  ListJobOpeningsQuery,
  RecruitPickerQuery,
  UpdateJobOpeningInput,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { orgUnits } from "../db/schema/org";
import { positions } from "../db/schema/positions";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { paginated, toPagination } from "../common/pagination";
import { assertJobOpeningTransition } from "./recruit-fsm";
import { RecruitAccessService } from "./recruit-access.service";
import { RecruitPeopleRepository } from "./recruit-people.repository";
import { JobOpeningsRepository } from "./job-openings.repository";
import { toJobOpeningDto } from "./recruit.mapper";
import {
  recruitNotFound,
  recruitPeopleRefNotFound,
  recruitUnprocessable,
  RECRUIT_ERR,
  recruitDetails,
} from "./recruit.errors";
import { RECRUIT_EVENT_JOB_ASSIGNED, type RecruitJobAssignedPayload } from "./recruit-noti.payload";
import type { RecruitRequestUser } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — nghiệp vụ vị trí tuyển (RECRUIT-API-001..005) + picker 032. Guard tầng 2 qua
 * `access.resolveActor` (đầu mỗi method — plan §5); FSM §13.2 ở `recruit-fsm`; audit `job_opening`;
 * NOTI-016 khi đổi recruiter (dedupe content-derived theo RETURNING updated_at — plan §8).
 */
@Injectable()
export class JobOpeningsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly repo: JobOpeningsRepository,
    private readonly people: RecruitPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(user: RecruitRequestUser, query: ListJobOpeningsQuery) {
    const actor = await this.access.resolveActor(user, "jobOpeningList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, query);
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        rows.map((r) => r.recruiterUserId).filter((x): x is string => Boolean(x)),
      );
      return paginated(
        rows.map((r) => toJobOpeningDto(r, people)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  async get(user: RecruitRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "jobOpeningDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw recruitNotFound();
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        row.recruiterUserId ? [row.recruiterUserId] : [],
      );
      return toJobOpeningDto(row, people);
    });
  }

  async create(user: RecruitRequestUser, dto: CreateJobOpeningInput) {
    const actor = await this.access.resolveActor(user, "jobOpeningCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.assertOrgRefs(tx, user.companyId, dto.orgUnitId, dto.positionId ?? null);
      if (dto.recruiterUserId) await this.assertRecruiter(tx, user.companyId, dto.recruiterUserId);
      const row = await this.repo.createTx(tx, user.companyId, {
        title: dto.title,
        description: dto.description ?? null,
        orgUnitId: dto.orgUnitId,
        positionId: dto.positionId ?? null,
        headcount: dto.headcount,
        recruiterUserId: dto.recruiterUserId ?? null,
        createdBy: user.id,
      });
      await this.audit.record(tx, {
        action: "create",
        objectType: "job_opening",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { title: row.title, orgUnitId: row.orgUnitId, status: row.status },
      });
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        row.recruiterUserId ? [row.recruiterUserId] : [],
      );
      return toJobOpeningDto(row, people);
    });
  }

  async update(user: RecruitRequestUser, id: string, dto: UpdateJobOpeningInput) {
    const actor = await this.access.resolveActor(user, "jobOpeningUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      if (dto.positionId) {
        await this.assertOrgRefs(tx, user.companyId, before.orgUnitId, dto.positionId);
      }
      const recruiterChanged =
        dto.recruiterUserId !== undefined && dto.recruiterUserId !== before.recruiterUserId;
      if (recruiterChanged && dto.recruiterUserId) {
        await this.assertRecruiter(tx, user.companyId, dto.recruiterUserId);
      }
      const row = await this.repo.updateTx(
        tx,
        user.companyId,
        id,
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.positionId !== undefined ? { positionId: dto.positionId ?? null } : {}),
          ...(dto.headcount !== undefined ? { headcount: dto.headcount } : {}),
          ...(dto.recruiterUserId !== undefined
            ? { recruiterUserId: dto.recruiterUserId ?? null }
            : {}),
        },
        user.id,
      );
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "job_opening",
        objectId: row.id,
        actorUserId: user.id,
        before: { recruiterUserId: before.recruiterUserId, headcount: before.headcount },
        after: { recruiterUserId: row.recruiterUserId, headcount: row.headcount },
      });
      // NOTI-016 — CHỈ khi recruiter ĐỔI sang một user khác actor (engine vẫn loại actor lần nữa).
      if (recruiterChanged && row.recruiterUserId && row.recruiterUserId !== user.id) {
        const payload: RecruitJobAssignedPayload = {
          jobOpeningId: row.id,
          newRecruiterUserId: row.recruiterUserId,
          assignedAtIso: row.updatedAt.toISOString(),
          actorUserId: user.id,
          job_title: row.title,
        };
        await this.outbox.enqueue(tx, { eventType: RECRUIT_EVENT_JOB_ASSIGNED, payload });
      }
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        row.recruiterUserId ? [row.recruiterUserId] : [],
      );
      return toJobOpeningDto(row, people);
    });
  }

  async changeStatus(user: RecruitRequestUser, id: string, dto: ChangeJobOpeningStatusInput) {
    const actor = await this.access.resolveActor(user, "jobOpeningChangeStatus");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      assertJobOpeningTransition(before.status, dto.toStatus);
      const row = await this.repo.setStatusTx(tx, user.companyId, id, dto.toStatus, user.id);
      if (!row) throw recruitNotFound();
      await this.audit.record(tx, {
        action: "change-status",
        objectType: "job_opening",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status },
        after: { status: row.status, reason: dto.reason ?? null },
      });
      const people = await this.people.namesByUserIdsTx(
        tx,
        actor,
        row.recruiterUserId ? [row.recruiterUserId] : [],
      );
      return toJobOpeningDto(row, people);
    });
  }

  /** Picker 032 — user sống trong company (gate `('update','job-opening')`). */
  async recruiterUserPicker(user: RecruitRequestUser, query: RecruitPickerQuery) {
    const actor = await this.access.resolveActor(user, "pickerRecruiterUsers");
    return this.db.withTenant(user.companyId, (tx) =>
      this.people.recruiterUserPickerTx(tx, actor, query.q, query.limit),
    );
  }

  /** orgUnit PHẢI active-sống trong tenant; position (nếu gửi) tương tự — sai ⇒ 404 `009` chung. */
  private async assertOrgRefs(
    tx: TenantTx,
    companyId: string,
    orgUnitId: string,
    positionId: string | null,
  ): Promise<void> {
    const [ou] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, orgUnitId),
          eq(orgUnits.companyId, companyId),
          isNull(orgUnits.deletedAt),
          eq(orgUnits.status, "active"),
        ),
      )
      .limit(1);
    if (!ou) {
      throw recruitUnprocessable(
        "PEOPLE_REF_INVALID",
        RECRUIT_ERR.PEOPLE_REF_INVALID("đơn vị không tồn tại hoặc không hoạt động"),
        recruitDetails("org-unit-invalid"),
      );
    }
    if (positionId) {
      const [pos] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(
          and(
            eq(positions.id, positionId),
            eq(positions.companyId, companyId),
            isNull(positions.deletedAt),
            eq(positions.status, "active"),
          ),
        )
        .limit(1);
      if (!pos) {
        throw recruitUnprocessable(
          "PEOPLE_REF_INVALID",
          RECRUIT_ERR.PEOPLE_REF_INVALID("vị trí chức danh không tồn tại hoặc không hoạt động"),
          recruitDetails("position-invalid"),
        );
      }
    }
  }

  /** recruiterUserId phải là user SỐNG trong company — sai ⇒ **404** mã `009` (SPEC-12 §12). */
  private async assertRecruiter(tx: TenantTx, companyId: string, userId: string): Promise<void> {
    if (!(await this.people.isLiveUserTx(tx, companyId, userId))) {
      throw recruitPeopleRefNotFound(
        RECRUIT_ERR.PEOPLE_REF_INVALID(
          "người phụ trách không phải user đang hoạt động trong công ty",
        ),
        recruitDetails("recruiter-invalid"),
      );
    }
  }
}
