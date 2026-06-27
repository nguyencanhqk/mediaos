/**
 * S3-ATT-SEED-1 (PART B) — AttMasterDataSeeder qua ĐƯỜNG THẬT (MasterDataSeedRunner.reconcileCompany).
 *
 * Colocated trong src/attendance → vitest gom qua include glob `src/**\/*.spec.ts`. Gate cứng
 * `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Chạy với app role (mediaos_app, RLS+FORCE) —
 * KHÔNG owner. KHÔNG gọi seed() trực tiếp: đăng ký seeder vào registry rồi gọi runner.reconcileCompany(company).
 *
 * Phủ: G1 — sau reconcile, shift OFFICE_8H (is_default, 08:00–17:00, break 60, grace 5/5, required 480) +
 *   rule DEFAULT_OFFICE_RULE (Company, require_check_out, rule_config block_when_leave_approved +
 *   missing_checkout_policy) ĐÚNG; seed_items track (Success). I2 — chạy lần 2 idempotent: batch reused,
 *   KHÔNG dup shift/rule, markItem Skipped.
 */

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../../test/helpers/seed";
import { MasterDataSeedRunner } from "../foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../foundation/seed/seed-tracking.service";
import {
  ATT_DEFAULT_RULE_CODE,
  ATT_DEFAULT_SHIFT_CODE,
  AttMasterDataSeeder,
} from "./att-master-data.seeder";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const SEED_KEY = "att.master-data";

async function countShift(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM shifts WHERE company_id=$1 AND shift_code=$2 AND deleted_at IS NULL",
    [companyId, ATT_DEFAULT_SHIFT_CODE],
  );
  return r.rows[0].n as number;
}

