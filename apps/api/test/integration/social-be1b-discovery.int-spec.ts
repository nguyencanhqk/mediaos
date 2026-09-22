/**
 * S16-SOCIAL-BE-1B — tìm kiếm · thẻ · trang cá nhân · sinh nhật (`SOCIAL-API-023..026`) + đường GHI
 * `showBirthday` qua `PATCH /me/preferences` (D11/A3).
 *
 * ┌─ MỌI CA DENY Ở ĐÂY ĐỀU CÓ CA ALLOW ĐỐI CHỨNG ─────────────────────────────────────────────────┐
 * │ Cùng route, cùng fixture, chỉ đổi ACTOR — và ca allow assert 2xx + nội dung ≠ rỗng             │
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
const LOGIN_PW = "Passw0rd!socialbe1bdisc";

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news"
  | "view:user-preference"
  | "update:user-preference";

/** `view/update:user-preference` — cặp của `PATCH /me/preferences` (mig 0495), cần cho D11. */
const BASE: PairKey[] = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "view:user-preference",
  "update:user-preference",
];
const FULL: PairKey[] = [...BASE, "manage:feed-post", "manage:feed-news"];

/** Từ khoá HIẾM — không trùng bất kỳ fixture nào khác của lane. */
const NEEDLE = "zxqwvu";

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1B tìm kiếm/thẻ/profile/sinh nhật (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let unitX = "";
  let unitY = "";

  let tAuthor = "";
  let eAuthor = "";
  /** Nhân viên đơn vị X — actor chính của mọi ca đọc. */
  let tEmpX = "";
  /** Nhân viên đơn vị Y. */
  let tEmpY = "";
  /** Người ẩn sinh nhật (ca `showBirthday=false`). */
  let tHidden = "";
  let eHidden = "";
  /** Người KHÔNG ẩn — neo DƯƠNG của cùng ca. */
  let eShown = "";
  let tOther = "";

  /** 4 bài cùng từ khoá `NEEDLE` — ca C4. */
  let visibleId = "";
  let hiddenId = "";
  let orgYId = "";
  let otherTenantId = "";

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

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: readonly PairKey[],
  ) {
    const roleId = await seedRole(direct, companyId, `sb1bd-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
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

  /** `dateOfBirth` ISO `YYYY-MM-DD`; năm CỐ ĐỊNH 1990 để ca grep năm có thứ để bắt nếu rò. */
  async function makeMember(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
    orgUnitId: string | null,
    dateOfBirth: string | null = null,
  ): Promise<{ token: string; userId: string; employeeId: string }> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    const r = await direct.query(
      `INSERT INTO employee_profiles
         (company_id, user_id, org_unit_id, status, work_type, employee_code, date_of_birth)
       VALUES ($1, $2, $3, 'active', 'offline', $4, $5) RETURNING id`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`, dateOfBirth],
    );
    await grantPairs(tenant.companyId, userId, label, pairs);
    return { token: await login(tenant.slug, email), userId, employeeId: r.rows[0].id as string };
  }

  /** `MM-DD` của hôm nay — sinh nhật "hôm nay" phải độc lập với ngày chạy test. */
  function todayMmDd(): string {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb1bdisca");
    B = await seedCompany(direct, "sb1bdiscb");
    companyIds.push(A.companyId, B.companyId);

    unitX = await seedOrgUnit(A.companyId, "Đơn vị X");
    unitY = await seedOrgUnit(A.companyId, "Đơn vị Y");

    const today = todayMmDd();
    const author = await makeMember(A, "author", FULL, hash, unitX, `1990-${today}`);
    tAuthor = author.token;
    eAuthor = author.employeeId;

    tEmpX = (await makeMember(A, "empx", BASE, hash, unitX)).token;
    tEmpY = (await makeMember(A, "empy", BASE, hash, unitY)).token;

    const hidden = await makeMember(A, "hiddenbd", BASE, hash, unitX, `1985-${today}`);
    tHidden = hidden.token;
    eHidden = hidden.employeeId;
    eShown = (await makeMember(A, "shownbd", BASE, hash, unitX, `1992-${today}`)).employeeId;

    tOther = (await makeMember(B, "outsider", FULL, hash, null, `1988-${today}`)).token;

    // ── 4 bài cùng từ khoá NEEDLE (ca C4) ──
    const v = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: `Bài thấy được ${NEEDLE} #ngansach`,
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    visibleId = v.body.data.id;

    const h = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: `Bài bị ẩn ${NEEDLE}`,
    });
    hiddenId = h.body.data.id;
    const hide = await patch(tAuthor, `/social/posts/${hiddenId}/moderation`).send({
      hidden: true,
    });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);

    const authorY = await makeMember(A, "authory", FULL, hash, unitY);
    const oy = await post(authorY.token, "/social/posts").send({
      type: "share",
      audience: "org_unit",
      orgUnitId: unitY,
      body: `Bài đơn vị Y ${NEEDLE}`,
    });
    expect(oy.status, JSON.stringify(oy.body)).toBe(201);
    orgYId = oy.body.data.id;

    const ot = await post(tOther, "/social/posts").send({
      type: "share",
      audience: "company",
      body: `Bài tenant B ${NEEDLE}`,
    });
    expect(ot.status, JSON.stringify(ot.body)).toBe(201);
    otherTenantId = ot.body.data.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ 023 — tìm kiếm toàn văn ══════════════

  describe("023 GET /social/search", () => {
    it("DENY: thiếu `view:feed` ⇒ 403 tầng 1", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = (await makeMember(A, "noviewsearch", ["create:feed-post"], hash, unitX)).token;
      expect((await get(t, `/social/search?q=${NEEDLE}`)).status).toBe(403);
    });

    /**
     * 🔴 C4 — `toEqual` trên tập id ĐÃ SORT, KHÔNG `toContain`, kèm neo DƯƠNG `length===1`.
     *
     * Lý do neo dương: `search_vector` là cột SINH `to_tsvector('simple', f_unaccent(body))`. Nếu vế
     * phải của câu khớp lệch cấu hình (`'english'` thay `'simple'`, hoặc quên `f_unaccent`), kết quả
     * là **0 hàng, HTTP 200, không lỗi** — và mọi assert kiểu "không chứa id sai" sẽ XANH GIẢ.
     */
    it("C4: tìm thấy ĐÚNG bài thấy được — không bài `hidden`, không `org_unit` khác, không tenant khác", async () => {
      const res = await get(tEmpX, `/social/search?q=${NEEDLE}&limit=50`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data.data as Array<{ id: string }>).map((i) => i.id);

      expect(ids.length, "neo DƯƠNG — 0 kết quả im lặng là lỗi cấu hình tsvector").toBe(1);
      expect([...ids].sort()).toEqual([visibleId]);
      expect(ids).not.toContain(hiddenId);
      expect(ids).not.toContain(orgYId);
      expect(ids).not.toContain(otherTenantId);
    });

    it("tác giả VẪN tìm thấy bài `hidden` CỦA CHÍNH MÌNH (vị từ visibility, không phải bộ lọc cứng)", async () => {
      const res = await get(tAuthor, `/social/search?q=${NEEDLE}&limit=50`);
      const ids = (res.body.data.data as Array<{ id: string }>).map((i) => i.id);
      expect(ids).toContain(hiddenId);
      expect(ids, "nhưng vẫn KHÔNG thấy bài của tenant khác").not.toContain(otherTenantId);
    });

    it("người THUỘC đơn vị Y tìm thấy bài của Y (ALLOW đối chứng cho vế org_unit của C4)", async () => {
      const res = await get(tEmpY, `/social/search?q=${NEEDLE}&limit=50`);
      const ids = (res.body.data.data as Array<{ id: string }>).map((i) => i.id);
      expect(ids).toContain(orgYId);
    });

    it("ký tự toán tử tsquery trong `q` KHÔNG làm 500 (plainto_tsquery tự thoát)", async () => {
      for (const q of ["a & b", "!(", "foo | bar", "'\"x"]) {
        const res = await get(tEmpX, `/social/search?q=${encodeURIComponent(q)}`);
        expect([200], `q=${q} ⇒ ${res.status}`).toContain(res.status);
      }
    });

    it("`q` rỗng ⇒ 400 (Zod), không phải một danh sách toàn bộ bài", async () => {
      expect((await get(tEmpX, "/social/search?q=")).status).toBe(400);
    });
  });

  // ══════════════ 024 — thẻ ══════════════

  describe("024 GET /social/tags", () => {
    it("ALLOW: 200 + có thẻ THẬT, mỗi item đúng 2 khoá, KHÔNG danh tính nào", async () => {
      const res = await get(tEmpX, "/social/tags?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.data as Array<Record<string, unknown>>;
      expect(items.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(Object.keys(items[0]!).sort()).toEqual(["tag", "usageCount"]);
      expect(items.map((i) => i.tag)).toContain("ngansach");
    });

    it("DENY: thiếu `view:feed` ⇒ 403", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = (await makeMember(A, "noviewtags", ["create:feed-post"], hash, unitX)).token;
      expect((await get(t, "/social/tags")).status).toBe(403);
    });

    it("`q` là tiền tố, chuẩn hoá `#`/hoa-thường giống lúc ghi", async () => {
      const res = await get(tEmpX, "/social/tags?q=%23NGAN");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body.data.data as Array<{ tag: string }>).map((t) => t.tag)).toContain(
        "ngansach",
      );
    });

    it("cross-tenant: thẻ của tenant A KHÔNG lộ sang tenant B", async () => {
      const res = await get(tOther, "/social/tags?limit=100");
      expect(res.status).toBe(200);
      expect((res.body.data.data as Array<{ tag: string }>).map((t) => t.tag)).not.toContain(
        "ngansach",
      );
    });

    it("ký tự đại diện `%` trong `q` được escape — không quét toàn bảng", async () => {
      const res = await get(tEmpX, "/social/tags?q=%25");
      expect(res.status).toBe(200);
      expect(res.body.data.data).toEqual([]);
    });
  });

  // ══════════════ 025 — trang cá nhân ══════════════

  describe("025 GET /social/profiles/{employee_id}/posts", () => {
    it("ALLOW: bài của nhân viên đó, và CHỈ bài actor thấy được", async () => {
      const res = await get(tEmpX, `/social/profiles/${eAuthor}/posts?limit=50`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data.data as Array<{ id: string }>).map((i) => i.id);
      expect(ids.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(ids).toContain(visibleId);
      expect(ids, "bài `hidden` của NGƯỜI KHÁC không lọt vào trang cá nhân").not.toContain(
        hiddenId,
      );
    });

    /**
     * 🔴 C5 — KHÔNG có oracle dò danh bạ. `employee_id` của TENANT KHÁC và `employee_id` hợp lệ nhưng
     * chưa có bài nào phải trả CÙNG một response, byte-giống-nhau: mã trạng thái khác nhau là đủ để
     * một vòng lặp đoán UUID học được "người này có tồn tại trong công ty kia".
     */
    it("C5: employee_id lạ / tenant khác ⇒ CÙNG response rỗng như người chưa đăng bài (KHÔNG 404)", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const noPosts = await makeMember(A, "noposts", BASE, hash, unitX);

      const ghost = await get(tEmpX, `/social/profiles/${randomUUID()}/posts`);
      const real = await get(tEmpX, `/social/profiles/${noPosts.employeeId}/posts`);

      expect(ghost.status, JSON.stringify(ghost.body)).toBe(200);
      expect(real.status).toBe(200);
      expect(ghost.body.data).toEqual(real.body.data);
      expect(ghost.body.data.data).toEqual([]);
    });

    it("C5: employee_id của TENANT KHÁC ⇒ vẫn 200 rỗng, KHÔNG lộ bài nào", async () => {
      const other = await direct.query(
        `SELECT id FROM employee_profiles WHERE company_id = $1 LIMIT 1`,
        [B.companyId],
      );
      const res = await get(tEmpX, `/social/profiles/${other.rows[0].id}/posts`);
      expect(res.status).toBe(200);
      expect(res.body.data.data).toEqual([]);
    });

    it("param không phải UUID ⇒ 400 (ParseUUIDPipe), không 500", async () => {
      expect((await get(tEmpX, "/social/profiles/khong-phai-uuid/posts")).status).toBe(400);
    });
  });

  // ══════════════ 026 — sinh nhật ══════════════

  describe("026 GET /social/birthdays", () => {
    it("DENY: thiếu `view:feed` ⇒ 403 (widget này KHÔNG cấp thêm cặp HR nào — SOC-DEC-007)", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = (await makeMember(A, "noviewbd", ["create:feed-post"], hash, unitX)).token;
      expect((await get(t, "/social/birthdays")).status).toBe(403);
    });

    /**
     * 🔴 done_when — hai vế, và vế thứ hai mới là vế khó:
     *   (a) `Object.keys(item)` BẰNG ĐÚNG `{employeeId, fullName, avatar, day, month}`;
     *   (b) grep regex NĂM trên **TOÀN BỘ** `JSON.stringify(response)`, không chỉ trên `day`/`month`
     *       — một cột `date_of_birth` lọt ra ở BẤT KỲ khoá nào cũng phải bị bắt.
     */
    it("DTO đúng 5 khoá + KHÔNG năm sinh ở BẤT KỲ đâu trong response", async () => {
      const res = await get(tEmpX, "/social/birthdays?range=today");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.data as Array<Record<string, unknown>>;
      expect(items.length, "neo DƯƠNG — fixture có người sinh nhật hôm nay").toBeGreaterThan(0);

      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(
          ["avatar", "day", "employeeId", "fullName", "month"].sort(),
        );
        expect(typeof item.day).toBe("number");
        expect(typeof item.month).toBe("number");
      }

      // `meta.timestamp` của envelope CÓ chứa năm hiện tại ⇒ chỉ grep phần `data`.
      const payload = JSON.stringify(res.body.data);
      expect(payload, `năm sinh rò ra trong: ${payload}`).not.toMatch(/\b(19|20)\d{2}\b/);
      expect(payload).not.toContain("dateOfBirth");
      expect(payload).not.toContain("date_of_birth");
    });

    /**
     * 🔴 Ca của FULL gate 22/09 — ba reviewer độc lập cùng chỉ ra.
     *
     * Người nghỉ việc **KHÔNG bị xoá mềm**: off-board đặt `status='resigned'`/`'terminated'` và giữ
     * nguyên hàng (`hr-write.service.ts:600-667`). Vị từ chỉ có `deleted_at IS NULL` ⇒ widget phơi
     * tên + avatar + ngày/tháng sinh của họ ra TOÀN công ty, và họ **không còn đường gỡ**: cách tự ẩn
     * duy nhất là `PATCH /me/preferences`, đòi một phiên đăng nhập mà tài khoản đã khoá không có.
     *
     * Ca dựng người MỚI (không mượn fixture dùng chung) để không làm lệch ca khác trong describe.
     */
    it("nhân viên đã NGHỈ VIỆC (status='resigned') KHÔNG xuất hiện ở widget — dù deleted_at vẫn NULL", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const today = todayMmDd();
      const leaver = await makeMember(A, "resigned", BASE, hash, unitX, `1991-${today}`);

      // Neo DƯƠNG trước: đúng người đó CÓ mặt khi còn `active` ⇒ ca không thể xanh vì một lý do khác
      // (sai ngày, sai đơn vị, widget rỗng).
      const before = await get(tEmpX, "/social/birthdays?range=today");
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      expect(
        (before.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId),
        "neo dương: khi còn active thì PHẢI thấy",
      ).toContain(leaver.employeeId);

      const upd = await direct.query(
        `UPDATE employee_profiles SET status = 'resigned' WHERE id = $1 AND deleted_at IS NULL`,
        [leaver.employeeId],
      );
      expect(upd.rowCount, "hàng vẫn sống — nghỉ việc KHÔNG phải xoá mềm").toBe(1);

      const after = await get(tEmpX, "/social/birthdays?range=today");
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(
        (after.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId),
        "người đã nghỉ vẫn lọt vào widget sinh nhật",
      ).not.toContain(leaver.employeeId);
    });

    it("cross-tenant: người của tenant B KHÔNG xuất hiện trong widget của tenant A", async () => {
      const res = await get(tEmpX, "/social/birthdays?range=month");
      const shown = (res.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId);
      const bIds = await direct.query(`SELECT id FROM employee_profiles WHERE company_id = $1`, [
        B.companyId,
      ]);
      for (const row of bIds.rows) expect(shown).not.toContain(row.id);
    });

    /**
     * 🔴 D11/A3 — đặt cờ QUA API THẬT (`PATCH /me/preferences`), KHÔNG bằng UPDATE SQL: cột `0584`
     * mà không có đường ghi là một tính năng chết, và ca này là thứ duy nhất chứng minh đường đó chạy.
     */
    it("showBirthday=false qua PATCH /me/preferences ⇒ biến khỏi widget (neo DƯƠNG: người khác VẪN hiện)", async () => {
      const before = await get(tEmpX, "/social/birthdays?range=today");
      const idsBefore = (before.body.data.data as Array<{ employeeId: string }>).map(
        (i) => i.employeeId,
      );
      expect(idsBefore, "trước khi ẩn: người này CÓ trong danh sách").toContain(eHidden);
      expect(idsBefore).toContain(eShown);

      const pref = await patch(tHidden, "/me/preferences").send({ showBirthday: false });
      expect(pref.status, JSON.stringify(pref.body)).toBe(200);
      expect(pref.body.data.showBirthday).toBe(false);

      // Cột THẬT đã đổi (không chỉ DTO dội lại).
      const col = await direct.query(
        `SELECT show_birthday FROM user_preferences up
           JOIN employee_profiles ep ON ep.user_id = up.user_id AND ep.company_id = up.company_id
          WHERE ep.id = $1`,
        [eHidden],
      );
      expect(col.rows[0].show_birthday).toBe(false);

      const after = await get(tEmpX, "/social/birthdays?range=today");
      const idsAfter = (after.body.data.data as Array<{ employeeId: string }>).map(
        (i) => i.employeeId,
      );
      expect(idsAfter, "người đã ẩn phải BIẾN MẤT").not.toContain(eHidden);
      expect(
        idsAfter,
        "neo DƯƠNG: người KHÔNG ẩn vẫn hiện — cờ không làm rỗng cả widget",
      ).toContain(eShown);
    });

    it("showBirthday=null (revert) ⇒ HIỆN lại — NULL là «kế thừa mặc định hiện», không phải «ẩn»", async () => {
      expect((await patch(tHidden, "/me/preferences").send({ showBirthday: null })).status).toBe(
        200,
      );
      const res = await get(tEmpX, "/social/birthdays?range=today");
      const ids = (res.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId);
      expect(ids).toContain(eHidden);
    });

    /**
     * D10 (owner ký 22/09) — cờ CHỈ chặn `day`/`month`. Nó KHÔNG ẩn danh tính khỏi tìm kiếm / thẻ /
     * trang cá nhân: đọc SPEC cũ theo nghĩa đen thì bài của người ẩn sinh nhật biến mất khỏi tìm kiếm.
     */
    it("D10: showBirthday=false KHÔNG ẩn người đó khỏi trang cá nhân/tìm kiếm", async () => {
      expect((await patch(tHidden, "/me/preferences").send({ showBirthday: false })).status).toBe(
        200,
      );

      const p = await post(tHidden, "/social/posts").send({
        type: "share",
        audience: "company",
        body: `Bài của người ẩn sinh nhật ${NEEDLE}`,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);

      const profile = await get(tEmpX, `/social/profiles/${eHidden}/posts`);
      expect(profile.status).toBe(200);
      expect(
        (profile.body.data.data as Array<{ id: string }>).map((i) => i.id),
        "cờ chặn day/month, KHÔNG ẩn bài/danh tính (D10)",
      ).toContain(p.body.data.id);

      const search = await get(tEmpX, `/social/search?q=${NEEDLE}&limit=50`);
      expect((search.body.data.data as Array<{ id: string }>).map((i) => i.id)).toContain(
        p.body.data.id,
      );

      // Trả lại trạng thái cho ca sau (fixture dùng chung trong describe).
      expect((await patch(tHidden, "/me/preferences").send({ showBirthday: null })).status).toBe(
        200,
      );
    });

    it("`range` ngoài tập ⇒ 400 (Zod), không im lặng rơi về `today`", async () => {
      expect((await get(tEmpX, "/social/birthdays?range=year")).status).toBe(400);
    });

    it("GET /me/preferences trả `showBirthday` (đường ĐỌC của cờ, không chỉ đường ghi)", async () => {
      expect((await patch(tHidden, "/me/preferences").send({ showBirthday: false })).status).toBe(
        200,
      );
      const res = await get(tHidden, "/me/preferences");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.showBirthday).toBe(false);
      expect((await patch(tHidden, "/me/preferences").send({ showBirthday: null })).status).toBe(
        200,
      );
    });
  });
});
