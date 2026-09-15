import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  CompletePaymentBatchRequest,
  CompletePaymentBatchResultDto,
  CreatePaymentBatchRequest,
  PaymentBatchListQuery,
  PaymentBatchStatus,
  PaymentBatchWriteResultDto,
  PaymentLineListQuery,
  PayrollPeriodStatus,
  UpdatePaymentBatchRequest,
} from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import type { PayrollPaymentBatch } from "../db/schema/payroll-disbursement";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PayrollAccessService } from "./payroll-access.service";
import { toPaymentBatchDto, toPaymentLineDto } from "./payroll-disbursement.mapper";
import { assertPeriodTransition } from "./payroll-fsm";
import {
  PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED,
  type PayrollPaymentBatchCompletedPayload,
} from "./payroll-noti.payload";
import { PayrollPairHoldersReader } from "./payroll-pair-holders.reader";
import {
  PayrollPaymentBatchesRepository,
  type LineTouch,
} from "./payroll-payment-batches.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import { PayrollPeriodsRepository } from "./payroll-periods.repository";
import { mappedWrite } from "./payroll-pg-write.util";
import {
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  payrollUnprocessable,
  PAYROLL_ERR,
} from "./payroll.errors";
import { payrollOffset, type PayrollRequestUser } from "./payroll.types";

/**
 * MEDIUM-2 (security DB-2) — mọi câu ghi `payroll_payment_lines` đi qua đây. S15-PAYROLL-BE-4B: thân wrapper chuyển sang
 * `mappedWrite` (`payroll-pg-write.util.ts`) để `payroll_advances` dùng CÙNG MỘT khuôn (security L6); nhãn bảng giữ nguyên
 * cho log/int-spec (`payroll_payment_lines write failed: …`).
 */
export const mappedLineWrite = <T>(fn: () => Promise<T>): Promise<T> =>
  mappedWrite("payroll_payment_lines", fn);

