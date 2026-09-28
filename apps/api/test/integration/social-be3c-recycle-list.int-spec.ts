/**
 * S16-SOCIAL-BE-3C — thùng rác bài viết: liệt kê `SOCIAL-API-057` (`GET /recycle-bin/feed-posts`) —
 * tập khoá ĐÓNG · che theo audience (A6) · phân trang OFFSET (A6) · seed quyền `0590` (A9) · PIN engine
 * wildcard (W1). Tách khỏi `social-be3c-recycle-restore.int-spec.ts` (khôi phục `058` + D1..D6/A1..A11)
 * để giữ mỗi file dưới ~900 dòng — TÁCH theo lựa chọn của QA (plan §3 chỉ nêu MỘT file gộp, plan §0 là
 * bảng khảo sát, không nói về tách file). RED TRƯỚC: route/migration CHƯA tồn tại lúc file này được viết.
 *
 * ┌─ BỐN CÔNG TY, MỖI CÔNG TY MỘT VIỆC ───────────────────────────────────────────────────────────┐
 * │ LM = che theo audience (A6, `beforeAll` dùng chung 4 hàng cố định).                             │
 * │ LP = phân trang OFFSET (A6, dựng RIÊNG trong `it()` để `total` chính xác tuyệt đối).             │
 * │ LW = PIN engine wildcard `*:*` (W1, dựng RIÊNG trong `it()`).                                    │
 * │ A9 không cần company — đọc catalog TOÀN CỤC (`permissions`/`role_permissions`).                  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mật khẩu ghép chuỗi (không literal giống secret). Luật DENY-PATH CHUNG của repo (deny-path trước
 * happy-path, và mỗi ca CHE phải có ĐỐI CHỨNG dương trong CÙNG response — không phải một response
 * riêng) — plan không có "§5"; §3 chỉ liệt các ca A6/A9/W1. Mỗi `it` che dưới đây khẳng định lại đối
 * chứng đó bằng `idFull` (case 7 — hàng company ⇒ ĐỦ) NGAY TRONG THÂN NÓ.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
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
const LOGIN_PW = ["Passw0rd!socialbe3c", "list"].join("-");

const LIST_URL = "/recycle-bin/feed-posts";
const restoreUrl = (postId: string): string => `/recycle-bin/feed-posts/${postId}/restore`;

/** Tập khoá ĐÓNG ký ở D10 — `toEqual` trên `Object.keys(item).sort()`. */
const RECYCLE_ITEM_KEYS = [
  "audience",
  "author",
  "bodyExcerpt",
  "createdAt",
  "deletedAt",
  "deletedByAuthor",
  "groupDeleted",
  "groupId",
  "id",
  "orgUnitId",
  "restoreAs",
  "statusBeforeDelete",
  "type",
].sort();

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
interface Grant {
  readonly action: string;
  readonly resource: string;
  readonly scope?: Scope;
  readonly effect?: "ALLOW" | "DENY";
}

