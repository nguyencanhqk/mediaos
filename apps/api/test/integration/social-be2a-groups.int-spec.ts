/**
 * S16-SOCIAL-BE-2A · Bước 2 — cổng THỰC THỂ NHÓM ở tầng HTTP (`030`/`031`/`032`/`033`/`034`/`037`).
 *
 * ┌─ VÌ SAO Ở TẦNG HTTP ───────────────────────────────────────────────────────────────────────────┐
 * │ Vế phân quyền của cụm này KHÔNG nằm ở cặp quyền (9/10 route gác bằng `view:feed`) mà ở **vai    │
 * │ trò HÀNG** + thứ tự hai cổng 404→403 + nhánh thoát `manage:feed-group` (+audit). Test ở tầng    │
 * │ service chỉ chứng minh "hàm biết từ chối"; nó không bắt được route gọi NHẦM tập `allowedRoles`  │
 * │ — đúng lỗi làm `admin` xoá được nhóm mà không ai nhận ra (G6b).                                 │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Phủ: **G2** (đọc nhóm kín) · **G10** (`030` giấu nhóm kín · `037` không rò danh bạ) · **G6b**
 * (`admin` KHÔNG xoá được nhóm) · **G8** (`manage:feed-group` can thiệp + audit ghi đúng, và audit
 * KHÔNG ghi khi chính owner thao tác) · **G18** (trùng tên ⇒ 409, không 500) · **G12** (sau xoá mềm:
 * đọc/sửa/xin vào đều 404).
 *
 * Luật §5: **mỗi DENY có ALLOW đối chứng**, và neo dương đặt TRƯỚC mọi assert phủ định.
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
import { SOCIAL_ERR } from "../../src/social/social.errors";
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
const LOGIN_PW = "Passw0rd!socialbe2agroups";
const BASE_PAIRS = ["view:feed", "create:feed-group"] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2A · nhóm — cổng thực thể (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  /** owner của cả hai nhóm gốc. */
  let owner = { token: "", userId: "" };
  let admin = { token: "", userId: "" };
  let plain = { token: "", userId: "" };
  let outsider = { token: "", userId: "" };
  /** Giữ `manage:feed-group`, KHÔNG là thành viên nhóm nào. */
  let manager = { token: "", userId: "" };

  let privateGroupId = "";
  let publicGroupId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    label: string,
    hash: string,
    pairs: readonly string[] = BASE_PAIRS,
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `g-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);

    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId };
  }

  /** Nhóm gieo THẲNG (đường `031` có ca riêng) + bộ đếm khớp số hàng `active` gieo kèm. */
  async function seedGroup(
    name: string,
    visibility: "public" | "private",
    members: ReadonlyArray<{ userId: string; role: "owner" | "admin" | "member" }>,
  ): Promise<string> {
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, member_count)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, name, visibility, members.length],
    );
    const groupId = g.rows[0].id as string;
    for (const m of members) {
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'active', now())`,
        [A.companyId, groupId, m.userId, m.role],
      );
    }
    return groupId;
  }

  async function auditRowsFor(groupId: string): Promise<Array<{ action: string }>> {
    const r = await direct.query(
      `SELECT action FROM audit_logs WHERE company_id = $1 AND object_type = 'feed_group' AND object_id = $2`,
      [A.companyId, groupId],
    );
    return r.rows as Array<{ action: string }>;
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2agrps");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    owner = await makeUser("owner", hash);
    admin = await makeUser("admin", hash);
    plain = await makeUser("plain", hash);
    outsider = await makeUser("outsider", hash);
    manager = await makeUser("manager", hash, [...BASE_PAIRS, "manage:feed-group"]);

    privateGroupId = await seedGroup(`Kín ${randomUUID().slice(0, 6)}`, "private", [
      { userId: owner.userId, role: "owner" },
      { userId: admin.userId, role: "admin" },
      { userId: plain.userId, role: "member" },
    ]);
    publicGroupId = await seedGroup(`Mở ${randomUUID().slice(0, 6)}`, "public", [
      { userId: owner.userId, role: "owner" },
    ]);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  const idsOf = (res: request.Response): string[] =>
    (res.body.data.data as Array<{ id: string }>).map((g) => g.id);

  // ───────────────────────── G10 — `030` giấu nhóm kín ─────────────────────────

  it("G10-a ALLOW — `030` trả nhóm public và nhóm CỦA MÌNH, kèm `myRole`/`myStatus`", async () => {
    const res = await get(plain.token, "/social/groups");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = idsOf(res);
    // Neo DƯƠNG trước mọi assert phủ định — nếu danh sách rỗng thì ca DENY dưới là vacuous.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(privateGroupId);
    expect(ids).toContain(publicGroupId);
    const own = (
      res.body.data.data as Array<{ id: string; myRole: string; myStatus: string }>
    ).find((g) => g.id === privateGroupId);
    expect(own?.myRole).toBe("member");
    expect(own?.myStatus).toBe("active");
  });

  it("G10-b DENY — người NGOÀI không thấy nhóm private ở `030` (nhưng vẫn thấy nhóm public)", async () => {
    const res = await get(outsider.token, "/social/groups");
    expect(res.status).toBe(200);
    const ids = idsOf(res);
    expect(ids).toContain(publicGroupId); // neo dương
    expect(ids).not.toContain(privateGroupId);
    const pub = (res.body.data.data as Array<{ id: string; myRole: null; myStatus: null }>).find(
      (g) => g.id === publicGroupId,
    );
    expect(pub?.myRole).toBeNull();
    expect(pub?.myStatus).toBeNull();
  });

  it("`030?membership=mine` — CHỈ nhóm actor là thành viên active", async () => {
    const res = await get(owner.token, "/social/groups?membership=mine");
    expect(res.status).toBe(200);
    expect(idsOf(res).sort()).toEqual([privateGroupId, publicGroupId].sort());

    const none = await get(outsider.token, "/social/groups?membership=mine");
    expect(none.status).toBe(200);
    expect(idsOf(none)).toHaveLength(0);
  });

  it("`manage:feed-group` THẤY nhóm private không thuộc ở `030` (tìm được thứ mình quản trị được)", async () => {
    const res = await get(manager.token, "/social/groups");
    expect(res.status).toBe(200);
    expect(idsOf(res)).toContain(privateGroupId);
  });

  it("`030` — sau khi xin vào nhóm KÍN, chính người xin thấy nhóm đó với `myStatus='pending'`", async () => {
    const gid = await seedGroup(`Chờ ${randomUUID().slice(0, 6)}`, "private", [
      { userId: owner.userId, role: "owner" },
    ]);
    // Neo ÂM trước: chưa xin vào thì không thấy gì.
    expect(idsOf(await get(outsider.token, "/social/groups"))).not.toContain(gid);

    expect((await post(outsider.token, `/social/groups/${gid}/join`)).status).toBe(201);
    const after = await get(outsider.token, "/social/groups");
    const row = (after.body.data.data as Array<{ id: string; myStatus: string }>).find(
      (g) => g.id === gid,
    );
    expect(row?.myStatus, "giấu nhóm đang chờ duyệt làm FE không vẽ được nút nào").toBe("pending");

    // Cổng ĐỌC NỘI DUNG nhóm kín vẫn ĐÓNG với hàng `pending`: `032` và `037` trả **404**
    // (`assertGroupVisibleTx` đòi `active`). Bất đối xứng này CÓ CHỦ Ý và KHÔNG lộ thêm gì — `030`
    // chỉ lặp lại đúng những trường mà chính lượt `035` vừa trả về cho họ.
    expect((await get(outsider.token, `/social/groups/${gid}/members`)).status).toBe(404);
    expect((await get(outsider.token, `/social/groups/${gid}`)).status).toBe(404);
    expect(idsOf(await get(outsider.token, "/social/groups?membership=mine"))).not.toContain(gid);
  });

  it("`030?q=` — tìm theo tên không phân biệt hoa/thường, và `_` là KÝ TỰ THƯỜNG (đã escape)", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await seedGroup(`Kinh_doanh ${tag}`, "public", [
      { userId: owner.userId, role: "owner" },
    ]);
    const b = await seedGroup(`KinhXdoanh ${tag}`, "public", [
      { userId: owner.userId, role: "owner" },
    ]);

    const hit = await get(owner.token, `/social/groups?q=${encodeURIComponent("kinh_doanh")}`);
    expect(hit.status, JSON.stringify(hit.body)).toBe(200);
    expect(idsOf(hit)).toContain(a); // neo dương
    expect(idsOf(hit), "`_` không được khớp một ký tự bất kỳ — kết quả sai IM LẶNG").not.toContain(
      b,
    );
  });

  // ───────────────────────── G2 — `032` đọc nhóm ─────────────────────────

  it("G2 — người ngoài đọc nhóm KÍN ⇒ 404 ERR-012; thành viên và nhóm MỞ ⇒ 200", async () => {
    const ok = await get(plain.token, `/social/groups/${privateGroupId}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200); // neo dương
    expect(ok.body.data.name).toBeTruthy();

    const pub = await get(outsider.token, `/social/groups/${publicGroupId}`);
    expect(pub.status).toBe(200);

    const denied = await get(outsider.token, `/social/groups/${privateGroupId}`);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_NOT_FOUND);
  });

  // ───────────────────────── G18 — trùng tên ⇒ 409, KHÔNG 500 ─────────────────────────

  it("G18 — `031` tên mới ⇒ 201 (đếm = 1); trùng tên khác hoa/thường ⇒ 409 GROUP_NAME_TAKEN", async () => {
    const name = `Dự án ${randomUUID().slice(0, 6)}`;
    const created = await post(owner.token, "/social/groups").send({ name, visibility: "public" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // `031` +1 của bảng delta D10: nhóm mới đã có MỘT hàng active (người tạo).
    expect(created.body.data.memberCount).toBe(1);
    expect(created.body.data.myRole).toBe("owner");

    const dup = await post(owner.token, "/social/groups").send({
      name: name.toUpperCase(),
      visibility: "public",
    });
    expect(dup.status, "trùng tên phải là 409, KHÔNG 500").toBe(409);
    expect(JSON.stringify(dup.body)).toContain(SOCIAL_ERR.GROUP_NAME_TAKEN);
  });

  it("G18-b — trùng tên với nhóm ĐÃ XOÁ MỀM vẫn tạo được (index là partial `WHERE deleted_at IS NULL`)", async () => {
    const name = `Tạm ${randomUUID().slice(0, 6)}`;
    const first = await post(owner.token, "/social/groups").send({ name, visibility: "public" });
    expect(first.status).toBe(201);
    const del1 = await del(owner.token, `/social/groups/${first.body.data.id}`);
    expect(del1.status).toBe(200);

    const again = await post(owner.token, "/social/groups").send({ name, visibility: "public" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });

  it("G18-c — `033` đổi sang tên đã có ⇒ 409; đổi sang tên chưa dùng ⇒ 200", async () => {
    const taken = `Đã có ${randomUUID().slice(0, 6)}`;
    await post(owner.token, "/social/groups").send({ name: taken, visibility: "public" });
    const mine = await post(owner.token, "/social/groups").send({
      name: `Của tôi ${randomUUID().slice(0, 6)}`,
      visibility: "public",
    });
    const gid = mine.body.data.id as string;

    const ok = await patch(owner.token, `/social/groups/${gid}`).send({
      name: `Tên mới ${randomUUID().slice(0, 6)}`,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const clash = await patch(owner.token, `/social/groups/${gid}`).send({ name: taken });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toContain(SOCIAL_ERR.GROUP_NAME_TAKEN);
  });

  // ───────────────────────── G6b / G8 — vai trò theo ROUTE + audit ─────────────────────────

  it("G6b DENY — `admin` nhóm KHÔNG xoá được nhóm (403 ERR-014); `owner` xoá được", async () => {
    const gid = await seedGroup(`Xoá ${randomUUID().slice(0, 6)}`, "private", [
      { userId: owner.userId, role: "owner" },
      { userId: admin.userId, role: "admin" },
    ]);

    // ALLOW đối chứng TRƯỚC: admin sửa được nhóm (chỉ `034` mới là owner-only).
    const canPatch = await patch(admin.token, `/social/groups/${gid}`).send({
      description: "admin sửa được",
    });
    expect(canPatch.status, JSON.stringify(canPatch.body)).toBe(200);

    const denied = await del(admin.token, `/social/groups/${gid}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_ROLE_REQUIRED);

    const byOwner = await del(owner.token, `/social/groups/${gid}`);
    expect(byOwner.status).toBe(200);
  });

  it("G6b-b DENY — `member` thường không sửa (403) và không xoá (403) được nhóm", async () => {
    const p = await patch(plain.token, `/social/groups/${privateGroupId}`).send({ name: "x" });
    expect(p.status).toBe(403);
    const d = await del(plain.token, `/social/groups/${privateGroupId}`);
    expect(d.status).toBe(403);
  });

  it("G8 — `manage:feed-group` sửa được nhóm KHÔNG phải của mình VÀ audit ghi đúng", async () => {
    const gid = await seedGroup(`Quản trị ${randomUUID().slice(0, 6)}`, "private", [
      { userId: owner.userId, role: "owner" },
    ]);
    // Neo ÂM trước: chưa có dòng audit nào cho nhóm này.
    expect(await auditRowsFor(gid)).toHaveLength(0);

    const byOwner = await patch(owner.token, `/social/groups/${gid}`).send({
      description: "owner",
    });
    expect(byOwner.status).toBe(200);
    // Bất đối xứng CÓ CHỦ Ý (API-19 §8): owner sửa nhóm CỦA MÌNH ⇒ KHÔNG vào sổ.
    expect(await auditRowsFor(gid)).toHaveLength(0);

    const byManager = await patch(manager.token, `/social/groups/${gid}`).send({
      description: "quản trị viên sửa",
    });
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(200);
    const rows = await auditRowsFor(gid);
    expect(rows.map((r) => r.action)).toContain("social.group.updated");

    const delByManager = await del(manager.token, `/social/groups/${gid}`);
    expect(delByManager.status).toBe(200);
    expect((await auditRowsFor(gid)).map((r) => r.action)).toContain("social.group.deleted");
  });

  it("G8b — vòng đời nhóm (`031` sinh · `034` diệt) vào sổ audit KỂ CẢ khi actor là owner của chính nhóm", async () => {
    // FULL gate 22/09 (`security-reviewer` MEDIUM-2): khuôn «chỉ ghi sổ khi đụng nội dung NGƯỜI
    // KHÁC» đúng cho BÀI (nội dung riêng của tác giả), SAI cho NHÓM — `034` làm mọi bài trong nhóm
    // biến khỏi feed VÀ khỏi đường tải tệp của TẤT CẢ thành viên. Cả hai assert dưới đây ĐỎ trên
    // code TRƯỚC bản vá — đọc thẳng từ diff, không phải phép đo đã chạy: `create()` không có một
    // lời gọi `recordGroupAudit` nào, còn `remove()` gói lời gọi trong `if (viaManage)` mà ca này
    // xoá bằng token của chính `owner` (⇒ `viaManage === false`).
    const created = await post(owner.token, "/social/groups").send({
      name: `Vòng đời ${randomUUID().slice(0, 6)}`,
      description: "sinh và diệt bởi chính owner",
      visibility: "private",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const gid = created.body.data.id as string;

    expect((await auditRowsFor(gid)).map((r) => r.action)).toContain("social.group.created");

    const delByOwner = await del(owner.token, `/social/groups/${gid}`);
    expect(delByOwner.status, JSON.stringify(delByOwner.body)).toBe(200);
    expect((await auditRowsFor(gid)).map((r) => r.action)).toContain("social.group.deleted");
  });

  // ───────────────────────── G10 (`037`) — danh bạ nhóm ─────────────────────────

  it("G10-c — `037`: thành viên đọc được (neo dương); người ngoài nhóm KÍN ⇒ 404; nhóm MỞ ⇒ 403", async () => {
    const ok = await get(plain.token, `/social/groups/${privateGroupId}/members`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.total).toBe(3);
    expect((ok.body.data.data as Array<{ userId: string }>).map((m) => m.userId)).toContain(
      owner.userId,
    );

    const hidden = await get(outsider.token, `/social/groups/${privateGroupId}/members`);
    expect(hidden.status, "nhóm kín: 404 — không xác nhận nhóm tồn tại").toBe(404);

    const forbidden = await get(outsider.token, `/social/groups/${publicGroupId}/members`);
    expect(forbidden.status, "nhóm mở: 403 — nhóm công khai nhưng danh bạ thì không").toBe(403);

    const byManager = await get(manager.token, `/social/groups/${privateGroupId}/members`);
    expect(byManager.status).toBe(200);
  });

  // ───────────────────────── G12 — vòng đời xoá mềm ─────────────────────────

  it("G12 — sau `034`: `032` 404 · `030` vắng mặt · `035` xin vào 404 (neo dương trước khi xoá)", async () => {
    const gid = await seedGroup(`Sắp xoá ${randomUUID().slice(0, 6)}`, "public", [
      { userId: owner.userId, role: "owner" },
    ]);

    // Neo DƯƠNG: trước khi xoá, cả ba đường đều chạy được.
    expect((await get(outsider.token, `/social/groups/${gid}`)).status).toBe(200);
    expect(idsOf(await get(outsider.token, "/social/groups"))).toContain(gid);

    expect((await del(owner.token, `/social/groups/${gid}`)).status).toBe(200);

    const gone = await get(outsider.token, `/social/groups/${gid}`);
    expect(gone.status).toBe(404);
    expect(idsOf(await get(outsider.token, "/social/groups"))).not.toContain(gid);

    const join = await post(outsider.token, `/social/groups/${gid}/join`);
    expect(join.status, "xin vào nhóm đã xoá mềm ⇒ 404").toBe(404);

    const byOwner = await get(owner.token, `/social/groups/${gid}`);
    expect(byOwner.status, "kể cả owner cũ cũng không đọc lại được nhóm đã xoá").toBe(404);
  });
});
