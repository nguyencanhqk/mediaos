/**
 * S16-SOCIAL-BE-1D — mảng `mentions` trên DTO bài & bình luận, lọc theo «X VẪN trong audience» (plan
 * `docs/plans/S16-SOCIAL-BE-1D.md` §4 M1–M11).
 *
 * Mỗi ca DENY (`withheld`) đứng CẠNH ca ALLOW (link) của CÙNG dựng cảnh — deny một mình là xanh-rỗng
 * (một response không có `mentions` nào cũng «không rò»).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { FeedMentionDto } from "@mediaos/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import * as mentionsModule from "../../src/social/social-mentions";
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

// M8 đếm LỜI GỌI bộ nạp — bọc hàm thật (hành vi giữ nguyên), chỉ thêm bộ đếm.
vi.mock("../../src/social/social-mentions", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/social/social-mentions")>();
  return { ...real, loadMentionsForTargets: vi.fn(real.loadMentionsForTargets) };
});

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!socialbe1d";
const PAIRS = ["view:feed", "create:feed-post", "create:feed-comment"] as const;

interface Person {
  userId: string;
  employeeId: string;
  fullName: string;
  token: string;
}

type Mention = FeedMentionDto;

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1D mảng mention theo audience (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let hash = "";

  let unit1 = "";
  let unit2 = "";

  /** Mọi userId của người ĐƯỢC NHẮC — M7 quét response không được chứa cái nào. */
  const mentionedUserIds: string[] = [];
  /** Mọi body GET đã đọc trong file — M7 quét sau cùng. */
  const readBodies: unknown[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = async (t: string, u: string) => {
    const res = await auth(t)(http().get(u));
    readBodies.push(res.body);
    return res;
  };
  const post = (t: string, u: string) => auth(t)(http().post(u));

  /** Người có hồ sơ nhân sự; `login=false` ⇒ không cấp quyền/không đăng nhập (chỉ để bị nhắc). */
  async function person(label: string, unit: string | null, login = true): Promise<Person> {
    const email = `${label}-${randomUUID().slice(0, 6)}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    const fullName = `Người ${label} ${randomUUID().slice(0, 4)}`;
    await direct.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, userId]);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4) RETURNING id`,
      [A.companyId, userId, unit, `EMP-${randomUUID().slice(0, 6)}`],
    );
    let token = "";
    if (login) {
      const roleId = await seedRole(direct, A.companyId, `sb1d-${randomUUID().slice(0, 8)}`);
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
      token = res.body.data.accessToken as string;
    }
    return { userId, employeeId: emp.rows[0].id as string, fullName, token };
  }

  /** Người bị nhắc — ghi nhận để M7 quét. */
  async function mentioned(label: string, unit: string | null): Promise<Person> {
    const p = await person(label, unit, false);
    mentionedUserIds.push(p.userId);
    return p;
  }

  async function mkGroup(visibility: "public" | "private", members: string[]): Promise<string> {
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, $3) RETURNING id`,
      [A.companyId, `Nhóm ${randomUUID().slice(0, 6)}`, visibility],
    );
    const groupId = g.rows[0].id as string;
    for (const [i, userId] of members.entries()) {
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'active', now())`,
        [A.companyId, groupId, userId, i === 0 ? "owner" : "member"],
      );
    }
    return groupId;
  }

  /** Gieo THẲNG bài + hàng `feed_mentions` (đường ghi đã có lưới riêng ở R19 của BE-1). */
  async function seedPost(opts: {
    author: string;
    audience: "company" | "org_unit" | "group";
    orgUnitId?: string;
    groupId?: string;
    mentions: Person[];
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_posts (company_id, author_user_id, type, audience, org_unit_id, group_id, body)
       VALUES ($1, $2, 'share', $3, $4, $5, 'nhắc tên') RETURNING id`,
      [A.companyId, opts.author, opts.audience, opts.orgUnitId ?? null, opts.groupId ?? null],
    );
    const postId = r.rows[0].id as string;
    for (const m of opts.mentions) {
      await direct.query(
        `INSERT INTO feed_mentions (company_id, target_type, target_id, mentioned_user_id, mentioned_employee_id)
         VALUES ($1, 'post', $2, $3, $4)`,
        [A.companyId, postId, m.userId, m.employeeId],
      );
    }
    return postId;
  }

  const link = (p: Person): Mention => ({
    withheld: false,
    employeeId: p.employeeId,
    label: p.fullName,
  });
  const WITHHELD: Mention = { withheld: true };

  async function mentionsOfPost(token: string, postId: string): Promise<Mention[]> {
    const res = await get(token, `/social/posts/${postId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.mentions as Mention[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Cổng `supertest-listen-ratchet`: server dùng chung phải đang lắng nghe.
    await app.listen(0);

    direct = directPool();
    hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "sb1d");

    const u1 = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Tổ 1', 'active') RETURNING id`,
      [A.companyId],
    );
    unit1 = u1.rows[0].id as string;
    const u2 = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, 'Tổ 2', 'active') RETURNING id`,
      [A.companyId],
    );
    unit2 = u2.rows[0].id as string;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("M1 ALLOW → M2 DENY — bài company: link; khoá tài khoản X ⇒ `withheld`, độ dài GIỮ NGUYÊN", async () => {
    const author = await person("m1a", unit1);
    const reader = await person("m1r", unit2);
    const x = await mentioned("m1x", unit2);

    // Đi qua ĐƯỜNG GHI thật — response tạo bài cũng mang mảng đã phân loại.
    const created = await post(author.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "nhắc tên",
      mentionedUserIds: [x.userId],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.mentions).toEqual([link(x)]);

    const postId = created.body.data.id as string;
    expect(await mentionsOfPost(reader.token, postId)).toEqual([link(x)]);

    await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [x.userId]);
    expect(await mentionsOfPost(reader.token, postId)).toEqual([WITHHELD]);
  });

  it("M3 — bài org_unit: X∈U và trưởng H đều link; X chuyển đơn vị ⇒ X `withheld`, H vẫn link", async () => {
    const author = await person("m3a", unit1);
    const reader = await person("m3r", unit1);
    const x = await mentioned("m3x", unit1);
    const h = await mentioned("m3h", unit2);
    await direct.query(`UPDATE org_units SET head_user_id = $1 WHERE id = $2`, [h.userId, unit1]);
    try {
      const postId = await seedPost({
        author: author.userId,
        audience: "org_unit",
        orgUnitId: unit1,
        mentions: [x, h],
      });
      const before = await mentionsOfPost(reader.token, postId);
      expect(before).toHaveLength(2);
      expect(before).toEqual(expect.arrayContaining([link(x), link(h)]));

      await direct.query(`UPDATE employee_profiles SET org_unit_id = $1 WHERE id = $2`, [
        unit2,
        x.employeeId,
      ]);
      const after = await mentionsOfPost(reader.token, postId);
      expect(after).toHaveLength(2);
      expect(after).toEqual(expect.arrayContaining([WITHHELD, link(h)]));
      // D8 — thứ tự ổn định giữa hai lần tải: X giữ ĐÚNG vị trí cũ.
      expect(after[before.findIndex((m) => !m.withheld && m.employeeId === x.employeeId)]).toEqual(
        WITHHELD,
      );
    } finally {
      await direct.query(`UPDATE org_units SET head_user_id = NULL WHERE id = $1`, [unit1]);
    }
  });

  it("M4a — người xem NGOÀI audience đọc bài nhóm PUBLIC ⇒ nhận ĐÚNG mảng như thành viên", async () => {
    const member = await person("m4m", null);
    const outsider = await person("m4o", null);
    const y = await mentioned("m4y", null);
    const groupId = await mkGroup("public", [member.userId, y.userId]);
    const postId = await seedPost({
      author: member.userId,
      audience: "group",
      groupId,
      mentions: [y],
    });

    const asMember = await mentionsOfPost(member.token, postId);
    expect(asMember).toEqual([link(y)]);
    expect(await mentionsOfPost(outsider.token, postId)).toEqual(asMember);
  });

  it("M4b — tác giả đã RỜI đơn vị đọc bài org_unit của mình: X∈U link; X rời U ⇒ `withheld` với CẢ tác giả", async () => {
    const author = await person("m4ba", unit1);
    const peer = await person("m4bp", unit1);
    const x = await mentioned("m4bx", unit1);
    const postId = await seedPost({
      author: author.userId,
      audience: "org_unit",
      orgUnitId: unit1,
      mentions: [x],
    });
    await direct.query(`UPDATE employee_profiles SET org_unit_id = $1 WHERE id = $2`, [
      unit2,
      author.employeeId,
    ]);

    // D1 không phụ thuộc người xem: tác giả ngoài U vẫn thấy link vì X VẪN trong U.
    expect(await mentionsOfPost(author.token, postId)).toEqual([link(x)]);

    await direct.query(`UPDATE employee_profiles SET org_unit_id = $1 WHERE id = $2`, [
      unit2,
      x.employeeId,
    ]);
    expect(await mentionsOfPost(author.token, postId)).toEqual([WITHHELD]);
    expect(await mentionsOfPost(peer.token, postId)).toEqual([WITHHELD]);
  });

  it("M5 — bài nhóm KÍN: thành viên thấy link; Y rời nhóm ⇒ `withheld`; người ngoài ⇒ 404 cả bài", async () => {
    const reader = await person("m5r", null);
    const outsider = await person("m5o", null);
    const y = await mentioned("m5y", null);
    const groupId = await mkGroup("private", [reader.userId, y.userId]);
    const postId = await seedPost({
      author: reader.userId,
      audience: "group",
      groupId,
      mentions: [y],
    });

    expect(await mentionsOfPost(reader.token, postId)).toEqual([link(y)]);

    const denied = await get(outsider.token, `/social/posts/${postId}`);
    expect(denied.status).toBe(404);

    await direct.query(`DELETE FROM feed_group_members WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      y.userId,
    ]);
    expect(await mentionsOfPost(reader.token, postId)).toEqual([WITHHELD]);
  });

  it("M6 — bình luận nhắc X trên bài company: link; khoá X ⇒ `withheld`", async () => {
    const author = await person("m6a", unit1);
    const commenter = await person("m6c", unit2);
    const x = await mentioned("m6x", unit2);
    const postId = await seedPost({ author: author.userId, audience: "company", mentions: [] });

    const c = await post(commenter.token, `/social/posts/${postId}/comments`).send({
      body: "nhắc tên trong bình luận",
      mentionedUserIds: [x.userId],
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data.mentions).toEqual([link(x)]);

    const list = async () => {
      const res = await get(author.token, `/social/posts/${postId}/comments`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const found = (res.body.data.data as Array<{ id: string; mentions: Mention[] }>).find(
        (row) => row.id === c.body.data.id,
      );
      expect(found, "bình luận vừa tạo phải có trong danh sách").toBeTruthy();
      return found?.mentions;
    };
    expect(await list()).toEqual([link(x)]);

    await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [x.userId]);
    expect(await list()).toEqual([WITHHELD]);
  });

  it("M6b — SỬA bình luận trả mảng theo audience BÀI CHA (điểm nối `update` [PR2-2])", async () => {
    const author = await person("m6ba", unit1);
    const x = await mentioned("m6bx", unit1);
    const outsider = await mentioned("m6bo", unit2);
    const postId = await seedPost({
      author: author.userId,
      audience: "org_unit",
      orgUnitId: unit1,
      mentions: [],
    });
    const c = await post(author.token, `/social/posts/${postId}/comments`).send({ body: "gốc" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);

    const edited = await auth(author.token)(
      http().patch(`/social/comments/${c.body.data.id}`),
    ).send({ body: "sửa", mentionedUserIds: [x.userId, outsider.userId] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    // Người ngoài U bị BỎ ở đường ghi (không vào `feed_mentions`) ⇒ mảng chỉ có X, dạng link.
    expect(edited.body.data.mentions).toEqual([link(x)]);
  });

  it("M10 — X đọc bài nhắc CHÍNH X ⇒ LINK (không có luật tự-nhắc ở đường đọc [PR1-2])", async () => {
    const author = await person("m10a", unit1);
    const x = await person("m10x", unit2);
    mentionedUserIds.push(x.userId);
    const postId = await seedPost({ author: author.userId, audience: "company", mentions: [x] });
    expect(await mentionsOfPost(x.token, postId)).toEqual([link(x)]);
  });

  it("M8 + M11 — `/social/saved` 10 bài trộn 3 audience: bộ nạp gọi ĐÚNG 1 lần; khoá CẶP nhóm không lây", async () => {
    const reader = await person("m8r", unit1);
    const author = await person("m8a", unit1);
    const y = await mentioned("m8y", null);
    const z = await mentioned("m8z", unit1);
    const g1 = await mkGroup("private", [reader.userId, y.userId, z.userId]);
    const g2 = await mkGroup("private", [reader.userId, z.userId]);

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await seedPost({ author: author.userId, audience: "company", mentions: [y, z] }));
    }
    for (let i = 0; i < 3; i++) {
      ids.push(
        await seedPost({
          author: author.userId,
          audience: "org_unit",
          orgUnitId: unit1,
          mentions: [y, z],
        }),
      );
    }
    const pG1 = await seedPost({
      author: author.userId,
      audience: "group",
      groupId: g1,
      mentions: [y, z],
    });
    // M11: Y KHÔNG thuộc G2 — hàng mention gieo thẳng (đường ghi sẽ bỏ nó).
    const pG2 = await seedPost({
      author: author.userId,
      audience: "group",
      groupId: g2,
      mentions: [y, z],
    });
    const pG1b = await seedPost({
      author: author.userId,
      audience: "group",
      groupId: g1,
      mentions: [y, z],
    });
    ids.push(pG1, pG2, pG1b);
    for (const id of ids) {
      await direct.query(
        `INSERT INTO feed_saved_posts (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
        [A.companyId, id, reader.userId],
      );
    }

    const spy = vi.mocked(mentionsModule.loadMentionsForTargets);
    spy.mockClear();
    const res = await get(reader.token, "/social/saved?limit=20");
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const page = res.body.data.data as Array<{ id: string; mentions: Mention[] }>;
    expect(page.map((p) => p.id).sort()).toEqual([...ids].sort());
    const postCalls = spy.mock.calls.filter((c) => c[2] === "post");
    expect(postCalls, "đúng 1 lần nạp cho cả trang (không N+1)").toHaveLength(1);
    expect(postCalls[0][3]).toHaveLength(10);

    const byId = new Map(page.map((p) => [p.id, p.mentions]));
    // Y ở ngoài Tổ 1 (không hồ sơ đơn vị) ⇒ rút ở bài org_unit; link ở company + G1; rút ở G2.
    for (const id of ids.slice(0, 4)) expect(byId.get(id)).toContainEqual(link(y));
    for (const id of ids.slice(4, 7)) expect(byId.get(id)).toContainEqual(WITHHELD);
    expect(byId.get(pG1)).toContainEqual(link(y));
    expect(byId.get(pG1b)).toContainEqual(link(y));
    expect(byId.get(pG2)).toEqual(expect.arrayContaining([WITHHELD, link(z)]));
    // Z trong Tổ 1 và cả hai nhóm ⇒ link ở MỌI bài (neo dương cho vế «rút»).
    for (const id of ids) expect(byId.get(id)).toContainEqual(link(z));
  });

  it("M9 — WS `feed:post.created` / `feed:comment.created` KHÔNG mang `mentions`", async () => {
    const emitter = app.get(RealtimeEmitterService);
    const postSpy = vi.spyOn(emitter, "emitFeedPostCreated");
    const commentSpy = vi.spyOn(emitter, "emitFeedCommentCreated");
    try {
      const author = await person("m9a", unit1);
      const x = await mentioned("m9x", unit2);
      const created = await post(author.token, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "nhắc tên",
        mentionedUserIds: [x.userId],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data.mentions, "neo dương: REST CÓ mảng").toEqual([link(x)]);
      const postPayload = postSpy.mock.calls.find(
        (c) => (c[1] as { id: string }).id === created.body.data.id,
      )?.[1];
      expect(postPayload, "sự kiện bài đã phát").toBeTruthy();
      expect(postPayload).not.toHaveProperty("mentions");

      const c = await post(author.token, `/social/posts/${created.body.data.id}/comments`).send({
        body: "bình luận",
        mentionedUserIds: [x.userId],
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const commentPayload = commentSpy.mock.calls.find(
        (call) => (call[1] as { id: string }).id === c.body.data.id,
      )?.[1];
      expect(commentPayload, "sự kiện bình luận đã phát").toBeTruthy();
      expect(commentPayload).not.toHaveProperty("mentions");
    } finally {
      postSpy.mockRestore();
      commentSpy.mockRestore();
    }
  });

  // Chạy SAU CÙNG — quét mọi response GET của file (vitest giữ thứ tự khai báo trong một file).
  it("M7 — KHÔNG rò: không `userId` người được nhắc ở bất kỳ đâu; nhánh rút chỉ có ĐÚNG khoá `withheld`", () => {
    expect(readBodies.length, "neo dương: đã đọc response").toBeGreaterThan(10);
    const all = JSON.stringify(readBodies);
    for (const id of mentionedUserIds) expect(all).not.toContain(id);

    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.mentions)) {
          for (const m of o.mentions as Array<Record<string, unknown>>) {
            expect(Object.keys(m).sort()).toEqual(
              m.withheld ? ["withheld"] : ["employeeId", "label", "withheld"],
            );
          }
        }
        Object.values(o).forEach(walk);
      }
    };
    walk(readBodies);
  });
});
