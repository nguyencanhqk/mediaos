import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * PAYROLL — ĐÓNG BĂNG TIỀN của `bonus_penalties`, ép Ở TẦNG DB (trigger `bonus_penalty_freeze_guard` mig 0564
 * + CHECK). Đây là lớp 2 (sau service) cho lõi tính tiền — phải ĐỎ nếu trigger/CHECK biến mất.
 *
 * ⚠️ S13-PAYROLL-DB-1 — file này ĐƯỢC SỬA, KHÔNG XOÁ. `0564` DROP trigger di sản `bonus_penalty_guard` vì
 * nhánh (1) của nó ép FSM CŨ chữ thường (`draft→approved/rejected`) và sẽ **chặn oan** mọi hàng PascalCase.
 * Nhưng ba nhánh còn lại là BẤT BIẾN TIỀN và CHECK **không so được OLD/NEW** ⇒ chúng được dựng lại HẸP trong
 * `enforce_bonus_penalty_freeze()`. File này chuyển đúng theo:
 *   · ca **chuyển tiếp FSM** (draft→approved→…) ĐÃ RỜI khỏi đây — lên tầng service (PAYROLL-ERR-011/012/013);
 *   · ca **reference_type/task_id/kpi_result_id/currency** ĐÃ BỎ — 4+1 cột đó GỠ ở 0564 (DB-13 §5.5);
 *   · giữ + mở rộng ca đóng băng theo BỐN nhánh (A)(B)(C)(D) của trigger mới.
 *
 * Mỗi nhánh có CẢ ca ALLOW lẫn ca DENY — ca DENY đứng một mình là ca xanh-RỖNG
 * (`deny-cases-vacuous-without-allow-case`): nếu trigger lỡ RAISE cho mọi UPDATE thì chỉ ca ALLOW mới bắt được.
 *
 * Chạy UPDATE qua app role (mediaos_app) trong ngữ cảnh tenant; seed qua direct (superuser).
 */