interface RecycleItem {
  id: string;
  type: string;
  audience: string;
  groupId: string | null;
  groupDeleted: boolean;
  orgUnitId: string | null;
  author: { employeeId: string; fullName: string } | null;
  bodyExcerpt: string | null;
  statusBeforeDelete: string | null;
  restoreAs: "published" | "hidden";
  deletedAt: string;
  deletedByAuthor: boolean;
  createdAt: string;
}
interface RecyclePage {
  data: RecycleItem[];
  page: number;
  limit: number;
  total: number;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-3C · liệt kê thùng rác 057 (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let hash = "";
  const companyIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const auth =
    (token: string) =>
    (r: request.Test): request.Test =>
      r.set("Authorization", `Bearer ${token}`);
  const get = (token: string, url: string, query: Record<string, string> = {}) =>
    auth(token)(http().get(url)).query(query);
  const post = (token: string, url: string) => auth(token)(http().post(url));
  const patch = (token: string, url: string) => auth(token)(http().patch(url));
  const del = (token: string, url: string) => auth(token)(http().delete(url));
  const msg = (res: request.Response): string => JSON.stringify(res.body);

  async function makeActor(
    t: SeededTenant,
    label: string,
    grants: readonly Grant[],
    orgUnitId: string | null = null,
  ): Promise<{ token: string; userId: string; employeeId: string }> {
    const email = `${label}@${t.slug}.test`;
    const userId = await seedUser(direct, t.companyId, email, hash);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4) RETURNING id`,
      [t.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 8)}`],
    );
    if (grants.length > 0) {
      const roleId = await seedRole(
        direct,
        t.companyId,
        `sb3cl-${label}-${randomUUID().slice(0, 6)}`,
      );
      for (const g of grants) {
        const permId = await seedPermissionCatalog(direct, g.action, g.resource, false);
        await seedRolePermission(direct, roleId, permId, g.effect ?? "ALLOW", g.scope ?? "Company");
      }
      await seedUserRole(direct, userId, roleId, t.companyId);
    }
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${msg(res)}`).toBe(200);
    return {
      token: res.body.data.accessToken as string,
      userId,
      employeeId: emp.rows[0].id as string,
    };
  }

  async function createPost(token: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await post(token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "bài thùng rác",
      ...extra,
    });
    expect(res.status, msg(res)).toBe(201);
    return res.body.data.id as string;
  }

  async function deleteAs(token: string, postId: string): Promise<void> {
    const res = await del(token, `/social/posts/${postId}`);
    expect(res.status, msg(res)).toBe(200);
  }

  async function hideAs(token: string, postId: string): Promise<void> {
    const res = await patch(token, `/social/posts/${postId}/moderation`).send({ hidden: true });
    expect(res.status, msg(res)).toBe(200);
  }

  async function setFullName(userId: string, fullName: string): Promise<void> {
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);
  }

  async function listOf(
    token: string,
    query: Record<string, string> = {},
  ): Promise<request.Response> {
    return get(token, LIST_URL, query);
  }

  async function itemOf(res: request.Response, postId: string): Promise<RecycleItem | undefined> {
    return (res.body.data as RecyclePage).data.find((r) => r.id === postId);
  }

  // ══════════════════════════ LM — che theo audience (A6) ══════════════════════════

  let LM: SeededTenant;
  let tView = ""; // restore:feed-post@Company, KHÔNG manage:feed-post — actor CHÍNH của mọi ca che.
  let uSetup = ""; // actor dùng để dựng/xoá fixture (manage:feed-post, không dùng để LIỆT KÊ).
  let idFull = ""; // audience=company, status_before_delete='published' ⇒ ĐỦ.
  let idHiddenMask = ""; // audience=company, status_before_delete='hidden', tView không manage ⇒ bodyExcerpt null.
  let idOrgOther = ""; // audience=org_unit của đơn vị KHÁC tView.
  let idGroupPrivate = ""; // audience=group, nhóm private mà tView KHÔNG là thành viên.
  let fullBody = "";
  let authorFullName = "";
  let uAuthorC = "";
  let eAuthorC = "";
  // ALLOW đối chứng cho từng ca CHE — mỗi vai chỉ khác `tView` ĐÚNG một lát (luật header của file).
  let tManageView = ""; // restore + manage:feed-post@Company ⇒ ALLOW của case 6 (bodyExcerpt hidden cũ).
  let tOtherUnitViewer = ""; // restore:feed-post@Company, org_unit = otherUnitId ⇒ ALLOW của case 5.
  let tGroupMemberViewer = ""; // restore:feed-post@Company, thành viên active nhóm kín ⇒ ALLOW của case 4.

  // ══════════════════════════ A9 không cần company ══════════════════════════

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    hash = await new PasswordService().hash(LOGIN_PW);

    LM = await seedCompany(direct, "sb3clm");
    companyIds.push(LM.companyId);

    const ownUnit = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Đơn vị của actor', 'active') RETURNING id`,
      [LM.companyId],
    );
    const otherUnit = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Đơn vị KHÁC', 'active') RETURNING id`,
      [LM.companyId],
    );
    const ownUnitId = ownUnit.rows[0].id as string;
    const otherUnitId = otherUnit.rows[0].id as string;

    const viewer = await makeActor(
      LM,
      "viewer",
      [
        { action: "restore", resource: "feed-post" },
        { action: "view", resource: "feed" },
      ],
      ownUnitId,
    );
    tView = viewer.token;

    const setup = await makeActor(LM, "setup", [
      { action: "view", resource: "feed" },
      { action: "create", resource: "feed-post" },
      { action: "manage", resource: "feed-post" },
    ]);
    uSetup = setup.userId;

    // Case 7 — hàng công ty ĐỦ. Body > 200 ký tự để cùng lượt PIN `bodyExcerpt ≤ 200`.
    const authorC = await makeActor(LM, "authorc", [
      { action: "view", resource: "feed" },
      { action: "create", resource: "feed-post" },
    ]);
    uAuthorC = authorC.userId;
    eAuthorC = authorC.employeeId;
    authorFullName = "Nguyễn Văn Tác Giả C";
    await setFullName(uAuthorC, authorFullName);
    fullBody = `Nội dung dài để kiểm bodyExcerpt. ${"x".repeat(220)}`;
    idFull = await createPost(authorC.token, { body: fullBody });
    await deleteAs(setup.token, idFull); // company audience ⇒ setup thấy được, deletedBy ≠ author

    // Case 6 — hàng công ty nhưng status_before_delete='hidden', tView KHÔNG manage ⇒ bodyExcerpt null.
    const idHidden = await createPost(authorC.token, { body: "bài đã từng bị ẩn" });
    await hideAs(setup.token, idHidden);
    await deleteAs(setup.token, idHidden);
    idHiddenMask = idHidden;
    // ALLOW đối chứng case 6 — CHỈ khác `tView` ở việc CÓ THÊM `manage:feed-post@Company`.
    tManageView = (
      await makeActor(LM, "manageview", [
        { action: "restore", resource: "feed-post" },
        { action: "manage", resource: "feed-post" },
        { action: "view", resource: "feed" },
      ])
    ).token;

    // Case 5 — org_unit của đơn vị KHÁC tView. Tác giả TỰ xoá (chỉ tác giả mới thấy bài của chính
    // mình bất kể audience — `isAuthor` bypass trong `audienceCondition`).
    const authorOther = await makeActor(
      LM,
      "authorother",
      [
        { action: "view", resource: "feed" },
        { action: "create", resource: "feed-post" },
      ],
      otherUnitId,
    );
    idOrgOther = await createPost(authorOther.token, {
      audience: "org_unit",
      orgUnitId: otherUnitId,
    });
    await deleteAs(authorOther.token, idOrgOther);
    // ALLOW đối chứng case 5 — CÙNG `restore:feed-post@Company` của `tView`, chỉ khác đơn vị (otherUnitId).
    tOtherUnitViewer = (
      await makeActor(
        LM,
        "otherunitviewer",
        [
          { action: "restore", resource: "feed-post" },
          { action: "view", resource: "feed" },
        ],
        otherUnitId,
      )
    ).token;

    // Case 4 — nhóm PRIVATE, `tView` không phải thành viên.
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'private') RETURNING id`,
      [LM.companyId, `Nhóm kín A6 ${randomUUID().slice(0, 8)}`],
    );
    const groupId = g.rows[0].id as string;
    const authorGroup = await makeActor(LM, "authorgroup", [
      { action: "view", resource: "feed" },
      { action: "create", resource: "feed-post" },
    ]);
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())`,
      [LM.companyId, groupId, authorGroup.userId],
    );
    idGroupPrivate = await createPost(authorGroup.token, { audience: "group", groupId });
    await deleteAs(authorGroup.token, idGroupPrivate);
    // ALLOW đối chứng case 4 — thành viên `active` của CHÍNH nhóm kín đó, mang `restore:feed-post@Company`.
    const groupMemberViewer = await makeActor(LM, "groupmemberviewer", [
      { action: "restore", resource: "feed-post" },
      { action: "view", resource: "feed" },
    ]);
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, 'member', 'active', now())`,
      [LM.companyId, groupId, groupMemberViewer.userId],
    );
    tGroupMemberViewer = groupMemberViewer.token;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
    // `directPool()` (max 4) — tiền lệ `social-be2b1-polls.int-spec.ts:206-210` đóng pool ở `afterAll`;
    // thiếu bước này để 4 connection mở treo cho lượt chạy sau.
    await direct?.end();
  });

  // ══════════════════════════════ A6 — che theo audience + tập khoá ══════════════════════════════

  describe("A6 — 057: tập khoá đóng + che theo audienceCondition", () => {
    it("hàng company (status_before_delete='published') ⇒ ĐỦ: author + bodyExcerpt ≤ 200 + tập khoá ĐÓNG", async () => {
      const res = await listOf(tView, { limit: "100" });
      expect(res.status, msg(res)).toBe(200);
      const item = await itemOf(res, idFull);
      expect(item, "neo dương").toBeTruthy();

      expect(Object.keys(item!).sort()).toEqual(RECYCLE_ITEM_KEYS);
      expect(item!.author).toEqual({ employeeId: eAuthorC, fullName: authorFullName });
      expect(item!.bodyExcerpt).not.toBeNull();
      expect(item!.bodyExcerpt!.length).toBeLessThanOrEqual(200);
      expect(item!.bodyExcerpt).toBe(fullBody.slice(0, 200));
      expect(item!.statusBeforeDelete).toBe("published");
      expect(item!.restoreAs).toBe("published");
      expect(item!.groupDeleted).toBe(false);
    });

    it("hàng company nhưng status cũ 'hidden' + actor KHÔNG manage:feed-post ⇒ bodyExcerpt null VÀ author null (bài ẩn không lộ tác giả qua thùng rác)", async () => {
      const res = await listOf(tView, { limit: "100" });
      const item = await itemOf(res, idHiddenMask);
      expect(item, "neo dương").toBeTruthy();
      expect(item!.statusBeforeDelete).toBe("hidden");
      expect(item!.bodyExcerpt).toBeNull();
      // FULL gate BE-3C (security MEDIUM): khi bài còn sống, vế (b) `statusOk` của `visiblePostCondition`
      // KHÔNG cho vai thiếu `manage:feed-post` thấy bài `hidden` của người khác ⇒ thùng rác không được
      // chiếu tên tác giả của nó (sẽ lộ «bài của X từng bị kiểm duyệt ẩn»). Danh tính che CÙNG vị từ với
      // `bodyExcerpt`, không chỉ theo `seen`.
      expect(item!.author, "rò tác giả bài từng bị ẩn qua thùng rác").toBeNull();
      // Đối chứng "hàng company ⇒ ĐỦ" NGAY TRONG response của chính actor bị che — mutant che HẲN mọi
      // `bodyExcerpt` (kể cả `idFull`) vẫn phải bị bắt ở đây, không chỉ ở `it` case 7 riêng.
      const full = await itemOf(res, idFull);
      expect(full!.author).not.toBeNull();
      expect(full!.bodyExcerpt).not.toBeNull();

      // ALLOW đối chứng vế `canManagePosts` (D10-ii) — vai CHỈ khác `tView` ở việc có thêm
      // `manage:feed-post@Company` PHẢI thấy được `bodyExcerpt` của hàng status cũ 'hidden'.
      const resManage = await listOf(tManageView, { limit: "100" });
      const itemManage = await itemOf(resManage, idHiddenMask);
      expect(itemManage!.bodyExcerpt).toBe("bài đã từng bị ẩn");
      expect(itemManage!.author, "ALLOW đối chứng: manage:feed-post thấy tác giả bài ẩn").toEqual({
        employeeId: eAuthorC,
        fullName: authorFullName,
      });
    });

    it("hàng org_unit của đơn vị KHÁC ⇒ author:null, orgUnitId:null, bodyExcerpt:null; hàng VẪN liệt kê", async () => {
      const res = await listOf(tView, { limit: "100" });
      const item = await itemOf(res, idOrgOther);
      expect(item, "neo dương: hàng vẫn liệt kê dù bị che").toBeTruthy();
      expect(item!.author).toBeNull();
      expect(item!.orgUnitId).toBeNull();
      expect(item!.bodyExcerpt).toBeNull();
      expect(item!.groupId).toBeNull();
      const full = await itemOf(res, idFull);
      expect(full!.author).not.toBeNull();
      expect(full!.bodyExcerpt).not.toBeNull();

      // ALLOW đối chứng — vai CÙNG `restore:feed-post@Company`, chỉ khác đơn vị (đúng đơn vị của bài).
      const resOther = await listOf(tOtherUnitViewer, { limit: "100" });
      const itemOther = await itemOf(resOther, idOrgOther);
      expect(itemOther!.author).not.toBeNull();
      expect(itemOther!.orgUnitId).not.toBeNull();
      expect(itemOther!.bodyExcerpt).not.toBeNull();
    });

    it("hàng nhóm PRIVATE mà actor KHÔNG là thành viên ⇒ author:null, groupId:null, bodyExcerpt:null («rò tác giả/nhóm qua thùng rác»)", async () => {
      const res = await listOf(tView, { limit: "100" });
      const item = await itemOf(res, idGroupPrivate);
      expect(item, "neo dương").toBeTruthy();
      expect(item!.author, "rò tác giả/nhóm qua thùng rác").toBeNull();
      expect(item!.groupId, "rò tác giả/nhóm qua thùng rác").toBeNull();
      expect(item!.bodyExcerpt).toBeNull();
      expect(item!.groupDeleted, "nhóm vẫn sống — chỉ CHE, không phải nhóm đã xoá").toBe(false);
      const full = await itemOf(res, idFull);
      expect(full!.author).not.toBeNull();
      expect(full!.bodyExcerpt).not.toBeNull();

      // ALLOW đối chứng — thành viên `active` CHÍNH nhóm kín đó phải thấy được tác giả/nhóm/nội dung.
      const resMember = await listOf(tGroupMemberViewer, { limit: "100" });
      const itemMember = await itemOf(resMember, idGroupPrivate);
      expect(itemMember!.author).not.toBeNull();
      expect(itemMember!.groupId).not.toBeNull();
      // Mutant «che HẲN bodyExcerpt của mọi bài audience='group'» phải đỏ ở đây (FULL gate SF-L3).
      expect(itemMember!.bodyExcerpt).toBe("bài thùng rác");
    });

    it("Không userId người xoá nào lọt response (grep JSON), và item không mang khoá deletedBy/userId", async () => {
      const res = await listOf(tView, { limit: "100" });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(uSetup);
      for (const item of (res.body.data as RecyclePage).data) {
        expect(Object.keys(item)).not.toContain("deletedBy");
        expect(Object.keys(item)).not.toContain("userId");
      }
    });

    it("phân trang OFFSET ORDER BY deleted_at DESC, id DESC — 3 trang, total chính xác", async () => {
      const lp = await seedCompany(direct, "sb3clp");
      companyIds.push(lp.companyId);
      const pager = await makeActor(lp, "pager", [
        { action: "view", resource: "feed" },
        { action: "create", resource: "feed-post" },
        { action: "manage", resource: "feed-post" },
        { action: "restore", resource: "feed-post" },
      ]);

      const base = new Date();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = await createPost(pager.token, { body: `bai phan trang ${i}` });
        await deleteAs(pager.token, id);
        ids.push(id);
      }
      // ids[0]/ids[1] CHIA SẺ CÙNG `deleted_at` (hoà) — nếu MỌI hàng có `deleted_at` khác nhau thì vế phụ
      // `id DESC` của `ORDER BY deleted_at DESC, id DESC` không bao giờ được đo (mutant bỏ `desc(feedPosts.id)`
      // vẫn xanh, vì `deleted_at DESC` một mình đã đủ quyết định thứ tự).
      await direct.query(`UPDATE feed_posts SET deleted_at = $2 WHERE id = $1`, [ids[0], base]);
      await direct.query(`UPDATE feed_posts SET deleted_at = $2 WHERE id = $1`, [ids[1], base]);
      await direct.query(`UPDATE feed_posts SET deleted_at = $2 WHERE id = $1`, [
        ids[2],
        new Date(base.getTime() - 60_000),
      ]);
      await direct.query(`UPDATE feed_posts SET deleted_at = $2 WHERE id = $1`, [
        ids[3],
        new Date(base.getTime() - 120_000),
      ]);
      await direct.query(`UPDATE feed_posts SET deleted_at = $2 WHERE id = $1`, [
        ids[4],
        new Date(base.getTime() - 180_000),
      ]);
      // UUID lowercase hex (`randomUUID()`) ⇒ so chuỗi ĐÚNG thứ tự byte của B-tree `uuid` Postgres.
      const tiedOrder = [ids[0], ids[1]].sort().reverse();

      const page1 = await listOf(pager.token, { limit: "2", page: "1" });
      expect(page1.status, msg(page1)).toBe(200);
      const body1 = page1.body.data as RecyclePage;
      expect(body1.total).toBe(5);
      expect(body1.page).toBe(1);
      expect(body1.limit).toBe(2);
      expect(body1.data.map((r) => r.id)).toEqual(tiedOrder);

      const page2 = await listOf(pager.token, { limit: "2", page: "2" });
      expect(page2.status, msg(page2)).toBe(200);
      expect((page2.body.data as RecyclePage).data.map((r) => r.id)).toEqual([ids[2], ids[3]]);

      const page3 = await listOf(pager.token, { limit: "2", page: "3" });
      expect(page3.status, msg(page3)).toBe(200);
      const body3 = page3.body.data as RecyclePage;
      expect(body3.data.map((r) => r.id)).toEqual([ids[4]]);
      expect(body3.total).toBe(5);
    });

    it("057: khoá query lạ ⇒ 400 (.strict())", async () => {
      const res = await listOf(tView, { foo: "bar" });
      expect(res.status, msg(res)).toBe(400);
    });
  });

  // ══════════════════════════════ A9 — seed migration 0590 ══════════════════════════════

  describe("A9 — seed 0590: cặp restore:feed-post", () => {
    it("is_sensitive=false; grant ALLOW @Company ĐÚNG {hr,company-admin} = tập giữ manage:feed-post; 0 grant 4 vai ngoài; 0 object_permissions", async () => {
      const permRow = await direct.query(
        `SELECT id, is_sensitive FROM permissions WHERE action = 'restore' AND resource_type = 'feed-post'`,
      );
      expect(permRow.rows, "cặp restore:feed-post phải tồn tại (migration 0590)").toHaveLength(1);
      expect(permRow.rows[0].is_sensitive).toBe(false);
      const restorePermId = permRow.rows[0].id as string;

      const managePermRow = await direct.query(
        `SELECT id FROM permissions WHERE action = 'manage' AND resource_type = 'feed-post'`,
      );
      expect(managePermRow.rows).toHaveLength(1);
      const managePermId = managePermRow.rows[0].id as string;

      const canonicalGrantRoles = async (permissionId: string): Promise<string[]> => {
        const r = await direct.query(
          `SELECT r.name FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
            WHERE rp.permission_id = $1 AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
              AND r.company_id IS NULL AND r.name <> 'super-admin' AND r.deleted_at IS NULL
            ORDER BY r.name`,
          [permissionId],
        );
        return r.rows.map((row: { name: string }) => row.name);
      };

      const restoreRoles = await canonicalGrantRoles(restorePermId);
      const manageRoles = await canonicalGrantRoles(managePermId);
      expect(restoreRoles).toHaveLength(2);
      expect([...restoreRoles].sort()).toEqual([...manageRoles].sort());
      expect(restoreRoles).toEqual(["company-admin", "hr"]);

      // `canonicalGrantRoles` LỌC `effect='ALLOW' AND data_scope='Company'` — một grant LẠC (vd DENY,
      // hoặc ALLOW ở scope khác) trên vai hệ thống KHÁC hoàn toàn VÔ HÌNH với hai đếm trên. Câu KHÔNG
      // lọc effect/scope bắt được cả hình dạng đó.
      const anyGrant = await direct.query(
        `SELECT r.name, rp.effect, rp.data_scope FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_id = $1 AND r.company_id IS NULL AND r.name <> 'super-admin'
            AND r.deleted_at IS NULL
          ORDER BY r.name`,
        [restorePermId],
      );
      expect(anyGrant.rows).toEqual([
        { name: "company-admin", effect: "ALLOW", data_scope: "Company" },
        { name: "hr", effect: "ALLOW", data_scope: "Company" },
      ]);

      const outsiders = await direct.query(
        `SELECT count(*)::int AS n FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_id = $1 AND r.company_id IS NULL
            AND r.name IN ('payroll-officer', 'recruiter', 'asset-manager', 'office-admin')`,
        [restorePermId],
      );
      expect(Number(outsiders.rows[0].n)).toBe(0);

      const objectPerms = await direct.query(
        `SELECT count(*)::int AS n FROM object_permissions WHERE permission_id = $1`,
        [restorePermId],
      );
      expect(Number(objectPerms.rows[0].n)).toBe(0);
    });
  });

  // ══════════════════════════════ W1 — PIN ENGINE (wildcard) ══════════════════════════════

  describe("W1 — PIN ENGINE, không phải lỗ của SOCIAL", () => {
    /**
     * 14 cặp `feed-*` đều `is_sensitive=false` (SOC-DEC-004) và `restore:feed-post` đi theo ĐÚNG luật
     * đó (D1 của plan) ⇒ wildcard `*:*` MỞ nó, y hệt mọi cặp `feed-*` khác (`permission.decide.ts`
     * Priority 4). Ghi nhận hành vi này để nó không đổi trong im lặng — KHÔNG "vá" bằng cách bật
     * `is_sensitive` (đổi catalog = đổi SPEC, phá SOC-DEC-004, cần chữ ký owner).
     */
    it("vai *:* ⇒ 057 và 058 đều 200 (không 403)", async () => {
      const lw = await seedCompany(direct, "sb3clw");
      companyIds.push(lw.companyId);
      const author = await makeActor(lw, "wauthor", [
        { action: "view", resource: "feed" },
        { action: "create", resource: "feed-post" },
      ]);
      const wildcard = await makeActor(lw, "wild", [{ action: "*", resource: "*" }]);

      const id = await createPost(author.token);
      await deleteAs(author.token, id);

      const listRes = await listOf(wildcard.token);
      expect(listRes.status, msg(listRes)).toBe(200);

      const restoreRes = await post(wildcard.token, restoreUrl(id));
      expect(restoreRes.status, msg(restoreRes)).toBe(200);
    });
  });
});
