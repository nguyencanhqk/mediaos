/**
 * S15-PAYROLL-BE-4 — ngân sách `073..075` · import `076..077` · 052 `template-in-use` · NOTI 024/027 đường thật
 * (plan §4.5 · §4.6 · §4.7 · §4.8 · §6.2). Đường thật (HTTP + Postgres lane); NOTI lái `OutboxWorker` ⇒ giữ
 * `acquireOutboxWorkerLock` (S7-QA-OUTBOXPROBE-1).
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { ADJUSTMENT_IMPORT_COLUMNS } from "../../src/payroll/payroll-adjustments-import.columns";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import {
  cloneTemplate,
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
  seedPayrollCatalog,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe4bud");
const HEADER = ADJUSTMENT_IMPORT_COLUMNS.map((c) => c.header);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Số tiền giả — KHÔNG được xuất hiện trong message/details lỗi dòng. */
const SECRET_AMOUNT = "7654321";

async function xlsxOf(rows: string[][]): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("import");
  for (const r of rows) sheet.addRow(r);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
const csvOf = (rows: string[][]): Buffer =>
  Buffer.from(
    rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n"),
    "utf8",
  );

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-BE-4 · ngân sách 073–075 · import 076–077 · 052 · NOTI thật",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    let A: SeededTenant;
    let B: SeededTenant;
    let outboxLock: OutboxWorkerLock | undefined;
    let officer = { id: "", token: "" };
    let admin = { id: "", token: "" };
    let dept = { id: "", token: "" };
    let bonusOnly = { id: "", token: "" };
    let officerB = { id: "", token: "" };
    let templateA = "";
    let orgUnit1 = "";
    let orgUnit2 = "";
    /** NV001 (đơn vị 1) · NV002 (đơn vị 2) · NV003 (không đơn vị). */
    let e1 = "";
    let e2 = "";
    let e3 = "";
    let seq = 0;
    const YEAR = 2090;
    const nextMonth = (): string => {
      const i = seq++;
      return `${YEAR + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
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

    /** Kỳ ở `status` (mặc định CollectingData) — cho 076 và 052. */
    async function periodAt(status: string, month = nextMonth(), templateId: string | null = null) {
      const ap = await direct.query<{ id: string }>(
        `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
        [A.companyId, month],
      );
      const calc = ["Calculated", "Reviewing", "Approved"].includes(status);
      const sub = ["Reviewing", "Approved"].includes(status);
      const appr = status === "Approved";
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id, template_id,
         calculated_by, calculated_at, submitted_by, submitted_at, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5,
         CASE WHEN $6::boolean THEN $8::uuid END, CASE WHEN $6::boolean THEN now() END,
         CASE WHEN $7::boolean THEN $8::uuid END, CASE WHEN $7::boolean THEN now() END,
         CASE WHEN $9::boolean THEN $10::uuid END, CASE WHEN $9::boolean THEN now() END)
       RETURNING id`,
        [
          A.companyId,
          month,
          status,
          ap.rows[0].id,
          templateId,
          calc,
          sub,
          officer.id,
          appr,
          admin.id,
        ],
      );
      return { id: r.rows[0].id, month };
    }

    function upload(t: string, periodId: string, buf: Buffer, filename: string, dryRun?: boolean) {
      const q = dryRun === undefined ? "" : `?dryRun=${dryRun}`;
      return as(t)
        .post(`/payroll-periods/${periodId}/import-adjustments${q}`)
        .attach("file", buf, {
          filename,
          contentType: filename.endsWith(".csv") ? "text/csv" : XLSX_MIME,
        });
    }
    const pendingRows = async (month: string) =>
      (
        await direct.query<{
          user_id: string;
          kind: string;
          amount: string;
          status: string;
          created_by: string;
        }>(
          `SELECT user_id, kind, amount, status, created_by FROM bonus_penalties
          WHERE company_id = $1 AND period_month = $2 AND deleted_at IS NULL ORDER BY user_id`,
          [A.companyId, month],
        )
      ).rows;
    const auditImportCount = async (periodId: string) =>
      Number(
        (
          await direct.query(
            `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_period' AND action = 'import' AND object_id = $2`,
            [A.companyId, periodId],
          )
        ).rows[0].n,
      );

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      outboxLock = await acquireOutboxWorkerLock("s15-payroll-be4-noti");
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "be4buda");
      B = await seedCompany(direct, "be4budb");
      companyIds.push(A.companyId, B.companyId);
      templateA = await seedPayrollCatalog(direct, A.companyId);

      const mk = async (t: SeededTenant, label: string, grant: (id: string) => Promise<void>) => {
        const email = `${label}@${t.slug}.test`;
        const id = await seedUser(direct, t.companyId, email, hash);
        await grant(id);
        return { id, token: await login(t, email) };
      };
      officer = await mk(A, "officer", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4u-officer"),
      );
      admin = await mk(A, "admin", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4u-admin"),
      );
      dept = await mk(A, "dept", (id) =>
        grantPayrollPairs(
          direct,
          A.companyId,
          id,
          "be4u-dept",
          ["budgetList", "budgetCreate", "budgetUpdate"],
          "Department",
        ),
      );
      bonusOnly = await mk(A, "bonusonly", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4u-bonus", [
          "bonusPenaltyList",
          "budgetList",
        ]),
      );
      officerB = await mk(B, "officer", (id) =>
        grantAllPayrollPairs(direct, B.companyId, id, "be4u-officerb"),
      );

      const ou = async (name: string) =>
        (
          await direct.query<{ id: string }>(
            `INSERT INTO org_units (company_id, name) VALUES ($1, $2) RETURNING id`,
            [A.companyId, name],
          )
        ).rows[0].id;
      orgUnit1 = await ou("Phòng BE4-1");
      orgUnit2 = await ou("Phòng BE4-2");
      e1 = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, "x");
      e2 = await seedUser(direct, A.companyId, `e2@${A.slug}.test`, "x");
      e3 = await seedUser(direct, A.companyId, `e3@${A.slug}.test`, "x");
      await employeeProfile(direct, A.companyId, e1, "NV001", orgUnit1);
      await employeeProfile(direct, A.companyId, e2, "NV002", orgUnit2);
      await employeeProfile(direct, A.companyId, e3, "NV003", null);
    }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await outboxLock?.release();
      await direct?.end();
      await app?.close();
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("073–075 — ngân sách", () => {
      it("073: Department ⇒ 403 sàn scope; thực hiện = Σ gross kỳ Published/Paid/Locked cùng năm (Approved KHÔNG tính), theo đơn vị HIỆN TẠI; audit +1", async () => {
        const denied = await as(dept.token).get(`/payroll/budgets?fiscalYear=${YEAR}`);
        expect(denied.status).toBe(403);
        expect(denied.body.error.message).toContain("AUTH-ERR-SCOPE-DENIED");

        // Hai kỳ Published (gross e1=100, e2=200, e3=300 mỗi kỳ) + một kỳ Approved (không tính) + kỳ Locked (tính).
        const mk = (status: "Published" | "Approved" | "Locked") =>
          publishedPeriodWithPayslips(direct, A.companyId, {
            month: nextMonth(),
            payees: [
              { userId: e1, net: "90.00", gross: "100.00" },
              { userId: e2, net: "180.00", gross: "200.00" },
              { userId: e3, net: "270.00", gross: "300.00" },
            ],
            officerId: officer.id,
            approverId: admin.id,
            status,
          });
        await mk("Published");
        await mk("Approved");
        await mk("Locked");

        const c1 = await as(officer.token)
          .post("/payroll/budgets")
          .send({ fiscalYear: YEAR, orgUnitId: orgUnit1, plannedAmount: 1000 });
        expect(c1.status, JSON.stringify(c1.body)).toBe(201);
        const c2 = await as(officer.token)
          .post("/payroll/budgets")
          .send({ fiscalYear: YEAR, orgUnitId: null, plannedAmount: 5000, note: "cả cty" });
        expect(c2.status, JSON.stringify(c2.body)).toBe(201);
        expect(c2.body.data).toEqual({ id: c2.body.data.id, warnings: [] });

        const a0 = Number(
          (
            await direct.query(
              `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_budget' AND action = 'read'`,
              [A.companyId],
            )
          ).rows[0].n,
        );
        const res = await as(officer.token).get(`/payroll/budgets?fiscalYear=${YEAR}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<Record<string, unknown>>;
        const unit1 = rows.find((r) => r["orgUnitId"] === orgUnit1)!;
        const all = rows.find((r) => r["orgUnitId"] === null)!;
        // e1 ở đơn vị 1: 100 × 2 kỳ (Published + Locked) = 200; toàn công ty = (100+200+300) × 2 = 1200.
        expect(unit1["actualAmount"]).toBe(200);
        expect(unit1["variance"]).toBe(800);
        expect(unit1["orgUnitName"]).toBe("Phòng BE4-1");
        expect(all["actualAmount"]).toBe(1200);
        expect(all["plannedAmount"]).toBe(5000);
        expect(all["variance"]).toBe(3800);
        const a1 = Number(
          (
            await direct.query(
              `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_budget' AND action = 'read'`,
              [A.companyId],
            )
          ).rows[0].n,
        );
        expect(a1).toBe(a0 + 1);
        // Lọc theo đơn vị.
        const only = await as(officer.token).get(
          `/payroll/budgets?fiscalYear=${YEAR}&orgUnitId=${orgUnit1}`,
        );
        expect((only.body.data as unknown[]).length).toBe(1);
      });

      it("074: trùng (năm, đơn vị) ⇒ 409 029; trùng (năm, NULL) ⇒ 409 029 (bẫy NULL); đơn vị tenant khác ⇒ 404; thiếu manage ⇒ 403", async () => {
        expectError(
          await as(officer.token)
            .post("/payroll/budgets")
            .send({ fiscalYear: YEAR, orgUnitId: orgUnit1, plannedAmount: 1 }),
          409,
          "PAYROLL-ERR-029",
          "budget-exists",
        );
        expectError(
          await as(officer.token)
            .post("/payroll/budgets")
            .send({ fiscalYear: YEAR, plannedAmount: 1 }),
          409,
          "PAYROLL-ERR-029",
          "budget-exists",
        );
        const ouB = (
          await direct.query<{ id: string }>(
            `INSERT INTO org_units (company_id, name) VALUES ($1, 'B unit') RETURNING id`,
            [B.companyId],
          )
        ).rows[0].id;
        expectError(
          await as(officer.token)
            .post("/payroll/budgets")
            .send({ fiscalYear: YEAR + 1, orgUnitId: ouB, plannedAmount: 1 }),
          404,
          "PAYROLL-ERR-010",
          "not-found",
        );
        expect(
          (
            await as(bonusOnly.token)
              .post("/payroll/budgets")
              .send({ fiscalYear: YEAR + 1, plannedAmount: 1 })
          ).status,
        ).toBe(403);
        expect(
          (
            await as(officer.token)
              .post("/payroll/budgets")
              .send({ fiscalYear: 1999, plannedAmount: 1 })
          ).status,
        ).toBe(400);
      });

      it("075: sửa plannedAmount/note; xoá mềm ⇒ tạo lại được; id ma ⇒ 404", async () => {
        const c = await as(officer.token)
          .post("/payroll/budgets")
          .send({ fiscalYear: YEAR, orgUnitId: orgUnit2, plannedAmount: 10 });
        expect(c.status, JSON.stringify(c.body)).toBe(201);
        const id = c.body.data.id as string;
        const up = await as(officer.token)
          .patch(`/payroll/budgets/${id}`)
          .send({ plannedAmount: 20, note: "sửa" });
        expect(up.status, JSON.stringify(up.body)).toBe(200);
        const row = await as(officer.token).get(
          `/payroll/budgets?fiscalYear=${YEAR}&orgUnitId=${orgUnit2}`,
        );
        expect((row.body.data as Array<Record<string, unknown>>)[0]["plannedAmount"]).toBe(20);
        expect(
          (await as(officer.token).patch(`/payroll/budgets/${id}`).send({ delete: true })).status,
        ).toBe(200);
        expect(
          (await as(officer.token).patch(`/payroll/budgets/${id}`).send({ note: "x" })).status,
        ).toBe(404);
        expect(
          (
            await as(officer.token)
              .post("/payroll/budgets")
              .send({ fiscalYear: YEAR, orgUnitId: orgUnit2, plannedAmount: 30 })
          ).status,
        ).toBe(201);
        expect(
          (await as(officer.token).patch(`/payroll/budgets/${randomUUID()}`).send({ note: "x" }))
            .status,
        ).toBe(404);
        const audits = await direct.query(
          `SELECT after FROM audit_logs WHERE company_id = $1 AND object_type = 'payroll_budget' AND action IN ('create','update')`,
          [A.companyId],
        );
        expect(JSON.stringify(audits.rows)).not.toMatch(/"plannedAmount"\s*:/);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("076/077 — import thu nhập/khấu trừ khác", () => {
      const rowsOk = (month: string) => [
        HEADER,
        ["NV001", "Thưởng", "500000", "Thưởng dự án", month],
        ["nv002", "Khấu trừ", "120000.5", "Phạt đi trễ", month],
        ["NV003", "penalty", "1", "Khấu trừ khác", month],
      ];

      it("dryRun mặc định ⇒ 0 hàng, 0 audit; apply ⇒ 3 hàng `Pending` created_by = actor, period_month = kỳ, audit +1", async () => {
        const { id, month } = await periodAt("CollectingData");
        const dry = await upload(officer.token, id, await xlsxOf(rowsOk(month)), "tn.xlsx");
        expect(dry.status, JSON.stringify(dry.body)).toBe(201);
        expect(dry.body.data).toEqual({
          id,
          status: "CollectingData",
          affectedLines: 3,
          warnings: ["dry-run"],
        });
        expect(await pendingRows(month)).toHaveLength(0);
        expect(await auditImportCount(id)).toBe(0);

        const apply = await upload(
          officer.token,
          id,
          await xlsxOf(rowsOk(month)),
          "tn.xlsx",
          false,
        );
        expect(apply.status, JSON.stringify(apply.body)).toBe(201);
        expect(apply.body.data).toEqual({
          id,
          status: "CollectingData",
          affectedLines: 3,
          warnings: [],
        });
        const rows = await pendingRows(month);
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.status === "Pending" && r.created_by === officer.id)).toBe(true);
        expect(rows.map((r) => r.kind).sort()).toEqual(["bonus", "penalty", "penalty"]);
        expect(rows.map((r) => r.amount).sort()).toEqual(["1.00", "120000.50", "500000.00"]);
        expect(await auditImportCount(id)).toBe(1);
        // C6 — nạp lại cùng tệp ⇒ cảnh báo trùng, KHÔNG chặn.
        const again = await upload(officer.token, id, await xlsxOf(rowsOk(month)), "tn.xlsx");
        expect(again.body.data.warnings).toEqual(["dry-run", "possible-duplicate:3"]);
      });

      it("1 dòng sai ⇒ 422 030 `import-invalid` + `row:n` + 0 hàng; message KHÔNG chứa số tiền", async () => {
        const { id, month } = await periodAt("CollectingData");
        const res = await upload(
          officer.token,
          id,
          await xlsxOf([
            HEADER,
            ["NV001", "Thưởng", "10", "ok", month],
            ["NV002", "Thưởng", SECRET_AMOUNT + "x", "ok", month],
          ]),
          "tn.xlsx",
          false,
        );
        expectError(res, 422, "PAYROLL-ERR-030", "import-invalid");
        expect(detail(res, "row:2")).toBeTruthy();
        expect(detail(res, "row:1")).toBeUndefined();
        expect(detail(res, "errorRows")).toBe("1");
        expect(JSON.stringify(res.body)).not.toContain(SECRET_AMOUNT);
        expect(await pendingRows(month)).toHaveLength(0);
      });

      it("> 5.000 dòng ⇒ 422 030 `import-too-large`, 0 hàng (CSV — rẻ hơn XLSX cho 5.001 dòng)", async () => {
        const { id, month } = await periodAt("CollectingData");
        const rows = [
          HEADER,
          ...Array.from({ length: 5001 }, (_, i) => [`NV${i}`, "Thưởng", "1", "ok", month]),
        ];
        const res = await upload(officer.token, id, csvOf(rows), "big.csv", false);
        expectError(res, 422, "PAYROLL-ERR-030", "import-too-large");
        expect(detail(res, "max")).toBe("5000");
        expect(await pendingRows(month)).toHaveLength(0);
      });

      it("mã NV lạ ⇒ 422 030 `import-unknown-user`; header lệch ⇒ `import-invalid` {reason:header}; CSV cũng qua", async () => {
        const { id, month } = await periodAt("CollectingData");
        const unknown = await upload(
          officer.token,
          id,
          await xlsxOf([HEADER, ["NV999", "Thưởng", "10", "ok", month]]),
          "tn.xlsx",
          false,
        );
        expectError(unknown, 422, "PAYROLL-ERR-030", "import-unknown-user");
        expect(detail(unknown, "row:1")).toBeTruthy();
        const bad = await upload(
          officer.token,
          id,
          await xlsxOf([
            ["A", "B"],
            ["x", "y"],
          ]),
          "tn.xlsx",
        );
        expectError(bad, 422, "PAYROLL-ERR-030", "import-invalid");
        expect(detail(bad, "reason")).toBe("header");
        const csv = await upload(officer.token, id, csvOf(rowsOk(month)), "tn.csv", false);
        expect(csv.status, JSON.stringify(csv.body)).toBe(201);
        expect(await pendingRows(month)).toHaveLength(3);
      });

      it("kỳ `Approved` ⇒ 409 003 `period-frozen`; thiếu manage:bonus-penalty ⇒ 403 (0 ghi); không tệp ⇒ 422 030; kỳ tenant khác ⇒ 404", async () => {
        const frozen = await periodAt("Approved");
        expectError(
          await upload(
            officer.token,
            frozen.id,
            await xlsxOf(rowsOk(frozen.month)),
            "tn.xlsx",
            false,
          ),
          409,
          "PAYROLL-ERR-003",
          "period-frozen",
        );
        const { id, month } = await periodAt("CollectingData");
        expect(
          (await upload(bonusOnly.token, id, await xlsxOf(rowsOk(month)), "tn.xlsx", false)).status,
        ).toBe(403);
        expect(await pendingRows(month)).toHaveLength(0);
        const noFile = await as(officer.token).post(`/payroll-periods/${id}/import-adjustments`);
        expectError(noFile, 422, "PAYROLL-ERR-030", "import-invalid");
        expect(
          (await upload(officerB.token, id, await xlsxOf(rowsOk(month)), "tn.xlsx")).status,
        ).toBe(404);
      });

      it("077: 200 XLSX header = 5 nhãn hằng; nạp lại tệp mẫu vào 076 dryRun ⇒ 0 lỗi (khuôn tự-nhất-quán)", async () => {
        const res = await as(officer.token)
          .get("/payroll/imports/adjustments-template")
          .buffer(true)
          .parse(binaryParser);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
        const sheet = wb.worksheets[0];
        const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
        expect(header).toEqual(HEADER);
        const example = (sheet.getRow(2).values as unknown[]).slice(1).map(String);
        // Kỳ trong ví dụ phải bằng kỳ của URL ⇒ dựng kỳ đúng tháng ví dụ.
        const { id } = await periodAt("CollectingData", example[4]);
        const dry = await upload(officer.token, id, res.body as Buffer, "mau.xlsx");
        expect(dry.status, JSON.stringify(dry.body)).toBe(201);
        expect(dry.body.data.affectedLines).toBe(1);
        expect(
          (await as(bonusOnly.token).get("/payroll/imports/adjustments-template")).status,
        ).toBe(403);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("052 — template-in-use (nợ BE-2/BE-3)", () => {
      it("mẫu gắn kỳ SỐNG ⇒ delete:true 409 023 `template-in-use` {periods}; isActive:false ⇒ 409; kỳ xoá mềm ⇒ 200; mẫu không gắn ⇒ 200", async () => {
        const tpl = await cloneTemplate(
          direct,
          A.companyId,
          templateA,
          `BE4_TPL_${seq++}`,
          officer.id,
        );
        const p = await periodAt("Draft", nextMonth(), tpl);
        const del = await as(officer.token)
          .patch(`/payroll/templates/${tpl}`)
          .send({ delete: true });
        expectError(del, 409, "PAYROLL-ERR-023", "template-in-use");
        expect(detail(del, "periods")).toBe("1");
        expectError(
          await as(officer.token).patch(`/payroll/templates/${tpl}`).send({ isActive: false }),
          409,
          "PAYROLL-ERR-023",
          "template-in-use",
        );
        // Đổi tên vẫn được (không phải xoá/ngưng).
        expect(
          (await as(officer.token).patch(`/payroll/templates/${tpl}`).send({ name: "đổi tên" }))
            .status,
        ).toBe(200);
        await direct.query(`UPDATE payroll_periods SET deleted_at = now() WHERE id = $1`, [p.id]);
        expect(
          (await as(officer.token).patch(`/payroll/templates/${tpl}`).send({ isActive: false }))
            .status,
        ).toBe(200);
        const free = await cloneTemplate(
          direct,
          A.companyId,
          templateA,
          `BE4_TPL_${seq++}`,
          officer.id,
        );
        expect(
          (await as(officer.token).patch(`/payroll/templates/${free}`).send({ delete: true }))
            .status,
        ).toBe(200);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("NOTI 024/027 — đường thật outbox → bridge → notifications", () => {
      const drain = () =>
        drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
      const notisOf = async (userId: string, eventCode: string) =>
        (
          await direct.query<{
            dedupeKey: string | null;
            payload: Record<string, unknown>;
            moduleCode: string;
          }>(
            `SELECT dedupe_key AS "dedupeKey", payload, module_code AS "moduleCode" FROM notifications
            WHERE company_id = $1 AND recipient_user_id = $2 AND event_code = $3 AND deleted_at IS NULL ORDER BY created_at`,
            [A.companyId, userId, eventCode],
          )
        ).rows;

      it("024: tạo tạm ứng ⇒ noti tới người duyệt (admin), dedupe `PAYROLL_ADVANCE_SUBMITTED:<id>:<iso>`, module PAYROLL, 0 khoá tiền", async () => {
        const month = nextMonth();
        const res = await as(officer.token)
          .post("/payroll/advances")
          .send({ userId: e1, amount: 100, deductPeriodMonth: month, reason: "noti" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        await drain();
        const forAdmin = await notisOf(admin.id, "PAYROLL_ADVANCE_SUBMITTED");
        expect(forAdmin.length).toBeGreaterThanOrEqual(1);
        const mine = forAdmin.find((n) =>
          n.dedupeKey?.startsWith(`PAYROLL_ADVANCE_SUBMITTED:${res.body.data.id}:`),
        );
        expect(mine).toBeTruthy();
        expect(mine!.moduleCode).toBe("PAYROLL");
        expect(JSON.stringify(mine!.payload)).not.toMatch(/amount|gross|salary/i);
        expect(await notisOf(officer.id, "PAYROLL_ADVANCE_SUBMITTED")).toEqual([]);
      });

      it("027: hoàn tất đợt phủ đủ ở HAI kỳ ⇒ 2 noti (khoá theo kỳ); cùng kỳ enqueue hai lần ⇒ vẫn 1", async () => {
        const mkPaid = async () => {
          const { periodId } = await publishedPeriodWithPayslips(direct, A.companyId, {
            month: nextMonth(),
            payees: [{ userId: e1, net: "1.00" }],
            officerId: officer.id,
            approverId: admin.id,
          });
          const b = await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "cash" });
          expect(b.status, JSON.stringify(b.body)).toBe(201);
          const done = await as(admin.token)
            .post(`/payroll/payment-batches/${b.body.data.id}/complete`)
            .send({ confirmAllPaid: true });
          expect(done.status, JSON.stringify(done.body)).toBe(200);
          expect(done.body.data.periodStatus).toBe("Paid");
          return periodId;
        };
        const p1 = await mkPaid();
        const p2 = await mkPaid();
        // Giả lập producer enqueue LẦN HAI cho p1 (cùng payload) — engine dedupe theo `{periodId}` nuốt.
        const ev = await direct.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = 'payroll.payment_batch_completed' AND payload->>'periodId' = $2`,
          [A.companyId, p1],
        );
        expect(ev.rows).toHaveLength(1);
        await direct.query(
          `INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, 'payroll.payment_batch_completed', $2::jsonb)`,
          [A.companyId, JSON.stringify(ev.rows[0].payload)],
        );
        await drain();
        // officer giữ view:payment-batch, KHÔNG phải actor (admin hoàn tất) ⇒ nhận đúng 2 noti (p1 · p2), p1 chỉ một.
        const forOfficer = await notisOf(officer.id, "PAYROLL_PAYMENT_BATCH_COMPLETED");
        const keys = forOfficer.map((n) => n.dedupeKey);
        expect(keys.filter((k) => k === `PAYROLL_PAYMENT_BATCH_COMPLETED:${p1}`)).toHaveLength(1);
        expect(keys.filter((k) => k === `PAYROLL_PAYMENT_BATCH_COMPLETED:${p2}`)).toHaveLength(1);
        expect(await notisOf(admin.id, "PAYROLL_PAYMENT_BATCH_COMPLETED")).toEqual([]);
      });
    });
  },
);

function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  // superagent giao IncomingMessage (stream) cho parser tuỳ biến — kiểu khai là Response, đọc như stream.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}
