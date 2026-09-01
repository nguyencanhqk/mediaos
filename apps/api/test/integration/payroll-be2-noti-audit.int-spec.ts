/**
 * S13-PAYROLL-BE-2 — (A) 4 event NOTI `020..023` đi HẾT đường thật
 * `service → outbox → OutboxWorker → PayrollNotiBridgeRegistrar → engine.intake → notifications`,
 * và (B) **AUDIT LƯỢT ĐỌC** 7 đường (SPEC-11 §17 · §18).
 *
 * Ba điều chỉ chứng minh được ở tầng này:
 *  1. **App boot KHÔNG lỗi** = `registerSource` khớp catalog seed `0566` — registrar ném NGAY ở
 *     `onModuleInit` nếu `eventCode` sai, nên chính `beforeAll` pass đã là bằng chứng.
 *  2. **`dedupeKey` content-derived**: gửi → từ chối → gửi LẠI phải ra **hai** notification (khoá lấy
 *     `submitted_at` của chính câu UPDATE). Nếu ai đó đổi khoá về `{periodId}` trần thì lần gửi thứ
 *     hai bị dedupe nuốt CÂM — người duyệt không bao giờ biết bảng lương đã sửa xong.
 *  3. **Payload NOTI tuyệt đối KHÔNG có số tiền** — NOTI đi qua nhiều kênh và KHÔNG có tầng masking
 *     riêng (SPEC-11 §17).
 *
 * Spec lái `OutboxWorker` ⇒ PHẢI giữ `acquireOutboxWorkerLock` (S7-QA-OUTBOXPROBE-1).
 * GATE CỨNG `hasDb && LANE_DB`.
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
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
const LOGIN_PW = "Passw0rd!payrollnoti";

const SENSITIVE = new Set([
  "view-line:payroll-period",
  "calculate:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
  "export:payroll",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
]);
const OWN_SCOPE = new Set([
  "access:payroll",
  "view-own-payslip:payslip",
  "acknowledge-own-payslip:payslip",
]);

const OFFICER_PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["view-line", "payroll-period"],
  ["calculate", "payroll-period"],
  ["publish", "payroll-period"],
  ["reopen", "payroll-period"],
  ["export", "payroll"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
  ["view-payslip", "payslip"],
];
const ADMIN_PAIRS: Array<[string, string]> = [...OFFICER_PAIRS, ["approve", "payroll-period"]];
const EMPLOYEE_PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view-own-payslip", "payslip"],
  ["acknowledge-own-payslip", "payslip"],
];

/** Khoá tiền KHÔNG được xuất hiện ở payload NOTI lẫn payload audit (SPEC-11 §17 · §18). */
const MONEY_KEY = /gross|net|amount|salary|allowance|deduction|bonus|penalty/i;

interface NotiRow {
  id: string;
  dedupeKey: string | null;
  sourceEntityId: string | null;
  payload: Record<string, unknown>;
}

