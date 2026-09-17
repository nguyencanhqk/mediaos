/**
 * S15-PAYROLL-BE-5B — PDF hàng loạt 085, lấy-hoặc-tạo (owner O-4) chạy nền qua outbox (O-5) — plan §4 mục 1, 3 + §0b.
 *
 *  · consumer ĐĂNG KÝ trên app thật (B3a) · lô chạy qua `OutboxWorker` thật, không gọi thẳng consumer (B3b);
 *  · cổng: thiếu `view-payslip` / thiếu `export:payroll` / cặp @Department ⇒ 403 · kỳ tenant B ⇒ 404 — 0 tệp/audit/outbox;
 *  · trần tiêm qua provider (= 3): 4 phiếu ⇒ 422 031 `pdf-batch-too-large` · 0 phiếu ⇒ 409 007 `no-payslip-for-pdf`;
 *  · POST ⇒ 202 Pending + 1 audit + 1 event chỉ-id · POST lại ⇒ cùng lô, 0 audit thêm · worker chạy ⇒ POST (CÙNG
 *    `Idempotency-Key`) ⇒ 200 + url phản ánh trạng thái MỚI (O-8) ⇒ ZIP đủ entry, mỗi PDF đúng người;
 *  · người khác ⇒ lô riêng · thêm phiếu (vân tay đổi) ⇒ lô mới · `Failed` ⇒ 200 Failed, `retry` ⇒ lô mới ·
 *    `Pending` quá hạn ⇒ `stale` (B3c) · người yêu cầu mất cặp trước worker ⇒ `Failed{forbidden}`;
 *  · route file chung trên ZIP ⇒ 403.
 *
 * GATE CỨNG `hasDb && LANE_DB` + object storage.
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import JSZip from "jszip";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { EventBus } from "../../src/events/event-bus";
import { OutboxWorker } from "../../src/events/outbox-worker";
import {
  PAYSLIP_PDF_BATCH_EVENT,
  PAYSLIP_PDF_BATCH_LIMITS,
} from "../../src/payroll/payroll-payslip-pdf-batch.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import { inspectPdf, normalizePdfText } from "../helpers/pdf-text";
import {
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
} from "../helpers/payroll-v2-fixtures";
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

const hasStorage = !!process.env.S3_ENDPOINT && !!process.env.S3_BUCKET;
const hasLaneDb = hasDb && !!process.env.LANE_DB && hasStorage;
const LOGIN_PW = loginPasswordFixture("s15payrollbe5bbatch");
const CAP = 3;

type Actor = { id: string; token: string };
type BatchBody = {
  fileId: string;
  status: string;
  payslipCount: number;
  url?: string;
  expiresAt?: string;
  failure?: string;
};

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-5B · PDF hàng loạt 085", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;
  let officer: Actor;
  let officer2: Actor;
  let exportOnly: Actor;
  let payslipOnly: Actor;
  let dept: Actor;
  let fileAdmin: Actor;
  let approver = "";
  const payees: string[] = [];
  const names = ["Trần Văn Bảo", "Lê Thị Cẩm Hường", "Phạm Đức Anh"];
  let periodMain = "";
  let periodBig = "";
  let periodEmpty = "";
  let periodB = "";

  const http = () => request(app.getHttpServer());
  const post = (token: string, periodId: string, body: object = {}, key?: string) => {
    const req = http()
      .post(`/payroll-periods/${periodId}/payslips/pdf-batch`)
      .set("Authorization", `Bearer ${token}`);
    return (key ? req.set("Idempotency-Key", key) : req).send(body);
  };
  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }
  const count = async (q: string, params: unknown[]): Promise<number> =>
    Number((await direct.query(q, params)).rows[0].n);
  const sideEffects = async (actorId: string) => ({
    files: await count(
      `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND uploaded_by = $2`,
      [A.companyId, actorId],
    ),
    audits: await count(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND actor_user_id = $2 AND object_type = 'payroll_period' AND action = 'export'`,
      [A.companyId, actorId],
    ),
    events: await count(
      `SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1 AND event_type = $2`,
      [A.companyId, PAYSLIP_PDF_BATCH_EVENT],
    ),
  });
  const drain = () =>
    drainOutboxUntilSettled({
      worker: app.get(OutboxWorker),
      direct,
      companyIds: [A.companyId],
      timeoutMs: 60_000,
    });
  const newPeriod = async (month: string, users: readonly string[]) =>
    (
      await publishedPeriodWithPayslips(direct, A.companyId, {
        month,
        payees: users.map((userId) => ({ userId, net: "8123456.78" })),
        officerId: officer.id,
        approverId: approver,
      })
    ).periodId;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYSLIP_PDF_BATCH_LIMITS)
      .useValue({ maxPayslips: CAP })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    const tag = randomUUID().slice(0, 4);

    A = await seedCompany(direct, "be5bbat");
    B = await seedCompany(direct, "be5bbatb");
    companyIds.push(A.companyId, B.companyId);
    const mk = async (label: string, grant: (id: string) => Promise<void>) => {
      const email = `${label}@${A.slug}.test`;
      const id = await seedUser(direct, A.companyId, email, hash);
      await grant(id);
      return { id, token: await login(A, email) };
    };
    officer = await mk("officer", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, `b5bb-o-${tag}`),
    );
    officer2 = await mk("officer2", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5bb-o2-${tag}`, [
        "payslipPdfBatch",
        "payslipList",
      ]),
    );
    exportOnly = await mk("exportonly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5bb-x-${tag}`, ["payslipPdfBatch"]),
    );
    payslipOnly = await mk("paysliponly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5bb-p-${tag}`, ["payslipList"]),
    );
    dept = await mk("dept", (id) =>
      grantPayrollPairs(
        direct,
        A.companyId,
        id,
        `b5bb-d-${tag}`,
        ["payslipPdfBatch", "payslipList"],
        "Department",
      ),
    );
    fileAdmin = await mk("fileadmin", async (id) => {
      const roleId = await seedRole(direct, A.companyId, `b5bb-file-${tag}`);
      for (const action of ["view", "download", "delete"]) {
        const permId = await seedPermissionCatalog(direct, action, "foundation-file", false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, id, roleId, A.companyId);
    });
    approver = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, hash);
    for (let i = 0; i < 4; i += 1) {
      const id = await seedUser(direct, A.companyId, `p${i}@${A.slug}.test`, hash);
      if (names[i])
        await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [id, names[i]]);
      payees.push(id);
    }
    periodMain = await newPeriod("2094-01", payees.slice(0, 3));
    periodBig = await newPeriod("2094-02", payees);
    periodEmpty = await newPeriod("2094-03", []);

    const bOff = await seedUser(direct, B.companyId, `o@${B.slug}.test`, hash);
    const bApp = await seedUser(direct, B.companyId, `a@${B.slug}.test`, hash);
    const bEmp = await seedUser(direct, B.companyId, `e@${B.slug}.test`, hash);
    periodB = (
      await publishedPeriodWithPayslips(direct, B.companyId, {
        month: "2094-01",
        payees: [{ userId: bEmp, net: "1.00" }],
        officerId: bOff,
        approverId: bApp,
      })
    ).periodId;
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("consumer 085 đăng ký ĐÚNG MỘT lần trên app thật (quên đăng ký ⇒ event `done` im lặng)", () => {
    expect(app.get(EventBus).consumersFor(PAYSLIP_PDF_BATCH_EVENT)).toHaveLength(1);
  });

  it.each([
    ["thiếu `view-payslip`", () => exportOnly, 403],
    ["thiếu `export:payroll`", () => payslipOnly, 403],
    ["cặp @Department", () => dept, 403],
  ])("DENY %s ⇒ %i, 0 tệp/audit/outbox", async (_label, who, status) => {
    const before = await sideEffects(who().id);
    const res = await post(who().token, periodMain);
    expect(res.status).toBe(status);
    expect(await sideEffects(who().id)).toEqual(before);
  });

  it("DENY kỳ của tenant B ⇒ 404 010, 0 tệp/audit/outbox", async () => {
    const before = await sideEffects(officer.id);
    const res = await post(officer.token, periodB);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
    expect(await sideEffects(officer.id)).toEqual(before);
  });

  it("vượt trần (4 > 3) ⇒ 422 031 `pdf-batch-too-large`, đếm TRƯỚC mọi ghi", async () => {
    const before = await sideEffects(officer.id);
    const res = await post(officer.token, periodBig);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PAYROLL-ERR-031");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "pdf-batch-too-large" }),
      ]),
    );
    expect(await sideEffects(officer.id)).toEqual(before);
  });

  it("kỳ không có phiếu ⇒ 409 007 `no-payslip-for-pdf`, 0 ghi", async () => {
    const before = await sideEffects(officer.id);
    const res = await post(officer.token, periodEmpty);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYROLL-ERR-007");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "no-payslip-for-pdf" }),
      ]),
    );
    expect(await sideEffects(officer.id)).toEqual(before);
  });

  it("body lạ ⇒ 400 (schema `.strict()`)", async () => {
    const res = await post(officer.token, periodMain, { retry: true, extra: 1 });
    expect(res.status).toBe(400);
  });

  it("luồng đủ: 202 Pending → worker → 200 + ZIP đúng người; cùng Idempotency-Key vẫn phản ánh trạng thái mới", async () => {
    const key = randomUUID();
    const before = await sideEffects(officer.id);
    const first = await post(officer.token, periodMain, {}, key);
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(first.headers["cache-control"]).toBe("no-store");
    const lot = first.body.data as BatchBody;
    expect(lot).toMatchObject({ status: "Pending", payslipCount: 3 });
    expect(lot.url).toBeUndefined();
    const afterCreate = await sideEffects(officer.id);
    expect(afterCreate).toEqual({
      files: before.files + 1,
      audits: before.audits + 1,
      events: before.events + 1,
    });
    const ev = await direct.query(
      `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, PAYSLIP_PDF_BATCH_EVENT],
    );
    expect(ev.rows[0].payload).toEqual({ fileId: lot.fileId });

    const again = await post(officer.token, periodMain, {}, randomUUID());
    expect(again.status).toBe(202);
    expect(again.body.data.fileId).toBe(lot.fileId);
    expect(await sideEffects(officer.id)).toEqual(afterCreate);

    await drain();

    const done = await post(officer.token, periodMain, {}, key);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.headers["idempotency-replayed"]).toBeUndefined();
    const ready = done.body.data as BatchBody;
    expect(ready).toMatchObject({ fileId: lot.fileId, status: "Uploaded", payslipCount: 3 });
    expect(ready.url).toBeTruthy();

    const zipRes = await fetch(ready.url as string);
    expect(zipRes.status).toBe(200);
    const zip = await JSZip.loadAsync(new Uint8Array(await zipRes.arrayBuffer()));
    const entries = Object.keys(zip.files).sort();
    expect(entries).toHaveLength(3);
    const texts = await Promise.all(
      entries.map(async (e) =>
        normalizePdfText((await inspectPdf(await zip.file(e)!.async("uint8array"))).text),
      ),
    );
    for (const name of names) {
      expect(texts.filter((t) => t.includes(name))).toHaveLength(1);
    }
    expect(texts.every((t) => t.includes("PHIẾU LƯƠNG THÁNG 01/2094"))).toBe(true);
    expect(await sideEffects(officer.id)).toEqual(afterCreate);
  }, 120_000);

  it("người khác cùng kỳ ⇒ lô RIÊNG (không bao giờ nhận lô của người gọi trước)", async () => {
    const mine = await post(officer.token, periodMain);
    const theirs = await post(officer2.token, periodMain);
    expect(theirs.status).toBe(202);
    expect(theirs.body.data.fileId).not.toBe(mine.body.data.fileId);
    expect(theirs.body.data.url).toBeUndefined();
  });

  it("Route file chung trên ZIP ⇒ 403 (metadata · download · xoá)", async () => {
    const lot = (await post(officer.token, periodMain)).body.data as BatchBody;
    const hdr = { Authorization: `Bearer ${fileAdmin.token}` };
    const meta = await http().get(`/foundation/files/${lot.fileId}`).set(hdr);
    const dl = await http().get(`/foundation/files/${lot.fileId}/download-url`).set(hdr);
    const del = await http().delete(`/foundation/files/${lot.fileId}`).set(hdr);
    expect([meta.status, dl.status, del.status]).toEqual([403, 403, 403]);
  });

  it("thêm phiếu vào kỳ (vân tay đổi) ⇒ lô MỚI", async () => {
    const period = await newPeriod("2094-05", payees.slice(0, 1));
    const first = (await post(officer.token, period)).body.data as BatchBody;
    await direct.query(
      `INSERT INTO payslips (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
       VALUES ($1, $2, $3, 1, 1, 1, $4, '{"workDays":22}'::jsonb)`,
      [A.companyId, period, payees[1], officer.id],
    );
    const second = await post(officer.token, period);
    expect(second.status).toBe(202);
    expect(second.body.data.fileId).not.toBe(first.fileId);
    expect(second.body.data.payslipCount).toBe(2);
  });

  it("lô `Failed` ⇒ 200 Failed (không tự sinh lại); `retry:true` ⇒ lô mới 202", async () => {
    const period = await newPeriod("2094-06", payees.slice(0, 1));
    const lot = (await post(officer.token, period)).body.data as BatchBody;
    await direct.query(
      `UPDATE files SET upload_status = 'Failed', metadata = metadata || '{"failure":"generation-failed"}'::jsonb
        WHERE id = $1`,
      [lot.fileId],
    );
    const failed = await post(officer.token, period);
    expect(failed.status).toBe(200);
    expect(failed.body.data).toMatchObject({
      fileId: lot.fileId,
      status: "Failed",
      failure: "generation-failed",
    });
    const retried = await post(officer.token, period, { retry: true });
    expect(retried.status).toBe(202);
    expect(retried.body.data.fileId).not.toBe(lot.fileId);
  });

  it("lô `Pending` quá hạn (worker không nhận) ⇒ `stale`; `retry` ⇒ lô mới", async () => {
    const period = await newPeriod("2094-07", payees.slice(0, 1));
    const lot = (await post(officer.token, period)).body.data as BatchBody;
    await direct.query(
      `UPDATE files SET created_at = now() - interval '20 minutes' WHERE id = $1`,
      [lot.fileId],
    );
    const stale = await post(officer.token, period);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({
      fileId: lot.fileId,
      status: "Failed",
      failure: "stale",
    });
    const retried = await post(officer.token, period, { retry: true });
    expect(retried.status).toBe(202);
    expect(retried.body.data.fileId).not.toBe(lot.fileId);
  });

  it("người yêu cầu MẤT cặp trước khi worker chạy ⇒ lô `Failed{forbidden}`, không có object", async () => {
    const period = await newPeriod("2094-08", payees.slice(0, 1));
    const temp = await (async () => {
      const email = `temp@${A.slug}.test`;
      const id = await seedUser(
        direct,
        A.companyId,
        email,
        await new PasswordService().hash(LOGIN_PW),
      );
      await grantPayrollPairs(direct, A.companyId, id, `b5bb-t-${randomUUID().slice(0, 4)}`, [
        "payslipPdfBatch",
        "payslipList",
      ]);
      return { id, token: await login(A, email) };
    })();
    const lot = (await post(temp.token, period)).body.data as BatchBody;
    expect(lot.status).toBe("Pending");
    await direct.query(`DELETE FROM user_roles WHERE user_id = $1`, [temp.id]);
    await drain();
    const row = await direct.query(
      `SELECT upload_status, metadata->>'failure' AS failure, file_size_bytes FROM files WHERE id = $1`,
      [lot.fileId],
    );
    expect(row.rows[0]).toMatchObject({ upload_status: "Failed", failure: "forbidden" });
    expect(Number(row.rows[0].file_size_bytes)).toBe(0);
  }, 60_000);
});
