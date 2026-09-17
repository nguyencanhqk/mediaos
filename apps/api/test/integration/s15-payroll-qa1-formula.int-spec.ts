/**
 * S15-PAYROLL-QA-1 (lane D, G11) — máy công thức trên ĐƯỜNG THẬT (SPEC-11 §21.1 mục 5 · 11 · P1).
 *
 *   A. 047 sửa công thức thành phần TUỲ BIẾN (đã gắn mẫu, kỳ đã Calculated) qua ĐÚNG route — đọc lại 008 KHÔNG
 *      đổi số/fingerprint; tính lại 007 mới đổi. (Ca C4 của `s15-payroll-be3-calculate.int-spec.ts` sửa
 *      `formula_override` THẲNG DB — ca này đi qua 047 thật, khác cơ chế.)
 *   B. Fuzz BIÊN HTTP của 048 (validate-formula) + một số ca cho `formula` của 045 (create): ~300 chuỗi tất định
 *      (PRNG có seed, khuôn `formula.fuzz.spec.ts`) — luôn 200 (`valid` true/false) hoặc 4xx CÓ MÃ, KHÔNG BAO GIỜ
 *      500, KHÔNG treo (timeout riêng từng request). JSON type-confusion (`formula` là number/array/object/null)
 *      ⇒ 400 VALIDATION-ERR-001 (Zod `z.string()` không nullable).
 *   C. 🔴 P1 — injection pin cho 017 (export XLSX kỳ lương): `employeeCode`/`displayName`/`adjustment_reason` qua
 *      `xlsxSafe`. Vá đã LÊN (`payroll-export.service.ts`, phiên chính) — ca này PHẢI xanh; nếu đỏ là hồi quy.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
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
import {
  employeeProfile,
  grantAllPayrollPairs,
  lockedAttendancePeriod,
  seedPayrollCatalog,
  weekdaysOf,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15qa1formula");

/** mulberry32 — cùng PRNG có seed dùng ở `formula.fuzz.spec.ts` (tái lập 100%, không đồng hồ). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  "A",
  "SYS_BASE_SALARY",
  "TL_BHXH_NV",
  "TONG_THU_NHAP",
  "IF",
  "MIN",
  "ROUND",
  "TNCN_LUY_TIEN",
  "BH_TRAN_BHXH",
  "AND",
  "OR",
  "(",
  ")",
  ",",
  "+",
  "-",
  "*",
  "/",
  "=",
  "<>",
  "0",
  "1.5",
  "999999999999999",
  " ",
];
const RAW = [
  "\u0000",
  "á",
  "😀",
  "'",
  '"',
  "$",
  "[",
  "]",
  ".",
  "_",
  "a",
  "\\",
  "\n",
  "`",
  "{",
  "}",
  ";",
];

/** Corpus tất định — 250 «súp token» ngẫu nhiên + ~15 ca biên đặt tên tường minh (§21.1 B5/B8). */
function fuzzCorpus(): string[] {
  const rnd = mulberry32(0x51a1_c0de);
  const out: string[] = [];
  for (let n = 0; n < 250; n++) {
    const len = Math.floor(rnd() * 40);
    let src = "";
    for (let k = 0; k < len; k++) {
      src +=
        rnd() < 0.85
          ? TOKENS[Math.floor(rnd() * TOKENS.length)]
          : RAW[Math.floor(rnd() * RAW.length)];
    }
    out.push(src);
  }
  out.push(
    "SYS_BASE_SALARY \u0000+ 1", // byte NUL thật
    "constructor.prototype",
    "__proto__",
    "process.exit()",
    "this",
    "this.constructor",
    "`${1}`", // template literal
    "(".repeat(10_000) + "1" + ")".repeat(10_000), // ngoặc lồng 10.000 cấp
    "9".repeat(500), // số 500 chữ số
    "LƯƠNG + 😀 + 1", // unicode/emoji
    "1" + " ".repeat(600), // dài hơn trần 500 ký tự
    " ".repeat(500), // chỉ khoảng trắng
    "-".repeat(499) + "1",
    `MIN(${Array.from({ length: 250 }, () => "1").join(",")})`,
  );
  return out;
}