describe.skipIf(!hasDb)("PAYROLL bonus/penalty freeze guard + CHECK (DB enforcement)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let emp: string;
  let approver: string;
  let periodId: string;
  let period2Id: string;

  async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      // ROLLBACK luôn: mỗi ca độc lập, không rò trạng thái sang ca sau.
      await c.query("ROLLBACK");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  /**
   * Seed 1 hàng qua direct. Trigger là BEFORE **UPDATE** nên INSERT không bị nó chạm — đó là cách duy nhất
   * dựng được hàng ở trạng thái đã-duyệt/đã-consume để thử các nhánh đóng băng.
   */
  async function seedBonus(opts: {
    status?: "Pending" | "Approved" | "Rejected";
    payrollPeriodId?: string;
  }): Promise<string> {
    const status = opts.status ?? "Pending";
    const decided = status !== "Pending";
    const r = await direct.query(
      `INSERT INTO bonus_penalties
         (company_id, user_id, kind, amount, period_month, reason, status, created_by,
          decided_by, decided_at, decision_note, payroll_period_id, consumed_at)
       VALUES ($1, $2, 'bonus', 500.00, '2026-05', 'Thưởng dự án', $3, $2,
               $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        A.companyId,
        emp,
        status,
        decided ? approver : null,
        decided ? new Date().toISOString() : null,
        // CHECK bonus_penalties_reject_note_check: Rejected BẮT BUỘC có decision_note.
        status === "Rejected" ? "Không hợp lệ" : null,
        opts.payrollPeriodId ?? null,
        opts.payrollPeriodId ? new Date().toISOString() : null,
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "bptrans");
    emp = await seedUser(direct, A.companyId, `bpt-emp-${randomUUID().slice(0, 8)}@a.test`);
    approver = await seedUser(direct, A.companyId, `bpt-apr-${randomUUID().slice(0, 8)}@a.test`);
    const p1 = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-05', 'Draft') RETURNING id`,
      [A.companyId],
    );
    periodId = p1.rows[0].id as string;
    const p2 = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-06', 'Draft') RETURNING id`,
      [A.companyId],
    );
    period2Id = p2.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ALLOW — nếu trigger RAISE ở đây thì mọi ca DENY bên dưới là xanh-RỖNG
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it("ALLOW: sửa amount/reason khi còn Pending và CHƯA consume", async () => {
    const id = await seedBonus({});
    const n = await asApp(A.companyId, async (c) => {
      const r = await c.query(
        `UPDATE bonus_penalties SET amount = 900.00, reason = 'Sửa khi còn Pending' WHERE id = $1`,
        [id],
      );
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  it("ALLOW: câu lệnh DUYỆT sạch (Pending → Approved, chỉ ghi decided_*) đi qua", async () => {
    const id = await seedBonus({});
    const n = await asApp(A.companyId, async (c) => {
      const r = await c.query(
        `UPDATE bonus_penalties
            SET status = 'Approved', decided_by = $2, decided_at = now()
          WHERE id = $1`,
        [id, approver],
      );
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  it("ALLOW: NHẢ consume (payroll_period_id x → NULL) khi tính lại kỳ — SPEC-11 §13.3", async () => {
    // Tính lại một kỳ CHƯA Approved sẽ nhả consume của chính kỳ đó rồi gộp lại trong cùng transaction.
    // Nhánh (C) của trigger CỐ Ý chỉ cấm x → y, không cấm x → NULL; cấm cả hai là khoá chết đường tính lại.
    const id = await seedBonus({ status: "Approved", payrollPeriodId: periodId });
    const n = await asApp(A.companyId, async (c) => {
      const r = await c.query(
        `UPDATE bonus_penalties SET payroll_period_id = NULL, consumed_at = NULL WHERE id = $1`,
        [id],
      );
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // (A) đóng băng field tiền/lý do sau khi rời Pending HOẶC đã consume
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it.each([
    ["amount", `amount = 1.00`],
    ["kind", `kind = 'penalty'`],
    ["period_month", `period_month = '2026-07'`],
    ["reason", `reason = 'Đổi lý do sau khi duyệt'`],
  ])("(A) DENY: sửa %s trên hàng ĐÃ Approved bị trigger chặn", async (_label, setExpr) => {
    const id = await seedBonus({ status: "Approved" });
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(`UPDATE bonus_penalties SET ${setExpr} WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  it("(A) DENY: sửa decision_note trên hàng đã duyệt — cột NULLABLE, phải dùng IS DISTINCT FROM", async () => {
    // Bẫy: `NEW.decision_note <> OLD.decision_note` với một vế NULL trả NULL ⇒ điều kiện KHÔNG BAO GIỜ true
    // ⇒ sửa lý do một khoản phạt đã duyệt lọt trong im lặng. Ca này ghim việc trigger dùng IS DISTINCT FROM.
    const id = await seedBonus({ status: "Approved" });
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(`UPDATE bonus_penalties SET decision_note = 'ghi thêm' WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  it("(A) DENY: sửa amount trên hàng còn Pending nhưng ĐÃ consume", async () => {
    // Điều kiện đóng băng là `status <> 'Pending' **HOẶC** đã consume` — vế thứ hai có ca riêng, kẻo ai đó
    // rút gọn thành chỉ kiểm status mà không ai phát hiện.
    const id = await seedBonus({ status: "Approved", payrollPeriodId: periodId });
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(`UPDATE bonus_penalties SET amount = 1.00 WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // (B) cấm xoá mềm sau khi rời Pending / đã consume — nhánh (2b) của trigger di sản 0098
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it("(B) DENY: xoá mềm hàng ĐÃ Approved bị chặn", async () => {
    const id = await seedBonus({ status: "Approved" });
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(`UPDATE bonus_penalties SET deleted_at = now() WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  it("(B) ALLOW: xoá mềm hàng còn Pending, chưa consume", async () => {
    const id = await seedBonus({});
    const n = await asApp(A.companyId, async (c) => {
      const r = await c.query(`UPDATE bonus_penalties SET deleted_at = now() WHERE id = $1`, [id]);
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // (C) cấm RE-BIND sang kỳ khác — chốt "một khoản thưởng vào hai kỳ" (DB-13 §11)
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it("(C) DENY: re-bind payroll_period_id sang kỳ KHÁC sau khi đã consume", async () => {
    const id = await seedBonus({ status: "Approved", payrollPeriodId: periodId });
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(`UPDATE bonus_penalties SET payroll_period_id = $2 WHERE id = $1`, [
          id,
          period2Id,
        ]);
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // (D) câu lệnh duyệt không được KÈM sửa tiền
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it("(D) DENY: một UPDATE vừa Pending→Approved vừa đổi amount", async () => {
    // Nhánh (A) một mình KHÔNG bắt được ca này: `OLD.status = 'Pending'` nên v_frozen = false.
    const id = await seedBonus({});
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `UPDATE bonus_penalties
              SET status = 'Approved', decided_by = $2, decided_at = now(), amount = 99999.00
            WHERE id = $1`,
          [id, approver],
        );
      }),
    ).rejects.toThrow(/bonus_penalty_freeze_guard/i);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // CHECK constraint — chốt cuối độc lập với trigger
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  it("CHECK amount > 0 (kind tách dấu — KHÔNG dùng số âm)", async () => {
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties (user_id, kind, amount, period_month, reason, created_by)
           VALUES ($1, 'bonus', -1.00, '2026-05', 'âm', $1)`,
          [emp],
        );
      }),
    ).rejects.toThrow(/bonus_penalties_amount_check/i);
  });

  it("CHECK status ∈ {Pending,Approved,Rejected} — giá trị chữ thường DI SẢN bị từ chối", async () => {
    // ⚠️ Hàng phải vi phạm ĐÚNG MỘT constraint: PG báo CHECK TUỲ Ý khi nhiều CHECK cùng vỡ
    // (pg-reports-arbitrary-check-when-multiple-violated). 'draft' <> 'Pending' nên `decided_pair_check`
    // cũng vỡ nếu để decided_* NULL ⇒ ghi đủ cặp quyết định để chỉ còn status_check là vế sai.
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties
             (user_id, kind, amount, period_month, reason, status, decided_by, decided_at, created_by)
           VALUES ($1, 'bonus', 100.00, '2026-05', 'x', 'draft', $2, now(), $1)`,
          [emp, approver],
        );
      }),
    ).rejects.toThrow(/bonus_penalties_status_check/i);
  });

  it("CHECK reason NOT NULL — lý do là BẮT BUỘC (PL-02)", async () => {
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties (user_id, kind, amount, period_month, created_by)
           VALUES ($1, 'bonus', 100.00, '2026-05', $1)`,
          [emp],
        );
      }),
    ).rejects.toThrow(/reason/i);
  });

  it("CHECK Rejected BẮT BUỘC decision_note", async () => {
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties
             (user_id, kind, amount, period_month, reason, status, decided_by, decided_at, created_by)
           VALUES ($1, 'bonus', 100.00, '2026-05', 'x', 'Rejected', $2, now(), $1)`,
          [emp, approver],
        );
      }),
    ).rejects.toThrow(/bonus_penalties_reject_note_check/i);
  });

  it("CHECK consume CHỈ cho hàng Approved (chống gộp hàng chưa duyệt vào lương)", async () => {
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties
             (user_id, kind, amount, period_month, reason, status, payroll_period_id, consumed_at, created_by)
           VALUES ($1, 'bonus', 100.00, '2026-05', 'x', 'Pending', $2, now(), $1)`,
          [emp, periodId],
        );
      }),
    ).rejects.toThrow(/bonus_penalties_consume_approved_check/i);
  });

  it("CHECK cặp consume: payroll_period_id ↔ consumed_at cùng NULL hoặc cùng set", async () => {
    await expect(
      asApp(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO bonus_penalties
             (user_id, kind, amount, period_month, reason, status, decided_by, decided_at,
              payroll_period_id, created_by)
           VALUES ($1, 'bonus', 100.00, '2026-05', 'x', 'Approved', $2, now(), $3, $1)`,
          [emp, approver, periodId],
        );
      }),
    ).rejects.toThrow(/bonus_penalties_consumed_pair_check/i);
  });
});
