/**
 * FOUNDATION-BE-2 — integration test đồng thời cho SequenceService.
 *
 * Mục tiêu: N request song song gọi nextCode CÙNG 1 counter → 0 mã trùng (SELECT ... FOR UPDATE
 * serialize đúng cách, DB-08 §8.9). Chạy trên Postgres thật — KHÔNG mock.
 *
 * Kiến trúc: dùng raw pg.Pool (app role, mediaos_app) để gọi procedure nextCode thay vì wire toàn bộ
 * NestJS app. Mỗi goroutine mở 1 transaction, set GUC tenant, thực hiện SELECT FOR UPDATE + UPDATE, COMMIT.
 * Điều này mirror chính xác những gì SequenceService.nextCode làm — verify ở DB-layer, không mock.
 *
 * Tại sao không dùng SequenceService trực tiếp: module-level `db` (drizzle) được khởi tạo từ DATABASE_URL
 * tại import-time. Trong env test, DATABASE_URL đã được vitest.config.ts resolve sang lane DB (LANE_DB).
 * SequenceService + DatabaseService đều singletons stateless → dùng trực tiếp là chính xác nhất.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SequenceRepository } from "../../src/foundation/sequences/sequence.repository";
import { SequenceService } from "../../src/foundation/sequences/sequence.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * Seed 1 sequence_counter qua direct (superuser, bypass RLS). Trả về id counter.
 * RLS WITH CHECK keyed company_id → app role KHÔNG thể INSERT counter của tenant khác (defense-in-depth
 * verified bởi rls-guards.int-spec). Ở đây seed qua direct để tránh dependency vào ensureSequenceCounter
 * (chưa land ở lane này).
 */
async function seedCounter(
  direct: Pool,
  companyId: string,
  sequenceKey: string,
  opts: {
    prefix?: string;
    paddingLength?: number;
    incrementBy?: number;
    resetPolicy?: string;
  } = {},
): Promise<string> {
  const { prefix = "SEQ", paddingLength = 6, incrementBy = 1, resetPolicy = "Never" } = opts;
  const res = await direct.query(
    `INSERT INTO sequence_counters
       (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
        increment_by, reset_policy, current_value, status)
     VALUES ($1, 'FOUNDATION', $2, 'Company', $3, $4, $5, $6, 0, 'Active')
     RETURNING id`,
    [companyId, sequenceKey, prefix, paddingLength, incrementBy, resetPolicy],
  );
  return res.rows[0].id as string;
}

