/**
 * S16-SOCIAL-BE-3C — thùng rác bài viết: khôi phục `SOCIAL-API-058` (`POST
 * /recycle-bin/feed-posts/{post_id}/restore`). Ca D1..D6 (deny, RED TRƯỚC — route CHƯA tồn tại lúc
 * file này được viết) · A1..A11 (allow) của plan §3. Ca A6/A9/W1 + phần liệt kê `057` nằm ở file anh
 * em `social-be3c-recycle-list.int-spec.ts` (mỗi file tự đủ setup — TÁCH theo lựa chọn của QA để giữ
 * mỗi file dưới ~900 dòng; plan §3 chỉ nêu MỘT file `social-be3c-recycle-restore.int-spec.ts` gộp).
 *
 * ┌─ HAI CÔNG TY ──────────────────────────────────────────────────────────────────────────────────┐
 * │ A = mọi ca chính (deny + allow) · B = đối tác cross-tenant (D3, chỉ MỘT vai HR).                │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Vai của A: `tHr`/`tAdmin` (đủ quyền — tạo/kiểm duyệt/khôi phục, mirror HR + company-admin thật) ·
 * `tAuthor`/`tPeer` (tác giả/bạn đồng nghiệp, không có `restore:feed-post`) · `tEmployee`/`tManager`
 * (D1, không có cặp) · `tDeptRestore`/`tAllowDeny`/`tManageOnly`/`tDeptPlusManage` (D2/D2c/D2c', vai
 * tuỳ biến khoét đúng một lát cắt quyền). Mật khẩu ghép chuỗi (không literal giống secret).
 *
 * Hợp đồng API giả định (orchestrator cài song song — xem `docs/plans/S16-SOCIAL-BE-3C.md` §1 O1-O4 +
 * §3): `restorePostTx` mới trả `"published" | "hidden" | null`; cột `feed_posts.status_before_delete`;
 * hằng lỗi MỚI `SOCIAL_ERR.RESTORE_GROUP_DELETED`; hai khoá `SOCIAL_ROUTE_PAIRS.recycleFeedPostList` /
 * `.recycleFeedPostRestore` = `pair("restore","feed-post")`. File này KHÔNG chạy được cho tới khi các
 * mảnh đó tồn tại — đó chính là RED-trước.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { SocialPollCloseExpiredJobHandler } from "../../src/social/social-poll-close.job-handler";
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
const LOGIN_PW = ["Passw0rd!socialbe3c", "restore"].join("-");

/** Trần chờ một request HTTP rơi vào trạng thái CHỜ khoá hàng (khuôn `social-be3a-report-actions`). */
const WAIT_LOCK_MS = 3_000;

const LIST_URL = "/recycle-bin/feed-posts";
const restoreUrl = (postId: string): string => `/recycle-bin/feed-posts/${postId}/restore`;

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
interface Grant {
  readonly action: string;
  readonly resource: string;
  readonly scope?: Scope;
  readonly effect?: "ALLOW" | "DENY";
  /** Mirror cờ catalog thật — CHỈ `restore:employee`/`restore:user` là `true` (A10). Mặc định `false`. */
  readonly sensitive?: boolean;
}

