import { describe, expect, it } from "vitest";
// 🔴 RED-first (CLAUDE §6): import từ ./index khi system-jobs.ts CHƯA re-export → ĐỎ đúng lý do
//    (export thiếu) trước khi implement.
import {
  SYSTEM_JOB_RUN_STATUSES,
  SYSTEM_JOB_TRIGGERED_BY,
  systemJobRunsQuerySchema,
  systemJobRunViewSchema,
} from "./index";

describe("S5-FND-JOBS-OBS-1 system-jobs contracts", () => {
  const validRun = {
    id: "11111111-1111-1111-1111-111111111111",
    jobCode: "RETENTION_CLEANUP",
    companyId: "22222222-2222-2222-2222-222222222222",
    status: "Success" as const,
    triggeredBy: "Scheduler" as const,
    startedAt: "2026-07-11T00:00:00.000Z",
    finishedAt: "2026-07-11T00:00:05.000Z",
    durationMs: 5000,
    totalItems: 10,
    successItems: 10,
    failedItems: 0,
    errorMessage: null,
  };

  describe("systemJobRunViewSchema (WHITELIST, KHÔNG metadata)", () => {
    it("parse hàng hợp lệ giữ đúng field whitelist", () => {
      expect(systemJobRunViewSchema.parse(validRun)).toEqual(validRun);
    });

    it("companyId NULL hợp lệ (job cấp system/global)", () => {
      const out = systemJobRunViewSchema.parse({ ...validRun, companyId: null });
      expect(out.companyId).toBeNull();
    });

    it("STRIP field lạ: metadata KHÔNG lọt ra (phòng thủ chiều sâu)", () => {
      const out = systemJobRunViewSchema.parse({
        ...validRun,
        metadata: { secretKey: "s3cr3t" },
      }) as Record<string, unknown>;
      expect(out).not.toHaveProperty("metadata");
    });

    it("REJECT status ngoài CHECK mig 0475", () => {
      expect(() => systemJobRunViewSchema.parse({ ...validRun, status: "Bogus" })).toThrow();
    });

    it("REJECT triggeredBy ngoài CHECK mig 0475", () => {
      expect(() => systemJobRunViewSchema.parse({ ...validRun, triggeredBy: "Bogus" })).toThrow();
    });

    it("SYSTEM_JOB_RUN_STATUSES / SYSTEM_JOB_TRIGGERED_BY khớp CHECK mig 0475", () => {
      expect(SYSTEM_JOB_RUN_STATUSES).toEqual([
        "Running",
        "Success",
        "Failed",
        "Partial",
        "Skipped",
      ]);
      expect(SYSTEM_JOB_TRIGGERED_BY).toEqual(["Scheduler", "User", "System"]);
    });
  });

  describe("systemJobRunsQuerySchema (page-based, clamp chống DoS)", () => {
    it("default page=1 limit=20 khi không truyền", () => {
      expect(systemJobRunsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    });

    it("clamp limit > 100 về 100 (KHÔNG throw — list đọc không nên 400)", () => {
      expect(systemJobRunsQuerySchema.parse({ limit: 999 })).toEqual({ page: 1, limit: 100 });
    });

    it("clamp page < 1 về 1", () => {
      expect(systemJobRunsQuerySchema.parse({ page: -5 })).toEqual({ page: 1, limit: 20 });
    });

    it("input rác (chuỗi không phải số) → fallback default (KHÔNG throw)", () => {
      expect(systemJobRunsQuerySchema.parse({ page: "abc", limit: "xyz" })).toEqual({
        page: 1,
        limit: 20,
      });
    });
  });
});