/** Mã đợt tự sinh (D-9/C5): `CT-<YYYYMM>-<BANK|CASH>-<8 hex>` — mã đợt KHÔNG phải PII, dùng làm tên tệp UNC. */
export function defaultBatchCode(periodMonth: string, method: string): string {
  return `CT-${periodMonth.replace("-", "")}-${method.toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

interface PopulateResult {
  added: LineTouch[];
  warnings: string[];
  skippedNoBank: number;
}

/**
 * S15-PAYROLL-BE-4 — đợt chi trả `PAYROLL-API-066..070` + `072` (SPEC-11 §13.1 luật PHỦ · §15.1 · DB-13 §14.2–14.3).
 * 071 (tệp UNC) sống ở `PayrollPaymentExportService`.
 *
 * ── THỨ TỰ KHOÁ CỐ ĐỊNH (DB-2 M5): kỳ `FOR UPDATE` (khi chạm kỳ) → đợt `FOR UPDATE` → RỒI MỚI ghi dòng. 069 KHÔNG khoá kỳ.
 * ── LUẬT PHỦ (072): đợt `Completed` xong, đếm `uncoveredPayeesTx` DƯỚI khoá kỳ; = 0 ⇒ `assertPeriodTransition
 *    ('Published','Paid','complete-batch')` + `TRAIL_RESET` ghi `paid_*` + NOTI-027 (dedupe `{periodId}`); > 0 ⇒ **200**,
 *    kỳ giữ `Published` (ca ÂM: đợt giữa chừng KHÔNG 409).
 * ── FOUR-EYES ĐỢT (D-10/C3): 067 tiền-kiểm «tồn tại ≥ 1 người KHÁC actor giữ `manage:payment-batch`@Company» ⇒ rỗng ⇒
 *    422 017 `no-eligible-completer` (fail-fast lúc LẬP); 072 `created_by === actor` ⇒ 409 027 `batch-four-eyes`.
 * ── SNAPSHOT TK SINH Ở SERVER (MEDIUM-3): body 067/069 `.strict()` không có trường TK; «sửa snapshot» = gỡ + thêm lại khi
 *    `Draft`/`Ready` (069), mỗi lượt có audit `{added,removed}` mang `last4`.
 * ── B1: gỡ dòng đã `paid_at` ⇒ 409 027 `line-already-paid` (gỡ được là nhả `payslip_uq` cho phiếu vào đợt khác = chi HAI lần).
 */
@Injectable()
export class PayrollPaymentBatchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollPaymentBatchesRepository,
    private readonly periods: PayrollPeriodsRepository,
    private readonly holders: PayrollPairHoldersReader,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 066 — danh sách đợt (audit lượt đọc; `totalNet` theo cặp chở-tiền của route). */
  async list(user: PayrollRequestUser, query: PaymentBatchListQuery) {
    const actor = await this.access.resolveActor(user, "batchList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const filter = {
        payrollPeriodId: query.payrollPeriodId,
        status: query.status as PaymentBatchStatus[] | undefined,
        method: query.method,
      };
      const [rows, total] = await Promise.all([
        this.repo.listTx(
          tx,
          user.companyId,
          filter,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countTx(tx, user.companyId, filter),
      ]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_payment_batch",
        actorUserId: user.id,
        before: null,
        after: { filters: filter, rowCount: rows.length },
      });
      return paginated(
        rows.map((r) => toPaymentBatchDto(r, actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 067 — lập đợt từ kỳ `Published`; dòng nạp theo D-1; C3 tiền-kiểm four-eyes. */
  async create(
    user: PayrollRequestUser,
    dto: CreatePaymentBatchRequest,
  ): Promise<PaymentBatchWriteResultDto> {
    await this.access.resolveActor(user, "batchCreate");
    return this.db.withTenant(user.companyId, async (tx) => {
      // 0 — C3: chưa ghi gì; công ty một-người-vận-hành không kẹt kỳ `Published` vĩnh viễn.
      const completers = await this.holders.holdersTx(tx, user.companyId, "batchComplete", user.id);
      if (completers.length === 0) {
        throw payrollUnprocessable(
          "NO_ELIGIBLE_APPROVER",
          PAYROLL_ERR.NO_ELIGIBLE_COMPLETER,
          payrollDetails("no-eligible-completer"),
        );
      }
      // 1 — khoá KỲ trước.
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, dto.payrollPeriodId);
      if (!period) throw payrollNotFound();
      if ((period.status as PayrollPeriodStatus) !== "Published") {
        throw payrollConflict(
          "PAYMENT_BATCH_CONFLICT",
          PAYROLL_ERR.PERIOD_NOT_PUBLISHED,
          payrollDetails("period-not-published", { periodStatus: period.status }),
        );
      }
      // 2 — INSERT đợt (mã tự sinh D-9; trùng ⇒ 409 027 `batch-code-exists`; T1 `insert-completed` không tới được từ đây).
      let batch: PayrollPaymentBatch;
      try {
        batch = await this.repo.createTx(
          tx,
          user.companyId,
          {
            payrollPeriodId: period.id,
            code: dto.code ?? defaultBatchCode(period.periodMonth, dto.method),
            method: dto.method,
            payDate: dto.payDate ?? null,
            note: dto.note ?? null,
          },
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      // 3 — khoá ĐỢT (hàng vừa chèn) — giữ đúng thứ tự cho bước ghi dòng (T2 FOR SHARE xếp sau).
      const locked = await this.repo.findTx(tx, user.companyId, batch.id, { forUpdate: true });
      if (!locked) throw payrollNotFound();
      // 4 — nạp dòng.
      const populated = await this.populateTx(
        tx,
        user.companyId,
        locked,
        dto.userIds ?? null,
        user.id,
      );
      // 5 — audit (số ĐẾM, `last4`; KHÔNG tiền).
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_payment_batch",
        objectId: batch.id,
        actorUserId: user.id,
        before: null,
        after: {
          periodId: period.id,
          method: batch.method,
          lineCount: populated.added.length,
          skippedNoBank: populated.skippedNoBank,
          added: populated.added,
        },
      });
      return { id: batch.id, warnings: populated.warnings };
    });
  }

  /** 068 — chi tiết + tổng (audit lượt đọc `{}`). */
  async get(user: PayrollRequestUser, id: string) {
    const actor = await this.access.resolveActor(user, "batchDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findWithStatsTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_payment_batch",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: {},
      });
      return toPaymentBatchDto(row, actor);
    });
  }

  /** 069 — sửa đợt + thêm/bớt/đánh dấu đã chi dòng khi `Draft`/`Ready` (Zod status RIÊNG — B4). */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdatePaymentBatchRequest,
  ): Promise<PaymentBatchWriteResultDto> {
    await this.access.resolveActor(user, "batchUpdate");
    return this.db.withTenant(user.companyId, async (tx) => {
      const before = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!before) throw payrollNotFound();
      this.assertNotCompleted(before);

      const changedFields = (["status", "payDate", "note"] as const).filter(
        (k) => dto[k] !== undefined,
      );
      if (changedFields.length > 0) {
        try {
          const row = await this.repo.updateTx(
            tx,
            user.companyId,
            id,
            {
              ...(dto.status !== undefined ? { status: dto.status } : {}),
              ...(dto.payDate !== undefined ? { payDate: dto.payDate } : {}),
              ...(dto.note !== undefined ? { note: dto.note } : {}),
            },
            user.id,
          );
          if (!row) throw payrollNotFound();
        } catch (err) {
          throw mapPayrollPgError(err) ?? err;
        }
      }

      let removed: LineTouch[] = [];
      if (dto.removeUserIds?.length) {
        const live = await this.repo.liveLinesTx(tx, user.companyId, id);
        const set = new Set(dto.removeUserIds);
        const targets = live.filter((l) => set.has(l.userId));
        if (targets.length !== set.size) throw payrollNotFound();
        // B1 — dòng đã chi KHÔNG gỡ được (gỡ = nhả `payslip_uq` ⇒ phiếu vào đợt khác = chi HAI lần). KHÔNG gỡ dòng nào.
        const paid = targets.filter((l) => l.paidAt !== null);
        if (paid.length > 0) {
          throw payrollConflict(
            "PAYMENT_BATCH_CONFLICT",
            PAYROLL_ERR.LINE_ALREADY_PAID,
            payrollDetails("line-already-paid", { paidLines: paid.length }),
          );
        }
        removed = await mappedLineWrite(() =>
          this.repo.softDeleteLinesTx(tx, user.companyId, id, [...set], user.id),
        );
      }

      let added: LineTouch[] = [];
      let warnings: string[] = [];
      if (dto.addUserIds?.length) {
        const populated = await this.populateTx(
          tx,
          user.companyId,
          before,
          dto.addUserIds,
          user.id,
        );
        added = populated.added;
        warnings = populated.warnings;
      }

      let markedPaid: string[] = [];
      if (dto.markPaidUserIds?.length) {
        const live = await this.repo.liveLinesTx(tx, user.companyId, id);
        const known = new Set(live.map((l) => l.userId));
        if (dto.markPaidUserIds.some((u) => !known.has(u))) throw payrollNotFound();
        markedPaid = await mappedLineWrite(() =>
          this.repo.markPaidTx(tx, user.companyId, id, dto.markPaidUserIds!, user.id),
        );
      }

      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_payment_batch",
        objectId: id,
        actorUserId: user.id,
        before: { status: before.status },
        // C2 — added/removed mang `last4` (không số đầy đủ), markedPaid là userId.
        after: { changedFields, added, removed, markedPaid },
      });
      return { id, warnings };
    });
  }

  /** 070 — dòng chi (`bankAccountLast4`, `net` theo cặp chở-tiền; audit `{rowCount}`). */
  async lines(user: PayrollRequestUser, id: string, query: PaymentLineListQuery) {
    const actor = await this.access.resolveActor(user, "batchLines");
    return this.db.withTenant(user.companyId, async (tx) => {
      const batch = await this.repo.findTx(tx, user.companyId, id);
      if (!batch) throw payrollNotFound();
      const [rows, total] = await Promise.all([
        this.repo.linesPageTx(
          tx,
          user.companyId,
          id,
          query.per_page,
          payrollOffset(query.page, query.per_page),
        ),
        this.repo.countLinesTx(tx, user.companyId, id),
      ]);
      const names = await this.people.namesByUserIdsTx(
        tx,
        actor,
        rows.map((r) => r.userId),
      );
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_payment_batch",
        objectId: id,
        actorUserId: user.id,
        before: null,
        after: { rowCount: rows.length },
      });
      return paginated(
        rows.map((r) => toPaymentLineDto(r, names.get(r.userId), actor)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 072 — hoàn tất theo LUẬT PHỦ (row-lock kỳ TRƯỚC, đợt SAU). */
  async complete(
    user: PayrollRequestUser,
    id: string,
    dto: CompletePaymentBatchRequest,
  ): Promise<CompletePaymentBatchResultDto> {
    const actor = await this.access.resolveActor(user, "batchComplete");
    return this.db.withTenant(user.companyId, async (tx) => {
      // 0 — kỳ của đợt (SELECT thường; bất biến nhờ T1) rồi khoá KỲ.
      const periodId = await this.repo.periodIdOfTx(tx, user.companyId, id);
      if (!periodId) throw payrollNotFound();
      const period = await this.periods.lockForUpdateTx(tx, user.companyId, periodId);
      if (!period) throw payrollNotFound();
      // 1 — khoá ĐỢT.
      const batch = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!batch) throw payrollNotFound();
      this.assertNotCompleted(batch);
      if (batch.createdBy === user.id) {
        throw payrollConflict(
          "PAYMENT_BATCH_CONFLICT",
          PAYROLL_ERR.BATCH_FOUR_EYES,
          payrollDetails("batch-four-eyes"),
        );
      }
      // 2 — `confirmAllPaid` ghi `paid_at` cho mọi dòng chưa chi TRƯỚC khi kiểm (D-2).
      let markedPaidCount = 0;
      if (dto.confirmAllPaid === true) {
        markedPaidCount = (
          await mappedLineWrite(() => this.repo.markPaidTx(tx, user.companyId, id, null, user.id))
        ).length;
      }
      // 3 — đợt rỗng ⇒ 028 (đường phát DUY NHẤT); còn dòng chưa chi ⇒ 027 `batch-incomplete`.
      const counts = await this.repo.lineCountsTx(tx, user.companyId, id);
      if (counts.live === 0) {
        throw payrollConflict(
          "BATCH_EMPTY",
          PAYROLL_ERR.BATCH_EMPTY,
          payrollDetails("batch-empty"),
        );
      }
      if (counts.unpaid > 0) {
        throw payrollConflict(
          "PAYMENT_BATCH_CONFLICT",
          PAYROLL_ERR.BATCH_INCOMPLETE,
          payrollDetails("batch-incomplete", { unpaidLines: counts.unpaid }),
        );
      }
      // 4 — Completed + completed_by/at.
      let completed: PayrollPaymentBatch | null;
      try {
        completed = await this.repo.completeTx(tx, user.companyId, id, dto.payDate, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!completed) throw payrollNotFound();
      // 5 — LUẬT PHỦ dưới khoá kỳ.
      const unpaidPayees = await this.repo.uncoveredPayeesTx(tx, user.companyId, periodId);
      let periodStatus = period.status as PayrollPeriodStatus;
      if (unpaidPayees === 0) {
        assertPeriodTransition(periodStatus, "Paid", "complete-batch");
        let row;
        try {
          row = await this.periods.applyTransitionTx(
            tx,
            user.companyId,
            periodId,
            "Paid",
            "complete-batch",
            user.id,
          );
        } catch (err) {
          throw mapPayrollPgError(err) ?? err;
        }
        if (!row) throw payrollNotFound();
        periodStatus = row.status as PayrollPeriodStatus;
        await this.audit.record(tx, {
          action: "complete-batch",
          objectType: "payroll_period",
          objectId: periodId,
          actorUserId: user.id,
          before: { status: period.status },
          after: { status: row.status, batchId: id },
        });
        // NOTI-027 — đúng MỘT lần/kỳ (dedupe `{periodId}`); rỗng ⇒ KHÔNG enqueue.
        const recipientUserIds = await this.holders.holdersTx(
          tx,
          user.companyId,
          "batchList",
          user.id,
        );
        if (recipientUserIds.length === 0) {
          // silent-failure-hunter BE-4 #3: kỳ sang `Paid` mà không ai giữ `view:payment-batch` ngoài actor ⇒ NOTI-027
          // không gửi (C7). Để lại dấu vết cho giám sát; KHÔNG số tiền/TK.
          Logger.warn(
            `NOTI-027 bỏ qua: không có người nhận ngoài actor (batch ${id}, period ${periodId})`,
            PayrollPaymentBatchesService.name,
          );
        } else {
          const payload: PayrollPaymentBatchCompletedPayload = {
            periodId,
            batchId: id,
            actorUserId: actor.actorUserId,
            recipientUserIds,
            period_month: period.periodMonth,
            payroll_period_id: periodId,
          };
          await this.outbox.enqueue(tx, {
            eventType: PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED,
            payload,
          });
        }
      }
      await this.audit.record(tx, {
        action: "complete",
        objectType: "payroll_payment_batch",
        objectId: id,
        actorUserId: user.id,
        before: { status: batch.status },
        after: {
          status: completed.status,
          periodStatus,
          unpaidPayees,
          confirmAllPaid: dto.confirmAllPaid === true,
          markedPaidCount,
          lineCount: counts.live,
        },
      });
      return { id, batchStatus: "Completed", periodStatus, unpaidPayees };
    });
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────────────────────

  private assertNotCompleted(batch: PayrollPaymentBatch): void {
    if ((batch.status as PaymentBatchStatus) === "Completed") {
      throw payrollConflict(
        "PAYMENT_BATCH_CONFLICT",
        PAYROLL_ERR.BATCH_ALREADY_COMPLETED,
        payrollDetails("batch-already-completed"),
      );
    }
  }

  /**
   * D-1 — nạp dòng cho đợt ĐÃ khoá `FOR UPDATE`. `userIds` null ⇒ tự nạp mọi phiếu chưa có dòng sống (bank: bỏ người thiếu
   * TK + warning); tường minh ⇒ người không có phiếu ⇒ 404 sentinel · bank + thiếu TK ⇒ 409 027 `payee-no-bank-account` ·
   * người đã ở đợt khác ⇒ để `payslip_uq` bắt (409 027 `payee-already-in-batch`, TÊN ĐÚNG — census). `net = 0` ⇒ giữ dòng
   * + warning `zero-net:<n>` (R8).
   */
  private async populateTx(
    tx: TenantTx,
    companyId: string,
    batch: PayrollPaymentBatch,
    userIds: readonly string[] | null,
    actorUserId: string,
  ): Promise<PopulateResult> {
    const candidates = await this.repo.candidatesTx(tx, companyId, batch.payrollPeriodId, userIds);
    const isBank = batch.method === "bank";
    const warnings: string[] = [];
    let skippedNoBank = 0;
    let picked = candidates;
    if (userIds) {
      const found = new Set(candidates.map((c) => c.userId));
      if (userIds.some((u) => !found.has(u))) throw payrollNotFound();
      if (isBank && candidates.some((c) => !c.hasBank)) {
        throw payrollConflict(
          "PAYMENT_BATCH_CONFLICT",
          PAYROLL_ERR.PAYEE_NO_BANK_ACCOUNT,
          payrollDetails("payee-no-bank-account", {
            missing: candidates.filter((c) => !c.hasBank).length,
          }),
        );
      }
    } else {
      picked = candidates.filter((c) => !c.hasLine);
      if (isBank) {
        skippedNoBank = picked.filter((c) => !c.hasBank).length;
        picked = picked.filter((c) => c.hasBank);
        if (skippedNoBank > 0) warnings.push(`no-bank-account:${skippedNoBank}`);
      }
      // silent-failure-hunter BE-4 #2: tự nạp trúng 0 người (mọi phiếu đã ở đợt khác, hoặc `bank` mà ai còn lại cũng
      // thiếu TK) vẫn 201 — báo TƯỜNG MINH để officer không tưởng đã lập đợt cho N người; 072 vẫn chặn `batch-empty`.
      if (picked.length === 0) warnings.push("no-eligible-payees");
    }
    const zeroNet = picked.filter((c) => Number(c.net) === 0).length;
    if (zeroNet > 0) warnings.push(`zero-net:${zeroNet}`);
    const added = await mappedLineWrite(() =>
      this.repo.insertLinesTx(
        tx,
        companyId,
        { id: batch.id, method: batch.method },
        picked.map((c) => c.payslipId),
        actorUserId,
      ),
    );
    return { added, warnings, skippedNoBank };
  }
}
