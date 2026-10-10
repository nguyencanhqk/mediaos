/**
 * S16-SOCIAL-BE-3A — `SOCIAL-API-029` resolve báo cáo KÈM HÀNH ĐỘNG. 🔴 Crown-jewel (FULL gate).
 *
 * Plan `docs/plans/S16-SOCIAL-BE-3A.md` §3: deny-path R1–R9 (RED trước) + allow-path.
 *
 * ┌─ MỌI CA ĐUA ĐI QUA HARNESS TẤT ĐỊNH, KHÔNG `Promise.all` RỒI CẦU MAY ─────────────────────────┐
 * │ Một client `direct` giữ khoá HÀNG (bài / báo cáo) trong tx mở; request HTTP được phóng rồi ta  │
 * │ POLL `pg_stat_activity` tới khi thấy nó ĐANG CHỜ khoá (`wait_event_type='Lock'`) — có trần thời │
 * │ gian, hết trần ⇒ ĐỎ rõ ràng («không chồng lấp được»), KHÔNG coi là xanh. Chỉ sau đó mới nhả     │
 * │ khoá. Không bước chờ đó thì hai request có thể chạy nối đuôi và ca đua xanh-rỗng.              │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `app.listen(0)` sau `init()` — supertest tự listen/close server khi app chưa listen, và request về
 * trước sẽ đóng server khi request anh em còn bay (memory `supertest-closes-shared-server-…`).
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
import { waitForBlockedBy } from "../helpers/lock-wait";
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
const LOGIN_PW = "Passw0rd!socialbe3a";

/** Trần chờ một request vào trạng thái chờ khoá — PHẢI < `lock_timeout` 5s của `029`. */
const WAIT_LOCK_MS = 3_000;

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news"
  | "view:feed-report"
  | "manage:feed-report";

const BASE: PairKey[] = ["view:feed", "create:feed-post", "create:feed-comment"];
/** Vai TUỲ BIẾN: xử lý báo cáo được nhưng KHÔNG kiểm duyệt bài (R1). */
const MOD_ONLY: PairKey[] = [...BASE, "view:feed-report", "manage:feed-report"];
/** Mirror vai `hr` canonical (seed `0578`): báo cáo + kiểm duyệt bài + tin tức. */
const HR: PairKey[] = [...MOD_ONLY, "manage:feed-post", "manage:feed-news"];

