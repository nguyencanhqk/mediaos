import { UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { ZodValidationException } from "nestjs-zod";
import { describe, expect, it, vi } from "vitest";
import {
  PAYROLL_REPORT_CODES,
  PAYROLL_REPORT_MAX_ROWS,
  type PayrollReportCode,
  type PayrollReportQuery,
} from "@mediaos/contracts";
import { PayrollAccessService } from "./payroll-access.service";
import { shiftMonth } from "./payroll-overview.service";
import { PayrollReportExportService } from "./payroll-report-export.service";
import { PAYROLL_REPORTS, sumColumnsOf } from "./payroll-reports.registry";
import { PayrollReportsService } from "./payroll-reports.service";
import type { PayrollActor, PayrollRequestUser } from "./payroll.types";

/**
 * S15-PAYROLL-BE-5 — nhánh mà int-spec đắt/không chạm được (plan §5 Unit · §0b C10/C11):
 *  1. trần 50.000 ⇒ 422 `031` ĐẾM TRƯỚC — không đọc hàng, không ghi audit (081 VÀ 082, cả nhánh `budget-status`);
 *  2. kiểm tham số bắt buộc ⇒ `ZodValidationException` có `field`; tham số không áp ⇒ bỏ qua;
 *  3. THỨ TỰ + NỘI DUNG lời gọi `resolveActor` (cặp nguồn O-2, `export:payroll` ở 082);
 *  4. `canResolve` = sàn Company, đúng cờ sensitive;
 *  5. quy tắc hàng tổng theo cột (§0b B4).
 */

const USER: PayrollRequestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};

const actorFor = (routeKey: PayrollActor["routeKey"]): PayrollActor => ({
  actorUserId: USER.id,
  companyId: USER.companyId,
  routeKey,
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  canSeeMoney: true,
});

const dbStub = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };

const QUERY: PayrollReportQuery = {
  fromMonth: "2026-01",
  toMonth: "2026-12",
  fiscalYear: 2026,
  page: 1,
  per_page: 20,
};

function build(count: number) {
  const resolveActor = vi.fn(async (_u: PayrollRequestUser, key: PayrollActor["routeKey"]) =>
    actorFor(key),
  );
  const audit = { record: vi.fn(async () => undefined) };
  const repo = {
    countTx: vi.fn(async () => count),
    rowsTx: vi.fn(async () => []),
    totalsTx: vi.fn(async () => ({})),
  };
  const budgets = {
    reportRowsTx: vi.fn(async () => Array.from({ length: count }, () => ({}))),
    yearTotalsTx: vi.fn(async () => ({
      plannedAmount: null,
      actualAmount: "0",
      variance: null,
      usagePct: null,
    })),
  };
  const people = { namesByUserIdsTx: vi.fn(async () => new Map()) };
  const reports = new PayrollReportsService(
    dbStub as never,
    { resolveActor } as never,
    repo as never,
    budgets as never,
    people as never,
    audit as never,
  );
  const exporter = new PayrollReportExportService(
    dbStub as never,
    { resolveActor } as never,
    reports,
    audit as never,
  );
  return { reports, exporter, resolveActor, audit, repo, budgets };
}

