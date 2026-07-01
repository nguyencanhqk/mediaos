import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionCleanupJob } from "./retention-cleanup.job";
import type { CleanupResult, RetentionPolicyRow } from "./retention.types";

/**
 * FOUNDATION-BE-8 — RetentionCleanupJob skeleton unit.
 *  - run lặp các policy enabled, gọi RetentionService.runCleanup, ghi SYSTEM LOG (NestJS Logger).
 *  - dryRun mặc định true (an toàn — KHÔNG xoá thật nếu không truyền dryRun:false).
 *  - log KHÔNG chứa secret (chỉ policyId/eligible/deleted/dryRun).
 *  - KHÔNG insert audit_logs (object_type retention/cleanup chưa có trong CHECK union).
 */

const COMPANY = "22222222-2222-2222-2222-222222222222";

function makePolicy(over: Partial<RetentionPolicyRow> = {}): RetentionPolicyRow {
  return {
    id: "p1",
    companyId: COMPANY,
    moduleCode: "AUTH",
    entityType: "refresh_tokens",
    retentionDays: 30,
    cleanupAction: "Delete",
    archiveAfterDays: null,
    deleteAfterDays: null,
    isLegalHoldSupported: false,
    isEnabled: true,
    description: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...over,
  };
}

function makeResult(over: Partial<CleanupResult> = {}): CleanupResult {
  return {
    policyId: "p1",
    eligibleRecords: 3,
    deletedRecords: 0,
    cutoffTime: new Date(),
    dryRun: true,
    skippedDisabled: false,
    ...over,
  };
}

describe("RetentionCleanupJob", () => {
  let retention: {
    listEnabledPolicies: ReturnType<typeof vi.fn>;
    runCleanup: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    retention = {
      listEnabledPolicies: vi.fn(async () => [makePolicy(), makePolicy({ id: "p2" })]),
      runCleanup: vi.fn(async () => makeResult()),
    };
  });

  it("dryRun mặc định true — runCleanup nhận dryRun:true", async () => {
    const job = new RetentionCleanupJob(retention as never);
    await job.run(COMPANY);
    expect(retention.runCleanup).toHaveBeenCalledTimes(2);
    for (const call of retention.runCleanup.mock.calls) {
      expect(call[2]).toMatchObject({ dryRun: true });
    }
  });

  it("dryRun:false được truyền xuống runCleanup (chạy thật)", async () => {
    retention.runCleanup.mockResolvedValue(makeResult({ dryRun: false, deletedRecords: 3 }));
    const job = new RetentionCleanupJob(retention as never);
    const res = await job.run(COMPANY, { dryRun: false });
    expect(res.policiesProcessed).toBe(2);
    for (const call of retention.runCleanup.mock.calls) {
      expect(call[2]).toMatchObject({ dryRun: false });
    }
  });

  it("tổng hợp deletedRecords từ các policy", async () => {
    retention.runCleanup
      .mockResolvedValueOnce(makeResult({ deletedRecords: 2, dryRun: false }))
      .mockResolvedValueOnce(makeResult({ id: "p2", deletedRecords: 5, dryRun: false } as never));
    const job = new RetentionCleanupJob(retention as never);
    const res = await job.run(COMPANY, { dryRun: false });
    expect(res.totalDeleted).toBe(7);
  });

  it("KHÔNG có policy enabled ⇒ no-op, policiesProcessed=0", async () => {
    retention.listEnabledPolicies.mockResolvedValue([]);
    const job = new RetentionCleanupJob(retention as never);
    const res = await job.run(COMPANY);
    expect(res.policiesProcessed).toBe(0);
    expect(retention.runCleanup).not.toHaveBeenCalled();
  });
});
