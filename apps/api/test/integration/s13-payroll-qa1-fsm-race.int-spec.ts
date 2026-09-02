/**
 * S13-PAYROLL-QA-1 — FSM kỳ lương ĐO Ở TẦNG HTTP + đua ghi (SPEC-11 §13.1 · §20).
 *
 * LỖ ĐO ĐƯỢC 2026-09-01. `payroll-fsm.spec.ts` đã phủ **49 ô (7×7)** nhưng là ĐƠN VỊ trên hàm thuần:
 * nó chứng minh `assertPeriodTransition` đúng, KHÔNG chứng minh 9 route hành động thật sự GỌI nó.
 * `payroll-be2-lifecycle.int-spec.ts` đi đường hạnh phúc + vài ô lẻ (D3/D4/D5). Một route quên
 * `resolveActionTarget` (hoặc gọi sau khi đã ghi) sẽ lọt qua CẢ HAI — và DB **không đỡ giúp**: mig
 * `0564` đã DROP trigger `payroll_period_status_guard`, CHECK chỉ ràng TẬP giá trị + cặp cột vết
 * (`check-cannot-enforce-fsm-transitions`).
 *
 * A. **MA TRẬN 9 action × 7 trạng thái = 63 ô, đo qua ĐÚNG route thật.** Mỗi ô: nạp lại hàng kỳ về
 *    hình dạng chuẩn của trạng thái đó (SQL, thoả MỌI CHECK của `0564`) rồi bắn route.
 *    · ô CẤM  ⇒ 409 + `error.code` bằng ĐÚNG mã mà THỨ TỰ CỔNG của service quy định (bảng dưới);
 *    · ô CHO  ⇒ **không** `PAYROLL-ERR-001` (ALLOW đối chứng — thiếu vế này thì một service
 *      luôn-409 cũng làm 63 ô xanh: `deny-cases-vacuous-without-allow-case`).
 *
 *    ⚠️ **THỨ TỰ CỔNG LÀ HỢP ĐỒNG, không phải chi tiết thi công** — đo tại chỗ 2026-09-01, mỗi vế có
 *    lý do đã ghi trong src, và đảo thứ tự sẽ giết một mã lỗi:
 *      · `calculate` — `FROZEN_STATUSES` (`payroll-calc.service.ts:79`) chạy TRƯỚC FSM ⇒ Approved/
 *        Paid/Locked cho **003**, không phải 001. Để FSM bắt trước thì 003 thành mã CHẾT.
 *      · `reopen` — `assertReopenAllowed` (`payroll-approval.service.ts:253`) chạy TRƯỚC FSM ⇒
 *        Paid/Locked cho **004**. Đây là cổng chống "kỳ về CollectingData khi đã có phiếu".
 *      · `publish` — `NO_PAYSLIP` (`payroll-payslips.service.ts:140`) chạy TRƯỚC FSM; fixture mục A
 *        CỐ Ý không sinh phiếu ⇒ **007** ở MỌI trạng thái, kể cả ô CHO (`Approved`).
 *      · `approve` — four-eyes chạy TRƯỚC FSM nhưng chỉ nổ khi `submitted_by === actor`; fixture đặt
 *        `submitted_by` là NGƯỜI KHÁC nên cổng đó im, và ô cấm hiện đúng 001.
 *      · `generate-payslips` — nhánh no-op 200 chỉ khi `payslips_generated_at` khác NULL; fixture để
 *        NULL nên nhánh đó không che ô nào.
 *
 * B. **ĐUA GHI** (`Promise.all`, HAI chủ thể khác nhau): double-submit · double-generate ·
 *    double-publish · double-calculate. Bất biến: **ĐÚNG-MỘT-THẮNG**, không 5xx, không hàng nhân bản.
 *    Row-lock `SELECT … FOR UPDATE` ở đầu mọi action là thứ đang được đo.
 *
 * ⚠️ `await app.listen(0)` NGAY SAU `app.init()`: supertest tự `listen(0)` rồi tự `close()` khi
 *    request ĐẦU về ⇒ `Promise.all` ăn `ECONNRESET` (xanh cục bộ, đỏ CI — memory
 *    `supertest-closes-shared-server-on-first-response`). Hai chủ thể khác nhau cho mỗi cặp đua còn
 *    tránh rate-limit per-user tự bóp chính mình (`per-user-rate-limit-throttles-own-int-spec`).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { nextStatus, type PeriodAction } from "../../src/payroll/payroll-fsm";
import { PAYROLL_ROUTE_PAIRS } from "../../src/payroll/payroll-route-pairs.const";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s13payrollqa1fsm");

/** 7 trạng thái của `payrollPeriodStatusEnum` — nguồn cho trục đứng của ma trận. */
const STATUSES: readonly PayrollPeriodStatus[] = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Paid",
  "Locked",
];

