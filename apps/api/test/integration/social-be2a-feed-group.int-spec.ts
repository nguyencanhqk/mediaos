/**
 * S16-SOCIAL-BE-2A · Bước 1.8 — D-OWNER-6 (bài nhóm nằm ở ĐƯỜNG NÀO) + D-OWNER-7 (`001?groupId=`).
 *
 * ┌─ VÌ SAO PHẢI ĐO Ở TẦNG HTTP, KHÔNG PHẢI TẦNG REPOSITORY ───────────────────────────────────────┐
 * │ `listFeed` là MỘT hàm phục vụ NĂM route, và bộ lọc `groupScope` do CALLER truyền. Test ở tầng   │
 * │ repository chỉ chứng minh "hàm biết lọc"; nó KHÔNG bắt được lỗi thật sự nguy hiểm: một route    │
 * │ truyền nhầm giá trị. Cộng thêm đường thứ sáu (`countUnackedFor`) không đi qua `listFeed` chút   │
 * │ nào — lệch giữa nó và `020` là "badge 3 tin chưa đọc, danh sách rỗng, HTTP 200".                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Phủ: G4b (BỐN chiều: loại ở `001`/`023`/`025`, GIỮ ở `010`/`020`) · G4b-only (`001?groupId=` trả
 * bài cho thành viên và RỖNG cho người ngoài — lọc đích danh KHÔNG phải cửa hậu) · G15 (con trỏ lệch
 * `groupId` ⇒ 400) · G17 (badge `countOnly` == số dòng `020` liệt được).
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
const LOGIN_PW = "Passw0rd!socialbe2agrp";
const PAIRS = ["view:feed", "create:feed-post", "manage:feed-news"] as const;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2A feed ↔ nhóm (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  let tMember = "";
  let tOutsider = "";
  let memberUserId = "";
  let memberEmployeeId = "";

  let privateGroupId = "";
  let publicGroupId = "";
  /** Bài share trong nhóm KÍN — chỉ thành viên thấy. */
  let privatePostId = "";
  /** Bài news trong nhóm MỞ — ai cũng thấy (D3), dùng cho ca badge. */
  let publicNewsId = "";
  /** Bài thường `audience='company'` — neo DƯƠNG cho mọi danh sách. */
  let companyPostId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);

  async function grantPairs(userId: string, label: string) {
    const roleId = await seedRole(direct, A.companyId, `sb2a-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of PAIRS) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
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

  async function makeMember(
    label: string,
    hash: string,
  ): Promise<{ token: string; userId: string; employeeId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3) RETURNING id`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grantPairs(userId, label);
    return { token: await login(email), userId, employeeId: r.rows[0].id as string };
  }

  async function mkGroup(name: string, visibility: "public" | "private"): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, $3) RETURNING id`,
      [A.companyId, name, visibility],
    );
    return r.rows[0].id as string;
  }

  async function mkPost(opts: {
    author: string;
    audience: "company" | "group";
    groupId?: string;
    type?: "share" | "news";
    body: string;
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_posts (company_id, author_user_id, type, audience, group_id, body, requires_ack)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        A.companyId,
        opts.author,
        opts.type ?? "share",
        opts.audience,
        opts.groupId ?? null,
        opts.body,
        opts.type === "news",
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2agrp");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    const member = await makeMember("member", hash);
    const outsider = await makeMember("outsider", hash);
    tMember = member.token;
    memberUserId = member.userId;
    memberEmployeeId = member.employeeId;
    tOutsider = outsider.token;

    privateGroupId = await mkGroup(`Kín ${randomUUID().slice(0, 6)}`, "private");
    publicGroupId = await mkGroup(`Mở ${randomUUID().slice(0, 6)}`, "public");
    for (const g of [privateGroupId, publicGroupId]) {
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, 'owner', 'active', now())`,
        [A.companyId, g, memberUserId],
      );
    }

    privatePostId = await mkPost({
      author: memberUserId,
      audience: "group",
      groupId: privateGroupId,
      body: "Bài trong nhóm kín",
    });
    publicNewsId = await mkPost({
      author: memberUserId,
      audience: "group",
      groupId: publicGroupId,
      type: "news",
      body: "Tin trong nhóm mở",
    });
    companyPostId = await mkPost({
      author: memberUserId,
      audience: "company",
      body: "Bài cả công ty",
    });
    // Bài công ty THỨ HAI — `001?limit=1` phải có `nextCursor` thì ca G15 mới đo được gì (một bài
    // thì `nextCursor=null` và ca lật trang trở thành vô nghĩa).
    await mkPost({ author: memberUserId, audience: "company", body: "Bài cả công ty 2" });

    // «Đã lưu»: gieo thẳng hàng (đường ghi 008 đã có ca riêng ở BE-1).
    await direct.query(
      `INSERT INTO feed_saved_posts (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
      [A.companyId, privatePostId, memberUserId],
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  const idsOf = (res: request.Response): string[] =>
    (res.body.data.data as Array<{ id: string }>).map((p) => p.id);

  it("G4b-1 — `001` feed khám phá LOẠI bài nhóm (cả kín lẫn mở), nhưng vẫn có bài công ty", async () => {
    const res = await get(tMember, "/social/feed");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = idsOf(res);
    expect(ids).toContain(companyPostId); // neo DƯƠNG — danh sách không rỗng
    expect(ids).not.toContain(privatePostId);
    expect(ids).not.toContain(publicNewsId);
  });

  it("G4b-2 — `001?groupId=` trả bài nhóm cho THÀNH VIÊN (cửa thoát D-OWNER-7)", async () => {
    const res = await get(tMember, `/social/feed?groupId=${privateGroupId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = idsOf(res);
    expect(ids).toContain(privatePostId);
    // Lọc ĐÍCH DANH ⇒ chỉ bài của nhóm đó, không kèm bài công ty.
    expect(ids).not.toContain(companyPostId);
  });

  it("🔴 G4b-3 — `001?groupId=` KHÔNG phải cửa hậu: người ngoài nhóm kín nhận tập RỖNG", async () => {
    const res = await get(tOutsider, `/social/feed?groupId=${privateGroupId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(idsOf(res)).toHaveLength(0);

    // Đối chứng: cùng người đó lọc nhóm MỞ thì thấy (D3 — SPEC-16 §3.4 chỉ giới hạn nhóm KÍN).
    const pub = await get(tOutsider, `/social/feed?groupId=${publicGroupId}`);
    expect(idsOf(pub)).toContain(publicNewsId);
  });

  it("G4b-4 — `010` Đã lưu và `020` Tin tức GIỮ bài nhóm (D-OWNER-6)", async () => {
    const saved = await get(tMember, "/social/saved");
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(idsOf(saved)).toContain(privatePostId);

    const news = await get(tMember, "/social/news");
    expect(news.status, JSON.stringify(news.body)).toBe(200);
    expect(idsOf(news)).toContain(publicNewsId);
  });

  it("G4b-5 — `023` tìm kiếm và `025` trang cá nhân LOẠI bài nhóm", async () => {
    const search = await get(tMember, "/social/search?q=nh%C3%B3m");
    expect(search.status, JSON.stringify(search.body)).toBe(200);
    expect(idsOf(search)).not.toContain(privatePostId);

    const profile = await get(tMember, `/social/profiles/${memberEmployeeId}/posts`);
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    const ids = idsOf(profile);
    expect(ids).toContain(companyPostId); // neo DƯƠNG: trang cá nhân KHÔNG rỗng
    expect(ids).not.toContain(privatePostId);
  });

  it("🔴 G15 — con trỏ lấy KHÔNG có `groupId`, lật lại KÈM `groupId` ⇒ 400 (dấu vân bắt được)", async () => {
    const first = await get(tMember, "/social/feed?limit=1");
    expect(first.status).toBe(200);
    const cursor = first.body.data.nextCursor as string | null;
    expect(cursor, "cần ≥2 bài công ty để có nextCursor").toBeTruthy();

    const replay = await get(
      tMember,
      `/social/feed?limit=1&groupId=${privateGroupId}&cursor=${encodeURIComponent(cursor ?? "")}`,
    );
    expect(replay.status, JSON.stringify(replay.body)).toBe(400);
  });

  it("🔴 G17 — badge `countOnly` đếm CÙNG tập mà `020` liệt được", async () => {
    const badge = await get(tMember, "/social/news?countOnly=true");
    expect(badge.status, JSON.stringify(badge.body)).toBe(200);
    const count = badge.body.data.unackedCount as number;

    const list = await get(tMember, "/social/news");
    const listed = (list.body.data.data as Array<{ id: string }>).length;

    expect(count).toBeGreaterThan(0); // neo DƯƠNG — nếu cả hai bằng 0 thì đẳng thức vô nghĩa
    expect(count).toBe(listed);
  });
});