describe("S15-PAYROLL-BE-5 · trần 031 (đếm TRƯỚC, 0 audit)", () => {
  it.each([
    ["salary-by-period", PAYROLL_REPORT_MAX_ROWS, false],
    ["salary-by-period", PAYROLL_REPORT_MAX_ROWS + 1, true],
    ["budget-status", PAYROLL_REPORT_MAX_ROWS + 1, true],
  ] as const)("081 %s với %i hàng ⇒ vượt trần: %s", async (code, count, over) => {
    const { reports, audit, repo, budgets } = build(count);
    const run = reports.data(USER, code, QUERY);
    if (!over) {
      await expect(run).resolves.toBeDefined();
      expect(audit.record).toHaveBeenCalledTimes(1);
      return;
    }
    const err = await run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const body = (err as UnprocessableEntityException).getResponse() as {
      code: string;
      details: Array<{ field: string; message: string }>;
    };
    expect(body.code).toBe("PAYROLL-ERR-031");
    expect(body.details.find((d) => d.field === "kind")?.message).toBe("report-too-large");
    expect(repo.rowsTx).not.toHaveBeenCalled();
    expect(repo.totalsTx).not.toHaveBeenCalled();
    expect(budgets.yearTotalsTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("082 vượt trần ⇒ 422 031, 0 audit, không đọc hàng", async () => {
    const { exporter, audit, repo } = build(PAYROLL_REPORT_MAX_ROWS + 1);
    const { page: _p, per_page: _pp, ...exportQuery } = QUERY;
    await expect(exporter.export(USER, "cost-by-org-unit", exportQuery)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.rowsTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("S15-PAYROLL-BE-5 · thứ tự cổng", () => {
  it("081: `reportData` rồi cặp NGUỒN của báo cáo (owner O-2); báo cáo tổng hợp không assert thêm", async () => {
    const expected: Record<PayrollReportCode, string[]> = {
      "employee-income": ["reportData", "payslipList"],
      "salary-by-period": ["reportData"],
      "income-structure": ["reportData"],
      "cost-by-org-unit": ["reportData"],
      "salary-history": ["reportData", "salaryProfileList"],
      "payment-summary": ["reportData", "batchList"],
      "budget-status": ["reportData", "budgetList"],
    };
    for (const code of PAYROLL_REPORT_CODES) {
      const { reports, resolveActor } = build(0);
      await reports.data(USER, code, QUERY);
      expect(
        resolveActor.mock.calls.map((c) => c[1]),
        code,
      ).toEqual(expected[code]);
    }
  });

  it("082: `reportExport` + `periodExport` + cặp nguồn, TRƯỚC khi chạm DB", async () => {
    const { exporter, resolveActor, repo } = build(0);
    const { page: _p, per_page: _pp, ...exportQuery } = QUERY;
    resolveActor.mockImplementation(async (_u, key) => {
      if (key === "payslipList") throw new Error("403 giả lập");
      return actorFor(key);
    });
    await expect(exporter.export(USER, "employee-income", exportQuery)).rejects.toThrow(
      "403 giả lập",
    );
    expect(resolveActor.mock.calls.map((c) => c[1])).toEqual([
      "reportExport",
      "periodExport",
      "payslipList",
    ]);
    expect(repo.countTx).not.toHaveBeenCalled();
  });
});

describe("S15-PAYROLL-BE-5 · checkFilter", () => {
  it("thiếu tham số bắt buộc ⇒ ZodValidationException có đúng field", () => {
    const err = (() => {
      try {
        PayrollReportsService.checkFilter(PAYROLL_REPORTS["budget-status"], {
          page: 1,
          per_page: 20,
        });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ZodValidationException);
    expect(
      (err as ZodValidationException).getZodError().issues.map((i) => i.path.join(".")),
    ).toEqual(["fiscalYear"]);
  });

  it("tham số không áp cho báo cáo ⇒ bỏ qua; tham số áp ⇒ giữ", () => {
    const f = PayrollReportsService.checkFilter(PAYROLL_REPORTS["salary-by-period"], {
      ...QUERY,
      userId: "33333333-3333-4333-8333-333333333333",
      batchStatus: "Draft",
      orgUnitId: "44444444-4444-4444-8444-444444444444",
    });
    expect(f).toEqual({
      fromMonth: "2026-01",
      toMonth: "2026-12",
      orgUnitId: "44444444-4444-4444-8444-444444444444",
    });
  });
});

describe("S15-PAYROLL-BE-5 · registry", () => {
  it("hàng tổng: chỉ cột `sum`; bình quân/min/max/tỉ lệ/phiên bản KHÔNG cộng; budget-status tính riêng", () => {
    expect(sumColumnsOf(PAYROLL_REPORTS["cost-by-org-unit"])).toEqual([
      "totalGross",
      "employerStatutory",
      "totalCost",
      "totalNet",
    ]);
    expect(sumColumnsOf(PAYROLL_REPORTS["salary-history"])).toEqual([]);
    expect(sumColumnsOf(PAYROLL_REPORTS["income-structure"])).toEqual([]);
    expect(sumColumnsOf(PAYROLL_REPORTS["budget-status"])).toEqual([]);
    for (const code of PAYROLL_REPORT_CODES) {
      const def = PAYROLL_REPORTS[code];
      expect(def.code).toBe(code);
      for (const c of def.columns.filter((x) => x.total === "sum")) {
        expect(c.type, `${code}.${c.key}`).toBe("money");
      }
    }
  });
});

describe("S15-PAYROLL-BE-5 · canResolve", () => {
  it.each([
    [null, false],
    ["Own", false],
    ["Department", false],
    ["Company", true],
    ["System", true],
  ] as const)(
    "scope %s ⇒ %s (sàn Company), cờ sensitive truyền tường minh",
    async (scope, want) => {
      const resolveOrNull = vi.fn(async () => scope);
      const access = new PayrollAccessService({ resolveOrNull } as never);
      await expect(access.canResolve(USER, "budgetList")).resolves.toBe(want);
      expect(resolveOrNull).toHaveBeenCalledWith(
        USER.id,
        USER.companyId,
        "view",
        "payroll-budget",
        {
          isSensitive: true,
        },
      );
    },
  );
});

describe("S15-PAYROLL-BE-5 · shiftMonth", () => {
  it.each([
    ["2026-01", -1, "2025-12"],
    ["2026-12", -11, "2026-01"],
    ["2026-03", -12, "2025-03"],
    ["2026-01", -23, "2024-02"],
    ["2026-11", 2, "2027-01"],
  ] as const)("%s %i ⇒ %s", (m, d, want) => {
    expect(shiftMonth(m, d)).toBe(want);
  });
});
