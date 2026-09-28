/**
 * S16-SOCIAL-BE-3B — thống kê tương tác `SOCIAL-API-052` (JSON) · `053` (XLSX + audit) · hàm widget.
 * Ca S1–S6 (deny/scope) · A1–A7 (đúng số) · E1 (xuất) · W1 (widget) của plan §3.
 *
 * ┌─ BỐN CÔNG TY, MỖI CÔNG TY MỘT VIỆC ───────────────────────────────────────────────────────────┐
 * │ A = scope (tuần 2024-04-01) · B = đối tác cross-tenant · C = đếm số (các tuần 2024-01…06)     │
 * │ D = «bây giờ» (mặc định 8 tuần, không cache, widget). Metadata `units` KHÔNG lọc theo thời   │
 * │ gian ⇒ assert trên `units` dùng `.find/.some`, trên `rows`/`weekTotals` thì tuyệt đối.        │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Hoạt động gieo bằng SQL với `created_at` TƯỜNG MINH (không đi qua API: API đóng dấu `now()`, mà
 * cả file xoay quanh biên tuần theo TZ). Mọi bài `audience:'company'` — đơn vị quy theo TÁC GIẢ (D2).
 * Luật §5: mỗi DENY có ALLOW đối chứng; assert theo HẰNG `SOCIAL_ERR`. GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { ForbiddenException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { restorePostTx, softDeletePostTx } from "../../src/social/social-counters";
import { SocialStatsService } from "../../src/social/social-stats.service";
import { SOCIAL_ERR } from "../../src/social/social.errors";
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
const LOGIN_PW = ["Passw0rd!socialbe3b", "stats"].join("-");
const ENGAGEMENT = "/social/stats/engagement";
const EXPORT = "/social/stats/engagement/export";
const EVIL_NAME = '=HYPERLINK("x")';
const OUT_OF_SCOPE = SOCIAL_ERR.STATS_UNIT_OUT_OF_SCOPE;

type Scope = "Own" | "Team" | "Department" | "Company";

interface Counts {
  posts: number;
  comments: number;
  reactions: number;
  activeMembers: number;
}
interface Row extends Counts {
  weekStart: string;
  orgUnitId: string | null;
}
interface Week extends Counts {
  weekStart: string;
}
interface Stats {
  range: { from: string; to: string; weeks: number };
  units: { orgUnitId: string; name: string; isDeleted: boolean }[];
  rows: Row[];
  weekTotals: Week[];
}

const counts = (c: Counts): Counts => ({
  posts: c.posts,
  comments: c.comments,
  reactions: c.reactions,
  activeMembers: c.activeMembers,
});
const ZERO: Counts = { posts: 0, comments: 0, reactions: 0, activeMembers: 0 };

/** Thứ Hai của tuần hiện tại theo `Asia/Ho_Chi_Minh` (+07:00, không DST) — số học UTC thuần. */
function currentVnMonday(): string {
  const local = new Date(Date.now() + 7 * 3_600_000);
  const offset = (local.getUTCDay() + 6) % 7;
  return new Date(local.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-3B · thống kê tương tác 052/053 (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let hash = "";
  let A: SeededTenant;
  let B: SeededTenant;
  let C: SeededTenant;
  let D: SeededTenant;
  const companyIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const get = (token: string, url: string, query: Record<string, string> = {}) =>
    http().get(url).query(query).set("Authorization", `Bearer ${token}`);
  const stats = async (token: string, query: Record<string, string> = {}): Promise<Stats> => {
    const res = await get(token, ENGAGEMENT, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as Stats;
  };
  const exportXlsx = (token: string, query: Record<string, string>) =>
    get(token, EXPORT, query)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  async function readSheet(body: unknown, name: string): Promise<unknown[][]> {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.getWorksheet(name);
    expect(sheet, `thiếu sheet «${name}»`).toBeTruthy();
    const out: unknown[][] = [];
    sheet!.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
    return out;
  }

  async function exportAuditCount(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND action = 'social.stats.exported'`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  // ─── gieo ─────────────────────────────────────────────────────────────────────────────────

  async function unit(
    companyId: string,
    name: string,
    opts: { parentId?: string; deleted?: boolean } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, parent_id, status, deleted_at)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [companyId, name, opts.parentId ?? null, opts.deleted ? new Date() : null],
    );
    return r.rows[0].id as string;
  }

  /** Người có hồ sơ nhân sự ở `orgUnitId` (null = chưa gán đơn vị). Không đăng nhập. */
  async function person(
    t: SeededTenant,
    label: string,
    orgUnitId: string | null,
  ): Promise<string> {
    const userId = await seedUser(direct, t.companyId, `${label}@${t.slug}.test`, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [t.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 8)}`],
    );
    return userId;
  }

  /** Actor đăng nhập được, giữ `view:feed-report` (cặp của CẢ 052 và 053) ở `scope`; null = không cặp. */
  async function actor(
    t: SeededTenant,
    label: string,
    orgUnitId: string | null,
    scope: Scope | null,
    opts: { denyToo?: boolean } = {},
  ): Promise<{ token: string; userId: string }> {
    const userId = await person(t, label, orgUnitId);
    if (scope !== null) {
      const roleId = await seedRole(direct, t.companyId, `sb3b-${label}-${randomUUID().slice(0, 6)}`);
      const permId = await seedPermissionCatalog(direct, "view", "feed-report", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      await seedUserRole(direct, userId, roleId, t.companyId);
      if (opts.denyToo) {
        const denyRole = await seedRole(direct, t.companyId, `sb3b-${label}-deny`);
        await seedRolePermission(direct, denyRole, permId, "DENY", "Company");
        await seedUserRole(direct, userId, denyRole, t.companyId);
      }
    }
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email: `${label}@${t.slug}.test`, password: LOGIN_PW });
    expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId };
  }

  async function post(
    companyId: string,
    authorUserId: string,
    at: string | null,
    opts: { status?: "published" | "hidden" | "deleted"; groupId?: string } = {},
  ): Promise<string> {
    const status = opts.status ?? "published";
    const r = await direct.query(
      `INSERT INTO feed_posts (company_id, author_user_id, type, audience, group_id, body, status,
                               deleted_at, created_at, published_at)
       VALUES ($1, $2, 'share', $3, $4, 'nội dung', $5, $6,
               coalesce($7::timestamptz, now()), coalesce($7::timestamptz, now()))
       RETURNING id`,
      [
        companyId,
        authorUserId,
        opts.groupId ? "group" : "company",
        opts.groupId ?? null,
        status,
        status === "deleted" ? new Date() : null,
        at,
      ],
    );
    return r.rows[0].id as string;
  }

  async function comment(
    companyId: string,
    postId: string,
    authorUserId: string,
    at: string,
    deleted = false,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_comments (company_id, post_id, author_user_id, body, created_at, deleted_at)
       VALUES ($1, $2, $3, 'bình luận', $4, $5) RETURNING id`,
      [companyId, postId, authorUserId, at, deleted ? new Date() : null],
    );
    return r.rows[0].id as string;
  }

  async function react(
    companyId: string,
    targetType: "post" | "comment",
    targetId: string,
    userId: string,
    at: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji, created_at)
       VALUES ($1, $2, $3, $4, '👍', $5)`,
      [companyId, targetType, targetId, userId, at],
    );
  }

  // ─── fixture ──────────────────────────────────────────────────────────────────────────────

  // Công ty A — scope (tuần 2024-04-01).
  let sA = "";
  let sB = "";
  let sC = "";
  let sX = "";
  let tHrA = "";
  let tMgr1 = "";
  let tMgr2 = "";
  let tMgr3 = "";
  let tOwn = "";
  let tTeam = "";
  let tEmpA = "";
  let tDenied = "";
  // Công ty B.
  let bU = "";
  // Công ty C — đếm số.
  let uA = "";
  let uB = "";
  let uEvil = "";
  let uDel = "";
  let tHrC = "";
  let pA1 = "";
  let pA2 = "";
  let pB1 = "";
  let pN = "";
  let pE = "";
  let postQ = "";
  // Công ty D — «bây giờ».
  let tHrD = "";
  let uHrD = "";
  let uEmpD = "";
  let uMgrD = "";
  let uOwnD = "";
  let pD1 = "";
  let dU1 = "";

  const WEEK_S = { from: "2024-04-01", to: "2024-04-07" };
  const A1_RANGE = { from: "2024-01-01", to: "2024-01-14" };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb3bsa");
    B = await seedCompany(direct, "sb3bsb");
    C = await seedCompany(direct, "sb3bsc");
    D = await seedCompany(direct, "sb3bsd");
    companyIds.push(A.companyId, B.companyId, C.companyId, D.companyId);

    // ── A: sB là cha của sC — manager đứng đầu sB KHÔNG được thấy sC (D13: không cây con).
    sA = await unit(A.companyId, "Đơn vị SA");
    sB = await unit(A.companyId, "Đơn vị SB");
    sC = await unit(A.companyId, "Đơn vị SC", { parentId: sB });
    sX = await unit(A.companyId, "Đơn vị SX");
    const s = "2024-04-02T05:00:00Z";
    for (const [label, u] of [
      ["aa", sA],
      ["ab", sB],
      ["ac", sC],
      ["an", null],
      ["ax", sX],
    ] as const) {
      await post(A.companyId, await person(A, label, u), s);
    }
    tHrA = (await actor(A, "hr", null, "Company")).token;
    tMgr1 = (await actor(A, "mgr1", sA, "Department")).token;
    const mgr2 = await actor(A, "mgr2", sA, "Department");
    tMgr2 = mgr2.token;
    await direct.query(`UPDATE org_units SET head_user_id = $1 WHERE id = $2`, [mgr2.userId, sB]);
    tMgr3 = (await actor(A, "mgr3", null, "Department")).token;
    tOwn = (await actor(A, "own", sA, "Own")).token;
    tTeam = (await actor(A, "team", sA, "Team")).token;
    tEmpA = (await actor(A, "emp", sA, null)).token;
    tDenied = (await actor(A, "denied", sA, "Company", { denyToo: true })).token;

    // ── B: hoạt động CÙNG tuần với A — không được lọt vào số của A.
    bU = await unit(B.companyId, "Đơn vị B");
    await post(B.companyId, await person(B, "bb", bU), s);
    await post(B.companyId, await person(B, "bn", null), s);

    // ── C: đếm số.
    uA = await unit(C.companyId, "Đơn vị A");
    uB = await unit(C.companyId, "Đơn vị B");
    uEvil = await unit(C.companyId, EVIL_NAME);
    uDel = await unit(C.companyId, "Đơn vị đã xoá", { deleted: true });
    pA1 = await person(C, "pa1", uA);
    pA2 = await person(C, "pa2", uA);
    pB1 = await person(C, "pb1", uB);
    pN = await person(C, "pn", null);
    pE = await person(C, "pe", uEvil);
    tHrC = (await actor(C, "hr", null, "Company")).token;

    // A1 · tuần 01-01: pA1 đăng 2 bài (1 `hidden` VẪN tính) + bình luận + cảm xúc ⇒ 1 thành viên.
    const p1 = await post(C.companyId, pA1, "2024-01-02T05:00:00Z");
    await post(C.companyId, pA1, "2024-01-04T05:00:00Z", { status: "hidden" });
    await comment(C.companyId, p1, pA1, "2024-01-03T05:00:00Z");
    await react(C.companyId, "post", p1, pA1, "2024-01-03T06:00:00Z");
    await post(C.companyId, pB1, "2024-01-02T05:00:00Z");
    await post(C.companyId, pN, "2024-01-02T05:00:00Z");
    await post(C.companyId, pE, "2024-01-02T05:00:00Z");
    // KHÔNG tính: bài xoá mềm · bài trong nhóm xoá mềm · bình luận trên bài xoá (đều của pA2).
    const dead = await post(C.companyId, pA2, "2024-01-02T05:00:00Z", { status: "deleted" });
    await comment(C.companyId, dead, pA2, "2024-01-03T05:00:00Z");
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, deleted_at)
       VALUES ($1, 'Nhóm đã xoá', 'public', now()) RETURNING id`,
      [C.companyId],
    );
    await post(C.companyId, pA2, "2024-01-02T05:00:00Z", { groupId: g.rows[0].id as string });
    // A1 · tuần 01-08.
    await post(C.companyId, pA2, "2024-01-09T05:00:00Z");
    await post(C.companyId, pB1, "2024-01-10T05:00:00Z");

    // A1b · tuần 01-15: bài Q + bình luận K + cảm xúc trên Q và trên K; K2 là bình luận đã xoá.
    postQ = await post(C.companyId, pA1, "2024-01-16T05:00:00Z");
    const k = await comment(C.companyId, postQ, pA2, "2024-01-16T06:00:00Z");
    const k2 = await comment(C.companyId, postQ, pA2, "2024-01-16T07:00:00Z", true);
    await react(C.companyId, "post", postQ, pB1, "2024-01-17T05:00:00Z");
    await react(C.companyId, "comment", k, pN, "2024-01-17T05:00:00Z");
    await react(C.companyId, "comment", k2, pE, "2024-01-17T05:00:00Z");

    // A1c · bài tạo NGOÀI mọi khoảng được hỏi; bình luận + cảm xúc trong tuần 01-22.
    const old = await post(C.companyId, pA1, "2023-12-20T05:00:00Z");
    await comment(C.companyId, old, pB1, "2024-01-23T05:00:00Z");
    await react(C.companyId, "post", old, pB1, "2024-01-23T06:00:00Z");

    // A2 · biên TZ (+07:00). 01-28T16:50Z = CN 23:50 (tuần 01-22) · 01-28T17:10Z = T2 00:10 (tuần 01-29)
    // · 02-04T16:30Z = CN 23:30 (tuần 01-29) · 02-04T17:30Z = T2 00:30 (tuần 02-05).
    for (const at of [
      "2024-01-28T16:50:00Z",
      "2024-01-28T17:10:00Z",
      "2024-02-04T16:30:00Z",
      "2024-02-04T17:30:00Z",
    ]) {
      await post(C.companyId, pN, at);
    }

    // A3 · 03-03T17:30Z = T2 03-04 00:30 địa phương (tuần 03-04) · 03-12 (tuần 03-11).
    await post(C.companyId, pN, "2024-03-03T17:30:00Z");
    await post(C.companyId, pN, "2024-03-12T05:00:00Z");

    // A7 · người thuộc đơn vị ĐÃ XOÁ vẫn có hoạt động.
    await post(C.companyId, await person(C, "pdel", uDel), "2024-06-04T05:00:00Z");

    // ── D: «bây giờ».
    dU1 = await unit(D.companyId, "Đơn vị D1");
    const dU2 = await unit(D.companyId, "Đơn vị D2");
    pD1 = await person(D, "pd1", dU1);
    await post(D.companyId, pD1, null);
    await post(D.companyId, await person(D, "pd2", dU2), null);
    const hrD = await actor(D, "hr", null, "Company");
    tHrD = hrD.token;
    uHrD = hrD.userId;
    uEmpD = (await actor(D, "emp", dU1, null)).userId;
    uMgrD = (await actor(D, "mgr", dU1, "Department")).userId;
    uOwnD = (await actor(D, "own", dU1, "Own")).userId;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ S — deny / scope ══════════════

  describe("S · cổng và phạm vi", () => {
    it("ALLOW đối chứng: HR @Company thấy CẢ 5 bài của A và đủ 4 đơn vị", async () => {
      const r = await stats(tHrA, WEEK_S);
      expect(r.weekTotals.map(counts)).toEqual([
        { posts: 5, comments: 0, reactions: 0, activeMembers: 5 },
      ]);
      expect(r.rows.some((x) => x.orgUnitId === null)).toBe(true);
      expect(new Set(r.units.map((u) => u.orgUnitId))).toEqual(new Set([sA, sB, sC, sX]));
    });

    it("S1: không cặp `view:feed-report` ⇒ 403 ở 052 và 053, 0 audit", async () => {
      const before = await exportAuditCount(A.companyId);
      for (const url of [ENGAGEMENT, EXPORT]) {
        const res = await get(tEmpA, url, WEEK_S);
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(OUT_OF_SCOPE);
      }
      expect(await exportAuditCount(A.companyId)).toBe(before);
    });

    it("S1b: ALLOW + DENY cùng cặp ⇒ 403 ở cả hai route, 0 audit", async () => {
      const before = await exportAuditCount(A.companyId);
      for (const url of [ENGAGEMENT, EXPORT]) {
        const res = await get(tDenied, url, WEEK_S);
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
      }
      expect(await exportAuditCount(A.companyId)).toBe(before);
    });

    it("S2: manager @Department (SA) chỉ thấy SA — rows, units, weekTotals (không nhóm null)", async () => {
      const r = await stats(tMgr1, WEEK_S);
      expect(r.units.map((u) => u.orgUnitId)).toEqual([sA]);
      expect(r.rows.map((x) => x.orgUnitId)).toEqual([sA]);
      expect(r.weekTotals.map(counts)).toEqual([
        { posts: 1, comments: 0, reactions: 0, activeMembers: 1 },
      ]);
    });

    it("S2: manager hỏi `orgUnitId` ngoài phạm vi ⇒ 403 STATS_UNIT_OUT_OF_SCOPE ở cả hai route, 0 audit", async () => {
      const before = await exportAuditCount(A.companyId);
      for (const url of [ENGAGEMENT, EXPORT]) {
        const res = await get(tMgr1, url, { ...WEEK_S, orgUnitId: sB });
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body)).toContain(OUT_OF_SCOPE);
      }
      expect(await exportAuditCount(A.companyId)).toBe(before);
      // ALLOW đối chứng: đơn vị CỦA manager ⇒ 200.
      expect((await stats(tMgr1, { ...WEEK_S, orgUnitId: sA })).weekTotals[0]!.posts).toBe(1);
    });

    it("S2: XLSX của manager chỉ chứa SA", async () => {
      const res = await exportXlsx(tMgr1, WEEK_S);
      expect(res.status).toBe(200);
      const rows = await readSheet(res.body, "Theo đơn vị");
      expect(rows.slice(1).map((r) => r[1])).toEqual(["Đơn vị SA"]);
      const weeks = await readSheet(res.body, "Theo tuần");
      expect(weeks.slice(1)).toEqual([["2024-04-01", 1, 0, 0, 1]]);
    });

    it("S2b: manager thuộc SA + đứng đầu SB ⇒ thấy SA + SB, KHÔNG thấy SC (đơn vị con)", async () => {
      const r = await stats(tMgr2, WEEK_S);
      expect(new Set(r.units.map((u) => u.orgUnitId))).toEqual(new Set([sA, sB]));
      expect(new Set(r.rows.map((x) => x.orgUnitId))).toEqual(new Set([sA, sB]));
      expect(r.weekTotals[0]!.posts).toBe(2);
      const res = await get(tMgr2, ENGAGEMENT, { ...WEEK_S, orgUnitId: sC });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain(OUT_OF_SCOPE);
    });

    it("S3: manager không đơn vị, không đứng đầu ⇒ 200 rỗng, weekTotals toàn 0", async () => {
      const r = await stats(tMgr3, WEEK_S);
      expect(r.units).toEqual([]);
      expect(r.rows).toEqual([]);
      expect(r.weekTotals.map(counts)).toEqual([ZERO]);
    });

    it("S4: vai @Own / @Team ⇒ 200 rỗng; kèm `orgUnitId` ⇒ 403 cùng chuỗi", async () => {
      for (const token of [tOwn, tTeam]) {
        const r = await stats(token, WEEK_S);
        expect(r.units).toEqual([]);
        expect(r.rows).toEqual([]);
        expect(r.weekTotals.map(counts)).toEqual([ZERO]);
        const res = await get(token, ENGAGEMENT, { ...WEEK_S, orgUnitId: sA });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toContain(OUT_OF_SCOPE);
      }
    });

    it("S5: hoạt động công ty B không vào số A; đơn vị công ty B / không tồn tại ⇒ 403 cùng chuỗi", async () => {
      const r = await stats(tHrA, WEEK_S);
      expect(r.weekTotals[0]!.posts).toBe(5);
      expect(r.units.some((u) => u.orgUnitId === bU)).toBe(false);
      const cross = await get(tHrA, ENGAGEMENT, { ...WEEK_S, orgUnitId: bU });
      const ghost = await get(tHrA, ENGAGEMENT, { ...WEEK_S, orgUnitId: randomUUID() });
      for (const res of [cross, ghost]) {
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(OUT_OF_SCOPE);
      }
    });

    it("S6: tham số sai ⇒ 400 tại pipe", async () => {
      const bad: Record<string, string>[] = [
        { from: "2024-04-01" },
        { from: "2024-04-10", to: "2024-04-01" },
        { from: "2024-01-01", to: "2024-07-01" }, // 27 tuần sau nắn
        { from: "2024-02-30", to: "2024-03-10" },
        { from: "0000-01-01", to: "0000-01-07" },
        { ...WEEK_S, orgUnitId: "không-phải-uuid" },
        { ...WEEK_S, foo: "bar" },
      ];
      for (const q of bad) {
        const res = await get(tHrA, ENGAGEMENT, q);
        expect(res.status, `${JSON.stringify(q)} ⇒ ${JSON.stringify(res.body)}`).toBe(400);
      }
      // Biên trên: đúng 26 tuần ⇒ 200.
      const ok = await stats(tHrA, { from: "2024-01-01", to: "2024-06-30" });
      expect(ok.range.weeks).toBe(26);
    });
  });

  // ══════════════ A — đúng số ══════════════

  describe("A · định nghĩa đếm", () => {
    it("A1: 2 tuần × 2 đơn vị + người chưa gán — loại xoá mềm/nhóm xoá, `hidden` có tính, tổng = DISTINCT", async () => {
      const r = await stats(tHrC, A1_RANGE);
      expect(r.range).toEqual({ from: "2024-01-01", to: "2024-01-14", weeks: 2 });
      const cell = (week: string, unitId: string | null) =>
        r.rows.find((x) => x.weekStart === week && x.orgUnitId === unitId);

      const wk1 = r.rows.filter((x) => x.weekStart === "2024-01-01");
      expect(wk1).toHaveLength(4);
      expect(wk1.filter((x) => x.orgUnitId === null), "đúng MỘT hàng nhóm null").toHaveLength(1);
      expect(counts(cell("2024-01-01", uA)!)).toEqual({
        posts: 2,
        comments: 1,
        reactions: 1,
        activeMembers: 1,
      });
      expect(cell("2024-01-01", uB)!.posts).toBe(1);
      expect(cell("2024-01-01", null)!.posts).toBe(1);
      expect(cell("2024-01-01", uEvil)!.posts).toBe(1);

      const wk2 = r.rows.filter((x) => x.weekStart === "2024-01-08");
      expect(new Set(wk2.map((x) => x.orgUnitId))).toEqual(new Set([uA, uB]));
      expect(wk2.every((x) => x.posts === 1)).toBe(true);

      expect(r.weekTotals).toEqual([
        { weekStart: "2024-01-01", posts: 5, comments: 1, reactions: 1, activeMembers: 4 },
        { weekStart: "2024-01-08", posts: 2, comments: 0, reactions: 0, activeMembers: 2 },
      ]);
    });

    it("A1b: cảm xúc trên bài xoá mềm / bình luận của bài xoá mềm KHÔNG tính; khôi phục ⇒ tính lại", async () => {
      const q = { from: "2024-01-15", to: "2024-01-21" };
      // pA1 (bài Q) · pA2 (bình luận K) · pB1 (cảm xúc Q) · pN (cảm xúc K); K2 đã xoá ⇒ cảm xúc của pE bị loại.
      const alive = { posts: 1, comments: 1, reactions: 2, activeMembers: 4 };
      expect((await stats(tHrC, q)).weekTotals.map(counts)).toEqual([alive]);

      const db = app.get(DatabaseService);
      await db.withTenant(C.companyId, (tx) => softDeletePostTx(tx, C.companyId, postQ, pA1));
      expect((await stats(tHrC, q)).weekTotals.map(counts)).toEqual([ZERO]);

      await db.withTenant(C.companyId, (tx) => restorePostTx(tx, C.companyId, postQ));
      expect((await stats(tHrC, q)).weekTotals.map(counts)).toEqual([alive]);
    });

    it("A1c: bình luận + cảm xúc TRONG khoảng trên bài tạo TRƯỚC khoảng ⇒ tính, bài KHÔNG tính", async () => {
      const r = await stats(tHrC, { from: "2024-01-22", to: "2024-01-28" });
      // Bài 01-28T16:50Z (CN 23:50 địa phương, của A2) thuộc tuần này.
      expect(r.weekTotals.map(counts)).toEqual([
        { posts: 1, comments: 1, reactions: 1, activeMembers: 2 },
      ]);
      expect(counts(r.rows.find((x) => x.orgUnitId === uB)!)).toEqual({
        posts: 0,
        comments: 1,
        reactions: 1,
        activeMembers: 1,
      });
    });

    it("A2: biên tuần + biên khoảng theo TZ công ty (Asia/Ho_Chi_Minh)", async () => {
      const one = await stats(tHrC, { from: "2024-01-29", to: "2024-02-04" });
      expect(one.weekTotals.map((w) => [w.weekStart, w.posts])).toEqual([["2024-01-29", 2]]);

      const two = await stats(tHrC, { from: "2024-01-29", to: "2024-02-11" });
      expect(two.weekTotals.map((w) => [w.weekStart, w.posts])).toEqual([
        ["2024-01-29", 2],
        ["2024-02-05", 1],
      ]);
    });

    it("A3: `from` thứ Tư ⇒ nắn về thứ Hai; tuần 0 hoạt động vẫn có hàng", async () => {
      const r = await stats(tHrC, { from: "2024-03-06", to: "2024-03-20" });
      expect(r.range).toEqual({ from: "2024-03-04", to: "2024-03-24", weeks: 3 });
      expect(r.weekTotals.map((w) => [w.weekStart, w.posts])).toEqual([
        ["2024-03-04", 1],
        ["2024-03-11", 1],
        ["2024-03-18", 0],
      ]);
    });

    it("A6: HR lọc `orgUnitId` ⇒ rows VÀ weekTotals chỉ của đơn vị đó", async () => {
      const r = await stats(tHrC, { ...A1_RANGE, orgUnitId: uA });
      expect(new Set(r.rows.map((x) => x.orgUnitId))).toEqual(new Set([uA]));
      expect(r.weekTotals).toEqual([
        { weekStart: "2024-01-01", posts: 2, comments: 1, reactions: 1, activeMembers: 1 },
        { weekStart: "2024-01-08", posts: 1, comments: 0, reactions: 0, activeMembers: 1 },
      ]);
    });

    it("A7: đơn vị ĐÃ XOÁ có hoạt động ⇒ có trong units (isDeleted) và lọc được (200)", async () => {
      const q = { from: "2024-06-03", to: "2024-06-09" };
      const r = await stats(tHrC, q);
      expect(r.units.find((u) => u.orgUnitId === uDel)?.isDeleted).toBe(true);
      expect(r.rows.map((x) => x.orgUnitId)).toEqual([uDel]);
      expect((await stats(tHrC, { ...q, orgUnitId: uDel })).weekTotals[0]!.posts).toBe(1);
    });
  });

  // ══════════════ E — xuất XLSX ══════════════

  describe("E · 053 xuất XLSX", () => {
    it("E1: 200 XLSX no-store; sheet khớp 052; tên độc có tiền tố `'`; ĐÚNG 1 audit không số liệu", async () => {
      const json = await stats(tHrC, A1_RANGE);
      const before = await exportAuditCount(C.companyId);

      const res = await exportXlsx(tHrC, A1_RANGE);
      expect(res.status).toBe(200);
      expect(String(res.headers["content-type"])).toContain("spreadsheetml.sheet");
      expect(String(res.headers["cache-control"])).toContain("no-store");
      expect(String(res.headers["content-disposition"])).toContain(
        "social-tuong-tac-2024-01-01_2024-01-14.xlsx",
      );

      const byUnit = await readSheet(res.body, "Theo đơn vị");
      expect(byUnit[0]).toEqual([
        "Tuần bắt đầu",
        "Đơn vị",
        "Bài",
        "Bình luận",
        "Cảm xúc",
        "Thành viên hoạt động",
      ]);
      const nameOf = (id: string | null) =>
        id === null
          ? "Chưa gán đơn vị"
          : id === uEvil
            ? `'${EVIL_NAME}`
            : json.units.find((u) => u.orgUnitId === id)!.name;
      expect(byUnit.slice(1)).toEqual(
        json.rows.map((x) => [
          x.weekStart,
          nameOf(x.orgUnitId),
          x.posts,
          x.comments,
          x.reactions,
          x.activeMembers,
        ]),
      );
      expect(byUnit.flat()).not.toContain(EVIL_NAME);

      const byWeek = await readSheet(res.body, "Theo tuần");
      expect(byWeek.slice(1)).toEqual(
        json.weekTotals.map((w) => [w.weekStart, w.posts, w.comments, w.reactions, w.activeMembers]),
      );

      expect(await exportAuditCount(C.companyId)).toBe(before + 1);
      const audit = await direct.query(
        `SELECT object_type, entity_type, module_code, result_status, metadata FROM audit_logs
          WHERE company_id = $1 AND action = 'social.stats.exported'
          ORDER BY created_at DESC LIMIT 1`,
        [C.companyId],
      );
      const row = audit.rows[0];
      expect(row.object_type).toBe("feed_report");
      expect(row.entity_type).toBe("feed_engagement_stats");
      expect(row.module_code).toBe("SOCIAL");
      expect(row.result_status).toBe("Success");
      expect(row.metadata).toEqual({
        from: "2024-01-01",
        to: "2024-01-14",
        orgUnitId: null,
        rowCount: json.rows.length,
        format: "xlsx",
      });
    });
  });

  // ══════════════ D — «bây giờ»: mặc định · không cache · widget ══════════════

  describe("«bây giờ» · mặc định, không cache, widget", () => {
    it("A4: vắng from/to ⇒ 8 tuần, tuần cuối = tuần hiện tại theo TZ công ty", async () => {
      const r = await stats(tHrD);
      expect(r.range.weeks).toBe(8);
      expect(r.weekTotals).toHaveLength(8);
      expect(r.weekTotals[7]!.weekStart).toBe(currentVnMonday());
      expect(r.weekTotals[7]!.posts).toBeGreaterThanOrEqual(2);
    });

    it("A5: không cache — thêm bài giữa hai lượt ⇒ số tăng; `no-store` ở 052", async () => {
      const res1 = await get(tHrD, ENGAGEMENT);
      expect(res1.status).toBe(200);
      expect(String(res1.headers["cache-control"])).toContain("no-store");
      const before = (res1.body.data as Stats).weekTotals[7]!.posts;
      await post(D.companyId, pD1, null);
      expect((await stats(tHrD)).weekTotals[7]!.posts).toBe(before + 1);
    });

    it("W1: widget — HR = tuần hiện tại của 052; manager = đơn vị mình; @Own = 0; employee ⇒ Forbidden", async () => {
      const svc = app.get(SocialStatsService);
      const full = await stats(tHrD);
      const hr = await svc.weeklyEngagementForWidget({ id: uHrD, companyId: D.companyId });
      expect(hr).toEqual(full.weekTotals[7]);

      const mine = await stats(tHrD, { orgUnitId: dU1 });
      const mgr = await svc.weeklyEngagementForWidget({ id: uMgrD, companyId: D.companyId });
      expect(mgr).toEqual(mine.weekTotals[7]);
      expect(mgr.posts).toBeLessThan(hr.posts);

      const own = await svc.weeklyEngagementForWidget({ id: uOwnD, companyId: D.companyId });
      expect(counts(own)).toEqual(ZERO);

      await expect(
        svc.weeklyEngagementForWidget({ id: uEmpD, companyId: D.companyId }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