// [S1-QA-FND-1-FIX-A] Gate: hasDb (DATABASE_DIRECT_URL+URL) + LANE_DB (DB cô lập theo lane). Thiếu
// LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos' (.env làm hasDb=true → đỏ-giả/xanh-giả; memory:
// integration-test-lane-db-gate, CLAUDE.md §9.5). KHỚP canonical: file-access-logs-appendonly.int-spec.ts:19
// / file-security.int-spec.ts:52 / migration-smoke.int-spec.ts:106.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "FOUNDATION-BE-2 SequenceService — concurrent nextCode (SELECT FOR UPDATE)",
  () => {
    const direct = directPool();
    // Pool N+2 connections để N goroutines chạy đồng thời (mỗi goroutine giữ 1 connection/tx).
    const CONCURRENCY = 20;
    const app = appPool(CONCURRENCY + 2);

    let tenant: SeededTenant;
    let svc: SequenceService;

    beforeAll(async () => {
      tenant = await seedCompany(direct, "seq-conc");

      // Wire service trực tiếp (không NestJS app). db module-level đọc DATABASE_URL từ env (vitest.config.ts
      // đã resolve sang lane DB qua LANE_DB). DatabaseService + SequenceRepository + AuditService stateless.
      const dbSvc = new DatabaseService();
      const repo = new SequenceRepository();
      const audit = new AuditService();
      svc = new SequenceService(dbSvc, repo, audit);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [tenant.companyId]);
      await direct.end();
      await app.end();
    });

    it(`${CONCURRENCY} nextCode đồng thời → 0 mã trùng (FOR UPDATE serialize đúng, KHÔNG MAX(code)+1)`, async () => {
      const SEQ_KEY = `CONCURRENT_TEST_${Date.now()}`;
      await seedCounter(direct, tenant.companyId, SEQ_KEY, {
        prefix: "T",
        paddingLength: 6,
        incrementBy: 1,
        resetPolicy: "Never",
      });

      // Phóng CONCURRENCY request song song.
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          svc.nextCode(tenant.companyId, { sequenceKey: SEQ_KEY }),
        ),
      );

      const codes = results.map((r) => r.code);
      const values = results.map((r) => r.value);

      // 0 mã trùng — invariant chính.
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(CONCURRENCY);

      // Giá trị liên tiếp từ 1..CONCURRENCY (không lỗ, không trùng). Sort trước so sánh.
      const sortedValues = [...values].sort((a, b) => a - b);
      expect(sortedValues).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    }, // Timeout thoải mái: CONCURRENCY tx cạnh tranh có thể cần 3-5s trên CI chậm.
    30_000);

    it("nextCode tenant A KHÔNG thấy counter của tenant B (RLS tenant isolation)", async () => {
      // Tạo tenant B riêng và seed counter chỉ cho B.
      const tenantB = await seedCompany(direct, "seq-b");
      const SEQ_KEY = `ISOLATION_TEST_${Date.now()}`;
      await seedCounter(direct, tenantB.companyId, SEQ_KEY);

      try {
        // Tenant A gọi nextCode → SequenceNotFoundError (RLS lọc 0 row → not found, không rò dữ liệu B).
        const { SequenceNotFoundError } =
          await import("../../src/foundation/sequences/sequence.types");
        await expect(
          svc.nextCode(tenant.companyId, { sequenceKey: SEQ_KEY }),
        ).rejects.toBeInstanceOf(SequenceNotFoundError);
      } finally {
        await cleanupTenants(direct, [tenantB.companyId]);
      }
    });

    it("nextCode counter Inactive → SequenceInactiveError, 0 row mutate (deny-path)", async () => {
      const SEQ_KEY = `INACTIVE_TEST_${Date.now()}`;
      await direct.query(
        `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          increment_by, reset_policy, current_value, status)
       VALUES ($1, 'FOUNDATION', $2, 'Company', 'X', 4, 1, 'Never', 0, 'Inactive')`,
        [tenant.companyId, SEQ_KEY],
      );

      const { SequenceInactiveError } =
        await import("../../src/foundation/sequences/sequence.types");
      await expect(svc.nextCode(tenant.companyId, { sequenceKey: SEQ_KEY })).rejects.toBeInstanceOf(
        SequenceInactiveError,
      );

      // Verify counter KHÔNG bị mutate (current_value còn 0).
      const row = await direct.query(
        "SELECT current_value FROM sequence_counters WHERE company_id = $1 AND sequence_key = $2",
        [tenant.companyId, SEQ_KEY],
      );
      expect(row.rows[0].current_value).toBe("0");
    });

    it("nextCode Monthly reset: sang tháng tz VN → value bắt đầu lại từ 1 (reset + set last_reset_at)", async () => {
      const SEQ_KEY = `MONTHLY_RESET_${Date.now()}`;
      // Seed counter đang ở tháng 2026-01 (last_reset_at), current_value đã chạy tới 99.
      await direct.query(
        `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          increment_by, reset_policy, current_value, status, last_reset_at, format_pattern)
       VALUES ($1, 'FOUNDATION', $2, 'Company', 'INV', 4, 1, 'Monthly', 99, 'Active',
               '2026-01-15T00:00:00Z', 'yyyyMM')`,
        [tenant.companyId, SEQ_KEY],
      );

      // now = 2026-02-10T05:00Z = tháng 2 ở VN → kỳ mới → reset về 1.
      const res = await svc.nextCode(tenant.companyId, {
        sequenceKey: SEQ_KEY,
        now: new Date("2026-02-10T05:00:00Z"),
      });

      expect(res.value).toBe(1);
      expect(res.code).toBe("INV2026020001");

      // Verify last_reset_at đã được cập nhật ở DB.
      const row = await direct.query(
        "SELECT current_value, last_reset_at FROM sequence_counters WHERE company_id = $1 AND sequence_key = $2",
        [tenant.companyId, SEQ_KEY],
      );
      expect(row.rows[0].current_value).toBe("1");
      expect(row.rows[0].last_reset_at).toBeTruthy();
    });
  },
);
