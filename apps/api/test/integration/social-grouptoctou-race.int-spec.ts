/**
 * S16-SOCIAL-GROUPTOCTOU-1 — vai ACTOR phải được đọc SAU khoá hàng `feed_groups` ở mọi route GHI theo
 * vai nhóm (`033`/`034`/`038`/`039`). 🔴 Crown-jewel (cổng vai nhóm — FULL gate).
 *
 * Plan `docs/plans/S16-SOCIAL-GROUPTOCTOU-1.md` §5.2. Vai là HÀNG `feed_group_members`, không phải
 * grant ⇒ một request khác (`038` hạ vai · `039` mời ra · `036` rời) đổi được nó TRONG LÚC request
 * này đang chạy. Đọc vai TRƯỚC khoá rồi ghi SAU khoá là TOCTOU: người VỪA mất quyền vẫn ghi được.
 *
 * ┌─ HARNESS ĐUA TẤT ĐỊNH (khuôn `social-be3a-report-actions.int-spec.ts`, vị từ v2) ─────────────┐
 * │ 1. Client `direct` giữ `FOR UPDATE` hàng nhóm (đúng hình dạng một `038` thật: khoá nhóm rồi     │
 * │    đổi hàng thành viên trong CÙNG tx).                                                         │
 * │ 2. Phóng request; chờ tới khi ĐÚNG 1 backend bị CHÍNH holder chặn (`pg_blocking_pids`, helper │
 * │    `lock-wait.ts`) — mỗi ca một nhóm MỚI nên chỉ request đang xét có thể bị holder này chặn.   │
 * │    KHÔNG khớp chữ câu lệnh: waiter của spec khác thoả được vị từ đó (plan §2 M20/M25).         │
 * │ 3. Đổi vai TRONG tx giữ khoá → `COMMIT` → đọc response + DB.                                   │
 * │ Hết trần chờ ⇒ ĐỎ rõ ràng («không chồng lấp»), không bao giờ xanh-rỗng.                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi assert «0 dòng audit» có đối chứng dương dùng CHÍNH câu tra `auditRows` (C-0 cho D-1, C-3 cho
 * D-3). `app.listen(0)` sau `init()`: request song song + supertest (memory
 * `supertest-closes-shared-server-on-first-response`).
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
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
const LOGIN_PW = ["Passw0rd", "sgtoctou", "x"].join("!");
const BASE_PAIRS = ["view:feed", "create:feed-group"] as const;
const MANAGE_PAIRS = [...BASE_PAIRS, "manage:feed-group"] as const;

/** Trần chờ request vào trạng thái bị holder chặn — PHẢI < `lock_timeout` 5s của tx giữ khoá. */
const WAIT_LOCK_MS = 3_000;
/** Ca đua: route nhóm KHÔNG có `lock_timeout` (plan §2 M12) — trần riêng rộng hơn `testTimeout`. */
const RACE_TIMEOUT_MS = 30_000;

type GroupRole = "owner" | "admin" | "member";

interface Actor {
  token: string;
  userId: string;
}

