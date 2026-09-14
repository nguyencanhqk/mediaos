import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S15-PAYROLL-DB-2 (mig 0572 · 0573) — CHỐT HỒI QUY cho nền dữ liệu PAYROLL v2 track C + ALTER lượt 3 của
 * `payroll_periods` (DB-13 §12.3/§14 · SPEC-11 §12.1/§13.1/§17.1 · plan `docs/plans/S15-PAYROLL-DB-2.md`).
 *
 * VÌ SAO FILE NÀY TỒN TẠI — khối VERIFY trong migration chạy ĐÚNG MỘT LẦN lúc migrate, không phải cổng đứng.
 * Sau merge, một WO sau có thể DROP trigger `payroll_payment_line_guard` (mở lại đường trả lương hai lần / sửa
 * dòng sau khi đã chi), nới `payroll_periods_paid_pair_check`, hay «sửa» `payroll_payment_batches_company_period_idx`
 * thành unique (giết kỳ nhiều đợt) — và KHÔNG có gì đỏ.
 *
 * ⚠️ VERIFY của migration chạy bằng role SUPERUSER/BYPASSRLS ⇒ chứng minh policy TỒN TẠI, không chứng minh ĐÚNG.
 * Nhóm A chạy bằng `mediaos_app` — đó mới là chỗ bất biến #1 được chứng minh.
 *
 * QUY TẮC: mọi ca ÂM có ĐỐI CHỨNG DƯƠNG đứng cạnh (`deny-cases-vacuous-without-allow-case`); ca trigger assert
 * đúng TAG (plan §3.5.a M1 — tiền tố một mình không phân biệt nhánh); ca CHECK dựng hàng vi phạm ĐÚNG MỘT ràng
 * buộc rồi ghim TÊN (`pg-reports-arbitrary-check-when-multiple-violated`); mutation trong tx ROLLBACK.
 *
 * NƠI CHẠY: gate `hasDb` — chạy THẬT trên CI (khuôn `s15-payroll-db1-invariants`).
 */

type PgErr = { code?: string; constraint?: string; message: string };

const TRACK_C_TABLES = [
  "payroll_advances",
  "payroll_payment_batches",
  "payroll_payment_lines",
  "payroll_budgets",
] as const;

/** Tháng duy nhất cho mỗi kỳ fixture — unique `(company_id, period_month)` ở cả kỳ lương lẫn kỳ công. */
let monthSeq = 0;
function nextMonth(): string {
  const i = monthSeq++;
  return `${2040 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Chạy một câu dưới SAVEPOINT — trả lỗi thay vì làm hỏng cả transaction. */
async function tryQ(c: PoolClient, text: string, params: unknown[] = []): Promise<PgErr | null> {
  await c.query("SAVEPOINT t");
  try {
    await c.query(text, params);
    await c.query("RELEASE SAVEPOINT t");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT t");
    return e as PgErr;
  }
}

function expectTag(err: PgErr | null, trigger: string, tag: string): void {
  expect(err, `${trigger}:${tag} phải NÉM`).not.toBeNull();
  expect(err?.code).toBe("23514");
  expect(err?.message.startsWith(`${trigger}:${tag}:`), err?.message).toBe(true);
}

function expectConstraint(err: PgErr | null, code: string, constraint: string): void {
  expect(err, `${constraint} phải NÉM`).not.toBeNull();
  expect(err?.code, err?.message).toBe(code);
  expect(err?.constraint, err?.message).toBe(constraint);
}

type Q = Pool | PoolClient;

async function one(c: Q, text: string, params: unknown[]): Promise<string> {
  const r = await c.query(text, params);
  return r.rows[0].id as string;
}

/** Kỳ lương đủ vết theo `status` — thoả MỌI CHECK cặp của 0572 (four-eyes: người gửi ≠ người duyệt). */
async function mkPeriod(
  c: Q,
  companyId: string,
  status: string,
  submitter: string,
  approver: string,
): Promise<string> {
  const m = nextMonth();
  const ap = await one(
    c,
    `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
    [companyId, m],
  );
  const has = (xs: string[]) => xs.includes(status);
  return one(
    c,
    `INSERT INTO payroll_periods
       (company_id, period_month, status, attendance_period_id,
        submitted_by, submitted_at, approved_by, approved_at, published_by, published_at,
        paid_by, paid_at, locked_by, locked_at)
     VALUES ($1, $2, $3, $4,
        CASE WHEN $5::boolean THEN $9::uuid END,  CASE WHEN $5::boolean THEN now() END,
        CASE WHEN $6::boolean THEN $10::uuid END, CASE WHEN $6::boolean THEN now() END,
        CASE WHEN $7::boolean THEN $10::uuid END, CASE WHEN $7::boolean THEN now() END,
        CASE WHEN $8::boolean THEN $10::uuid END, CASE WHEN $8::boolean THEN now() END,
        CASE WHEN $11::boolean THEN $10::uuid END, CASE WHEN $11::boolean THEN now() END)
     RETURNING id`,
    [
      companyId,
      m,
      status,
      ap,
      has(["Reviewing", "Approved", "Published", "Paid", "Locked"]),
      has(["Approved", "Published", "Paid", "Locked"]),
      has(["Published", "Paid", "Locked"]),
      has(["Paid", "Locked"]),
      submitter,
      approver,
      status === "Locked",
    ],
  );
}

async function mkPayslip(
  c: Q,
  companyId: string,
  periodId: string,
  userId: string,
): Promise<string> {
  return one(
    c,
    `INSERT INTO payslips
       (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
     VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, '{"workDays":22}'::jsonb) RETURNING id`,
    [companyId, periodId, userId],
  );
}

