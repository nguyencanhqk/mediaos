/**
 * S15-PAYROLL-DEBT-1 — khung dùng chung của hai int-spec đợt chi trả `PAYROLL-API-066..072`
 * (`s15-payroll-be4-batches.int-spec.ts` · `s15-payroll-be4-batches-complete.int-spec.ts`). Tách nguyên văn từ
 * spec gốc (945 dòng, > 800) — mỗi file gọi `useBe4BatchesSuite()` TRONG `describe` của mình nên có app +
 * 3 công ty riêng (slug có hậu tố ngẫu nhiên ⇒ hai file chạy song song không đụng nhau).
 *
 * Actor là object ỔN ĐỊNH (điền bằng `Object.assign` trong `beforeAll`) ⇒ spec destructure được ngay lúc khai
 * báo. `app` · `direct` · `A` · `B` · `C` chỉ có SAU `beforeAll` ⇒ đọc qua getter của suite.
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, expect } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "./fixture-secrets";
import { directPool } from "./integration-db";
import {
  bankSettings,
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
} from "./payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "./seed";

const LOGIN_PW = loginPasswordFixture("s15payrollbe4bat");
/** Tiền tố số TK của fixture — mọi số TK sinh từ đây; chuỗi này KHÔNG được xuất hiện ở log/audit/DTO. */
export const ACCT_PREFIX = "8800550077";
export const MONEY_KEY = /gross|\bnet\b|amount|salary/i;

export interface Batch {
  id: string;
  warnings: string[];
}

export interface Actor {
  id: string;
  token: string;
}

type PeriodStatus = "Published" | "Approved" | "Locked";
type Body = Record<string, unknown>;

