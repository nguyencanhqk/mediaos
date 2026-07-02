/**
 * S2-FND-SEED-2 — SequenceService.ensureCounterTx / syncCounterConfigTx (real Postgres, DB cô lập).
 *
 * Colocated trong src/foundation/sequences → vitest gom qua include glob `src/**\/*.spec.ts` (mirror
 * att-master-data-seeder.int.spec.ts). Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
 * Hand-built services (KHÔNG boot Nest app) — DatabaseService/SequenceRepository/AuditService đều stateless
 * singletons, mirror test/integration/sequence-concurrent.int-spec.ts.
 *
 * Phủ RED items (WO S2-FND-SEED-2):
 *   (1) ensureCounterTx 2 lần KHÔNG reset current_value — EMP0001,EMP0002 → ensure lại → EMP0003.
 *   (2) counter Inactive → ensureCounterTx GIỮ NGUYÊN Inactive (KHÔNG re-enable); nextCode vẫn ném
 *       SequenceInactiveError sau ensure (chưa được "chữa" ngầm).
 *   (3) 2-tenant isolation: ensureCounterTx company A tạo row KHÔNG lộ/không đụng company B (cùng
 *       sequenceKey) — mỗi bên tự có counter riêng, độc lập.
 *   Race: 2 ensureCounterTx "cùng miss" (Promise.all) → CHỈ 1 row được tạo (unique_violation bắt +
 *       đọc lại, KHÔNG throw).
 *   PATCH-sync: syncCounterConfigTx cập nhật prefix/paddingLength/status GIỮ NGUYÊN current_value trên
 *       counter đã tồn tại; tạo mới đúng cấu hình khi counter CHƯA tồn tại.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../../../test/helpers/seed";
import { SequenceRepository } from "./sequence.repository";
import { SequenceService } from "./sequence.service";
import { SequenceInactiveError } from "./sequence.types";

const runDb = hasDb && Boolean(process.env.LANE_DB);

describe.skipIf(!runDb)(
  "S2-FND-SEED-2 SequenceService ensureCounterTx / syncCounterConfigTx",
  () => {
    const direct: Pool = directPool();
    let A: SeededTenant;
    let B: SeededTenant;
    let db: DatabaseService;
    let repo: SequenceRepository;
    let svc: SequenceService;

    beforeAll(async () => {
      A = await seedCompany(direct, "seq-ensure-a");
      B = await seedCompany(direct, "seq-ensure-b");
      db = new DatabaseService();
      repo = new SequenceRepository();
      svc = new SequenceService(db, repo, new AuditService());
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    it("(1) ensure 2 lần KHÔNG reset current_value — EMP0001,EMP0002 → ensure lại → EMP0003", async () => {
      const SEQ_KEY = `ENSURE_NO_RESET_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      await db.withTenant(A.companyId, (tx) =>
        svc.ensureCounterTx(tx, A.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "EMP",
          paddingLength: 4,
        }),
      );

      const first = await svc.nextCode(A.companyId, key);
      const second = await svc.nextCode(A.companyId, key);
      expect(first.code).toBe("EMP0001");
      expect(second.code).toBe("EMP0002");

      // Ensure LẠI (row đã tồn tại, current_value=2) — PHẢI KHÔNG reset về 0.
      await db.withTenant(A.companyId, (tx) =>
        svc.ensureCounterTx(tx, A.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "EMP",
          paddingLength: 4,
        }),
      );

      const third = await svc.nextCode(A.companyId, key);
      expect(third.code).toBe("EMP0003");
    });

    it("(2) counter Inactive → ensure GIỮ NGUYÊN Inactive (KHÔNG re-enable); nextCode vẫn 422-nguồn", async () => {
      const SEQ_KEY = `ENSURE_INACTIVE_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      // Seed 1 counter Inactive TRỰC TIẾP (raw, mirror admin đã tắt sequence này).
      await direct.query(
        `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          increment_by, reset_policy, current_value, status)
       VALUES ($1, 'HR', $2, 'Company', 'STAFF', 4, 1, 'Never', 7, 'Inactive')`,
        [A.companyId, SEQ_KEY],
      );

      await db.withTenant(A.companyId, (tx) =>
        svc.ensureCounterTx(tx, A.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "EMP", // đổi prefix cố ý — PHẢI bị BỎ QUA vì row đã tồn tại (ensure = insert-if-missing).
          paddingLength: 4,
        }),
      );

      const row = await direct.query(
        "SELECT status, prefix, current_value FROM sequence_counters WHERE company_id=$1 AND sequence_key=$2",
        [A.companyId, SEQ_KEY],
      );
      expect(row.rows[0].status).toBe("Inactive"); // KHÔNG re-enable.
      expect(row.rows[0].prefix).toBe("STAFF"); // KHÔNG ghi đè config đã tồn tại.
      expect(row.rows[0].current_value).toBe("7"); // KHÔNG reset.

      await expect(svc.nextCode(A.companyId, key)).rejects.toBeInstanceOf(SequenceInactiveError);
    });

    it("(3) 2-tenant isolation: ensure company A KHÔNG đụng/không lộ counter company B (cùng sequenceKey)", async () => {
      const SEQ_KEY = `ENSURE_TENANT_ISO_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      await db.withTenant(A.companyId, (tx) =>
        svc.ensureCounterTx(tx, A.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "AAA",
          paddingLength: 4,
        }),
      );
      await db.withTenant(B.companyId, (tx) =>
        svc.ensureCounterTx(tx, B.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "BBB",
          paddingLength: 4,
        }),
      );

      const codeA = await svc.nextCode(A.companyId, key);
      const codeB = await svc.nextCode(B.companyId, key);
      expect(codeA.code).toBe("AAA0001"); // KHÔNG lộ current_value của B, độc lập từ 1.
      expect(codeB.code).toBe("BBB0001");

      const rows = await direct.query(
        "SELECT company_id, prefix FROM sequence_counters WHERE sequence_key=$1 ORDER BY prefix",
        [SEQ_KEY],
      );
      expect(rows.rows).toHaveLength(2); // đúng 2 row độc lập — KHÔNG gộp/lộ chéo tenant.
    });

    it("race: 2 ensureCounterTx cùng miss (Promise.all) → CHỈ 1 row (unique_violation bắt, KHÔNG throw)", async () => {
      const SEQ_KEY = `ENSURE_RACE_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      await Promise.all([
        db.withTenant(A.companyId, (tx) =>
          svc.ensureCounterTx(tx, A.companyId, key, {
            sequenceKey: SEQ_KEY,
            moduleCode: "HR",
            prefix: "RACE",
            paddingLength: 4,
          }),
        ),
        db.withTenant(A.companyId, (tx) =>
          svc.ensureCounterTx(tx, A.companyId, key, {
            sequenceKey: SEQ_KEY,
            moduleCode: "HR",
            prefix: "RACE",
            paddingLength: 4,
          }),
        ),
      ]);

      const rows = await direct.query(
        "SELECT count(*)::int AS n FROM sequence_counters WHERE company_id=$1 AND sequence_key=$2",
        [A.companyId, SEQ_KEY],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("PATCH-sync: syncCounterConfigTx cập nhật prefix/padding/status, GIỮ NGUYÊN current_value", async () => {
      const SEQ_KEY = `SYNC_EXISTING_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      await db.withTenant(A.companyId, (tx) =>
        svc.ensureCounterTx(tx, A.companyId, key, {
          sequenceKey: SEQ_KEY,
          moduleCode: "HR",
          prefix: "EMP",
          paddingLength: 4,
        }),
      );
      await svc.nextCode(A.companyId, key); // current_value → 1 (EMP0001)
      await svc.nextCode(A.companyId, key); // current_value → 2 (EMP0002)

      await db.withTenant(A.companyId, (tx) =>
        svc.syncCounterConfigTx(tx, A.companyId, key, {
          moduleCode: "HR",
          prefix: "STAFF",
          paddingLength: 5,
          status: "Active",
        }),
      );

      // Số kế tiếp phải TIẾP NỐI (0003, KHÔNG quay về 0001) VỚI prefix/padding mới.
      const next = await svc.nextCode(A.companyId, key);
      expect(next.code).toBe("STAFF00003");

      const row = await direct.query(
        "SELECT current_value FROM sequence_counters WHERE company_id=$1 AND sequence_key=$2",
        [A.companyId, SEQ_KEY],
      );
      expect(row.rows[0].current_value).toBe("3"); // đúng 3 lần cấp — sync KHÔNG reset.
    });

    it("PATCH-sync: counter CHƯA tồn tại → tạo mới đúng cấu hình (current_value=0, mã đầu ĐÚNG format)", async () => {
      const SEQ_KEY = `SYNC_MISSING_${Date.now()}`;
      const key = { sequenceKey: SEQ_KEY };

      await db.withTenant(A.companyId, (tx) =>
        svc.syncCounterConfigTx(tx, A.companyId, key, {
          moduleCode: "HR",
          prefix: "EMP",
          paddingLength: 4,
          status: "Active",
        }),
      );

      const next = await svc.nextCode(A.companyId, key);
      expect(next.code).toBe("EMP0001");
    });
  },
);
