import { Injectable } from "@nestjs/common";
import type {
  ChangeOfferStatusInput,
  CreateOfferInput,
  ListOffersQuery,
  UpdateOfferInput,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { paginated, toPagination } from "../common/pagination";
import { assertOfferTransition } from "./recruit-fsm";
import { RecruitAccessService } from "./recruit-access.service";
import { CandidatesRepository } from "./candidates.repository";
import { OffersRepository } from "./offers.repository";
import {
  mapRecruitPgError,
  recruitConflict,
  recruitDetails,
  recruitNotFound,
  recruitUnprocessable,
  RECRUIT_ERR,
} from "./recruit.errors";
import { toOfferDto } from "./recruit.mapper";
import type { RecruitRequestUser } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — nghiệp vụ offer (RECRUIT-API-025..028, 030). Masking `salary` qua mapper
 * (`actor.canSeeSalary` — `('manage','offer')` non-sensitive, REC-DEC-004). FSM §13.3; audit `offer`
 * (payload KHÔNG salary — BẤT BIẾN #3); 1 offer sống/ứng viên (UNIQUE partial + map 006).
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly repo: OffersRepository,
    private readonly candidates: CandidatesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(user: RecruitRequestUser, query: ListOffersQuery) {
    const actor = await this.access.resolveActor(user, "offerList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, query);
      return paginated(
        rows.map((r) => toOfferDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  async get(user: RecruitRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "offerDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw recruitNotFound();
      return toOfferDto(row, actor);
    });
  }

  /** 026 — stage=`Offer` (409 `007`); startDate không quá khứ (422 `013`); 1 offer sống (409 `006`). */
  async create(user: RecruitRequestUser, dto: CreateOfferInput) {
    const actor = await this.access.resolveActor(user, "offerCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const candidate = await this.candidates.findTx(tx, user.companyId, dto.candidateId);
      if (!candidate) throw recruitNotFound();
      if (candidate.stage !== "Offer") {
        throw recruitConflict(
          "STAGE_PRECONDITION",
          RECRUIT_ERR.NOT_IN_OFFER_STAGE,
          recruitDetails("not-in-offer-stage", { stage: candidate.stage }),
        );
      }
      this.assertStartDateNotPast(dto.startDate);
      let row;
      try {
        row = await this.repo.createTx(tx, user.companyId, {
          candidateId: dto.candidateId,
          title: dto.title ?? null,
          startDate: dto.startDate,
          salary: dto.salary,
          note: dto.note ?? null,
          createdBy: user.id,
        });
      } catch (err) {
        // Race 2 offer song song — UNIQUE partial là chốt cuối (KHÔNG SELECT-rồi-INSERT).
        throw mapRecruitPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "offer",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        // KHÔNG salary trong audit (BẤT BIẾN #3).
        after: { candidateId: row.candidateId, startDate: row.startDate, status: row.status },
      });
      return toOfferDto(row, actor);
    });
  }

  /** 027 — chỉ khi `Draft` (409 `003` kind=not-draft). */
  async update(user: RecruitRequestUser, id: string, dto: UpdateOfferInput) {
    const actor = await this.access.resolveActor(user, "offerUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      if (before.status !== "Draft") {
        throw recruitConflict(
          "OFFER_TRANSITION",
          RECRUIT_ERR.OFFER_NOT_DRAFT,
          recruitDetails("not-draft", { status: before.status }),
        );
      }
      if (dto.startDate !== undefined) this.assertStartDateNotPast(dto.startDate);
      const row = await this.repo.updateDraftTx(
        tx,
        user.companyId,
        id,
        {
          ...(dto.title !== undefined ? { title: dto.title ?? null } : {}),
          ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
          ...(dto.salary !== undefined ? { salary: dto.salary } : {}),
          ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
        },
        user.id,
      );
      // 0 hàng = race đổi trạng thái giữa SELECT và UPDATE ⇒ cùng 003 not-draft.
      if (!row) {
        throw recruitConflict(
          "OFFER_TRANSITION",
          RECRUIT_ERR.OFFER_NOT_DRAFT,
          recruitDetails("not-draft"),
        );
      }
      await this.audit.record(tx, {
        action: "update",
        objectType: "offer",
        objectId: row.id,
        actorUserId: user.id,
        before: { startDate: before.startDate },
        after: { startDate: row.startDate },
      });
      return toOfferDto(row, actor);
    });
  }

  /** 028 — FSM §13.3; terminal ghi `responded_at` CÙNG câu UPDATE. */
  async changeStatus(user: RecruitRequestUser, id: string, dto: ChangeOfferStatusInput) {
    const actor = await this.access.resolveActor(user, "offerChangeStatus");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id);
      if (!before) throw recruitNotFound();
      assertOfferTransition(before.status, dto.toStatus);
      const row = await this.repo.setStatusTx(
        tx,
        user.companyId,
        id,
        before.status,
        dto.toStatus,
        user.id,
      );
      // 0 hàng = race — FSM lại theo trạng thái hiện tại sẽ ném đúng mã; ở đây trả 003 chung.
      if (!row) {
        throw recruitConflict(
          "OFFER_TRANSITION",
          RECRUIT_ERR.OFFER_TRANSITION(before.status, dto.toStatus),
          recruitDetails("invalid-offer-transition", { from: before.status, to: dto.toStatus }),
        );
      }
      await this.audit.record(tx, {
        action: "change-status",
        objectType: "offer",
        objectId: row.id,
        actorUserId: user.id,
        before: { status: before.status },
        after: { status: row.status, note: dto.note ?? null },
      });
      return toOfferDto(row, actor);
    });
  }

  /**
   * `startDate` ở quá khứ ⇒ 422 `013` kind=invalid-start-date — so theo NGÀY của múi giờ hệ thống
   * (FULL gate security L2: so UTC làm khung 00:00–07:00 VN từ chối oan ngày hôm nay).
   */
  private assertStartDateNotPast(startDate: string): void {
    let today: string;
    try {
      // en-CA ⇒ YYYY-MM-DD, cùng định dạng cột date.
      today = new Intl.DateTimeFormat("en-CA", {
        timeZone: process.env.DEFAULT_TIMEZONE || "Asia/Ho_Chi_Minh",
      }).format(new Date());
    } catch {
      today = new Date().toISOString().slice(0, 10);
    }
    if (startDate < today) {
      throw recruitUnprocessable(
        "INVALID_VALUE",
        RECRUIT_ERR.INVALID_START_DATE,
        recruitDetails("invalid-start-date", { startDate }),
      );
    }
  }
}
