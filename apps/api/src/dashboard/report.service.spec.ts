import { describe, it, expect, vi } from "vitest";
import { ReportService } from "./report.service";

const ACTOR = { id: "user-1", companyId: "co-1" };

const ALL_PERMS = {
  canReadFinanceReport: true,
  canReadEmployeeReport: true,
  canReadAttendanceReport: true,
};

const NO_PERMS = {
  canReadFinanceReport: false,
  canReadEmployeeReport: false,
  canReadAttendanceReport: false,
};

const makeDb = (resolver?: (callIdx: number) => unknown) => {
  let callIdx = 0;
  return {
    withTenant: vi.fn((_cid: string, fn: (tx: unknown) => unknown) => {
      void fn;
      const result = resolver ? resolver(callIdx++) : [];
      return Promise.resolve(result);
    }),
  };
};

describe("ReportService", () => {
  describe("getReport — server-side masking (DENY path)", () => {
    it("returns all null fields when caller has no permissions", async () => {
      const db = makeDb() as unknown as ConstructorParameters<typeof ReportService>[0];
      const svc = new ReportService(db);

      const result = await svc.getReport(ACTOR, NO_PERMS);

      expect(result.revenueThisMonth).toBeNull();
      expect(result.costThisMonth).toBeNull();
      expect(result.profitThisMonth).toBeNull();
      expect(result.revenueByChannel).toBeNull();
      expect(result.totalEmployees).toBeNull();
      expect(result.todayAttendanceRate).toBeNull();
    });

    it("does not call DB when all perms are denied (no DB leakage for low-privilege roles)", async () => {
      const withTenantSpy = vi.fn().mockResolvedValue([]);
      const db = { withTenant: withTenantSpy } as unknown as ConstructorParameters<
        typeof ReportService
      >[0];
      const svc = new ReportService(db);

      await svc.getReport(ACTOR, NO_PERMS);

      expect(withTenantSpy).not.toHaveBeenCalled();
    });

    it("returns null finance fields for roles without read:finance_report", async () => {
      const db = makeDb() as unknown as ConstructorParameters<typeof ReportService>[0];
      const svc = new ReportService(db);

      const result = await svc.getReport(ACTOR, {
        ...NO_PERMS,
        canReadEmployeeReport: true,
      });

      expect(result.revenueThisMonth).toBeNull();
      expect(result.costThisMonth).toBeNull();
      expect(result.profitThisMonth).toBeNull();
      expect(result.revenueByChannel).toBeNull();
      // employee field visible
      expect(result.totalEmployees).toBe(0);
    });

    it("returns null totalEmployees for roles without read:employee_report", async () => {
      const db = makeDb() as unknown as ConstructorParameters<typeof ReportService>[0];
      const svc = new ReportService(db);

      const result = await svc.getReport(ACTOR, {
        ...NO_PERMS,
        canReadFinanceReport: true,
      });

      expect(result.totalEmployees).toBeNull();
    });

    it("returns null attendanceRate for roles without read:attendance_report", async () => {
      const db = makeDb() as unknown as ConstructorParameters<typeof ReportService>[0];
      const svc = new ReportService(db);

      // canReadAttendanceReport=false → service short-circuits, never hits DB
      const result = await svc.getReport(ACTOR, {
        ...NO_PERMS,
        canReadAttendanceReport: false,
      });

      expect(result.todayAttendanceRate).toBeNull();
    });
  });

  describe("getReport — finance calculations", () => {
    it("computes profit as revenue minus cost", async () => {
      // calls: revenue sum, cost sum, revenueByChannel, employee count, attendance present, attendance total
      const responses: unknown[] = [
        [{ total: "500000" }], // revenue
        [{ total: "200000" }], // cost
        [],                    // revenueByChannel
        [{ cnt: 50 }],         // employee count (employee report)
        [{ cnt: 40 }],         // present today (attendance report)
        [{ cnt: 50 }],         // total employees for rate
      ];
      let i = 0;
      const db = {
        withTenant: vi.fn((_cid: string, fn: (tx: unknown) => unknown) => {
          void fn;
          return Promise.resolve(responses[i++] ?? []);
        }),
      } as unknown as ConstructorParameters<typeof ReportService>[0];

      const svc = new ReportService(db);
      const result = await svc.getReport(ACTOR, ALL_PERMS);

      expect(result.revenueThisMonth).toBe(500000);
      expect(result.costThisMonth).toBe(200000);
      expect(result.profitThisMonth).toBe(300000);
    });

    it("maps revenueByChannel correctly", async () => {
      const responses: unknown[] = [
        [{ total: "100000" }],
        [{ total: "50000" }],
        [
          { channelId: "ch-1", channelName: "Kênh A", total: "70000" },
          { channelId: "ch-2", channelName: "Kênh B", total: "30000" },
        ],
        [{ cnt: 10 }],
        [{ cnt: 8 }],
        [{ cnt: 10 }],
      ];
      let i = 0;
      const db = {
        withTenant: vi.fn((_cid: string, _fn: unknown) => Promise.resolve(responses[i++] ?? [])),
      } as unknown as ConstructorParameters<typeof ReportService>[0];

      const svc = new ReportService(db);
      const result = await svc.getReport(ACTOR, ALL_PERMS);

      expect(result.revenueByChannel).toHaveLength(2);
      expect(result.revenueByChannel![0]).toEqual({
        channelId: "ch-1",
        channelName: "Kênh A",
        amount: 70000,
      });
    });

    it("filters out null channelId rows from revenueByChannel", async () => {
      const responses: unknown[] = [
        [{ total: "100000" }],
        [{ total: "0" }],
        [
          { channelId: null, channelName: null, total: "100000" },
        ],
        [{ cnt: 5 }],
        [{ cnt: 4 }],
        [{ cnt: 5 }],
      ];
      let i = 0;
      const db = {
        withTenant: vi.fn((_cid: string, _fn: unknown) => Promise.resolve(responses[i++] ?? [])),
      } as unknown as ConstructorParameters<typeof ReportService>[0];

      const svc = new ReportService(db);
      const result = await svc.getReport(ACTOR, ALL_PERMS);

      expect(result.revenueByChannel).toHaveLength(0);
    });
  });

  describe("getReport — attendance rate calculation", () => {
    it("computes attendance rate correctly", async () => {
      const responses: unknown[] = [
        [{ total: "0" }],
        [{ total: "0" }],
        [],
        [{ cnt: 100 }],
        [{ cnt: 80 }],
        [{ cnt: 100 }],
      ];
      let i = 0;
      const db = {
        withTenant: vi.fn((_cid: string, _fn: unknown) => Promise.resolve(responses[i++] ?? [])),
      } as unknown as ConstructorParameters<typeof ReportService>[0];

      const svc = new ReportService(db);
      const result = await svc.getReport(ACTOR, ALL_PERMS);

      expect(result.todayAttendanceRate).toBe(80);
    });

    it("returns 0 rate when no employees exist (avoids division by zero)", async () => {
      const responses: unknown[] = [
        [{ total: "0" }],
        [{ total: "0" }],
        [],
        [{ cnt: 0 }],
        [{ cnt: 0 }],
        [{ cnt: 0 }],
      ];
      let i = 0;
      const db = {
        withTenant: vi.fn((_cid: string, _fn: unknown) => Promise.resolve(responses[i++] ?? [])),
      } as unknown as ConstructorParameters<typeof ReportService>[0];

      const svc = new ReportService(db);
      const result = await svc.getReport(ACTOR, ALL_PERMS);

      expect(result.todayAttendanceRate).toBe(0);
    });
  });
});
