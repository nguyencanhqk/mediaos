import { Injectable } from "@nestjs/common";
import type {
  CreateStatutoryRateRequest,
  PayrollCatalogWriteResult,
  StatutoryRateDto,
  StatutoryRateListQuery,
  UpdateStatutoryRateRequest,
} from "@mediaos/contracts";
import { paginated, toPagination } from "../common/pagination";
import { DatabaseService } from "../db/db.service";
import type { PayrollStatutoryRate } from "../db/schema/payroll";
import { AuditService } from "../events/audit.service";
import { isFormulaError } from "./formula/formula.errors";
import { assertBracketsContinuous } from "./formula/formula.statutory";
import { PayrollAccessService } from "./payroll-access.service";
import { payrollCatalogLockTx } from "./payroll-catalog.lock";
import { moneyInput, toStatutoryRateDto } from "./payroll-catalog.support";
import {
  formulaErrorToHttp,
  mapPayrollPgError,
  payrollConflict,
  payrollDetails,
  payrollNotFound,
  PAYROLL_ERR,
} from "./payroll.errors";
import type { PayrollRequestUser } from "./payroll.types";
import { StatutoryRatesRepository, type StatutoryRateWrite } from "./statutory-rates.repository";

/** Khoá số tiền/tỉ lệ của một bản — dùng để quy đổi `number` (JSON) sang chuỗi `numeric`. */
const NUMERIC_KEYS = [
  "siEmployeePct",
  "hiEmployeePct",
  "uiEmployeePct",
  "siEmployerPct",
  "hiEmployerPct",
  "uiEmployerPct",
  "unionEmployerPct",
  "unionEmployeePct",
  "siCap",
  "hiCap",
  "uiCap",
  "baseWage",
  "minRegionWage",
  "personalDeduction",
  "dependentDeduction",
] as const;

/**
 * S15-PAYROLL-BE-2 — `PAYROLL-API-055..058`: tỉ lệ · trần · bậc thuế luật định (PAY-DEC-014).
 *
 * - Bậc TNCN kiểm LIÊN TỤC ở đây (CHECK chỉ ép mảng 7 phần tử) ⇒ 422 PAYROLL-ERR-022 kèm `reason`.
 * - 058 chỉ sửa bản CHƯA có kỳ dùng — vị từ «đã có kỳ dùng» chốt ở `statutory-rates.repository.ts` (MF13). Đổi
 *   `effectiveFrom` ⇒ kiểm với `min(cũ, mới)` (vị từ đơn điệu theo ngày: ngày sớm hơn phủ nhiều kỳ hơn).
 * - Trần lưu THÀNH TIỀN, service KHÔNG nhân lại hệ số (§13.7 B).
 * - Audit KHÔNG chở số tiền/tỉ lệ (MF14 — `0571:30-32` xếp cặp này là sensitive): `effectiveFrom` + TÊN trường đổi.
 */
