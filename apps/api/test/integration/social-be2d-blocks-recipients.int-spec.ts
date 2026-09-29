/**
 * S16-SOCIAL-BE-2D — khối `kudos?`/`poll?`/`idea?` trên thẻ bài + danh bạ người nhận `059`
 * (plan `docs/plans/S16-SOCIAL-BE-2D.md` §5 + §9 — §9 GHI ĐÈ).
 *
 * Luật: mỗi DENY đứng cạnh ALLOW của cùng dựng cảnh; mọi khẳng định «không có X» đi SAU một neo dương
 * (vắng khối thì `.not.toContain(userId)` xanh-rỗng). Response parse bằng CHÍNH schema FE dùng
 * (`feedPostSchema`/`feedPostPageSchema`) — lệch định dạng dây (vd `closesAt` thô, §9 V1) đỏ ở BE.
 *
 * Boot qua `applyMainPipeline` (lưới `pipeline-parity`): pipe Zod chạy HAI lần như PROD ⇒ biến đổi
 * `q` không luỹ đẳng sẽ lộ ở đây. GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  feedPostPageSchema,
  feedPostSchema,
  kudosRecipientSearchResultSchema,
  KUDOS_RECIPIENT_SEARCH_CAP,
} from "@mediaos/contracts";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, hasDb } from "../helpers/integration-db";
import { captureQueries, type CapturedQuery } from "../helpers/query-capture";
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
const LOGIN_PW = ["Passw0rd!", "socialbe2d"].join("");

const AUTHOR_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-kudos",
  "create:feed-poll",
  "create:feed-idea",
] as const;
const ADMIN_PAIRS = [...AUTHOR_PAIRS, "manage:feed-post", "approve:feed-idea"] as const;
/** R1 — đọc được feed, KHÔNG có `create:feed-kudos`. */
const NO_KUDOS_PAIRS = ["view:feed", "create:feed-post"] as const;
/** R1b — CHỈ `create:feed-kudos` (plan §9 V14: ghim 200, bất đối xứng có ghi). */
const KUDOS_ONLY_PAIRS = ["create:feed-kudos"] as const;
const CHILD_TABLES = ["feed_kudos", "feed_kudos_recipients", "feed_polls", "feed_ideas"] as const;

interface Who {
  token: string;
  userId: string;
  employeeId: string;
}

/** Câu SQL chạm bảng `t` — nhận cả tên có ngoặc kép (builder) lẫn không (SQL thô). `\b` không khớp `t_xxx`. */
const touching = (qs: readonly CapturedQuery[], t: string) =>
  qs.filter((q) => new RegExp(`\\b${t}\\b`, "i").test(q.text));

