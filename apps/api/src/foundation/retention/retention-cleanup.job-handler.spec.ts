import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionCleanupJob } from "./retention-cleanup.job";
import {
  RETENTION_CLEANUP_JOB_CODE,
  RetentionCleanupJobHandler,
} from "./retention-cleanup.job-handler";
import { RetentionService } from "./retention.service";
import type { CleanupResult, RetentionPolicyRow } from "./retention.types";

/**
 * S2-FND-JOBS-1 (jobs_retention · crown) — RetentionCleanupJobHandler unit (RED-trước).
 *
 * Handler bọc RetentionCleanupJob hiện có thành JobHandler (scheduler contract). Bất biến chốt:
 *  - dryRun MẶC ĐỊNH true (§17.4) — chỉ XÓA THẬT khi kill-switch env RETENTION_JOB_ENABLED='true'.
 *  - PROTECTED_TABLES (audit_logs/file_access_logs …) → deletedRecords=0 kể cả kill-switch bật (BẤT BIẾN #2,
 *    ép ở RetentionService.runCleanup + REVOKE-DELETE DB — handler KHÔNG được nới).
 *  - companyId truyền TƯỜNG MINH mỗi lần; map JobRunResult → {total,success,failed,metadata}.
 *  - Handler KHÔNG catch: lỗi job.run propagate cho JobRunner finalize 'Failed' (finish-once).
 */

const COMPANY_A = "11111111-1111-1111-1111-111111111111";

interface JobResultShape {
  companyId: string;
  policiesProcessed: number;
  totalDeleted: number;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
}

function makeJobResult(over: Partial<JobResultShape> = {}): JobResultShape {
  const now = new Date("2026-07-04T00:00:00.000Z");
  return {
    companyId: COMPANY_A,
    policiesProcessed: 2,
    totalDeleted: 0,
    dryRun: true,
    startedAt: now,
    finishedAt: now,
    ...over,
  };
}

function makePolicy(over: Partial<RetentionPolicyRow> = {}): RetentionPolicyRow {
  return {
    id: "p1",
    companyId: COMPANY_A,
    moduleCode: "FOUNDATION",
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

function makeCleanupResult(over: Partial<CleanupResult> = {}): CleanupResult {
  return {
    policyId: "p1",
    eligibleRecords: 3,
    deletedRecords: 0,
    cutoffTime: new Date("2026-06-01T00:00:00.000Z"),
    dryRun: true,
    skippedDisabled: false,
    ...over,
  };
}

/** Fake RetentionCleanupJob với `run` mock — cô lập handler khỏi DB/service thật. */
function fakeJob(run: ReturnType<typeof vi.fn>): RetentionCleanupJob {
  return { run } as unknown as RetentionCleanupJob;
}

describe("RetentionCleanupJobHandler", () => {
  const ENV_KEY = "RETENTION_JOB_ENABLED";
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    vi.restoreAllMocks();
  });

  it("jobCode = RETENTION_CLEANUP (khoá system_job_locks + system_job_runs.job_code)", () => {
    const handler = new RetentionCleanupJobHandler(fakeJob(vi.fn()));
    expect(handler.jobCode).toBe(RETENTION_CLEANUP_JOB_CODE);
    expect(handler.jobCode).toBe("RETENTION_CLEANUP");
  });

  it("dryRun MẶC ĐỊNH true khi kill-switch env vắng (§17.4 safety)", async () => {
    const run = vi.fn(async () => makeJobResult({ dryRun: true }));
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    await handler.run({ companyId: COMPANY_A });

    expect(run).toHaveBeenCalledWith(COMPANY_A, { dryRun: true });
  });

  it("kill-switch RETENTION_JOB_ENABLED='true' → chạy thật (dryRun=false)", async () => {
    process.env[ENV_KEY] = "true";
    const run = vi.fn(async () => makeJobResult({ dryRun: false, totalDeleted: 5 }));
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    await handler.run({ companyId: COMPANY_A });

    expect(run).toHaveBeenCalledWith(COMPANY_A, { dryRun: false });
  });

  it("env khác 'true' (vd '1'/'yes') vẫn giữ dryRun=true (fail-safe, chỉ 'true' mới xóa)", async () => {
    process.env[ENV_KEY] = "1";
    const run = vi.fn(async () => makeJobResult());
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    await handler.run({ companyId: COMPANY_A });

    expect(run).toHaveBeenCalledWith(COMPANY_A, { dryRun: true });
  });

  it("map JobRunResult → {total,success,failed,metadata:{policiesProcessed,totalDeleted,dryRun}}", async () => {
    const run = vi.fn(async () =>
      makeJobResult({ policiesProcessed: 4, totalDeleted: 12, dryRun: false }),
    );
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    const res = await handler.run({ companyId: COMPANY_A });

    expect(res).toEqual({
      total: 4,
      success: 4,
      failed: 0,
      metadata: { policiesProcessed: 4, totalDeleted: 12, dryRun: false },
    });
  });

  it("PROTECTED_TABLES (audit_logs/file_access_logs) → deletedRecords=0 KỂ CẢ kill-switch bật (BẤT BIẾN #2)", async () => {
    process.env[ENV_KEY] = "true"; // chạy thật — chứng minh protected vẫn 0
    const policies: RetentionPolicyRow[] = [
      makePolicy({ id: "p-audit", entityType: "audit_logs" }),
      makePolicy({ id: "p-fal", entityType: "file_access_logs" }),
    ];
    const byId = new Map(policies.map((p) => [p.id, p]));
    // Fake RetentionService trung thành BẤT BIẾN #2: bảng protected → deletedRecords=0 dù !dryRun.
    const fakeRetention = {
      listEnabledPolicies: vi.fn(async () => policies),
      runCleanup: vi.fn(
        async (
          _companyId: string,
          policyId: string,
          opts: { dryRun?: boolean },
        ): Promise<CleanupResult> => {
          const entity = byId.get(policyId)!.entityType;
          const isProtected = RetentionService.isProtectedTable(entity);
          return makeCleanupResult({
            policyId,
            deletedRecords: isProtected ? 0 : opts.dryRun ? 0 : 9,
            dryRun: Boolean(opts.dryRun),
          });
        },
      ),
    };
    const job = new RetentionCleanupJob(fakeRetention as never);
    const handler = new RetentionCleanupJobHandler(job);

    const res = await handler.run({ companyId: COMPANY_A });

    expect(res.metadata).toMatchObject({ totalDeleted: 0, policiesProcessed: 2 });
    // Đảm bảo test có ý nghĩa: hai bảng ĐÚNG là protected (nếu tuột set → deletedRecords>0 → FAIL).
    expect(RetentionService.isProtectedTable("audit_logs")).toBe(true);
    expect(RetentionService.isProtectedTable("file_access_logs")).toBe(true);
  });

  it("chạy per-tenant — companyId truyền TƯỜNG MINH mỗi lần (không rò chéo tenant)", async () => {
    const run = vi.fn(async (companyId: string) =>
      makeJobResult({ companyId, policiesProcessed: 1 }),
    );
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    await handler.run({ companyId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    await handler.run({ companyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });

    expect(run).toHaveBeenNthCalledWith(1, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
      dryRun: true,
    });
    expect(run).toHaveBeenNthCalledWith(2, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", {
      dryRun: true,
    });
  });

  it("lỗi job.run PROPAGATE (handler KHÔNG catch — JobRunner finalize 'Failed')", async () => {
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const handler = new RetentionCleanupJobHandler(fakeJob(run));

    await expect(handler.run({ companyId: COMPANY_A })).rejects.toThrow("boom");
  });
});
