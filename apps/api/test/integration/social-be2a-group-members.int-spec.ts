/**
 * S16-SOCIAL-BE-2A · Bước 2 — VÒNG ĐỜI THÀNH VIÊN NHÓM (`035`/`036`/`037`/`038`/`039`).
 *
 * Phủ: **G7** (xin vào lần hai ⇒ 409) · **G5/G5b/G5c** (ba đường mất owner cuối ⇒ 409 `ERR-015`) ·
 * **D12** (chỉ `owner`/`manage` CẤP được vai `owner`) · **G16** (dạng body lệch trạng thái hàng ⇒
 * 409, KHÔNG để chạm CHECK rồi 500) · **G6** (member thường không duyệt được) · **G11** (người đã
 * nghỉ việc không lọt `037` và không nhận NOTI-034) · **C2** (bộ đếm `member_count` qua ĐỦ BẢY dòng
 * delta của D10) · **N-034** (payload đủ BA biến template — render ra CHỮ, không còn `{…}`).
 *
 * 🔴 **C2 là ca đo BẤT BIẾN §13.6, không phải ca đo "route trả 200"**: sau MỖI bước, `member_count`
 * phải bằng `COUNT(*) WHERE status='active'` đọc thẳng từ DB. Một delta sai không làm route đỏ — nó
 * chỉ làm con số sai, mãi mãi, cho tới khi `chk_feed_groups_member_count` nổ ở một request khác.
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
import { SOCIAL_ERR } from "../../src/social/social.errors";
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
const LOGIN_PW = "Passw0rd!socialbe2amembers";
const BASE_PAIRS = ["view:feed", "create:feed-group"] as const;

interface Actor {
  token: string;
  userId: string;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2A · nhóm — vòng đời thành viên (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;

  let owner: Actor;
  let coOwner: Actor;
  let adminUser: Actor;
  let u1: Actor;
  let u2: Actor;
  let u3: Actor;
  let manager: Actor;
  /** Đã nghỉ việc (`employee_profiles.status='resigned'`) nhưng hàng thành viên vẫn còn — D7. */
  let resigned: Actor;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    label: string,
    hash: string,
    opts: { pairs?: readonly string[]; employeeStatus?: string } = {},
  ): Promise<Actor> {
    const email = `${label}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, NULL, $3, 'offline', $4)`,
      [A.companyId, userId, opts.employeeStatus ?? "active", `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(direct, A.companyId, `m-${label}-${randomUUID().slice(0, 6)}`);
    for (const key of opts.pairs ?? BASE_PAIRS) {
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

  /** Nhóm gieo thẳng + bộ đếm khớp số hàng `active` (đường `031` có ca riêng ở spec kia). */
  async function seedGroup(
    visibility: "public" | "private",
    members: ReadonlyArray<{ userId: string; role: "owner" | "admin" | "member"; status?: string }>,
  ): Promise<string> {
    const actives = members.filter((m) => (m.status ?? "active") === "active").length;
    const g = await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, member_count)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [A.companyId, `N ${randomUUID().slice(0, 8)}`, visibility, actives],
    );
    const groupId = g.rows[0].id as string;
    for (const m of members) {
      const status = m.status ?? "active";
      // `joined_at` tính ở JS, KHÔNG dùng lại `$5` trong một `CASE`: pg suy kiểu tham số theo NGỮ
      // CẢNH dùng, và cùng một `$n` vừa ở cột `varchar` vừa trong so sánh `text` ⇒ "inconsistent
      // types deduced for parameter" — lỗi của FIXTURE, dễ đọc nhầm thành lỗi của code sản phẩm.
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [A.companyId, groupId, m.userId, m.role, status, status === "active" ? new Date() : null],
      );
    }
    return groupId;
  }

  /** Bất biến SPEC-16 §13.6 — `member_count` PHẢI bằng số hàng `active`, đọc thẳng từ DB. */
  async function assertCount(groupId: string, expected: number, step: string): Promise<void> {
    const r = await direct.query(
      `SELECT g.member_count AS denorm,
              (SELECT count(*)::int FROM feed_group_members m
                WHERE m.company_id = g.company_id AND m.group_id = g.id AND m.status = 'active') AS real
         FROM feed_groups g WHERE g.company_id = $1 AND g.id = $2`,
      [A.companyId, groupId],
    );
    const { denorm, real } = r.rows[0] as { denorm: number; real: number };
    expect(real, `${step}: số hàng active thật`).toBe(expected);
    expect(denorm, `${step}: member_count denormalized phải khớp COUNT(*) active`).toBe(real);
  }

  async function notiRowsFor(groupId: string): Promise<Array<Record<string, unknown>>> {
    const r = await direct.query(
      `SELECT payload FROM outbox_events
        WHERE event_type = 'social.group_join_decided' AND payload->>'group_id' = $1
        ORDER BY created_at ASC`,
      [groupId],
    );
    return r.rows.map((x) => x.payload as Record<string, unknown>);
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2amem");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    owner = await makeUser("owner", hash);
    coOwner = await makeUser("coowner", hash);
    adminUser = await makeUser("admin", hash);
    u1 = await makeUser("u1", hash);
    u2 = await makeUser("u2", hash);
    u3 = await makeUser("u3", hash);
    manager = await makeUser("manager", hash, { pairs: [...BASE_PAIRS, "manage:feed-group"] });
    resigned = await makeUser("resigned", hash, { employeeStatus: "resigned" });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  // ───────────────────────── G7 — xin vào nhóm ─────────────────────────

  it("G7 — `035`: nhóm MỞ ⇒ `active` ngay; nhóm KÍN ⇒ `pending`; lần hai ⇒ 409 ERR-013", async () => {
    const pub = await seedGroup("public", [{ userId: owner.userId, role: "owner" }]);
    const first = await post(u1.token, `/social/groups/${pub}/join`);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.myStatus).toBe("active");
    expect(first.body.data.myRole).toBe("member");
    await assertCount(pub, 2, "035 join nhóm public");

    const again = await post(u1.token, `/social/groups/${pub}/join`);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain(SOCIAL_ERR.GROUP_MEMBERSHIP_EXISTS);

    const priv = await seedGroup("private", [{ userId: owner.userId, role: "owner" }]);
    const req = await post(u2.token, `/social/groups/${priv}/join`);
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.data.myStatus, "nhóm kín ⇒ CHỜ DUYỆT, không vào thẳng").toBe("pending");
    await assertCount(priv, 1, "035 xin vào nhóm private (pending KHÔNG tính)");

    const dupPending = await post(u2.token, `/social/groups/${priv}/join`);
    expect(dupPending.status).toBe(409);
  });

  it("`036` — huỷ chính yêu cầu `pending` của mình (nhóm kín) KHÔNG đụng bộ đếm", async () => {
    const priv = await seedGroup("private", [{ userId: owner.userId, role: "owner" }]);
    expect((await post(u3.token, `/social/groups/${priv}/join`)).status).toBe(201);
    await assertCount(priv, 1, "trước khi huỷ");

    const cancel = await post(u3.token, `/social/groups/${priv}/leave`);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    await assertCount(priv, 1, "sau khi huỷ yêu cầu pending — delta phải là 0");

    const notMember = await post(u3.token, `/social/groups/${priv}/leave`);
    expect(notMember.status).toBe(404);
  });

  // ───────────────────────── G5 / G5b / G5c — ba đường mất owner cuối ─────────────────────────

  it("G5 — owner DUY NHẤT rời nhóm ⇒ 409 ERR-015; có owner thứ hai ⇒ rời được", async () => {
    const g = await seedGroup("public", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member" },
    ]);
    const denied = await post(owner.token, `/social/groups/${g}/leave`);
    expect(denied.status).toBe(409);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_LAST_OWNER);
    await assertCount(g, 2, "G5 deny — không được đổi gì");

    // ALLOW đối chứng: thêm owner thứ hai rồi rời.
    await direct.query(
      `UPDATE feed_group_members SET role = 'owner' WHERE company_id = $1 AND group_id = $2 AND user_id = $3`,
      [A.companyId, g, u1.userId],
    );
    const ok = await post(owner.token, `/social/groups/${g}/leave`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    await assertCount(g, 1, "G5 allow — rời thật sự trừ 1");
  });

  it("G5b — `038` hạ vai owner CUỐI ⇒ 409; chuyển owner đúng cách (nâng trước, hạ sau) ⇒ 200", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: adminUser.userId, role: "admin" },
    ]);
    const denied = await patch(adminUser.token, `/social/groups/${g}/members/${owner.userId}`).send(
      {
        role: "member",
      },
    );
    expect(denied.status).toBe(409);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_LAST_OWNER);

    // D12 — `admin` KHÔNG tự nâng mình lên `owner` (nếu được thì cổng owner-only của `034` vô nghĩa).
    const escalate = await patch(
      adminUser.token,
      `/social/groups/${g}/members/${adminUser.userId}`,
    ).send({ role: "owner" });
    expect(escalate.status, "admin cấp vai owner ⇒ 403").toBe(403);
    expect(JSON.stringify(escalate.body)).toContain(SOCIAL_ERR.GROUP_ROLE_REQUIRED);

    // Đường chuyển owner ĐÚNG: owner hiện tại nâng người khác TRƯỚC, rồi mới hạ mình.
    const promote = await patch(
      owner.token,
      `/social/groups/${g}/members/${adminUser.userId}`,
    ).send({ role: "owner" });
    expect(promote.status, JSON.stringify(promote.body)).toBe(200);
    expect(promote.body.data).toMatchObject({ userId: adminUser.userId, role: "owner" });

    const demote = await patch(owner.token, `/social/groups/${g}/members/${owner.userId}`).send({
      role: "member",
    });
    expect(demote.status, JSON.stringify(demote.body)).toBe(200);
    await assertCount(g, 2, "đổi vai trò ⇒ delta 0");
  });

  it("G5c — `039` mời owner CUỐI ra ⇒ 409; mời thành viên thường ra ⇒ 200 và đếm −1", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member" },
    ]);
    const denied = await del(owner.token, `/social/groups/${g}/members/${owner.userId}`);
    expect(denied.status).toBe(409);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_LAST_OWNER);
    await assertCount(g, 2, "G5c deny");

    const ok = await del(owner.token, `/social/groups/${g}/members/${u1.userId}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await assertCount(g, 1, "G5c allow");

    const gone = await del(owner.token, `/social/groups/${g}/members/${u1.userId}`);
    expect(gone.status, "mời ra người đã không còn trong nhóm ⇒ 404").toBe(404);
  });

  // ───────────────────────── G16 / G6 — dạng body ↔ trạng thái hàng ─────────────────────────

  it("G16 — `{role}` lên hàng `pending` ⇒ 409 (KHÔNG 500); `{decision}` lên hàng `active` ⇒ 409", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member", status: "pending" },
      { userId: u2.userId, role: "member" },
    ]);

    const wrongRole = await patch(owner.token, `/social/groups/${g}/members/${u1.userId}`).send({
      role: "admin",
    });
    expect(
      wrongRole.status,
      "phải 409 ở service — để chạm `chk_feed_group_members_pending_role` là 500",
    ).toBe(409);
    expect(JSON.stringify(wrongRole.body)).toContain(SOCIAL_ERR.GROUP_MEMBER_STATE_MISMATCH);

    const wrongDecision = await patch(owner.token, `/social/groups/${g}/members/${u2.userId}`).send(
      {
        decision: "approve",
      },
    );
    expect(wrongDecision.status).toBe(409);

    // ALLOW đối chứng cho CẢ HAI dạng.
    const approve = await patch(owner.token, `/social/groups/${g}/members/${u1.userId}`).send({
      decision: "approve",
    });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.data).toMatchObject({ userId: u1.userId, status: "active" });
    await assertCount(g, 3, "duyệt pending ⇒ +1");

    const setRole = await patch(owner.token, `/social/groups/${g}/members/${u2.userId}`).send({
      role: "admin",
    });
    expect(setRole.status, JSON.stringify(setRole.body)).toBe(200);
  });

  it("G6 — `member` thường KHÔNG duyệt/mời ra được (403 ERR-014); `admin` duyệt được", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: adminUser.userId, role: "admin" },
      { userId: u1.userId, role: "member" },
      { userId: u3.userId, role: "member", status: "pending" },
    ]);

    const denied = await patch(u1.token, `/social/groups/${g}/members/${u3.userId}`).send({
      decision: "approve",
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.GROUP_ROLE_REQUIRED);

    const deniedKick = await del(u1.token, `/social/groups/${g}/members/${u3.userId}`);
    expect(deniedKick.status).toBe(403);

    const byAdmin = await patch(adminUser.token, `/social/groups/${g}/members/${u3.userId}`).send({
      decision: "approve",
    });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
  });

  // ───────────────────────── N-034 + G11 ─────────────────────────

  it("N-034 — payload mang ĐỦ biến template của `0581`, render ra CHỮ (không còn `{…}`)", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member", status: "pending" },
      { userId: u2.userId, role: "member", status: "pending" },
    ]);
    const groupName = (await direct.query(`SELECT name FROM feed_groups WHERE id = $1`, [g]))
      .rows[0].name as string;

    expect(await notiRowsFor(g), "neo ÂM: chưa quyết định thì chưa có event").toHaveLength(0);

    expect(
      (
        await patch(owner.token, `/social/groups/${g}/members/${u1.userId}`).send({
          decision: "approve",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patch(owner.token, `/social/groups/${g}/members/${u2.userId}`).send({
          decision: "reject",
        })
      ).status,
    ).toBe(200);

    const events = await notiRowsFor(g);
    expect(events, "một event cho MỖI quyết định").toHaveLength(2);
    expect(events[0].recipientUserIds, "chỉ người XIN VÀO nhận").toEqual([u1.userId]);
    expect(events[1].recipientUserIds).toEqual([u2.userId]);
    expect(events[0].decision_label).toBe("duyệt");
    expect(events[1].decision_label).toBe("từ chối");
    // KHÔNG chở danh tính người duyệt (hàng `notifications` sống lâu hơn grant).
    expect(events[0].actorUserId).toBeUndefined();

    // 🔴 Render THẬT theo template trong DB: mọi `{placeholder}` phải tìm được khoá trong payload.
    const tpl = await direct.query(
      `SELECT title_template, body_template, target_url_template
         FROM notification_templates WHERE template_code = 'SOCIAL_GROUP_JOIN_DECIDED__IN_APP__vi-VN'`,
    );
    expect(tpl.rowCount, "template `0581` phải có trong lane DB").toBe(1);
    const t = tpl.rows[0] as Record<string, string>;
    for (const field of ["title_template", "body_template", "target_url_template"] as const) {
      const rendered = t[field].replace(/\{(\w+)\}/g, (_m, key: string) => {
        const v = events[0][key];
        expect(v, `biến \`{${key}}\` của ${field} phải có trong payload NOTI-034`).toBeTruthy();
        return String(v);
      });
      expect(rendered, `${field} còn placeholder chưa thay`).not.toMatch(/\{\w+\}/);
    }
    expect(t.title_template.replace(/\{group_name\}/g, groupName)).toContain(groupName);
  });

  it("G11 — người ĐÃ NGHỈ VIỆC: không lọt `037`, không nhận NOTI-034 (thành viên active vẫn đủ cả hai)", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member" },
      { userId: resigned.userId, role: "member", status: "pending" },
    ]);

    const list = await get(owner.token, `/social/groups/${g}/members`);
    expect(list.status).toBe(200);
    const ids = (list.body.data.data as Array<{ userId: string }>).map((m) => m.userId);
    expect(ids, "neo DƯƠNG: nhân viên đang làm việc PHẢI có mặt").toContain(u1.userId);
    expect(ids, "người đã nghỉ việc không nằm trong danh bạ nhóm").not.toContain(resigned.userId);

    const approve = await patch(owner.token, `/social/groups/${g}/members/${resigned.userId}`).send(
      {
        decision: "approve",
      },
    );
    expect(approve.status, "vẫn duyệt được — chỉ KÊNH THÔNG BÁO bị loại").toBe(200);
    expect(await notiRowsFor(g), "không phát NOTI cho người đã nghỉ việc").toHaveLength(0);
    // Bộ đếm KHÔNG lọc nhân sự (SPEC §13.6 đo tập khác `037` — lệch có chủ ý, plan M-c).
    await assertCount(g, 3, "duyệt người đã nghỉ vẫn +1 theo định nghĩa §13.6");
  });

  // ───────────────────────── C2 — bảy dòng delta của D10 ─────────────────────────

  it("C2 — `member_count` đúng sau ĐỦ BẢY chuyển trạng thái (tạo · join public · xin vào private · duyệt · từ chối · đổi vai · rời · mời ra)", async () => {
    // (1) `031` tạo nhóm — hàng owner/active ⇒ 1.
    const created = await post(owner.token, "/social/groups").send({
      name: `C2 ${randomUUID().slice(0, 8)}`,
      visibility: "public",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const g = created.body.data.id as string;
    await assertCount(g, 1, "(1) 031 tạo nhóm");

    // (2) `035` join nhóm PUBLIC ⇒ +1.
    expect((await post(u1.token, `/social/groups/${g}/join`)).status).toBe(201);
    await assertCount(g, 2, "(2) 035 join public");

    // (3) `035` join nhóm PRIVATE ⇒ 0 (hàng `pending`).
    expect(
      (await patch(owner.token, `/social/groups/${g}`).send({ visibility: "private" })).status,
    ).toBe(200);
    expect((await post(u2.token, `/social/groups/${g}/join`)).status).toBe(201);
    await assertCount(g, 2, "(3) 035 xin vào private ⇒ pending, delta 0");

    // (4) `038` duyệt ⇒ +1.
    expect(
      (
        await patch(owner.token, `/social/groups/${g}/members/${u2.userId}`).send({
          decision: "approve",
        })
      ).status,
    ).toBe(200);
    await assertCount(g, 3, "(4) 038 approve");

    // (5) `038` từ chối ⇒ 0.
    expect((await post(u3.token, `/social/groups/${g}/join`)).status).toBe(201);
    await assertCount(g, 3, "(5a) yêu cầu mới vẫn pending");
    expect(
      (
        await patch(owner.token, `/social/groups/${g}/members/${u3.userId}`).send({
          decision: "reject",
        })
      ).status,
    ).toBe(200);
    await assertCount(g, 3, "(5b) 038 reject ⇒ delta 0");

    // (6) `038` đổi vai trò ⇒ 0.
    expect(
      (await patch(owner.token, `/social/groups/${g}/members/${u1.userId}`).send({ role: "admin" }))
        .status,
    ).toBe(200);
    await assertCount(g, 3, "(6) 038 đổi vai trò");

    // (7a) `036` rời nhóm (hàng `active`) ⇒ −1.
    expect((await post(u1.token, `/social/groups/${g}/leave`)).status).toBe(201);
    await assertCount(g, 2, "(7a) 036 rời nhóm");

    // (7b) `039` mời ra (hàng `active`) ⇒ −1.
    expect((await del(owner.token, `/social/groups/${g}/members/${u2.userId}`)).status).toBe(200);
    await assertCount(g, 1, "(7b) 039 mời ra");

    // `manage:feed-group` gỡ được cả nhóm không thuộc — và audit ghi cho MỌI thao tác lên người khác.
    const audit = await direct.query(
      `SELECT action FROM audit_logs WHERE company_id = $1 AND object_type = 'feed_group' AND object_id = $2`,
      [A.companyId, g],
    );
    const actions = (audit.rows as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toContain("social.group_member.approve");
    expect(actions).toContain("social.group_member.reject");
    expect(actions).toContain("social.group_member.role_changed");
    expect(actions).toContain("social.group_member.removed");
    expect(actions, "`036` rời nhóm là thao tác lên CHÍNH MÌNH ⇒ không vào sổ").not.toContain(
      "social.group_member.left",
    );
  });

  it("`manage:feed-group` thao tác được trên nhóm KHÔNG phải của mình (đối chứng cho mọi ca 403 ở trên)", async () => {
    const g = await seedGroup("private", [
      { userId: owner.userId, role: "owner" },
      { userId: u1.userId, role: "member", status: "pending" },
    ]);
    const ok = await patch(manager.token, `/social/groups/${g}/members/${u1.userId}`).send({
      decision: "approve",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await assertCount(g, 2, "manage duyệt");
  });
});