async function countRule(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM attendance_rules WHERE company_id=$1 AND rule_code=$2 AND deleted_at IS NULL",
    [companyId, ATT_DEFAULT_RULE_CODE],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S3-ATT-SEED-1 AttMasterDataSeeder (DB cô lập, app role)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let runner: MasterDataSeedRunner;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "attseed");

    const dbsvc = new DatabaseService();
    const tracking = new SeedTrackingService(dbsvc);
    const registry = new MasterDataSeederRegistry();
    registry.register(new AttMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, tracking, registry);
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G1 — reconcileCompany seed OFFICE_8H + DEFAULT_OFFICE_RULE đúng (Success)", async () => {
    const outcomes = await runner.reconcileCompany(A.companyId);
    const att = outcomes.find((o) => o.seedKey === SEED_KEY);
    expect(att?.ok, "batch att.master-data phải ok").toBe(true);
    expect(att?.status).toBe("Success");

    // Shift OFFICE_8H ─────────────────────────────────────────────────────────
    const shift = await direct.query<{
      start_time: string;
      end_time: string;
      break_start_time: string;
      break_end_time: string;
      break_minutes: number;
      required_working_minutes: number;
      grace_late_minutes: number;
      grace_early_leave_minutes: number;
      is_default: boolean;
      status: string;
      shift_type: string;
      metadata: { timezone?: string } | null;
    }>(
      `SELECT start_time, end_time, break_start_time, break_end_time, break_minutes,
              required_working_minutes, grace_late_minutes, grace_early_leave_minutes,
              is_default, status, shift_type, metadata
         FROM shifts WHERE company_id=$1 AND shift_code=$2 AND deleted_at IS NULL`,
      [A.companyId, ATT_DEFAULT_SHIFT_CODE],
    );
    expect(shift.rows.length, "đúng 1 shift OFFICE_8H").toBe(1);
    const s = shift.rows[0];
    expect(s.start_time).toBe("08:00:00");
    expect(s.end_time).toBe("17:00:00");
    expect(s.break_start_time).toBe("12:00:00");
    expect(s.break_end_time).toBe("13:00:00");
    expect(s.break_minutes).toBe(60);
    expect(s.required_working_minutes).toBe(480);
    expect(s.grace_late_minutes).toBe(5);
    expect(s.grace_early_leave_minutes).toBe(5);
    expect(s.is_default).toBe(true);
    expect(s.status).toBe("Active");
    expect(s.shift_type).toBe("Fixed");
    expect(s.metadata?.timezone).toBe("Asia/Ho_Chi_Minh");

    // Rule DEFAULT_OFFICE_RULE ──────────────────────────────────────────────────
    const rule = await direct.query<{
      rule_scope: string;
      require_check_in: boolean;
      require_check_out: boolean;
      allow_web_check_in: boolean;
      allow_mobile_check_in: boolean;
      allow_remote_check_in: boolean;
      require_gps: boolean;
      status: string;
      rule_config: { missing_checkout_policy?: string; block_when_leave_approved?: boolean } | null;
    }>(
      `SELECT rule_scope, require_check_in, require_check_out, allow_web_check_in,
              allow_mobile_check_in, allow_remote_check_in, require_gps, status, rule_config
         FROM attendance_rules WHERE company_id=$1 AND rule_code=$2 AND deleted_at IS NULL`,
      [A.companyId, ATT_DEFAULT_RULE_CODE],
    );
    expect(rule.rows.length, "đúng 1 rule DEFAULT_OFFICE_RULE").toBe(1);
    const r = rule.rows[0];
    expect(r.rule_scope).toBe("Company");
    expect(r.require_check_in).toBe(true);
    expect(r.require_check_out).toBe(true);
    expect(r.allow_web_check_in).toBe(true);
    expect(r.allow_mobile_check_in).toBe(true);
    expect(r.allow_remote_check_in).toBe(true);
    expect(r.require_gps).toBe(false);
    expect(r.status).toBe("Active");
    expect(r.rule_config?.missing_checkout_policy).toBe("MarkMissingCheckout");
    expect(r.rule_config?.block_when_leave_approved).toBe(true);

    // track ghi seed_items cho cả shift + rule (qua batch att.master-data)
    const items = await direct.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seed_items si
         JOIN seed_batches sb ON sb.id = si.seed_batch_id
        WHERE sb.company_id=$1 AND sb.seed_key=$2
          AND si.target_table IN ('shifts','attendance_rules') AND si.status='Success'`,
      [A.companyId, SEED_KEY],
    );
    expect(items.rows[0].n, "track ghi 2 item Success (shift + rule)").toBe(2);
  });

  it("I2 — chạy lại idempotent: batch reused, KHÔNG dup shift/rule, markItem Skipped", async () => {
    const beforeBatch = await direct.query<{ id: string }>(
      "SELECT id FROM seed_batches WHERE company_id=$1 AND seed_key=$2 LIMIT 1",
      [A.companyId, SEED_KEY],
    );

    const outcomes = await runner.reconcileCompany(A.companyId);
    expect(outcomes.find((o) => o.seedKey === SEED_KEY)?.ok).toBe(true);

    // Batch reused (cùng id, vẫn 1 row).
    const afterBatch = await direct.query<{ id: string; n: number }>(
      "SELECT id, count(*) OVER ()::int AS n FROM seed_batches WHERE company_id=$1 AND seed_key=$2 LIMIT 1",
      [A.companyId, SEED_KEY],
    );
    expect(afterBatch.rows[0].id).toBe(beforeBatch.rows[0].id);

    // KHÔNG dup domain row.
    expect(await countShift(direct, A.companyId)).toBe(1);
    expect(await countRule(direct, A.companyId)).toBe(1);

    // markItem dedup theo (batchId, targetTable, targetKey): checksum không đổi ⇒ Skip ⇒ KHÔNG ghi
    // item mới. Vẫn ĐÚNG 2 seed_items (shift + rule), KHÔNG nhân đôi (4) ⇒ chứng minh idempotent.
    const items = await direct.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seed_items si
         JOIN seed_batches sb ON sb.id = si.seed_batch_id
        WHERE sb.company_id=$1 AND sb.seed_key=$2
          AND si.target_table IN ('shifts','attendance_rules')`,
      [A.companyId, SEED_KEY],
    );
    expect(
      items.rows[0].n,
      "lần 2: vẫn 2 seed_items (KHÔNG dup) — markItem dedup theo target",
    ).toBe(2);
  });
});