/** Chạy `tasks` với độ song song giới hạn — giữ tổng thời lượng hợp lý mà KHÔNG đổi đầu vào tất định. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-QA-1 · G11 công thức — 047 không đổi số · fuzz HTTP 048 · P1 injection 017",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    let R: SeededTenant;
    let officer = "";
    let templateId = "";

    const http = () => request(app.getHttpServer());
    const as = (t: string) => ({
      get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
      post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
      patch: (u: string) => http().patch(u).set("Authorization", `Bearer ${t}`),
      put: (u: string) => http().put(u).set("Authorization", `Bearer ${t}`),
    });

    async function login(email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: R.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // supertest tự listen(0)+close() server dùng chung quanh MỖI request khi app chỉ init() — vô hại
      // tuần tự nhưng ECONNRESET khi B1 bắn song song (mapLimit) vì request về trước đóng server lúc
      // anh em còn đang bay (memory: supertest-closes-shared-server-on-first-response). Listen tường
      // minh Ở ĐÂY để supertest không sở hữu server.
      await app.listen(0);
      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      R = await seedCompany(direct, "qa1formula");
      companyIds.push(R.companyId);
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        R.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
      templateId = await seedPayrollCatalog(direct, R.companyId);
      const officerId = await seedUser(direct, R.companyId, `officer@${R.slug}.test`, hash);
      await grantAllPayrollPairs(direct, R.companyId, officerId, "qa1formula-officer");
      officer = await login(`officer@${R.slug}.test`);
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. 047 KHÔNG đổi số cho tới khi tính lại ────────────────────────────────────────────────────
    it("A1 — PATCH 047 công thức thành phần TUỲ BIẾN sau Calculated: đọc lại 008 y nguyên số + fingerprint; tính lại 007 mới đổi", async () => {
      const create = await as(officer).post("/payroll/salary-components").send({
        code: "QA1_TUY_BIEN",
        name: "Phụ cấp tuỳ biến QA1",
        kind: "earning",
        valueType: "formula",
        formula: "1000000",
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      const componentId = create.body.data.id as string;

      const detail = await as(officer).get(`/payroll/templates/${templateId}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      const existing = (
        detail.body.data.components as Array<{
          componentId: string;
          columnLabel: string | null;
          formulaOverride: string | null;
          isVisible: boolean;
          sortOrder: number;
        }>
      ).map((c) => ({
        componentId: c.componentId,
        columnLabel: c.columnLabel,
        formulaOverride: c.formulaOverride,
        isVisible: c.isVisible,
        sortOrder: c.sortOrder,
      }));
      const put = await as(officer)
        .put(`/payroll/templates/${templateId}/components`)
        .send({ components: [...existing, { componentId, sortOrder: 999 }] });
      expect(put.status, JSON.stringify(put.body)).toBe(200);

      const nvF = await seedUser(direct, R.companyId, `nvf@${R.slug}.test`, "x");
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
       VALUES ($1, $2, '2024-01-01', '20000000.00', '[]'::jsonb, 'GROSS')`,
        [R.companyId, nvF],
      );
      const MONTH = "2046-09";
      for (const d of weekdaysOf(MONTH)) {
        await direct.query(
          `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
         VALUES ($1, $2, $3, 'present', 0, 0)`,
          [R.companyId, nvF, d],
        );
      }
      const att = await lockedAttendancePeriod(direct, R.companyId, MONTH);
      const p = await as(officer)
        .post("/payroll-periods")
        .send({ periodMonth: MONTH, attendancePeriodId: att, templateId });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const periodId = p.body.data.id as string;
      expect((await as(officer).post(`/payroll-periods/${periodId}/collect`)).status).toBe(201);
      expect((await as(officer).post(`/payroll-periods/${periodId}/calculate`)).status).toBe(201);

      type Line = {
        userId: string;
        gross: number;
        templateFingerprint: string | null;
        components?: Array<{ code: string; value: number }>;
      };
      const lines = async (): Promise<Line> => {
        const res = await as(officer).get(`/payroll-periods/${periodId}/lines?per_page=100`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.data as Line[]).find((l) => l.userId === nvF) as Line;
      };
      const before = await lines();
      expect(before.gross).toBe(21_000_000); // 20.000.000 + PC_TUY_BIEN 1.000.000
      expect(before.components?.find((c) => c.code === "QA1_TUY_BIEN")?.value).toBe(1_000_000);
      expect(before.templateFingerprint).toMatch(/^[0-9a-f]{64}$/);

      const patch = await as(officer)
        .patch(`/payroll/salary-components/${componentId}`)
        .send({ formula: "3000000" });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);

      const reread = await lines();
      expect(reread.gross).toBe(before.gross);
      expect(reread.templateFingerprint).toBe(before.templateFingerprint);
      expect(reread.components).toEqual(before.components);

      expect((await as(officer).post(`/payroll-periods/${periodId}/calculate`)).status).toBe(201);
      const changed = await lines();
      expect(changed.gross).toBe(23_000_000); // 20.000.000 + PC_TUY_BIEN 3.000.000
      expect(changed.components?.find((c) => c.code === "QA1_TUY_BIEN")?.value).toBe(3_000_000);
      expect(changed.templateFingerprint).not.toBe(before.templateFingerprint);
    }, 120_000);

    // ── B. Fuzz biên HTTP 048 + một số ca 045 ───────────────────────────────────────────────────────
    it("B1 — 048: ~264 chuỗi tất định (PRNG seed) ⇒ luôn 200 hoặc 4xx CÓ MÃ, KHÔNG BAO GIỜ 5xx", async () => {
      const corpus = fuzzCorpus();
      const tally = { ok200: 0, ok4xx: 0, bad: [] as Array<{ src: string; status: number }> };
      await mapLimit(corpus, 12, async (src) => {
        const res = await as(officer)
          .post("/payroll/salary-components/validate-formula")
          .timeout({ response: 8_000, deadline: 15_000 })
          .send({ formula: src });
        if (res.status === 200) {
          expect(typeof res.body.data?.valid, `src=${JSON.stringify(src.slice(0, 80))}`).toBe(
            "boolean",
          );
          tally.ok200++;
        } else if (res.status >= 400 && res.status < 500) {
          expect(
            res.body?.error?.code,
            `src=${JSON.stringify(src.slice(0, 80))} status=${res.status}`,
          ).toBeTruthy();
          tally.ok4xx++;
        } else {
          tally.bad.push({ src: src.slice(0, 120), status: res.status });
        }
      });
      expect(tally.bad, JSON.stringify(tally.bad)).toEqual([]);
      expect(tally.ok200 + tally.ok4xx).toBe(corpus.length);
      // Phải THẬT SỰ chạm cả hai nhánh valid true/false — nếu không fuzz «không chạm nhánh lỗi» (xanh-rỗng).
      expect(tally.ok200).toBeGreaterThan(50);
    }, 180_000);

    it("B2 — 048: JSON type-confusion (`formula` là number/array/object/null/boolean) ⇒ 400 VALIDATION-ERR-001, KHÔNG 5xx", async () => {
      for (const bad of [123, [1, 2], { a: 1 }, null, true]) {
        const res = await as(officer)
          .post("/payroll/salary-components/validate-formula")
          .send({ formula: bad });
        expect(res.status, `formula=${JSON.stringify(bad)}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION-ERR-001");
      }
    });

    it("B3 — 045 (create): một số ca fuzz cho `formula` ⇒ 201 hoặc 422 PAYROLL-ERR-018/019/020, KHÔNG 5xx", async () => {
      const cases = [
        "\u0000SYS_BASE_SALARY",
        "constructor.prototype",
        "__proto__",
        "process.exit()",
        "(".repeat(600) + "1" + ")".repeat(600),
        "9".repeat(500),
        "😀 + 1",
        "1" + " ".repeat(600),
      ];
      let i = 0;
      for (const formula of cases) {
        const res = await as(officer)
          .post("/payroll/salary-components")
          .send({
            code: `QA1_FZ_${i++}`,
            name: "fuzz",
            kind: "earning",
            valueType: "formula",
            formula,
          });
        if (res.status === 201) continue;
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(["PAYROLL-ERR-018", "PAYROLL-ERR-019", "PAYROLL-ERR-020"]).toContain(
          res.body.error.code,
        );
      }
    }, 60_000);

    // ── C. 🔴 P1 — injection pin 017 ─────────────────────────────────────────────────────────────────
    it("C1 — P1: employeeCode/displayName/adjustment_reason bắt đầu bằng =/+/-/@ ⇒ ô XLSX 017 có tiền tố `'` (xlsxSafe)", async () => {
      const EVIL_NAME = "=HYPERLINK(1)";
      const EVIL_CODE = "@SUM(1,1)";
      const EVIL_REASON = "+1+1";

      const nvE = await seedUser(direct, R.companyId, `nve@${R.slug}.test`, "x");
      await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [nvE, EVIL_NAME]);
      await employeeProfile(direct, R.companyId, nvE, EVIL_CODE);
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
       VALUES ($1, $2, '2024-01-01', '15000000.00', '[]'::jsonb, 'GROSS')`,
        [R.companyId, nvE],
      );
      const MONTH = "2046-10";
      for (const d of weekdaysOf(MONTH)) {
        await direct.query(
          `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
         VALUES ($1, $2, $3, 'present', 0, 0)`,
          [R.companyId, nvE, d],
        );
      }
      const att = await lockedAttendancePeriod(direct, R.companyId, MONTH);
      const p = await as(officer)
        .post("/payroll-periods")
        .send({ periodMonth: MONTH, attendancePeriodId: att, templateId });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const periodId = p.body.data.id as string;
      expect((await as(officer).post(`/payroll-periods/${periodId}/collect`)).status).toBe(201);
      expect((await as(officer).post(`/payroll-periods/${periodId}/calculate`)).status).toBe(201);

      // `company R` mang chung `templateId`/salary_profile SỐNG của A1 (nvF) — người đó KHÔNG có chấm
      // công cho tháng 10 nhưng vẫn ra một dòng (0 tiền) trong CÙNG kỳ vì hồ sơ lương còn hiệu lực vô
      // thời hạn ⇒ `/lines` có THỂ trả nvF TRƯỚC nvE tuỳ thứ tự Postgres (không `ORDER BY`). Lấy đúng
      // dòng theo `userId`, KHÔNG đoán index 0 — nếu không, điều chỉnh tay ở dưới có thể vá NHẦM dòng.
      const lines = await as(officer).get(`/payroll-periods/${periodId}/lines?per_page=100`);
      const lineId = (lines.body.data as Array<{ id: string; userId: string }>).find(
        (l) => l.userId === nvE,
      )!.id;
      const adj = await as(officer)
        .patch(`/payroll-periods/${periodId}/lines/${lineId}`)
        .send({ adjustmentAmount: 1, adjustmentReason: EVIL_REASON });
      expect(adj.status, JSON.stringify(adj.body)).toBe(200);

      const ok = await as(officer)
        .get(`/payroll-periods/${periodId}/export`)
        .buffer(true)
        .parse(binaryParser);
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(ok.headers["content-disposition"]).toMatch(
        new RegExp(`attachment; filename="bang-luong-${MONTH}\\.xlsx"`),
      );

      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(ok.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const sheet = wb.worksheets[0];
      // `company R` mang chung `templateId`/salary_profile SỐNG của A1 (nvF) — người đó KHÔNG có chấm
      // công cho tháng 10 nhưng vẫn ra một dòng (0 tiền) trong CÙNG kỳ vì hồ sơ lương còn hiệu lực vô
      // thời hạn; Postgres KHÔNG cam kết thứ tự hàng khi không có `ORDER BY` nên hàng của nvE có thể là
      // dòng 2 HOẶC 3 tuỳ lượt chạy — tìm ĐÚNG dòng theo cột 14 (marker riêng của ca này) thay vì đoán
      // chỉ số dòng cố định.
      const rows: string[][] = [];
      for (let r = 2; r <= sheet.rowCount; r++)
        rows.push((sheet.getRow(r).values as unknown[]).map(String));
      const evilReasonCell = `'${EVIL_REASON}`;
      const matches = rows.filter((r) => r[14] === evilReasonCell);
      expect(matches, JSON.stringify(rows)).toHaveLength(1);
      const row = matches[0];
      // Cột 1=Mã NV, 2=Họ tên, 14=Lý do điều chỉnh (COLUMNS const của payroll-export.service.ts).
      expect(row[1]).toBe(`'${EVIL_CODE}`);
      expect(row[2]).toBe(`'${EVIL_NAME}`);
      expect(row[14]).toBe(`'${EVIL_REASON}`);
      // Đối chứng: KHÔNG còn công thức sống (chuỗi thô KHÔNG có tiền tố `'`) trong bất kỳ ô nào của hàng.
      expect(row.some((v) => v === EVIL_NAME || v === EVIL_CODE || v === EVIL_REASON)).toBe(false);
    }, 120_000);
  },
);

/** supertest parser nhị phân cho XLSX (khuôn `s15-payroll-be4-batches.int-spec.ts`). */
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}
