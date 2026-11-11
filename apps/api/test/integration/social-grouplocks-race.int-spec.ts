/**
 * S16-SOCIAL-POSTGROUPTOCTOU-1 · S16-SOCIAL-GROUPPOSTDEL-1 · S16-SOCIAL-GROUPDELRACE-1 — thứ tự khoá ở
 * các cổng GHI vào nhóm. 🔴 Crown-jewel (cổng ghi nhóm — FULL gate).
 *
 * Luật: cổng ghi vào nhóm quyết định theo trạng thái nhóm/thành viên đọc SAU khi khoá hàng `feed_groups`.
 *  - `002` đăng bài nhóm: khoá `FOR SHARE` sau cổng 404, đọc lại «nhóm còn sống» + membership sau khoá.
 *  - `038`/`039`: kiểm «nhóm còn sống» sau khoá neo.
 *  - `035`/`036`: kiểm «nhóm còn sống» sau khoá neo; `035` lấy `status` từ `visibility` đọc sau khoá.
 *
 * HARNESS ĐUA TẤT ĐỊNH (khuôn `social-grouptoctou-race.int-spec.ts`, vị từ `lock-wait.ts`): client
 * `direct` giữ khoá hàng nhóm (chế độ tuỳ ca) → phóng request → chờ ĐÚNG 1 backend bị CHÍNH holder chặn
 * → đổi dữ liệu TRONG tx giữ khoá → COMMIT → đọc response + DB. Mỗi ca một nhóm MỚI; ca ALLOW dùng cùng
 * harness với `noChange`.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { directPool, hasDb } from "../helpers/integration-db";
import { countBlockedBy, waitForBlockedBy } from "../helpers/lock-wait";
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
const LOGIN_PW = ["Passw0rd", "sgrouplocks", "x"].join("!");
const PAIRS = ["view:feed", "create:feed-group", "create:feed-post"] as const;

const WAIT_LOCK_MS = 3_000;
const DECIDE_MS = 10_000;
const RACE_TIMEOUT_MS = 30_000;

type GroupRole = "owner" | "admin" | "member";
type LockMode = "FOR UPDATE" | "FOR NO KEY UPDATE" | "FOR SHARE";

interface Actor {
  token: string;
  userId: string;
}
interface Held {
  client: PoolClient;
  pid: number;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-GROUPLOCKS · thứ tự khoá cổng ghi nhóm (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let owner: Actor;
  let adminA: Actor;
  let u1: Actor;
  let u2: Actor;
  let poster: Actor;
  let outsider: Actor;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function makeUser(label: string, hash: string): Promise<Actor> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `gl-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of PAIRS) {
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

  async function seedGroup(
    visibility: "public" | "private",
    members: ReadonlyArray<{ userId: string; role: GroupRole }>,
  ): Promise<string> {
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, member_count)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, `GL ${randomUUID().slice(0, 8)}`, visibility, members.length],
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

  /** Nhóm kín chuẩn: owner + admin + poster (thành viên) + u1 (thành viên). */
  const privateGroup = (): Promise<string> =>
    seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: adminA.userId, role: "admin" },
      { userId: poster.userId, role: "member" },
      { userId: u1.userId, role: "member" },
    ]);

  async function openTx(pool: Pool): Promise<Held> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      const pid = (await client.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
      return { client, pid };
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }

  async function releaseHeld(h: Held, rollback: boolean): Promise<void> {
    if (!rollback) {
      h.client.release();
      return;
    }
    await h.client.query("ROLLBACK").then(
      () => h.client.release(),
      (err: Error) => h.client.release(err),
    );
  }

  async function holdGroupLock(groupId: string, mode: LockMode): Promise<Held> {
    const held = await openTx(direct);
    await held.client
      .query(`SELECT 1 FROM feed_groups WHERE company_id = $1 AND id = $2 ${mode}`, [
        A.companyId,
        groupId,
      ])
      .then(
        () => undefined,
        async (err: Error) => {
          await releaseHeld(held, true);
          throw err;
        },
      );
    return held;
  }

  /** Giữ khoá → phóng `fire()` → chờ ĐÚNG `want` backend bị CHÍNH holder chặn → mutate → COMMIT. */
  async function raceGroup(
    groupId: string,
    mode: LockMode,
    fire: () => request.Test,
    mutate: (c: PoolClient) => Promise<void>,
    want = 1,
  ): Promise<request.Response> {
    const hold = await holdGroupLock(groupId, mode);
    let committed = false;
    let settled: Promise<unknown> | undefined;
    try {
      const reqP = fire().then((r) => r);
      settled = Promise.allSettled([reqP]);
      expect(
        await waitForBlockedBy(direct, hold.pid, want, { exact: true, timeoutMs: WAIT_LOCK_MS }),
        "request phải bị CHÍNH holder chặn (pg_blocking_pids) — không chồng lấp ⇒ ĐỎ",
      ).toBe(true);
      await mutate(hold.client);
      await hold.client.query("COMMIT");
      committed = true;
      return await reqP;
    } finally {
      await releaseHeld(hold, !committed);
      if (settled) await settled;
    }
  }

  /** Phân định request TRẢ LỜI (`queued:false`) hay bị CHÍNH holder chặn (`queued:true`). */
  async function fireUnderLock(
    groupId: string,
    mode: LockMode,
    fire: () => request.Test,
  ): Promise<{ queued: boolean; res: request.Response }> {
    const hold = await holdGroupLock(groupId, mode);
    let released = false;
    let settled: Promise<unknown> | undefined;
    try {
      let responded = false;
      const reqP = fire().then(
        (r) => {
          responded = true;
          return r;
        },
        (err: unknown) => {
          responded = true;
          throw err;
        },
      );
      settled = Promise.allSettled([reqP]);
      let queued = false;
      const deadline = Date.now() + DECIDE_MS;
      while (!responded && !queued && Date.now() < deadline) {
        queued = (await countBlockedBy(direct, hold.pid)) > 0;
        if (!queued && !responded) await new Promise((r) => setTimeout(r, 25));
      }
      expect(responded || queued, "request phải TRẢ LỜI hoặc BỊ holder chặn trong trần").toBe(true);
      await releaseHeld(hold, true);
      released = true;
      return { queued, res: await reqP };
    } finally {
      if (!released) await releaseHeld(hold, true);
      if (settled) await settled;
    }
  }

  const noChange = (): Promise<void> => Promise.resolve();

  /** Hình dạng `039`: xoá hàng thành viên + giảm `member_count` TRONG tx giữ khoá. */
  const dropMember =
    (groupId: string, userId: string) =>
    async (c: PoolClient): Promise<void> => {
      const r = await c.query(
        `DELETE FROM feed_group_members WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
        [A.companyId, groupId, userId],
      );
      expect(r.rowCount, "xoá hàng thành viên phải xoá ĐÚNG 1 hàng").toBe(1);
      await c.query(
        `UPDATE feed_groups SET member_count = member_count - 1 WHERE company_id = $1 AND id = $2`,
        [A.companyId, groupId],
      );
    };

  /** Hình dạng `034`: xoá mềm nhóm TRONG tx giữ khoá. */
  const softDelete =
    (groupId: string) =>
    async (c: PoolClient): Promise<void> => {
      await c.query(`UPDATE feed_groups SET deleted_at = now() WHERE company_id = $1 AND id = $2`, [
        A.companyId,
        groupId,
      ]);
    };

  const makePrivate =
    (groupId: string) =>
    async (c: PoolClient): Promise<void> => {
      await c.query(
        `UPDATE feed_groups SET visibility = 'private' WHERE company_id = $1 AND id = $2`,
        [A.companyId, groupId],
      );
    };

  const postTo = (who: Actor, groupId: string): request.Test =>
    http()
      .post("/social/posts")
      .set(auth(who.token))
      .send({ type: "share", audience: "group", groupId, body: "Bài trong nhóm" });
  const removeMemberReq = (who: Actor, g: string, target: string): request.Test =>
    http().delete(`/social/groups/${g}/members/${target}`).set(auth(who.token));
  const decideReq = (who: Actor, g: string, target: string, body: object): request.Test =>
    http().patch(`/social/groups/${g}/members/${target}`).set(auth(who.token)).send(body);
  const joinReq = (who: Actor, g: string): request.Test =>
    http().post(`/social/groups/${g}/join`).set(auth(who.token));
  const leaveReq = (who: Actor, g: string): request.Test =>
    http().post(`/social/groups/${g}/leave`).set(auth(who.token));

  async function postCount(groupId: string, userId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM feed_posts
        WHERE company_id = $1 AND group_id = $2 AND author_user_id = $3`,
      [A.companyId, groupId, userId],
    );
    return r.rows[0].n as number;
  }
  async function memberRow(
    groupId: string,
    userId: string,
  ): Promise<{ role: string; status: string } | null> {
    const r = await direct.query(
      `SELECT role, status FROM feed_group_members
        WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
      [A.companyId, groupId, userId],
    );
    return (r.rows[0] as { role: string; status: string } | undefined) ?? null;
  }
  async function memberCount(groupId: string): Promise<number> {
    const r = await direct.query(
      `SELECT member_count FROM feed_groups WHERE company_id = $1 AND id = $2`,
      [A.companyId, groupId],
    );
    return r.rows[0].member_count as number;
  }
  async function auditCount(groupId: string, action: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE object_type = 'feed_group' AND object_id = $1 AND action = $2`,
      [groupId, action],
    );
    return r.rows[0].n as number;
  }
  async function notiCount(groupId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE event_type = 'social.group_join_decided' AND payload->>'group_id' = $1`,
      [groupId],
    );
    return r.rows[0].n as number;
  }

  function expectErr(res: request.Response, status: number, code: string, label: string): void {
    expect(res.status, `${label} — ${JSON.stringify(res.body)}`).toBe(status);
    expect(res.body?.error?.code, `${label}: error.code`).toBe(code);
  }
  const expectGroupHidden = (res: request.Response, label: string): void =>
    expectErr(res, 404, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND, label);
  const expectOutOfAudience = (res: request.Response, label: string): void => {
    expectErr(res, 403, SOCIAL_ERROR_CODES.WRITE_OUT_OF_AUDIENCE, label);
    expect(res.body?.error?.message, `${label}: message`).toBe(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sgrouplocks");
    owner = await makeUser("owner", hash);
    adminA = await makeUser("admina", hash);
    u1 = await makeUser("u1", hash);
    u2 = await makeUser("u2", hash);
    poster = await makeUser("poster", hash);
    outsider = await makeUser("outsider", hash);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (A) await cleanupTenants(direct, [A.companyId]);
    await direct?.end();
  });

  // ───────────── 002 đăng bài nhóm ─────────────

  it(
    "R1: đăng bài nhóm khi người đăng vừa bị mời ra (cùng lúc) ⇒ 403 ERR-002, không có bài",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => postTo(poster, g),
        dropMember(g, poster.userId),
      );
      expectOutOfAudience(res, "002: đã không còn là thành viên");
      expect(await postCount(g, poster.userId), "0 bài của người đăng trong nhóm").toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R1+: đối chứng — thành viên còn nguyên khi khoá nhả ⇒ 201, 1 bài",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(g, "FOR UPDATE", () => postTo(poster, g), noChange);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await postCount(g, poster.userId)).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R1b: khoá `FOR NO KEY UPDATE` của người giữ khoá cũng chặn cổng đăng bài ⇒ 403",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR NO KEY UPDATE",
        () => postTo(poster, g),
        dropMember(g, poster.userId),
      );
      expectOutOfAudience(res, "002 sau FOR NO KEY UPDATE");
      expect(await postCount(g, poster.userId)).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R2: đăng bài vào nhóm vừa bị xoá mềm ⇒ 404 ERR-012, không có bài",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(g, "FOR UPDATE", () => postTo(poster, g), softDelete(g));
      expectGroupHidden(res, "002: nhóm đã xoá");
      expect(await postCount(g, poster.userId)).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "O-1: người ngoài nhóm kín nhận 404 TRƯỚC khoá — không xếp hàng sau holder",
    async () => {
      const g = await privateGroup();
      const { queued, res } = await fireUnderLock(g, "FOR UPDATE", () => postTo(outsider, g));
      expect(queued, "người ngoài nhóm kín không được chạm khoá").toBe(false);
      expectGroupHidden(res, "002: người ngoài nhóm kín");
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "P-2: các bài đăng không xếp hàng nhau (khoá chia sẻ tương thích chéo)",
    async () => {
      const g = await privateGroup();
      const { queued, res } = await fireUnderLock(g, "FOR SHARE", () => postTo(poster, g));
      expect(queued, "002 không bị khoá chia sẻ khác chặn").toBe(false);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "P-3: `039` xếp hàng sau khoá chia sẻ rồi chạy tiếp khi nhả ⇒ 200",
    async () => {
      const g = await privateGroup();
      const { queued, res } = await fireUnderLock(g, "FOR SHARE", () =>
        removeMemberReq(adminA, g, u1.userId),
      );
      expect(queued, "039 phải chờ khoá chia sẻ").toBe(true);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "P-1: bài đăng và `039` đồng thời không deadlock ⇒ {201, 200}",
    async () => {
      const g = await privateGroup();
      const hold = await holdGroupLock(g, "FOR UPDATE");
      let committed = false;
      let settled: Promise<unknown> | undefined;
      try {
        const reqs = [
          postTo(poster, g).then((r) => r),
          removeMemberReq(adminA, g, u1.userId).then((r) => r),
        ];
        settled = Promise.allSettled(reqs);
        expect(
          await waitForBlockedBy(direct, hold.pid, 2, { exact: true, timeoutMs: WAIT_LOCK_MS }),
          "cả hai request phải bị CHÍNH holder chặn",
        ).toBe(true);
        await hold.client.query("COMMIT");
        committed = true;
        const [a, b] = await Promise.all(reqs);
        expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([200, 201]);
      } finally {
        await releaseHeld(hold, !committed);
        if (settled) await settled;
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "M-016: bình luận bài nhóm không phụ thuộc hàng nhóm — đo, không phải cổng",
    async () => {
      const g = await privateGroup();
      const created = await postTo(poster, g);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const postId = created.body.data.id as string;
      const { queued } = await fireUnderLock(g, "FOR UPDATE", () =>
        http()
          .post(`/social/posts/${postId}/comments`)
          .set(auth(poster.token))
          .send({ body: "ok" }),
      );
      expect(queued, "bình luận không xếp hàng sau khoá hàng nhóm").toBe(false);
    },
    RACE_TIMEOUT_MS,
  );

  // ───────────── 038 / 039 trên nhóm vừa bị xoá mềm ─────────────

  it(
    "R3a: `039` mời thành viên ra khỏi nhóm vừa bị xoá mềm ⇒ 404; hàng còn, đếm + audit không đổi",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => removeMemberReq(adminA, g, u1.userId),
        softDelete(g),
      );
      expectGroupHidden(res, "039: nhóm đã xoá");
      expect(await memberRow(g, u1.userId)).toEqual({ role: "member", status: "active" });
      expect(await memberCount(g)).toBe(4);
      expect(await auditCount(g, "social.group_member.removed")).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R3a+: đối chứng — nhóm còn sống ⇒ 200 + 1 audit",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => removeMemberReq(adminA, g, u1.userId),
        noChange,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await memberRow(g, u1.userId)).toBeNull();
      expect(await auditCount(g, "social.group_member.removed")).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );

  async function seedPending(g: string, userId: string): Promise<void> {
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
       VALUES ($1, $2, $3, 'member', 'pending')`,
      [A.companyId, g, userId],
    );
  }

  it(
    "R3b: `038` duyệt yêu cầu vào nhóm vừa bị xoá mềm ⇒ 404; yêu cầu còn `pending`; không audit/noti",
    async () => {
      const g = await privateGroup();
      await seedPending(g, u2.userId);
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => decideReq(adminA, g, u2.userId, { decision: "approve" }),
        softDelete(g),
      );
      expectGroupHidden(res, "038 duyệt: nhóm đã xoá");
      expect(await memberRow(g, u2.userId)).toEqual({ role: "member", status: "pending" });
      expect(await auditCount(g, "social.group_member.approve")).toBe(0);
      expect(await notiCount(g)).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R3b+: đối chứng — nhóm còn sống ⇒ 200, hàng `active`, 1 audit",
    async () => {
      const g = await privateGroup();
      await seedPending(g, u2.userId);
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => decideReq(adminA, g, u2.userId, { decision: "approve" }),
        noChange,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await memberRow(g, u2.userId)).toEqual({ role: "member", status: "active" });
      expect(await auditCount(g, "social.group_member.approve")).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R3c: `038` đổi vai trong nhóm vừa bị xoá mềm ⇒ 404; vai không đổi; không audit",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => decideReq(adminA, g, u1.userId, { role: "admin" }),
        softDelete(g),
      );
      expectGroupHidden(res, "038 đổi vai: nhóm đã xoá");
      expect(await memberRow(g, u1.userId)).toEqual({ role: "member", status: "active" });
      expect(await auditCount(g, "social.group_member.role_changed")).toBe(0);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R3c+: đối chứng — nhóm còn sống ⇒ 200, vai đổi, 1 audit",
    async () => {
      const g = await privateGroup();
      const res = await raceGroup(
        g,
        "FOR UPDATE",
        () => decideReq(adminA, g, u1.userId, { role: "admin" }),
        noChange,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await memberRow(g, u1.userId)).toEqual({ role: "admin", status: "active" });
      expect(await auditCount(g, "social.group_member.role_changed")).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );

  // ───────────── 035 / 036 ─────────────

  it(
    "R4a: tham gia / rời nhóm vừa bị xoá mềm ⇒ 404 cả hai; không thêm hàng cho người xin vào, hàng người rời còn",
    async () => {
      const gj = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
      const resJ = await raceGroup(gj, "FOR UPDATE", () => joinReq(u2, gj), softDelete(gj));
      expectGroupHidden(resJ, "035: nhóm đã xoá");
      expect(await memberRow(gj, u2.userId)).toBeNull();
      expect(await memberCount(gj)).toBe(1);

      const gl = await privateGroup();
      const resL = await raceGroup(gl, "FOR UPDATE", () => leaveReq(u1, gl), softDelete(gl));
      expectGroupHidden(resL, "036: nhóm đã xoá");
      expect(await memberRow(gl, u1.userId)).toEqual({ role: "member", status: "active" });
      expect(await memberCount(gl)).toBe(4);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R4a+: đối chứng — nhóm còn sống ⇒ 201 vào nhóm, 201 rời nhóm",
    async () => {
      const gj = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
      const resJ = await raceGroup(gj, "FOR UPDATE", () => joinReq(u2, gj), noChange);
      expect(resJ.status, JSON.stringify(resJ.body)).toBe(201);
      expect(await memberRow(gj, u2.userId)).toEqual({ role: "member", status: "active" });
      const gl = await privateGroup();
      const resL = await raceGroup(gl, "FOR UPDATE", () => leaveReq(u1, gl), noChange);
      expect(resL.status, JSON.stringify(resL.body)).toBe(201);
      expect(await memberRow(gl, u1.userId)).toBeNull();
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R4b: nhóm vừa đổi sang kín khi đang chờ ⇒ tham gia thành `pending`, không vào room nhóm",
    async () => {
      const g = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const res = await raceGroup(g, "FOR UPDATE", () => joinReq(u2, g), makePrivate(g));
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.myStatus).toBe("pending");
        expect(await memberRow(g, u2.userId)).toEqual({ role: "member", status: "pending" });
        const joins = spy.mock.calls.filter((c) => c[2] === u2.userId && c[3] === "join");
        expect(joins, "không room-op join cho yêu cầu chờ duyệt").toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "R4b+: đối chứng — nhóm vẫn công khai ⇒ `active`, đúng 1 room-op join",
    async () => {
      const g = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
      const spy = vi.spyOn(app.get(RealtimeEmitterService), "syncFeedGroupMembership");
      try {
        const res = await raceGroup(g, "FOR UPDATE", () => joinReq(u2, g), noChange);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.myStatus).toBe("active");
        const joins = spy.mock.calls.filter((c) => c[2] === u2.userId && c[3] === "join");
        expect(joins).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    },
    RACE_TIMEOUT_MS,
  );
});
