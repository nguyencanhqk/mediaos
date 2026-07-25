/**
 * S5-SEQ-HARDEN-1 — bằng chứng LANE_DB (Postgres thật, KHÔNG mock) rằng ensure-on-miss ĐỒNG THỜI (race
 * 23505) KHÔNG còn trả 500/25P02.
 *
 * TRƯỚC fix: SequenceRepository.ensureCounterTx bắt 23505 (unique_violation) rồi re-SELECT trên CÙNG tx —
 * nhưng Postgres đã ABORT transaction khi INSERT nổ ⇒ mọi lệnh sau ném 25P02 "current transaction is
 * aborted". Recovery graceful KHÔNG chạy được ⇒ request THUA cuộc race ĐỎ 500. Đây là lỗi runtime thật:
 * PR HRCODE-1 nâng số caller ensure-on-miss từ 1 → 3 (task_code cho POST /tasks + đơn điều chỉnh công) ⇒
 * blast radius rộng, dễ trúng ở 2 request đầu tiên của một company mới.
 *
 * SAU fix: INSERT bọc trong SAVEPOINT (nested tx.transaction) ⇒ 23505 chỉ ROLLBACK TO SAVEPOINT, tx CHA
 * còn sống ⇒ re-SELECT thấy row của request thắng. N request đồng thời cho company CHƯA có counter ⇒ TẤT CẢ
 * trả cùng 1 counter, KHÔNG throw, đúng 1 row trong DB (idempotent).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate) — RLS/race chỉ kiểm chứng trên
 * Postgres thật. Wire service trực tiếp (mirror sequence-concurrent.int-spec.ts): db module-level đọc
 * DATABASE_URL đã resolve sang lane DB; DatabaseService + SequenceRepository + AuditService stateless.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SequenceRepository } from "../../src/foundation/sequences/sequence.repository";
import { SequenceService } from "../../src/foundation/sequences/sequence.service";
import type {
  EnsureSequenceCounterInput,
  SequenceCounterKey,
} from "../../src/foundation/sequences/sequence.types";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "S5-SEQ-HARDEN-1 — ensure-on-miss race (SAVEPOINT recovery, KHÔNG 25P02/500)",
  () => {
    const direct = directPool();
    const companyIds: string[] = [];
    let dbSvc: DatabaseService;
    let svc: SequenceService;

    beforeAll(() => {
      dbSvc = new DatabaseService();
      svc = new SequenceService(dbSvc, new SequenceRepository(), new AuditService());
    });

    afterAll(async () => {
      if (companyIds.length) await cleanupTenants(direct, companyIds);
      await direct.end();
    });

    it("N ensureCounterTx đồng thời cho company CHƯA có counter → tất cả cùng 1 counter, KHÔNG throw", async () => {
      const tenant = await seedCompany(direct, "seq-race");
      companyIds.push(tenant.companyId);

      const key: SequenceCounterKey = { sequenceKey: `RACE_${Date.now()}` };
      const defaults: EnsureSequenceCounterInput = {
        ...key,
        moduleCode: "TASK",
        prefix: "TASK-",
        paddingLength: 4,
        resetPolicy: "Never",
        status: "Active",
      };

      // N tx độc lập cùng miss counter → cùng INSERT → 1 thắng, N-1 nhận 23505. Trước fix: N-1 request ném
      // 25P02 ⇒ Promise.all REJECT (RED). Sau fix: tất cả recover qua SAVEPOINT + re-SELECT (GREEN).
      const CONCURRENCY = 8;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          dbSvc.withTenant(tenant.companyId, (tx) =>
            svc.ensureCounterTx(tx, tenant.companyId, key, defaults),
          ),
        ),
      );

      // Idempotent: mọi request trỏ về CÙNG 1 counter (race → SELECT lại thấy row thắng).
      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(1);

      // Đúng 1 row THẬT trong DB — race KHÔNG tạo bản trùng.
      const rows = await direct.query(
        `SELECT id FROM sequence_counters
         WHERE company_id = $1 AND sequence_key = $2 AND deleted_at IS NULL`,
        [tenant.companyId, key.sequenceKey],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].id).toBe([...ids][0]);
    }, 30_000);

    it("counter ĐÃ tồn tại (Inactive) → ensureCounterTx trả nguyên vẹn, KHÔNG bật lại/không tạo trùng", async () => {
      const tenant = await seedCompany(direct, "seq-race-exist");
      companyIds.push(tenant.companyId);

      const key: SequenceCounterKey = { sequenceKey: `EXIST_${Date.now()}` };
      // Seed sẵn 1 counter Inactive qua direct (superuser).
      await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
            increment_by, reset_policy, current_value, status)
         VALUES ($1, 'TASK', $2, 'Company', 'TASK-', 4, 1, 'Never', 7, 'Inactive')`,
        [tenant.companyId, key.sequenceKey],
      );

      const defaults: EnsureSequenceCounterInput = {
        ...key,
        moduleCode: "TASK",
        prefix: "TASK-",
        paddingLength: 4,
        resetPolicy: "Never",
        status: "Active", // KHÔNG được ghi đè: row tồn tại phải giữ Inactive + current_value=7.
      };

      const row = await dbSvc.withTenant(tenant.companyId, (tx) =>
        svc.ensureCounterTx(tx, tenant.companyId, key, defaults),
      );
      expect(row.status).toBe("Inactive");
      expect(row.currentValue).toBe(7n);
    });
  },
);
