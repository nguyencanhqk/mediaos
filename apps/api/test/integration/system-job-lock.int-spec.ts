import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { JobLockService } from "../../src/scheduler/job-lock.service";
import { directPool, hasDb, workerPool } from "../helpers/integration-db";

/**
 * RED (crown) — JobLockService single-active tại CẤP job_code trên `system_job_locks` (Postgres THẬT,
 * LANE_DB=mediaos_jobs). Ghi qua mediaos_worker. 2 runner song song cùng job_code ⇒ ĐÚNG 1 chiếm được
 * (RETURNING non-empty), 1 skip (RETURNING rỗng). Release = UPDATE locked_until quá khứ (KHÔNG DELETE —
 * BẤT BIẾN #2): row còn nguyên, lock hết hạn ⇒ acquire lại được.
 */
describe.skipIf(!hasDb)("system_job_locks single-active (JobLockService)", () => {
  const direct = directPool();
  // 2 pool worker riêng (max=1) → 2 kết nối THẬT ⇒ song song thật, DB serialize trên unique(job_code).
  const workerA = workerPool(1);
  const workerB = workerPool(1);
  const locksA = new JobLockService(drizzle(workerA, { schema }));
  const locksB = new JobLockService(drizzle(workerB, { schema }));

  const usedCodes: string[] = [];
  function freshCode(prefix: string): string {
    const code = `${prefix}_${randomUUID().slice(0, 8)}`;
    usedCodes.push(code);
    return code;
  }

  afterEach(async () => {
    if (usedCodes.length > 0) {
      await direct.query("DELETE FROM system_job_locks WHERE job_code = ANY($1)", [usedCodes]);
      usedCodes.length = 0;
    }
  });

  afterAll(async () => {
    await direct.end();
    await workerA.end();
    await workerB.end();
  });

  it("2 acquire song song cùng job_code → ĐÚNG 1 chiếm được, 1 skip", async () => {
    const code = freshCode("LOCK_CONCURRENT");
    const [a, b] = await Promise.all([
      locksA.acquire(code, "runner-A", 60_000),
      locksB.acquire(code, "runner-B", 60_000),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // đúng 1 active
  });

  it("acquire khi lock CÒN hiệu lực → false (skip ở cấp job_code)", async () => {
    const code = freshCode("LOCK_SEQ");
    expect(await locksA.acquire(code, "runner-A", 60_000)).toBe(true);
    expect(await locksB.acquire(code, "runner-B", 60_000)).toBe(false); // còn hiệu lực → skip
  });

  it("release = UPDATE quá khứ (KHÔNG DELETE) → row còn + acquire lại được", async () => {
    const code = freshCode("LOCK_RELEASE");
    expect(await locksA.acquire(code, "runner-A", 60_000)).toBe(true);
    await locksA.release(code);

    // Row VẪN tồn tại (không hard-delete — BẤT BIẾN #2), chỉ locked_until lùi quá khứ.
    const still = await direct.query(
      "SELECT locked_until < now() AS expired FROM system_job_locks WHERE job_code = $1",
      [code],
    );
    expect(still.rows).toHaveLength(1);
    expect(still.rows[0].expired).toBe(true);

    // Lock hết hạn ⇒ instance khác acquire lại được (ON CONFLICT DO UPDATE WHERE locked_until<now()).
    expect(await locksB.acquire(code, "runner-B", 60_000)).toBe(true);
  });

  it("KHÔNG có quyền DELETE trên system_job_locks cho mediaos_worker (append-only)", async () => {
    const { rows } = await direct.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'mediaos_worker' AND table_name = 'system_job_locks'`,
    );
    const privs = rows.map((r) => r.privilege_type as string);
    expect(privs).toContain("INSERT");
    expect(privs).toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });
});