type Action = "none" | "hide_post" | "lock_comments" | "delete_target";

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-3A 029 resolve kèm hành động (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tHr = "";
  let uHr = "";
  let tModOnly = "";
  let tAuthor = "";
  let uAuthor = "";
  /** Ba người báo cáo khác nhau — `feed_reports_open_uq` khoá theo (đích, người báo cáo). */
  const reporters: string[] = [];
  const reporterIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const put = (t: string, u: string) => auth(t)(http().put(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));
  const del = (t: string, u: string) => auth(t)(http().delete(u));

  const msg = (res: request.Response): string =>
    String(res.body?.error?.message ?? res.body?.message ?? JSON.stringify(res.body));

  async function grantPairs(userId: string, label: string, pairs: readonly PairKey[]) {
    const roleId = await seedRole(direct, A.companyId, `sb3a-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function makeMember(
    label: string,
    pairs: readonly PairKey[],
    hash: string,
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grantPairs(userId, label, pairs);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId };
  }

  async function newPost(token = tAuthor, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await post(token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: `Bài ${randomUUID().slice(0, 8)}`,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function newComment(postId: string, token = tAuthor): Promise<string> {
    const res = await post(token, `/social/posts/${postId}/comments`).send({ body: "Bình luận" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function fileReport(
    targetType: "post" | "comment",
    targetId: string,
    reporterIdx = 0,
  ): Promise<string> {
    const res = await post(reporters[reporterIdx], "/social/reports").send({
      targetType,
      targetId,
      reason: "spam",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  const resolve = (token: string, reportId: string, body: Record<string, unknown>) =>
    patch(token, `/social/reports/${reportId}`).send(body);

  async function reportRow(id: string) {
    const r = await direct.query(
      `SELECT status, resolved_by, resolution_note FROM feed_reports WHERE id = $1`,
      [id],
    );
    return r.rows[0] as {
      status: string;
      resolved_by: string | null;
      resolution_note: string | null;
    };
  }

  async function postRow(id: string) {
    const r = await direct.query(
      `SELECT status, comments_locked, deleted_at, comment_count FROM feed_posts WHERE id = $1`,
      [id],
    );
    return r.rows[0] as {
      status: string;
      comments_locked: boolean;
      deleted_at: Date | null;
      comment_count: number;
    };
  }

  async function auditRows(objectId: string) {
    const r = await direct.query(
      `SELECT action, metadata FROM audit_logs WHERE object_id = $1 ORDER BY created_at, id`,
      [objectId],
    );
    return r.rows as { action: string; metadata: Record<string, unknown> }[];
  }

  /**
   * Poll tới khi có ≥ `n` backend bị CHÍNH `holderPid` chặn (trực tiếp hoặc bắc cầu — `pg_blocking_pids`,
   * helper `lock-wait.ts`). Hết trần ⇒ `false` — caller PHẢI fail rõ ràng. KHÔNG khớp chữ `%feed_%`:
   * waiter của spec khác chạy song song thoả được vị từ đó (S16-SOCIAL-GROUPTOCTOU-1 §2 M20/M25).
   */
  async function waitForLockWaiters(holderPid: number, n: number): Promise<boolean> {
    return waitForBlockedBy(direct, holderPid, n, { timeoutMs: WAIT_LOCK_MS });
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb3arep");
    companyIds.push(A.companyId);

    const hr = await makeMember("hr", HR, hash);
    tHr = hr.token;
    uHr = hr.userId;
    tModOnly = (await makeMember("modonly", MOD_ONLY, hash)).token;
    const author = await makeMember("author", BASE, hash);
    tAuthor = author.token;
    uAuthor = author.userId;
    for (let i = 0; i < 3; i += 1) {
      const m = await makeMember(`rep${i}`, BASE, hash);
      reporters.push(m.token);
      reporterIds.push(m.userId);
    }
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ DENY-PATH (RED trước) ══════════════

  describe("deny-path", () => {
    /**
     * 🔴 R1 — `manage:feed-report` MỘT MÌNH không mở cửa ẩn/khoá/xoá bài. Cặp của hành động
     * (`SOCIAL_REPORT_ACTION_PAIRS`) phải được kiểm THÊM. Ca allow đối chứng: cùng actor, `none` ⇒ 200.
     */
    it.each<Action>(["hide_post", "lock_comments", "delete_target"])(
      "R1: vai CHỈ manage:feed-report + %s ⇒ 403 REPORT_ACTION_DENIED, báo cáo open, bài nguyên, 0 audit",
      async (action) => {
        const p = await newPost();
        const r = await fileReport("post", p);

        const res = await resolve(tModOnly, r, { status: "resolved", action });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(msg(res)).toBe(SOCIAL_ERR.REPORT_ACTION_DENIED);
        expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.REPORT_ACTION_DENIED);

        expect((await reportRow(r)).status).toBe("open");
        const pr = await postRow(p);
        expect(pr.status).toBe("published");
        expect(pr.comments_locked).toBe(false);
        expect(pr.deleted_at).toBeNull();
        expect(await auditRows(r)).toHaveLength(0);
        expect(await auditRows(p)).toHaveLength(0);
      },
    );

    it("R1 ALLOW đối chứng: cùng vai + action none ⇒ 200 resolved", async () => {
      const r = await fileReport("post", await newPost());
      const res = await resolve(tModOnly, r, { status: "resolved", action: "none" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("resolved");
    });

    it.each<Action>(["delete_target", "hide_post"])(
      "R2: %s trên bài ĐÃ xoá ⇒ 422 TARGET_UNAVAILABLE, báo cáo vẫn open",
      async (action) => {
        const p = await newPost();
        const r = await fileReport("post", p);
        expect((await del(tAuthor, `/social/posts/${p}`)).status).toBe(200);

        const res = await resolve(tHr, r, { status: "resolved", action });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(msg(res)).toBe(SOCIAL_ERR.REPORT_ACTION_TARGET_UNAVAILABLE);
        expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.REPORT_ACTION_TARGET_UNAVAILABLE);
        expect((await reportRow(r)).status).toBe("open");
        expect(await auditRows(r)).toHaveLength(0);

        // Kết thúc được bằng `none` — lối thoát mà thông điệp lỗi hứa.
        const ok = await resolve(tHr, r, { status: "resolved", action: "none" });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      },
    );

    it("R3: dismissed + action ≠ none ⇒ 400, báo cáo vẫn open", async () => {
      const r = await fileReport("post", await newPost());
      const res = await resolve(tHr, r, { status: "dismissed", action: "hide_post" });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect((await reportRow(r)).status).toBe("open");
    });

    it("R4: báo cáo BÌNH LUẬN + hide_post ⇒ 422 INVALID_FOR_TARGET, báo cáo open, bài nguyên", async () => {
      const p = await newPost();
      const c = await newComment(p);
      const r = await fileReport("comment", c);

      const res = await resolve(tHr, r, { status: "resolved", action: "hide_post" });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(msg(res)).toBe(SOCIAL_ERR.REPORT_ACTION_INVALID_FOR_TARGET);
      expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.REPORT_ACTION_INVALID_FOR_TARGET);
      expect((await reportRow(r)).status).toBe("open");
      expect((await postRow(p)).status).toBe("published");
    });

    /**
     * R5 — nợ D14 (owner chấp nhận): bài nhóm RIÊNG TƯ, người kiểm duyệt không phải thành viên ⇒
     * hành động kèm 422 (cổng đọc thường không thấy bài); vẫn kết thúc được bằng `none`.
     */
    it("R5: bài nhóm riêng tư, HR KHÔNG là thành viên + hide_post ⇒ 422; none ⇒ 200", async () => {
      const g = await direct.query(
        `INSERT INTO feed_groups (company_id, name, visibility, member_count)
         VALUES ($1, $2, 'private', 2) RETURNING id`,
        [A.companyId, `Kín ${randomUUID().slice(0, 8)}`],
      );
      const groupId = g.rows[0].id as string;
      for (const [userId, role] of [
        [uAuthor, "owner"],
        [reporterIds[0], "member"],
      ] as const) {
        await direct.query(
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
           VALUES ($1, $2, $3, $4, 'active', now())`,
          [A.companyId, groupId, userId, role],
        );
      }
      const p = await newPost(tAuthor, { audience: "group", groupId });
      const r = await fileReport("post", p, 0);

      const res = await resolve(tHr, r, { status: "resolved", action: "hide_post" });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(msg(res)).toBe(SOCIAL_ERR.REPORT_ACTION_TARGET_UNAVAILABLE);
      expect((await postRow(p)).status).toBe("published");
      expect((await reportRow(r)).status).toBe("open");

      const ok = await resolve(tHr, r, { status: "resolved", action: "none" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });

    /**
     * 🔴 R6 — hai lượt xử lý CÙNG báo cáo đua nhau. A bị giữ SAU câu ghi báo cáo (khoá bài giữ bởi
     * `direct` chặn hành động của A); B phải được xác nhận ĐANG CHỜ khoá báo cáo; A xong ⇒ B 409.
     */
    it("R6: hai lượt resolve CÙNG báo cáo đồng thời ⇒ 200 + 409 ERR-021, đúng 1 audit hành động + 1 audit báo cáo", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      const hold = await holdPostLock(p);
      let released = false;
      try {
        const pA = launch(resolve(tHr, r, { status: "resolved", action: "hide_post" }));
        expect(await waitForLockWaiters(hold.pid, 1), "A phải CHỜ khoá bài").toBe(true);
        const pB = launch(resolve(tHr, r, { status: "resolved", action: "hide_post" }));
        expect(
          await waitForLockWaiters(hold.pid, 2),
          "B phải CHỜ khoá báo cáo — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);

        await hold.client.query("ROLLBACK");
        released = true;
        const [ra, rb] = await Promise.all([pA, pB]);
        expect(ra.status, JSON.stringify(ra.body)).toBe(200);
        expect(rb.status, JSON.stringify(rb.body)).toBe(409);
        expect(msg(rb)).toBe(SOCIAL_ERR.REPORT_ALREADY_DECIDED);
        expect(rb.body.error?.code).toBe(SOCIAL_ERROR_CODES.REPORT_ALREADY_DECIDED);
      } finally {
        if (!released) await hold.client.query("ROLLBACK");
        hold.client.release();
      }

      expect((await auditRows(p)).map((a) => a.action)).toEqual(["social.post.moderation.hidden"]);
      expect((await auditRows(r)).map((a) => a.action)).toEqual(["social.report.resolved"]);
    });

    /**
     * 🔴 R7 — hai báo cáo KHÁC nhau cùng bài, cả hai `delete_target` đồng thời. Khoá thứ tự D8 ⇒ không
     * chu trình (không `40P01`); lượt sau thấy báo cáo của mình đã được auto-resolve (D9) ⇒ 409.
     */
    it("R7: hai báo cáo khác nhau cùng bài, cả hai delete_target đồng thời ⇒ một 200 + một 409, 1 audit xoá, không 500", async () => {
      const p = await newPost();
      const r1 = await fileReport("post", p, 0);
      const r2 = await fileReport("post", p, 1);
      const hold = await holdPostLock(p);
      let released = false;
      try {
        const pA = launch(resolve(tHr, r1, { status: "resolved", action: "delete_target" }));
        expect(await waitForLockWaiters(hold.pid, 1), "A phải CHỜ khoá bài").toBe(true);
        const pB = launch(resolve(tHr, r2, { status: "resolved", action: "delete_target" }));
        expect(
          await waitForLockWaiters(hold.pid, 2),
          "B phải CHỜ khoá báo cáo — không chồng lấp ⇒ ĐỎ",
        ).toBe(true);

        await hold.client.query("ROLLBACK");
        released = true;
        const results = await Promise.all([pA, pB]);
        const statuses = results.map((x) => x.status).sort();
        expect(statuses, JSON.stringify(results.map((x) => x.body))).toEqual([200, 409]);
        const loser = results.find((x) => x.status === 409)!;
        expect(msg(loser)).toBe(SOCIAL_ERR.REPORT_ALREADY_DECIDED);
      } finally {
        if (!released) await hold.client.query("ROLLBACK");
        hold.client.release();
      }

      const deletes = (await auditRows(p)).filter((a) => a.action === "social.post.delete");
      expect(deletes).toHaveLength(1);
      expect((await reportRow(r1)).status).toBe("resolved");
      expect((await reportRow(r2)).status).toBe("resolved");
    });

    /**
     * 🔴 R8 — race sẵn có D6a: `hide_post` đua với xoá bài. Không vá thì UPDATE của kiểm duyệt ghi
     * `status='hidden'` lên một hàng đã `deleted_at` ⇒ bài «ẩn» mà đã xoá.
     */
    it("R8: hide_post đua với xoá bài ⇒ 422, bài KHÔNG thành hidden với deleted_at ≠ NULL", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);

      const client = await direct.connect();
      let done = false;
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE feed_posts SET deleted_at = now(), status = 'deleted' WHERE id = $1`,
          [p],
        );
        const pid = (await client.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
        const pr = launch(resolve(tHr, r, { status: "resolved", action: "hide_post" }));
        expect(await waitForLockWaiters(pid, 1), "hide_post phải CHỜ khoá bài").toBe(true);
        await client.query("COMMIT");
        done = true;

        const res = await pr;
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(msg(res)).toBe(SOCIAL_ERR.REPORT_ACTION_TARGET_UNAVAILABLE);
      } finally {
        if (!done) await client.query("ROLLBACK");
        client.release();
      }

      const row = await postRow(p);
      expect(row.deleted_at).not.toBeNull();
      expect(row.status).toBe("deleted");
      expect((await reportRow(r)).status).toBe("open");
    });

    it("R9: khoá đích bị giữ quá lock_timeout ⇒ 409 REPORT_BUSY, báo cáo vẫn open", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      const hold = await holdPostLock(p);
      try {
        const res = await resolve(tHr, r, { status: "resolved", action: "hide_post" });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(msg(res)).toBe(SOCIAL_ERR.REPORT_BUSY);
        expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.REPORT_BUSY);
      } finally {
        await hold.client.query("ROLLBACK");
        hold.client.release();
      }
      expect((await reportRow(r)).status).toBe("open");
      expect((await postRow(p)).status).toBe("published");
      expect(await auditRows(r)).toHaveLength(0);
    }, 30_000);
  });

  // ══════════════ ALLOW-PATH ══════════════

  describe("allow-path", () => {
    it("post + hide_post ⇒ bài hidden; audit moderation.hidden + report.resolved{action}", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      const res = await resolve(tHr, r, { status: "resolved", action: "hide_post" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("resolved");

      expect((await postRow(p)).status).toBe("hidden");
      expect((await auditRows(p)).map((a) => a.action)).toEqual(["social.post.moderation.hidden"]);
      const ra = await auditRows(r);
      expect(ra).toHaveLength(1);
      expect(ra[0].action).toBe("social.report.resolved");
      expect(ra[0].metadata).toMatchObject({
        action: "hide_post",
        effect: "applied",
        from: "open",
        to: "resolved",
      });
    });

    it("post + lock_comments ⇒ comments_locked; audit moderation.commentsLocked", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      expect((await resolve(tHr, r, { status: "resolved", action: "lock_comments" })).status).toBe(
        200,
      );
      expect((await postRow(p)).comments_locked).toBe(true);
      expect((await auditRows(p)).map((a) => a.action)).toEqual([
        "social.post.moderation.commentsLocked",
      ]);
    });

    it("post + delete_target (bài NGƯỜI KHÁC) ⇒ xoá mềm; audit social.post.delete + report.resolved", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      expect((await resolve(tHr, r, { status: "resolved", action: "delete_target" })).status).toBe(
        200,
      );
      const row = await postRow(p);
      expect(row.status).toBe("deleted");
      expect(row.deleted_at).not.toBeNull();
      expect((await auditRows(p)).map((a) => a.action)).toEqual(["social.post.delete"]);
      expect((await auditRows(r))[0].metadata).toMatchObject({ action: "delete_target" });
    });

    it("D5: delete_target bài CỦA CHÍNH người xử lý ⇒ KHÔNG dòng social.post.delete, chỉ report.resolved", async () => {
      const p = await newPost(tHr);
      const r = await fileReport("post", p);
      expect((await resolve(tHr, r, { status: "resolved", action: "delete_target" })).status).toBe(
        200,
      );
      expect((await postRow(p)).status).toBe("deleted");
      expect(await auditRows(p)).toHaveLength(0);
      expect((await auditRows(r)).map((a) => a.action)).toEqual(["social.report.resolved"]);
    });

    it("hide_post / lock_comments trên bài ĐÃ ở trạng thái đó ⇒ 200, KHÔNG audit trường, report.resolved vẫn mang action", async () => {
      const p = await newPost();
      // Báo cáo TRƯỚC khi ẩn — người báo cáo không thấy bài `hidden` (cổng `027`).
      const r1 = await fileReport("post", p, 0);
      const r2 = await fileReport("post", p, 1);
      const mod = await patch(tHr, `/social/posts/${p}/moderation`).send({
        hidden: true,
        commentsLocked: true,
      });
      expect(mod.status, JSON.stringify(mod.body)).toBe(200);
      const before = (await auditRows(p)).length;

      expect((await resolve(tHr, r1, { status: "resolved", action: "hide_post" })).status).toBe(
        200,
      );
      expect((await resolve(tHr, r2, { status: "resolved", action: "lock_comments" })).status).toBe(
        200,
      );

      expect((await auditRows(p)).length).toBe(before);
      expect((await auditRows(r1))[0].metadata).toMatchObject({ action: "hide_post", effect: "noop" });
      expect((await auditRows(r2))[0].metadata).toMatchObject({
        action: "lock_comments",
        effect: "noop",
      });
    });

    it("hide_post trên bài `news` ⇒ hidden", async () => {
      const p = await newPost(tHr, { type: "news" });
      const r = await fileReport("post", p);
      expect((await resolve(tHr, r, { status: "resolved", action: "hide_post" })).status).toBe(200);
      expect((await postRow(p)).status).toBe("hidden");
    });

    it("comment + lock_comments khi bài cha đã hidden ⇒ khoá bình luận BÀI CHA", async () => {
      const p = await newPost();
      const c = await newComment(p);
      const r = await fileReport("comment", c);
      expect(
        (await patch(tHr, `/social/posts/${p}/moderation`).send({ hidden: true })).status,
      ).toBe(200);

      expect((await resolve(tHr, r, { status: "resolved", action: "lock_comments" })).status).toBe(
        200,
      );
      const row = await postRow(p);
      expect(row.comments_locked).toBe(true);
      expect(row.status).toBe("hidden");
    });

    it("comment + delete_target ⇒ xoá mềm bình luận, dọn reaction, hạ comment_count; audit social.comment.delete", async () => {
      const p = await newPost();
      const c = await newComment(p);
      const react = await put(reporters[2], `/social/comments/${c}/reaction`).send({
        emoji: "like",
      });
      expect(react.status, JSON.stringify(react.body)).toBe(200);
      const countBefore = (await postRow(p)).comment_count;
      const r = await fileReport("comment", c);

      expect((await resolve(tHr, r, { status: "resolved", action: "delete_target" })).status).toBe(
        200,
      );

      const cr = await direct.query(`SELECT deleted_at FROM feed_comments WHERE id = $1`, [c]);
      expect(cr.rows[0].deleted_at).not.toBeNull();
      expect((await postRow(p)).comment_count).toBe(countBefore - 1);
      const reactions = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions WHERE target_type = 'comment' AND target_id = $1`,
        [c],
      );
      expect(reactions.rows[0].n).toBe(0);
      expect((await auditRows(c)).map((a) => a.action)).toEqual(["social.comment.delete"]);
    });

    /**
     * D9 — `delete_target` thành công ⇒ mọi báo cáo `open` KHÁC cùng đích chuyển `resolved` trong
     * cùng tx, mỗi hàng một audit mang `via`. Báo cáo `dismissed` sẵn giữ nguyên; báo cáo trên BÌNH
     * LUẬN của bài đó KHÔNG bị đóng (chỉ anh em CÙNG đích).
     */
    it("D9: delete_target auto-resolve báo cáo anh em cùng đích; không đụng dismissed / báo cáo bình luận", async () => {
      const p = await newPost();
      const c = await newComment(p);
      const r1 = await fileReport("post", p, 0);
      const r2 = await fileReport("post", p, 1);
      const r3 = await fileReport("post", p, 2);
      expect((await resolve(tHr, r3, { status: "dismissed" })).status).toBe(200);
      const rc = await fileReport("comment", c, 0);

      const res = await resolve(tHr, r1, {
        status: "resolved",
        action: "delete_target",
        resolutionNote: "vi phạm",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const s2 = await reportRow(r2);
      expect(s2.status).toBe("resolved");
      expect(s2.resolved_by).toBe(uHr);
      expect(s2.resolution_note).toBeNull();
      const a2 = await auditRows(r2);
      expect(a2).toHaveLength(1);
      expect(a2[0].action).toBe("social.report.resolved");
      expect(a2[0].metadata).toMatchObject({
        action: "delete_target",
        via: r1,
        from: "open",
        to: "resolved",
      });

      expect((await reportRow(r3)).status).toBe("dismissed");
      expect(await auditRows(r3)).toHaveLength(1); // chỉ dòng dismissed cũ
      expect((await reportRow(rc)).status).toBe("open");
    });

    it("hồi quy: KHÔNG gửi action ⇒ y hệt trước (không đụng bài), metadata action='none'", async () => {
      const p = await newPost();
      const r = await fileReport("post", p);
      const res = await resolve(tHr, r, { status: "resolved" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await postRow(p)).status).toBe("published");
      expect(await auditRows(p)).toHaveLength(0);
      expect((await auditRows(r))[0].metadata).toMatchObject({ action: "none", effect: "none" });
    });
  });
});
