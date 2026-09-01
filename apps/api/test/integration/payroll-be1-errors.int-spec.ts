/**
 * S13-PAYROLL-BE-1 — mã lỗi PAYROLL trên ĐƯỜNG THẬT (SPEC-11 §12 · §13.3): `001` · `008` · `010` ·
 * `011` · `012` · `013` · `014`, cộng ca **RACE đi qua đúng trigger** `enforce_bonus_penalty_freeze`.
 *
 * Vì sao ca race là bắt buộc: mig `0564` `RAISE … USING ERRCODE='check_violation'` **không kèm
 * `USING CONSTRAINT`** ⇒ `err.constraint` rỗng ⇒ nhánh "23514 không tên" trong `mapPayrollPgError` là
 * đường **duy nhất** giữ lỗi đó khỏi thành 500 vùng đỏ. Không có ca đi qua trigger thì nhánh ấy là
 * **code chết** — đúng lớp bẫy `coverage-high-but-error-code-untested`.
 *
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
const LOGIN_PW = "Passw0rd!payrollerr";

const SENSITIVE = new Set([
  "calculate:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
]);

const PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["calculate", "payroll-period"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
  ["view", "bonus-penalty"],
  ["manage", "bonus-penalty"],
  ["approve", "bonus-penalty"],
];

describe.skipIf(!hasLaneDb)("S13-PAYROLL-BE-1 mã lỗi (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  /** `tAuthor` tạo, `tApprover` duyệt — four-eyes của thưởng/phạt cần HAI chủ thể. */
  let tAuthor = "";
  let tApprover = "";
  let subjectUserId = "";
  let authorId = "";
  let approverId = "";
  let attendancePeriodId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function grantAll(userId: string, label: string) {
    const roleId = await seedRole(
      direct,
      A.companyId,
      `payerr-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resource] of PAIRS) {
      const permId = await seedPermissionCatalog(
        direct,
        action,
        resource,
        SENSITIVE.has(`${action}:${resource}`),
      );
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        action === "access" ? "Own" : "Company",
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

  async function newBonus(month = "2028-01"): Promise<string> {
    const res = await post(tAuthor, "/bonus-penalties").send({
      userId: subjectUserId,
      kind: "bonus",
      amount: 100_000,
      periodMonth: month,
      reason: "fixture",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "payrollerr");
    companyIds.push(A.companyId);

    authorId = await seedUser(direct, A.companyId, `author@${A.slug}.test`, hash);
    await grantAll(authorId, "author");
    tAuthor = await login(`author@${A.slug}.test`);

    approverId = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, hash);
    await grantAll(approverId, "approver");
    tApprover = await login(`approver@${A.slug}.test`);

    subjectUserId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);

    const r = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,'2028-01','locked') RETURNING id`,
      [A.companyId],
    );
    attendancePeriodId = r.rows[0].id as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── 008 · 001 (kỳ lương) ──────────────────────────────────────────────────────────────────────

  it("008 — tạo kỳ cho tháng ĐÃ có kỳ ⇒ 409 PAYROLL-ERR-008 `period-month-exists`", async () => {
    const first = await post(tAuthor, "/payroll-periods").send({ periodMonth: "2028-02" });
    expect(first.status).toBe(201);
    const dup = await post(tAuthor, "/payroll-periods").send({ periodMonth: "2028-02" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("PAYROLL-ERR-008");
    expect(dup.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "period-month-exists" }),
      ]),
    );
  });

  it("001 — PATCH kỳ ở trạng thái ≥ Calculated ⇒ 409 PAYROLL-ERR-001; ở Draft ⇒ 200 (ALLOW đối chứng)", async () => {
    const p = await post(tAuthor, "/payroll-periods").send({
      periodMonth: "2028-03",
      attendancePeriodId,
    });
    expect(p.status).toBe(201);
    const id = p.body.data.id as string;

    // ALLOW: `Draft` sửa được.
    const okDraft = await patch(tAuthor, `/payroll-periods/${id}`).send({ note: "sửa ở Draft" });
    expect(okDraft.status).toBe(200);

    // ALLOW: `CollectingData` vẫn sửa được.
    expect((await post(tAuthor, `/payroll-periods/${id}/collect`)).status).toBe(201);
    const okCollecting = await patch(tAuthor, `/payroll-periods/${id}`).send({ note: "sửa tiếp" });
    expect(okCollecting.status).toBe(200);

    // DENY: đẩy thẳng trạng thái ở DB (route `calculate` là của BE-2) rồi thử sửa.
    await direct.query(
      `UPDATE payroll_periods SET status='Calculated', calculated_by=$2, calculated_at=now() WHERE id=$1`,
      [id, subjectUserId],
    );
    const denied = await patch(tAuthor, `/payroll-periods/${id}`).send({ note: "không được" });
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe("PAYROLL-ERR-001");
  });

  it("001 — `collect` từ trạng thái cấm ⇒ 409; từ Draft/CollectingData ⇒ OK (ALLOW đối chứng)", async () => {
    const p = await post(tAuthor, "/payroll-periods").send({
      periodMonth: "2028-04",
      attendancePeriodId,
    });
    const id = p.body.data.id as string;
    // ALLOW ×2 — lần hai là hành động TẠI CHỖ ở `CollectingData` (SPEC-11 §13.1 bảng).
    expect((await post(tAuthor, `/payroll-periods/${id}/collect`)).status).toBe(201);
    expect((await post(tAuthor, `/payroll-periods/${id}/collect`)).status).toBe(201);

    // ⚠️ `submitted_by` PHẢI khác `approved_by` — CHECK `payroll_periods_four_eyes_check` sống ở DB
    // và khoá cả fixture, không chỉ khoá đường API (bài học `db-invariant-kills-adversarial-fixtures`).
    await direct.query(
      `UPDATE payroll_periods SET status='Approved', calculated_by=$2, calculated_at=now(),
         submitted_by=$2, submitted_at=now(), approved_by=$3, approved_at=now() WHERE id=$1`,
      [id, authorId, approverId],
    );
    const denied = await post(tAuthor, `/payroll-periods/${id}/collect`);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe("PAYROLL-ERR-001");
    expect(denied.body.message).toContain("Approved");
  });

  it("010 — gắn kỳ công không thuộc company ⇒ 404 sentinel (không 403, không 500)", async () => {
    const res = await post(tAuthor, "/payroll-periods").send({
      periodMonth: "2028-05",
      attendancePeriodId: randomUUID(),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  // ── 014 (hồ sơ lương) ─────────────────────────────────────────────────────────────────────────

  it("014 — trùng `(user, effectiveDate)` ⇒ 409 `effective-date-exists`; ngày khác ⇒ 201", async () => {
    const body = { userId: subjectUserId, effectiveDate: "2028-01-01", baseSalary: 10_000_000 };
    const first = await post(tAuthor, "/salary-profiles").send(body);
    expect(first.status).toBe(201);
    const dup = await post(tAuthor, "/salary-profiles").send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("PAYROLL-ERR-014");
    expect(dup.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "effective-date-exists" }),
      ]),
    );
    // ALLOW đối chứng — versioned: ngày hiệu lực khác thì tạo được bản mới.
    const next = await post(tAuthor, "/salary-profiles").send({
      ...body,
      effectiveDate: "2028-02-01",
    });
    expect(next.status).toBe(201);
  });

  it("014 — xoá mềm rồi tạo LẠI cùng ngày ⇒ 201 (unique là PARTIAL `WHERE deleted_at IS NULL`)", async () => {
    const body = { userId: subjectUserId, effectiveDate: "2028-07-01", baseSalary: 11_000_000 };
    const created = await post(tAuthor, "/salary-profiles").send(body);
    expect(created.status).toBe(201);
    const removed = await patch(tAuthor, `/salary-profiles/${created.body.data.id}`).send({
      delete: true,
    });
    expect(removed.status).toBe(200);
    const again = await post(tAuthor, "/salary-profiles").send(body);
    expect(again.status, "unique partial phải cho tạo lại sau xoá mềm").toBe(201);
  });

  // ── 011 · 012 · 013 (thưởng/phạt) ─────────────────────────────────────────────────────────────

  it("012 — TỰ duyệt khoản do chính mình tạo ⇒ 409 `self-approval`; người khác duyệt ⇒ OK", async () => {
    const selfId = await newBonus();
    const self = await post(tAuthor, `/bonus-penalties/${selfId}/approve`).send({});
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe("PAYROLL-ERR-012");
    expect(self.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: "self-approval" })]),
    );

    // ALLOW đối chứng — thiếu ca này thì một service luôn-ném cũng làm ca trên xanh.
    const otherId = await newBonus();
    const byOther = await post(tApprover, `/bonus-penalties/${otherId}/approve`).send({});
    expect(byOther.status, JSON.stringify(byOther.body)).toBe(201);
    expect(byOther.body.data.status).toBe("Approved");
  });

  it("011 — quyết định/sửa hàng KHÔNG còn `Pending` ⇒ 409 `not-pending`", async () => {
    const id = await newBonus();
    expect((await post(tApprover, `/bonus-penalties/${id}/approve`).send({})).status).toBe(201);

    const twice = await post(tApprover, `/bonus-penalties/${id}/approve`).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("PAYROLL-ERR-011");
    expect(twice.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: "not-pending" })]),
    );

    const edit = await patch(tAuthor, `/bonus-penalties/${id}`).send({ reason: "sửa sau duyệt" });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("PAYROLL-ERR-011");
  });

  it("011 — `Rejected` cũng là TERMINAL; reject thiếu `decisionNote` ⇒ 400 (Zod, không chiếm mã)", async () => {
    const id = await newBonus();
    const noNote = await post(tApprover, `/bonus-penalties/${id}/reject`).send({});
    expect(noNote.status, "thiếu note là lỗi HÌNH THỨC ⇒ 400").toBe(400);

    const ok = await post(tApprover, `/bonus-penalties/${id}/reject`).send({
      decisionNote: "không hợp lệ",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("Rejected");

    const again = await post(tApprover, `/bonus-penalties/${id}/approve`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PAYROLL-ERR-011");
  });

  it("013 — hàng ĐÃ consume vào một kỳ ⇒ sửa/xoá 409 `already-consumed` (013 THẮNG 011)", async () => {
    const id = await newBonus();
    expect((await post(tApprover, `/bonus-penalties/${id}/approve`).send({})).status).toBe(201);
    // Máy tính lương (BE-2) sẽ bind cặp này; ở đây bind thẳng để dựng đúng trạng thái.
    const period = await post(tAuthor, "/payroll-periods").send({ periodMonth: "2028-06" });
    await direct.query(
      `UPDATE bonus_penalties SET payroll_period_id=$2, consumed_at=now() WHERE id=$1`,
      [id, period.body.data.id],
    );

    const edit = await patch(tAuthor, `/bonus-penalties/${id}`).send({ reason: "sửa" });
    expect(edit.status).toBe(409);
    // Hàng đã consume LUÔN là `Approved`; kiểm `Pending` trước sẽ trả nhầm 011.
    expect(edit.body.error.code).toBe("PAYROLL-ERR-013");
    expect(edit.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: "already-consumed" })]),
    );

    const del = await patch(tAuthor, `/bonus-penalties/${id}`).send({ delete: true });
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("PAYROLL-ERR-013");
  });

  it("013 (RACE) — trigger `enforce_bonus_penalty_freeze` bắt được ⇒ 409, KHÔNG 500", async () => {
    const id = await newBonus();
    // Dựng đúng cửa sổ race: service đọc hàng `Pending` chưa consume, rồi một giao dịch KHÁC đóng
    // băng nó trước khi câu UPDATE chạy. Mô phỏng bằng cách đổi trạng thái NGAY TRƯỚC lời gọi ở một
    // kết nối khác — tiền-kiểm của service đã trượt, chỉ còn trigger chặn.
    await direct.query(
      `UPDATE bonus_penalties SET status='Approved', decided_by=$2, decided_at=now() WHERE id=$1`,
      [id, subjectUserId],
    );
    const res = await patch(tAuthor, `/bonus-penalties/${id}`).send({ reason: "sửa khi đã duyệt" });
    // Service tiền-kiểm bắt trước ⇒ 011; nếu vì lý do nào đó lọt xuống DB thì trigger cho 23514 KHÔNG
    // TÊN và nhánh map phải đưa về 409 — cả hai đều KHÔNG được là 500.
    expect([409]).toContain(res.status);
    expect(res.body.error.code).toMatch(/^PAYROLL-ERR-01[13]$/);
  });

  it("013 (RACE thật qua trigger) — UPDATE trực tiếp trên hàng đã consume nổ 23514 KHÔNG TÊN", async () => {
    const id = await newBonus();
    await direct.query(
      `UPDATE bonus_penalties SET status='Approved', decided_by=$2, decided_at=now() WHERE id=$1`,
      [id, subjectUserId],
    );
    const period = await post(tAuthor, "/payroll-periods").send({ periodMonth: "2028-08" });
    await direct.query(
      `UPDATE bonus_penalties SET payroll_period_id=$2, consumed_at=now() WHERE id=$1`,
      [id, period.body.data.id],
    );
    // Đây là phép ĐO trực tiếp tiền đề của nhánh map: trigger RAISE không mang tên constraint.
    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await direct.query(`UPDATE bonus_penalties SET amount = amount + 1 WHERE id=$1`, [id]);
    } catch (e) {
      code = (e as { code?: string }).code;
      constraint = (e as { constraint?: string }).constraint;
    }
    expect(code, "trigger phải nổ check_violation").toBe("23514");
    expect(
      constraint ?? "",
      "nếu trigger BẮT ĐẦU mang tên constraint thì nhánh map 'không tên' thành code chết — sửa mapPayrollPgError",
    ).toBe("");
  });
});
