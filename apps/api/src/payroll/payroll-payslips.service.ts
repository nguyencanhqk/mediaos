import { Injectable } from "@nestjs/common";
import type {
  MePayslipListQuery,
  PayrollPeriodStatus,
  PayrollWriteResultDto,
  PayslipAcknowledgementDto,
  PayslipDetailDto,
  PayslipListQuery,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { paginated, toPagination } from "../common/pagination";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollPayslipsRepository } from "./payroll-payslips.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { assertPeriodTransition, resolveActionTarget } from "./payroll-fsm";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  PAYROLL_ERR,
} from "./payroll.errors";
import { toPayslipDetailDto, toPayslipDto } from "./payroll.mapper";
import {
  PAYROLL_EVENT_PAYSLIP_PUBLISHED,
  type PayslipPublishedPayload,
} from "./payroll-noti.payload";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";

/**
 * S13-PAYROLL-BE-2 — phiếu lương: `generate-payslips` (013) · `publish` (014) · đọc quản trị
 * `029`/`030` · Own `031`/`032` · xác nhận `033`.
 *
 * ── HAI ĐƯỜNG ĐỌC, HAI LUẬT KHÁC NHAU ──
 *  · **Quản trị** (029/030, cặp `view-payslip:payslip` + SÀN scope Company) — **GHI audit lượt đọc**
 *    trong CÙNG transaction: đọc lương người khác là sự kiện an ninh.
 *  · **Own** (031/032/033, cặp `view-own-payslip` / `acknowledge-own-payslip`, scope Own hợp lệ) —
 *    **GHI 0 hàng audit**: tự xem lương của mình không phải sự kiện an ninh (SPEC-11 §18). Thêm audit
 *    ở đây là biến mỗi lần nhân viên mở app thành một hàng sổ.
 */