describe.skipIf(!hasLaneDb)("S13-PAYROLL-BE-2 NOTI 020–023 + audit lượt đọc", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let outboxLock: OutboxWorkerLock | undefined;

  let tOfficer = "";
  let tAdmin = "";
  let tEmployee = "";
  let officerId = "";
  let adminId = "";
  let subjectId = "";
  let attendancePeriodId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });

  const notisOf = async (userId: string, eventCode: string): Promise<NotiRow[]> =>
    (
      await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey", source_entity_id AS "sourceEntityId", payload
           FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2 AND event_code = $3 AND deleted_at IS NULL
          ORDER BY created_at`,
        [A.companyId, userId, eventCode],
      )
    ).rows as NotiRow[];

  const auditCount = async (): Promise<number> =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND action IN ('read','export')
              AND object_type IN ('payroll_period','payslip')`,
          [A.companyId],
        )
      ).rows[0].n,
    );

  async function grant(userId: string, pairs: Array<[string, string]>, label: string) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `paynoti-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of pairs) {
      const key = `${action}:${resource}`;
      const permId = await seedPermissionCatalog(direct, action, resource, SENSITIVE.has(key));
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        OWN_SCOPE.has(key) ? "Own" : "Company",
      );
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Kỳ mới đã `Calculated` (nguồn của mọi ca dưới). */
  async function calculatedPeriod(periodMonth: string): Promise<string> {
    const p = await post(tOfficer, "/payroll-periods").send({
      periodMonth,
      attendancePeriodId,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const id = p.body.data.id as string;
    expect((await post(tOfficer, `/payroll-periods/${id}/collect`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    outboxLock = await acquireOutboxWorkerLock("payroll-be2-noti");

    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "paynoti");
    companyIds.push(A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    officerId = await seedUser(direct, A.companyId, `officer@${A.slug}.test`, hash);
    await grant(officerId, OFFICER_PAIRS, "officer");
    tOfficer = await login(`officer@${A.slug}.test`);

    adminId = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    await grant(adminId, ADMIN_PAIRS, "admin");
    tAdmin = await login(`admin@${A.slug}.test`);

    subjectId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);
    await grant(subjectId, EMPLOYEE_PAIRS, "employee");
    tEmployee = await login(`subject@${A.slug}.test`);
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
       VALUES ($1,$2,'2028-01-01','12000000.00','[]'::jsonb)`,
      [A.companyId, subjectId],
    );

    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,'2028-06','locked') RETURNING id`,
      [A.companyId],
    );
    attendancePeriodId = ap.rows[0].id as string;
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await outboxLock?.release();
    await direct?.end();
    await app?.close();
  });

  it("app boot thành công — `PayrollNotiBridgeRegistrar.registerSource` khớp catalog seed 0566", () => {
    // `registerSource` NÉM tại boot nếu `eventCode` không có trong `NOTI_EVENT_CATALOG` (is_enabled).
    expect(app).toBeDefined();
  });

  it("020 — `submit` báo cho ĐÚNG tập người duyệt hợp lệ; payload 0 khoá tiền", async () => {
    const id = await calculatedPeriod("2028-06");
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    await drain();

    const forAdmin = await notisOf(adminId, "PAYROLL_PERIOD_SUBMITTED");
    expect(forAdmin).toHaveLength(1);
    expect(forAdmin[0].sourceEntityId).toBe(id);
    // `NotificationDedupeService.computeKey` ghép `${eventCode}:${dedupeKey}` — khoá của registrar
    // là `{periodId}:{submittedAtIso}`, nên hàng DB có ĐÚNG MỘT tiền tố event code.
    expect(forAdmin[0].dedupeKey).toMatch(new RegExp(`^PAYROLL_PERIOD_SUBMITTED:${id}:.+`));
    expect(forAdmin[0].dedupeKey).not.toMatch(/PAYROLL_PERIOD_SUBMITTED:PAYROLL_PERIOD_SUBMITTED/);
    expect(JSON.stringify(forAdmin[0].payload)).not.toMatch(MONEY_KEY);
    // Người GỬI không tự nhận (engine tự loại actor) và nhân viên thường không nằm trong tập duyệt.
    expect(await notisOf(officerId, "PAYROLL_PERIOD_SUBMITTED")).toHaveLength(0);
    expect(await notisOf(subjectId, "PAYROLL_PERIOD_SUBMITTED")).toHaveLength(0);
  });

  it("020 — gửi → TỪ CHỐI → gửi LẠI ⇒ **hai** noti (khoá content-derived theo `submitted_at`)", async () => {
    const id = await calculatedPeriod("2028-07");
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    const rej = await post(tAdmin, `/payroll-periods/${id}/reject`).send({ reason: "thiếu công" });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    await drain();

    const forAdmin = (await notisOf(adminId, "PAYROLL_PERIOD_SUBMITTED")).filter(
      (n) => n.sourceEntityId === id,
    );
    // Khoá `{periodId}` trần ⇒ lần gửi thứ hai bị dedupe nuốt CÂM: người duyệt không biết bảng lương
    // đã sửa xong. Hai khoá phải KHÁC nhau.
    expect(forAdmin).toHaveLength(2);
    expect(new Set(forAdmin.map((n) => n.dedupeKey)).size).toBe(2);
  });

  it("022 — `reject` báo cho NGƯỜI GỬI DUYỆT (đọc `submitted_by` TRƯỚC khi TRAIL_RESET xoá nó)", async () => {
    const id = await calculatedPeriod("2028-08");
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect(
      (await post(tAdmin, `/payroll-periods/${id}/reject`).send({ reason: "sai phụ cấp" })).status,
    ).toBe(201);
    await drain();

    const forOfficer = (await notisOf(officerId, "PAYROLL_PERIOD_REJECTED")).filter(
      (n) => n.sourceEntityId === id,
    );
    // Đọc `submitted_by` SAU `applyTransitionTx` là gửi cho `null` ⇒ 0 recipient ⇒ ca này rỗng.
    expect(forOfficer).toHaveLength(1);
    expect(forOfficer[0].dedupeKey).toMatch(new RegExp(`^PAYROLL_PERIOD_REJECTED:${id}:.+`));
    expect(JSON.stringify(forOfficer[0].payload)).not.toMatch(MONEY_KEY);
  });

  it("021 — `approve` báo cho người gửi duyệt; 023 — mỗi PHIẾU một event tới đúng chủ phiếu", async () => {
    const id = await calculatedPeriod("2028-09");
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/generate-payslips`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/publish`)).status).toBe(201);
    await drain();

    const approved = (await notisOf(officerId, "PAYROLL_PERIOD_APPROVED")).filter(
      (n) => n.sourceEntityId === id,
    );
    expect(approved).toHaveLength(1);
    expect(approved[0].dedupeKey).toMatch(new RegExp(`^PAYROLL_PERIOD_APPROVED:${id}:.+`));

    const published = await notisOf(subjectId, "PAYSLIP_PUBLISHED");
    expect(published).toHaveLength(1);
    // Neo + khoá theo `payslipId` ⇒ once-ever cho mỗi phiếu (phiếu append-only, không phát hành lại).
    expect(published[0].dedupeKey).toBe(`PAYSLIP_PUBLISHED:${published[0].sourceEntityId}`);
    expect(JSON.stringify(published[0].payload)).not.toMatch(MONEY_KEY);
    // Chủ phiếu KHÁC không nhận nhầm.
    expect(await notisOf(adminId, "PAYSLIP_PUBLISHED")).toHaveLength(0);
  });

  it("AUDIT — 5 đường đọc của BE-2 ghi +1 hàng mỗi lượt; `/me/payslips*` ghi +0", async () => {
    const id = await calculatedPeriod("2028-10");
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/generate-payslips`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/publish`)).status).toBe(201);
    const list = await get(tOfficer, `/payslips?payrollPeriodId=${id}`);
    expect(list.status).toBe(200);
    const payslipId = (list.body.data as Array<{ id: string }>)[0].id;

    // ── 5 đường ĐỌC LƯƠNG NGƯỜI KHÁC: mỗi lượt +1 hàng audit ──
    for (const [label, call] of [
      ["lines", () => get(tOfficer, `/payroll-periods/${id}/lines`)],
      ["summary", () => get(tOfficer, "/payroll-periods/summary")],
      ["export", () => get(tOfficer, `/payroll-periods/${id}/export`)],
      ["payslip list", () => get(tOfficer, `/payslips?payrollPeriodId=${id}`)],
      ["payslip detail", () => get(tOfficer, `/payslips/${payslipId}`)],
    ] as const) {
      const before = await auditCount();
      const res = await call();
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(await auditCount(), `${label} phải ghi ĐÚNG 1 hàng audit`).toBe(before + 1);
    }

    // ── 2 đường ĐỌC LƯƠNG CỦA CHÍNH MÌNH: +0 hàng ──
    // Tự xem lương của mình không phải sự kiện an ninh (SPEC-11 §18); ghi audit ở đây là biến mỗi lần
    // nhân viên mở app thành một hàng sổ.
    const before = await auditCount();
    expect((await get(tEmployee, "/me/payslips")).status).toBe(200);
    expect((await get(tEmployee, `/me/payslips/${payslipId}`)).status).toBe(200);
    expect(await auditCount()).toBe(before);
  });

  it("AUDIT — payload lượt đọc KHÔNG mang số tiền", async () => {
    const rows = await direct.query<{ new_values: unknown; metadata: unknown }>(
      `SELECT new_values, metadata FROM audit_logs
        WHERE company_id = $1 AND action IN ('read','export','calculate','adjust-line','publish')
          AND object_type IN ('payroll_period','payslip')`,
      [A.companyId],
    );
    expect(
      rows.rows.length,
      "phải có hàng audit để đo — nếu 0 thì ca này xanh-RỖNG",
    ).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(JSON.stringify(r.new_values ?? {})).not.toMatch(MONEY_KEY);
    }
  });
});