/** Chạy `fn` trong lúc bắt câu SQL ở tầng driver — luôn gỡ bản vá, kể cả khi `fn` ném. */
async function captured<T>(fn: () => Promise<T>): Promise<{ out: T; qs: CapturedQuery[] }> {
  const cap = captureQueries();
  try {
    const out = await fn();
    return { out, qs: cap.stop() };
  } catch (e) {
    cap.stop();
    throw e;
  }
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2D · khối thẻ bài + danh bạ 059 (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let hash = "";

  let author: Who;
  let admin: Who;
  let viewer: Who;
  let viewer2: Who;
  let noKudos: Who;
  let kudosOnly: Who;
  let kudosDept: Who;
  let outsider: Who;
  let ouSales = "";
  let ouTech = "";
  let badge = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const put = (t: string, u: string) => http().put(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));

  async function grant(
    tenant: SeededTenant,
    userId: string,
    pairs: readonly string[],
    kudosScope: "Company" | "Department" = "Company",
  ): Promise<void> {
    const roleId = await seedRole(direct, tenant.companyId, `be2d-${randomUUID().slice(0, 8)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      const scope = key === "create:feed-kudos" ? kudosScope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);
  }

  /** Người KHÔNG đăng nhập (chỉ là dữ liệu danh bạ / người nhận) — rẻ, không bcrypt. */
  async function person(
    tenant: SeededTenant,
    fullName: string,
    opts: { employeeStatus?: string; orgUnitId?: string | null; avatar?: string | null } = {},
  ): Promise<{ userId: string; employeeId: string; email: string }> {
    const email = `p-${randomUUID().slice(0, 10)}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code, avatar_url)
       VALUES ($1, $2, $3, $4, 'offline', $5, $6) RETURNING id`,
      [
        tenant.companyId,
        userId,
        opts.orgUnitId ?? null,
        opts.employeeStatus ?? "active",
        `EMP-${randomUUID().slice(0, 6)}`,
        opts.avatar ?? null,
      ],
    );
    return { userId, employeeId: emp.rows[0].id as string, email };
  }

  /** Người ĐĂNG NHẬP được, với vai tuỳ biến (không đụng vai canonical). */
  async function login(
    tenant: SeededTenant,
    fullName: string,
    pairs: readonly string[],
    opts: { orgUnitId?: string | null; kudosScope?: "Company" | "Department" } = {},
  ): Promise<Who> {
    const email = `u-${randomUUID().slice(0, 10)}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4) RETURNING id`,
      [tenant.companyId, userId, opts.orgUnitId ?? null, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grant(tenant, userId, pairs, opts.kudosScope);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return {
      token: res.body.data.accessToken as string,
      userId,
      employeeId: emp.rows[0].id as string,
    };
  }

  async function createPost(t: string, body: Record<string, unknown>): Promise<string> {
    const res = await post(t, "/social/posts").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  const detail = async (t: string, postId: string) => {
    const res = await get(t, `/social/posts/${postId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Parse bằng schema FE — lệch định dạng dây đỏ ở đây (§9 V1).
    feedPostSchema.parse(res.body.data);
    return { dto: res.body.data as Record<string, unknown>, raw: JSON.stringify(res.body) };
  };

  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sbe2d");
    B = await seedCompany(direct, "sbe2db");
    companyIds.push(A.companyId, B.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    hash = await app.get(PasswordService).hash(LOGIN_PW);
    const ou = async (name: string) =>
      (
        await direct.query(
          "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
          [A.companyId, `${name}-${randomUUID().slice(0, 6)}`],
        )
      ).rows[0].id as string;
    ouSales = await ou("Sales");
    ouTech = await ou("Tech");

    author = await login(A, "Tácgiả Bốnhai", AUTHOR_PAIRS, { orgUnitId: ouSales });
    admin = await login(A, "Quảntrị Bốnhai", ADMIN_PAIRS, { orgUnitId: ouSales });
    viewer = await login(A, "Ngườixem Một", AUTHOR_PAIRS, { orgUnitId: ouSales });
    viewer2 = await login(A, "Ngườixem Hai", AUTHOR_PAIRS, { orgUnitId: ouSales });
    noKudos = await login(A, "Khôngkudos Ba", NO_KUDOS_PAIRS);
    kudosOnly = await login(A, "Chỉkudos Bốn", KUDOS_ONLY_PAIRS);
    kudosDept = await login(A, "Phòngban Năm", ["view:feed", "create:feed-kudos"], {
      kudosScope: "Department",
    });
    outsider = await login(A, "Ngoàiđơnvị Sáu", AUTHOR_PAIRS, { orgUnitId: ouTech });

    badge = (
      await direct.query(
        `INSERT INTO feed_kudos_badges (company_id, code, name, icon, is_active, position)
         VALUES ($1, $2, 'Đồng đội', 'users', true, 1) RETURNING id`,
        [A.companyId, `be2d-${randomUUID().slice(0, 6)}`],
      )
    ).rows[0].id as string;
  }, 240_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  }, 60_000);

  // ═════════════════════════════ KHỐI TRÊN THẺ BÀI ═════════════════════════════

  describe("B — khối kudos/poll/idea trên DTO bài", () => {
    it("B1+B2 — khối kudos: đủ trường · một luật người nhận cho thẻ VÀ 047 · không userId", async () => {
      const AV = randomUUID();
      const live = await person(A, "Sống Nhậnmột", { avatar: AV });
      const resigned = await person(A, "Nghỉviệc Nhận", { employeeStatus: "resigned", avatar: AV });
      const delProfile = await person(A, "Xoáhồsơ Nhận", { avatar: AV });
      const delUser = await person(A, "Xoátk Nhận", { avatar: AV });
      const locked = await person(A, "Khoátk Nhận", { avatar: AV });
      const ghost = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
           VALUES ($1, NULL, 'active', 'offline', $2) RETURNING id`,
          [A.companyId, `EMP-GHOST-${randomUUID().slice(0, 6)}`],
        )
      ).rows[0].id as string;

      // Tạo khi CẢ SÁU còn sống (đường ghi 422 hồ sơ đã xoá — §9 V16), RỒI mới đổi trạng thái.
      const postId = await createPost(author.token, {
        type: "kudos",
        audience: "company",
        kudos: {
          recipientEmployeeIds: [
            live.employeeId,
            resigned.employeeId,
            delProfile.employeeId,
            delUser.employeeId,
            locked.employeeId,
            ghost,
          ],
          badgeId: badge,
          message: "Cảm ơn cả đội",
        },
      });
      await direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE id = $1`, [
        delProfile.employeeId,
      ]);
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [delUser.userId]);
      await direct.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [locked.userId]);

      const expectRule = (recipients: Array<Record<string, unknown>>, where: string) => {
        const by = new Map(recipients.map((r) => [r.employeeId as string, r]));
        expect(by.size, `${where}: đủ 6 người nhận (không bỏ ai)`).toBe(6);
        expect(by.get(live.employeeId), `${where}: sống`).toEqual({
          employeeId: live.employeeId,
          fullName: "Sống Nhậnmột",
          avatarUrl: AV,
          isFormerEmployee: false,
        });
        expect(by.get(resigned.employeeId), `${where}: nghỉ việc GIỮ tên (S6)`).toEqual({
          employeeId: resigned.employeeId,
          fullName: "Nghỉviệc Nhận",
          avatarUrl: AV,
          isFormerEmployee: true,
        });
        expect(by.get(delProfile.employeeId), `${where}: hồ sơ xoá mềm ⇒ che (K1)`).toEqual({
          employeeId: delProfile.employeeId,
          fullName: null,
          avatarUrl: null,
          isFormerEmployee: true,
        });
        expect(by.get(delUser.employeeId), `${where}: TK xoá mềm ⇒ che (K1, §9 V4)`).toEqual({
          employeeId: delUser.employeeId,
          fullName: null,
          avatarUrl: null,
          isFormerEmployee: true,
        });
        expect(by.get(locked.employeeId), `${where}: TK khoá GIỮ tên (S6)`).toEqual({
          employeeId: locked.employeeId,
          fullName: "Khoátk Nhận",
          avatarUrl: AV,
          isFormerEmployee: false,
        });
        expect(by.get(ghost), `${where}: không TK ⇒ tên null, vẫn là nhân viên`).toEqual({
          employeeId: ghost,
          fullName: null,
          avatarUrl: null,
          isFormerEmployee: false,
        });
      };

      // 003
      const d = await detail(viewer.token, postId);
      const kudos = d.dto.kudos as Record<string, unknown>;
      expect(kudos, "neo dương: thẻ kudos CÓ khối").toBeTruthy();
      expect(kudos.message).toBe("Cảm ơn cả đội");
      expect(kudos.isOfficial).toBe(false);
      expect(kudos.badge).toEqual({
        id: badge,
        code: expect.any(String),
        name: "Đồng đội",
        icon: "users",
      });
      expectRule(kudos.recipients as Array<Record<string, unknown>>, "003");
      for (const u of [live, resigned, delProfile, delUser, locked, author]) {
        expect(d.raw, "không `users.id` nào trên dây").not.toContain(u.userId);
      }
      expect(d.dto).not.toHaveProperty("poll");
      expect(d.dto).not.toHaveProperty("idea");

      // 001 — cùng khối trên dòng cuộn
      const feed = await get(viewer.token, "/social/feed?type=kudos&limit=50");
      expect(feed.status, JSON.stringify(feed.body)).toBe(200);
      feedPostPageSchema.parse(feed.body.data);
      const card = (feed.body.data.data as Array<Record<string, unknown>>).find(
        (p) => p.id === postId,
      );
      expect(card?.kudos, "001 mang khối kudos").toEqual(kudos);

      // 047 — MỘT luật (K1)
      const list = await get(viewer.token, "/social/kudos?page=1&limit=50");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const row = (list.body.data.data as Array<Record<string, unknown>>).find(
        (k) => k.postId === postId,
      );
      expect(row, "047 có dòng").toBeTruthy();
      expectRule(row!.recipients as Array<Record<string, unknown>>, "047");
    });

    it("B3 — khối poll = ĐÚNG response 043 của cùng người xem (closesAt khác null, poll đã đóng)", async () => {
      const postId = await createPost(author.token, {
        type: "poll",
        audience: "company",
        poll: { question: "Ăn trưa ở đâu?", options: ["Cơm", "Phở"], closesAt: future(3) },
      });
      const r0 = await get(viewer.token, `/social/posts/${postId}/poll/results`);
      expect(r0.status, JSON.stringify(r0.body)).toBe(200);
      const optA = (r0.body.data.options as Array<{ id: string }>)[0].id;
      const v = await put(viewer.token, `/social/posts/${postId}/poll/vote`).send({
        optionIds: [optA],
      });
      expect(v.status, JSON.stringify(v.body)).toBe(200);

      for (const who of [viewer, viewer2]) {
        const results = await get(who.token, `/social/posts/${postId}/poll/results`);
        expect(results.status).toBe(200);
        const d = await detail(who.token, postId);
        expect(d.dto.poll, "thẻ poll deep-equal 043 của CÙNG người xem").toEqual(results.body.data);
      }
      const d1 = await detail(viewer.token, postId);
      const p1 = d1.dto.poll as { myVote: string[]; totalVoters: number; closesAt: string | null };
      expect(p1.myVote).toEqual([optA]);
      expect(p1.totalVoters).toBe(1);
      expect(p1.closesAt, "closesAt là ISO có T (§9 V1)").toMatch(/T/);
      const d2 = await detail(viewer2.token, postId);
      expect((d2.dto.poll as { myVote: string[] }).myVote, "myVote theo NGƯỜI XEM").toEqual([]);
      expect(d2.dto).not.toHaveProperty("kudos");

      // Poll ĐÃ đóng — `status` + `closesAt` vẫn khớp 043.
      const c = await post(author.token, `/social/posts/${postId}/poll/close`).send({});
      expect([200, 201], JSON.stringify(c.body)).toContain(c.status);
      const closed = await get(viewer.token, `/social/posts/${postId}/poll/results`);
      const dc = await detail(viewer.token, postId);
      expect((dc.dto.poll as { status: string }).status).toBe("closed");
      expect(dc.dto.poll).toEqual(closed.body.data);
    });

    it("B3b — poll ẩn danh: neo totalVoters=1, rồi người xem thứ ba (kể cả quản trị) KHÔNG thấy userId cử tri", async () => {
      const postId = await createPost(author.token, {
        type: "poll",
        audience: "company",
        poll: { question: "Ẩn danh?", options: ["Có", "Không"], isAnonymous: true },
      });
      const r0 = await get(viewer.token, `/social/posts/${postId}/poll/results`);
      const opt = (r0.body.data.options as Array<{ id: string }>)[1].id;
      const v = await put(viewer.token, `/social/posts/${postId}/poll/vote`).send({
        optionIds: [opt],
      });
      expect(v.status, JSON.stringify(v.body)).toBe(200);
      const d = await detail(admin.token, postId);
      expect((d.dto.poll as { totalVoters: number }).totalVoters, "neo dương").toBe(1);
      expect(d.raw).not.toContain(viewer.userId);
    });

    it("B4 — khối idea = {status} DUY NHẤT; đổi theo 046; không reviewNote ở đâu", async () => {
      const postId = await createPost(author.token, {
        type: "idea",
        audience: "company",
        body: "Sáng kiến: thêm máy pha cà phê",
      });
      const d0 = await detail(viewer.token, postId);
      expect(d0.dto.idea).toEqual({ status: "submitted" });
      const rv = await patch(admin.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
        reviewNote: "ghi-chu-bi-mat-be2d",
      });
      expect(rv.status, JSON.stringify(rv.body)).toBe(200);
      const d1 = await detail(viewer.token, postId);
      expect(d1.dto.idea).toEqual({ status: "under_review" });
      expect(d1.raw).not.toContain("ghi-chu-bi-mat-be2d");
      expect(d1.raw).not.toContain("reviewNote");
    });

    it("B5 — bài share KHÔNG khối nào; response 006 KHÔNG khối (neo: 003 của cùng bài CÓ)", async () => {
      const shareId = await createPost(author.token, {
        type: "share",
        audience: "company",
        body: "chào",
      });
      const s = await detail(viewer.token, shareId);
      expect(s.dto.id, "neo").toBe(shareId);
      for (const k of ["kudos", "poll", "idea"]) expect(s.dto).not.toHaveProperty(k);

      const kudosId = await createPost(author.token, {
        type: "kudos",
        audience: "company",
        kudos: { recipientEmployeeIds: [viewer.employeeId], message: "cảm ơn" },
      });
      const anchor = await detail(admin.token, kudosId);
      expect(anchor.dto.kudos, "neo dương").toBeTruthy();
      const mod = await patch(admin.token, `/social/posts/${kudosId}/moderation`).send({
        commentsLocked: true,
      });
      expect(mod.status, JSON.stringify(mod.body)).toBe(200);
      expect(mod.body.data).not.toHaveProperty("kudos");
    });

    it("B6 — WS `feed:post.created` KHÔNG mang khối (neo: response 002 CÓ)", async () => {
      const emitter = app.get(RealtimeEmitterService);
      const spy = vi.spyOn(emitter, "emitFeedPostCreated");
      try {
        const res = await post(author.token, "/social/posts").send({
          type: "poll",
          audience: "company",
          poll: { question: "WS?", options: ["A", "B"] },
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.poll, "neo dương: REST CÓ khối").toBeTruthy();
        const payload = spy.mock.calls.find(
          (c) => (c[1] as { id: string }).id === res.body.data.id,
        )?.[1];
        expect(payload, "sự kiện đã phát").toBeTruthy();
        for (const k of ["kudos", "poll", "idea"]) expect(payload).not.toHaveProperty(k);
      } finally {
        spy.mockRestore();
      }
    });

    it("B7' — không N+1: mỗi bảng con đúng MỘT câu/trang, dù trang 3 hay 12 bài", async () => {
      const make = async (i: number) => [
        await createPost(author.token, {
          type: "kudos",
          audience: "company",
          kudos: {
            recipientEmployeeIds: [viewer.employeeId, viewer2.employeeId],
            message: `k${i}`,
          },
        }),
        await createPost(author.token, {
          type: "poll",
          audience: "company",
          poll: { question: `p${i}`, options: ["x", "y"] },
        }),
        await createPost(author.token, { type: "idea", audience: "company", body: `i${i}` }),
      ];
      const small = await make(0);
      const big = [...(await make(1)), ...(await make(2)), ...(await make(3)), ...(await make(4))];
      const saver = await login(A, "Lưu Nhỏ", AUTHOR_PAIRS);
      const saverBig = await login(A, "Lưu Lớn", AUTHOR_PAIRS);
      const saverShare = await login(A, "Lưu Chiasẻ", AUTHOR_PAIRS);
      const save = async (who: Who, id: string) => {
        const r = await post(who.token, `/social/posts/${id}/save`);
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      };
      for (const id of small) await save(saver, id);
      for (const id of big) await save(saverBig, id);
      const shareId = await createPost(author.token, {
        type: "share",
        audience: "company",
        body: "s",
      });
      await save(saverShare, shareId);

      const measure = async (who: Who) => {
        await get(who.token, "/social/saved?limit=20"); // làm nóng (memo quyền…)
        const { out: res, qs } = await captured(() => get(who.token, "/social/saved?limit=20"));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return { qs, cards: res.body.data.data as Array<Record<string, unknown>> };
      };

      for (const [who, n] of [
        [saver, 3],
        [saverBig, 12],
      ] as const) {
        const { qs, cards } = await measure(who);
        expect(cards.length).toBe(n);
        for (const c of cards) {
          const key = c.type as "kudos" | "poll" | "idea";
          expect(c[key], `neo: thẻ ${String(c.type)} có khối`).toBeTruthy();
        }
        for (const t of CHILD_TABLES) {
          expect(touching(qs, t).length, `${n} bài: bảng ${t} đúng 1 câu`).toBe(1);
        }
      }
      const share = await measure(saverShare);
      expect(share.cards.length, "neo").toBe(1);
      for (const t of CHILD_TABLES) {
        expect(touching(share.qs, t).length, `trang chỉ share: ${t} 0 câu`).toBe(0);
      }
    });

    it("B8 — khối thừa hưởng tầm nhìn bài: kudos org_unit — người trong đơn vị thấy, người ngoài 404", async () => {
      const postId = await createPost(author.token, {
        type: "kudos",
        audience: "org_unit",
        orgUnitId: ouSales,
        kudos: { recipientEmployeeIds: [viewer.employeeId], message: "nội bộ" },
      });
      const inside = await detail(viewer.token, postId);
      expect(inside.dto.kudos, "neo: trong đơn vị thấy khối").toBeTruthy();
      const out = await get(outsider.token, `/social/posts/${postId}`);
      expect(out.status).toBe(404);
    });

    it("B9 — bài poll MỒ CÔI (không hàng feed_polls): 200, khối VẮNG, logger.error có id bài", async () => {
      const ins = await direct.query(
        `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'poll', 'company', NULL) RETURNING id`,
        [A.companyId, author.userId],
      );
      const orphanId = ins.rows[0].id as string;
      const errSpy = vi.spyOn(Logger.prototype, "error");
      try {
        const d = await detail(viewer.token, orphanId);
        expect(d.dto.id, "neo: bài vẫn trả về").toBe(orphanId);
        expect(d.dto).not.toHaveProperty("poll");
        const logged = errSpy.mock.calls.some((c) => JSON.stringify(c).includes(orphanId));
        expect(logged, "fail-LOUD ở log: logger.error nhắc id bài mồ côi").toBe(true);
      } finally {
        errSpy.mockRestore();
      }
    });

    it("B9b — poll 0 lựa chọn (chèn thẳng DB): thẻ options=[] và y hệt 043", async () => {
      const ins = await direct.query(
        `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'poll', 'company', NULL) RETURNING id`,
        [A.companyId, author.userId],
      );
      const postId = ins.rows[0].id as string;
      await direct.query(
        `INSERT INTO feed_polls (company_id, post_id, question) VALUES ($1, $2, 'Rỗng?')`,
        [A.companyId, postId],
      );
      const results = await get(viewer.token, `/social/posts/${postId}/poll/results`);
      expect(results.status, JSON.stringify(results.body)).toBe(200);
      expect(results.body.data.options).toEqual([]);
      const d = await detail(viewer.token, postId);
      expect(d.dto.poll).toEqual(results.body.data);
    });

    it("B10 — H-8: 041 và 043 đọc kết quả trong ĐÚNG MỘT câu (đếm cử tri + lựa chọn cùng câu)", async () => {
      const postId = await createPost(author.token, {
        type: "poll",
        audience: "company",
        poll: { question: "H8?", options: ["A", "B"], multipleChoice: true },
      });
      const r0 = await get(viewer.token, `/social/posts/${postId}/poll/results`);
      const [o1, o2] = (r0.body.data.options as Array<{ id: string }>).map((o) => o.id);

      const readStatements = (qs: readonly CapturedQuery[]) =>
        qs.filter(
          (q) => /count\s*\(\s*distinct/i.test(q.text) && /\bfeed_poll_votes\b/i.test(q.text),
        );

      const w = await captured(() =>
        put(viewer.token, `/social/posts/${postId}/poll/vote`).send({ optionIds: [o1, o2] }),
      );
      expect(w.out.status, JSON.stringify(w.out.body)).toBe(200);
      expect(w.out.body.data.totalVoters, "neo dương").toBe(1);
      const r041 = readStatements(w.qs);
      expect(r041.length, "041: đếm cử tri đúng 1 câu").toBe(1);
      expect(r041[0].text, "041: cùng câu với lựa chọn (một ảnh chụp)").toMatch(
        /\bfeed_poll_options\b/i,
      );

      const r = await captured(() => get(viewer2.token, `/social/posts/${postId}/poll/results`));
      expect(r.out.status).toBe(200);
      expect(r.out.body.data.totalVoters).toBe(1);
      const r043 = readStatements(r.qs);
      expect(r043.length, "043: đếm cử tri đúng 1 câu").toBe(1);
      expect(r043[0].text).toMatch(/\bfeed_poll_options\b/i);
    });
  });

  // ═════════════════════════════ DANH BẠ 059 ═════════════════════════════

  describe("R — danh bạ `GET /social/kudos/recipients`", () => {
    const search = (who: Who, q: string) =>
      get(who.token, `/social/kudos/recipients?q=${encodeURIComponent(q)}`);
    const names = (res: request.Response) =>
      (res.body.data.data as Array<{ fullName: string }>).map((p) => p.fullName).sort();

    const seededUserIds: string[] = [];

    beforeAll(async () => {
      const made = await Promise.all([
        person(A, "Nguyễn Văn An"),
        person(A, "Đặng Thu Hà"),
        person(A, "Trần Tuấn"),
        person(A, "Lê A_c"),
        person(A, "Lê Abc"),
        person(A, "Quách Minh"),
        person(A, "Quách Nghỉ", { employeeStatus: "resigned" }),
        person(A, "Quách Xoá"),
        person(A, "Quách Treo"),
        person(A, "Quách Khoá"),
        person(A, "Quách Xoátk"),
        person(A, "Phùng Bạn"),
        person(A, "Đoàn Thị Nbsp"),
        person(B, "Quách Khác"),
        person(B, "Nguyễn Văn Bê"),
      ]);
      seededUserIds.push(...made.map((m) => m.userId));
      const byName = async (n: string) =>
        (
          await direct.query(`SELECT id FROM users WHERE full_name = $1 AND company_id = $2`, [
            n,
            A.companyId,
          ])
        ).rows[0].id as string;
      await direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE user_id = $1`, [
        await byName("Quách Xoá"),
      ]);
      await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [
        await byName("Quách Treo"),
      ]);
      await direct.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [
        await byName("Quách Khoá"),
      ]);
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [
        await byName("Quách Xoátk"),
      ]);
      for (let i = 1; i <= 25; i++) seededUserIds.push((await person(A, `Kiều Số${i}`)).userId);
      for (let i = 1; i <= 20; i++) seededUserIds.push((await person(A, `Lạc Số${i}`)).userId);
    }, 120_000);

    it("R1 — thiếu `create:feed-kudos` ⇒ 403 · có ⇒ 200", async () => {
      expect((await search(noKudos, "nguyen")).status).toBe(403);
      const ok = await search(author, "nguyen");
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      kudosRecipientSearchResultSchema.parse(ok.body.data);
    });

    it("R1b — vai CHỈ có `create:feed-kudos` ⇒ 200 (bất đối xứng có ghi — SOC-DEC-013)", async () => {
      const res = await search(kudosOnly, "nguyen");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(names(res)).toContain("Nguyễn Văn An");
    });

    it("R2 — `create:feed-kudos@Department` ⇒ 403 AUTH-ERR-SCOPE-DENIED · @Company ⇒ 200", async () => {
      const deny = await search(kudosDept, "nguyen");
      expect(deny.status).toBe(403);
      expect(JSON.stringify(deny.body)).toContain("AUTH-ERR-SCOPE-DENIED");
      expect((await search(author, "nguyen")).status).toBe(200);
    });

    it("R3 — q không hợp lệ ⇒ 400; `ab%` hợp lệ ⇒ 200", async () => {
      for (const q of ["a", "%%", "__", "́̃"]) {
        expect((await search(author, q)).status, `q=${JSON.stringify(q)}`).toBe(400);
      }
      const extra = await get(author.token, "/social/kudos/recipients?q=nguyen&limit=5");
      expect(extra.status, "`.strict()` — không nhận limit").toBe(400);
      expect((await search(author, "ab%")).status).toBe(200);
    });

    it("R3b — `%`/`_`/fullwidth là ký tự THƯỜNG (strpos, không LIKE) — mỗi ca 0 cạnh neo", async () => {
      expect(names(await search(author, "ab")), "neo").toContain("Lê Abc");
      expect(names(await search(author, "a_c")), "`_` không phải ký tự đại diện").toEqual([
        "Lê A_c",
      ]);
      expect(names(await search(author, "ab%")), "`%` không phải ký tự đại diện").toEqual([]);
      expect(names(await search(author, "tuan")), "neo").toEqual(["Trần Tuấn"]);
      expect(names(await search(author, "％an")), "fullwidth ％ ≠ %").not.toContain("Trần Tuấn");
    });

    it("R4 — khớp ĐẦU TỪ, bỏ dấu, không phân biệt hoa thường; NBSP trong tên là dấu cách", async () => {
      for (const q of ["nguyen", "NGUYỄN", "nguyễn"]) {
        expect(names(await search(author, q)), q).toContain("Nguyễn Văn An");
      }
      expect(names(await search(author, "dang"))).toContain("Đặng Thu Hà");
      expect(names(await search(author, "đặng"))).toContain("Đặng Thu Hà");
      const an = names(await search(author, "an"));
      expect(an, "neo: đầu từ «An»").toContain("Nguyễn Văn An");
      expect(an, "«an» giữa từ «Tuấn» KHÔNG khớp").not.toContain("Trần Tuấn");
      expect(names(await search(author, "uyen")), "giữa từ ⇒ không khớp").not.toContain(
        "Nguyễn Văn An",
      );
      expect(names(await search(author, "van an")), "nhiều từ liền nhau").toContain(
        "Nguyễn Văn An",
      );
      expect(names(await search(author, "thi nbsp"))).toContain("Đoàn Thị Nbsp");
    });

    it("R5 — CHỈ người đang làm + TK active; tenant khác không lọt (neo «Quách Minh»)", async () => {
      expect(names(await search(author, "quach"))).toEqual(["Quách Minh"]);
    });

    it("R6 — loại CHÍNH MÌNH ở server", async () => {
      const me = await login(A, "Phùng Tự", AUTHOR_PAIRS);
      const res = names(await search(me, "phung"));
      expect(res, "neo: đồng nghiệp cùng họ").toContain("Phùng Bạn");
      expect(res).not.toContain("Phùng Tự");
    });

    it("R7 — trần 20 + `truncated`", async () => {
      const over = await search(author, "kieu");
      expect(over.body.data.data.length).toBe(KUDOS_RECIPIENT_SEARCH_CAP);
      expect(over.body.data.truncated).toBe(true);
      const exact = await search(author, "lac");
      expect(exact.body.data.data.length).toBe(20);
      expect(exact.body.data.truncated).toBe(false);
    });

    it("R8 — ĐÚNG 3 khoá, không `users.id` nào trên dây (neo: có kết quả)", async () => {
      const res = await search(author, "kieu");
      const raw = JSON.stringify(res.body);
      expect(res.body.data.data.length, "neo").toBeGreaterThan(0);
      for (const p of res.body.data.data as Array<Record<string, unknown>>) {
        expect(Object.keys(p).sort()).toEqual(["avatarUrl", "employeeId", "fullName"]);
      }
      for (const id of [...seededUserIds, author.userId]) expect(raw).not.toContain(id);
    });

    it("R9 — KHÔNG khớp email / mã nhân sự (cột không trả = oracle)", async () => {
      const email = (
        await direct.query(
          `SELECT email FROM users WHERE full_name = 'Quách Minh' AND company_id = $1`,
          [A.companyId],
        )
      ).rows[0].email as string;
      expect(names(await search(author, "quach")), "neo").toContain("Quách Minh");
      expect(names(await search(author, email.split("@")[0]))).toEqual([]);
      expect(names(await search(author, "emp"))).toEqual([]);
    });

    it("R10 — employeeId lấy từ danh bạ dùng được cho `002` kudos", async () => {
      const res = await search(author, "nguyen");
      const an = (res.body.data.data as Array<{ employeeId: string; fullName: string }>).find(
        (p) => p.fullName === "Nguyễn Văn An",
      );
      expect(an, "neo").toBeTruthy();
      await createPost(author.token, {
        type: "kudos",
        audience: "company",
        kudos: { recipientEmployeeIds: [an!.employeeId], message: "từ danh bạ" },
      });
    });
  });
});
