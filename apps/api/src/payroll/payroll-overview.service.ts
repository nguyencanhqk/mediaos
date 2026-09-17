import { Injectable } from "@nestjs/common";
import {
  PAYROLL_OVERVIEW_DEFAULT_MONTHS,
  PAYROLL_SALARY_BANDS,
  type PayrollOverviewDto,
  type PayrollOverviewQuery,
  type PayrollOverviewRemindersDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PayrollAccessService } from "./payroll-access.service";
import { PayrollBudgetsRepository } from "./payroll-budgets.repository";
import { PayrollEmployeesRepository } from "./payroll-employees.repository";
import { PayrollOverviewRepository } from "./payroll-overview.repository";
import { reportNumber, reportNumberOrNull } from "./payroll-reports.mapper";
import { assertMoneyRoute } from "./payroll.mapper";
import type { PayrollRequestUser } from "./payroll.types";

/** `YYYY-MM` lùi `n` tháng (chuỗi lịch, không phải tiền). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-078` Tổng quan · `079` Lời nhắc (SPEC-11 §9.1 PAY-SCREEN-015 · §15.1 · PAY-DEC-018).
 *
 * Cả hai: cặp `view:payroll-report` + SÀN Company (`resolveActor`), **KHÔNG cache**, audit MỖI lượt trong CÙNG
 * transaction với lượt đọc (`payroll_report` · `object_id` NULL · payload không tiền — §18.1 B hàng 13/14).
 *
 * Khối ngân sách (078) chỉ có mặt khi caller giữ thêm `view:payroll-budget`@Company — cùng cổng với báo cáo
 * `budget-status` (plan §0b B2); thiếu ⇒ VẮNG khoá, không null/0.
 */
@Injectable()
export class PayrollOverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PayrollAccessService,
    private readonly repo: PayrollOverviewRepository,
    private readonly budgets: PayrollBudgetsRepository,
    private readonly employees: PayrollEmployeesRepository,
    private readonly audit: AuditService,
  ) {}

  /** 078 — 6 khối. */
  async overview(
    user: PayrollRequestUser,
    query: PayrollOverviewQuery,
  ): Promise<PayrollOverviewDto> {
    const actor = await this.access.resolveActor(user, "overview");
    assertMoneyRoute(actor);
    const showBudget = await this.access.canResolve(user, "budgetList");
    const months = query.months ?? PAYROLL_OVERVIEW_DEFAULT_MONTHS;
    return this.db.withTenant(user.companyId, async (tx) => {
      const companyId = user.companyId;
      const latest = await this.repo.latestPublishedPeriodTx(tx, companyId, query.toMonth);
      const endMonth = query.toMonth ?? latest?.periodMonth ?? null;
      const fiscalYear =
        query.fiscalYear ??
        Number(
          (latest?.periodMonth ?? (await this.repo.companyTodayTx(tx, companyId))).slice(0, 4),
        );

      const [distribution, structure, byPeriod, byOrgUnit, budget] = await Promise.all([
        latest ? this.repo.salaryDistributionTx(tx, companyId, latest.periodMonth) : null,
        latest ? this.repo.incomeStructureTx(tx, companyId, latest.periodMonth) : [],
        endMonth
          ? this.repo.byPeriodTx(tx, companyId, {
              fromMonth: shiftMonth(endMonth, -(months - 1)),
              toMonth: endMonth,
            })
          : [],
        latest ? this.repo.byOrgUnitTx(tx, companyId, latest.periodMonth) : [],
        showBudget ? this.budgets.yearTotalsTx(tx, companyId, fiscalYear, undefined) : null,
      ]);

      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_report",
        actorUserId: user.id,
        before: null,
        // KHÔNG số tiền — mã báo cáo + kỳ neo + số kỳ xu hướng.
        after: {
          reportCode: "overview",
          latestPeriodMonth: latest?.periodMonth ?? null,
          months,
          fiscalYear,
          budgetShown: showBudget,
        },
      });

      return {
        latestPeriod: latest
          ? {
              id: latest.id,
              periodMonth: latest.periodMonth,
              status: latest.status as NonNullable<PayrollOverviewDto["latestPeriod"]>["status"],
            }
          : null,
        months,
        salaryDistribution: distribution
          ? distribution.map((b) => ({
              bandFrom: reportNumber(b.lo),
              bandTo: reportNumberOrNull(b.hi),
              headcount: Number(b.headcount),
            }))
          : PAYROLL_SALARY_BANDS.map((lo, i) => ({
              bandFrom: lo,
              bandTo: PAYROLL_SALARY_BANDS[i + 1] ?? null,
              headcount: 0,
            })),
        incomeStructure: structure.map((r) => ({
          componentCode: (r["componentCode"] as string | null) ?? null,
          itemType: r["itemType"] as PayrollOverviewDto["incomeStructure"][number]["itemType"],
          label: String(r["label"]),
          amount: reportNumber(r["amount"]),
          sharePct: reportNumber(r["sharePct"]),
        })),
        ...(budget
          ? {
              budget: {
                fiscalYear,
                plannedAmount: reportNumberOrNull(budget.plannedAmount),
                actualAmount: reportNumber(budget.actualAmount),
                usagePct: reportNumberOrNull(budget.usagePct),
              },
            }
          : {}),
        byPeriod: byPeriod.map((r) => ({
          periodMonth: String(r["periodMonth"]),
          headcount: Number(r["headcount"]),
          totalGross: reportNumber(r["totalGross"]),
          totalNet: reportNumber(r["totalNet"]),
          employerStatutory: reportNumber(r["employerStatutory"]),
          totalCost: reportNumber(r["totalCost"]),
          avgGross: reportNumber(r["avgGross"]),
          avgNet: reportNumber(r["avgNet"]),
        })),
        byOrgUnit: byOrgUnit.map((r) => ({
          orgUnitId: (r["orgUnitId"] as string | null) ?? null,
          orgUnitName: (r["orgUnitName"] as string | null) ?? null,
          headcount: Number(r["headcount"]),
          avgGross: reportNumber(r["avgGross"]),
          minGross: reportNumber(r["minGross"]),
          maxGross: reportNumber(r["maxGross"]),
        })),
      };
    });
  }

  /** 079 — 3 lời nhắc (chỉ SỐ ĐẾM). #2/#3 = `countTx` của 036 với CÙNG filter ⇒ không lệch được màn Nhân viên. */
  async reminders(user: PayrollRequestUser): Promise<PayrollOverviewRemindersDto> {
    await this.access.resolveActor(user, "overviewReminders");
    return this.db.withTenant(user.companyId, async (tx) => {
      const companyId = user.companyId;
      const [unpublished, uninsured, outOfRange, rateMissing, asOf] = await Promise.all([
        this.repo.unpublishedPayslipsTx(tx, companyId),
        this.employees.countTx(tx, companyId, { insuranceIssue: "not-joined" }),
        this.employees.countTx(tx, companyId, { insuranceIssue: "salary-out-of-range" }),
        this.repo.statutoryRateMissingTx(tx, companyId),
        this.repo.companyTodayTx(tx, companyId),
      ]);
      await this.audit.record(tx, {
        action: "read",
        objectType: "payroll_report",
        actorUserId: user.id,
        before: null,
        after: { reportCode: "overview.reminders" },
      });
      return {
        unpublishedPayslips: unpublished,
        uninsuredEmployees: { count: uninsured },
        insuranceSalaryOutOfRange: { count: outOfRange, asOf, rateMissing },
      };
    });
  }
}
