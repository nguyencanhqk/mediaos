/**
 * S15-PAYROLL-BE-4 — tạm ứng `PAYROLL-API-059..065` (plan §4.2 · §6.2). Đường thật (HTTP + Postgres lane).
 *
 * QUY TẮC: DENY/ALLOW song sinh từng route (ALLOW `=== 200/201`, không chỉ «khác 403»); four-eyes HAI VẾ (người tạo VÀ
 * người thụ hưởng — B2); 026 theo kỳ đích (D-3) + B3 `recalculate-required`; outbox 024/025/026 tới ĐÚNG tập người nhận,
 * payload 0 khoá tiền; 065 Own IDOR + 0 audit; race hai duyệt song song ⇒ đúng một 201.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { grantAllPayrollPairs, grantPayrollPairs } from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe4adv");
/** Khoá tiền KHÔNG được xuất hiện ở payload outbox lẫn audit (SPEC-11 §17 · §18). */
const MONEY_KEY = /amount|gross|net\b|salary/i;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-4 · tạm ứng 059–065", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;
  /** officer = người TẠO (đủ mọi cặp) · admin/admin2 = người duyệt · bene = thụ hưởng CÓ cặp approve · emp = chỉ Own · none = 0 cặp. */
  let officer = { id: "", token: "" };
  let admin = { id: "", token: "" };
  let admin2 = { id: "", token: "" };
  let bene = { id: "", token: "" };
  let emp = { id: "", token: "" };
  let none = { id: "", token: "" };
  let officerB = { id: "", token: "" };
  let seq = 0;

  const nextMonth = (): string => {
    const i = seq++;
    return `${2070 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({
    get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
    post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
    patch: (u: string) => http().patch(u).set("Authorization", `Bearer ${t}`),
  });

  const detail = (res: request.Response, field: string): string | undefined =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | undefined)?.find(
      (d) => d.field === field,
    )?.message;

  function expectError(res: request.Response, status: number, code: string, kind: string): void {
    const label = `${res.status} ${JSON.stringify(res.body)}`;
    expect(res.status, label).toBe(status);
    expect(res.body?.error?.code, label).toBe(code);
    expect(detail(res, "kind"), label).toBe(kind);
  }

  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function mkUser(t: SeededTenant, label: string, hash: string) {
    const email = `${label}@${t.slug}.test`;
    const id = await seedUser(direct, t.companyId, email, hash);
    return { id, email };
  }

  /** Kỳ lương ở `status` cho `month` (INSERT thẳng, đủ vết để CHECK cặp vết thoả). */
  async function periodAt(companyId: string, month: string, status: string): Promise<string> {
    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
      [companyId, month],
    );
    const calc = ["Calculated", "Reviewing", "Approved"].includes(status);
    const sub = ["Reviewing", "Approved"].includes(status);
    const appr = status === "Approved";
    const r = await direct.query<{ id: string }>(
      `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id,
         calculated_by, calculated_at, submitted_by, submitted_at, approved_by, approved_at)
       VALUES ($1, $2, $3, $4,
         CASE WHEN $5::boolean THEN $7::uuid END, CASE WHEN $5::boolean THEN now() END,
         CASE WHEN $6::boolean THEN $7::uuid END, CASE WHEN $6::boolean THEN now() END,
         CASE WHEN $8::boolean THEN $9::uuid END, CASE WHEN $8::boolean THEN now() END)
       RETURNING id`,
      [companyId, month, status, ap.rows[0].id, calc, sub, officer.id, appr, admin.id],
    );
    return r.rows[0].id;
  }

  async function createAdvance(t: string, userId: string, month: string, amount = 2_500_000) {
    const res = await as(t)
      .post("/payroll/advances")
      .send({ userId, amount, deductPeriodMonth: month, reason: "ứng lương be4" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; status: string; warnings: string[] };
  }

  const outboxOf = async (companyId: string, eventType: string) =>
    (
      await direct.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = $2 ORDER BY created_at`,
        [companyId, eventType],
      )
    ).rows;

  const auditCount = async (companyId: string, action: string, objectId: string | null) =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND object_type = 'payroll_advance' AND action = $2
              AND ($3::uuid IS NULL OR object_id = $3::uuid)`,
          [companyId, action, objectId],
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "be4adva");
    B = await seedCompany(direct, "be4advb");
    companyIds.push(A.companyId, B.companyId);

    const mk = async (
      t: SeededTenant,
      label: string,
      grant: (id: string) => Promise<void>,
    ): Promise<{ id: string; token: string }> => {
      const u = await mkUser(t, label, hash);
      await grant(u.id);
      return { id: u.id, token: await login(t, u.email) };
    };
    officer = await mk(A, "officer", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "be4-officer"),
    );
    admin = await mk(A, "admin", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "be4-admin"),
    );
    admin2 = await mk(A, "admin2", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "be4-admin2"),
    );
    bene = await mk(A, "bene", (id) =>
      grantPayrollPairs(direct, A.companyId, id, "be4-bene", ["advanceApprove", "meAdvanceList"]),
    );
    emp = await mk(A, "emp", (id) =>
      grantPayrollPairs(direct, A.companyId, id, "be4-emp", ["meAdvanceList"], "Own"),
    );
    none = await mk(A, "none", async () => undefined);
    officerB = await mk(B, "officer", (id) =>
      grantAllPayrollPairs(direct, B.companyId, id, "be4-officerb"),
    );
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("PERM — DENY/ALLOW song sinh từng route", () => {
    it("059–064: chủ thể thiếu cặp (chỉ view-own) ⇒ 403; officer/admin ⇒ ĐÚNG 200/201", async () => {
      const month = nextMonth();
      const denied = as(emp.token);
      expect((await denied.get("/payroll/advances")).status).toBe(403);
      expect(
        (
          await denied
            .post("/payroll/advances")
            .send({ userId: emp.id, amount: 1, deductPeriodMonth: month, reason: "x" })
        ).status,
      ).toBe(403);
      const adv = await createAdvance(officer.token, emp.id, month);
      expect((await denied.get(`/payroll/advances/${adv.id}`)).status).toBe(403);
      expect((await denied.patch(`/payroll/advances/${adv.id}`).send({ reason: "y" })).status).toBe(
        403,
      );
      expect((await denied.post(`/payroll/advances/${adv.id}/approve`).send({})).status).toBe(403);
      expect(
        (await denied.post(`/payroll/advances/${adv.id}/reject`).send({ note: "n" })).status,
      ).toBe(403);
      // ALLOW đối chứng — đúng mã, không chỉ «khác 403».
      expect((await as(officer.token).get("/payroll/advances")).status).toBe(200);
      expect((await as(officer.token).get(`/payroll/advances/${adv.id}`)).status).toBe(200);
      expect(
        (await as(officer.token).patch(`/payroll/advances/${adv.id}`).send({ reason: "sửa" }))
          .status,
      ).toBe(200);
      expect(
        (await as(admin.token).post(`/payroll/advances/${adv.id}/approve`).send({})).status,
      ).toBe(201);
    });

    it("065: 0 cặp ⇒ 403; nhân viên Own ⇒ 200 (không bị sàn scope Company)", async () => {
      expect((await as(none.token).get("/me/payroll-advances")).status).toBe(403);
      const res = await as(emp.token).get("/me/payroll-advances");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("060 — tạo tạm ứng", () => {
    it("201; created_by = actor (DB, không từ body); outbox 024 tới ĐÚNG holders(approve) − actor; payload 0 khoá tiền", async () => {
      const month = nextMonth();
      const adv = await createAdvance(officer.token, emp.id, month, 3_000_000);
      const row = await direct.query(
        `SELECT created_by, status, amount FROM payroll_advances WHERE id = $1`,
        [adv.id],
      );
      expect(row.rows[0].created_by).toBe(officer.id);
      expect(row.rows[0].status).toBe("Pending");
      expect(adv.warnings).toEqual([]);

      const events = (await outboxOf(A.companyId, "payroll.advance_submitted")).filter(
        (e) => e.payload["advanceId"] === adv.id,
      );
      expect(events).toHaveLength(1);
      const payload = events[0].payload;
      // holders(approve:payroll-advance @Company) − actor = admin · admin2 · bene (officer bị loại vì là actor).
      expect(payload["recipientUserIds"]).toEqual([admin.id, admin2.id, bene.id].sort());
      expect(payload["deduct_period_month"]).toBe(month);
      expect(payload["payroll_advance_id"]).toBe(adv.id);
      expect(typeof payload["actor_name"]).toBe("string");
      expect(JSON.stringify(payload)).not.toMatch(MONEY_KEY);
    });

    it("body có `createdBy`/`status` ⇒ 400 (strict) — không lách four-eyes bằng cách đặt người tạo", async () => {
      const res = await as(officer.token).post("/payroll/advances").send({
        userId: emp.id,
        amount: 1,
        deductPeriodMonth: nextMonth(),
        reason: "x",
        createdBy: admin.id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("tháng có kỳ `Calculated` ⇒ 409 026 `advance-period-frozen`; tháng không có kỳ ⇒ 201", async () => {
      const month = nextMonth();
      await periodAt(A.companyId, month, "Calculated");
      expectError(
        await as(officer.token)
          .post("/payroll/advances")
          .send({ userId: emp.id, amount: 1, deductPeriodMonth: month, reason: "x" }),
        409,
        "PAYROLL-ERR-026",
        "advance-period-frozen",
      );
      await createAdvance(officer.token, emp.id, nextMonth());
    });

    it("tháng có kỳ `CollectingData` ⇒ 201 (D-3: kỳ chưa tính còn nhận)", async () => {
      const month = nextMonth();
      await periodAt(A.companyId, month, "CollectingData");
      await createAdvance(officer.token, emp.id, month);
    });

    it("`userId` thuộc tenant khác ⇒ 404 sentinel (FK composite `payroll_advances_user_id`), 0 hàng", async () => {
      const month = nextMonth();
      expectError(
        await as(officer.token)
          .post("/payroll/advances")
          .send({ userId: officerB.id, amount: 1, deductPeriodMonth: month, reason: "x" }),
        404,
        "PAYROLL-ERR-010",
        "not-found",
      );
      const n = await direct.query(
        `SELECT count(*)::int AS n FROM payroll_advances WHERE company_id = $1 AND deduct_period_month = $2`,
        [A.companyId, month],
      );
      expect(n.rows[0].n).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("062 — sửa / xoá mềm", () => {
    it("sửa `Pending` ⇒ 200; sau duyệt ⇒ 409 025 `advance-not-pending`; `delete:true` xoá mềm", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      const ok = await as(officer.token)
        .patch(`/payroll/advances/${adv.id}`)
        .send({ amount: 1_000_000, reason: "đổi" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toEqual({ id: adv.id, status: "Pending", warnings: [] });
      expect(
        (await as(admin.token).post(`/payroll/advances/${adv.id}/approve`).send({})).status,
      ).toBe(201);
      expectError(
        await as(officer.token).patch(`/payroll/advances/${adv.id}`).send({ reason: "x" }),
        409,
        "PAYROLL-ERR-025",
        "advance-not-pending",
      );
      const adv2 = await createAdvance(officer.token, emp.id, nextMonth());
      const del = await as(officer.token)
        .patch(`/payroll/advances/${adv2.id}`)
        .send({ delete: true });
      expect(del.status, JSON.stringify(del.body)).toBe(200);
      const row = await direct.query(`SELECT deleted_at FROM payroll_advances WHERE id = $1`, [
        adv2.id,
      ]);
      expect(row.rows[0].deleted_at).not.toBeNull();
      expect((await as(officer.token).get(`/payroll/advances/${adv2.id}`)).status).toBe(404);
    });

    it("hàng `Deducted` (gieo thẳng, DISABLE TRIGGER) ⇒ 409 025 `advance-already-deducted` — kiểm TRƯỚC `not-pending`", async () => {
      const month = nextMonth();
      // Tạo tạm ứng TRƯỚC (kỳ chưa có) rồi mới dựng kỳ `Calculated` — 060 chặn 026 khi kỳ đã tính.
      const adv = await createAdvance(officer.token, emp.id, month);
      const periodId = await periodAt(A.companyId, month, "Calculated");
      const c = await direct.connect();
      try {
        await c.query("BEGIN");
        await c.query("ALTER TABLE payroll_advances DISABLE TRIGGER payroll_advance_freeze_guard");
        await c.query(
          `UPDATE payroll_advances SET status = 'Deducted', decided_by = $2, decided_at = now(),
                  payroll_period_id = $3, consumed_at = now() WHERE id = $1`,
          [adv.id, admin.id, periodId],
        );
        await c.query("ALTER TABLE payroll_advances ENABLE TRIGGER payroll_advance_freeze_guard");
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      expectError(
        await as(officer.token).patch(`/payroll/advances/${adv.id}`).send({ reason: "x" }),
        409,
        "PAYROLL-ERR-025",
        "advance-already-deducted",
      );
      expectError(
        await as(officer.token).patch(`/payroll/advances/${adv.id}`).send({ delete: true }),
        409,
        "PAYROLL-ERR-025",
        "advance-already-deducted",
      );
    });

    it("đổi `deductPeriodMonth` sang tháng có kỳ `Approved` ⇒ 409 026", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      const frozen = nextMonth();
      await periodAt(A.companyId, frozen, "Approved");
      expectError(
        await as(officer.token)
          .patch(`/payroll/advances/${adv.id}`)
          .send({ deductPeriodMonth: frozen }),
        409,
        "PAYROLL-ERR-026",
        "advance-period-frozen",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("063/064 — duyệt/từ chối four-eyes HAI VẾ + 026 theo kỳ đích + NOTI", () => {
    it("người TẠO tự duyệt ⇒ 409 025 `self-approval` (officer có cặp approve)", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      expectError(
        await as(officer.token).post(`/payroll/advances/${adv.id}/approve`).send({}),
        409,
        "PAYROLL-ERR-025",
        "self-approval",
      );
    });

    it("B2 — người THỤ HƯỞNG có cặp approve tự duyệt ⇒ 409 025 `self-approval` (CHECK DB KHÔNG soi user_id)", async () => {
      const adv = await createAdvance(officer.token, bene.id, nextMonth());
      expectError(
        await as(bene.token).post(`/payroll/advances/${adv.id}/approve`).send({}),
        409,
        "PAYROLL-ERR-025",
        "self-approval",
      );
      expectError(
        await as(bene.token).post(`/payroll/advances/${adv.id}/reject`).send({ note: "x" }),
        409,
        "PAYROLL-ERR-025",
        "self-approval",
      );
      const row = await direct.query(`SELECT status FROM payroll_advances WHERE id = $1`, [adv.id]);
      expect(row.rows[0].status).toBe("Pending");
    });

    it("duyệt ⇒ 201 {status Approved}; outbox 025 tới [thụ hưởng, người tạo] − actor; duyệt lần hai ⇒ 025 not-pending", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      const res = await as(admin.token)
        .post(`/payroll/advances/${adv.id}/approve`)
        .send({ note: "ok" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe("Approved");
      expect(res.body.data.warnings).toEqual([]);
      const ev = (await outboxOf(A.companyId, "payroll.advance_approved")).filter(
        (e) => e.payload["advanceId"] === adv.id,
      );
      expect(ev).toHaveLength(1);
      expect((ev[0].payload["recipientUserIds"] as string[]).sort()).toEqual(
        [emp.id, officer.id].sort(),
      );
      expect(JSON.stringify(ev[0].payload)).not.toMatch(MONEY_KEY);
      expectError(
        await as(admin2.token).post(`/payroll/advances/${adv.id}/approve`).send({}),
        409,
        "PAYROLL-ERR-025",
        "advance-not-pending",
      );
    });

    it("từ chối thiếu `note` ⇒ 400; có note ⇒ 201 + outbox 026 mang `reason`", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      expect(
        (await as(admin.token).post(`/payroll/advances/${adv.id}/reject`).send({})).status,
      ).toBe(400);
      const res = await as(admin.token)
        .post(`/payroll/advances/${adv.id}/reject`)
        .send({ note: "không đủ điều kiện" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe("Rejected");
      const ev = (await outboxOf(A.companyId, "payroll.advance_rejected")).filter(
        (e) => e.payload["advanceId"] === adv.id,
      );
      expect(ev).toHaveLength(1);
      expect(ev[0].payload["reason"]).toBe("không đủ điều kiện");
      expect(JSON.stringify(ev[0].payload)).not.toMatch(MONEY_KEY);
    });

    it("kỳ đích `Reviewing` ⇒ 409 026; `Calculated` ⇒ 201 + warnings chứa `recalculate-required` (B3); `CollectingData` ⇒ KHÔNG chứa", async () => {
      const mReviewing = nextMonth();
      const advR = await createAdvance(officer.token, emp.id, mReviewing);
      await periodAt(A.companyId, mReviewing, "Reviewing");
      expectError(
        await as(admin.token).post(`/payroll/advances/${advR.id}/approve`).send({}),
        409,
        "PAYROLL-ERR-026",
        "advance-period-frozen",
      );

      const mCalc = nextMonth();
      const advC = await createAdvance(officer.token, emp.id, mCalc);
      await periodAt(A.companyId, mCalc, "Calculated");
      const okC = await as(admin.token).post(`/payroll/advances/${advC.id}/approve`).send({});
      expect(okC.status, JSON.stringify(okC.body)).toBe(201);
      expect(okC.body.data.warnings).toContain("recalculate-required");

      const mCol = nextMonth();
      await periodAt(A.companyId, mCol, "CollectingData");
      const advK = await createAdvance(officer.token, emp.id, mCol);
      const okK = await as(admin.token).post(`/payroll/advances/${advK.id}/approve`).send({});
      expect(okK.status).toBe(201);
      expect(okK.body.data.warnings).not.toContain("recalculate-required");
    });

    it("RACE — hai người duyệt song song ⇒ đúng 1 × 201, 1 × 409 025", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      const [r1, r2] = await Promise.all([
        as(admin.token).post(`/payroll/advances/${adv.id}/approve`).send({}),
        as(admin2.token).post(`/payroll/advances/${adv.id}/approve`).send({}),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses, `${JSON.stringify(r1.body)} | ${JSON.stringify(r2.body)}`).toEqual([
        201, 409,
      ]);
      const lost = r1.status === 409 ? r1 : r2;
      expect(lost.body.error.code).toBe("PAYROLL-ERR-025");
      const row = await direct.query(`SELECT decided_by FROM payroll_advances WHERE id = $1`, [
        adv.id,
      ]);
      expect([admin.id, admin2.id]).toContain(row.rows[0].decided_by);
    });

    it("chốt cuối DB: UPDATE thẳng `Approved` với decided_by = created_by ⇒ 23514 `payroll_advances_four_eyes_check`", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      await expect(
        direct.query(
          `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
          [adv.id, officer.id],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "payroll_advances_four_eyes_check" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("065 — «Tạm ứng của tôi» (Own) + IDOR + audit", () => {
    it("nhân viên thấy ĐÚNG của mình (có `amount` — C13), không thấy của người khác; 0 audit cho route Own", async () => {
      const mine = await createAdvance(officer.token, emp.id, nextMonth(), 777_000);
      const other = await createAdvance(officer.token, bene.id, nextMonth(), 888_000);
      const before = await auditCount(A.companyId, "read", null);
      const res = await as(emp.token).get("/me/payroll-advances?per_page=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string; userId: string; amount?: number }>).map(
        (x) => x.id,
      );
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(other.id);
      const row = (res.body.data as Array<{ id: string; amount?: number }>).find(
        (x) => x.id === mine.id,
      )!;
      expect(row.amount).toBe(777000);
      expect(await auditCount(A.companyId, "read", null)).toBe(before);
      // Nhân viên gọi 061 (route quản trị) ⇒ 403 dù là chủ khoản.
      expect((await as(emp.token).get(`/payroll/advances/${mine.id}`)).status).toBe(403);
    });

    it("chưa có tạm ứng ⇒ danh sách RỖNG, 200 (không 404)", async () => {
      const res = await as(none.token).get("/me/payroll-advances");
      // `none` không có cặp ⇒ 403; dùng officerB (tenant B, chưa có khoản nào) cho ca rỗng.
      expect(res.status).toBe(403);
      const empty = await as(officerB.token).get("/me/payroll-advances");
      expect(empty.status, JSON.stringify(empty.body)).toBe(200);
      expect(empty.body.data).toEqual([]);
    });

    it("cross-tenant: token B đọc/sửa/duyệt tạm ứng của A ⇒ 404 sentinel", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      expect((await as(officerB.token).get(`/payroll/advances/${adv.id}`)).status).toBe(404);
      expect(
        (await as(officerB.token).patch(`/payroll/advances/${adv.id}`).send({ reason: "x" }))
          .status,
      ).toBe(404);
      expect(
        (await as(officerB.token).post(`/payroll/advances/${adv.id}/approve`).send({})).status,
      ).toBe(404);
      const list = await as(officerB.token).get("/payroll/advances?per_page=100");
      expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).not.toContain(adv.id);
    });

    it("audit: 059 và 061 mỗi lượt +1 hàng `read`, payload không tiền", async () => {
      const adv = await createAdvance(officer.token, emp.id, nextMonth());
      const b0 = await auditCount(A.companyId, "read", null);
      expect((await as(officer.token).get("/payroll/advances")).status).toBe(200);
      expect(await auditCount(A.companyId, "read", null)).toBe(b0 + 1);
      const b1 = await auditCount(A.companyId, "read", adv.id);
      expect((await as(officer.token).get(`/payroll/advances/${adv.id}`)).status).toBe(200);
      expect(await auditCount(A.companyId, "read", adv.id)).toBe(b1 + 1);
      const rows = await direct.query(
        `SELECT before, after FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_advance'`,
        [A.companyId],
      );
      // Audit chỉ được mang TÊN trường (`changedFields: ["amount"]`), không GIÁ TRỊ tiền ⇒ soi khoá-có-giá-trị.
      for (const r of rows.rows) {
        expect(JSON.stringify([r.before, r.after])).not.toMatch(/"(amount|gross|net|salary)"\s*:/i);
      }
    });
  });

  it("sanity — id ma ⇒ 404 (không 500) ở 061/062/063", async () => {
    const ghost = randomUUID();
    expect((await as(officer.token).get(`/payroll/advances/${ghost}`)).status).toBe(404);
    expect(
      (await as(officer.token).patch(`/payroll/advances/${ghost}`).send({ reason: "x" })).status,
    ).toBe(404);
    expect((await as(admin.token).post(`/payroll/advances/${ghost}/approve`).send({})).status).toBe(
      404,
    );
  });
});
