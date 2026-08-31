import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { EmployeeRefInvalidError, HrWriteService } from "../employees/hr-write.service";
import type { Candidate, Offer } from "../db/schema/recruit";
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
import {
  RECRUIT_EVENT_CANDIDATE_HIRED,
  type RecruitCandidateHiredPayload,
} from "./recruit-noti.payload";
import type { RecruitRequestUser } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — convert ứng viên → nhân viên (RECRUIT-API-029, SPEC-12 §13.5, REC-DEC-005).
 *
 * BA PHA (plan §6.1 — mirror `GoalDecomposeService`/`allocateTaskCodeOutsideTx`, KHÔNG gọi
 * SequenceService trong tx đang giữ FOR UPDATE — S5-SEQ-HARDEN-1):
 *   1. Guard tầng 2 (`('convert','candidate')` isSensitive:true — TRƯỚC MỌI side-effect, deny = 0
 *      side-effect) + đọc fail-fast KHÔNG lock (kết quả BỊ VỨT — không mang sang Pha 3).
 *   2. Cấp mã NGOÀI tx: `hrWrite.allocateEmployeeCode` (ensure-on-miss + map 422
 *      HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID có sẵn). Pha 3 rollback ⇒ mã đốt (gap OK — §13.5 bước 4).
 *   3. Business tx: FOR UPDATE candidates JOIN job_openings (đọc LẠI mọi trường ĐEM GHI — TOCTOU) →
 *      KIỂM LẠI N1 fail-closed → `createEmployeeFromCandidateTx` → link employee_id (UNIQUE = chốt
 *      cuối double-convert) → stage Offer→Hired via=convert → audit + outbox NOTI-019.
 *
 * `@Idempotent()` trên route chỉ chống replay CÙNG key — chốt thật chống double-convert là UNIQUE
 * `uq_candidates_company_employee` (test race dùng 2 key KHÁC nhau — plan §6.1).
 */