@Injectable()
export class StatutoryRatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: StatutoryRatesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 055 */
  async list(user: PayrollRequestUser, query: StatutoryRateListQuery) {
    await this.access.resolveActor(user, "statutoryRateList");
    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(tx, user.companyId, query.page, query.per_page);
      return paginated(
        rows.map((r) => toStatutoryRateDto(r, r.inUse)),
        toPagination(total, query.page, query.per_page),
      );
    });
  }

  /** 057 */
  async get(user: PayrollRequestUser, id: string): Promise<StatutoryRateDto> {
    await this.access.resolveActor(user, "statutoryRateDetail");
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findTx(tx, user.companyId, id);
      if (!row) throw payrollNotFound();
      const inUse = await this.repo.inUseAtTx(tx, user.companyId, String(row.effectiveFrom));
      return toStatutoryRateDto(row, inUse);
    });
  }

  /** 056 */
  async create(
    user: PayrollRequestUser,
    dto: CreateStatutoryRateRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "statutoryRateCreate");
    StatutoryRatesService.assertBrackets(dto.pitBrackets);
    return this.db.withTenant(user.companyId, async (tx) => {
      // S15-PAYROLL-BE-3 (security-review LOW) — CÙNG khoá ĐỘC QUYỀN với 058: POST một bản `effective_from` rơi vào kỳ
      // `calculate` đang tính (khoá dùng chung) phải chờ lượt tính commit, không chen giữa lúc nó chọn bản hiệu lực.
      await payrollCatalogLockTx(tx, user.companyId);
      let row: PayrollStatutoryRate;
      try {
        row = await this.repo.createTx(
          tx,
          user.companyId,
          {
            ...StatutoryRatesService.numericWrite(dto),
            effectiveFrom: dto.effectiveFrom,
            pitBrackets: dto.pitBrackets,
            note: dto.note ?? null,
          } as Parameters<StatutoryRatesRepository["createTx"]>[2],
          user.id,
        );
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      await this.audit.record(tx, {
        action: "create",
        objectType: "payroll_statutory_rate",
        objectId: row.id,
        actorUserId: user.id,
        before: null,
        after: { effectiveFrom: String(row.effectiveFrom) },
      });
      return { id: row.id };
    });
  }

  /** 058 */
  async update(
    user: PayrollRequestUser,
    id: string,
    dto: UpdateStatutoryRateRequest,
  ): Promise<PayrollCatalogWriteResult> {
    await this.access.resolveActor(user, "statutoryRateUpdate");
    if (dto.pitBrackets !== undefined) StatutoryRatesService.assertBrackets(dto.pitBrackets);
    return this.db.withTenant(user.companyId, async (tx) => {
      // S15-PAYROLL-BE-3 (plan §3.7) — khoá ĐỘC QUYỀN TRƯỚC kiểm `rate-in-use`: không có nó, `calculate` đang giữ bản tỉ
      // lệ FOR SHARE commit `Calculated` giữa lúc 058 kiểm và lúc 058 UPDATE ⇒ ghi đè số của bản vừa được dùng. Có
      // khoá ⇒ 058 chạy sau `calculate` (khoá dùng chung) và thấy kỳ `Calculated` ⇒ 409 033.
      await payrollCatalogLockTx(tx, user.companyId);
      const before = await this.repo.findTx(tx, user.companyId, id, { forUpdate: true });
      if (!before) throw payrollNotFound();
      const oldFrom = String(before.effectiveFrom);
      const checkFrom =
        dto.effectiveFrom !== undefined && dto.effectiveFrom < oldFrom ? dto.effectiveFrom : oldFrom;
      if (await this.repo.inUseAtTx(tx, user.companyId, checkFrom)) {
        throw payrollConflict(
          "STATUTORY_RATE_CONFLICT",
          PAYROLL_ERR.RATE_IN_USE,
          payrollDetails("rate-in-use"),
        );
      }
      const write: StatutoryRateWrite = {
        ...StatutoryRatesService.numericWrite(dto),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom } : {}),
        ...(dto.pitBrackets !== undefined ? { pitBrackets: dto.pitBrackets } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      };
      let row: PayrollStatutoryRate | null;
      try {
        row = await this.repo.updateTx(tx, user.companyId, id, write, user.id);
      } catch (err) {
        throw mapPayrollPgError(err) ?? err;
      }
      if (!row) throw payrollNotFound();
      await this.audit.record(tx, {
        action: "update",
        objectType: "payroll_statutory_rate",
        objectId: id,
        actorUserId: user.id,
        before: { effectiveFrom: oldFrom },
        after: { effectiveFrom: String(row.effectiveFrom), changedFields: Object.keys(dto) },
      });
      return { id };
    });
  }

  private static assertBrackets(raw: unknown): void {
    try {
      assertBracketsContinuous(raw);
    } catch (err) {
      if (isFormulaError(err)) throw formulaErrorToHttp(err);
      throw err;
    }
  }

  /** `number` JSON → chuỗi `numeric` cho các khoá CÓ MẶT (PATCH từng phần). */
  private static numericWrite(dto: Partial<Record<(typeof NUMERIC_KEYS)[number], number>>) {
    const out: Record<string, string> = {};
    for (const k of NUMERIC_KEYS) {
      const v = dto[k];
      if (typeof v === "number") out[k] = moneyInput(v);
    }
    return out as Partial<Record<(typeof NUMERIC_KEYS)[number], string>>;
  }
}