@Injectable()
export class PayrollPayslipsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly periods: PayrollPeriodsRepository,
    private readonly repo: PayrollPayslipsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * 013 — sinh phiếu lương từ bảng lương nháp. Ô **TẠI CHỖ** ở `Approved` (không đổi trạng thái, chỉ
   * ghi cặp `payslips_generated_by/at`).
   *
   * **NO-OP 200 khi đã sinh**: cờ đọc trên CHÍNH hàng kỳ đang giữ row-lock (KHÔNG đếm bảng `payslips`
   * — bảng khác không được lock bảo vệ). Idempotent theo nghiệp vụ, không chỉ theo `Idempotency-Key`.
   */
  async generate(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodGeneratePayslips");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;

      if (period.payslipsGeneratedAt) {
        const existing = await this.repo.countByPeriodTx(tx, user.companyId, id);
        return {
          id,
          status: from,
          affectedLines: existing,
          warnings: ["payslips-already-generated"],
        };
      }

      const to = resolveActionTarget(from, "generate-payslips");
      assertPeriodTransition(from, to, "generate-payslips");

      let refs;
      try {
        refs = await this.repo.generateFromLinesTx(tx, user.companyId, id, user.id);
        await this.repo.insertItemsForPeriodTx(tx, user.companyId, id);
      } catch (err) {
        // RACE hai lượt `generate` song song ⇒ 23505 `payslips_period_user_uq` ⇒ 409 006, rollback
        // TOÀN BỘ (không để lại phiếu nửa vời — bảng append-only, không dọn lại được).
        throw mapPayrollPgError(err) ?? err;
      }
      if (refs.length === 0) {
        // Kỳ không có dòng nháp sống nào ⇒ không có gì để phát hành. Đây là 409 007 «chưa sinh phiếu»
        // dịch sang bối cảnh generate: đừng đóng dấu cờ đã-sinh-phiếu cho một kỳ RỖNG, vì cờ đó KHOÁ
        // luôn `reopen` (assertReopenAllowed) ⇒ kỳ kẹt vĩnh viễn không có phiếu nào.
        throw payrollConflict(
          "NO_PAYSLIP",
          PAYROLL_ERR.NO_PAYSLIP,
          payrollDetails("no-line-to-generate"),
        );
      }

      // Bất biến breakdown — kiểm TRONG transaction: lệch ⇒ rollback cả lượt, không phát hành một
      // phiếu mà các dòng chi tiết không cộng ra `net`.
      const mismatches = await this.repo.findItemSumMismatchesTx(tx, user.companyId, id);
      if (mismatches.length > 0) {
        throw new Error(
          `PayrollPayslipsService.generate: ${mismatches.length} phiếu có SUM(payslip_items) ≠ ` +
            `gross − deduction_amount + adjustment_amount (kỳ ${id}) — bản đồ item §5b lệch công thức ` +
            `của PayrollCalcRepository. Rollback cả lượt sinh phiếu.`,
        );
      }

      const row = await this.applyOrMap(tx, user.companyId, id, to, "generate-payslips", user.id);
      await this.audit.record(tx, {
        action: "generate-payslips",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        after: { status: row.status, payslipCount: refs.length },
      });
      return {
        id,
        status: row.status as PayrollPeriodStatus,
        affectedLines: refs.length,
        warnings: [],
      };
    });
  }

  /** 014 — phát hành: `Approved → Paid`. Chưa sinh phiếu ⇒ 409 `007`. Phát N event NOTI-023 theo LÔ. */
  async publish(user: PayrollRequestUser, id: string): Promise<PayrollWriteResultDto> {
    await this.access.resolveActor(user, "periodPublish");
    return this.db.withTenant(user.companyId, async (tx) => {
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, id);
      if (!period) throw payrollNotFound();
      const from = period.status as PayrollPeriodStatus;
      // Cổng 007 TRƯỚC FSM: "chưa sinh phiếu" là nguyên nhân riêng, không được nuốt thành 001.
      const refs = await this.repo.listRefsByPeriodTx(tx, user.companyId, id);
      if (refs.length === 0) {
        throw payrollConflict("NO_PAYSLIP", PAYROLL_ERR.NO_PAYSLIP, payrollDetails("no-payslip"));
      }
      const to = resolveActionTarget(from, "publish");
      assertPeriodTransition(from, to, "publish");

      const row = await this.applyOrMap(tx, user.companyId, id, to, "publish", user.id);
      await this.audit.record(tx, {
        action: "publish",
        objectType: "payroll_period",
        objectId: id,
        actorUserId: user.id,
        before: { status: from },
        after: { status: row.status, payslipCount: refs.length },
      });

      // Một event / một phiếu, chèn MỘT câu: 500 phiếu = 500 hàng outbox nằm trong transaction đang
      // giữ row-lock trên kỳ. `dedupeKey = PAYSLIP_PUBLISHED:{payslipId}` ⇒ once-ever mỗi phiếu.
      await this.outbox.enqueueMany(
        tx,
        refs.map((r) => {
          const payload: PayslipPublishedPayload = {
            payslipId: r.id,
            periodId: id,
            actorUserId: user.id,
            recipientUserId: r.userId,
            period_month: period.periodMonth,
          };
          return { eventType: PAYROLL_EVENT_PAYSLIP_PUBLISHED, payload };
        }),
      );
      return {
        id,
        status: row.status as PayrollPeriodStatus,
        affectedLines: refs.length,
        warnings: [],
      };
    });
  }

  /** 029 — danh sách phiếu (quản trị) + **audit lượt đọc**. */
  async list(user: PayrollRequestUser, query: PayslipListQuery) {
    const actor = await this.access.resolveActor(user, "payslipList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const opts = { payrollPeriodId: query.payrollPeriodId, userId: query.userId };
      const [rows, total] = await Promise.all([
        this.repo.listTx(
          tx,
          user.companyId,
          opts,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countTx(tx, user.companyId, opts),
      ]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payslip",
        actorUserId: user.id,
        before: null,
        after: { view: "list", filter: opts, rows: rows.length },
      });
      return paginated(
        rows.map((r) => toPayslipDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 030 — chi tiết phiếu (quản trị) + breakdown + **audit lượt đọc**. */
  async get(user: PayrollRequestUser, payslipId: string): Promise<PayslipDetailDto> {
    const actor = await this.access.resolveActor(user, "payslipDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, payslipId, null);
      if (!row) throw payrollNotFound();
      const items = await this.repo.itemsByPayslipIdTx(tx, user.companyId, payslipId);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payslip",
        objectId: payslipId,
        actorUserId: user.id,
        before: null,
        after: { view: "detail", subjectUserId: row.user_id },
      });
      return toPayslipDetailDto(row, items, actor);
    });
  }

  /** 031 — «Phiếu lương của tôi». Own scope, chỉ kỳ ĐÃ phát hành. **0 hàng audit.** */
  async listMine(user: PayrollRequestUser, query: MePayslipListQuery) {
    const actor = await this.access.resolveActor(user, "mePayslipList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const opts = { ownerUserId: user.id, payrollPeriodId: query.payrollPeriodId };
      const [rows, total] = await Promise.all([
        this.repo.listTx(
          tx,
          user.companyId,
          opts,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countTx(tx, user.companyId, opts),
      ]);
      // Caller chưa có phiếu nào ⇒ danh sách RỖNG, KHÔNG lỗi (API-18 §5.1).
      return paginated(
        rows.map((r) => toPayslipDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 032 — chi tiết phiếu của tôi. Phiếu người khác ⇒ **404 sentinel**, không 403. **0 hàng audit.** */
  async getMine(user: PayrollRequestUser, payslipId: string): Promise<PayslipDetailDto> {
    const actor = await this.access.resolveActor(user, "mePayslipDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, payslipId, user.id);
      if (!row) throw payrollNotFound();
      const items = await this.repo.itemsByPayslipIdTx(tx, user.companyId, payslipId);
      return toPayslipDetailDto(row, items, actor);
    });
  }

  /**
   * 033 — xác nhận đã nhận phiếu của CHÍNH mình. Hai nhánh 409 `015`:
   *  · kỳ chưa phát hành ⇒ `kind = 'not-published'`;
   *  · đã xác nhận rồi ⇒ `kind = 'already-acknowledged'` (chốt cuối là unique ở DB).
   *
   * Tra phiếu bằng `findOwnedForAckTx` (KHÔNG lọc kỳ đã phát hành) — dùng `findTx` ở đây thì nhánh
   * «chưa phát hành» trả 0 hàng ⇒ 404 và mã 015 nhánh một thành **mã CHẾT**.
   */
  async acknowledge(
    user: PayrollRequestUser,
    payslipId: string,
  ): Promise<PayslipAcknowledgementDto> {
    await this.access.resolveActor(user, "mePayslipAck");
    return this.db.withTenant(user.companyId, async (tx) => {
      const owned = await this.repo.findOwnedForAckTx(tx, user.companyId, payslipId, user.id);
      if (!owned) throw payrollNotFound();
      if (!PayrollPayslipsRepository.isPublishedPeriodStatus(owned.periodStatus)) {
        throw payrollConflict(
          "ACK_INVALID",
          PAYROLL_ERR.ACK_NOT_PUBLISHED,
          payrollDetails("not-published"),
        );
      }
      let ack;
      try {
        ack = await this.repo.acknowledgeTx(tx, user.companyId, payslipId, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      // Audit: xác nhận là HÀNH ĐỘNG của nhân viên (không phải lượt đọc) ⇒ có vết, và không mang tiền.
      await this.audit.record(tx, {
        action: "acknowledge",
        objectType: "payslip",
        objectId: payslipId,
        actorUserId: user.id,
        before: null,
        after: { acknowledgementId: ack.id },
      });
      return {
        id: ack.id,
        payslipId,
        userId: user.id,
        createdAt:
          ack.createdAt instanceof Date
            ? ack.createdAt.toISOString()
            : new Date(ack.createdAt).toISOString(),
      };
    });
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  /** Bọc `applyTransitionTx` — 0 hàng ⇒ 404, `23514` ⇒ mã PAYROLL thay vì 500 (xem `payroll.errors`). */
  private async applyOrMap(
    tx: Parameters<PayrollPeriodsRepository["applyTransitionTx"]>[0],
    companyId: string,
    id: string,
    to: PayrollPeriodStatus,
    via: Parameters<PayrollPeriodsRepository["applyTransitionTx"]>[4],
    actorUserId: string,
  ) {
    let row;
    try {
      row = await this.periods.applyTransitionTx(tx, companyId, id, to, via, actorUserId);
    } catch (err) {
      throw mapPayrollPgError(err) ?? err;
    }
    if (!row) throw payrollNotFound();
    return row;
  }
}