interface Held {
  client: PoolClient;
  pid: number;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-GROUPTOCTOU-1 · vai actor sau khoá (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  let owner: Actor;
  let adminA: Actor;
  let adminB: Actor;
  /** Admin của nhóm KIÊM `manage:feed-group` — ca D1. */
  let mgr: Actor;
  let u1: Actor;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    label: string,
    hash: string,
    pairs: readonly string[] = BASE_PAIRS,
  ): Promise<Actor> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `gt-${label}-${randomUUID().slice(0, 6)}`);
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

  /** Nhóm MỚI cho mỗi ca (gieo thẳng, `member_count` khớp số hàng `active`). */
  async function seedGroup(
    visibility: "public" | "private",
    members: ReadonlyArray<{ userId: string; role: GroupRole }>,
  ): Promise<string> {
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, member_count)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, `GT ${randomUUID().slice(0, 8)}`, visibility, members.length],
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

  /** Mở tx trên `pool`, đặt trần chờ khoá, trả pid backend. Hỏng giữa chừng ⇒ huỷ hẳn client. */
  async function openTx(pool: Pool, lockTimeout: "5s" | "10s"): Promise<Held> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
      const pid = (await client.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
      return { client, pid };
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }

  /**
   * Nhả một tx: `ROLLBACK` (nếu chưa COMMIT) rồi trả client về pool. `ROLLBACK` hỏng ⇒ HUỶ client
   * (`release(err)` đóng kết nối, server tự huỷ tx) — không trả về pool một client đang kẹt giữa tx.
   */
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

  const LOCK_GROUP_SQL = `SELECT 1 FROM feed_groups WHERE company_id = $1 AND id = $2 FOR UPDATE`;

  /** Holder của ca: MỘT client `direct` giữ `FOR UPDATE` hàng nhóm (plan §5.2, M26). */
  async function holdGroupLock(groupId: string): Promise<Held> {
    const held = await openTx(direct, "5s");
    await held.client.query(LOCK_GROUP_SQL, [A.companyId, groupId]).then(
      () => undefined,
      async (err: Error) => {
        await releaseHeld(held, true);
        throw err;
      },
    );
    return held;
  }

  /** Chờ các backend có pid cho trước CÙNG ở trạng thái chờ khoá — theo DANH TÍNH, không theo chữ. */
  async function waitUntilWaiting(pids: readonly number[]): Promise<boolean> {
    const deadline = Date.now() + WAIT_LOCK_MS;
    while (Date.now() < deadline) {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'`,
        [pids],
      );
      if (r.rows[0].n === pids.length) return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  }

  /**
   * Ca đua: giữ khoá hàng nhóm → phóng `fire()` → chờ ĐÚNG 1 backend bị CHÍNH holder chặn → `mutate`
   * TRONG tx giữ khoá → `COMMIT` → trả response.
   *
   * `finally` (plan §10 F3): nhả tx (ROLLBACK nếu chưa COMMIT) TRƯỚC khi chờ request — request đang chờ
   * chính khoá này và route nhóm KHÔNG có `lock_timeout` (M12) — rồi chờ request xong. `allSettled` gắn
   * NGAY lúc phóng ⇒ request không bao giờ mồ côi, kể cả khi poll hết trần hay một `expect` ném
   * (memory `vitest-unhandled-rejection-after-teardown`).
   */
  async function raceGroup(
    groupId: string,
    fire: () => request.Test,
    mutate: (c: PoolClient) => Promise<void>,
  ): Promise<request.Response> {
    const hold = await holdGroupLock(groupId);
    let committed = false;
    let settled: Promise<unknown> | undefined;
    try {
      const reqP = fire().then((r) => r);
      settled = Promise.allSettled([reqP]);
      expect(
        await waitForBlockedBy(direct, hold.pid, 1, { exact: true, timeoutMs: WAIT_LOCK_MS }),
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

  /** Đúng hình dạng một `038` thật: đổi hàng thành viên TRONG tx đang giữ khoá hàng nhóm. */
  const demote =
    (groupId: string, userId: string, role: GroupRole) =>
    async (c: PoolClient): Promise<void> => {
      const r = await c.query(
        `UPDATE feed_group_members SET role = $3
          WHERE company_id = $1 AND group_id = $2 AND user_id = $4`,
        [A.companyId, groupId, role, userId],
      );
      expect(r.rowCount, "hạ vai phải đổi ĐÚNG 1 hàng").toBe(1);
    };

  /** Hàng của actor BIẾN MẤT giữa chừng (bị mời ra / tự rời song song). */
  const dropMember =
    (groupId: string, userId: string) =>
    async (c: PoolClient): Promise<void> => {
      const r = await c.query(
        `DELETE FROM feed_group_members WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
        [A.companyId, groupId, userId],
      );
      expect(r.rowCount, "xoá hàng actor phải xoá ĐÚNG 1 hàng").toBe(1);
    };

  /** Đối chứng: harness chạy ĐỦ (giữ khoá, chờ, COMMIT) nhưng không đổi gì. */
  const noChange = (): Promise<void> => Promise.resolve();

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

  async function groupRow(groupId: string): Promise<{
    visibility: string;
    member_count: number;
    deleted_at: Date | null;
    updated_at: Date;
    updated_by: string | null;
  }> {
    const r = await direct.query(
      `SELECT visibility, member_count, deleted_at, updated_at, updated_by
         FROM feed_groups WHERE company_id = $1 AND id = $2`,
      [A.companyId, groupId],
    );
    return r.rows[0];
  }

  /** MỘT câu tra cho cả ca «0 dòng» lẫn đối chứng dương của nó (plan §10 F5). */
  async function auditRows(
    groupId: string,
    action: string,
  ): Promise<{ action: string; metadata: Record<string, unknown> }[]> {
    const r = await direct.query(
      `SELECT action, metadata FROM audit_logs
        WHERE object_type = 'feed_group' AND object_id = $1 AND action = $2
        ORDER BY created_at, id`,
      [groupId, action],
    );
    return r.rows;
  }

  /** 403 ĐÚNG lý do vai nhóm — 403/409/500 vì lý do khác KHÔNG lọt (mã máy + thông điệp, #554). */
  function expectRoleDenied(res: request.Response, label: string): void {
    expect(res.status, `${label} — ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body?.error?.code, `${label}: error.code`).toBe(
      SOCIAL_ERROR_CODES.GROUP_ROLE_REQUIRED,
    );
    expect(res.body?.error?.message, `${label}: error.message`).toBe(
      SOCIAL_ERR.GROUP_ROLE_REQUIRED,
    );
  }

  /** Nhóm kín chuẩn của ca `038`/`039`: owner + một admin + target `u1`. */
  const groupWithAdmin = (admin: Actor): Promise<string> =>
    seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: admin.userId, role: "admin" },
      { userId: u1.userId, role: "member" },
    ]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sgtoctou");

    owner = await makeUser("owner", hash);
    adminA = await makeUser("admina", hash);
    adminB = await makeUser("adminb", hash);
    mgr = await makeUser("mgr", hash, MANAGE_PAIRS);
    u1 = await makeUser("u1", hash);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (A) await cleanupTenants(direct, [A.companyId]);
    await direct?.end();
  });

  /**
   * H-0 — HARNESS TỰ KIỂM (plan §5.2, đo M20/M21). Waiter NGOẠI: H1 khoá nhóm X; W1 (đã khoá Z) chờ
   * X; W2 chờ Z (bị W1 chặn — bậc 2). H2 khoá nhóm Y, CHƯA phóng request nào ⇒ vị từ của H2 phải = 0
   * (vị từ khớp chữ cho 2 ở đây — xanh-rỗng). Vị từ của H1 phải = 2 (bắc cầu tới W2). Rồi phóng `039`
   * lên Y ⇒ đúng 1 backend bị H2 chặn. Lưới chống quay về vị từ khớp chữ (M-9) hay một bậc (M-10).
   * Pool RIÊNG cho H1/W1/W2: `directPool()` chỉ có 4 client (M26).
   */
  it(
    "H-0: harness tự kiểm — chỉ đếm backend bị CHÍNH holder chặn (waiter ngoại = 0; bậc 2 được đếm)",
    async () => {
      const X = await seedGroup("private", []);
      const Z = await seedGroup("private", []);
      const Y = await groupWithAdmin(adminA);

      const aux = directPool();
      const opened: Held[] = [];
      const pending: Promise<unknown>[] = [];
      let h2: Held | undefined;
      let h2Released = false;
      let settled: Promise<unknown> | undefined;
      try {
        const h1 = await openTx(aux, "10s");
        opened.push(h1);
        await h1.client.query(LOCK_GROUP_SQL, [A.companyId, X]);
        const w1 = await openTx(aux, "10s");
        opened.push(w1);
        await w1.client.query(LOCK_GROUP_SQL, [A.companyId, Z]);
        pending.push(Promise.allSettled([w1.client.query(LOCK_GROUP_SQL, [A.companyId, X])]));
        const w2 = await openTx(aux, "10s");
        opened.push(w2);
        pending.push(Promise.allSettled([w2.client.query(LOCK_GROUP_SQL, [A.companyId, Z])]));
        expect(await waitUntilWaiting([w1.pid, w2.pid]), "W1 và W2 phải ĐANG CHỜ khoá").toBe(true);

        h2 = await holdGroupLock(Y);
        expect(
          await countBlockedBy(direct, h2.pid),
          "holder MỚI chưa phóng request: waiter NGOẠI KHÔNG được đếm",
        ).toBe(0);
        expect(
          await countBlockedBy(direct, h1.pid),
          "W2 bị W1 chặn (bậc 2) — bao đóng bắc cầu từ H1 phải đếm cả W1 lẫn W2",
        ).toBe(2);

        const reqP = del(adminA.token, `/social/groups/${Y}/members/${u1.userId}`).then((r) => r);
        settled = Promise.allSettled([reqP]);
        expect(
          await waitForBlockedBy(direct, h2.pid, 1, { exact: true, timeoutMs: WAIT_LOCK_MS }),
          "request phải bị CHÍNH H2 chặn (pg_blocking_pids) — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);
        await h2.client.query("ROLLBACK");
        h2Released = true;
        const res = await reqP;
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      } finally {
        // (1) nhả H2 TRƯỚC khi chờ request — request đang chờ chính khoá này.
        if (h2) await releaseHeld(h2, !h2Released);
        if (settled) await settled;
        // (2) thứ tự nhả: H1 → W1 (lấy được X, rồi nhả Z) → W2. `pg` xếp hàng câu theo client nên
        // ROLLBACK của W1 chạy SAU câu đang chờ của chính nó.
        for (const h of opened) await releaseHeld(h, true);
        await Promise.all(pending);
        await aux.end();
      }
    },
    RACE_TIMEOUT_MS,
  );

  // ───────────────────────── deny-path (RED trước) ─────────────────────────

  /** 🔴 D-1 (`done_when`) — L1 của plan: đo M3/M22. Đối chứng dương của «0 audit»: C-0. */
  it(
    "D-1: `039` — actor bị hạ vai (admin → member) giữa chừng ⇒ 403 ERR-014; target còn; member_count + audit không đổi",
    async () => {
      const g = await groupWithAdmin(adminA);
      const res = await raceGroup(
        g,
        () => del(adminA.token, `/social/groups/${g}/members/${u1.userId}`),
        demote(g, adminA.userId, "member"),
      );
      expectRoleDenied(res, "039: actor bị hạ vai giữa chừng phải 403");
      expect(await memberRow(g, u1.userId), "hàng target phải CÒN").toEqual({
        role: "member",
        status: "active",
      });
      expect((await groupRow(g)).member_count, "member_count không đổi").toBe(3);
      expect(
        await auditRows(g, "social.group_member.removed"),
        "0 audit mời ra (đối chứng dương: C-0 — CÙNG câu tra)",
      ).toHaveLength(0);
    },
    RACE_TIMEOUT_MS,
  );

  /** 🔴 D-2 — hàng actor biến mất giữa chừng trên nhóm KÍN ⇒ 403, không 404 (owner ký D3=(a)). Đo M4. */
  it(
    "D-2: `039` — hàng actor BIẾN MẤT giữa chừng (nhóm kín) ⇒ 403 ERR-014; target còn",
    async () => {
      const g = await groupWithAdmin(adminA);
      const res = await raceGroup(
        g,
        () => del(adminA.token, `/social/groups/${g}/members/${u1.userId}`),
        dropMember(g, adminA.userId),
      );
      expectRoleDenied(res, "039: hàng actor biến mất giữa chừng phải 403 (D3)");
      expect(await memberRow(g, u1.userId), "hàng target phải CÒN").toEqual({
        role: "member",
        status: "active",
      });
    },
    RACE_TIMEOUT_MS,
  );

  /**
   * PIN-1 — `038` admin THƯỜNG (không manage) bị hạ vai giữa chừng. XANH từ BE-2A §14.1 (đo M5/M22) —
   * đây là lưới TẤT ĐỊNH đầu tiên cho bản vá đó (BE-2A ghi «không có test tất định»).
   */
  it(
    "PIN-1: `038` — admin thường bị hạ vai giữa chừng ⇒ 403 ERR-014; target vẫn `member`",
    async () => {
      const g = await groupWithAdmin(adminB);
      const res = await raceGroup(
        g,
        () =>
          patch(adminB.token, `/social/groups/${g}/members/${u1.userId}`).send({ role: "admin" }),
        demote(g, adminB.userId, "member"),
      );
      expectRoleDenied(res, "038: actor bị hạ vai giữa chừng phải 403");
      expect(await memberRow(g, u1.userId), "target KHÔNG được nâng vai").toEqual({
        role: "member",
        status: "active",
      });
    },
    RACE_TIMEOUT_MS,
  );

  // ─────────── D1=(a) (owner ký 02/10/2026): «vai HOẶC manage» trên hàng đọc SAU khoá ───────────

  /**
   * A-1 — L2: admin KIÊM `manage:feed-group` bị hạ vai giữa chừng. API-19 `:107` cho `manage` qua «BẤT
   * KỂ vai trong nhóm» ⇒ 200, audit `viaManage:true` (nguồn quyền THẬT lúc commit). Trước vá: 403 (đo
   * M6) trong khi cùng người gửi lại 1ms sau là 200 (M7) — kết quả theo THỜI ĐIỂM, không theo quyền.
   */
  it(
    "A-1: `038` — admin kiêm manage bị hạ vai giữa chừng, {role:'admin'} ⇒ 200; target = admin; audit viaManage:true",
    async () => {
      const g = await groupWithAdmin(mgr);
      const res = await raceGroup(
        g,
        () => patch(mgr.token, `/social/groups/${g}/members/${u1.userId}`).send({ role: "admin" }),
        demote(g, mgr.userId, "member"),
      );
      expect(
        res.status,
        `038: manage cho qua BẤT KỂ vai hàng (D1) — ${JSON.stringify(res.body)}`,
      ).toBe(200);
      expect(await memberRow(g, u1.userId)).toEqual({ role: "admin", status: "active" });
      const rows = await auditRows(g, "social.group_member.role_changed");
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata, "nguồn quyền lúc commit là manage").toMatchObject({
        targetUserId: u1.userId,
        from: "member",
        to: "admin",
        viaManage: true,
      });
    },
    RACE_TIMEOUT_MS,
  );

  /** A-2 — như A-1 nhưng cấp `owner` (D12: manage cấp được owner). Trước vá: 403 (đo M7b). */
  it(
    "A-2: `038` — admin kiêm manage bị hạ vai giữa chừng, {role:'owner'} ⇒ 200; target = owner; audit viaManage:true",
    async () => {
      const g = await groupWithAdmin(mgr);
      const res = await raceGroup(
        g,
        () => patch(mgr.token, `/social/groups/${g}/members/${u1.userId}`).send({ role: "owner" }),
        demote(g, mgr.userId, "member"),
      );
      expect(res.status, `038: manage cấp được owner (D1/D12) — ${JSON.stringify(res.body)}`).toBe(
        200,
      );
      expect(await memberRow(g, u1.userId)).toEqual({ role: "owner", status: "active" });
      const rows = await auditRows(g, "social.group_member.role_changed");
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({
        targetUserId: u1.userId,
        to: "owner",
        viaManage: true,
      });
    },
    RACE_TIMEOUT_MS,
  );

  /**
   * A-3 — L3: `039` cùng ca. Thao tác ĐI QUA cả trước vá (nhờ manage) nhưng sổ append-only ghi
   * `viaManage:false` — sai nguồn quyền lúc commit (đo M8).
   */
  it(
    "A-3: `039` — admin kiêm manage bị hạ vai giữa chừng ⇒ 200; target bị mời ra; audit viaManage:true",
    async () => {
      const g = await groupWithAdmin(mgr);
      const res = await raceGroup(
        g,
        () => del(mgr.token, `/social/groups/${g}/members/${u1.userId}`),
        demote(g, mgr.userId, "member"),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await memberRow(g, u1.userId), "target phải bị mời ra").toBeNull();
      const rows = await auditRows(g, "social.group_member.removed");
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata, "audit phải ghi nguồn quyền LÚC COMMIT (manage)").toMatchObject({
        targetUserId: u1.userId,
        viaManage: true,
      });
    },
    RACE_TIMEOUT_MS,
  );

  // ───────────────────────── đối chứng ─────────────────────────

  /**
   * C-0 — chống xanh-rỗng của D-1: CÙNG harness (giữ khoá, chờ bị chặn, COMMIT) nhưng không đổi vai ⇒
   * phải 200. Chứng minh 403 ở D-1 không do harness gây ra và `auditRows` tìm ra dòng thật.
   */
  it(
    "C-0: `039` qua harness ĐỦ mà không đổi vai ⇒ 200; target bị mời ra; 1 audit `removed` viaManage:false",
    async () => {
      const g = await groupWithAdmin(adminA);
      const res = await raceGroup(
        g,
        () => del(adminA.token, `/social/groups/${g}/members/${u1.userId}`),
        noChange,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await memberRow(g, u1.userId), "target phải bị mời ra").toBeNull();
      expect((await groupRow(g)).member_count).toBe(2);
      const rows = await auditRows(g, "social.group_member.removed");
      expect(rows, "CÙNG câu tra của D-1 phải tìm ra dòng").toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({ targetUserId: u1.userId, viaManage: false });
    },
    RACE_TIMEOUT_MS,
  );
});
