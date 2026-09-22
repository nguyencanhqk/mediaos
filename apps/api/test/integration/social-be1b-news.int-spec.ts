/**
 * S16-SOCIAL-BE-1B — tin tức + xác nhận đã đọc (`SOCIAL-API-020..022`) + `NOTI-031`.
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
const LOGIN_PW = "Passw0rd!socialbe1bnews";

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news";

const BASE: PairKey[] = ["view:feed", "create:feed-post", "create:feed-comment"];
const NEWSMGR: PairKey[] = [...BASE, "manage:feed-post", "manage:feed-news"];

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1B tin tức + ack (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let unitX = "";
  let unitY = "";

  /** Có `manage:feed-news` — tạo tin, xem danh sách đã/chưa đọc. */
  let tNewsMgr = "";
  /** Nhân viên thường đơn vị X. */
  let tEmpX = "";
  let uEmpX = "";
  /** Nhân viên thứ hai đơn vị X — vế «chưa ack» đối chứng. */
  let tEmpX2 = "";
  let uEmpX2 = "";
  /** Nhân viên đơn vị Y — KHÔNG thấy tin `org_unit` của X. */
  let tEmpY = "";
  let uEmpY = "";

  /** Tin `audience='company'`, `requiresAck=true`. */
  let newsAck = "";
  /** Tin `audience='company'`, KHÔNG yêu cầu ack. */
  let newsPlain = "";
  /** Bài `share` thường — ack phải 409. */
  let sharePost = "";
  /** Tin `audience='org_unit'` của Y — ca C3-c. */
  let newsY = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));

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
    const roleId = await seedRole(direct, companyId, `sb1bn-${label}-${randomUUID().slice(0, 6)}`);
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

  async function makeMember(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
    orgUnitId: string | null,
  ): Promise<{ token: string; userId: string; employeeId: string }> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4) RETURNING id`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grantPairs(tenant.companyId, userId, label, pairs);
    return { token: await login(tenant.slug, email), userId, employeeId: r.rows[0].id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb1bnews");
    companyIds.push(A.companyId);

    unitX = await seedOrgUnit(A.companyId, "Đơn vị X");
    unitY = await seedOrgUnit(A.companyId, "Đơn vị Y");

    tNewsMgr = (await makeMember(A, "newsmgr", NEWSMGR, hash, unitX)).token;
    const ex = await makeMember(A, "empx", BASE, hash, unitX);
    tEmpX = ex.token;
    uEmpX = ex.userId;
    const ex2 = await makeMember(A, "empx2", BASE, hash, unitX);
    tEmpX2 = ex2.token;
    uEmpX2 = ex2.userId;
    const ey = await makeMember(A, "empy", BASE, hash, unitY);
    tEmpY = ey.token;
    uEmpY = ey.userId;

    const a1 = await post(tNewsMgr, "/social/posts").send({
      type: "news",
      audience: "company",
      body: "Tin cần xác nhận đã đọc",
      requiresAck: true,
    });
    expect(a1.status, JSON.stringify(a1.body)).toBe(201);
    newsAck = a1.body.data.id;

    const a2 = await post(tNewsMgr, "/social/posts").send({
      type: "news",
      audience: "company",
      body: "Tin thường không cần xác nhận",
    });
    expect(a2.status, JSON.stringify(a2.body)).toBe(201);
    newsPlain = a2.body.data.id;

    const a3 = await post(tNewsMgr, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài chia sẻ thường",
    });
    expect(a3.status, JSON.stringify(a3.body)).toBe(201);
    sharePost = a3.body.data.id;

    // Tin của đơn vị Y — tác giả phải THUỘC Y để đăng vào Y.
    const mgrY = await makeMember(A, "newsmgry", NEWSMGR, hash, unitY);
    const a4 = await post(mgrY.token, "/social/posts").send({
      type: "news",
      audience: "org_unit",
      orgUnitId: unitY,
      body: "Tin riêng của đơn vị Y",
      requiresAck: true,
    });
    expect(a4.status, JSON.stringify(a4.body)).toBe(201);
    newsY = a4.body.data.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ 020 — danh sách tin tức ══════════════

  describe("020 GET /social/news", () => {
    it("ALLOW đối chứng: 200 + CHỈ bài type='news' (không lẫn bài share)", async () => {
      const res = await get(tEmpX, "/social/news");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.data as Array<{ id: string; type: string }>;
      expect(items.length, "neo chống-xanh-rỗng").toBeGreaterThan(0);
      expect(items.every((i) => i.type === "news")).toBe(true);
      expect(items.map((i) => i.id)).not.toContain(sharePost);
    });

    it("DENY: thiếu `view:feed` ⇒ 403 tầng 1", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = (await makeMember(A, "noview", ["create:feed-post"], hash, unitX)).token;
      expect((await get(t, "/social/news")).status).toBe(403);
    });

    /** C3-a — `ackedByMe` là projection THEO ACTOR: hai actor khác nhau, hai câu trả lời khác nhau. */
    it("C3-a: `ackedByMe` đúng theo TỪNG actor (một đã ack, một chưa)", async () => {
      expect((await post(tEmpX, `/social/posts/${newsAck}/ack`)).status).toBe(201);

      const mine = await get(tEmpX, "/social/news?limit=50");
      const theirs = await get(tEmpX2, "/social/news?limit=50");
      const findIn = (r: request.Response) =>
        (r.body.data.data as Array<{ id: string; ackedByMe: boolean }>).find(
          (i) => i.id === newsAck,
        );

      expect(findIn(mine)?.ackedByMe, "người ĐÃ ack").toBe(true);
      expect(findIn(theirs)?.ackedByMe, "người CHƯA ack — CÙNG hàng, khác actor").toBe(false);

      // Đối chiếu với DB THẬT, không chỉ với response.
      const rows = await direct.query(
        `SELECT user_id FROM feed_post_acks WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, newsAck],
      );
      expect(rows.rows.map((r) => r.user_id)).toEqual([uEmpX]);
    });

    it("`ackedByMe` LUÔN có mặt, kể cả trên tin không yêu cầu xác nhận (⇒ false)", async () => {
      const res = await get(tEmpX, "/social/news?limit=50");
      const plain = (res.body.data.data as Array<{ id: string; ackedByMe: boolean }>).find(
        (i) => i.id === newsPlain,
      );
      expect(plain).toBeTruthy();
      expect(plain!.ackedByMe).toBe(false);
    });

    /** C3-b — nguồn của widget `SOCIAL-WIDGET-002`. Con số đếm TRONG SQL, đối chiếu với DB. */
    it("C3-b: `countOnly=true` trả ĐÚNG số tin requires_ack CHƯA xác nhận của actor", async () => {
      const res = await get(tEmpX2, "/social/news?countOnly=true");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.data).toEqual([]);
      expect(res.body.data.nextCursor).toBeNull();

      const expected = await direct.query(
        `SELECT count(*)::int AS n FROM feed_posts p
          WHERE p.company_id = $1 AND p.type = 'news' AND p.requires_ack
            AND p.deleted_at IS NULL AND p.status = 'published' AND p.audience = 'company'
            AND NOT EXISTS (SELECT 1 FROM feed_post_acks a
                             WHERE a.company_id = p.company_id AND a.post_id = p.id AND a.user_id = $2)`,
        [A.companyId, uEmpX2],
      );
      expect(res.body.data.unackedCount).toBe(expected.rows[0].n);
      expect(res.body.data.unackedCount, "neo DƯƠNG: phải có tin chưa đọc thật").toBeGreaterThan(0);
    });

    it("`unackedCount` là `null` khi KHÔNG hỏi countOnly (null = «không hỏi», không phải 0)", async () => {
      const res = await get(tEmpX2, "/social/news");
      expect(res.body.data.unackedCount).toBeNull();
    });

    it("`countOnly=false` (chuỗi) KHÔNG bật chế độ đếm — z.coerce.boolean('false') là bẫy", async () => {
      const res = await get(tEmpX2, "/social/news?countOnly=false");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.data.length, "phải trả DANH SÁCH, không phải mảng rỗng").toBeGreaterThan(
        0,
      );
      expect(res.body.data.unackedCount).toBeNull();
    });

    /**
     * 🔴 NEO DƯƠNG bắt buộc (gate 22/09). Bản đầu của ca này chỉ có hai assert `not.toContain` — và
     * tại thời điểm nó chạy, tập tin `tEmpX` thấy được đã cạn (`newsAck` vừa ack ở C3-a, `newsPlain`
     * không `requiresAck`, `newsY` ngoài đơn vị) ⇒ `ids` RỖNG ⇒ cả hai assert đúng một cách rỗng.
     * Bộ lọc có thể hỏng hoàn toàn (widget không bao giờ hiện dòng nào) mà ca vẫn xanh.
     */
    it("`unackedOnly=true` chỉ còn tin requires_ack mà actor chưa xác nhận", async () => {
      // Một tin CHƯA ack, tạo riêng cho ca này (không mượn fixture dùng chung).
      const fresh = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: "Tin mới cần xác nhận — neo dương cho unackedOnly",
        requiresAck: true,
      });
      expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
      const freshId = fresh.body.data.id as string;

      const res = await get(tEmpX, "/social/news?unackedOnly=true&limit=50");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data.data as Array<{ id: string }>).map((i) => i.id);

      expect(ids, "NEO DƯƠNG: tin requires_ack chưa xác nhận PHẢI có mặt").toContain(freshId);
      expect(ids, "tin đã ack phải biến mất").not.toContain(newsAck);
      expect(ids, "tin không yêu cầu ack cũng không thuộc bộ lọc này").not.toContain(newsPlain);
    });

    /**
     * 🔴 Con trỏ phải lấy từ cửa sổ keyset THẬT (`page`), không từ tập đã lọc (`filtered`).
     *
     * Lấy từ `filtered`: khi mọi tin trong cửa sổ đều đã ack, `filtered` rỗng ⇒ `nextCursor: null` ⇒
     * FE hiểu là HẾT danh sách và dừng hẳn, trong khi huy hiệu `countOnly` (đếm TRONG SQL) vẫn dương.
     * Hai đường của CÙNG một màn hình nói ngược nhau, HTTP 200, không log.
     *
     * Dựng cảnh đó bằng `limit=1` trên một actor đã ack tin mới nhất: trang 1 sau khi lọc là rỗng
     * nhưng cửa sổ keyset vẫn còn tin phía sau.
     */
    it("trang lọc RỖNG vẫn trả `nextCursor` khi cửa sổ keyset còn tin phía sau", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const reader = await makeMember(A, "cursorrdr", BASE, hash, unitX);

      const newest = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: "Tin mới nhất — sẽ được ack ngay",
        requiresAck: true,
      });
      expect(newest.status, JSON.stringify(newest.body)).toBe(201);
      expect((await post(reader.token, `/social/posts/${newest.body.data.id}/ack`)).status).toBe(
        201,
      );

      const res = await get(reader.token, "/social/news?unackedOnly=true&limit=1");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.data.length, "trang 1 sau khi lọc là RỖNG — đúng cảnh cần đo").toBe(0);
      expect(
        res.body.data.nextCursor,
        "cửa sổ keyset còn tin phía sau ⇒ KHÔNG được báo hết danh sách",
      ).not.toBeNull();

      // Lật tiếp bằng chính con trỏ đó phải đi tới được tin chưa ack (dòng tin không dừng).
      const next = await get(
        reader.token,
        `/social/news?unackedOnly=true&limit=50&cursor=${encodeURIComponent(res.body.data.nextCursor as string)}`,
      );
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      expect(
        (next.body.data.data as Array<{ id: string }>).length,
        "đi tiếp bằng con trỏ phải ra tin chưa xác nhận",
      ).toBeGreaterThan(0);
    });

    /** C3-c — tin `org_unit` của đơn vị KHÁC không lọt vào danh sách của người ngoài đơn vị. */
    it("C3-c: tin `audience='org_unit'` của Y KHÔNG lọt vào /social/news của người đơn vị X", async () => {
      const outsider = await get(tEmpX, "/social/news?limit=50");
      expect((outsider.body.data.data as Array<{ id: string }>).map((i) => i.id)).not.toContain(
        newsY,
      );

      // ALLOW đối chứng: người THUỘC Y thì thấy — nếu không có vế này, một route hỏng toàn tập cũng xanh.
      const insider = await get(tEmpY, "/social/news?limit=50");
      expect((insider.body.data.data as Array<{ id: string }>).map((i) => i.id)).toContain(newsY);
    });
  });

  // ══════════════ 021 — xác nhận đã đọc ══════════════

  describe("021 POST /social/posts/{id}/ack", () => {
    it("ALLOW: ack tin ⇒ 201 + ĐÚNG 1 hàng cho actor, 0 hàng cho người khác", async () => {
      const p = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin ack ${randomUUID().slice(0, 6)}`,
        requiresAck: true,
      });
      const pid = p.body.data.id as string;

      const res = await post(tEmpX, `/social/posts/${pid}/ack`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.firstTime).toBe(true);
      expect(res.body.data.postId).toBe(pid);

      const mine = await direct.query(
        `SELECT count(*)::int AS n FROM feed_post_acks
          WHERE company_id = $1 AND post_id = $2 AND user_id = $3`,
        [A.companyId, pid, uEmpX],
      );
      expect(mine.rows[0].n).toBe(1);
      const others = await direct.query(
        `SELECT count(*)::int AS n FROM feed_post_acks
          WHERE company_id = $1 AND post_id = $2 AND user_id <> $3`,
        [A.companyId, pid, uEmpX],
      );
      expect(others.rows[0].n, "KHÔNG được ghi hộ ai").toBe(0);
    });

    /**
     * done_when: «body không nhận trường userId». Route không khai `@Body()` nên trường lạ bị BỎ QUA
     * hoàn toàn — ca này chứng minh nó không GHI HỘ người khác, tức server luôn dùng `actor.id`.
     */
    it("body mang `userId` của người khác KHÔNG ghi hộ họ — server luôn dùng actor.id", async () => {
      const p = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin ack giả mạo ${randomUUID().slice(0, 6)}`,
        requiresAck: true,
      });
      const pid = p.body.data.id as string;

      const res = await post(tEmpX, `/social/posts/${pid}/ack`).send({ userId: uEmpX2 });
      expect([200, 201]).toContain(res.status);

      const rows = await direct.query(
        `SELECT user_id FROM feed_post_acks WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, pid],
      );
      expect(rows.rows.map((r) => r.user_id)).toEqual([uEmpX]);
    });

    it("ack LẠI ⇒ vẫn 2xx, `firstTime=false`, mốc GIỮ NGUYÊN, KHÔNG hàng trùng", async () => {
      const p = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin ack lặp ${randomUUID().slice(0, 6)}`,
        requiresAck: true,
      });
      const pid = p.body.data.id as string;

      const first = await post(tEmpX, `/social/posts/${pid}/ack`);
      expect(first.body.data.firstTime).toBe(true);
      const again = await post(tEmpX, `/social/posts/${pid}/ack`);
      expect([200, 201]).toContain(again.status);
      expect(again.body.data.firstTime).toBe(false);
      // Sổ APPEND-ONLY: mốc phải là lúc xác nhận THẬT, không phải lúc bấm lại.
      expect(again.body.data.ackedAt).toBe(first.body.data.ackedAt);

      const n = await direct.query(
        `SELECT count(*)::int AS n FROM feed_post_acks WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, pid],
      );
      expect(n.rows[0].n).toBe(1);
    });

    it("DENY: ack một bài KHÔNG phải tin tức ⇒ 409 SOCIAL-ERR-011 (và không ghi hàng nào)", async () => {
      const res = await post(tEmpX, `/social/posts/${sharePost}/ack`);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-011");

      const n = await direct.query(
        `SELECT count(*)::int AS n FROM feed_post_acks WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, sharePost],
      );
      expect(n.rows[0].n).toBe(0);
    });

    it("DENY: ack tin KHÔNG bật requiresAck ⇒ 409 SOCIAL-ERR-011", async () => {
      const res = await post(tEmpX, `/social/posts/${newsPlain}/ack`);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-011");
    });

    it("DENY: ack tin `org_unit` NGOÀI tầm ⇒ 404 SOCIAL-ERR-001 (không 409, không 201)", async () => {
      const res = await post(tEmpX, `/social/posts/${newsY}/ack`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");
    });
  });

  // ══════════════ 022 — ai đã / chưa đọc ══════════════

  describe("022 GET /social/posts/{id}/acks", () => {
    /** C6 — điểm chiếu danh tính RỘNG NHẤT của module ⇒ cặp `manage:feed-news`, KHÔNG `view:feed`. */
    it("DENY C6: nhân viên thường ⇒ 403 tầng 1 (ALLOW: `manage:feed-news` ⇒ 200)", async () => {
      const deny = await get(tEmpX, `/social/posts/${newsAck}/acks`);
      expect(deny.status, JSON.stringify(deny.body)).toBe(403);

      const allow = await get(tNewsMgr, `/social/posts/${newsAck}/acks`);
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
    });

    it("nửa «đã đọc»: đúng người đã ack, có mốc, KHÔNG `userId` trong DTO", async () => {
      const res = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=acked`);
      expect(res.status).toBe(200);
      const items = res.body.data.data as Array<Record<string, unknown>>;
      expect(items.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(Object.keys(items[0]!).sort()).toEqual(
        ["ackedAt", "avatarUrl", "employeeId", "fullName"].sort(),
      );
      expect(items.every((i) => i.ackedAt !== null)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(uEmpX);
    });

    it("nửa «chưa đọc»: `ackedAt` null, KHÔNG chứa người đã ack, CÓ chứa người chưa ack", async () => {
      const res = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=unacked&limit=100`);
      expect(res.status).toBe(200);
      const items = res.body.data.data as Array<{ employeeId: string; ackedAt: string | null }>;
      expect(items.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(items.every((i) => i.ackedAt === null)).toBe(true);

      const empIds = await direct.query(
        `SELECT user_id, id FROM employee_profiles WHERE company_id = $1 AND user_id = ANY($2::uuid[])`,
        [A.companyId, [uEmpX, uEmpX2]],
      );
      const byUser = new Map(empIds.rows.map((r) => [r.user_id, r.id]));
      const shown = items.map((i) => i.employeeId);
      expect(shown, "người ĐÃ ack phải VẮNG").not.toContain(byUser.get(uEmpX));
      expect(shown, "người CHƯA ack phải CÓ").toContain(byUser.get(uEmpX2));
    });

    /**
     * Tin `org_unit` ⇒ nửa «chưa đọc» chỉ liệt kê người THUỘC đơn vị đó. Đây là vế chống rò danh bạ
     * toàn công ty qua một bài riêng tư.
     */
    it("tin `org_unit`: nửa «chưa đọc» CHỈ người thuộc đơn vị đó", async () => {
      const mgrYTok = await login(A.slug, `newsmgry@${A.slug}.test`);
      const res = await get(mgrYTok, `/social/posts/${newsY}/acks?state=unacked&limit=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const rows = await direct.query(
        `SELECT id, user_id, org_unit_id FROM employee_profiles WHERE company_id = $1`,
        [A.companyId],
      );
      const inY = new Set(rows.rows.filter((r) => r.org_unit_id === unitY).map((r) => r.id));
      const shown = (res.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId);
      expect(shown.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(
        shown.every((id) => inY.has(id)),
        "không ai ngoài đơn vị Y được liệt kê",
      ).toBe(true);
      const empX = rows.rows.find((r) => r.user_id === uEmpX)?.id;
      expect(shown).not.toContain(empX);
    });

    it("DENY: bài `org_unit` NGOÀI tầm ⇒ 404, dù actor CÓ `manage:feed-news`", async () => {
      // `tNewsMgr` thuộc X + có `manage:feed-news` nhưng KHÔNG `manage:feed-post` ở đơn vị Y?
      // `manage:feed-post` cho phép đọc bài `hidden`, KHÔNG mở audience — nên bài `org_unit` của Y
      // vẫn 404. Đây là vế "cặp quản lý tin KHÔNG phải giấy thông hành xuyên đơn vị".
      const res = await get(tNewsMgr, `/social/posts/${newsY}/acks`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");
    });

    /**
     * 🔴 Ca của FULL gate 22/09 — hai vế của CÙNG một lỗi, đo trong một ca vì chúng phải nói cùng
     * một câu: `unackedEmployeesFor` (nửa «chưa đọc») và `audienceUserIds` (người nhận NOTI-031)
     * dùng chung định nghĩa «thuộc audience».
     *
     * Người nghỉ việc KHÔNG bị xoá mềm (`hr-write.service.ts:600-667`) ⇒ chỉ lọc `deleted_at` là:
     *   (a) `022` liệt họ VĨNH VIỄN vào «chưa đọc» — họ không thể ack, nên tỉ lệ đọc tin bắt buộc
     *       không bao giờ về 0;
     *   (b) họ CHIẾM SUẤT trong trần 500 của NOTI-031 (sắp theo `user_id` tăng dần) ⇒ ở công ty
     *       &gt;500 người, nhân viên ĐANG LÀM bị đẩy khỏi thông báo một cách tất định.
     */
    it("người đã NGHỈ VIỆC vắng khỏi «chưa đọc» VÀ khỏi người nhận NOTI-031", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const leaver = await makeMember(A, "newsleaver", BASE, hash, unitX);

      // ── Neo DƯƠNG: khi còn `active`, họ CÓ mặt ở cả hai đường ──
      const before = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=unacked&limit=100`);
      expect(
        (before.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId),
        "neo dương: còn active thì phải nằm trong «chưa đọc»",
      ).toContain(leaver.employeeId);

      const pBefore = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin trước khi nghỉ ${randomUUID().slice(0, 6)}`,
      });
      expect(pBefore.status, JSON.stringify(pBefore.body)).toBe(201);
      const evBefore = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.news_published' AND payload->>'post_id' = $1`,
        [pBefore.body.data.id],
      );
      expect(
        evBefore.rows[0].payload.recipientUserIds as string[],
        "neo dương: còn active thì phải được báo",
      ).toContain(leaver.userId);

      // ── Nghỉ việc: đổi status, GIỮ NGUYÊN hàng ──
      const upd = await direct.query(
        `UPDATE employee_profiles SET status = 'terminated' WHERE id = $1 AND deleted_at IS NULL`,
        [leaver.employeeId],
      );
      expect(upd.rowCount, "hàng vẫn sống — nghỉ việc KHÔNG phải xoá mềm").toBe(1);

      const after = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=unacked&limit=100`);
      expect(
        (after.body.data.data as Array<{ employeeId: string }>).map((i) => i.employeeId),
        "người đã nghỉ vẫn bị liệt «chưa đọc»",
      ).not.toContain(leaver.employeeId);

      const pAfter = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin sau khi nghỉ ${randomUUID().slice(0, 6)}`,
      });
      expect(pAfter.status, JSON.stringify(pAfter.body)).toBe(201);
      const evAfter = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.news_published' AND payload->>'post_id' = $1`,
        [pAfter.body.data.id],
      );
      const recipients = evAfter.rows[0].payload.recipientUserIds as string[];
      expect(recipients.length, "neo dương: vẫn còn người nhận khác").toBeGreaterThan(0);
      expect(recipients, "người đã nghỉ vẫn chiếm suất trong tập người nhận").not.toContain(
        leaver.userId,
      );
    });

    it("trang OFFSET: total khớp và trang 2 không lặp hàng trang 1", async () => {
      const p1 = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=unacked&page=1&limit=1`);
      const p2 = await get(tNewsMgr, `/social/posts/${newsAck}/acks?state=unacked&page=2&limit=1`);
      expect(p1.status).toBe(200);
      expect(p1.body.data.total).toBeGreaterThan(1);
      const a = (p1.body.data.data as Array<{ employeeId: string }>)[0]?.employeeId;
      const b = (p2.body.data.data as Array<{ employeeId: string }>)[0]?.employeeId;
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(a).not.toBe(b);
    });
  });

  // ══════════════ NOTI-031 — tin tức mới ══════════════

  describe("NOTI-031 — tin tức mới", () => {
    async function outboxFor(postId: string) {
      const r = await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.news_published' AND payload->>'post_id' = $1`,
        [postId],
      );
      return r;
    }

    it("tin `audience='company'` ⇒ outbox có người nhận, KHÔNG gồm chính tác giả", async () => {
      const p = await post(tNewsMgr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: `Tin company NOTI ${randomUUID().slice(0, 6)}`,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);

      const ev = await outboxFor(p.body.data.id);
      expect(ev.rowCount, "producer ghi outbox CÙNG tx với INSERT bài").toBe(1);
      const payload = ev.rows[0].payload;
      const recipients = payload.recipientUserIds as string[];

      expect(recipients.length, "neo DƯƠNG").toBeGreaterThan(0);
      expect(recipients).toContain(uEmpX);
      expect(recipients).toContain(uEmpY);
      expect(recipients, "tác giả không tự nhận thông báo của chính mình").not.toContain(
        payload.actorUserId,
      );
      expect(payload.recipientsTruncated).toBe(false);
      expect(payload.totalRecipients).toBe(recipients.length);
      // Sắp xếp XÁC ĐỊNH theo `user_id` — hợp đồng của việc cắt ở trần.
      expect(recipients).toEqual([...recipients].sort());
    });

    /** N-C8 — tin `org_unit` KHÔNG được phát cho cả công ty. */
    it("N-C8: tin `audience='org_unit'` ⇒ CHỈ người thuộc đơn vị đó nhận", async () => {
      const mgrYTok = await login(A.slug, `newsmgry@${A.slug}.test`);
      const p = await post(mgrYTok, "/social/posts").send({
        type: "news",
        audience: "org_unit",
        orgUnitId: unitY,
        body: `Tin org_unit NOTI ${randomUUID().slice(0, 6)}`,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);

      const ev = await outboxFor(p.body.data.id);
      expect(ev.rowCount).toBe(1);
      const recipients = ev.rows[0].payload.recipientUserIds as string[];
      expect(recipients, "người THUỘC đơn vị Y nhận").toContain(uEmpY);
      expect(recipients, "người đơn vị X KHÔNG nhận").not.toContain(uEmpX);
      expect(recipients).not.toContain(uEmpX2);
    });

    it("bài `share` KHÔNG phát NOTI-031 (chỉ `type='news'`)", async () => {
      const p = await post(tNewsMgr, "/social/posts").send({
        type: "share",
        audience: "company",
        body: `Share không NOTI ${randomUUID().slice(0, 6)}`,
      });
      expect((await outboxFor(p.body.data.id)).rowCount).toBe(0);
    });

    /**
     * N-A4-a — sau migration `0585`, template `SOCIAL_NEWS_PUBLISHED` KHÔNG còn `{post_title}` (bài
     * SOCIAL không có tiêu đề ⇒ biến đó không điền được, và cách duy nhất để điền là cắt trích đoạn
     * `body` — tức đẩy nội dung bài sang bảng `notifications`).
     */
    it("N-A4-a: template SOCIAL_NEWS_PUBLISHED sau 0585 sạch `{post_title}` ở CẢ 3 cột + schema", async () => {
      const t = await direct.query(
        `SELECT title_template, body_template, short_body_template, variables_schema::text AS vs
           FROM notification_templates
          WHERE template_code = 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN'
            AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(t.rowCount, "hàng canonical phải tồn tại (neo dương)").toBe(1);
      const row = t.rows[0];
      for (const col of ["title_template", "body_template", "short_body_template", "vs"] as const) {
        expect(String(row[col]), `${col} còn post_title`).not.toContain("post_title");
      }
      // Và mọi biến CÒN LẠI phải là biến producer THẬT SỰ gửi.
      expect(row.vs).toContain("actor_name");
      expect(row.vs).toContain("post_id");
    });

    it("N-A4-b: template SOCIAL_POST_REPORTED giữ nguyên 2 biến nhãn đóng", async () => {
      const t = await direct.query(
        `SELECT variables_schema::text AS vs FROM notification_templates
          WHERE template_code = 'SOCIAL_POST_REPORTED__IN_APP__vi-VN'
            AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(t.rowCount).toBe(1);
      expect(t.rows[0].vs).toContain("target_type_label");
      expect(t.rows[0].vs).toContain("reason_label");
    });
  });
});