@Injectable()
export class RecruitConvertService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: RecruitAccessService,
    private readonly candidates: CandidatesRepository,
    private readonly offers: OffersRepository,
    private readonly hrWrite: HrWriteService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async convert(user: RecruitRequestUser, candidateId: string) {
    // ── Pha 1 — guard tầng 2 TRƯỚC TIÊN (deny ⇒ chưa cấp mã, chưa mở tx) ──
    await this.access.resolveActor(user, "candidateConvert");
    await this.db.withTenant(user.companyId, async (tx) => {
      const candidate = await this.candidates.findTx(tx, user.companyId, candidateId);
      if (!candidate) throw recruitNotFound();
      const offers = await this.offers.byCandidateTx(tx, user.companyId, candidateId);
      // Fail-fast đúng thứ tự N1 — kết quả đọc ở đây KHÔNG dùng lại ở Pha 3.
      this.assertPreconditions(candidate, offers);
    });

    // ── Pha 2 — cấp mã NGOÀI mọi tx nghiệp vụ ──
    const employeeCode = await this.hrWrite.allocateEmployeeCode(user.companyId);

    // ── Pha 3 — business tx, chốt cuối GHI ──
    return this.db.withTenant(user.companyId, async (tx) => {
      const locked = await this.candidates.findForConvertTx(tx, user.companyId, candidateId);
      if (!locked) throw recruitNotFound();
      const liveOffers = await this.offers.byCandidateTx(tx, user.companyId, candidateId);
      const accepted = this.assertPreconditions(locked, liveOffers);

      let created: { employeeId: string; employeeCode: string };
      try {
        created = await this.hrWrite.createEmployeeFromCandidateTx(
          tx,
          { id: user.id, companyId: user.companyId },
          {
            employeeCode,
            email: locked.email ?? null,
            phone: locked.phone ?? null,
            orgUnitId: locked.jobOrgUnitId,
            positionId: locked.jobPositionId,
            startDate: accepted.startDate,
          },
        );
      } catch (err) {
        if (err instanceof EmployeeRefInvalidError) {
          throw recruitUnprocessable(
            "PEOPLE_REF_INVALID",
            RECRUIT_ERR.PEOPLE_REF_INVALID(
              err.refKind === "org-unit"
                ? "đơn vị của vị trí tuyển không còn hoạt động"
                : "vị trí chức danh của vị trí tuyển không còn hoạt động",
            ),
            recruitDetails("org-unit-invalid", { ref: err.refKind }),
          );
        }
        // 23505 employee_profiles_company_code_active_uq ⇒ 409 008 employee-code-conflict (không 500).
        throw mapRecruitPgError(err) ?? err;
      }

      // Chốt cuối — set employee_id CHỈ khi còn NULL; 0 hàng/23505 = thua race ⇒ 008, rollback trọn.
      let linked;
      try {
        linked = await this.candidates.linkEmployeeTx(
          tx,
          user.companyId,
          candidateId,
          created.employeeId,
          user.id,
        );
      } catch (err) {
        throw mapRecruitPgError(err) ?? err;
      }
      if (!linked) {
        throw recruitConflict(
          "CONVERT_BLOCKED",
          RECRUIT_ERR.CONVERT_ALREADY,
          recruitDetails("already-converted"),
        );
      }

      // Offer→Hired via=convert — hợp lệ theo §13.1, KHÔNG cần gọi lại assertStageTransition.
      const moved = await this.candidates.moveStageTx(
        tx,
        user.companyId,
        candidateId,
        "Offer",
        "Hired",
        "convert",
        "Chuyển thành nhân viên",
        user.id,
      );
      if (!moved) {
        // stage đã đổi giữa FOR UPDATE và đây — bất khả trong cùng tx, nhưng fail-closed vẫn hơn.
        throw recruitConflict(
          "CONVERT_BLOCKED",
          RECRUIT_ERR.CONVERT_ALREADY,
          recruitDetails("already-converted"),
        );
      }

      await this.audit.record(tx, {
        action: "convert",
        objectType: "candidate",
        objectId: candidateId,
        actorUserId: user.id,
        before: { stage: "Offer" },
        // KHÔNG lương/PII (plan §6.1 bước 7).
        after: {
          stage: "Hired",
          employeeId: created.employeeId,
          jobOpeningId: locked.jobOpeningId,
        },
      });
      const payload: RecruitCandidateHiredPayload = {
        candidateId,
        employeeId: created.employeeId,
        jobOpeningId: locked.jobOpeningId,
        actorUserId: user.id,
        candidate_name: locked.fullName,
        job_title: locked.jobTitle,
        candidate_id: candidateId,
      };
      await this.outbox.enqueue(tx, { eventType: RECRUIT_EVENT_CANDIDATE_HIRED, payload });

      return {
        candidateId,
        employeeId: created.employeeId,
        employeeCode: created.employeeCode,
        stage: "Hired" as const,
      };
    });
  }

  /**
   * Thứ tự N1 (SPEC-12 §13.5 — kiểm 2a TRƯỚC để 008 không bị 007 "nuốt"): (a) `employee_id` NULL ⇒
   * chưa convert; (b) stage = 'Offer'; (c) tồn tại offer Accepted. Trả offer Accepted MỚI NHẤT
   * (mảng đã ORDER BY created_at DESC, id DESC).
   */
  private assertPreconditions(candidate: Candidate, offerRows: Offer[]): Offer {
    if (candidate.employeeId !== null) {
      throw recruitConflict(
        "CONVERT_BLOCKED",
        RECRUIT_ERR.CONVERT_ALREADY,
        recruitDetails("already-converted"),
      );
    }
    if (candidate.stage !== "Offer") {
      throw recruitConflict(
        "STAGE_PRECONDITION",
        RECRUIT_ERR.NOT_IN_OFFER_STAGE,
        recruitDetails("not-in-offer-stage", { stage: candidate.stage }),
      );
    }
    if (offerRows.length === 0) {
      throw recruitConflict(
        "CONVERT_BLOCKED",
        RECRUIT_ERR.CONVERT_NO_OFFER,
        recruitDetails("no-offer"),
      );
    }
    const accepted = offerRows.find((o) => o.status === "Accepted");
    if (!accepted) {
      throw recruitConflict(
        "CONVERT_BLOCKED",
        RECRUIT_ERR.CONVERT_OFFER_NOT_ACCEPTED,
        recruitDetails("offer-not-accepted"),
      );
    }
    return accepted;
  }
}