/** supertest parser nhị phân cho XLSX. */
export function binaryParser(
  res: request.Response,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  // superagent giao IncomingMessage (stream) cho parser tuỳ biến — kiểu khai là Response, đọc như stream.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}

export function useBe4BatchesSuite(slugPrefix: string) {
  let app: INestApplication | undefined;
  let direct: Pool | undefined;
  const companyIds: string[] = [];
  let A: SeededTenant | undefined;
  let B: SeededTenant | undefined;
  let C: SeededTenant | undefined;
  /** officer = người LẬP đợt · completer = người HOÀN TẤT · viewer = chỉ view:payment-batch · u1/u2/u3 = thiếu từng cặp cho 071. */
  const officer: Actor = { id: "", token: "" };
  const completer: Actor = { id: "", token: "" };
  const viewer: Actor = { id: "", token: "" };
  const u1: Actor = { id: "", token: "" };
  const u2: Actor = { id: "", token: "" };
  const u3: Actor = { id: "", token: "" };
  const officerB: Actor = { id: "", token: "" };
  const soloC: Actor = { id: "", token: "" };
  /** 10 người hưởng lương của A: P0..P7 có TK, P8/P9 KHÔNG. */
  const payees: string[] = [];
  let seq = 0;

  const ready = <T>(v: T | undefined, name: string): T => {
    if (v === undefined) {
      throw new Error(`be4-batches suite: ${name} chưa sẵn — chỉ đọc trong it/beforeAll`);
    }
    return v;
  };
  const db = (): Pool => ready(direct, "direct");
  const tenantA = (): SeededTenant => ready(A, "A");

  const nextMonth = (): string => {
    const i = seq++;
    return `${2080 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };
  const acct = (i: number): string => `${ACCT_PREFIX}${String(i).padStart(2, "0")}`;
  const netOf = (i: number): string => `${(i + 1) * 1_000_000}.00`;

  const http = () => request(ready(app, "app").getHttpServer());
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

  /** Kỳ `Published` mới của A với 10 phiếu (net (i+1)×1tr; P9 net 0 để có `zero-net`). */
  async function publishedPeriod(status: PeriodStatus = "Published") {
    const month = nextMonth();
    const list = payees.map((userId, i) => ({ userId, net: i === 9 ? "0.00" : netOf(i) }));
    const { periodId, payslipIdByUser } = await publishedPeriodWithPayslips(
      db(),
      tenantA().companyId,
      { month, payees: list, officerId: officer.id, approverId: completer.id, status },
    );
    return { periodId, month, payslipIdByUser };
  }

  async function createBatch(t: string, body: Body, expectStatus = 201): Promise<Batch> {
    const res = await as(t).post("/payroll/payment-batches").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
    return res.body.data as Batch;
  }

  const linesOf = async (batchId: string) =>
    (
      await db().query<{
        user_id: string;
        bank_account_snapshot: string | null;
        paid_at: Date | null;
        deleted_at: Date | null;
      }>(
        `SELECT user_id, bank_account_snapshot, paid_at, deleted_at FROM payroll_payment_lines
        WHERE batch_id = $1 ORDER BY user_id`,
        [batchId],
      )
    ).rows;

  const outboxOf = async (eventType: string, periodId: string) =>
    (
      await db().query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = $2 AND payload->>'periodId' = $3`,
        [tenantA().companyId, eventType, periodId],
      )
    ).rows;

  const auditRows = async (objectId: string | null, action: string) =>
    (
      await db().query<{ before: unknown; after: unknown }>(
        `SELECT before, after FROM audit_logs
        WHERE company_id = $1 AND object_type = 'payroll_payment_batch' AND action = $2
          AND ($3::uuid IS NULL OR object_id = $3::uuid)`,
        [tenantA().companyId, action, objectId],
      )
    ).rows;

  async function complete(t: string, batchId: string, body: Body = {}) {
    return as(t).post(`/payroll/payment-batches/${batchId}/complete`).send(body);
  }

  async function seedActors(pool: Pool, a: SeededTenant, b: SeededTenant, c: SeededTenant) {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const mk = async (t: SeededTenant, label: string, grant: (id: string) => Promise<void>) => {
      const email = `${label}@${t.slug}.test`;
      const id = await seedUser(pool, t.companyId, email, hash);
      await grant(id);
      return { id, token: await login(t, email) };
    };
    const allPairs = (t: SeededTenant, role: string) => (id: string) =>
      grantAllPayrollPairs(pool, t.companyId, id, role);
    const somePairs =
      (role: string, keys: Parameters<typeof grantPayrollPairs>[4]) => (id: string) =>
        grantPayrollPairs(pool, a.companyId, id, role, keys);

    Object.assign(officer, await mk(a, "officer", allPairs(a, "be4b-officer")));
    Object.assign(completer, await mk(a, "completer", allPairs(a, "be4b-completer")));
    Object.assign(viewer, await mk(a, "viewer", somePairs("be4b-viewer", ["batchList"])));
    Object.assign(u1, await mk(a, "u1", somePairs("be4b-u1", ["batchExport"])));
    Object.assign(u2, await mk(a, "u2", somePairs("be4b-u2", ["batchExport", "periodExport"])));
    Object.assign(u3, await mk(a, "u3", somePairs("be4b-u3", ["batchExport", "payslipList"])));
    Object.assign(officerB, await mk(b, "officer", allPairs(b, "be4b-officerb")));
    // B có người THỨ HAI giữ manage:payment-batch ⇒ C3 không chặn trước 404 sentinel ở ca cross-tenant.
    await mk(b, "admin", allPairs(b, "be4b-adminb"));
    // C: CHỈ MỘT người giữ manage:payment-batch ⇒ C3.
    Object.assign(soloC, await mk(c, "solo", allPairs(c, "be4b-soloc")));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nest = moduleRef.createNestApplication();
    app = nest;
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
    // Ca race giữ HAI request treo song song — server phải nghe thật (memory `supertest-closes-shared-server-on-first-response`).
    await nest.listen(0);
    const pool = directPool();
    direct = pool;

    const a = await seedCompany(pool, `${slugPrefix}a`);
    const b = await seedCompany(pool, `${slugPrefix}b`);
    const c = await seedCompany(pool, `${slugPrefix}c`);
    A = a;
    B = b;
    C = c;
    companyIds.push(a.companyId, b.companyId, c.companyId);
    await seedActors(pool, a, b, c);

    for (let i = 0; i < 10; i++) {
      const id = await seedUser(pool, a.companyId, `p${i}@${a.slug}.test`, "x");
      payees.push(id);
      await employeeProfile(pool, a.companyId, id, `NVB4${String(i).padStart(2, "0")}`);
      if (i < 8) await bankSettings(pool, a.companyId, id, acct(i), "VCB", `HOLDER ${i}`);
    }
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  return {
    get app(): INestApplication {
      return ready(app, "app");
    },
    get direct(): Pool {
      return db();
    },
    get A(): SeededTenant {
      return tenantA();
    },
    get B(): SeededTenant {
      return ready(B, "B");
    },
    get C(): SeededTenant {
      return ready(C, "C");
    },
    officer,
    completer,
    viewer,
    u1,
    u2,
    u3,
    officerB,
    soloC,
    payees,
    nextMonth,
    acct,
    netOf,
    as,
    detail,
    expectError,
    publishedPeriod,
    createBatch,
    linesOf,
    outboxOf,
    auditRows,
    complete,
  };
}