/** 9 action chạm trạng thái + route thật của từng cái (trục ngang). */
const ACTIONS: ReadonlyArray<{
  action: PeriodAction;
  path: (id: string) => string;
  body?: Record<string, unknown>;
}> = [
  { action: "collect", path: (id) => `/payroll-periods/${id}/collect` },
  { action: "calculate", path: (id) => `/payroll-periods/${id}/calculate` },
  { action: "submit", path: (id) => `/payroll-periods/${id}/submit` },
  { action: "approve", path: (id) => `/payroll-periods/${id}/approve` },
  {
    action: "reject",
    path: (id) => `/payroll-periods/${id}/reject`,
    body: { reason: "qa s13 fsm matrix" },
  },
  { action: "generate-payslips", path: (id) => `/payroll-periods/${id}/generate-payslips` },
  { action: "publish", path: (id) => `/payroll-periods/${id}/publish` },
  { action: "lock", path: (id) => `/payroll-periods/${id}/lock` },
  {
    action: "reopen",
    path: (id) => `/payroll-periods/${id}/reopen`,
    body: { reason: "qa s13 fsm matrix" },
  },
];

const FROZEN: ReadonlySet<PayrollPeriodStatus> = new Set(["Approved", "Paid", "Locked"]);

/**
 * Mã lỗi PHẢI thấy ở một ô CẤM, theo THỨ TỰ CỔNG đã đo của service (xem docblock đầu file).
 * Viết thành hàm thay vì bảng chép tay để ô mới không lặng lẽ rơi về mặc định sai.
 */
function expectedDenyCode(action: PeriodAction, from: PayrollPeriodStatus): string {
  if (action === "calculate" && FROZEN.has(from)) return "PAYROLL-ERR-003";
  if (action === "reopen" && (from === "Paid" || from === "Locked")) return "PAYROLL-ERR-004";
  if (action === "publish") return "PAYROLL-ERR-007";
  return "PAYROLL-ERR-001";
}

