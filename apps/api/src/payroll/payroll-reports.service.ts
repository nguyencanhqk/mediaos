import { Injectable } from "@nestjs/common";
import { ZodValidationException } from "nestjs-zod";
import { ZodError, type ZodIssue } from "zod";
import {
  PAYROLL_REPORT_CODES,
  PAYROLL_REPORT_MAX_ROWS,
  type PayrollReportCatalogItemDto,
  type PayrollReportCode,
  type PayrollReportDataDto,
  type PayrollReportExportQuery,
  type PayrollReportParam,
  type PayrollReportQuery,
} from "@mediaos/contracts";
import { paginated, toPagination, type PaginatedResult } from "../common/pagination";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService, type PayrollSoftGateKey } from "./payroll-access.service";
import { PayrollBudgetsRepository } from "./payroll-budgets.repository";
import { PayrollPeopleRepository } from "./payroll-people.repository";
import {
  needsNames,
  reportColumnsOf,
  toReportRow,
  toReportTotals,
  type ReportCell,
} from "./payroll-reports.mapper";
import { PAYROLL_REPORTS, type PayrollReportDef } from "./payroll-reports.registry";
import {
  PayrollReportsRepository,
  type PayrollReportFilter,
  type RawReportRow,
} from "./payroll-reports.repository";
import { assertMoneyRoute } from "./payroll.mapper";
import { payrollDetails, payrollUnprocessable, PAYROLL_ERR } from "./payroll.errors";
import {
  payrollOffset,
  type PayrollActor,
  type PayrollPeopleMap,
  type PayrollPersonRef,
  type PayrollRequestUser,
} from "./payroll.types";

/** Bộ lọc đã kiểm cho MỘT báo cáo (chỉ gồm tham số báo cáo đó nhận). */
export interface CheckedReportFilter extends PayrollReportFilter {
  readonly fiscalYear?: number;
}

export interface CollectedReport {
  readonly total: number;
  readonly rows: Record<string, ReportCell>[];
  readonly totals: Record<string, number>;
}

