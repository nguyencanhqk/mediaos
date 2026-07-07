/**
 * S3-LEAVE-SEED-1 (PART B) + S3-LEAVE-SEED-2 — LeaveMasterDataSeeder qua ĐƯỜNG THẬT
 * (MasterDataSeedRunner.reconcileCompany).
 *
 * Colocated trong src/leave → vitest gom qua include glob `src/**\/*.spec.ts`. Gate cứng
 * `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Chạy với app role (mediaos_app, RLS+FORCE) —
 * KHÔNG owner. KHÔNG gọi seed() trực tiếp: đăng ký seeder vào registry rồi gọi runner.reconcileCompany(company).
 *
 * Phủ: G1 — sau reconcile, 8 loại nghỉ (ANNUAL/SICK/UNPAID/OTHER + MATERNITY/MARRIAGE/BEREAVEMENT/
 *   COMPENSATORY, DB-10 §14.3) + chính sách DEFAULT_ANNUAL (Company, quota 12, leave_type=ANNUAL,
 *   status Active) ĐÚNG; seed_items track (Success). I2 — chạy lần 2 idempotent: batch reused, KHÔNG dup
 *   type/policy, markItem Skipped (9 seed_items = 8 type + 1 policy).
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
  LEAVE_DEFAULT_POLICY_CODE,
  LEAVE_TYPE_ANNUAL_CODE,
  LeaveMasterDataSeeder,
} from "./leave-master-data.seeder";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const SEED_KEY = "leave.master-data";
// 8 loại nghỉ system-default (DB-10 §14.3 — mã NGẮN, code-wins CHỐT 2026-07-04).
const EXPECTED_TYPE_CODES = [
  "ANNUAL",
  "SICK",
  "UNPAID",
  "OTHER",
  "MATERNITY",
  "MARRIAGE",
  "BEREAVEMENT",
  "COMPENSATORY",
];
const EXPECTED_TYPE_COUNT = EXPECTED_TYPE_CODES.length; // 8
const EXPECTED_SEED_ITEM_COUNT = EXPECTED_TYPE_COUNT + 1; // 8 type + 1 policy = 9

async function countTypes(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM leave_types WHERE company_id=$1 AND code = ANY($2) AND deleted_at IS NULL",
    [companyId, EXPECTED_TYPE_CODES],
  );
  return r.rows[0].n as number;
}

async function countPolicy(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM leave_policies WHERE company_id=$1 AND policy_code=$2 AND deleted_at IS NULL",
    [companyId, LEAVE_DEFAULT_POLICY_CODE],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S3-LEAVE-SEED-1/2 LeaveMasterDataSeeder (DB cô lập, app role)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let runner: MasterDataSeedRunner;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "leaveseed");

    const dbsvc = new DatabaseService();
    const tracking = new SeedTrackingService(dbsvc);
    const registry = new MasterDataSeederRegistry();
    registry.register(new LeaveMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, tracking, registry);
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G1 — reconcileCompany seed 8 loại nghỉ + DEFAULT_ANNUAL policy đúng (Success)", async () => {
    const outcomes = await runner.reconcileCompany(A.companyId);
    const leave = outcomes.find((o) => o.seedKey === SEED_KEY);
    expect(leave?.ok, "batch leave.master-data phải ok").toBe(true);
    expect(leave?.status).toBe("Success");

    // 8 loại nghỉ ─────────────────────────────────────────────────────────────────
    const types = await direct.query<{
      code: string;
      name: string;
      paid: boolean;
      deduct_balance: boolean;
      balance_unit: string | null;
      min_notice_days: number | null;
      is_system_default: boolean;
      sort_order: number | null;
      status: string;
      allow_full_day: boolean | null;
      allow_half_day: boolean | null;
      allow_hourly: boolean | null;
      allow_multiple_days: boolean | null;
      require_reason: boolean | null;
      require_attachment: boolean | null;
    }>(
      `SELECT code, name, paid, deduct_balance, balance_unit, min_notice_days, is_system_default,
              sort_order, status, allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
              require_reason, require_attachment
         FROM leave_types WHERE company_id=$1 AND code = ANY($2) AND deleted_at IS NULL
        ORDER BY sort_order`,
      [A.companyId, EXPECTED_TYPE_CODES],
    );
    expect(types.rows.length, "đúng 8 loại nghỉ system-default").toBe(EXPECTED_TYPE_COUNT);
    const byCode = Object.fromEntries(types.rows.map((t) => [t.code, t]));

    // ── 4 loại gốc (SEED-1) — không đổi ──────────────────────────────────────────
    expect(byCode.ANNUAL.name).toBe("Nghỉ phép năm");
    expect(byCode.ANNUAL.paid).toBe(true);
    expect(byCode.ANNUAL.deduct_balance).toBe(true);
    expect(byCode.ANNUAL.balance_unit).toBe("Day");
    expect(byCode.ANNUAL.min_notice_days).toBe(1);
    expect(byCode.ANNUAL.sort_order).toBe(1);
    expect(byCode.ANNUAL.status).toBe("active");
    expect(byCode.ANNUAL.is_system_default).toBe(true);
    // Khoá quyết định: ANNUAL.allow_hourly = false (CHỐT 2026-07-04 code-wins). Nếu owner lật sang
    // true (DB-10 policy allow_hourly=true) thì đây là điểm PHẢI cập nhật đo được — chống lệch âm thầm.
    expect(byCode.ANNUAL.allow_hourly, "CHỐT code-wins: ANNUAL.allow_hourly=false").toBe(false);

    expect(byCode.SICK.name).toBe("Nghỉ ốm");
    expect(byCode.SICK.paid).toBe(true);
    expect(byCode.SICK.deduct_balance).toBe(true);
    expect(byCode.SICK.allow_half_day).toBe(true);
    expect(byCode.SICK.require_reason).toBe(true);
    expect(byCode.SICK.sort_order).toBe(2);

    expect(byCode.UNPAID.name).toBe("Nghỉ không lương");
    expect(byCode.UNPAID.paid).toBe(false);
    expect(byCode.UNPAID.deduct_balance).toBe(false);
    expect(byCode.UNPAID.require_reason).toBe(true);
    expect(byCode.UNPAID.sort_order).toBe(3);

    expect(byCode.OTHER.name).toBe("Nghỉ khác");
    expect(byCode.OTHER.paid).toBe(true);
    expect(byCode.OTHER.deduct_balance).toBe(false);
    expect(byCode.OTHER.sort_order).toBe(4);

    // ── 4 loại mới (SEED-2, DB-10 §14.3) — thuộc tính deduct/paid/attachment CHỐT ─
    // MATERNITY: deduct=false, paid=true, attachment=true.
    expect(byCode.MATERNITY.name).toBe("Nghỉ thai sản");
    expect(byCode.MATERNITY.deduct_balance).toBe(false);
    expect(byCode.MATERNITY.paid).toBe(true);
    expect(byCode.MATERNITY.require_attachment).toBe(true);
    expect(byCode.MATERNITY.is_system_default).toBe(true);
    expect(byCode.MATERNITY.sort_order).toBe(5);

    // MARRIAGE: deduct=false, paid=true, attachment=true.
    expect(byCode.MARRIAGE.name).toBe("Nghỉ kết hôn");
    expect(byCode.MARRIAGE.deduct_balance).toBe(false);
    expect(byCode.MARRIAGE.paid).toBe(true);
    expect(byCode.MARRIAGE.require_attachment).toBe(true);
    expect(byCode.MARRIAGE.is_system_default).toBe(true);
    expect(byCode.MARRIAGE.sort_order).toBe(6);

    // BEREAVEMENT: deduct=false, paid=true, attachment=false.
    expect(byCode.BEREAVEMENT.name).toBe("Nghỉ tang");
    expect(byCode.BEREAVEMENT.deduct_balance).toBe(false);
    expect(byCode.BEREAVEMENT.paid).toBe(true);
    expect(byCode.BEREAVEMENT.require_attachment).toBe(false);
    expect(byCode.BEREAVEMENT.is_system_default).toBe(true);
    expect(byCode.BEREAVEMENT.sort_order).toBe(7);

    // COMPENSATORY: deduct=true, paid=true, attachment=false.
    expect(byCode.COMPENSATORY.name).toBe("Nghỉ bù");
    expect(byCode.COMPENSATORY.deduct_balance).toBe(true);
    expect(byCode.COMPENSATORY.paid).toBe(true);
    expect(byCode.COMPENSATORY.require_attachment).toBe(false);
    expect(byCode.COMPENSATORY.is_system_default).toBe(true);
    expect(byCode.COMPENSATORY.sort_order).toBe(8);

    // Chính sách DEFAULT_ANNUAL ──────────────────────────────────────────────────
    // KHÔNG thêm default policy cho loại mới (DB-10 chỉ yêu cầu DEFAULT_ANNUAL).
    const policy = await direct.query<{
      policy_scope: string;
      leave_type_id: string;
      yearly_quota_days: string | null;
      effective_from: string;
      status: string;
      requires_manager_approval: boolean;
      requires_hr_approval: boolean;
      reserve_balance_on_pending: boolean;
      allow_negative_balance: boolean;
      department_id: string | null;
      employee_id: string | null;
    }>(
      `SELECT policy_scope, leave_type_id, yearly_quota_days, effective_from, status,
              requires_manager_approval, requires_hr_approval, reserve_balance_on_pending,
              allow_negative_balance, department_id, employee_id
         FROM leave_policies WHERE company_id=$1 AND policy_code=$2 AND deleted_at IS NULL`,
      [A.companyId, LEAVE_DEFAULT_POLICY_CODE],
    );
    expect(policy.rows.length, "đúng 1 chính sách DEFAULT_ANNUAL").toBe(1);
    const p = policy.rows[0];
    expect(p.policy_scope).toBe("Company");
    expect(Number(p.yearly_quota_days)).toBe(12);
    expect(p.status).toBe("Active");
    expect(p.requires_manager_approval).toBe(true);
    expect(p.requires_hr_approval).toBe(false);
    expect(p.reserve_balance_on_pending).toBe(true);
    expect(p.allow_negative_balance).toBe(false);
    // policy_scope='Company' ⇒ chk_leave_policies_target ép các target NULL.
    expect(p.department_id).toBeNull();
    expect(p.employee_id).toBeNull();

    // leave_type_id phải trỏ đúng ANNUAL id.
    const annual = await direct.query<{ id: string }>(
      "SELECT id FROM leave_types WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL",
      [A.companyId, LEAVE_TYPE_ANNUAL_CODE],
    );
    expect(p.leave_type_id).toBe(annual.rows[0].id);

    // track ghi seed_items cho 8 type + 1 policy (qua batch leave.master-data)
    const items = await direct.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seed_items si
         JOIN seed_batches sb ON sb.id = si.seed_batch_id
        WHERE sb.company_id=$1 AND sb.seed_key=$2
          AND si.target_table IN ('leave_types','leave_policies') AND si.status='Success'`,
      [A.companyId, SEED_KEY],
    );
    expect(items.rows[0].n, "track ghi 9 item Success (8 type + 1 policy)").toBe(
      EXPECTED_SEED_ITEM_COUNT,
    );
  });

  it("I2 — chạy lại idempotent: batch reused, KHÔNG dup type/policy, markItem Skipped", async () => {
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
    expect(await countTypes(direct, A.companyId)).toBe(EXPECTED_TYPE_COUNT);
    expect(await countPolicy(direct, A.companyId)).toBe(1);

    // markItem dedup theo (batchId, targetTable, targetKey): checksum không đổi ⇒ Skip ⇒ KHÔNG ghi
    // item mới. Vẫn ĐÚNG 9 seed_items (8 type + 1 policy), KHÔNG nhân đôi (18) ⇒ chứng minh idempotent.
    const items = await direct.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM seed_items si
         JOIN seed_batches sb ON sb.id = si.seed_batch_id
        WHERE sb.company_id=$1 AND sb.seed_key=$2
          AND si.target_table IN ('leave_types','leave_policies')`,
      [A.companyId, SEED_KEY],
    );
    expect(
      items.rows[0].n,
      "lần 2: vẫn 9 seed_items (KHÔNG dup) — markItem dedup theo target",
    ).toBe(EXPECTED_SEED_ITEM_COUNT);
  });
});
