import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import { D, type Dec } from "../../src/payroll/formula/formula.decimal";
import { Budget } from "../../src/payroll/formula/formula.evaluator";
import {
  compileGraph,
  evaluatePass,
  type GraphComponent,
} from "../../src/payroll/formula/formula.graph";
import { toStatutoryValues } from "../../src/payroll/formula/formula.statutory";
import { SYS_REFS, type SysRef } from "../../src/payroll/formula/formula.vocabulary";
import {
  PAYROLL_DEFAULT_TEMPLATE_CODE,
  PAYROLL_SYSTEM_COMPONENTS,
  PayrollMasterDataSeeder,
} from "../../src/payroll/payroll-master-data.seeder";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";

/**
 * S15-PAYROLL-DB-1B (mig 0574) — CHỐT HỒI QUY cho ba việc của WO (plan `docs/plans/S15-PAYROLL-DB-1B.md` §6.1):
 *  F. công thức seed `LUONG_CO_BAN` (tử số present + unpaid, kẹp trần) + assert seeder (5)(7) + index RI;
 *  B. nhánh (F) của `enforce_bonus_penalty_freeze` — nhả/gắn consume CHỈ khi kỳ ∈ {CollectingData, Calculated},
 *     trigger bắn cả INSERT, message `<trigger>:<tag>:` với tag ĐÓNG.
 *
 * QUY TẮC: mỗi ca DENY có ALLOW đứng trước (`deny-cases-vacuous-without-allow-case`); ca trigger assert đúng TAG;
 * MỌI bước dựng trạng thái nằm NGOÀI `expect` — chỉ câu DENY ở trong (plan §3.8 B-1: dựng trong promise `rejects`
 * thì bước dựng tự nổ và ca xanh-RỖNG). CẤM tắt trigger `bonus_penalties` trong fixture.
 * Ca âm của seeder assert `outcome.ok === false` — runner NUỐT throw (khuôn `s15-payroll-be2-seed`).
 */

type PgErr = { code?: string; message: string };

const OLD_BASE_FORMULA = "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS";
const NEW_BASE_FORMULA =
  "MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100";
const TRIGGER = "bonus_penalty_freeze_guard";
const LIVE_STATUSES = ["CollectingData", "Calculated"] as const;
const FROZEN_STATUSES = ["Draft", "Reviewing", "Approved", "Published", "Paid", "Locked"] as const;

