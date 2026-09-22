/**
 * S16-SOCIAL-BE-1B — báo cáo vi phạm (`SOCIAL-API-027..029`). 🔴 Cụm crown-jewel của WO.
 *
 * ┌─ MỌI CA DENY Ở ĐÂY ĐỀU CÓ CA ALLOW ĐỐI CHỨNG ─────────────────────────────────────────────────┐
 * │ Cùng route, cùng fixture, chỉ đổi ACTOR — và ca allow assert 2xx + nội dung ≠ rỗng. Không có   │
 * │ vế đó thì một route hỏng-toàn-tập (vd sai path ⇒ 404 mọi lúc) làm MỌI ca deny xanh giả          │
 * │ (`deny-cases-vacuous-without-allow-case`).                                                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
const LOGIN_PW = "Passw0rd!socialbe1b";

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news"
  | "view:feed-report"
  | "manage:feed-report";

const BASE: PairKey[] = ["view:feed", "create:feed-post", "create:feed-comment"];
const MODERATOR: PairKey[] = [...BASE, "view:feed-report", "manage:feed-report"];
const AUTHOR: PairKey[] = [...BASE, "manage:feed-post", "manage:feed-news"];

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1B báo cáo vi phạm (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let unitX = "";
  let unitY = "";

  /** HR — cặp báo cáo ở scope **Company** (thấy toàn bộ hàng đợi). */
  let tHr = "";
  /** Manager đơn vị X — cặp báo cáo ở scope **Department** (chỉ hàng đợi của X). */
  let tMgrX = "";
  let uMgrX = "";
  /** Manager đơn vị Y — đối chứng cho D6/H4-iii. */
  let tMgrY = "";
  let uMgrY = "";
  /** Nhân viên thường — CHỈ `view:feed`, dùng cho ca deny tầng 1. */
  let tEmp = "";
  /** Nhân viên thứ hai — người báo cáo KHÁC (ca N-D5). */
  let tEmp2 = "";
  /** Tác giả bài, có `manage:feed-post` để ẩn/xoá bài (ca N-D13-a/b). */
  let tAuthor = "";
  /** Actor giữ wildcard `*:*` — PIN hành vi ENGINE (W1'). */
  let tWildcard = "";
  /** Tenant B — cross-tenant. */
  let tOther = "";
  let otherPostId = "";

  /** Bài `audience='org_unit'` của đơn vị X. */
  let postX = "";
  /** Bài `audience='org_unit'` của đơn vị Y. */
  let postY = "";
  /** Bài `audience='company'` (không thuộc đơn vị nào). */
  let postCompany = "";
  /** Bình luận trên `postX` — đích ĐA HÌNH thứ hai. */
  let commentX = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, parent_id, head_user_id, status)
       VALUES ($1, $2, NULL, NULL, 'active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  /**
   * Cấp cặp quyền. `reportScope` tách RIÊNG khỏi `scope` chung vì đây là điểm cả file xoay quanh:
   * seed `0578` cấp `view:feed-report` cho `manager` ở **Department** và cho `hr` ở **Company**.
   */
  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: readonly PairKey[],
    reportScope: "Company" | "Department" = "Company",
  ) {
    const roleId = await seedRole(direct, companyId, `sb1b-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      const scope = resource === "feed-report" ? reportScope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeMember(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
    orgUnitId: string | null,
    reportScope: "Company" | "Department" = "Company",
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grantPairs(tenant.companyId, userId, label, pairs, reportScope);
    return { token: await login(tenant.slug, email), userId };
  }

  /** Mỗi ca tự tạo báo cáo RIÊNG — partial UNIQUE `feed_reports_open_uq` khoá theo BỘ BA. */
  async function report(
    token: string,
    targetType: "post" | "comment",
    targetId: string,
    reason = "spam",
  ) {
    return post(token, "/social/reports").send({ targetType, targetId, reason });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb1brepa");
    B = await seedCompany(direct, "sb1brepb");
    companyIds.push(A.companyId, B.companyId);

    unitX = await seedOrgUnit(A.companyId, "Đơn vị X");
    unitY = await seedOrgUnit(A.companyId, "Đơn vị Y");

    // Tác giả thuộc X và có `manage:feed-post` — cần để ẩn/xoá bài ở ca N-D13-a/b.
    tAuthor = (await makeMember(A, "author", AUTHOR, hash, unitX)).token;
    tHr = (await makeMember(A, "hr", MODERATOR, hash, null, "Company")).token;

    const mgrX = await makeMember(A, "mgrx", MODERATOR, hash, unitX, "Department");
    tMgrX = mgrX.token;
    uMgrX = mgrX.userId;
    const mgrY = await makeMember(A, "mgry", MODERATOR, hash, unitY, "Department");
    tMgrY = mgrY.token;
    uMgrY = mgrY.userId;

    tEmp = (await makeMember(A, "emp", BASE, hash, unitX)).token;
    tEmp2 = (await makeMember(A, "emp2", BASE, hash, unitX)).token;
    tWildcard = (await makeMember(A, "wild", ["*:*" as PairKey], hash, unitX)).token;
    tOther = (await makeMember(B, "outsider", MODERATOR, hash, null)).token;

    // Fixture qua API THẬT (giữ đúng counter/quan hệ — không gieo tay).
    const px = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "org_unit",
      orgUnitId: unitX,
      body: "Bài của đơn vị X",
    });
    expect(px.status, JSON.stringify(px.body)).toBe(201);
    postX = px.body.data.id;

    const pc = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài toàn công ty",
    });
    expect(pc.status, JSON.stringify(pc.body)).toBe(201);
    postCompany = pc.body.data.id;

    // Bài của đơn vị Y — tác giả phải THUỘC Y để đăng được vào Y (assertWriteAudience).
    const authorY = await makeMember(A, "authory", AUTHOR, hash, unitY);
    const py = await post(authorY.token, "/social/posts").send({
      type: "share",
      audience: "org_unit",
      orgUnitId: unitY,
      body: "Bài của đơn vị Y",
    });
    expect(py.status, JSON.stringify(py.body)).toBe(201);
    postY = py.body.data.id;

    const cx = await post(tAuthor, `/social/posts/${postX}/comments`).send({ body: "Bình luận X" });
    expect(cx.status, JSON.stringify(cx.body)).toBe(201);
    commentX = cx.body.data.id;

    const po = await post(tOther, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài của tenant B",
    });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    otherPostId = po.body.data.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ 027 — tạo báo cáo · IDOR đa hình · trùng ══════════════

  describe("027 POST /social/reports", () => {
    it("ALLOW đối chứng: báo cáo một bài THẤY ĐƯỢC ⇒ 201 + hàng THẬT trong feed_reports", async () => {
      const res = await report(tEmp, "post", postCompany, "spam");
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.id).toBeTruthy();

      const row = await direct.query(
        `SELECT status, target_type, target_id FROM feed_reports WHERE id = $1`,
        [res.body.data.id],
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].status).toBe("open");
      expect(row.rows[0].target_type).toBe("post");
      expect(row.rows[0].target_id).toBe(postCompany);
    });

    it("ALLOW: đích ĐA HÌNH `comment` cũng báo cáo được ⇒ 201", async () => {
      const res = await report(tEmp2, "comment", commentX, "harassment");
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    /**
     * 🔴 R27' — IDOR đa hình. `feed_reports.target_id` KHÔNG có FK (DB-17 §11 R1) nên DB không đỡ gì:
     * chỉ `assertTargetVisible` chặn. Ba hình dạng đích không hợp lệ phải trả CÙNG một 404.
     */
    it("DENY R27': đích của TENANT KHÁC ⇒ 404 SOCIAL-ERR-001 (không 201, không 403)", async () => {
      const res = await report(tEmp, "post", otherPostId);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");

      const leaked = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reports WHERE target_id = $1`,
        [otherPostId],
      );
      expect(leaked.rows[0].n, "KHÔNG được ghi hàng báo cáo nào cho đích tenant khác").toBe(0);
    });

    it("DENY R27': đích là bài `org_unit` NGOÀI tầm actor ⇒ 404 (cùng chuỗi)", async () => {
      // `tEmp` thuộc X, `postY` thuộc Y ⇒ không thấy được.
      const res = await report(tEmp, "post", postY);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");
    });

    it("DENY R27': đích là UUID không tồn tại ⇒ 404 CÙNG chuỗi (không oracle phân biệt)", async () => {
      const ghost = await report(tEmp, "post", randomUUID());
      const cross = await report(tEmp, "post", otherPostId);
      expect(ghost.status).toBe(404);
      // Hai lý do KHÁC NHAU phải trả CÙNG một thông điệp — nếu không, 404 trở thành oracle dò tồn tại.
      expect(ghost.body.error?.message ?? ghost.body.message).toBe(
        cross.body.error?.message ?? cross.body.message,
      );
    });

    /**
     * N-D5 — trùng khoá theo **BỘ BA** `(target, reporter)` khi cái cũ còn `open`, KHÔNG phải
     * "1 đích chỉ nhận 1 báo cáo". Ca thứ hai chứng minh đúng field nào bị khoá.
     */
    it("N-D5: cùng người báo cáo lại CÙNG đích khi cái cũ còn open ⇒ 409; người KHÁC ⇒ 201", async () => {
      const first = await report(tEmp, "post", postX, "spam");
      expect(first.status, JSON.stringify(first.body)).toBe(201);

      const dup = await report(tEmp, "post", postX, "other");
      expect(dup.status, JSON.stringify(dup.body)).toBe(409);
      expect(JSON.stringify(dup.body)).toContain("đang chờ xử lý");

      // Cùng ĐÍCH, khác NGƯỜI BÁO CÁO ⇒ 201. Đây là vế phân biệt "khoá theo bộ ba" với "khoá theo đích".
      const byOther = await report(tEmp2, "post", postX, "spam");
      expect(byOther.status, JSON.stringify(byOther.body)).toBe(201);
    });

    /** R30' — `@Idempotent()` trên `027`: cùng khoá ⇒ MỘT hàng, không hai. */
    it("R30': @Idempotent — hai request cùng Idempotency-Key ⇒ đúng 1 hàng feed_reports", async () => {
      const key = randomUUID();
      const body = { targetType: "post" as const, targetId: postCompany, reason: "misinformation" };
      const r1 = await post(tEmp2, "/social/reports").set("Idempotency-Key", key).send(body);
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      const r2 = await post(tEmp2, "/social/reports").set("Idempotency-Key", key).send(body);
      expect([200, 201]).toContain(r2.status);
      expect(r2.body.data.id).toBe(r1.body.data.id);

      const n = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reports
          WHERE company_id = $1 AND target_id = $2 AND reason = 'misinformation'`,
        [A.companyId, postCompany],
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  // ══════════════ 028 — hàng đợi + phạm vi Department (D6) ══════════════

  describe("028 GET /social/reports — phạm vi D6", () => {
    it("ALLOW đối chứng: HR (Company) thấy hàng đợi KHÔNG rỗng", async () => {
      const res = await get(tHr, "/social/reports");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Neo chống-xanh-rỗng: hàng đợi rỗng làm mọi ca deny bên dưới vô nghĩa.
      expect(res.body.data.total).toBeGreaterThan(0);
      expect(res.body.data.data.length).toBeGreaterThan(0);
    });

    /** N-D13-c — actor không có CẶP báo cáo bị chặn ở TẦNG 1, không tới truy vấn nào. */
    it("DENY N-D13-c: chỉ `view:feed` ⇒ 403 ở tầng 1 trên CẢ 028 lẫn 029", async () => {
      expect((await get(tEmp, "/social/reports")).status).toBe(403);
      const anyReport = await direct.query(
        `SELECT id FROM feed_reports WHERE company_id = $1 LIMIT 1`,
        [A.companyId],
      );
      expect(anyReport.rowCount).toBe(1);
      const res = await patch(tEmp, `/social/reports/${anyReport.rows[0].id}`).send({
        status: "resolved",
      });
      expect(res.status).toBe(403);
    });

    it("DENY: cross-tenant — actor tenant B KHÔNG thấy báo cáo nào của tenant A", async () => {
      const res = await get(tOther, "/social/reports");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data.data as Array<{ targetId: string }>).map((r) => r.targetId);
      expect(ids).not.toContain(postX);
      expect(ids).not.toContain(postCompany);
    });

    /**
     * 🔴 N-D6-a — quyết định owner 22/09: manager **Department KHÔNG thấy** báo cáo về bài
     * `audience='company'` (`org_unit_id IS NULL`). Loại đó do HR/company-admin (Company) xử lý.
     */
    it("N-D6-a: manager X KHÔNG thấy báo cáo về bài `audience='company'` (HR thì CÓ)", async () => {
      const mine = await report(tEmp, "post", postCompany, "inappropriate");
      // `tEmp` đã báo cáo `postCompany` ở ca trước ⇒ có thể 409; lấy id từ DB cho chắc.
      const row = await direct.query(
        `SELECT id FROM feed_reports WHERE company_id = $1 AND target_id = $2 ORDER BY created_at LIMIT 1`,
        [A.companyId, postCompany],
      );
      const reportId = (mine.status === 201 ? mine.body.data.id : row.rows[0].id) as string;

      const mgr = await get(tMgrX, "/social/reports?limit=100");
      expect(mgr.status, JSON.stringify(mgr.body)).toBe(200);
      const mgrIds = (mgr.body.data.data as Array<{ id: string }>).map((r) => r.id);
      expect(mgrIds).not.toContain(reportId);

      // ALLOW đối chứng — CÙNG báo cáo, actor Company-scope ⇒ CÓ.
      const hr = await get(tHr, "/social/reports?limit=100");
      const hrIds = (hr.body.data.data as Array<{ id: string }>).map((r) => r.id);
      expect(hrIds).toContain(reportId);
    });

    /** N-D6-b / N-D13-d — manager X thấy báo cáo của đơn vị MÌNH, KHÔNG thấy của đơn vị Y. */
    it("N-D6-b + N-D13-d: manager X thấy hàng đợi của X; báo cáo về bài Y KHÔNG xuất hiện (cả hàng lẫn snapshot)", async () => {
      // Báo cáo về bài Y — người báo cáo phải THẤY bài Y ⇒ dùng manager Y (cùng đơn vị Y).
      const onY = await report(tMgrY, "post", postY, "spam");
      expect([201, 409]).toContain(onY.status);
      const rowY = await direct.query(
        `SELECT id FROM feed_reports WHERE company_id = $1 AND target_id = $2 LIMIT 1`,
        [A.companyId, postY],
      );
      const reportY = rowY.rows[0].id as string;

      const onX = await report(tMgrX, "post", postX, "spam");
      expect([201, 409]).toContain(onX.status);
      const rowX = await direct.query(
        `SELECT id FROM feed_reports WHERE company_id = $1 AND target_id = $2 LIMIT 1`,
        [A.companyId, postX],
      );
      const reportX = rowX.rows[0].id as string;

      const res = await get(tMgrX, "/social/reports?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.data as Array<{ id: string; targetSnapshot: unknown }>;
      const ids = items.map((r) => r.id);

      expect(ids, "manager X phải thấy báo cáo của đơn vị mình (neo DƯƠNG)").toContain(reportX);
      expect(ids, "manager X KHÔNG được thấy báo cáo về bài của đơn vị Y").not.toContain(reportY);
      // Vế "cả snapshot": nội dung bài Y không được xuất hiện ở BẤT KỲ đâu trong response.
      expect(JSON.stringify(res.body)).not.toContain("Bài của đơn vị Y");
    });

    /**
     * 🔴 **D13-a — danh tính người tố giác CHỈ lộ ở scope `Company`** (owner ký 22/09/2026).
     *
     * Kịch bản đóng, dựng từ chính fixture này: `postX` thuộc đơn vị X; nhân viên `emp` (cũng ở X)
     * tố giác nó; vị từ D6 tính theo đơn vị của BÀI ⇒ manager X đọc được hàng báo cáo đó. Nếu DTO
     * chở luôn `reporter`, manager X — hoàn toàn có thể CHÍNH LÀ tác giả bài bị tố — biết ngay ai tố mình.
     *
     * Ca này pin CẢ HAI vế, và vế DƯƠNG đi TRƯỚC: HR @Company phải thấy `employeeId` THẬT của người
     * tố giác (trách nhiệm giải trình, chống báo cáo bừa) — không có neo đó thì vế `toBeNull()` bên dưới
     * xanh cả khi đường lấy `reporter` hỏng HOÀN TOÀN.
     */
    it("D13-a: manager @Department thấy hàng nhưng KHÔNG thấy người tố giác (HR @Company thì CÓ)", async () => {
      // `[201, 409]`: `N-D5` ở trên có thể đã tạo đúng bộ ba này — cả hai lối đều để lại MỘT hàng `open`.
      const r = await report(tEmp, "post", postX, "harassment");
      expect([201, 409]).toContain(r.status);
      // Ghim ĐÚNG loại 409 — nếu mai sau `027` sinh 409 vì lý do KHÁC (vd xung đột
      // `Idempotency-Key`), `toContain` ở trên sẽ nuốt mất.
      if (r.status === 409) expect(JSON.stringify(r.body)).toContain("đang chờ xử lý");

      const row = await direct.query(
        `SELECT fr.id FROM feed_reports fr
           JOIN users u ON u.id = fr.reporter_user_id
          WHERE fr.company_id = $1 AND fr.target_id = $2 AND u.email = $3
          ORDER BY fr.created_at DESC, fr.id DESC
          LIMIT 1`,
        [A.companyId, postX, `emp@${A.slug}.test`],
      );
      // `LIMIT 1` ⇒ `rowCount` chỉ có thể 0 hoặc 1: đây là neo TỒN TẠI, không phải neo duy-nhất.
      // `ORDER BY` để một lượt «dismiss rồi tố lại» sau này không làm hàng được chọn thành tuỳ ý.
      expect(row.rowCount, "phải TỒN TẠI hàng báo cáo của `emp` trên `postX`").toBe(1);
      const reportId = row.rows[0].id as string;

      type Item = { id: string; reporter: { employeeId: string | null } | null };

      // ① NEO DƯƠNG — HR @Company VẪN thấy đủ danh tính.
      const asHr = await get(tHr, "/social/reports?limit=100");
      expect(asHr.status, JSON.stringify(asHr.body)).toBe(200);
      const hrItem = (asHr.body.data.data as Item[]).find((x) => x.id === reportId);
      expect(hrItem, "HR phải thấy chính báo cáo vừa dựng").toBeTruthy();
      expect(hrItem!.reporter, "HR @Company KHÔNG được bị che — cần cho trách nhiệm giải trình").not.toBeNull();
      const reporterEmployeeId = hrItem!.reporter!.employeeId;
      expect(reporterEmployeeId, "`employeeId` người tố giác phải THẬT, không null").toBeTruthy();

      // ② DENY — manager X đọc CÙNG hàng đó ở Department.
      const asMgr = await get(tMgrX, "/social/reports?limit=100");
      expect(asMgr.status, JSON.stringify(asMgr.body)).toBe(200);
      const items = asMgr.body.data.data as Item[];
      const mgrItem = items.find((x) => x.id === reportId);
      expect(mgrItem, "manager X VẪN phải thấy hàng báo cáo của đơn vị mình (neo dương)").toBeTruthy();
      expect(mgrItem!.reporter, "manager @Department KHÔNG được thấy người tố giác").toBeNull();

      // Che theo SCOPE, không theo hàng: MỌI hàng trong hàng đợi của manager đều phải `null`.
      expect(items.length, "hàng đợi của manager X không được rỗng").toBeGreaterThan(0);
      for (const it of items) expect(it.reporter).toBeNull();

      // Tập khoá ĐÓNG phải GIỐNG HỆT hình dạng đã lộ — che bằng `null`, KHÔNG bỏ khoá.
      // `H5-keys` chỉ chạy bằng `tHr` nên nó khoá hình dạng ĐÃ LỘ; không có dòng dưới thì một lượt
      // sau lỡ `delete item.reporter` khi che sẽ không ai bắt.
      expect(Object.keys(mgrItem!).sort()).toEqual(Object.keys(hrItem!).sort());
      expect(Object.keys(mgrItem!)).toContain("reporter");

      // Và `employeeId` đó không lọt qua BẤT KỲ đường nào khác của response (snapshot, resolvedBy…).
      //
      // ⚠️ RÀNG BUỘC FIXTURE — ĐỪNG «sửa test» nếu dòng này đỏ: nó xanh được là vì `emp` KHÔNG đăng
      // bài nào (mọi bài do `author`/`authory` đăng) nên `targetSnapshot.authorEmployeeId` không bao giờ
      // trùng id người tố. Cho `emp` đăng bài bị tố trong unitX thì dòng này ĐỎ ĐÚNG — và nó chỉ ra
      // một kênh lộ THẬT (tự tố bài của chính mình), phải điều tra chứ không nới assert.
      expect(JSON.stringify(asMgr.body)).not.toContain(reporterEmployeeId!);
    });

    /**
     * 🔴 **029 LÀ ROUTE CHỈ-COMPANY, và đó là thiết kế — không phải thiếu sót.**
     *
     * ĐO THẬT trên seed `0578` (dòng 100-110): `manage:feed-report` chỉ cấp cho `hr` và
     * `company-admin` ở scope **Company**; `manager` chỉ có `view:feed-report@Department`. Vì vậy
     * `reportResolve` giữ `companyFloor:true`: một grant `manage:feed-report@Department` (cấu hình
     * seed KHÔNG sinh ra, nhưng vai tuỳ biến có thể) bị TỪ CHỐI THẲNG ở tầng 2 —
     * `AUTH-ERR-SCOPE-DENIED`, 403 — chứ KHÔNG được "coi như Company" rồi xử lý mọi báo cáo của công ty.
     *
     * Ca này pin cả HAI vế: manager Department bị 403 ở `029` (kể cả trên báo cáo của CHÍNH đơn vị
     * mình — tức không phải chuyện phạm vi hàng), còn HR Company thì 200. 403 ở đây KHÔNG rò gì: nó
     * nói về cấu hình QUYỀN của người gọi, không về sự tồn tại của hàng nào.
     */
    it("029 chỉ-Company: manager Department bị 403 SCOPE-DENIED ngay trên báo cáo của ĐƠN VỊ MÌNH (HR ⇒ 200)", async () => {
      const rowX = await direct.query(
        `SELECT id FROM feed_reports
          WHERE company_id = $1 AND target_id = $2 AND status = 'open' LIMIT 1`,
        [A.companyId, postX],
      );
      expect(rowX.rowCount, "cần một báo cáo open về bài của đơn vị X (neo dương)").toBe(1);
      const reportX = rowX.rows[0].id as string;

      // Manager X THẤY hàng này ở `028` — nên 403 dưới đây là về CẶP QUYỀN, không về phạm vi hàng.
      const list = await get(tMgrX, "/social/reports?limit=100");
      expect((list.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(reportX);

      const deny = await patch(tMgrX, `/social/reports/${reportX}`).send({ status: "dismissed" });
      expect(deny.status, JSON.stringify(deny.body)).toBe(403);
      expect(JSON.stringify(deny.body)).toContain("AUTH-ERR-SCOPE-DENIED");

      // ALLOW đối chứng: CÙNG hàng, actor Company-scope ⇒ 200.
      const allow = await patch(tHr, `/social/reports/${reportX}`).send({ status: "dismissed" });
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
    });

    /**
     * W1' — **PIN hành vi ENGINE, không phải một lỗ của SOCIAL.** 14 cặp `feed-*` đều
     * `is_sensitive=false` (mig `0578`) ⇒ wildcard `*:*` MỞ chúng (`permission.decide.ts` Priority 4).
     * Ca này ghi nhận hành vi đó để nó không đổi trong im lặng — **KHÔNG** được "vá" bằng cách bật
     * `is_sensitive` (đổi catalog = đổi SPEC, phá SOC-DEC-004, cần chữ ký owner).
     */
    it("W1' (PIN ENGINE): `*:*` MỞ `view:feed-report` ⇒ 200, không 403", async () => {
      const res = await get(tWildcard, "/social/reports");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    /**
     * H5-keys — DTO chở danh tính người tố giác + trích đoạn nội dung, nên tập khoá phải ĐÓNG.
     * `toEqual` chứ KHÔNG `toMatchObject`: một cột thừa lọt vào sẽ VÔ HÌNH dưới assert lỏng.
     */
    it("H5-keys: Object.keys của item VÀ của targetSnapshot BẰNG ĐÚNG tập đã ký", async () => {
      const res = await get(tHr, "/social/reports?limit=100");
      const item = (res.body.data.data as Array<Record<string, unknown>>).find(
        (r) => r.targetSnapshot != null,
      );
      expect(item, "phải có ít nhất một hàng CÓ snapshot (neo dương)").toBeTruthy();

      expect(Object.keys(item!).sort()).toEqual(
        [
          "createdAt",
          "id",
          "note",
          "reason",
          "reporter",
          "resolutionNote",
          "resolvedAt",
          "resolvedBy",
          "status",
          "targetId",
          "targetSnapshot",
          "targetType",
          "updatedAt",
        ].sort(),
      );
      expect(Object.keys(item!.targetSnapshot as object).sort()).toEqual(
        [
          "authorEmployeeId",
          "authorFullName",
          "avatarUrl",
          "bodyExcerpt",
          "deletedAt",
          "postId",
          "status",
        ].sort(),
      );
      expect(Object.keys(item!.reporter as object).sort()).toEqual(
        ["avatarUrl", "employeeId", "fullName"].sort(),
      );
      // KHÔNG `userId` ở bất kỳ tầng nào của DTO (luật danh tính của module).
      expect(JSON.stringify(item)).not.toContain("userId");
    });

    it("trang OFFSET: page/limit/total khớp và trang 2 KHÔNG lặp hàng của trang 1", async () => {
      const p1 = await get(tHr, "/social/reports?page=1&limit=2");
      expect(p1.status).toBe(200);
      expect(p1.body.data.page).toBe(1);
      expect(p1.body.data.limit).toBe(2);
      expect(p1.body.data.total).toBeGreaterThan(2);

      const p2 = await get(tHr, "/social/reports?page=2&limit=2");
      const ids1 = (p1.body.data.data as Array<{ id: string }>).map((r) => r.id);
      const ids2 = (p2.body.data.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
    });
  });

  // ══════════════ D13 / H4-ii — snapshot đọc XUYÊN cổng visibility ══════════════

  describe("D13 — targetSnapshot đọc xuyên `visiblePostCondition` (bypass CÓ CHỦ Ý)", () => {
    it("N-D13-a: bài bị ẩn SAU khi báo cáo ⇒ snapshot VẪN trả đủ, kèm status='hidden'", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Nội dung sẽ bị ẩn NDA13A",
      });
      expect(p.status).toBe(201);
      const pid = p.body.data.id as string;

      const rep = await report(tEmp, "post", pid, "inappropriate");
      expect(rep.status, JSON.stringify(rep.body)).toBe(201);

      const hide = await patch(tAuthor, `/social/posts/${pid}/moderation`).send({ hidden: true });
      expect(hide.status, JSON.stringify(hide.body)).toBe(200);

      const q = await get(tHr, "/social/reports?limit=100");
      const item = (
        q.body.data.data as Array<{ id: string; targetSnapshot: Record<string, unknown> | null }>
      ).find((r) => r.id === rep.body.data.id);
      expect(
        item?.targetSnapshot,
        "snapshot phải CÒN — đó là mục đích của bypass D13",
      ).toBeTruthy();
      expect(item!.targetSnapshot!.status).toBe("hidden");
      expect(String(item!.targetSnapshot!.bodyExcerpt)).toContain("NDA13A");
    });

    it("N-D13-b: bài XOÁ MỀM sau khi báo cáo ⇒ snapshot VẪN trả, `deletedAt` khác null", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Nội dung sẽ bị xoá NDA13B",
      });
      const pid = p.body.data.id as string;
      const rep = await report(tEmp2, "post", pid, "other");
      expect(rep.status, JSON.stringify(rep.body)).toBe(201);

      const del = await auth(tAuthor)(http().delete(`/social/posts/${pid}`));
      expect(del.status, JSON.stringify(del.body)).toBe(200);

      const q = await get(tHr, "/social/reports?limit=100");
      const item = (
        q.body.data.data as Array<{ id: string; targetSnapshot: Record<string, unknown> | null }>
      ).find((r) => r.id === rep.body.data.id);
      expect(item?.targetSnapshot).toBeTruthy();
      expect(item!.targetSnapshot!.deletedAt).not.toBeNull();
      expect(String(item!.targetSnapshot!.bodyExcerpt)).toContain("NDA13B");
    });

    /**
     * 🔴 N-D13-e — ORACLE. Bypass chỉ được đọc nội dung ĐÃ BỊ BÁO CÁO; nó KHÔNG được biến thành đường
     * đọc bài bất kỳ. Bài `hidden` KHÔNG có báo cáo nào ⇒ không đường nào của `028`/`029` trả nội dung.
     */
    it("N-D13-e: bài `hidden` KHÔNG bị báo cáo ⇒ không đường nào của 028/029 lộ nội dung", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "BI-MAT-KHONG-BI-BAO-CAO-NDA13E",
      });
      const pid = p.body.data.id as string;
      await patch(tAuthor, `/social/posts/${pid}/moderation`).send({ hidden: true });

      const q = await get(tHr, "/social/reports?limit=100");
      expect(q.status).toBe(200);
      expect(JSON.stringify(q.body)).not.toContain("NDA13E");

      // Và không có hàng báo cáo nào trỏ tới nó ⇒ đường `{id}` cũng không mở được.
      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reports WHERE target_id = $1`,
        [pid],
      );
      expect(rows.rows[0].n).toBe(0);
    });
  });

  // ══════════════ 029 — xử lý báo cáo · 409 · audit ══════════════

  describe("029 PATCH /social/reports/{id}", () => {
    async function freshReport(): Promise<string> {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: `Bài để xử lý ${randomUUID().slice(0, 6)}`,
      });
      const rep = await report(tEmp, "post", p.body.data.id as string, "spam");
      expect(rep.status, JSON.stringify(rep.body)).toBe(201);
      return rep.body.data.id as string;
    }

    it("ALLOW đối chứng: resolve ⇒ 200 + DB đặt ĐỒNG THỜI status/resolved_by/resolved_at", async () => {
      const id = await freshReport();
      const res = await patch(tHr, `/social/reports/${id}`).send({
        status: "resolved",
        resolutionNote: "Đã gỡ nội dung",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("resolved");
      expect(res.body.data.resolvedAt).not.toBeNull();
      expect(res.body.data.resolvedBy).not.toBeNull();
      // D13-a — biến đối số `revealReporter` của `029` từ lời hứa thành PHÉP ĐO: HR ở Company phải
      // thấy danh tính. Thiếu dòng này thì đổi đối số đó thành `false` vẫn xanh cả 12 ca của `029`.
      expect(res.body.data.reporter?.employeeId, "HR @Company phải thấy người tố giác ở 029").toBeTruthy();

      const row = await direct.query(
        `SELECT status, resolved_by, resolved_at, resolution_note FROM feed_reports WHERE id = $1`,
        [id],
      );
      expect(row.rows[0].status).toBe("resolved");
      // Cả CẶP phải có — `chk_feed_reports_resolved_pair` là thứ bảo đảm truy được ai xử lý, lúc nào.
      expect(row.rows[0].resolved_by).toBeTruthy();
      expect(row.rows[0].resolved_at).toBeTruthy();
      expect(row.rows[0].resolution_note).toBe("Đã gỡ nội dung");
    });

    it("N13: xử lý một báo cáo ĐÃ kết thúc ⇒ 409 SOCIAL-ERR-021 (dismissed cũng vậy)", async () => {
      const id = await freshReport();
      expect((await patch(tHr, `/social/reports/${id}`).send({ status: "dismissed" })).status).toBe(
        200,
      );

      const again = await patch(tHr, `/social/reports/${id}`).send({ status: "resolved" });
      expect(again.status, JSON.stringify(again.body)).toBe(409);
      expect(JSON.stringify(again.body)).toContain("SOCIAL-ERR-021");
    });

    it("404 TRƯỚC 409: báo cáo không tồn tại ⇒ 404 SOCIAL-ERR-001", async () => {
      const res = await patch(tHr, `/social/reports/${randomUUID()}`).send({ status: "resolved" });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");
    });

    it("status='open' bị Zod từ chối 400 — route này KẾT THÚC báo cáo, không mở lại", async () => {
      const id = await freshReport();
      const res = await patch(tHr, `/social/reports/${id}`).send({ status: "open" });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("audit: mỗi lượt xử lý ghi ĐÚNG một hàng audit_logs object_type='feed_report'", async () => {
      const id = await freshReport();
      const before = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'feed_report' AND object_id = $1`,
        [id],
      );
      expect(before.rows[0].n).toBe(0);

      expect((await patch(tHr, `/social/reports/${id}`).send({ status: "resolved" })).status).toBe(
        200,
      );

      const after = await direct.query(
        `SELECT action, metadata FROM audit_logs WHERE object_type = 'feed_report' AND object_id = $1`,
        [id],
      );
      expect(after.rowCount).toBe(1);
      expect(after.rows[0].action).toBe("social.report.resolved");
      // KHÔNG nội dung bài, KHÔNG ghi chú xử lý (chữ tự do) trong metadata audit — API-19 §8.
      expect(JSON.stringify(after.rows[0].metadata)).not.toContain("Bài để xử lý");
    });
  });

  // ══════════════ NOTI-036 — người nhận lọc theo Department (H4-iii) ══════════════

  describe("NOTI-036 — người nhận", () => {
    /**
     * 🔴 N-H4-iii. SPEC-16 viết câu ngắn «người có `view:feed-report`»; hành vi thật phải khớp D6 —
     * nếu không, manager Y nhận thông báo về một báo cáo mà mở ra thấy 404.
     */
    it("N-H4-iii: báo cáo về bài của đơn vị X ⇒ manager X nhận, manager Y KHÔNG nhận", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "org_unit",
        orgUnitId: unitX,
        body: `Bài X cho NOTI ${randomUUID().slice(0, 6)}`,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);

      const rep = await report(tEmp, "post", p.body.data.id as string, "harassment");
      expect(rep.status, JSON.stringify(rep.body)).toBe(201);
      const reportId = rep.body.data.id as string;

      const ev = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.post_reported' AND payload->>'report_id' = $1`,
        [reportId],
      );
      expect(ev.rowCount, "producer phải ghi outbox CÙNG tx với INSERT báo cáo").toBe(1);
      const recipients = ev.rows[0].payload.recipientUserIds as string[];

      expect(recipients, "manager của ĐÚNG đơn vị bài phải có").toContain(uMgrX);
      expect(recipients, "manager đơn vị KHÁC không được nhận").not.toContain(uMgrY);
      // Nhãn tiếng Việt từ bảng ĐÓNG — không phải placeholder còn nguyên.
      expect(ev.rows[0].payload.target_type_label).toBe("bài viết");
      expect(ev.rows[0].payload.reason_label).toBe("Quấy rối");
    });

    it("báo cáo về bài `audience='company'` ⇒ CHỈ Company-scope nhận (không manager Department nào)", async () => {
      const p = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: `Bài company cho NOTI ${randomUUID().slice(0, 6)}`,
      });
      const rep = await report(tEmp, "post", p.body.data.id as string, "spam");
      expect(rep.status, JSON.stringify(rep.body)).toBe(201);

      const ev = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.post_reported' AND payload->>'report_id' = $1`,
        [rep.body.data.id],
      );
      expect(ev.rowCount).toBe(1);
      const recipients = ev.rows[0].payload.recipientUserIds as string[];
      expect(recipients.length, "neo DƯƠNG: phải có ít nhất HR").toBeGreaterThan(0);
      expect(recipients).not.toContain(uMgrX);
      expect(recipients).not.toContain(uMgrY);
    });
  });
});