describe.skipIf(!hasLaneDb)("S13-PAYROLL-QA-1 · FSM 9×7 ở tầng HTTP + đua ghi", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tActor: string;
  let tActor2: string;
  let actorUserId: string;
  let otherUserId: string;
  let attendancePeriodId: string;
  /** 1 kỳ / trạng thái (7 tháng riêng) — nạp lại hình dạng trước MỖI ô, xem `resetTo`. */
  const periodByStatus = new Map<PayrollPeriodStatus, string>();

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const get = (t: string, u: string) => auth(t)(http().get(u));

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Chủ thể giữ ĐỦ 16 cặp có route ở scope Company (sàn §13.5) — cặp đọc TỪ bảng hằng. */
  async function makeActor(label: string): Promise<{ userId: string; token: string }> {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    const roleId = await seedRole(direct, A.companyId, `s13pqa1fsm-${label}`);
    const pairs = new Map(
      Object.values(PAYROLL_ROUTE_PAIRS).map((p) => [`${p.action}:${p.resourceType}`, p] as const),
    );
    for (const p of pairs.values()) {
      const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
    return { userId, token: await login(email) };
  }

  /**
   * Nạp hàng kỳ về hình dạng CHUẨN của `status`, thoả MỌI CHECK của mig `0564`:
   *   `submitted_pair` (Reviewing↑) · `approved_pair` (Approved↑) · `published_pair` (Paid↑) ·
   *   `locked_pair` (Locked) · `calculated_needs_attendance` (rời Draft/CollectingData) ·
   *   `four_eyes` (approved_by ≠ submitted_by) · `generated_pair` (cả hai NULL ở đây).
   *
   * `submitted_by` LUÔN là `otherUserId` (KHÁC actor) — cổng four-eyes của `approve` chạy TRƯỚC FSM,
   * để actor tự gửi duyệt thì mọi ô `approve` cho 005 và ma trận mất nghĩa.
   * `payslips_generated_*` để NULL — nhánh no-op 200 của `generate-payslips` không được che ô nào.
   */
  async function resetTo(periodId: string, status: PayrollPeriodStatus): Promise<void> {
    const submitted = ["Reviewing", "Approved", "Paid", "Locked"].includes(status);
    const approved = ["Approved", "Paid", "Locked"].includes(status);
    const published = ["Paid", "Locked"].includes(status);
    const locked = status === "Locked";
    const calculated = status !== "Draft" && status !== "CollectingData";
    await direct.query(
      `UPDATE payroll_periods SET
         status = $2,
         attendance_period_id = $3,
         calculated_by = CASE WHEN $4 THEN $6::uuid ELSE NULL END,
         calculated_at = CASE WHEN $4 THEN now() ELSE NULL END,
         submitted_by  = CASE WHEN $5 THEN $7::uuid ELSE NULL END,
         submitted_at  = CASE WHEN $5 THEN now() ELSE NULL END,
         approved_by   = CASE WHEN $8 THEN $6::uuid ELSE NULL END,
         approved_at   = CASE WHEN $8 THEN now() ELSE NULL END,
         published_by  = CASE WHEN $9 THEN $6::uuid ELSE NULL END,
         published_at  = CASE WHEN $9 THEN now() ELSE NULL END,
         locked_by     = CASE WHEN $10 THEN $6::uuid ELSE NULL END,
         locked_at     = CASE WHEN $10 THEN now() ELSE NULL END,
         payslips_generated_by = NULL,
         payslips_generated_at = NULL
       WHERE id = $1`,
      [
        periodId,
        status,
        attendancePeriodId,
        calculated,
        submitted,
        actorUserId,
        otherUserId,
        approved,
        published,
        locked,
      ],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Xem docblock — BẮT BUỘC cho mục B (`Promise.all`).
    await app.listen(0);

    direct = directPool();
    A = await seedCompany(direct, "s13pqa1fsm");
    companyIds.push(A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    const a1 = await makeActor("actor");
    actorUserId = a1.userId;
    tActor = a1.token;
    const a2 = await makeActor("actor2");
    otherUserId = a2.userId;
    tActor2 = a2.token;

    // Người ĂN LƯƠNG (khác cả hai actor) — có hồ sơ lương ⇒ `calculate` sinh được dòng thật.
    const subjectId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, "x");
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
       VALUES ($1, $2, '2026-01-01', '12000000.00', '[]'::jsonb)`,
      [A.companyId, subjectId],
    );

    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, '2027-01', 'locked') RETURNING id`,
      [A.companyId],
    );
    attendancePeriodId = ap.rows[0].id;

    // 7 kỳ, 7 tháng riêng (unique partial `(company_id, period_month) WHERE deleted_at IS NULL`).
    for (const [i, status] of STATUSES.entries()) {
      const month = `2027-0${i + 1}`;
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
         VALUES ($1, $2, 'Draft', $3) RETURNING id`,
        [A.companyId, month, attendancePeriodId],
      );
      periodByStatus.set(status, r.rows[0].id);
      await resetTo(r.rows[0].id, status);
    }
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. Ma trận 63 ô qua route THẬT ───────────────────────────────────────────────────────────

  describe("A. 9 action × 7 trạng thái — route thật ép ĐÚNG bảng FSM", () => {
    const CELLS = ACTIONS.flatMap((a) =>
      STATUSES.map((from) => ({
        action: a.action,
        from,
        allowed: nextStatus(from, a.action) !== null,
        spec: a,
      })),
    );

    it.each(CELLS)(
      "$action @ $from (allowed=$allowed)",
      async ({ action, from, allowed, spec }) => {
        const id = periodByStatus.get(from)!;
        await resetTo(id, from);
        const res = await post(tActor, spec.path(id)).send(spec.body ?? {});
        const label = `${action} @ ${from} | ${res.status} ${JSON.stringify(res.body?.error ?? res.body)}`;

        if (!allowed) {
          expect(res.status, label).toBe(409);
          expect(res.body?.error?.code, label).toBe(expectedDenyCode(action, from));
          return;
        }
        // Ô CHO — FSM KHÔNG được chặn. Cổng khác (003/007/002/017…) vẫn có quyền nói không, nên
        // assert hẹp đúng vào điều đang đo thay vì đòi 2xx (sẽ ghim luôn cả nghiệp vụ không liên quan).
        expect(res.body?.error?.code, `${label} — ô HỢP LỆ không được trả 001`).not.toBe(
          "PAYROLL-ERR-001",
        );
      },
    );

    it("neo chống xanh-rỗng: ma trận có ĐÚNG 63 ô, trong đó 13 ô CHO và 50 ô CẤM", () => {
      const cells = ACTIONS.flatMap((a) =>
        STATUSES.map((from) => nextStatus(from, a.action) !== null),
      );
      expect(cells.length).toBe(63);
      // 10 ô ĐỔI trạng thái + 3 ô TẠI CHỖ = 13 (PERIOD_TRANSITIONS + IN_PLACE_ACTIONS).
      expect(cells.filter(Boolean).length).toBe(13);
      expect(cells.filter((x) => !x).length).toBe(50);
    });
  });

  // ── B. Đua ghi — ĐÚNG-MỘT-THẮNG, không 5xx ───────────────────────────────────────────────────

  describe("B. đua ghi đồng thời (Promise.all, HAI chủ thể) — đúng-một-thắng, không 5xx", () => {
    /** Kỳ RIÊNG cho mục B (tháng 2027-09..12) — không giẫm lên 7 kỳ của ma trận. */
    async function freshPeriod(month: string, status: PayrollPeriodStatus): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
         VALUES ($1, $2, 'Draft', $3) RETURNING id`,
        [A.companyId, month, attendancePeriodId],
      );
      const id = r.rows[0].id;
      await resetTo(id, status);
      return id;
    }

    const noServerError = (rs: request.Response[], label: string): void => {
      for (const r of rs) {
        expect(
          r.status,
          `${label} — 5xx là hỏng hạ tầng đua, không phải "đã chặn": ${r.text}`,
        ).toBeLessThan(500);
      }
    };

    it("double-submit ⇒ đúng MỘT 201, cái còn lại 409 001; kỳ dừng ở Reviewing", async () => {
      const id = await freshPeriod("2027-09", "Calculated");
      const rs = await Promise.all([
        post(tActor, `/payroll-periods/${id}/submit`).send({}),
        post(tActor2, `/payroll-periods/${id}/submit`).send({}),
      ]);
      noServerError(rs, "double-submit");
      expect(rs.filter((r) => r.status === 201).length, "phải đúng MỘT lượt thắng").toBe(1);
      const loser = rs.find((r) => r.status !== 201)!;
      expect(loser.status, JSON.stringify(loser.body)).toBe(409);
      expect(loser.body?.error?.code).toBe("PAYROLL-ERR-001");
      const row = await direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [id]);
      expect(row.rows[0].status).toBe("Reviewing");
    });

    it("double-calculate ⇒ không 5xx, KHÔNG dòng nhân bản (ON CONFLICT trúng partial index)", async () => {
      const id = await freshPeriod("2027-10", "CollectingData");
      const rs = await Promise.all([
        post(tActor, `/payroll-periods/${id}/calculate`).send({}),
        post(tActor2, `/payroll-periods/${id}/calculate`).send({}),
      ]);
      noServerError(rs, "double-calculate");
      // `calculate` là ô TẠI CHỖ ⇒ cả hai lượt đều hợp lệ; điều PHẢI đúng là số dòng KHÔNG nhân đôi.
      const lines = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payroll_period_lines
         WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      expect(Number(lines.rows[0].n), "1 nhân sự có hồ sơ lương ⇒ ĐÚNG 1 dòng").toBe(1);
    });

    it("double-generate-payslips ⇒ không 5xx, KHÔNG phiếu nhân bản (006 không được xảy ra)", async () => {
      const id = await freshPeriod("2027-11", "CollectingData");
      expect((await post(tActor, `/payroll-periods/${id}/calculate`).send({})).status).toBe(201);
      await resetTo(id, "Approved");
      const rs = await Promise.all([
        post(tActor, `/payroll-periods/${id}/generate-payslips`).send({}),
        post(tActor2, `/payroll-periods/${id}/generate-payslips`).send({}),
      ]);
      noServerError(rs, "double-generate");
      const slips = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payslips WHERE payroll_period_id = $1`,
        [id],
      );
      expect(Number(slips.rows[0].n), "1 dòng lương ⇒ ĐÚNG 1 phiếu, không 2").toBe(1);
    });

    it("double-publish ⇒ đúng MỘT 201; kẻ thua 409; kỳ dừng ở Paid (không nhảy quá)", async () => {
      const id = await freshPeriod("2027-12", "CollectingData");
      expect((await post(tActor, `/payroll-periods/${id}/calculate`).send({})).status).toBe(201);
      await resetTo(id, "Approved");
      expect((await post(tActor, `/payroll-periods/${id}/generate-payslips`).send({})).status).toBe(
        201,
      );
      const rs = await Promise.all([
        post(tActor, `/payroll-periods/${id}/publish`).send({}),
        post(tActor2, `/payroll-periods/${id}/publish`).send({}),
      ]);
      noServerError(rs, "double-publish");
      expect(rs.filter((r) => r.status === 201).length, "phải đúng MỘT lượt thắng").toBe(1);
      expect(rs.find((r) => r.status !== 201)!.status).toBe(409);
      const row = await direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [id]);
      expect(row.rows[0].status).toBe("Paid");
    });
  });

  // ── C. Hai đường "sau khi đã chốt" mà done_when của WO gọi tên riêng ─────────────────────────

  describe("C. tính lại SAU khi duyệt · mở lại SAU khi sinh phiếu", () => {
    it("recalc sau Approved ⇒ 409 003 (không phải 001) — mã 003 còn sống", async () => {
      const id = periodByStatus.get("Approved")!;
      await resetTo(id, "Approved");
      const res = await post(tActor, `/payroll-periods/${id}/calculate`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.error?.code).toBe("PAYROLL-ERR-003");
    });

    it("adjust-line sau Approved ⇒ 409 003 (cùng cổng đóng băng, đường GHI khác)", async () => {
      const id = periodByStatus.get("CollectingData")!;
      await resetTo(id, "CollectingData");
      expect((await post(tActor, `/payroll-periods/${id}/calculate`).send({})).status).toBe(201);
      const lines = await get(tActor, `/payroll-periods/${id}/lines`);
      expect(lines.status, JSON.stringify(lines.body)).toBe(200);
      const lineId = (lines.body.data as Array<{ id: string }>)[0].id;
      await resetTo(id, "Approved");
      const res = await auth(tActor)(http().patch(`/payroll-periods/${id}/lines/${lineId}`)).send({
        adjustmentAmount: 100_000,
        adjustmentReason: "qa s13",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.error?.code).toBe("PAYROLL-ERR-003");
    });

    it("reopen sau khi ĐÃ sinh phiếu ⇒ 409 004 `payslip-already-generated`, dù trạng thái CHO reopen", async () => {
      const id = periodByStatus.get("Calculated")!;
      await resetTo(id, "Approved");
      // Cờ đọc trên CHÍNH hàng kỳ (không đếm bảng `payslips`) — xem `assertReopenAllowed`.
      await direct.query(
        `UPDATE payroll_periods SET payslips_generated_by = $2, payslips_generated_at = now()
         WHERE id = $1`,
        [id, actorUserId],
      );
      const res = await post(tActor, `/payroll-periods/${id}/reopen`).send({ reason: "qa s13" });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.error?.code).toBe("PAYROLL-ERR-004");
      expect(res.body?.error?.details?.[0]?.message).toBe("payslip-already-generated");
      // ALLOW đối chứng: CÙNG trạng thái, gỡ cờ ⇒ reopen đi được (chứng minh 004 đến từ CỜ, không
      // phải từ trạng thái — thiếu vế này thì một `reopen` luôn-409 cũng xanh).
      await direct.query(
        `UPDATE payroll_periods SET payslips_generated_by = NULL, payslips_generated_at = NULL
         WHERE id = $1`,
        [id],
      );
      const ok = await post(tActor, `/payroll-periods/${id}/reopen`).send({ reason: "qa s13" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });
  });
});
