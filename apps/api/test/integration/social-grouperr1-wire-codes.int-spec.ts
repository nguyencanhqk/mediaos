/**
 * S16-SOCIAL-GROUPERR-1 (2) — MÃ lỗi SOCIAL tới được `error.code` của envelope (plan §3 W1–W13 + §6 B3).
 *
 * Trước WO này service SOCIAL ném CHUỖI ⇒ `AllExceptionsFilter` gán mã CHUNG theo status
 * (`RESOURCE-ERR-NOT-FOUND` · `AUTH-ERR-FORBIDDEN` · `RESOURCE-ERR-CONFLICT` · `VALIDATION-ERR-001`); mã
 * `SOCIAL-ERR-0xx` chỉ còn ở đầu `message` và FE phải đọc tiền tố. KHÔNG ca nào trong kho từng assert
 * `error.code` trên route SOCIAL — file này là bằng chứng runtime đầu tiên.
 *
 * Mỗi ca assert HAI vế: `error.code === SOCIAL_ERROR_CODES.K` (mới) **và** `error.message === SOCIAL_ERR.K`
 * (byte-y-hệt bản cũ — deploy lệch an toàn, O4). W13 là neo NGƯỢC: lỗi KHÔNG phải SOCIAL (guard tầng 1,
 * ParseUUID) KHÔNG được dán mã SOCIAL.
 *
 * Pipeline Y HỆT `main.ts` (`applyMainPipeline`, có `ZodValidationPipe`) — W9/W13 cần nó; `listen(0)` theo
 * census S18-QA-SUPERTESTLISTEN-1. GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SOCIAL_ERROR_CODES, type SocialErrorCode } from "@mediaos/contracts";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { SOCIAL_ERR, type SocialErrorMessage } from "../../src/social/social.errors";
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
const LOGIN_PW = "Passw0rd!socialgrouperr1";

const BASE_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "create:feed-group",
] as const;

interface Who {
  token: string;
  userId: string;
}

interface Envelope {
  status: number;
  body: { error?: { code?: string; message?: string } | null };
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-GROUPERR-1 · mã lỗi SOCIAL trên dây (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  let owner: Who;
  let u1: Who;
  let u2: Who;
  /** Vai TUỲ BIẾN thiếu đúng `create:feed-poll` — đường GIÁN TIẾP `SOCIAL_POST_TYPE_DENIED` (W11). */
  let noPoll: Who;
  let ideaAuthor: Who;
  /** `approve:feed-idea` @Department — tầng 1 cho qua, sàn Company chặn ⇒ `020` qua `denyMessage` (W12, khuôn I-2b). */
  let reviewerDept: Who;
  /** Kiểm duyệt: `manage:feed-post` (tầng 1 của `006`) + `manage:feed-news` (trường `pinned`). */
  let moderator: Who;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    label: string,
    hash: string,
    pairs: ReadonlyArray<string | readonly [string, "Company" | "Department"]> = BASE_PAIRS,
  ): Promise<Who> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `ge-${label}-${randomUUID().slice(0, 6)}`);
    for (const entry of pairs) {
      const [key, scope] = typeof entry === "string" ? [entry, "Company" as const] : entry;
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
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
    members: ReadonlyArray<{ userId: string; role: "owner" | "admin" | "member" }>,
    name = `GE ${randomUUID().slice(0, 8)}`,
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

  async function createPost(token: string, payload: Record<string, unknown>): Promise<string> {
    const res = await post(token, "/social/posts").send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /**
   * Hai vế của hợp đồng: mã MỚI ở `error.code` + thông điệp CŨ byte-y-hệt. Nhận HẰNG (`SOCIAL_ERR.X`,
   * `SOCIAL_ERROR_CODES.X`), không nhận tên khoá chuỗi — census tầng A chỉ tính tham chiếu hằng.
   */
  function expectSocial(
    res: Envelope,
    status: number,
    message: SocialErrorMessage,
    code: SocialErrorCode,
  ): void {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.error?.code, `error.code của «${message}»`).toBe(code);
    expect(res.body.error?.message).toBe(message);
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sgrouperr1");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    owner = await makeUser("owner", hash);
    u1 = await makeUser("u1", hash);
    u2 = await makeUser("u2", hash);
    noPoll = await makeUser("nopoll", hash, ["view:feed", "create:feed-post"]);
    ideaAuthor = await makeUser("ideaauthor", hash, [...BASE_PAIRS, "create:feed-idea"]);
    reviewerDept = await makeUser("reviewerdept", hash, [
      ...BASE_PAIRS,
      "create:feed-idea",
      ["approve:feed-idea", "Department"],
    ]);
    moderator = await makeUser("moderator", hash, [
      ...BASE_PAIRS,
      "manage:feed-post",
      "manage:feed-news",
    ]);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  // ───────────────────────── NHÓM (`031..039`) ─────────────────────────

  it("W1 — 404 nhóm lạ ⇒ SOCIAL-ERR-012", async () => {
    expectSocial(await get(u1.token, `/social/groups/${randomUUID()}`), 404, SOCIAL_ERR.GROUP_NOT_FOUND, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND);
  });

  it("W2 — 403 vai nhóm không đủ (member mời người ra `039`) ⇒ SOCIAL-ERR-014", async () => {
    const g = await seedGroup("public", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member" },
    ]);
    expectSocial(
      await del(u1.token, `/social/groups/${g}/members/${owner.userId}`),
      403,
      SOCIAL_ERR.GROUP_ROLE_REQUIRED, SOCIAL_ERROR_CODES.GROUP_ROLE_REQUIRED,
    );
  });

  it("W3 — 409 owner cuối rời nhóm ⇒ SOCIAL-ERR-015", async () => {
    const g = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
    expectSocial(await post(owner.token, `/social/groups/${g}/leave`), 409, SOCIAL_ERR.GROUP_LAST_OWNER, SOCIAL_ERROR_CODES.GROUP_LAST_OWNER);
  });

  it("W4 — 409 vào nhóm lần hai ⇒ SOCIAL-ERR-013", async () => {
    const g = await seedGroup("public", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member" },
    ]);
    expectSocial(
      await post(u1.token, `/social/groups/${g}/join`),
      409,
      SOCIAL_ERR.GROUP_MEMBERSHIP_EXISTS, SOCIAL_ERROR_CODES.GROUP_MEMBERSHIP_EXISTS,
    );
  });

  it("W5 — 409 tên nhóm trùng ⇒ sentinel SOCIAL-ERR-GROUP-NAME-TAKEN (KHÔNG số)", async () => {
    const name = `Trùng ${randomUUID().slice(0, 8)}`;
    await seedGroup("public", [{ userId: owner.userId, role: "owner" }], name);
    expectSocial(
      await post(u1.token, "/social/groups").send({ name, visibility: "public" }),
      409,
      SOCIAL_ERR.GROUP_NAME_TAKEN, SOCIAL_ERROR_CODES.GROUP_NAME_TAKEN,
    );
  });

  it("W6 — 404 người không phải thành viên ⇒ sentinel SOCIAL-ERR-GROUP-MEMBER-NOT-FOUND (tách khỏi 012)", async () => {
    const g = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
    expectSocial(
      await del(owner.token, `/social/groups/${g}/members/${u2.userId}`),
      404,
      SOCIAL_ERR.GROUP_MEMBER_NOT_FOUND, SOCIAL_ERROR_CODES.GROUP_MEMBER_NOT_FOUND,
    );
  });

  // ───────────────────────── BÀI · BÌNH LUẬN · FEED ─────────────────────────

  it("W7 — 422 trả lời quá 1 cấp ⇒ SOCIAL-ERR-005", async () => {
    const postId = await createPost(owner.token, { type: "share", body: "bài W7" });
    const root = await post(u1.token, `/social/posts/${postId}/comments`).send({ body: "gốc" });
    expect(root.status, JSON.stringify(root.body)).toBe(201);
    const reply = await post(u1.token, `/social/posts/${postId}/comments`).send({
      body: "trả lời",
      parentCommentId: root.body.data.id,
    });
    expect(reply.status, JSON.stringify(reply.body)).toBe(201);
    expectSocial(
      await post(u1.token, `/social/posts/${postId}/comments`).send({
        body: "trả lời cấp 2",
        parentCommentId: reply.body.data.id,
      }),
      422,
      SOCIAL_ERR.REPLY_DEPTH, SOCIAL_ERROR_CODES.REPLY_DEPTH,
    );
  });

  it("W8 — 404 bài lạ ⇒ SOCIAL-ERR-001", async () => {
    expectSocial(await get(u1.token, `/social/posts/${randomUUID()}`), 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND);
  });

  it("W9 — 400 con trỏ hỏng ⇒ sentinel SOCIAL-ERR-CURSOR-INVALID (KHÔNG `001` — 001 là mã 404)", async () => {
    const res = await get(u1.token, "/social/feed?cursor=khong-phai-con-tro");
    expectSocial(res, 400, SOCIAL_ERR.CURSOR_INVALID, SOCIAL_ERROR_CODES.CURSOR_INVALID);
    expect(res.body.error?.code).not.toBe("SOCIAL-ERR-001");
  });

  it("W10 — 422 ghim bài KHÔNG phải tin tức ⇒ sentinel SOCIAL-ERR-PIN-NEWS-ONLY (ca đầu tiên chạm nhánh này)", async () => {
    const postId = await createPost(owner.token, { type: "share", body: "bài W10" });
    const res = await patch(moderator.token, `/social/posts/${postId}/moderation`).send({
      pinned: true,
    });
    expectSocial(res, 422, SOCIAL_ERR.PIN_NEWS_ONLY, SOCIAL_ERROR_CODES.PIN_NEWS_ONLY);
    const row = await direct.query(`SELECT pinned FROM feed_posts WHERE id = $1`, [postId]);
    expect(row.rows[0].pinned, "không ghim gì").toBe(false);
  });

  // ───────────────────────── Đường GIÁN TIẾP (bảng / `denyMessage`) ─────────────────────────

  it("W11 — 403 thiếu `create:feed-poll` qua bảng SOCIAL_POST_TYPE_DENIED ⇒ sentinel POLL-CREATE-REQUIRED", async () => {
    expectSocial(
      await post(noPoll.token, "/social/posts").send({
        type: "poll",
        poll: { question: "Chọn gì?", options: ["A", "B"] },
      }),
      403,
      SOCIAL_ERR.POLL_CREATE_REQUIRED, SOCIAL_ERROR_CODES.POLL_CREATE_REQUIRED,
    );
    // Neo dương: CÙNG user tạo được bài `share` ⇒ 403 ở trên là do cặp theo loại bài, không do vai hỏng.
    await createPost(noPoll.token, { type: "share", body: "neo dương W11" });
  });

  it("W12 — 403 `approve:feed-idea` @Department qua `denyMessage` của resolveActor ⇒ SOCIAL-ERR-020 (khuôn I-2b)", async () => {
    const postId = await createPost(ideaAuthor.token, { type: "idea", body: "Sáng kiến W12" });
    expectSocial(
      await patch(reviewerDept.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      }),
      403,
      SOCIAL_ERR.IDEA_APPROVE_REQUIRED, SOCIAL_ERROR_CODES.IDEA_APPROVE_REQUIRED,
    );
  });

  // ───────────────────────── W13 — neo NGƯỢC: lỗi KHÔNG phải SOCIAL giữ mã chung ─────────────────────────

  it("W13a — tầng 1 `PermissionGuard` (không grant `approve:feed-idea`) ⇒ AUTH-ERR-FORBIDDEN, KHÔNG mã SOCIAL (khuôn I-2)", async () => {
    const postId = await createPost(ideaAuthor.token, { type: "idea", body: "Sáng kiến W13" });
    const res = await patch(u1.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("AUTH-ERR-FORBIDDEN");
    expect(res.body.error?.message).toContain("Permission denied");
  });

  it("W13b — ParseUUID 400 ⇒ VALIDATION-ERR-001, KHÔNG mã SOCIAL", async () => {
    const res = await get(u1.token, "/social/posts/khong-phai-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION-ERR-001");
  });
});