let monthSeq = 0;
/** Tháng riêng cho mỗi kỳ fixture — unique `(company_id, period_month)` ở kỳ lương lẫn kỳ công. */
function nextMonth(): string {
  const i = monthSeq++;
  return `${2050 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

function expectTag(err: PgErr | null, tag: string): void {
  expect(err, `${TRIGGER}:${tag} phải NÉM`).not.toBeNull();
  expect(err?.code, err?.message).toBe("23514");
  expect(err?.message.startsWith(`${TRIGGER}:${tag}:`), err?.message).toBe(true);
}

// ── Số học CHÍNH XÁC (BigInt): tiền ×100 (xu), ngày ×10. Mọi giá trị ≥ 0 ⇒ HALF_UP = (2·num + den) / (2·den). ──
const scaled = (s: string, scale: number): bigint => {
  const [i, f = ""] = s.split(".");
  return BigInt(i + f.padEnd(scale, "0").slice(0, scale));
};
const halfUp = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);
const isTie = (num: bigint, den: bigint): boolean => 2n * (num % den) === den;
const cents = (x: bigint): string => `${x / 100n}.${String(x % 100n).padStart(2, "0")}`;

interface GridCase {
  readonly b: string;
  readonly p: string;
  readonly u: string;
  readonly w: string;
}

function exactOf(c: GridCase): { base: string; baseTie: boolean; ded: string; dedTie: boolean } {
  const B = scaled(c.b, 2);
  const P = scaled(c.p, 1) + scaled(c.u, 1);
  const U = scaled(c.u, 1);
  const W = scaled(c.w, 1);
  const [baseNum, baseDen] = P > W ? [B, 1n] : [B * P, W];
  return {
    base: cents(halfUp(baseNum, baseDen)),
    baseTie: isTie(baseNum, baseDen),
    ded: cents(halfUp(B * U, W)),
    dedTie: isTie(B * U, W),
  };
}

const STATUTORY = toStatutoryValues({
  siEmployeePct: "8.00",
  hiEmployeePct: "1.50",
  uiEmployeePct: "1.00",
  siEmployerPct: "17.50",
  hiEmployerPct: "3.00",
  uiEmployerPct: "1.00",
  unionEmployerPct: "2.00",
  unionEmployeePct: "1.00",
  siCap: "46800000.00",
  hiCap: "46800000.00",
  uiCap: "99200000.00",
  personalDeduction: "11000000.00",
  dependentDeduction: "4400000.00",
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: 10000000, rate: 10 },
    { upTo: 18000000, rate: 15 },
    { upTo: 32000000, rate: 20 },
    { upTo: 52000000, rate: 25 },
    { upTo: 80000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
});

/** Đồ thị hai thành phần lấy THẲNG từ hằng seeder — công thức đang seed, không phải bản chép lại. */
function seedGraph() {
  const pick = (code: string): GraphComponent => {
    const c = PAYROLL_SYSTEM_COMPONENTS.find((x) => x.code === code);
    if (!c) throw new Error(`hằng seeder thiếu ${code}`);
    return {
      code: c.code,
      kind: c.kind,
      valueType: c.valueType,
      formula: c.formula,
      fixedAmount: null,
      pitDeductible: c.pitDeductible,
    };
  };
  return compileGraph([pick("LUONG_CO_BAN"), pick("NGHI_KHONG_LUONG")], {
    requireEngineNodes: false,
  });
}

function engineOf(graph: ReturnType<typeof seedGraph>, c: GridCase): { base: string; ded: string } {
  const sys = Object.fromEntries(SYS_REFS.map((k) => [k, new D(0)])) as Record<SysRef, Dec>;
  sys.SYS_BASE_SALARY = new D(c.b);
  sys.SYS_PRESENT_DAYS = new D(c.p);
  sys.SYS_UNPAID_LEAVE_DAYS = new D(c.u);
  sys.SYS_WORK_DAYS = new D(c.w);
  sys.SYS_PAY_RATIO = new D(100); // v1 không có hệ số trả lương ⇒ đối chứng ở 100%
  const out = evaluatePass(
    graph,
    { sys, profileItems: {}, pitPayer: "EMPLOYEE", statutory: STATUTORY },
    new Budget(),
  );
  return {
    base: (out.get("LUONG_CO_BAN") as Dec).toFixed(2),
    // S15-PAYROLL-BE-3 (O-5, seedVersion v4): NGHI_KHONG_LUONG là `earning` ÂM — oracle so TRỊ TUYỆT ĐỐI của khoản trừ
    // (ROUND_HALF_UP đối xứng quanh 0 ⇒ |v4| = v3 từng xu; formula.line.spec.ts ghim riêng).
    ded: (out.get("NGHI_KHONG_LUONG") as Dec).abs().toFixed(2),
  };
}

function buildGrid(): GridCase[] {
  const bases = [
    "22000000.00",
    "15000000.50",
    "9876543.21",
    "1000000.03",
    "123456789.99",
    "7333333.33",
  ];
  const works = [20, 21, 22, 23, 26, 31];
  const unpaids = ["0", "0.5", "2", "7.5"];
  const out: GridCase[] = [];
  for (const b of bases) {
    for (const w of works) {
      for (let p2 = 0; p2 <= (w + 1) * 2; p2 += 1) {
        for (const u of unpaids) {
          out.push({ b, p: (p2 / 2).toFixed(1), u, w: String(w) });
        }
      }
    }
  }
  return out;
}

describe.skipIf(!hasDb)(
  "S15-PAYROLL-DB-1B · công thức seed + assert (5)(7) + index + bonus (F)",
  () => {
    const direct = directPool();
    const app = appPool();
    const companies: string[] = [];
    let runner: MasterDataSeedRunner;

    beforeAll(() => {
      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new PayrollMasterDataSeeder());
      runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
    });

    afterAll(async () => {
      await cleanupTenants(direct, companies);
      await direct.end();
      await app.end();
    });

    async function newCompany(label: string): Promise<string> {
      const t = await seedCompany(direct, label);
      companies.push(t.companyId);
      return t.companyId;
    }

    async function reconcile(companyId: string): Promise<{ ok: boolean; error: string }> {
      const outcomes = await runner.reconcileCompany(companyId);
      return {
        ok: outcomes.every((o) => o.ok),
        error: outcomes.map((o) => o.error ?? "").join(" | "),
      };
    }

    async function freshSeeded(label: string): Promise<string> {
      const c = await newCompany(label);
      const r = await reconcile(c);
      expect(r.ok, r.error).toBe(true);
      return c;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // F. Công thức seed LUONG_CO_BAN + assert seeder + index
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("F. công thức seed + assert (5)(7) + index RI", () => {
      it("F1 — công ty mới ⇒ LUONG_CO_BAN mang công thức MỚI (tử số present + unpaid, kẹp trần); reconcile ok", async () => {
        const c = await freshSeeded("db1bf1");
        const { rows } = await direct.query<{ formula: string }>(
          `SELECT formula FROM salary_components
          WHERE company_id = $1 AND code = 'LUONG_CO_BAN' AND is_system AND deleted_at IS NULL`,
          [c],
        );
        expect(rows.map((r) => r.formula)).toEqual([NEW_BASE_FORMULA]);
      });

      it("F2 — engine (HẰNG seeder) == số học CHÍNH XÁC 100%; v1 (Postgres) chỉ lệch ≤ 1 xu ở ca HOÀ nửa xu", async () => {
        const grid = buildGrid();
        const graph = seedGraph();

        // Biểu thức v1 NGUYÊN VĂN (payroll-calc.repository.ts), kiểu `numeric` TƯỜNG MINH qua jsonb_to_recordset
        // (plan §3.8 M-4 — cột VALUES toàn số nguyên sẽ chia NGUYÊN và đỏ oan).
        const { rows } = await direct.query<{ i: number; base: string; ded: string }>(
          `SELECT t.i,
                round(t.b * least((t.p + t.u) / nullif(t.w, 0), 1), 2)::text AS base,
                round(t.u * (t.b / nullif(t.w, 0)), 2)::text AS ded
           FROM jsonb_to_recordset($1::jsonb) AS t(i int, b numeric(18,2), p numeric, u numeric, w numeric)
          ORDER BY t.i`,
          [JSON.stringify(grid.map((g, i) => ({ i, ...g })))],
        );
        expect(rows.length).toBe(grid.length);

        const engineVsExact: string[] = [];
        const v1NonTie: string[] = [];
        const v1TieOverOneCent: string[] = [];
        let ties = 0;
        rows.forEach((r, i) => {
          const c = grid[i];
          const e = exactOf(c);
          const eng = engineOf(graph, c);
          if (eng.base !== e.base || eng.ded !== e.ded) {
            engineVsExact.push(
              `${JSON.stringify(c)} eng=${eng.base}/${eng.ded} exact=${e.base}/${e.ded}`,
            );
          }
          for (const [v1, ex, tie] of [
            [r.base, e.base, e.baseTie],
            [r.ded, e.ded, e.dedTie],
          ] as const) {
            if (tie) ties++;
            if (v1 === ex) continue;
            const diff = scaled(v1, 2) - scaled(ex, 2);
            if (!tie) v1NonTie.push(`${JSON.stringify(c)} v1=${v1} exact=${ex}`);
            else if (diff !== 1n && diff !== -1n)
              v1TieOverOneCent.push(`${JSON.stringify(c)} v1=${v1} exact=${ex}`);
          }
        });

        expect(
          engineVsExact.slice(0, 5),
          `engine lệch số học chính xác ở ${engineVsExact.length} ca`,
        ).toEqual([]);
        expect(v1NonTie.slice(0, 5), `v1 lệch ở ca KHÔNG hoà (${v1NonTie.length})`).toEqual([]);
        expect(v1TieOverOneCent.slice(0, 5)).toEqual([]);
        // Neo chống xanh-RỖNG: lưới PHẢI chứa ca hoà — không có thì vế (ii) không đo gì.
        expect(ties).toBeGreaterThan(0);

        // Neo tay (SPEC-11 §13.4): 18/2/22 · 22tr ⇒ base 20.000.000 + khấu trừ 2.000.000; 23/0/22 kẹp trần.
        expect(engineOf(graph, { b: "22000000.00", p: "18", u: "2", w: "22" })).toEqual({
          base: "20000000.00",
          ded: "2000000.00",
        });
        expect(engineOf(graph, { b: "22000000.00", p: "23", u: "0", w: "22" }).base).toBe(
          "22000000.00",
        );
        expect(engineOf(graph, { b: "22000000.00", p: "20", u: "3", w: "22" }).base).toBe(
          "22000000.00",
        );
      });

      it("F3 — assert (7) ĐỎ: hàng hệ thống LUONG_CO_BAN mang chuỗi CŨ ⇒ ok=false, báo ĐÍCH DANH mã + trường", async () => {
        const c = await newCompany("db1bf3");
        // Không DDL: chèn sẵn hàng hệ thống mang chuỗi cũ TRƯỚC lượt reconcile đầu (freeze chỉ BEFORE UPDATE)
        // ⇒ `ON CONFLICT DO NOTHING` của seeder giữ nguyên nó — đúng hình dạng một công ty seed trước 0574.
        await direct.query(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula, is_system, sort_order)
         VALUES ($1, 'LUONG_CO_BAN', 'Lương cơ bản', 'earning', 'formula', $2, true, 10)`,
          [c, OLD_BASE_FORMULA],
        );
        const r = await reconcile(c);
        expect(r.ok).toBe(false);
        // Ghim đúng CẶP `<mã>.<trường>` của (7) — hai toContain rời xanh oan với bất kỳ lỗi nào nhắc cả hai từ.
        expect(r.error).toContain("LUONG_CO_BAN.formula");
      });

      it("F3b — ĐỐI CHỨNG DƯƠNG F3: đổi `name` hàng hệ thống (người dùng được phép) ⇒ ok=true", async () => {
        const c = await freshSeeded("db1bf3b");
        await direct.query(
          `UPDATE salary_components SET name = 'Lương cơ bản (đổi tên)', sort_order = 11
          WHERE company_id = $1 AND code = 'LUONG_CO_BAN'`,
          [c],
        );
        const r = await reconcile(c);
        expect(r.ok, r.error).toBe(true);
      });

      it("F4 — assert (5) ĐỎ: ghi đè công thức trong MAU_MAC_DINH REF mã không tồn tại ⇒ ok=false", async () => {
        const c = await freshSeeded("db1bf4");
        const upd = await direct.query(
          `UPDATE payroll_template_components ptc SET formula_override = 'MA_KHONG_TON_TAI * 2'
           FROM payroll_templates pt, salary_components sc
          WHERE ptc.company_id = $1 AND pt.company_id = ptc.company_id AND pt.id = ptc.template_id AND pt.code = $2
            AND sc.company_id = ptc.company_id AND sc.id = ptc.component_id AND sc.code = 'LUONG_CO_BAN'`,
          [c, PAYROLL_DEFAULT_TEMPLATE_CODE],
        );
        expect(upd.rowCount).toBe(1);
        const r = await reconcile(c);
        expect(r.ok).toBe(false);
        // Ghim ĐÚNG assert (5) — ok=false do assert khác ném (vd (7)) thì ca này xanh oan.
        expect(r.error).toContain("mẫu mặc định KHÔNG biên dịch được");
      });

      it("F4b — ĐỐI CHỨNG DƯƠNG F4: chỉnh sửa HỢP LỆ kiểu 053 (override đúng + gỡ thành phần không-engine) ⇒ ok=true", async () => {
        const c = await freshSeeded("db1bf4b");
        await direct.query(
          `UPDATE payroll_template_components ptc SET formula_override = 'SYS_BASE_SALARY * SYS_PAY_RATIO / 100'
           FROM payroll_templates pt, salary_components sc
          WHERE ptc.company_id = $1 AND pt.company_id = ptc.company_id AND pt.id = ptc.template_id AND pt.code = $2
            AND sc.company_id = ptc.company_id AND sc.id = ptc.component_id AND sc.code = 'LUONG_CO_BAN'`,
          [c, PAYROLL_DEFAULT_TEMPLATE_CODE],
        );
        const del = await direct.query(
          `DELETE FROM payroll_template_components
          WHERE company_id = $1 AND component_id = (SELECT id FROM salary_components WHERE company_id = $1 AND code = 'KPCD')`,
          [c],
        );
        expect(del.rowCount).toBe(1);
        const r = await reconcile(c);
        expect(r.ok, r.error).toBe(true);
      });

      it("F5 — index RI (company_id, component_id) trên payroll_template_components: ghim ĐỊNH NGHĨA, không chỉ tên", async () => {
        const { rows } = await direct.query<{ def: string }>(
          `SELECT pg_get_indexdef(i.indexrelid) AS def
           FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = 'payroll_template_components_company_component_idx'`,
        );
        expect(rows.map((r) => r.def)).toEqual([
          "CREATE INDEX payroll_template_components_company_component_idx ON public.payroll_template_components USING btree (company_id, component_id)",
        ]);
      });

      it("F6 — journal có 0574 và file migration tồn tại", () => {
        const dir = path.join(__dirname, "..", "..", "migrations");
        const tag = "0574_s15payrolldb1b_seed_formula_bp_period_guard";
        const journal = JSON.parse(
          fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
        ) as {
          entries: Array<{ tag: string }>;
        };
        expect(journal.entries.map((e) => e.tag)).toContain(tag);
        expect(fs.existsSync(path.join(dir, `${tag}.sql`))).toBe(true);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // B. bonus_penalties — nhánh (F): nhả/gắn consume CHỈ khi kỳ còn tính lại được
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("B. enforce_bonus_penalty_freeze (F) + INSERT + tag", () => {
      let A: string;
      let Bco: string;
      let emp: string;
      let approver: string;
      let submitter: string;
      let bApprover: string;
      let bSubmitter: string;

      beforeAll(async () => {
        A = await newCompany("db1bba");
        Bco = await newCompany("db1bbb");
        emp = await seedUser(direct, A, `bp-emp-${randomUUID().slice(0, 8)}@a.test`);
        approver = await seedUser(direct, A, `bp-apr-${randomUUID().slice(0, 8)}@a.test`);
        submitter = await seedUser(direct, A, `bp-sub-${randomUUID().slice(0, 8)}@a.test`);
        bApprover = await seedUser(direct, Bco, `bp-apr-${randomUUID().slice(0, 8)}@b.test`);
        bSubmitter = await seedUser(direct, Bco, `bp-sub-${randomUUID().slice(0, 8)}@b.test`);
      });

      /** Vết theo trạng thái — cùng logic CASE cho INSERT lẫn UPDATE (thoả mọi CHECK cặp của 0572). */
      const traceFlags = (status: string) => {
        const has = (xs: string[]) => xs.includes(status);
        return [
          has(["Reviewing", "Approved", "Published", "Paid", "Locked"]),
          has(["Approved", "Published", "Paid", "Locked"]),
          has(["Published", "Paid", "Locked"]),
          has(["Paid", "Locked"]),
          status === "Locked",
        ];
      };

      async function mkPeriod(
        companyId: string,
        status: string,
        sub = submitter,
        apr = approver,
      ): Promise<string> {
        const m = nextMonth();
        const ap = await direct.query<{ id: string }>(
          `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
          [companyId, m],
        );
        const r = await direct.query<{ id: string }>(
          `INSERT INTO payroll_periods
           (company_id, period_month, status, attendance_period_id,
            submitted_by, submitted_at, approved_by, approved_at, published_by, published_at,
            paid_by, paid_at, locked_by, locked_at)
         VALUES ($1, $2, $3, $4,
            CASE WHEN $5::boolean THEN $10::uuid END,  CASE WHEN $5::boolean THEN now() END,
            CASE WHEN $6::boolean THEN $11::uuid END,  CASE WHEN $6::boolean THEN now() END,
            CASE WHEN $7::boolean THEN $11::uuid END,  CASE WHEN $7::boolean THEN now() END,
            CASE WHEN $8::boolean THEN $11::uuid END,  CASE WHEN $8::boolean THEN now() END,
            CASE WHEN $9::boolean THEN $11::uuid END,  CASE WHEN $9::boolean THEN now() END)
         RETURNING id`,
          [companyId, m, status, ap.rows[0].id, ...traceFlags(status), sub, apr],
        );
        return r.rows[0].id;
      }

      /** Đưa kỳ sang trạng thái đích qua `direct` (bảng kỳ KHÔNG có trigger — 0572 khối 1d) + vết khớp CHECK. */
      async function movePeriod(periodId: string, status: string): Promise<void> {
        await direct.query(
          `UPDATE payroll_periods SET status = $2,
            submitted_by = CASE WHEN $3::boolean THEN $8::uuid END, submitted_at = CASE WHEN $3::boolean THEN now() END,
            approved_by  = CASE WHEN $4::boolean THEN $9::uuid END, approved_at  = CASE WHEN $4::boolean THEN now() END,
            published_by = CASE WHEN $5::boolean THEN $9::uuid END, published_at = CASE WHEN $5::boolean THEN now() END,
            paid_by      = CASE WHEN $6::boolean THEN $9::uuid END, paid_at      = CASE WHEN $6::boolean THEN now() END,
            locked_by    = CASE WHEN $7::boolean THEN $9::uuid END, locked_at    = CASE WHEN $7::boolean THEN now() END
          WHERE id = $1`,
          [periodId, status, ...traceFlags(status), submitter, approver],
        );
        const { rows } = await direct.query<{ status: string }>(
          `SELECT status FROM payroll_periods WHERE id = $1`,
          [periodId],
        );
        expect(rows[0].status).toBe(status);
      }

      /** Khoản thưởng qua `direct`. Có `periodId` ⇒ INSERT đã-consume (chỉ hợp lệ khi kỳ đang sống — nhánh INSERT). */
      async function mkBonus(
        companyId: string,
        opts: { status?: "Pending" | "Approved"; periodId?: string } = {},
      ) {
        const status = opts.status ?? "Approved";
        const decided = status === "Approved";
        const user = companyId === A ? emp : bApprover;
        const decider = companyId === A ? approver : bSubmitter;
        const r = await direct.query<{ id: string }>(
          `INSERT INTO bonus_penalties
           (company_id, user_id, kind, amount, period_month, reason, status, created_by,
            decided_by, decided_at, payroll_period_id, consumed_at)
         VALUES ($1, $2, 'bonus', 500.00, '2050-01', 'fixture DB-1B', $3, $2,
                 $4, CASE WHEN $5::boolean THEN now() END, $6, CASE WHEN $6::uuid IS NOT NULL THEN now() END)
         RETURNING id`,
          [companyId, user, status, decided ? decider : null, decided, opts.periodId ?? null],
        );
        return r.rows[0].id;
      }

      async function bindDirect(bonusId: string, periodId: string): Promise<void> {
        const r = await direct.query(
          `UPDATE bonus_penalties SET payroll_period_id = $2, consumed_at = now() WHERE id = $1`,
          [bonusId, periodId],
        );
        expect(r.rowCount).toBe(1);
      }

      /** Một câu qua app role trong ngữ cảnh tenant, ROLLBACK luôn — trả lỗi thay vì ném. */
      async function asApp(
        companyId: string,
        text: string,
        params: unknown[],
      ): Promise<{ err: PgErr | null; n: number }> {
        const c: PoolClient = await app.connect();
        try {
          await c.query("BEGIN");
          await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
          try {
            const r = await c.query(text, params);
            return { err: null, n: r.rowCount ?? 0 };
          } catch (e) {
            return { err: e as PgErr, n: 0 };
          }
        } finally {
          await c.query("ROLLBACK").catch(() => undefined);
          c.release();
        }
      }

      const RELEASE = `UPDATE bonus_penalties SET payroll_period_id = NULL, consumed_at = NULL WHERE id = $1`;
      const BIND = `UPDATE bonus_penalties SET payroll_period_id = $2, consumed_at = now() WHERE id = $1`;

      it.each(LIVE_STATUSES)("B1 ALLOW — nhả consume khi kỳ đang %s", async (status) => {
        const p = await mkPeriod(A, "CollectingData");
        const id = await mkBonus(A);
        await bindDirect(id, p);
        await movePeriod(p, status);
        const r = await asApp(A, RELEASE, [id]);
        expect(r.err?.message ?? null).toBeNull();
        expect(r.n).toBe(1);
      });

      it.each(LIVE_STATUSES)(
        "B2 ALLOW — gắn consume (NULL → kỳ) khi kỳ đang %s",
        async (status) => {
          const p = await mkPeriod(A, status);
          const id = await mkBonus(A);
          const r = await asApp(A, BIND, [id, p]);
          expect(r.err?.message ?? null).toBeNull();
          expect(r.n).toBe(1);
        },
      );

      it.each(FROZEN_STATUSES)(
        "B3 DENY — nhả consume khỏi kỳ ĐÃ %s ⇒ period-frozen (trừ lương hai lần)",
        async (status) => {
          // Dựng theo ĐƯỜNG THẬT (plan §3.8 B-1): gắn khi kỳ còn CollectingData → đẩy trạng thái kỳ → xác nhận.
          const p = await mkPeriod(A, "CollectingData");
          const id = await mkBonus(A);
          await bindDirect(id, p);
          await movePeriod(p, status);
          const { rows } = await direct.query<{ pid: string }>(
            `SELECT payroll_period_id AS pid FROM bonus_penalties WHERE id = $1`,
            [id],
          );
          expect(rows[0].pid).toBe(p);

          const r = await asApp(A, RELEASE, [id]);
          expectTag(r.err, "period-frozen");
        },
      );

      it.each(FROZEN_STATUSES)(
        "B4 DENY — gắn consume vào kỳ %s ⇒ period-frozen (consumed mà không vào dòng lương)",
        async (status) => {
          const p = await mkPeriod(A, status);
          const id = await mkBonus(A);
          const r = await asApp(A, BIND, [id, p]);
          expectTag(r.err, "period-frozen");
        },
      );

      it("B5 ALLOW — INSERT khoản đã consume vào kỳ CollectingData", async () => {
        const p = await mkPeriod(A, "CollectingData");
        const id = await mkBonus(A, { periodId: p });
        expect(id).toBeTruthy();
      });

      it("B5 DENY — INSERT khoản đã consume vào kỳ Locked ⇒ period-frozen (trigger bắn cả INSERT)", async () => {
        const p = await mkPeriod(A, "Locked");
        let err: PgErr | null = null;
        try {
          await mkBonus(A, { periodId: p });
        } catch (e) {
          err = e as PgErr;
        }
        expectTag(err, "period-frozen");
      });

      it("B6 DENY — gắn vào kỳ của CÔNG TY KHÁC ⇒ not-found (trigger bắn TRƯỚC composite FK)", async () => {
        const foreign = await mkPeriod(Bco, "CollectingData", bSubmitter, bApprover);
        const id = await mkBonus(A);
        let err: PgErr | null = null;
        try {
          await direct.query(BIND, [id, foreign]);
        } catch (e) {
          err = e as PgErr;
        }
        expectTag(err, "not-found");
      });

      it("B7 — tag của nhánh (A)(C)(E): frozen · rebind · status-terminal", async () => {
        const approved = await mkBonus(A);
        expectTag(
          (await asApp(A, `UPDATE bonus_penalties SET amount = 1.00 WHERE id = $1`, [approved]))
            .err,
          "frozen",
        );

        const p1 = await mkPeriod(A, "CollectingData");
        const p2 = await mkPeriod(A, "CollectingData");
        const bound = await mkBonus(A);
        await bindDirect(bound, p1);
        expectTag(
          (
            await asApp(A, `UPDATE bonus_penalties SET payroll_period_id = $2 WHERE id = $1`, [
              bound,
              p2,
            ])
          ).err,
          "rebind",
        );

        expectTag(
          (
            await asApp(A, `UPDATE bonus_penalties SET status = 'Pending' WHERE id = $1`, [
              approved,
            ])
          ).err,
          "status-terminal",
        );
      });

      it("B9 DENY — gắn vào kỳ CollectingData ĐÃ XOÁ MỀM ⇒ not-found (máy tính không bao giờ chạm kỳ đó)", async () => {
        const p = await mkPeriod(A, "CollectingData");
        await direct.query(`UPDATE payroll_periods SET deleted_at = now() WHERE id = $1`, [p]);
        const id = await mkBonus(A);
        const r = await asApp(A, BIND, [id, p]);
        expectTag(r.err, "not-found");
      });

      it("B9c DENY — INSERT khoản đã consume vào kỳ CollectingData ĐÃ XOÁ MỀM ⇒ not-found (nhánh INSERT cũng lọc)", async () => {
        const p = await mkPeriod(A, "CollectingData");
        await direct.query(`UPDATE payroll_periods SET deleted_at = now() WHERE id = $1`, [p]);
        let err: PgErr | null = null;
        try {
          await mkBonus(A, { periodId: p });
        } catch (e) {
          err = e as PgErr;
        }
        expectTag(err, "not-found");
      });

      it("B9b ALLOW — nhả khỏi kỳ CollectingData đã xoá mềm (vẫn cứu khoản ra được)", async () => {
        const p = await mkPeriod(A, "CollectingData");
        const id = await mkBonus(A);
        await bindDirect(id, p);
        await direct.query(`UPDATE payroll_periods SET deleted_at = now() WHERE id = $1`, [p]);
        const r = await asApp(A, RELEASE, [id]);
        expect(r.err?.message ?? null).toBeNull();
        expect(r.n).toBe(1);
      });

      it("B-neo — trigger bắn cho CẢ INSERT lẫn UPDATE (BEFORE, ROW) và đang bật", async () => {
        const { rows } = await direct.query<{ tgtype: number; tgenabled: string }>(
          `SELECT t.tgtype, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname = 'bonus_penalties' AND t.tgname = $1`,
          [TRIGGER],
        );
        // 1 ROW | 2 BEFORE | 4 INSERT | 16 UPDATE = 23 (không DELETE/TRUNCATE).
        expect(rows).toEqual([{ tgtype: 23, tgenabled: "O" }]);
      });
    });
  },
);
