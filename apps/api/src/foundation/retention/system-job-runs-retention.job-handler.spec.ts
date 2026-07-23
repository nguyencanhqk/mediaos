import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/index";
import {
  DEFAULT_RETENTION_DAYS,
  LMS_RETENTION_DAYS,
  MAX_BATCHES_PER_RUN,
  PURGE_BATCH_SIZE,
  SYSTEM_JOB_RUNS_RETENTION_JOB_CODE,
  SystemJobRunsRetentionJobHandler,
  buildPurgeArgs,
  isRetentionDisabled,
} from "./system-job-runs-retention.job-handler";

/**
 * RED (crown) — SystemJobRunsRetentionJobHandler (S5-SYS-CLEAN-1):
 *  - buildPurgeArgs PIN hợp đồng: handler LUÔN truyền 30/90/5000 (chứng minh wiring — độc lập sàn-cứng-SQL).
 *  - kill-switch: {false,0,off,no,disabled} (trim/lowercase) → dry-run; unset/khác → XOÁ THẬT.
 *  - loop lô: cạn khi lô < batch; capHit khi chạm trần lô với lô cuối đầy.
 *  - fail-closed: workerDb vắng → NÉM trước khi chạm DB.
 *  Predicate SQL (giữ Failed/Partial/Running/global, sàn ngày) được pin ở int-spec trên PG THẬT (§5.2 plan).
 */

const ROLE_ROW = { role: "mediaos_worker", rolsuper: false, rolbypassrls: false };

/**
 * Fake workerDb với thứ tự gọi TẤT ĐỊNH của handler: (1) assertWorkerRoleSafe → role-check;
 * (2) N lần purgeBatch → mỗi lần 1 phần tử `purge`; (3) countGlobalRows → `global`.
 */
function fakeDbw(opts: { purge?: number[]; global?: number } = {}): {
  db: Database;
  execute: ReturnType<typeof vi.fn>;
} {
  const purge = opts.purge ?? [];
  const global = opts.global ?? 0;
  let seenRole = false;
  let purgeIdx = 0;
  const execute = vi.fn(async () => {
    if (!seenRole) {
      seenRole = true;
      return { rows: [ROLE_ROW] };
    }
    if (purgeIdx < purge.length) {
      return { rows: [{ n: purge[purgeIdx++] }] };
    }
    return { rows: [{ n: global }] }; // countGlobalRows (sau vòng purge)
  });
  return { db: { execute } as unknown as Database, execute };
}

describe("buildPurgeArgs (pin hợp đồng 30/90/5000)", () => {
  it("dryRun=false → [id, 30, 90, 5000, false]", () => {
    expect(buildPurgeArgs("co-1", false)).toEqual([
      "co-1",
      DEFAULT_RETENTION_DAYS,
      LMS_RETENTION_DAYS,
      PURGE_BATCH_SIZE,
      false,
    ]);
    // Số cụ thể (chống ai đó đổi hằng số làm LMS tụt <90).
    expect(buildPurgeArgs("co-1", false)).toEqual(["co-1", 30, 90, 5000, false]);
  });

  it("dryRun=true → [id, 30, 90, 5000, true]", () => {
    expect(buildPurgeArgs("co-2", true)).toEqual(["co-2", 30, 90, 5000, true]);
  });
});

describe("isRetentionDisabled (kill-switch OFF-values)", () => {
  it.each(["false", "0", "off", "no", "disabled", "FALSE", " Off ", "No"])(
    "'%s' → TẮT (dry-run)",
    (v) => {
      expect(isRetentionDisabled(v)).toBe(true);
    },
  );

  it.each([undefined, "", "true", "1", "on", "yes", "x"])("'%s' → XOÁ THẬT", (v) => {
    expect(isRetentionDisabled(v)).toBe(false);
  });
});

describe("SystemJobRunsRetentionJobHandler.run", () => {
  const ENV = "SYSTEM_JOB_RUNS_RETENTION_ENABLED";
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV];
    delete process.env[ENV];
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = savedEnv;
    vi.restoreAllMocks();
  });

  it("jobCode đúng", () => {
    expect(new SystemJobRunsRetentionJobHandler(null).jobCode).toBe("SYSTEM_JOB_RUNS_RETENTION");
    expect(SYSTEM_JOB_RUNS_RETENTION_JOB_CODE).toBe("SYSTEM_JOB_RUNS_RETENTION");
  });

  it("fail-closed: workerDb vắng → NÉM trước khi chạm DB", async () => {
    const handler = new SystemJobRunsRetentionJobHandler(null);
    await expect(handler.run({ companyId: "co-1" })).rejects.toThrow(/fail-closed/);
  });

  it("XOÁ THẬT: lô [5000,5000,137] → cạn ở lô <batch, deleted=10137, batches=3, capHit=false", async () => {
    const { db, execute } = fakeDbw({ purge: [5000, 5000, 137], global: 0 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({
      deleted: 10137,
      dryRun: false,
      batches: 3,
      capHit: false,
      globalRowsKept: 0,
    });
    // role-check(1) + 3 purge + 1 global-count = 5 lần execute.
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("cap: mọi lô đầy → dừng ở MAX_BATCHES_PER_RUN, capHit=true (KHÔNG loop vô hạn)", async () => {
    const { db } = fakeDbw({ purge: Array(MAX_BATCHES_PER_RUN).fill(PURGE_BATCH_SIZE), global: 5 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({
      deleted: MAX_BATCHES_PER_RUN * PURGE_BATCH_SIZE,
      batches: MAX_BATCHES_PER_RUN,
      capHit: true,
      dryRun: false,
    });
  });

  it("kill-switch OFF: env='false' → dry-run, deleted=0, dùng eligible, KHÔNG loop xoá", async () => {
    process.env[ENV] = "false";
    const { db, execute } = fakeDbw({ purge: [42], global: 3 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({
      deleted: 0,
      dryRun: true,
      batches: 0,
      eligible: 42,
      globalRowsKept: 3,
    });
    // role-check(1) + 1 purge(dry) + 1 global-count = 3 (KHÔNG loop nhiều lô).
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("globalRowsKept > ngưỡng → logger.warn (không xoá row global)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // purge trả 3 (>0) ⇒ KHÔNG kích silent-0 check; chỉ còn warn do global vượt ngưỡng.
    const { db } = fakeDbw({ purge: [3], global: 2000 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({ deleted: 3, globalRowsKept: 2000 });
    expect(warn).toHaveBeenCalled();
  });

  it("silent-0 self-check: xoá thật deleted=0 nhưng eligible>0 → logger.warn (nghi RLS lọc câm)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // purge real → 0 (câm/cạn); silent-0 dry-check → 7 (eligible>0) ⇒ warn; global → 0 (không warn global).
    const { db, execute } = fakeDbw({ purge: [0, 7], global: 0 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({ deleted: 0, dryRun: false, batches: 1 });
    expect(warn).toHaveBeenCalled();
    // role(1) + purge-real(1) + silent-0 dry(1) + global-count(1) = 4.
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("silent-0 self-check KHÔNG kích khi cạn thật (deleted=0, eligible=0)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // purge real → 0; silent-0 dry-check → 0 (eligible=0 ⇒ cạn thật, KHÔNG warn); global → 0.
    const { db } = fakeDbw({ purge: [0, 0], global: 0 });
    const handler = new SystemJobRunsRetentionJobHandler(db);

    const res = await handler.run({ companyId: "co-1" });

    expect(res.metadata).toMatchObject({ deleted: 0, globalRowsKept: 0 });
    expect(warn).not.toHaveBeenCalled();
  });
});