/** Tra tên theo lô — xuất 50.000 dòng không được thành một `IN (...)` 50.000 tham số (§0b C6). */
const NAME_CHUNK = 5_000;
const SOFT_KEYS: readonly PayrollSoftGateKey[] = [
  "payslipList",
  "salaryProfileList",
  "batchList",
  "budgetList",
  "periodExport",
];

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-080` danh mục · `081` dữ liệu (SPEC-11 §15.1 · §18.1 B · PAY-DEC-018).
 *
 * Cổng (plan §2 + owner O-2):
 *  · 080/081: `view:payroll-report` + SÀN Company (`resolveActor`).
 *  · 081: báo cáo lộ tiền THEO NGƯỜI assert THÊM cặp đọc của nguồn — `resolveActor(user, def.sourceRouteKey)` NGAY
 *    tại call-site (census `payroll-report-source-pairs` ghim cả bảng lẫn lời gọi).
 *  · 080: KHÔNG assert cặp nguồn — lọc MỀM (`canResolve`, có sàn) để chỉ liệt kê báo cáo mở được; 0 audit.
 *
 * KHÔNG cache. Audit 081 MỖI lượt, CÙNG transaction với lượt đọc, payload không tiền.
 */
@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollReportsRepository,
    private readonly budgets: PayrollBudgetsRepository,
    private readonly people: PayrollPeopleRepository,
    private readonly audit: AuditService,
  ) {}

  /** 080 — danh mục (metadata, không số liệu ⇒ không audit). */
  async catalog(user: PayrollRequestUser): Promise<PayrollReportCatalogItemDto[]> {
    await this.access.resolveActor(user, "reportList");
    const granted = await Promise.all(SOFT_KEYS.map((k) => this.access.canResolve(user, k)));
    const has = new Map(SOFT_KEYS.map((k, i) => [k, granted[i]] as const));
    const exportable = has.get("periodExport") === true;
    return PAYROLL_REPORT_CODES.map((code) => PAYROLL_REPORTS[code])
      .filter((def) => def.sourceRouteKey === null || has.get(def.sourceRouteKey) === true)
      .map((def) => ({
        code: def.code,
        requiredParams: [...def.required],
        optionalParams: [...def.optional],
        columns: reportColumnsOf(def),
        exportable,
      }));
  }

  /** 081 — dữ liệu một báo cáo, phân trang; `totals` trên CẢ bộ lọc. */
  async data(
    user: PayrollRequestUser,
    code: PayrollReportCode,
    query: PayrollReportQuery,
  ): Promise<PaginatedResult<PayrollReportDataDto>> {
    const actor = await this.access.resolveActor(user, "reportData");
    const def = PAYROLL_REPORTS[code];
    // Owner O-2 — cặp đọc của NGUỒN (403 nếu thiếu hoặc dưới sàn Company), TRƯỚC khi chạm DB.
    if (def.sourceRouteKey !== null) await this.access.resolveActor(user, def.sourceRouteKey);
    const filter = PayrollReportsService.checkFilter(def, query);
    return this.db.withTenant(user.companyId, async (tx) => {
      const page = { limit: query.per_page, offset: payrollOffset(query.page, query.per_page) };
      const result = await this.collectTx(tx, actor, def, filter, page);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_report",
        actorUserId: user.id,
        before: null,
        // §18.1 B hàng 15 — `reportCode` không phải UUID ⇒ vào payload, `object_id` NULL. KHÔNG số tiền.
        after: { reportCode: code, filters: filter, rowCount: result.total },
      });
      return paginated(
        {
          reportCode: code,
          columns: reportColumnsOf(def),
          rows: result.rows,
          totals: result.totals,
        },
        toPagination(result.total, query.page, query.per_page),
      );
    });
  }

  /**
   * DÙNG CHUNG 081/082 (gọi trong transaction của caller, SAU khi caller đã assert đủ cặp): đếm TRƯỚC — vượt trần ⇒
   * 422 `031` khi CHƯA đọc hàng nào và CHƯA ghi audit (§0b C11) — rồi đọc hàng + tổng + tên.
   */
  async collectTx(
    tx: TenantTx,
    actor: PayrollActor,
    def: PayrollReportDef,
    filter: CheckedReportFilter,
    page: { limit: number; offset: number } | null,
  ): Promise<CollectedReport> {
    assertMoneyRoute(actor);
    const companyId = actor.companyId;
    if (def.code === "budget-status") {
      return this.collectBudgetTx(tx, companyId, def, filter, page);
    }
    const code = def.code;
    const total = await this.repo.countTx(tx, companyId, code, filter);
    PayrollReportsService.assertWithinCap(total);
    const [raw, totalsRaw] = await Promise.all([
      this.repo.rowsTx(tx, companyId, code, filter, page),
      this.repo.totalsTx(tx, companyId, code, filter),
    ]);
    const names = needsNames(def) ? await this.namesTx(tx, actor, raw) : null;
    return {
      total,
      rows: raw.map((r) => toReportRow(def, r, names)),
      totals: toReportTotals(totalsRaw),
    };
  }

  /** `budget-status` — CÙNG câu với 073; hàng tổng KHÔNG cộng trùng hàng công ty/đơn vị (§0b B4). */
  private async collectBudgetTx(
    tx: TenantTx,
    companyId: string,
    def: PayrollReportDef,
    filter: CheckedReportFilter,
    page: { limit: number; offset: number } | null,
  ): Promise<CollectedReport> {
    const fiscalYear = PayrollReportsService.requireFiscalYear(filter);
    const all = await this.budgets.reportRowsTx(tx, companyId, fiscalYear, filter.orgUnitId);
    PayrollReportsService.assertWithinCap(all.length);
    const t = await this.budgets.yearTotalsTx(tx, companyId, fiscalYear, filter.orgUnitId);
    // Số hàng bị chặn bởi unique (năm, đơn vị) — cắt trang ở đây là cắt mảng nhỏ, không phải tổng hợp ở JS.
    const slice = page ? all.slice(page.offset, page.offset + page.limit) : all;
    const rows = slice.map((r) =>
      toReportRow(
        def,
        {
          orgUnitId: r["org_unit_id"],
          orgUnitName: r["org_unit_name"],
          plannedAmount: r["planned_amount"],
          actualAmount: r["actual_amount"],
          variance: r["variance"],
          usagePct: r["usage_pct"],
        },
        null,
      ),
    );
    const totals: Record<string, number> = { actualAmount: Number(t.actualAmount) };
    if (t.plannedAmount !== null) totals["plannedAmount"] = Number(t.plannedAmount);
    if (t.variance !== null) totals["variance"] = Number(t.variance);
    return { total: all.length, rows, totals };
  }

  private async namesTx(
    tx: TenantTx,
    actor: PayrollActor,
    raw: readonly RawReportRow[],
  ): Promise<PayrollPeopleMap> {
    const ids = [
      ...new Set(raw.map((r) => r["userId"]).filter((v): v is string => typeof v === "string")),
    ];
    const out = new Map<string, PayrollPersonRef>();
    for (let i = 0; i < ids.length; i += NAME_CHUNK) {
      const part = await this.people.namesByUserIdsTx(tx, actor, ids.slice(i, i + NAME_CHUNK));
      for (const [k, v] of part) out.set(k, v);
    }
    return out;
  }

  // ── kiểm tham số ────────────────────────────────────────────────────────────────────────────

  /**
   * Chỉ giữ tham số báo cáo NHẬN (tham số khác bị bỏ qua — plan D-5); thiếu tham số BẮT BUỘC ⇒ 400
   * `VALIDATION-ERR-001` với `field` = tên tham số (cùng hình lỗi của pipe Zod).
   */
  static checkFilter(
    def: PayrollReportDef,
    query: PayrollReportQuery | PayrollReportExportQuery,
  ): CheckedReportFilter {
    const accepted = new Set<PayrollReportParam>([...def.required, ...def.optional]);
    const missing: ZodIssue[] = def.required
      .filter((p) => query[p] === undefined)
      .map((p) => ({
        code: "custom" as const,
        path: [p],
        message: `Báo cáo "${def.code}" bắt buộc tham số ${p}`,
      }));
    if (missing.length > 0) throw new ZodValidationException(new ZodError(missing));
    const filter: Record<string, string | number> = {};
    for (const k of accepted) {
      const v = query[k];
      if (v !== undefined) filter[k] = v;
    }
    return filter as CheckedReportFilter;
  }

  static assertWithinCap(total: number): void {
    if (total > PAYROLL_REPORT_MAX_ROWS) {
      throw payrollUnprocessable(
        "REPORT_TOO_LARGE",
        PAYROLL_ERR.REPORT_TOO_LARGE(total, PAYROLL_REPORT_MAX_ROWS),
        payrollDetails("report-too-large", { total, max: PAYROLL_REPORT_MAX_ROWS }),
      );
    }
  }

  private static requireFiscalYear(filter: CheckedReportFilter): number {
    if (filter.fiscalYear === undefined) {
      // `checkFilter` đã ép `required` — tới đây là bug nối dây.
      throw new Error("payroll report budget-status: thiếu fiscalYear sau checkFilter");
    }
    return filter.fiscalYear;
  }
}