interface RestoreListItem {
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

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-3C · khôi phục bài viết 058 (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let hash = "";
  let A: SeededTenant;
  let B: SeededTenant;
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
  const put = (token: string, url: string) => auth(token)(http().put(url));
  const del = (token: string, url: string) => auth(token)(http().delete(url));
  const msg = (res: request.Response): string => JSON.stringify(res.body);

  /**
   * Dựng MỘT actor: user + hồ sơ nhân sự (+ đơn vị nếu có) + (tuỳ chọn) một role RIÊNG mang đúng tập
   * `grants` — mirror `makeMember`/`grantPairs` của `social-be1b-reports`/`social-be3a`, nhưng gộp
   * thêm `scope`/`effect`/`sensitive` per-grant để dựng được vai khoét đúng MỘT lát cắt quyền (D2/D2c).
   */
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
        `sb3c-${label}-${randomUUID().slice(0, 6)}`,
      );
      for (const g of grants) {
        const permId = await seedPermissionCatalog(
          direct,
          g.action,
          g.resource,
          g.sensitive ?? false,
        );
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

  // ── vai của công ty A ──
  let tHr = "";
  let uHr = "";
  let tAdmin = "";
  let tEmployee = "";
  let tManager = "";
  let tDeptRestore = "";
  let tAllowDeny = "";
  let tManageOnly = "";
  let tDeptPlusManage = "";
  let tRestoreOnly = "";
  let tAuthor = "";
  let uAuthor = "";
  let tPeer = "";
  let uPeer = "";
  let ePeer = "";
  // ── công ty B ──
  let tHrB = "";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    // D6 phóng hai request `Promise.all` trên CÙNG app — không listen thì supertest tự dựng server tạm
    // cho từng request và response đầu tiên đóng server dùng chung (memory
    // `supertest-closes-shared-server-on-first-response`; khuôn `social-be3a`/`social-be1-content`).
    await app.listen(0);

    direct = directPool();
    hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb3ca");
    B = await seedCompany(direct, "sb3cb");
    companyIds.push(A.companyId, B.companyId);

    // Tập quyền mirror vai HR/company-admin THẬT (seed `0578` + `0590` của plan): đủ để tạo/kiểm
    // duyệt/báo cáo/bình chọn/vinh danh VÀ khôi phục. KHÔNG dùng lại role canonical thật (kỷ luật
    // chung của mọi int-spec SOCIAL — xem `test/helpers/seed.ts` docblock `seedPermissionCatalog`).
    const HR_GRANTS: Grant[] = [
      { action: "view", resource: "feed" },
      { action: "create", resource: "feed-post" },
      { action: "create", resource: "feed-comment" },
      { action: "create", resource: "feed-poll" },
      { action: "create", resource: "feed-kudos" },
      { action: "manage", resource: "feed-post" },
      { action: "manage", resource: "feed-news" },
      { action: "restore", resource: "feed-post" },
      // A3 (029 delete_target): `reportResolve = pair("manage","feed-report", true)` — thiếu cặp này thì
      // PermissionGuard tầng 1 chặn 403 TRƯỚC khi chạm route, và ca A3 đỏ SAI LÝ DO (không phải vì 058).
      { action: "view", resource: "feed-report" },
      { action: "manage", resource: "feed-report" },
    ];
    const BASE_GRANTS: Grant[] = [
      { action: "view", resource: "feed" },
      { action: "create", resource: "feed-post" },
      { action: "create", resource: "feed-comment" },
    ];

    const hr = await makeActor(A, "hr", HR_GRANTS);
    tHr = hr.token;
    uHr = hr.userId;
    tAdmin = (await makeActor(A, "admin", HR_GRANTS)).token;

    tEmployee = (await makeActor(A, "emp", BASE_GRANTS)).token;
    tManager = (
      await makeActor(A, "mgr", [
        { action: "view", resource: "feed" },
        { action: "view", resource: "feed-report", scope: "Department" },
      ])
    ).token;
    // D2 — cặp ĐÚNG (`restore:feed-post`) nhưng scope hẹp hơn sàn Company.
    tDeptRestore = (
      await makeActor(A, "deptres", [
        { action: "restore", resource: "feed-post", scope: "Department" },
      ])
    ).token;
    // D2 — ALLOW + DENY cùng cặp, cùng scope Company: engine phải từ chối (DENY thắng).
    tAllowDeny = (
      await makeActor(A, "allowdeny", [
        { action: "restore", resource: "feed-post", scope: "Company" },
        { action: "restore", resource: "feed-post", scope: "Company", effect: "DENY" },
      ])
    ).token;
    // D2c (O1) — CHỈ `manage:feed-post`, KHÔNG `restore:feed-post` — hai cặp TÁCH BIỆT.
    tManageOnly = (
      await makeActor(A, "manageonly", [
        { action: "manage", resource: "feed-post", scope: "Company" },
      ])
    ).token;
    // D2c' — nhân chứng M7b: `restore@Department` + `manage@Company` cùng vai.
    tDeptPlusManage = (
      await makeActor(A, "deptplus", [
        { action: "restore", resource: "feed-post", scope: "Department" },
        { action: "manage", resource: "feed-post", scope: "Company" },
      ])
    ).token;
    // D2/D2c/D2c' — vai ALLOW đối chứng khoét ĐÚNG MỘT lát cắt (CHỈ `restore:feed-post@Company`, không
    // 7 cặp khác của `tHr`) để ALLOW/DENY của mỗi ca chỉ khác nhau đúng một grant.
    tRestoreOnly = (
      await makeActor(A, "restoreonly", [
        { action: "restore", resource: "feed-post", scope: "Company" },
      ])
    ).token;

    const author = await makeActor(A, "author", BASE_GRANTS);
    tAuthor = author.token;
    uAuthor = author.userId;
    const peer = await makeActor(A, "peer", BASE_GRANTS);
    tPeer = peer.token;
    uPeer = peer.userId;
    ePeer = peer.employeeId;

    tHrB = (await makeActor(B, "hrb", HR_GRANTS)).token;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
    // `directPool()` (max 4) — tiền lệ `social-be2b1-polls.int-spec.ts:206-210` đóng pool ở `afterAll`;
    // thiếu bước này để 4 connection mở treo cho lượt chạy sau.
    await direct?.end();
  });

  // ─── fixture helpers ────────────────────────────────────────────────────────────────────────────

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

  async function postRow(postId: string) {
    const r = await direct.query(
      `SELECT status, deleted_at, deleted_by, status_before_delete, updated_by, pinned
         FROM feed_posts WHERE id = $1`,
      [postId],
    );
    return r.rows[0] as {
      status: string;
      deleted_at: Date | null;
      deleted_by: string | null;
      status_before_delete: string | null;
      updated_by: string | null;
      pinned: boolean;
    };
  }

  async function auditRestoreRows(postId: string) {
    const r = await direct.query(
      `SELECT action, object_type, module_code, entity_type, object_id, entity_id, result_status,
              metadata, actor_user_id
         FROM audit_logs WHERE object_id = $1 AND action = 'social.post.restore' ORDER BY created_at`,
      [postId],
    );
    return r.rows as Array<{
      action: string;
      object_type: string;
      module_code: string | null;
      entity_type: string | null;
      object_id: string;
      entity_id: string | null;
      result_status: string | null;
      metadata: Record<string, unknown>;
      actor_user_id: string | null;
    }>;
  }

  async function tagUsage(tag: string): Promise<number> {
    const r = await direct.query(
      `SELECT usage_count FROM feed_tags WHERE company_id = $1 AND tag = $2`,
      [A.companyId, tag],
    );
    return r.rows.length ? Number(r.rows[0].usage_count) : 0;
  }

  async function outboxCount(
    eventType: string,
    postId: string,
    key: "targetId" | "post_id",
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE company_id = $1 AND event_type = $2 AND payload->>$3 = $4`,
      [A.companyId, eventType, key, postId],
    );
    return Number(r.rows[0].n);
  }

  /**
   * A5 — đếm outbox event MANG postId Ở BẤT KỲ khoá payload nào (`targetId`/`post_id`/…), MỌI loại
   * event, không chỉ `social.mentioned`/`social.kudos_received`. `outboxCount` chỉ đếm ĐÚNG hai event
   * đã biết trước ⇒ mutant "khôi phục phát lại MỘT event KHÁC" (vd `feed.post.created`) vẫn xanh nếu
   * chỉ đếm hai cái cũ. `payload::text LIKE` bắt được postId ở BẤT KỲ khoá nào trong payload.
   */
  async function outboxCountAny(postId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1 AND payload::text LIKE '%' || $2 || '%'`,
      [A.companyId, postId],
    );
    return Number(r.rows[0].n);
  }

  /**
   * Harness đua TẤT ĐỊNH (khuôn `social-be3a-report-actions.int-spec.ts`): poll tới khi có ≥ `n` backend
   * (khác `excludePid`) ĐANG CHỜ khoá trên câu đụng `feed_`. Hết trần ⇒ `false` — caller PHẢI fail rõ
   * ràng. Không bước chờ này thì hai request có thể chạy nối đuôi và ca «đồng thời» xanh-rỗng.
   */
  async function waitForLockWaiters(excludePid: number, n: number): Promise<boolean> {
    const deadline = Date.now() + WAIT_LOCK_MS;
    while (Date.now() < deadline) {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active'
            AND wait_event_type = 'Lock' AND pid <> $1 AND query ILIKE '%feed_%'`,
        [excludePid],
      );
      if (r.rows[0].n >= n) return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  }

  /** Mở một tx trên `direct` và giữ khoá HÀNG bài (FOR UPDATE) cho tới khi caller nhả. */
  async function holdPostLock(postId: string): Promise<{ client: PoolClient; pid: number }> {
    const client = await direct.connect();
    await client.query("BEGIN");
    await client.query(`SELECT id FROM feed_posts WHERE id = $1 FOR UPDATE`, [postId]);
    const pid = (await client.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
    return { client, pid };
  }

  /** Phóng request NGAY (supertest chỉ gửi khi `.then`) — trả promise của response. */
  const launch = (t: request.Test): Promise<request.Response> => t.then((r) => r);

  async function notificationsCount(userId: string): Promise<number> {
    const r = await direct.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [
      userId,
    ]);
    return Number(r.rows[0].n);
  }

  async function pollTotals(postId: string) {
    const r = await direct.query(
      `SELECT COALESCE((SELECT SUM(o.vote_count) FROM feed_poll_options o
                          WHERE o.poll_id = (SELECT id FROM feed_polls WHERE post_id = $1)), 0)::int AS sum_votes,
              (SELECT count(*)::int FROM feed_poll_votes v
                WHERE v.poll_id = (SELECT id FROM feed_polls WHERE post_id = $1)) AS vote_rows`,
      [postId],
    );
    return { sumVotes: Number(r.rows[0].sum_votes), voteRows: Number(r.rows[0].vote_rows) };
  }

  async function pollOptionIds(postId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT id FROM feed_poll_options WHERE poll_id = (SELECT id FROM feed_polls WHERE post_id = $1)
        ORDER BY position`,
      [postId],
    );
    return r.rows.map((row: { id: string }) => row.id);
  }

  /**
   * A7 — `vote_count` TỪNG option (không chỉ tổng — `pollTotals` chỉ so Σ, nên một mutant dồn phiếu từ
   * option này sang option khác vẫn xanh vì tổng không đổi).
   */
  async function pollOptionVoteCounts(
    postId: string,
  ): Promise<Array<{ id: string; position: number; vote_count: number }>> {
    const r = await direct.query(
      `SELECT id, position, vote_count FROM feed_poll_options
        WHERE poll_id = (SELECT id FROM feed_polls WHERE post_id = $1) ORDER BY position`,
      [postId],
    );
    return r.rows as Array<{ id: string; position: number; vote_count: number }>;
  }

  async function pollStatus(postId: string): Promise<string> {
    const r = await direct.query(`SELECT status FROM feed_polls WHERE post_id = $1`, [postId]);
    return r.rows[0].status as string;
  }

  /**
   * A8 — kiểm CẢ mã `23514` VÀ tên constraint (không chỉ `code`): một CHECK khác trên `feed_posts` nổ vì
   * fixture sai cũng cho `23514` ⇒ xanh sai lý do nếu chỉ so mã.
   */
  async function expectCheckViolation(promise: Promise<unknown>, constraint: string): Promise<void> {
    await expect(promise).rejects.toMatchObject({ code: "23514", constraint });
  }

  // ══════════════════════════════ D — deny-path (RED TRƯỚC) ══════════════════════════════

  describe("D — deny-path", () => {
    it("D1: employee và manager (không cặp restore:feed-post) ⇒ 403 ở 057 và 058; hàng vẫn xoá; 0 audit", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      for (const token of [tEmployee, tManager]) {
        const listRes = await get(token, LIST_URL);
        expect(listRes.status, msg(listRes)).toBe(403);
        const restoreRes = await post(token, restoreUrl(id));
        expect(restoreRes.status, msg(restoreRes)).toBe(403);
      }
      expect((await postRow(id)).deleted_at).not.toBeNull();
      expect(await auditRestoreRows(id)).toHaveLength(0);

      // ALLOW đối chứng — CÙNG hàng, vai đủ cặp ⇒ 200 ở CẢ HAI route (A1 dùng fixture RIÊNG; ở đây chỉ
      // xác nhận route không khoá cứng bằng cách thử lại với `tHr` ngay trên hàng vừa bị 403).
      const okList = await get(tHr, LIST_URL, { limit: "100" });
      expect(okList.status, msg(okList)).toBe(200);
      expect((okList.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(id);
      const allow = await post(tHr, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D2: vai tuỳ biến restore:feed-post@Department ⇒ 403 AUTH-ERR-SCOPE-DENIED ở CẢ HAI route", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const listRes = await get(tDeptRestore, LIST_URL);
      expect(listRes.status, msg(listRes)).toBe(403);
      expect(msg(listRes)).toContain("AUTH-ERR-SCOPE-DENIED");

      const restoreRes = await post(tDeptRestore, restoreUrl(id));
      expect(restoreRes.status, msg(restoreRes)).toBe(403);
      expect(msg(restoreRes)).toContain("AUTH-ERR-SCOPE-DENIED");

      expect(await auditRestoreRows(id)).toHaveLength(0);
      // ALLOW đối chứng — vai `tRestoreOnly` chỉ khác `tDeptRestore` đúng MỘT lát (Company thay vì
      // Department) — cô lập đúng slice đang bị deny, không mượn 8 cặp của `tHr`.
      const okList = await get(tRestoreOnly, LIST_URL, { limit: "100" });
      expect(okList.status, msg(okList)).toBe(200);
      expect((okList.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(id);
      const allow = await post(tRestoreOnly, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D2: ALLOW + DENY cùng cặp restore:feed-post@Company ⇒ 403 ở CẢ HAI route", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const listRes = await get(tAllowDeny, LIST_URL);
      expect(listRes.status, msg(listRes)).toBe(403);
      // Engine `permission.decide.ts`: ALLOW+DENY cùng cặp/scope ⇒ reason "deny-explicit" (DENY thắng).
      // Không assert lý do thì «403 vì bất cứ gì» cũng xanh.
      expect(msg(listRes)).toContain("deny-explicit");
      const restoreRes = await post(tAllowDeny, restoreUrl(id));
      expect(restoreRes.status, msg(restoreRes)).toBe(403);
      expect(msg(restoreRes)).toContain("deny-explicit");
      expect(await auditRestoreRows(id)).toHaveLength(0);

      // ALLOW đối chứng — vai `tRestoreOnly` (CÙNG cặp, không DENY) ⇒ 200. KHÔNG mượn `tHr`: vai đó có
      // ≥8 cặp nên không cô lập được đúng lát cắt `restore:feed-post@Company` đang bị test.
      const okList = await get(tRestoreOnly, LIST_URL, { limit: "100" });
      expect(okList.status, msg(okList)).toBe(200);
      expect((okList.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(id);
      const allow = await post(tRestoreOnly, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D2c (O1): vai CHỈ manage:feed-post@Company (không restore:feed-post) ⇒ 403 ở CẢ HAI route", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const listRes = await get(tManageOnly, LIST_URL);
      expect(listRes.status, msg(listRes)).toBe(403);
      // Phân biệt với D2: đây là THIẾU HẲN cặp (tầng 1 `PermissionGuard` chặn — `permission.guard.ts:140`
      // "Permission denied: <reason>"), không phải scope hẹp (tầng 2 `resolveActor` — "AUTH-ERR-SCOPE-DENIED").
      expect(msg(listRes)).not.toContain("AUTH-ERR-SCOPE-DENIED");
      expect(msg(listRes)).toContain("Permission denied");

      const restoreRes = await post(tManageOnly, restoreUrl(id));
      expect(restoreRes.status, msg(restoreRes)).toBe(403);
      expect(msg(restoreRes)).not.toContain("AUTH-ERR-SCOPE-DENIED");
      expect(msg(restoreRes)).toContain("Permission denied");
      expect(await auditRestoreRows(id)).toHaveLength(0);

      // ALLOW đối chứng — vai `tRestoreOnly` có ĐÚNG `restore:feed-post@Company` mà `tManageOnly` thiếu.
      const okList = await get(tRestoreOnly, LIST_URL, { limit: "100" });
      expect(okList.status, msg(okList)).toBe(200);
      expect((okList.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(id);
      const allow = await post(tRestoreOnly, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D2c': restore:feed-post@Department + manage:feed-post@Company ⇒ 403 AUTH-ERR-SCOPE-DENIED cả 057 và 058 (lưới M7b)", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const listRes = await get(tDeptPlusManage, LIST_URL);
      expect(listRes.status, msg(listRes)).toBe(403);
      expect(msg(listRes)).toContain("AUTH-ERR-SCOPE-DENIED");

      const restoreRes = await post(tDeptPlusManage, restoreUrl(id));
      expect(restoreRes.status, msg(restoreRes)).toBe(403);
      expect(msg(restoreRes)).toContain("AUTH-ERR-SCOPE-DENIED");
      expect(await auditRestoreRows(id)).toHaveLength(0);

      // ALLOW đối chứng — vai `tRestoreOnly` (Company thay vì Department) ⇒ 200.
      const okList = await get(tRestoreOnly, LIST_URL, { limit: "100" });
      expect(okList.status, msg(okList)).toBe(200);
      expect((okList.body.data.data as Array<{ id: string }>).map((r) => r.id)).toContain(id);
      const allow = await post(tRestoreOnly, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D3: cross-tenant — HR công ty B khôi phục bài đã xoá của A ⇒ 404; hàng A vẫn xoá; 057 của B không chứa hàng A", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const res = await post(tHrB, restoreUrl(id));
      expect(res.status, msg(res)).toBe(404);
      expect(msg(res)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
      expect((await postRow(id)).deleted_at).not.toBeNull();

      // Neo dương: B PHẢI có ÍT NHẤT một hàng thùng rác của CHÍNH B, để "057 của B không chứa hàng A"
      // không xanh-rỗng (057 luôn trả [] nếu hỏng vẫn khớp `.not.toContain`).
      const postIdB = await createPost(tHrB, { body: "bài B" });
      await deleteAs(tHrB, postIdB);

      const listB = await get(tHrB, LIST_URL, { limit: "100" });
      expect(listB.status, msg(listB)).toBe(200);
      const ids = (listB.body.data.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(id);
      expect(ids, "neo dương — 057 của B thấy hàng CỦA B").toContain(postIdB);
      expect(listB.body.data.total).toBe(1);

      // ALLOW đối chứng — CÙNG hàng, HR ĐÚNG tenant (A) ⇒ 200.
      const allow = await post(tHr, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D4: bài CHƯA xoá ⇒ 404, 0 audit, đếm/thẻ không đổi; uuid lạ ⇒ 404; :post_id không uuid ⇒ 400", async () => {
      const id = await createPost(tAuthor, { body: "bài D4 #d4tag" });
      // Đếm/thẻ + bình luận/cảm xúc PHẢI có mặt để "không đổi" là một phép đo thật — bài trơn không thẻ,
      // không tương tác thì một lượt restore lỡ chạy trên hàng SỐNG (thiếu vế `deleted_at IS NOT NULL`)
      // cũng không đẩy con số nào lệch, và ca này xanh dù mất cả lưới.
      expect(
        (await post(tPeer, `/social/posts/${id}/comments`).send({ body: "binh luan D4" })).status,
      ).toBe(201);
      expect((await put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "like" })).status).toBe(
        200,
      );
      const before = await postRow(id);
      expect(before.status).toBe("published");
      const rowBefore = await direct.query(
        `SELECT like_count, comment_count, view_count, updated_at, updated_by FROM feed_posts WHERE id = $1`,
        [id],
      );
      const tagBefore = await tagUsage("d4tag");

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(404);
      expect(msg(res)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
      expect(await auditRestoreRows(id)).toHaveLength(0);
      expect((await postRow(id)).status).toBe("published");
      const rowAfter = await direct.query(
        `SELECT like_count, comment_count, view_count, updated_at, updated_by FROM feed_posts WHERE id = $1`,
        [id],
      );
      expect(rowAfter.rows[0]).toEqual(rowBefore.rows[0]);
      expect(await tagUsage("d4tag")).toBe(tagBefore);

      const ghost = await post(tHr, restoreUrl(randomUUID()));
      expect(ghost.status, msg(ghost)).toBe(404);
      expect(msg(ghost)).toContain(SOCIAL_ERR.POST_NOT_FOUND);

      const bad = await post(tHr, restoreUrl("khong-phai-uuid"));
      expect(bad.status, msg(bad)).toBe(400);

      // ALLOW đối chứng — CÙNG hàng, sau khi THẬT SỰ xoá ⇒ 200.
      await deleteAs(tHr, id);
      const allow = await post(tHr, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
    });

    it("D5: bài thuộc nhóm đã xoá mềm ⇒ 409 RESTORE_GROUP_DELETED; hàng vẫn xoá; usage_count không đổi; 0 audit; 057 hiện groupDeleted:true", async () => {
      const g = await direct.query(
        `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public') RETURNING id`,
        [A.companyId, `Nhóm D5 ${randomUUID().slice(0, 8)}`],
      );
      const groupId = g.rows[0].id as string;
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, 'owner', 'active', now())`,
        [A.companyId, groupId, uAuthor],
      );
      const id = await createPost(tAuthor, { audience: "group", groupId, body: "bài D5 #d5tag" });
      await deleteAs(tAuthor, id); // tự xoá — tác giả luôn thấy bài của chính mình dù audience nhóm
      const u0 = await tagUsage("d5tag"); // xoá mềm đã trừ 1 (softDeletePostTx)
      await direct.query(`UPDATE feed_groups SET deleted_at = now() WHERE id = $1`, [groupId]);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(409);
      expect(msg(res)).toContain(SOCIAL_ERR.RESTORE_GROUP_DELETED);
      expect((await postRow(id)).deleted_at).not.toBeNull();
      expect(await auditRestoreRows(id)).toHaveLength(0);
      expect(await tagUsage("d5tag"), "409 không chạm restorePostTx ⇒ usage_count không đổi").toBe(u0);

      // `057` liệt kê bằng `tHr` (`restore:feed-post@Company`) — KHÔNG bằng `tAuthor`: tác giả không có
      // cặp `restore:feed-post` nên `057` sẽ 403 Ở TẦNG 1 (PermissionGuard) trước khi chạm audience.
      const list = await get(tHr, LIST_URL, { limit: "100" });
      expect(list.status, msg(list)).toBe(200);
      const item = (list.body.data.data as RestoreListItem[]).find((r) => r.id === id);
      expect(item, "neo dương: hàng phải còn liệt kê dù nhóm đã xoá").toBeTruthy();
      expect(item!.groupDeleted).toBe(true);
      // `restoreAs`/`deletedByAuthor` KHÔNG phụ thuộc `audienceCondition` (D4/D10) ⇒ luôn có mặt, kể cả
      // khi nhóm chết che `groupId`/`author`/`bodyExcerpt` với `tHr` (không thành viên nhóm này).
      expect(item!.restoreAs).toBe("hidden");
      expect(item!.deletedByAuthor).toBe(true);

      // ALLOW đối chứng — CÙNG bài, sau khi nhóm SỐNG LẠI ⇒ 200 (409 là vì nhóm chết, không vì gì khác).
      await direct.query(`UPDATE feed_groups SET deleted_at = NULL WHERE id = $1`, [groupId]);
      const allow = await post(tHr, restoreUrl(id));
      expect(allow.status, msg(allow)).toBe(200);
      expect(await tagUsage("d5tag"), "khôi phục thành công ⇒ +1 delta").toBe(u0 + 1);
    });

    it("D6: hai lượt restore NỐI TIẾP CÙNG một bài ⇒ 200 rồi 404; ĐÚNG 1 audit", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const first = await post(tHr, restoreUrl(id));
      expect(first.status, msg(first)).toBe(200);
      const second = await post(tHr, restoreUrl(id));
      expect(second.status, msg(second)).toBe(404);
      expect(msg(second)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
      expect(await auditRestoreRows(id)).toHaveLength(1);
    });

    /**
     * 🔴 D6 đồng thời — harness TẤT ĐỊNH (FULL gate SF-L1): `Promise.all` trần có thể chạy nối đuôi và
     * xanh cả khi mất `FOR UPDATE` ở `lockDeletedForRestoreTx`. Ở đây CẢ HAI lượt được xác nhận ĐANG CHỜ
     * khoá hàng trước khi nhả ⇒ hai lượt thật sự chồng lấp; lượt thua phải đánh giá lại
     * `deleted_at IS NOT NULL` trên phiên bản mới ⇒ 404, không phải 500 «khớp 0» hay 200 thứ hai.
     */
    it("D6: hai lượt restore ĐỒNG THỜI (cả hai xác nhận đang chờ khoá) CÙNG một bài ⇒ đúng một 200 + một 404; ĐÚNG 1 audit", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);

      const hold = await holdPostLock(id);
      let released = false;
      try {
        const p1 = launch(post(tHr, restoreUrl(id)));
        expect(await waitForLockWaiters(hold.pid, 1), "lượt 1 phải CHỜ khoá bài").toBe(true);
        const p2 = launch(post(tHr, restoreUrl(id)));
        expect(
          await waitForLockWaiters(hold.pid, 2),
          "lượt 2 phải CHỜ khoá bài — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);

        await hold.client.query("ROLLBACK");
        released = true;
        const [r1, r2] = await Promise.all([p1, p2]);
        const statuses = [r1.status, r2.status].sort((a, b) => a - b);
        expect(statuses, JSON.stringify({ r1: r1.body, r2: r2.body })).toEqual([200, 404]);
        const loser = r1.status === 404 ? r1 : r2;
        expect(msg(loser)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
      } finally {
        if (!released) await hold.client.query("ROLLBACK");
        hold.client.release();
      }
      expect(await auditRestoreRows(id)).toHaveLength(1);
    });

    /**
     * 🔴 D7 — route SỬA bài `004` đua với XOÁ (FULL gate DB-M1). `assertPostVisible` đọc KHÔNG khoá, rồi
     * UPDATE `body` chỉ lọc `id`+`company_id` ⇒ nếu lượt xoá commit giữa hai bước, lượt sửa vẫn ghi lên
     * bài ĐÃ XOÁ và `syncPostTags` chỉnh `usage_count` lần nữa (thẻ cũ −1 lần hai, thẻ mới +1 trên bài
     * chết). `058` cộng lại +1 cho MỌI thẻ đang gắn ⇒ lệch VĨNH VIỄN. Trình tự ép: khoá hàng → lượt xoá
     * chờ → lượt sửa (đã qua cổng đọc) chờ SAU lượt xoá → nhả ⇒ xoá thắng, sửa phải 404 và không đụng thẻ.
     */
    it("D7: sửa bài (004) đua với xoá ⇒ lượt sửa 404 POST_NOT_FOUND; body + usage_count thẻ không lệch; khôi phục trả đúng số thẻ", async () => {
      const id = await createPost(tAuthor, { body: "bài đua #d7cu" });
      const cu0 = await tagUsage("d7cu");
      const moi0 = await tagUsage("d7moi");

      const hold = await holdPostLock(id);
      let released = false;
      try {
        const pDel = launch(del(tHr, `/social/posts/${id}`));
        expect(await waitForLockWaiters(hold.pid, 1), "lượt XOÁ phải CHỜ khoá bài").toBe(true);
        const pEdit = launch(patch(tAuthor, `/social/posts/${id}`).send({ body: "đã sửa #d7moi" }));
        expect(
          await waitForLockWaiters(hold.pid, 2),
          "lượt SỬA phải CHỜ (sau lượt xoá) — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);

        await hold.client.query("ROLLBACK");
        released = true;
        const [rDel, rEdit] = await Promise.all([pDel, pEdit]);
        expect(rDel.status, msg(rDel)).toBe(200);
        expect(rEdit.status, msg(rEdit)).toBe(404);
        expect(msg(rEdit)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
      } finally {
        if (!released) await hold.client.query("ROLLBACK");
        hold.client.release();
      }

      const body = await direct.query(`SELECT body, edited_at FROM feed_posts WHERE id = $1`, [id]);
      expect(body.rows[0].body, "lượt sửa KHÔNG được ghi lên bài đã xoá").toBe("bài đua #d7cu");
      expect(body.rows[0].edited_at).toBeNull();
      expect(await tagUsage("d7cu"), "xoá −1 đúng MỘT lần").toBe(cu0 - 1);
      expect(await tagUsage("d7moi"), "thẻ của lượt sửa bị từ chối không được +1").toBe(moi0);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(await tagUsage("d7cu"), "khôi phục trả về đúng số trước khi xoá").toBe(cu0);
      expect(await tagUsage("d7moi")).toBe(moi0);
    });
  });

  // ══════════════════════════════ A — allow / đúng hành vi ══════════════════════════════

  describe("A — allow-path", () => {
    it("A1: HR xoá bài published của người khác (thẻ+bình luận+cảm xúc+lượt xem) → 058 ⇒ 200 published; đếm/thẻ đúng; status_before_delete NULL; updated_by=HR; 1 audit đủ trường", async () => {
      const id = await createPost(tAuthor, { body: "bài A1 #thera1" });
      expect(
        (await post(tPeer, `/social/posts/${id}/comments`).send({ body: "binh luan" })).status,
      ).toBe(201);
      expect(
        (await put(tPeer, `/social/posts/${id}/reaction`).send({ emoji: "like" })).status,
      ).toBe(200);
      expect((await post(tPeer, `/social/posts/${id}/view`)).status).toBe(201);
      const tagBefore = await tagUsage("thera1");

      await deleteAs(tHr, id); // deletedBy = HR ≠ author
      const afterDelete = await postRow(id);
      expect(afterDelete.status_before_delete, "softDeletePostTx ghi status cũ (A8)").toBe(
        "published",
      );
      expect(await tagUsage("thera1"), "xoá mềm hạ usage_count").toBe(tagBefore - 1);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data).toEqual({ id, status: "published" });

      const row = await postRow(id);
      expect(row.status).toBe("published");
      expect(row.deleted_at).toBeNull();
      expect(row.status_before_delete).toBeNull();
      expect(row.updated_by).toBe(uHr);

      const seen = await get(tAuthor, `/social/posts/${id}`);
      expect(seen.status, msg(seen)).toBe(200);
      expect(seen.body.data.commentCount).toBe(1);
      expect(seen.body.data.likeCount).toBe(1);
      expect(seen.body.data.viewCount).toBe(1);
      expect(await tagUsage("thera1"), "khôi phục trả lại usage_count").toBe(tagBefore);

      // "bài hiện ở feed" phải chứng minh được bằng một actor KHÔNG PHẢI tác giả — tác giả luôn thấy bài
      // của chính mình (kể cả khi nó `hidden`), nên chỉ dùng `tAuthor` không loại được ca "vẫn `deleted`".
      const seenByOther = await get(tEmployee, `/social/posts/${id}`);
      expect(seenByOther.status, msg(seenByOther)).toBe(200);

      const audit = await auditRestoreRows(id);
      expect(audit).toHaveLength(1);
      const a = audit[0];
      expect(a.object_type).toBe("feed_post");
      expect(a.module_code).toBe("SOCIAL");
      expect(a.entity_type).toBe("feed_post");
      expect(a.object_id).toBe(id);
      expect(a.entity_id).toBe(id);
      expect(a.actor_user_id).toBe(uHr);
      expect(a.result_status).toBe("Success");
      expect(a.metadata).toMatchObject({
        postId: id,
        authorUserId: uAuthor,
        restoredStatus: "published",
        statusBeforeDelete: "published",
        deletedByAuthor: false,
      });
      // KHÔNG nội dung bài trong metadata audit (API-19 §8).
      expect(JSON.stringify(a.metadata)).not.toContain("bài A1");
    });

    it("A1: company-admin cũng khôi phục được (200)", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id);
      const res = await post(tAdmin, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("published");
    });

    it("A2 (O2): HR ẩn (006) → HR xoá (005, bài người khác) → 058 ⇒ hidden; tác giả thấy, nhân viên khác 404", async () => {
      const id = await createPost(tAuthor);
      await hideAs(tHr, id);
      await deleteAs(tHr, id);
      expect((await postRow(id)).status_before_delete).toBe("hidden");

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("hidden");

      const asAuthor = await get(tAuthor, `/social/posts/${id}`);
      expect(asAuthor.status, msg(asAuthor)).toBe(200);
      const asEmployee = await get(tEmployee, `/social/posts/${id}`);
      expect(asEmployee.status).toBe(404);
      expect(msg(asEmployee)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
    });

    it("A2b (O4): tác giả TỰ xoá bài published → 058 ⇒ hidden; 057 trước đó restoreAs:hidden + deletedByAuthor:true; audit deletedByAuthor:true", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tAuthor, id); // tự xoá — deletedBy = uAuthor = author
      expect((await postRow(id)).status_before_delete).toBe("published");

      const list = await get(tHr, LIST_URL, { limit: "100" });
      const item = (list.body.data.data as RestoreListItem[]).find((r) => r.id === id);
      expect(item, "neo dương").toBeTruthy();
      expect(item!.restoreAs).toBe("hidden");
      expect(item!.deletedByAuthor).toBe(true);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("hidden");

      const audit = await auditRestoreRows(id);
      expect(audit[0].metadata).toMatchObject({ deletedByAuthor: true, restoredStatus: "hidden" });
    });

    it("A2c (O4, NULL): bài moderator xoá rồi deleted_by bị đặt NULL (mô phỏng FK SET NULL) ⇒ 058 ⇒ hidden", async () => {
      const id = await createPost(tAuthor);
      await deleteAs(tHr, id); // deletedBy = HR ≠ author ⇒ status_before_delete='published'
      await direct.query(`UPDATE feed_posts SET deleted_by = NULL WHERE id = $1`, [id]);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      // `deleted_by IS NULL` KHÔNG chứng minh được là moderator xoá ⇒ fail-closed 'hidden' (D4-ii).
      expect(res.body.data.status).toBe("hidden");
    });

    it("A3: 029 delete_target trên bài đã hidden → 058 ⇒ hidden", async () => {
      const id = await createPost(tAuthor);
      const reportRes = await post(tPeer, "/social/reports").send({
        targetType: "post",
        targetId: id,
        reason: "spam",
      });
      expect(reportRes.status, msg(reportRes)).toBe(201);
      const reportId = reportRes.body.data.id as string;

      await hideAs(tHr, id);
      const resolveRes = await patch(tHr, `/social/reports/${reportId}`).send({
        status: "resolved",
        action: "delete_target",
      });
      expect(resolveRes.status, msg(resolveRes)).toBe(200);
      expect((await postRow(id)).status_before_delete).toBe("hidden");

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("hidden");
    });

    it("A4: legacy — xoá mềm bằng SQL tay (deleted_by=HR, status_before_delete NULL, KHÔNG thẻ) ⇒ restoreAs:hidden; 058 ⇒ hidden; audit statusBeforeDelete:null", async () => {
      // Luật fixture (D5 của plan): bài xoá TAY không được gắn thẻ — delta +1 lúc khôi phục sẽ lệch
      // usage_count vì lượt xoá tay không đi qua softDeletePostTx (không -1). `createPost` mặc định
      // không có hashtag trong body.
      const id = await createPost(tAuthor);
      await direct.query(
        `UPDATE feed_posts SET deleted_at = now(), status = 'deleted', deleted_by = $2 WHERE id = $1`,
        [id, uHr],
      );

      const list = await get(tHr, LIST_URL, { limit: "100" });
      const item = (list.body.data.data as RestoreListItem[]).find((r) => r.id === id);
      expect(item, "neo dương").toBeTruthy();
      expect(item!.statusBeforeDelete).toBeNull();
      expect(item!.restoreAs).toBe("hidden");

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("hidden");
      const audit = await auditRestoreRows(id);
      expect(audit[0].metadata).toMatchObject({ statusBeforeDelete: null });
    });

    it("A5: mention + kudos KHÔNG phát lại NOTI/outbox khi khôi phục", async () => {
      const mentionPost = await createPost(tHr, { mentionedUserIds: [uPeer] });
      expect(await outboxCount("social.mentioned", mentionPost, "targetId")).toBe(1);
      const notiBefore = await notificationsCount(uPeer);

      await deleteAs(tHr, mentionPost);
      const beforeRestore = await outboxCount("social.mentioned", mentionPost, "targetId");
      const anyBefore = await outboxCountAny(mentionPost);
      // Mốc dương (FULL gate SF-L2): phép `LIKE` hỏng ⇒ 0 === 0 xanh-rỗng. Event `social.mentioned` ở trên
      // mang postId ⇒ phép đếm «mọi event» PHẢI thấy nó.
      expect(anyBefore, "neo dương: outboxCountAny phải thấy social.mentioned").toBeGreaterThanOrEqual(1);
      const res1 = await post(tHr, restoreUrl(mentionPost));
      expect(res1.status, msg(res1)).toBe(200);
      expect(await outboxCount("social.mentioned", mentionPost, "targetId")).toBe(beforeRestore);
      // D14 "không tác dụng phụ" — MỌI event nhắc postId, không chỉ hai loại đã biết, và `notifications`
      // của người liên quan giữ nguyên (khôi phục không phải một lượt tạo bài mới).
      expect(await outboxCountAny(mentionPost)).toBe(anyBefore);
      expect(await notificationsCount(uPeer)).toBe(notiBefore);

      const kudosRes = await post(tHr, "/social/posts").send({
        type: "kudos",
        audience: "company",
        body: "cam on ban",
        kudos: { recipientEmployeeIds: [ePeer], message: "tuyet voi" },
      });
      expect(kudosRes.status, msg(kudosRes)).toBe(201);
      const kudosPost = kudosRes.body.data.id as string;
      expect(await outboxCount("social.kudos_received", kudosPost, "post_id")).toBe(1);

      await deleteAs(tHr, kudosPost);
      const anyBeforeKudos = await outboxCountAny(kudosPost);
      expect(anyBeforeKudos, "neo dương: outboxCountAny phải thấy social.kudos_received").toBeGreaterThanOrEqual(1);
      const res2 = await post(tHr, restoreUrl(kudosPost));
      expect(res2.status, msg(res2)).toBe(200);
      expect(await outboxCount("social.kudos_received", kudosPost, "post_id")).toBe(1);
      expect(await outboxCountAny(kudosPost)).toBe(anyBeforeKudos);
    });

    it("A7: bài poll xoá → khôi phục ⇒ option + vote_count nguyên; bài news ghim ⇒ vẫn ghim sau khôi phục", async () => {
      const pollRes = await post(tHr, "/social/posts").send({
        type: "poll",
        audience: "company",
        body: "chon mon an trua",
        poll: { question: "Ăn gì?", options: ["A", "B"] },
      });
      expect(pollRes.status, msg(pollRes)).toBe(201);
      const pollPostId = pollRes.body.data.id as string;
      const optionIds = await pollOptionIds(pollPostId);
      expect(
        (
          await put(tPeer, `/social/posts/${pollPostId}/poll/vote`).send({
            optionIds: [optionIds[0]],
          })
        ).status,
      ).toBe(200);
      const beforeTotals = await pollTotals(pollPostId);
      expect(beforeTotals.sumVotes).toBe(1);
      const beforeOptions = await pollOptionVoteCounts(pollPostId);

      await deleteAs(tHr, pollPostId);
      const pollRestore = await post(tHr, restoreUrl(pollPostId));
      expect(pollRestore.status, msg(pollRestore)).toBe(200);
      expect(await pollTotals(pollPostId)).toEqual(beforeTotals);
      // Σ nguyên KHÔNG đủ — so TỪNG option (id + position + vote_count) để bắt phiếu dồn sai option.
      expect(await pollOptionVoteCounts(pollPostId)).toEqual(beforeOptions);

      const newsRes = await post(tHr, "/social/posts").send({
        type: "news",
        audience: "company",
        body: "tin quan trong",
      });
      expect(newsRes.status, msg(newsRes)).toBe(201);
      const newsId = newsRes.body.data.id as string;
      expect(
        (await patch(tHr, `/social/posts/${newsId}/moderation`).send({ pinned: true })).status,
      ).toBe(200);
      await deleteAs(tHr, newsId);
      const newsRestore = await post(tHr, restoreUrl(newsId));
      expect(newsRestore.status, msg(newsRestore)).toBe(200);
      expect((await postRow(newsId)).pinned).toBe(true);
    });

    /**
     * A7b (tuỳ chọn, plan §3) — job đóng poll quá hạn (`SocialPollCloseExpiredJobHandler`) BỎ QUA bài
     * trong thùng rác (`deleted_at IS NULL` filter, D14), rồi ĐÓNG nó ở nhịp SAU khi bài đã khôi phục —
     * kể cả khi bài khôi phục về `hidden` (D4/O4). NOTI-035 vẫn phát cho tác giả.
     */
    it("A7b: poll quá hạn bị khôi phục thành hidden → job đóng poll BỎ QUA lúc còn trong thùng rác, ĐÓNG sau khi khôi phục + 1 NOTI-035", async () => {
      const pollRes = await post(tHr, "/social/posts").send({
        type: "poll",
        audience: "company",
        body: "binh chon het han",
        poll: {
          question: "Còn kịp không?",
          options: ["A", "B"],
          closesAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      expect(pollRes.status, msg(pollRes)).toBe(201);
      const pollPostId = pollRes.body.data.id as string;

      await direct.query(
        `UPDATE feed_polls SET created_at = now() - interval '2 hours', closes_at = now() - interval '1 minute'
          WHERE company_id = $1 AND post_id = $2`,
        [A.companyId, pollPostId],
      );

      await deleteAs(tHr, pollPostId); // tHr là tác giả ⇒ tự xoá ⇒ O4 ⇒ khôi phục sẽ về hidden

      const job = app.get(SocialPollCloseExpiredJobHandler);
      await job.run({ companyId: A.companyId });
      expect(await pollStatus(pollPostId), "job bỏ qua bài đang trong thùng rác").toBe("open");

      const res = await post(tHr, restoreUrl(pollPostId));
      expect(res.status, msg(res)).toBe(200);
      expect(res.body.data.status).toBe("hidden");

      await job.run({ companyId: A.companyId });
      expect(await pollStatus(pollPostId)).toBe("closed");
      const noti = await outboxCount("social.poll_closed", pollPostId, "post_id");
      expect(noti, "NOTI-035 vẫn phát kể cả bài hidden (D14)").toBe(1);
    });

    it("A8: CHECK status_before_delete — hàng SỐNG mang giá trị ⇒ 23514 (_dead); giá trị 'deleted' ⇒ 23514 (IN); giá trị hợp lệ trên hàng chết ⇒ PASS", async () => {
      // Hàng SỐNG (`deleted_at IS NULL`): 'published' THOẢ vế IN nhưng VỠ vế `_dead` (không được mang
      // giá trị khi còn sống) ⇒ constraint `_dead` nổ, KHÔNG phải constraint IN.
      const aliveId = await createPost(tAuthor);
      await expectCheckViolation(
        direct.query(`UPDATE feed_posts SET status_before_delete = 'published' WHERE id = $1`, [
          aliveId,
        ]),
        "chk_feed_posts_status_before_delete_dead",
      );

      // Hàng ĐÃ XOÁ: 'deleted' VỠ vế IN ('published','hidden') nhưng THOẢ `_dead` (deleted_at NOT NULL)
      // ⇒ constraint IN nổ, KHÔNG phải `_dead`.
      const deadId = await createPost(tAuthor);
      await deleteAs(tHr, deadId);
      await expectCheckViolation(
        direct.query(`UPDATE feed_posts SET status_before_delete = 'deleted' WHERE id = $1`, [
          deadId,
        ]),
        "chk_feed_posts_status_before_delete",
      );

      // ĐỐI CHỨNG: giá trị hợp lệ ('hidden') trên hàng ĐÃ XOÁ thoả CẢ HAI CHECK ⇒ UPDATE thành công —
      // hai lượt trên không phải vì CHECK từ chối MỌI giá trị.
      const allow = await direct.query(
        `UPDATE feed_posts SET status_before_delete = 'hidden' WHERE id = $1`,
        [deadId],
      );
      expect(allow.rowCount).toBe(1);
    });

    it("A10: route employee cũ không đổi — GET .../employees + POST .../employees/:id/restore vẫn 200 (khói)", async () => {
      const actor = await makeActor(A, "empadmin", [
        { action: "read", resource: "employee" },
        { action: "view", resource: "user" },
        { action: "restore", resource: "employee", sensitive: true },
      ]);
      const target = await makeActor(A, "empgone", []);
      await direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE user_id = $1`, [
        target.userId,
      ]);

      const list = await get(actor.token, "/recycle-bin/employees");
      expect(list.status, msg(list)).toBe(200);

      const restoreRes = await post(
        actor.token,
        `/recycle-bin/employees/${target.employeeId}/restore`,
      );
      expect(restoreRes.status, msg(restoreRes)).toBe(200);
    });

    it("A11: tác giả đã nghỉ (users.deleted_at + hồ sơ xoá mềm) ⇒ 058 200, KHÔNG chặn; org_unit đã xoá ⇒ 200", async () => {
      const leaver = await makeActor(A, "leaver", [
        { action: "view", resource: "feed" },
        { action: "create", resource: "feed-post" },
      ]);
      const id = await createPost(leaver.token);
      await deleteAs(tHr, id);
      await direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [leaver.userId]);
      await direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE user_id = $1`, [
        leaver.userId,
      ]);

      const res = await post(tHr, restoreUrl(id));
      expect(res.status, msg(res)).toBe(200);
      // HR khôi phục bài của người khác (leaver không phải tác giả tự xoá) ⇒ status đã nhớ (`published`,
      // D4-iii) — ghim luật D4 trên nhánh này, không chỉ status HTTP.
      expect(res.body.data.status).toBe("published");

      const unit = await direct.query(
        `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `Đơn vị sẽ xoá ${randomUUID().slice(0, 8)}`],
      );
      const orgUnitId = unit.rows[0].id as string;
      const authorInUnit = await makeActor(
        A,
        "unitauthor",
        [
          { action: "view", resource: "feed" },
          { action: "create", resource: "feed-post" },
        ],
        orgUnitId,
      );
      const id2 = await createPost(authorInUnit.token, { audience: "org_unit", orgUnitId });
      await deleteAs(authorInUnit.token, id2); // tự xoá — tác giả thấy bài của chính mình
      await direct.query(`UPDATE org_units SET deleted_at = now() WHERE id = $1`, [orgUnitId]);

      const res2 = await post(tHr, restoreUrl(id2));
      expect(res2.status, msg(res2)).toBe(200);
      // Tác giả TỰ xoá bài org_unit ⇒ `hidden` (O4), bất kể đơn vị đã xoá — hai nhánh D4 khác nhau
      // trong CÙNG ca, phải ghim CẢ HAI.
      expect(res2.body.data.status).toBe("hidden");
    });
  });
});