async function mkBatch(c: Q, companyId: string, periodId: string): Promise<string> {
  return one(
    c,
    `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method)
     VALUES ($1, $2, $3, 'bank') RETURNING id`,
    [companyId, periodId, `B_${randomUUID().slice(0, 8)}`],
  );
}

async function completeBatch(c: Q, batchId: string, actor: string): Promise<void> {
  await c.query(
    `UPDATE payroll_payment_batches SET status = 'Completed', completed_by = $2, completed_at = now()
      WHERE id = $1`,
    [batchId, actor],
  );
}

async function mkLine(
  c: Q,
  companyId: string,
  batchId: string,
  userId: string,
  payslipId: string,
): Promise<string> {
  return one(
    c,
    `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id, paid_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [companyId, batchId, userId, payslipId],
  );
}

async function mkAdvance(
  c: Q,
  companyId: string,
  userId: string,
  createdBy: string,
): Promise<string> {
  return one(
    c,
    `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by)
     VALUES ($1, $2, 1500000.00, '2040-01', 'fixture', $3) RETURNING id`,
    [companyId, userId, createdBy],
  );
}

describe.skipIf(!hasDb)(
  "S15-PAYROLL-DB-2 · bất biến track C + payroll_periods v2 (mig 0572–0573)",
  () => {
    const direct = directPool();
    const app = appPool(3);
    const worker = workerPool(1);

    let A: SeededTenant;
    let B: SeededTenant;
    /** A: người gửi duyệt · người duyệt · hai nhân sự ăn lương. */
    let a1: string;
    let a2: string;
    let e1: string;
    let e2: string;
    let b1: string;
    let b2: string;
    /** Hàng COMMITTED của B (cho A3) + fixture committed của A (cho D8). */
    const rowsB: Record<(typeof TRACK_C_TABLES)[number], string> = {
      payroll_advances: "",
      payroll_payment_batches: "",
      payroll_payment_lines: "",
      payroll_budgets: "",
    };
    let periodB: string;
    let templateB: string;
    let lockBatchA: string;
    let lockLineA: string;

    async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await direct.connect();
      try {
        await c.query("BEGIN");
        return await fn(c);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }

    async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        return await fn(c);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "s15db2a");
      B = await seedCompany(direct, "s15db2b");
      a1 = await seedUser(direct, A.companyId, `a1-${randomUUID().slice(0, 8)}@a.test`);
      a2 = await seedUser(direct, A.companyId, `a2-${randomUUID().slice(0, 8)}@a.test`);
      e1 = await seedUser(direct, A.companyId, `e1-${randomUUID().slice(0, 8)}@a.test`);
      e2 = await seedUser(direct, A.companyId, `e2-${randomUUID().slice(0, 8)}@a.test`);
      b1 = await seedUser(direct, B.companyId, `b1-${randomUUID().slice(0, 8)}@b.test`);
      b2 = await seedUser(direct, B.companyId, `b2-${randomUUID().slice(0, 8)}@b.test`);

      // Hàng COMMITTED của B trên cả 4 bảng — A3 đọc bằng app-role trong ngữ cảnh A.
      periodB = await mkPeriod(direct, B.companyId, "Published", b1, b2);
      const psB = await mkPayslip(direct, B.companyId, periodB, b1);
      rowsB.payroll_payment_batches = await mkBatch(direct, B.companyId, periodB);
      rowsB.payroll_payment_lines = await mkLine(
        direct,
        B.companyId,
        rowsB.payroll_payment_batches,
        b1,
        psB,
      );
      rowsB.payroll_advances = await mkAdvance(direct, B.companyId, b1, b2);
      rowsB.payroll_budgets = await one(
        direct,
        `INSERT INTO payroll_budgets (company_id, fiscal_year, planned_amount)
         VALUES ($1, 2044, 1.00) RETURNING id`,
        [B.companyId],
      );
      templateB = await one(
        direct,
        `INSERT INTO payroll_templates (company_id, code, name, scope)
         VALUES ($1, $2, 'fixture B', 'company') RETURNING id`,
        [B.companyId, `TPL_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, "")}`],
      );

      // Fixture COMMITTED của A cho D8 (hai connection phải cùng thấy hàng).
      const pLock = await mkPeriod(direct, A.companyId, "Published", a1, a2);
      const psLock = await mkPayslip(direct, A.companyId, pLock, e1);
      lockBatchA = await mkBatch(direct, A.companyId, pLock);
      lockLineA = await mkLine(direct, A.companyId, lockBatchA, e1, psLock);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
      await worker.end();
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // A. Bất biến #1 — RLS + FORCE + cô lập tenant (chạy bằng mediaos_app)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("A. RLS / cô lập tenant", () => {
      it("A1 cả 4 bảng có RLS ENABLE + FORCE + đúng 1 policy tenant_isolation", async () => {
        const { rows } = await direct.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          npolicy: string;
        }>(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policies p
                    WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS npolicy
             FROM pg_class c WHERE c.relname = ANY($1::text[])`,
          [[...TRACK_C_TABLES]],
        );
        expect(rows).toHaveLength(TRACK_C_TABLES.length);
        for (const r of rows) {
          expect(r.relrowsecurity, `${r.relname} thiếu RLS ENABLE`).toBe(true);
          expect(r.relforcerowsecurity, `${r.relname} thiếu FORCE RLS`).toBe(true);
          expect(Number(r.npolicy), `${r.relname} thiếu policy`).toBe(1);
        }
      });

      it("A2 ĐỐI CHỨNG DƯƠNG: app-role INSERT tạm ứng đúng tenant đi qua", async () => {
        const id = await asApp(A.companyId, (c) => mkAdvance(c, A.companyId, e1, a1));
        expect(id).toBeTruthy();
      });

      it("A3 tenant A KHÔNG thấy hàng của B trên CẢ 4 bảng — và B THẤY (kẻo xanh vì bảng rỗng)", async () => {
        for (const t of TRACK_C_TABLES) {
          const seenByA = await asApp(A.companyId, (c) =>
            c.query(`SELECT count(*)::int AS n FROM ${t} WHERE id = $1`, [rowsB[t]]),
          );
          expect(seenByA.rows[0].n, `${t}: A đọc được hàng của B`).toBe(0);
          const seenByB = await asApp(B.companyId, (c) =>
            c.query(`SELECT count(*)::int AS n FROM ${t} WHERE id = $1`, [rowsB[t]]),
          );
          expect(seenByB.rows[0].n, `${t}: đối chứng — B phải thấy hàng của chính mình`).toBe(1);
        }
      });

      it("A4 ghi CHÉO TENANT bị chặn: policy WITH CHECK (app) + composite FK (bypass RLS)", async () => {
        const rls = await asApp(A.companyId, (c) =>
          tryQ(
            c,
            `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by)
             VALUES ($1, $2, 1.00, '2040-01', 'x', $3)`,
            [B.companyId, b1, b2],
          ),
        );
        expect(rls?.code, rls?.message).toBe("42501");
        // Bảng không có trigger đứng trước FK ⇒ đo đúng composite FK: đợt của A trỏ kỳ của B.
        const fk = await inTx((c) =>
          tryQ(
            c,
            `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method)
             VALUES ($1, $2, 'XT', 'bank')`,
            [A.companyId, periodB],
          ),
        );
        expectConstraint(fk, "23503", "payroll_payment_batches_payroll_period_id_company_fk");
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // B. GRANT — bất biến #2 (không hard-delete) + worker không đọc tiền
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("B. GRANT", () => {
      it("B1 mediaos_app có ĐÚNG INSERT,SELECT,UPDATE trên cả 4 bảng (0 DELETE)", async () => {
        const { rows } = await direct.query<{ relname: string; privs: string }>(
          `SELECT c.relname, string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
             FROM pg_class c, aclexplode(c.relacl) a
            WHERE c.relname = ANY($1::text[]) AND a.grantee = 'mediaos_app'::regrole
            GROUP BY c.relname`,
          [[...TRACK_C_TABLES]],
        );
        expect(rows).toHaveLength(TRACK_C_TABLES.length);
        for (const r of rows) expect(r.privs, r.relname).toBe("INSERT,SELECT,UPDATE");
      });

      it("B2 mediaos_worker 0 quyền trên cả 4 bảng", async () => {
        const { rows } = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_class c, aclexplode(c.relacl) a
            WHERE c.relname = ANY($1::text[]) AND a.grantee = 'mediaos_worker'::regrole`,
          [[...TRACK_C_TABLES]],
        );
        expect(rows[0].n).toBe(0);
      });

      it("B3 ĐỐI CHỨNG DƯƠNG: worker VẪN đọc được payroll_periods (không thu hồi quá tay)", async () => {
        const c = await worker.connect();
        try {
          await expect(c.query("SELECT count(*) FROM payroll_periods")).resolves.toBeTruthy();
          const denied = await c.query("SELECT 1").then(() =>
            c.query("SELECT count(*) FROM payroll_payment_lines").then(
              () => null,
              (e: PgErr) => e,
            ),
          );
          expect(denied?.code, "worker đọc được dòng chi trả").toBe("42501");
        } finally {
          c.release();
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // C. CHECK · UNIQUE — mỗi hàng vi phạm ĐÚNG MỘT ràng buộc, ghim TÊN
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("C. CHECK · UNIQUE", () => {
      it("C1 payroll_advances: 9 CHECK — mỗi cái một ca (trigger tắt TRONG tx để với tới CHECK)", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Calculated", a1, a2);
          // T3 `insert-shape` đứng TRƯỚC CHECK ở đường INSERT ⇒ tắt nó trong tx rồi ROLLBACK (D13 ghim bật lại).
          await c.query(
            "ALTER TABLE payroll_advances DISABLE TRIGGER payroll_advance_freeze_guard",
          );
          const ins = (cols: string, vals: string, params: unknown[]) =>
            tryQ(
              c,
              `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by${cols})
               VALUES ($1, $2, $3, $4, 'x', $5${vals})`,
              params,
            );
          const base = (amount: string, month: string) => [A.companyId, e1, amount, month, a1];

          expectConstraint(
            await ins("", "", base("0", "2040-01")),
            "23514",
            "payroll_advances_amount_check",
          );
          expectConstraint(
            await ins("", "", base("1", "2040-13")),
            "23514",
            "payroll_advances_month_check",
          );
          expectConstraint(
            await ins(", status, decided_by, decided_at", ", 'Paid', $6, now()", [
              ...base("1", "2040-01"),
              a2,
            ]),
            "23514",
            "payroll_advances_status_check",
          );
          expectConstraint(
            await ins(", status", ", 'Approved'", base("1", "2040-01")),
            "23514",
            "payroll_advances_decided_pair_check",
          );
          expectConstraint(
            await ins(", status, decided_by, decided_at", ", 'Rejected', $6, now()", [
              ...base("1", "2040-01"),
              a2,
            ]),
            "23514",
            "payroll_advances_reject_note_check",
          );
          expectConstraint(
            await ins(
              ", status, decided_by, decided_at, payroll_period_id",
              ", 'Deducted', $6, now(), $7",
              [...base("1", "2040-01"), a2, P],
            ),
            "23514",
            "payroll_advances_consumed_pair_check",
          );
          expectConstraint(
            await ins(
              ", status, decided_by, decided_at, payroll_period_id, consumed_at",
              ", 'Approved', $6, now(), $7, now()",
              [...base("1", "2040-01"), a2, P],
            ),
            "23514",
            "payroll_advances_consume_status_check",
          );
          expectConstraint(
            await ins(", status, decided_by, decided_at", ", 'Deducted', $6, now()", [
              ...base("1", "2040-01"),
              a2,
            ]),
            "23514",
            "payroll_advances_deducted_bound_check",
          );
          expectConstraint(
            await ins(", status, decided_by, decided_at", ", 'Approved', $6, now()", [
              ...base("1", "2040-01"),
              a1,
            ]),
            "23514",
            "payroll_advances_four_eyes_check",
          );
          // ĐỐI CHỨNG DƯƠNG — cùng khuôn INSERT, hàng hợp lệ đi qua (kẻo 9 ca trên xanh vì câu INSERT hỏng).
          expect(
            await ins(", status, decided_by, decided_at", ", 'Approved', $6, now()", [
              ...base("1", "2040-01"),
              a2,
            ]),
          ).toBeNull();
        });
      });

      it("C2 payroll_payment_batches: method · status · completed_pair", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          expectConstraint(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method)
               VALUES ($1, $2, 'M', 'wire')`,
              [A.companyId, P],
            ),
            "23514",
            "payroll_payment_batches_method_check",
          );
          expectConstraint(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method, status)
               VALUES ($1, $2, 'S', 'bank', 'Done')`,
              [A.companyId, P],
            ),
            "23514",
            "payroll_payment_batches_status_check",
          );
          const bId = await mkBatch(c, A.companyId, P);
          expectConstraint(
            await tryQ(c, `UPDATE payroll_payment_batches SET status = 'Completed' WHERE id = $1`, [
              bId,
            ]),
            "23514",
            "payroll_payment_batches_completed_pair_check",
          );
          // DƯƠNG: đủ vết thì hoàn tất được.
          expect(
            await tryQ(
              c,
              `UPDATE payroll_payment_batches SET status = 'Completed', completed_by = $2, completed_at = now()
                WHERE id = $1`,
              [bId, a1],
            ),
          ).toBeNull();
        });
      });

      it("C3 kỳ NHIỀU đợt: hai đợt cùng kỳ INSERT được (index non-unique CÓ CHỦ ĐÍCH)", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          await mkBatch(c, A.companyId, P);
          await expect(mkBatch(c, A.companyId, P)).resolves.toBeTruthy();
          const idx = await c.query<{ indisunique: boolean }>(
            `SELECT i.indisunique FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
              WHERE ic.relname = 'payroll_payment_batches_company_period_idx'`,
          );
          expect(idx.rows[0]?.indisunique).toBe(false);
        });
      });

      it("C4 CHỐNG TRẢ HAI LẦN: một phiếu ở đợt thứ hai ⇒ 23505 payroll_payment_lines_payslip_uq", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const ps = await mkPayslip(c, A.companyId, P, e1);
          const bx = await mkBatch(c, A.companyId, P);
          const by = await mkBatch(c, A.companyId, P);
          await mkLine(c, A.companyId, bx, e1, ps);
          expectConstraint(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id) VALUES ($1, $2, $3, $4)`,
              [A.companyId, by, e1, ps],
            ),
            "23505",
            "payroll_payment_lines_payslip_uq",
          );
          // Trùng TRONG CÙNG đợt cũng 23505 (phiếu unique theo (kỳ, người) ⇒ batch_user_uq chỉ vỡ kèm payslip_uq).
          const dup = await tryQ(
            c,
            `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id) VALUES ($1, $2, $3, $4)`,
            [A.companyId, bx, e1, ps],
          );
          expect(dup?.code).toBe("23505");
          expect([
            "payroll_payment_lines_payslip_uq",
            "payroll_payment_lines_batch_user_uq",
          ]).toContain(dup?.constraint);
        });
      });

      it("C5 ĐỐI CHỨNG DƯƠNG: dòng XOÁ MỀM ở đợt X (Draft) cho phép phiếu đó vào đợt Y", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const ps = await mkPayslip(c, A.companyId, P, e1);
          const bx = await mkBatch(c, A.companyId, P);
          const by = await mkBatch(c, A.companyId, P);
          const line = await mkLine(c, A.companyId, bx, e1, ps);
          await c.query(
            `UPDATE payroll_payment_lines SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
            [line, a1],
          );
          await expect(mkLine(c, A.companyId, by, e1, ps)).resolves.toBeTruthy();
        });
      });

      it("C6 bank_pair_check dòng chi: số TK không kèm tên chủ TK bị chặn", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const ps = await mkPayslip(c, A.companyId, P, e1);
          const bx = await mkBatch(c, A.companyId, P);
          expectConstraint(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id, bank_account_snapshot)
               VALUES ($1, $2, $3, $4, '0123456789')`,
              [A.companyId, bx, e1, ps],
            ),
            "23514",
            "payroll_payment_lines_bank_pair_check",
          );
          expect(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_lines
                 (company_id, batch_id, user_id, payslip_id, bank_account_snapshot, bank_name_snapshot, account_holder_snapshot)
               VALUES ($1, $2, $3, $4, '0123456789', 'Bank', 'Holder')`,
              [A.companyId, bx, e1, ps],
            ),
          ).toBeNull();
        });
      });

      it("C7 payroll_budgets: hai hàng TOÀN CÔNG TY cùng năm ⇒ year_unit_uq (bẫy NULL trong unique đã vá)", async () => {
        await inTx(async (c) => {
          const ins = (year: number, amount: string) =>
            tryQ(
              c,
              `INSERT INTO payroll_budgets (company_id, fiscal_year, planned_amount) VALUES ($1, $2, $3)`,
              [A.companyId, year, amount],
            );
          expect(await ins(2045, "1")).toBeNull();
          expectConstraint(await ins(2045, "2"), "23505", "payroll_budgets_year_unit_uq");
          expect(await ins(2046, "2"), "DƯƠNG: năm khác đi qua").toBeNull();
          expectConstraint(await ins(1999, "1"), "23514", "payroll_budgets_year_check");
          expectConstraint(await ins(2047, "-1"), "23514", "payroll_budgets_amount_check");
        });
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // D. Ba trigger chốt cuối (plan §3.5 + §3.5.a) — assert TAG
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("D. trigger chốt cuối", () => {
      const T1 = "payroll_payment_batch_freeze";
      const T2 = "payroll_payment_line_guard";
      const T3 = "payroll_advance_freeze_guard";

      it("D1 T1: Completed là terminal · kỳ của đợt BẤT BIẾN (B1) · không INSERT Completed — note vẫn sửa được", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const P2 = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const draft = await mkBatch(c, A.companyId, P);
          expectTag(
            await tryQ(
              c,
              `UPDATE payroll_payment_batches SET payroll_period_id = $2 WHERE id = $1`,
              [draft, P2],
            ),
            T1,
            "period-immutable",
          );
          expect(
            await tryQ(c, `UPDATE payroll_payment_batches SET note = 'draft note' WHERE id = $1`, [
              draft,
            ]),
            "DƯƠNG: đợt Draft sửa note được",
          ).toBeNull();

          const done = await mkBatch(c, A.companyId, P);
          await completeBatch(c, done, a1);
          expectTag(
            await tryQ(c, `UPDATE payroll_payment_batches SET status = 'Draft' WHERE id = $1`, [
              done,
            ]),
            T1,
            "frozen",
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_payment_batches SET deleted_at = now() WHERE id = $1`, [
              done,
            ]),
            T1,
            "frozen",
          );
          expect(
            await tryQ(
              c,
              `UPDATE payroll_payment_batches SET note = 'sau hoàn tất' WHERE id = $1`,
              [done],
            ),
            "DƯƠNG: đợt Completed vẫn sửa note",
          ).toBeNull();

          expectTag(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_batches
                 (company_id, payroll_period_id, code, method, status, completed_by, completed_at)
               VALUES ($1, $2, 'IC', 'bank', 'Completed', $3, now())`,
              [A.companyId, P, a1],
            ),
            T1,
            "insert-completed",
          );
        });
      });

      it("D2 T2: dòng của đợt Completed đóng băng (paid_at · payslip · xoá mềm · chuyển RA) — đợt Draft thì sửa được", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const ps1 = await mkPayslip(c, A.companyId, P, e1);
          const ps2 = await mkPayslip(c, A.companyId, P, e2);
          const done = await mkBatch(c, A.companyId, P);
          const draft = await mkBatch(c, A.companyId, P);
          const lineDone = await mkLine(c, A.companyId, done, e1, ps1);
          const lineDraft = await mkLine(c, A.companyId, draft, e2, ps2);
          await completeBatch(c, done, a1);

          expectTag(
            await tryQ(
              c,
              `UPDATE payroll_payment_lines SET paid_at = now() + interval '1 day' WHERE id = $1`,
              [lineDone],
            ),
            T2,
            "frozen",
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_payment_lines SET deleted_at = now() WHERE id = $1`, [
              lineDone,
            ]),
            T2,
            "frozen",
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_payment_lines SET batch_id = $2 WHERE id = $1`, [
              lineDone,
              draft,
            ]),
            T2,
            "frozen",
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_payment_lines SET batch_id = $2 WHERE id = $1`, [
              lineDraft,
              done,
            ]),
            T2,
            "move-to-completed",
          );
          // DƯƠNG đứng cạnh: dòng của đợt Draft sửa paid_at + xoá mềm được.
          expect(
            await tryQ(c, `UPDATE payroll_payment_lines SET paid_at = now() WHERE id = $1`, [
              lineDraft,
            ]),
          ).toBeNull();
          expect(
            await tryQ(c, `UPDATE payroll_payment_lines SET deleted_at = now() WHERE id = $1`, [
              lineDraft,
            ]),
          ).toBeNull();
        });
      });

      it("D3 T2: INSERT vào đợt Completed bị chặn — đường «gỡ mềm rồi thêm lại» mà unique partial không chặn", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const ps1 = await mkPayslip(c, A.companyId, P, e1);
          const ps2 = await mkPayslip(c, A.companyId, P, e2);
          const done = await mkBatch(c, A.companyId, P);
          await mkLine(c, A.companyId, done, e1, ps1);
          await completeBatch(c, done, a1);
          expectTag(
            await tryQ(
              c,
              `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id) VALUES ($1, $2, $3, $4)`,
              [A.companyId, done, e2, ps2],
            ),
            T2,
            "insert-into-completed",
          );
        });
      });

      it("D4 T2 nhất quán chéo: phiếu của NGƯỜI KHÁC · phiếu KỲ KHÁC · phiếu không tồn tại (fail-closed)", async () => {
        await inTx(async (c) => {
          const P = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const P2 = await mkPeriod(c, A.companyId, "Published", a1, a2);
          const psE1 = await mkPayslip(c, A.companyId, P, e1);
          const psOther = await mkPayslip(c, A.companyId, P2, e2);
          const bx = await mkBatch(c, A.companyId, P);
          const ins = (userId: string, payslipId: string) =>
            tryQ(
              c,
              `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id) VALUES ($1, $2, $3, $4)`,
              [A.companyId, bx, userId, payslipId],
            );
          expectTag(await ins(e2, psE1), T2, "cross-user");
          expectTag(await ins(e2, psOther), T2, "cross-period");
          expectTag(await ins(e1, randomUUID()), T2, "not-found");
          expect(await ins(e1, psE1), "DƯƠNG: phiếu đúng người + đúng kỳ").toBeNull();
        });
      });

      it("D5 T2 đọc đợt FOR SHARE (M4): đợt đang bị khoá FOR NO KEY UPDATE ⇒ sửa dòng chờ ⇒ 55P03; FOR KEY SHARE thì qua", async () => {
        const holder = await direct.connect();
        const writer = await direct.connect();
        try {
          await holder.query("BEGIN");
          await holder.query(
            `SELECT id FROM payroll_payment_batches WHERE id = $1 FOR NO KEY UPDATE`,
            [lockBatchA],
          );
          await writer.query("BEGIN");
          await writer.query("SET LOCAL lock_timeout = '300ms'");
          // `paid_at` KHÔNG phải cột FK ⇒ không có kiểm RI lấy KEY SHARE trên đợt; chờ khoá là DO TRIGGER.
          const blocked = await writer
            .query(`UPDATE payroll_payment_lines SET paid_at = now() WHERE id = $1`, [lockLineA])
            .then(
              () => null,
              (e: PgErr) => e,
            );
          expect(blocked?.code, blocked?.message ?? "KHÔNG chờ khoá — T2 thiếu FOR SHARE").toBe(
            "55P03",
          );
          await writer.query("ROLLBACK");
          await holder.query("ROLLBACK");

          // ĐỐI CHỨNG DƯƠNG: FOR KEY SHARE tương thích FOR SHARE ⇒ ghi dòng qua được.
          await holder.query("BEGIN");
          await holder.query(`SELECT id FROM payroll_payment_batches WHERE id = $1 FOR KEY SHARE`, [
            lockBatchA,
          ]);
          await writer.query("BEGIN");
          await writer.query("SET LOCAL lock_timeout = '300ms'");
          await expect(
            writer.query(`UPDATE payroll_payment_lines SET paid_at = now() WHERE id = $1`, [
              lockLineA,
            ]),
          ).resolves.toBeTruthy();
        } finally {
          await writer.query("ROLLBACK").catch(() => undefined);
          await holder.query("ROLLBACK").catch(() => undefined);
          writer.release();
          holder.release();
        }
      });

      it("D6 T3 INSERT (M3): chỉ sinh ở Pending sạch + có created_by", async () => {
        await inTx(async (c) => {
          expectTag(
            await tryQ(
              c,
              `INSERT INTO payroll_advances
                 (company_id, user_id, amount, deduct_period_month, reason, created_by, status, decided_by, decided_at)
               VALUES ($1, $2, 1.00, '2040-01', 'x', $3, 'Approved', $4, now())`,
              [A.companyId, e1, a1, a2],
            ),
            T3,
            "insert-shape",
          );
          expectTag(
            await tryQ(
              c,
              `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason)
               VALUES ($1, $2, 1.00, '2040-01', 'x')`,
              [A.companyId, e1],
            ),
            T3,
            "insert-shape",
          );
          await expect(mkAdvance(c, A.companyId, e1, a1)).resolves.toBeTruthy();
        });
      });

      it("D7 T3 đóng băng + terminal: sửa tiền sau duyệt · Rejected→Approved · Approved→Pending · đổi người tạo", async () => {
        await inTx(async (c) => {
          const adv = await mkAdvance(c, A.companyId, e1, a1);
          expect(
            await tryQ(c, `UPDATE payroll_advances SET amount = 2000000.00 WHERE id = $1`, [adv]),
            "DƯƠNG: Pending sửa tiền được",
          ).toBeNull();
          expectTag(
            await tryQ(c, `UPDATE payroll_advances SET created_by = $2 WHERE id = $1`, [adv, a2]),
            T3,
            "frozen",
          );
          expect(
            await tryQ(
              c,
              `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
              [adv, a2],
            ),
            "DƯƠNG: duyệt bởi người KHÁC người tạo",
          ).toBeNull();
          expectTag(
            await tryQ(c, `UPDATE payroll_advances SET amount = 1.00 WHERE id = $1`, [adv]),
            T3,
            "frozen",
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_advances SET status = 'Pending' WHERE id = $1`, [adv]),
            T3,
            "status-terminal",
          );

          const rej = await mkAdvance(c, A.companyId, e2, a1);
          await c.query(
            `UPDATE payroll_advances SET status = 'Rejected', decided_by = $2, decided_at = now(), decision_note = 'no'
              WHERE id = $1`,
            [rej, a2],
          );
          expectTag(
            await tryQ(c, `UPDATE payroll_advances SET status = 'Approved' WHERE id = $1`, [rej]),
            T3,
            "status-terminal",
          );
        });
      });

      it("D8 T3 B2: bind/nhả CHỈ khi kỳ ∈ {CollectingData, Calculated}; cấm re-bind", async () => {
        await inTx(async (c) => {
          const Pcalc = await mkPeriod(c, A.companyId, "Calculated", a1, a2);
          const Pcalc2 = await mkPeriod(c, A.companyId, "Calculated", a1, a2);
          const Pappr = await mkPeriod(c, A.companyId, "Approved", a1, a2);
          const adv = await mkAdvance(c, A.companyId, e1, a1);
          await c.query(
            `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
            [adv, a2],
          );
          const bind = (periodId: string) =>
            tryQ(
              c,
              `UPDATE payroll_advances SET status = 'Deducted', payroll_period_id = $2, consumed_at = now()
                WHERE id = $1`,
              [adv, periodId],
            );
          expectTag(await bind(Pappr), T3, "period-frozen");
          expect(await bind(Pcalc), "DƯƠNG: bind vào kỳ Calculated").toBeNull();
          expectTag(
            await tryQ(c, `UPDATE payroll_advances SET payroll_period_id = $2 WHERE id = $1`, [
              adv,
              Pcalc2,
            ]),
            T3,
            "rebind",
          );

          // Kỳ tiến lên Approved (vết đủ) ⇒ nhả consume khỏi nó = trừ lương hai lần ⇒ chặn.
          await c.query(
            `UPDATE payroll_periods SET status = 'Approved', submitted_by = $2, submitted_at = now(),
                    approved_by = $3, approved_at = now() WHERE id = $1`,
            [Pcalc, a1, a2],
          );
          const release = () =>
            tryQ(
              c,
              `UPDATE payroll_advances SET status = 'Approved', payroll_period_id = NULL, consumed_at = NULL
                WHERE id = $1`,
              [adv],
            );
          expectTag(await release(), T3, "period-frozen");
          await c.query(
            `UPDATE payroll_periods SET status = 'Calculated', submitted_by = NULL, submitted_at = NULL,
                    approved_by = NULL, approved_at = NULL WHERE id = $1`,
            [Pcalc],
          );
          expect(await release(), "DƯƠNG: nhả cả cặp khi kỳ còn Calculated").toBeNull();
        });
      });

      it("D9 cả 3 trigger còn BẬT sau các ca DISABLE-trong-tx (ROLLBACK đã khôi phục)", async () => {
        const { rows } = await direct.query<{ tgname: string; tgenabled: string }>(
          `SELECT tgname, tgenabled FROM pg_trigger
            WHERE tgname = ANY($1::text[]) AND NOT tgisinternal ORDER BY tgname`,
          [[T3, T2, T1]],
        );
        expect(rows.map((r) => `${r.tgname}=${r.tgenabled}`)).toEqual([
          `${T3}=O`,
          `${T1}=O`,
          `${T2}=O`,
        ]);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // E. payroll_periods v2 — 8 trạng thái + 4 CHECK cặp (plan §3.2 · §3.3)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("E. payroll_periods — CHECK cặp v2", () => {
      /** INSERT kỳ với vết CHỈ ĐỊNH — mỗi ca bỏ đúng một cặp vết. */
      async function insertPeriod(
        c: PoolClient,
        status: string,
        trails: {
          submitted?: boolean;
          approved?: boolean;
          published?: boolean;
          paid?: boolean;
          locked?: boolean;
        },
        extra: { templateId?: string } = {},
      ): Promise<PgErr | null> {
        const m = nextMonth();
        const ap = await one(
          c,
          `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
          [A.companyId, m],
        );
        const t = (on: boolean | undefined, who: string) => (on ? who : null);
        const at = (on: boolean | undefined) => (on ? new Date() : null);
        return tryQ(
          c,
          `INSERT INTO payroll_periods
             (company_id, period_month, status, attendance_period_id, submitted_by, submitted_at,
              approved_by, approved_at, published_by, published_at, paid_by, paid_at, locked_by, locked_at, template_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            A.companyId,
            m,
            status,
            ap,
            t(trails.submitted, a1),
            at(trails.submitted),
            t(trails.approved, a2),
            at(trails.approved),
            t(trails.published, a2),
            at(trails.published),
            t(trails.paid, a2),
            at(trails.paid),
            t(trails.locked, a2),
            at(trails.locked),
            extra.templateId ?? null,
          ],
        );
      }

      it("E1 DƯƠNG: Published đủ vết · Paid đủ vết · Locked đủ vết", async () => {
        await inTx(async (c) => {
          const full = { submitted: true, approved: true, published: true };
          expect(await insertPeriod(c, "Published", full)).toBeNull();
          expect(await insertPeriod(c, "Paid", { ...full, paid: true })).toBeNull();
          expect(await insertPeriod(c, "Locked", { ...full, paid: true, locked: true })).toBeNull();
        });
      });

      it("E2 mỗi CHECK cặp bắt ĐÚNG hàng thiếu vết của nó (một vi phạm / ca)", async () => {
        await inTx(async (c) => {
          const full = { submitted: true, approved: true, published: true };
          expectConstraint(
            await insertPeriod(c, "Published", { submitted: true, approved: true }),
            "23514",
            "payroll_periods_published_pair_check",
          );
          // plan §3.2 — lỗ DB-13 bỏ sót: Published thiếu submitted_* phải bị chặn.
          expectConstraint(
            await insertPeriod(c, "Published", { approved: true, published: true }),
            "23514",
            "payroll_periods_submitted_pair_check",
          );
          expectConstraint(
            await insertPeriod(c, "Paid", full),
            "23514",
            "payroll_periods_paid_pair_check",
          );
          expectConstraint(
            await insertPeriod(c, "Locked", { ...full, locked: true }),
            "23514",
            "payroll_periods_paid_pair_check",
          );
          expectConstraint(
            await insertPeriod(c, "Paid ", full),
            "23514",
            "payroll_periods_status_check",
          );
        });
      });

      it("E3 template_id trỏ mẫu của tenant KHÁC ⇒ composite FK chặn", async () => {
        await inTx(async (c) => {
          expectConstraint(
            await insertPeriod(c, "Draft", {}, { templateId: templateB }),
            "23503",
            "payroll_periods_template_id_company_fk",
          );
        });
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // F. NOTI 024–027 (mig 0573)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("F. NOTI PAYROLL v2", () => {
      const V2 = [
        ["PAYROLL_ADVANCE_SUBMITTED", "Normal", "/payroll/advances"],
        ["PAYROLL_ADVANCE_APPROVED", "High", "/me/payroll-advances"],
        ["PAYROLL_ADVANCE_REJECTED", "High", "/me/payroll-advances"],
        ["PAYROLL_PAYMENT_BATCH_COMPLETED", "Normal", "/payroll/periods/{payroll_period_id}"],
      ] as const;

      it("F1 tập event PAYROLL global = ĐÚNG 8 mã (v1 020..023 + v2 024..027)", async () => {
        const { rows } = await direct.query<{ event_code: string }>(
          `SELECT event_code FROM notification_events
            WHERE module_code = 'PAYROLL' AND company_id IS NULL AND deleted_at IS NULL ORDER BY event_code`,
        );
        expect(rows.map((r) => r.event_code)).toEqual(
          [
            "PAYROLL_PERIOD_APPROVED",
            "PAYROLL_PERIOD_REJECTED",
            "PAYROLL_PERIOD_SUBMITTED",
            "PAYSLIP_PUBLISHED",
            ...V2.map((v) => v[0]),
          ].sort(),
        );
      });

      it.each(V2)(
        "F2 %s: DedupeKey · window NULL · enabled · không system · Payroll · priority %s · link %s",
        async (code, prio, url) => {
          const { rows } = await direct.query<{
            dedupe_strategy: string;
            dedupe_window_seconds: number | null;
            is_enabled: boolean;
            is_system_event: boolean;
            notification_type: string;
            default_priority: string;
            target_url_template: string;
            vars: string[];
          }>(
            `SELECT e.dedupe_strategy, e.dedupe_window_seconds, e.is_enabled, e.is_system_event,
                  e.notification_type, e.default_priority, t.target_url_template,
                  ARRAY(SELECT jsonb_object_keys(t.variables_schema)) AS vars
             FROM notification_events e
             JOIN notification_templates t ON t.event_id = e.id AND t.company_id IS NULL AND t.deleted_at IS NULL
            WHERE e.event_code = $1 AND e.company_id IS NULL AND e.deleted_at IS NULL`,
            [code],
          );
          expect(rows).toHaveLength(1);
          const r = rows[0];
          expect(r.dedupe_strategy).toBe("DedupeKey");
          expect(r.dedupe_window_seconds).toBeNull();
          expect(r.is_enabled).toBe(true);
          expect(r.is_system_event).toBe(false);
          expect(r.notification_type).toBe("Payroll");
          expect(r.default_priority).toBe(prio);
          expect(r.target_url_template).toBe(url);
          // ⚠️ NOTI không có tầng masking ⇒ 0 biến số tiền, kể cả khi gửi cho chính người thụ hưởng.
          expect(r.vars.filter((v) => /amount|salary|gross|net|total|tien/i.test(v))).toEqual([]);
        },
      );
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // G. Chống migration bị bỏ qua im lặng (migration-not-in-journal-is-silently-skipped)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    it("F3 template v2: biến khai báo thuộc allowlist ĐÓNG money-free + mọi placeholder dùng đều đã khai báo", async () => {
      // Danh sách ĐÓNG: thêm biến mới phải sửa ca này, tức phải nghĩ nó có chở tiền không (khuôn s13 E3).
      const ALLOWED_VARS = new Set([
        "actor_name",
        "deduct_period_month",
        "period_month",
        "reason",
        "payroll_advance_id",
        "payroll_period_id",
      ]);
      const { rows } = await direct.query<{
        template_code: string;
        title_template: string;
        body_template: string;
        short_body_template: string | null;
        target_url_template: string | null;
        variables_schema: Record<string, unknown> | null;
      }>(
        `SELECT t.template_code, t.title_template, t.body_template, t.short_body_template,
                t.target_url_template, t.variables_schema
           FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
          WHERE t.company_id IS NULL AND t.deleted_at IS NULL
            AND e.event_code IN ('PAYROLL_ADVANCE_SUBMITTED','PAYROLL_ADVANCE_APPROVED',
                                 'PAYROLL_ADVANCE_REJECTED','PAYROLL_PAYMENT_BATCH_COMPLETED')`,
      );
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        const declared = new Set(Object.keys(r.variables_schema ?? {}));
        for (const v of declared) {
          expect(ALLOWED_VARS.has(v), `${r.template_code}: biến '${v}' ngoài allowlist`).toBe(true);
        }
        const text = [
          r.title_template,
          r.body_template,
          r.short_body_template ?? "",
          r.target_url_template ?? "",
        ];
        for (const t of text) {
          for (const m of t.matchAll(/\{(\w+)\}/g)) {
            expect(
              declared.has(m[1]),
              `${r.template_code}: placeholder {${m[1]}} chưa khai báo`,
            ).toBe(true);
          }
        }
      }
    });

    describe("G. journal", () => {
      it("G1 _journal.json có 0572 + 0573 và file .sql tồn tại", () => {
        const dir = path.resolve(__dirname, "../../migrations");
        const journal = JSON.parse(
          fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8"),
        ) as {
          entries: Array<{ tag: string }>;
        };
        const tags = journal.entries.map((e) => e.tag);
        for (const tag of [
          "0572_s15payrolldb2_payroll_v2_trackc_ddl",
          "0573_s15payrolldb2_noti_trackc",
        ]) {
          expect(tags, tag).toContain(tag);
          expect(fs.existsSync(path.join(dir, `${tag}.sql`)), `${tag}.sql`).toBe(true);
        }
      });
    });
  },
);
