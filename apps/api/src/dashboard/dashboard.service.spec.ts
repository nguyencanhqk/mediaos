import { describe, it, expect, beforeEach, vi } from "vitest";
import { DashboardService } from "./dashboard.service";

// ─── Minimal DatabaseService stub ────────────────────────────────────────────
const makeDb = (rows: Record<string, unknown[]>) => ({
  withTenant: vi.fn((_cid: string, fn: (tx: unknown) => unknown) => {
    // Return the rows configured per test — fn is never really called in unit tests.
    // We intercept at the withTenant boundary.
    void fn;
    return Promise.resolve(rows["default"] ?? []);
  }),
});

const ACTOR = { id: "user-1", companyId: "co-1" };

const FULL_PERMS = {
  canReadTask: true,
  canReadAttendance: true,
  canReadLeave: true,
  isPrivilegedAttendance: true,
};

const NO_PERMS = {
  canReadTask: false,
  canReadAttendance: false,
  canReadLeave: false,
  isPrivilegedAttendance: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DashboardService", () => {
  describe("getSummary — permission masking", () => {
    it("returns null attendance/leave fields when caller lacks read perms (DENY path)", async () => {
      // DB returns empty arrays — will never be reached for denied sections.
      const db = makeDb({ default: [] }) as unknown as ConstructorParameters<
        typeof DashboardService
      >[0];
      const svc = new DashboardService(db);

      const result = await svc.getSummary(ACTOR, NO_PERMS);

      // Attendance — all null (caller denied)
      expect(result.attendance.todayPresent).toBeNull();
      expect(result.attendance.todayAbsent).toBeNull();
      expect(result.attendance.todayLate).toBeNull();
      expect(result.attendance.monthAttendanceDays).toBeNull();

      // Leave — all null (caller denied)
      expect(result.leave.pendingRequests).toBeNull();
      expect(result.leave.approvedThisMonth).toBeNull();

      // Tasks — visible even without read:task (own tasks scope)
      expect(result.tasks.byStatus).toBeUndefined();
    });

    it("does not expose byStatus breakdown without read:task (employee scope)", async () => {
      const db = makeDb({ default: [] }) as unknown as ConstructorParameters<
        typeof DashboardService
      >[0];
      const svc = new DashboardService(db);

      const result = await svc.getSummary(ACTOR, { ...NO_PERMS, canReadTask: false });

      expect(result.tasks.byStatus).toBeUndefined();
    });

    it("exposes byStatus when caller has read:task (manager scope)", async () => {
      // Simulate DB returning status rows for tasks query + empty overdue.
      let callCount = 0;
      const dbWithRows = {
        withTenant: vi.fn((_cid: string, fn: (tx: unknown) => unknown) => {
          callCount++;
          // First two calls = task byStatus rows + overdue count.
          if (callCount === 1) {
            return Promise.resolve([
              { status: "in_progress", cnt: 3 },
              { status: "completed", cnt: 5 },
            ]);
          }
          if (callCount === 2) {
            return Promise.resolve([{ cnt: 1 }]);
          }
          // Remaining calls = attendance/leave (denied → short-circuit, won't reach DB)
          return Promise.resolve([]);
        }),
      } as unknown as ConstructorParameters<typeof DashboardService>[0];

      const svc = new DashboardService(dbWithRows);
      const result = await svc.getSummary(ACTOR, {
        ...NO_PERMS,
        canReadTask: true,
      });

      expect(result.tasks.byStatus).toBeDefined();
      expect(result.tasks.inProgress).toBe(3);
      expect(result.tasks.completed).toBe(5);
      expect(result.tasks.overdue).toBe(1);
    });

    it("includes asOf timestamp in ISO format", async () => {
      const db = makeDb({ default: [] }) as unknown as ConstructorParameters<
        typeof DashboardService
      >[0];
      const svc = new DashboardService(db);
      const result = await svc.getSummary(ACTOR, NO_PERMS);

      expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("getSummary — attendance privilege", () => {
    it("hits DB for attendance when canReadAttendance is true", async () => {
      const withTenantSpy = vi.fn().mockResolvedValue([]);
      const db = { withTenant: withTenantSpy } as unknown as ConstructorParameters<
        typeof DashboardService
      >[0];
      const svc = new DashboardService(db);

      await svc.getSummary(ACTOR, FULL_PERMS);

      // withTenant should be called (tasks×2 + attendance×2 + leave×2 = 6 times)
      expect(withTenantSpy).toHaveBeenCalledTimes(6);
    });

    it("skips DB calls for attendance/leave when both perms are false", async () => {
      const withTenantSpy = vi.fn().mockResolvedValue([]);
      const db = { withTenant: withTenantSpy } as unknown as ConstructorParameters<
        typeof DashboardService
      >[0];
      const svc = new DashboardService(db);

      await svc.getSummary(ACTOR, NO_PERMS);

      // Only tasks calls happen (×2); attendance/leave are short-circuited
      expect(withTenantSpy).toHaveBeenCalledTimes(2);
    });
  });
});
