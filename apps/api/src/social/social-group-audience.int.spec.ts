/**
 * S16-SOCIAL-BE-2A · Bước 1.4 (D14) — BA hàm tập-người phải hiểu `audience='group'`, không phải một.
 *
 * ┌─ VÌ SAO CA NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────────┐
 * │ BE-1/BE-1B chốt cửa `audience='group'` bằng 422 ở `assertWriteAudience`, nên ba hàm dưới đây    │
 * │ đều có một dòng thoát sớm "group ⇒ tập RỖNG". Bước 1.7 mở cửa ghi ⇒ ba dòng đó trở thành ba lỗ  │
 * │ HỎNG CÂM, không lỗi, không log:                                                                 │
 * │   • `audienceUserIds`  → tin đăng vào nhóm KHÔNG báo cho ai (NOTI-031 tập rỗng)                 │
 * │   • `unackedEmployeesFor` → route 022 liệt "0 người chưa đọc" cạnh nửa "đã đọc" có số thật      │
 * │   • `resolveMentions`  → mọi @mention trong bài/bình luận nhóm bị bỏ im lặng (vẫn 201)          │
 * │ Hai cái đầu nói NGƯỢC nhau về cùng một tin ⇒ phải vá CÙNG lượt, không vá lẻ.                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * D7 — «đang hoạt động» ở MỌI tập người: `feed_group_members.status='active'` KHÔNG đồng nghĩa người
 * đó còn làm việc (nghỉ việc không xoá mềm hàng nào). Mọi tập kèm `employee_profiles.status='active'`
 * + `users.deleted_at IS NULL AND users.status='active'`.
 *
 * D13 — nhóm ĐÃ XOÁ MỀM không còn là audience của ai: mọi vị từ chạm `feed_groups` mang
 * `deleted_at IS NULL`.
 *
 * Gate cứng `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`). Colocated trong `src/social`
 * ⇒ tự vào `vitest run src/social` VÀ script cổng `test:cov:social` (M20 — script đó liệt kê từng
 * int-spec của `test/integration/**` một, spec ở đây không dính bẫy đó).
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../../test/helpers/seed";
import { resolveMentions } from "./social-mentions";
import { SocialNewsRepository } from "./social-news.repository";
import type { SocialActor } from "./social.types";

const runDb = hasDb && Boolean(process.env.LANE_DB);

interface Cast {
  author: string;
  memberOk: string;
  memberResigned: string;
  memberPending: string;
  outsider: string;
  groupId: string;
  deletedGroupId: string;
  postId: string;
  postInDeletedGroupId: string;
}

async function seedEmployee(
  direct: Pool,
  companyId: string,
  userId: string,
  status: "active" | "resigned",
  code: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
     VALUES ($1, $2, NULL, $3, 'offline', $4)`,
    [companyId, userId, status, code],
  );
}

async function seedGroup(
  direct: Pool,
  companyId: string,
  name: string,
  opts: { deleted?: boolean } = {},
): Promise<string> {
  const res = await direct.query(
    `INSERT INTO feed_groups (company_id, name, visibility, deleted_at)
     VALUES ($1, $2, 'private', $3) RETURNING id`,
    [companyId, name, opts.deleted === true ? new Date() : null],
  );
  return res.rows[0].id as string;
}

async function seedMembership(
  direct: Pool,
  companyId: string,
  groupId: string,
  userId: string,
  role: "owner" | "member",
  status: "active" | "pending",
): Promise<void> {
  await direct.query(
    `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [companyId, groupId, userId, role, status],
  );
}

async function seedGroupNewsPost(
  direct: Pool,
  companyId: string,
  authorUserId: string,
  groupId: string,
): Promise<string> {
  const res = await direct.query(
    `INSERT INTO feed_posts (company_id, author_user_id, type, audience, group_id, body, requires_ack)
     VALUES ($1, $2, 'news', 'group', $3, 'Tin nội bộ của nhóm', true) RETURNING id`,
    [companyId, authorUserId, groupId],
  );
  return res.rows[0].id as string;
}

function actorOf(userId: string, companyId: string): SocialActor {
  return {
    actorUserId: userId,
    companyId,
    canManagePosts: false,
    orgUnitIds: [],
    routeKey: "postCreate",
    routeScope: "Company",
    canManageNews: false,
    canManageGroups: false,
    // S16-SOCIAL-ATTDEBT-1 (F1): `postCreate` KHÔNG pre-resolve cổng gắn tệp (đường TẠO ép cặp
    // `create:feed-*` ở tầng 1 rồi) ⇒ `resolved:false` là giá trị ĐÚNG, không phải chỗ điền cho đủ.
    attachNewGate: { resolved: false },
  } as SocialActor;
}

describe.skipIf(!runDb)("S16-SOCIAL-BE-2A D14 — tập người của bài nhóm (DB cô lập)", () => {
  let direct: Pool;
  let dbsvc: DatabaseService;
  let repo: SocialNewsRepository;
  let A: SeededTenant;
  let c: Cast;

  beforeAll(async () => {
    direct = directPool();
    dbsvc = new DatabaseService();
    repo = new SocialNewsRepository();
    A = await seedCompany(direct, "socgrpaud");
    const cid = A.companyId;
    const tag = randomUUID().slice(0, 8);

    const author = await seedUser(direct, cid, `author-${tag}@t.local`);
    const memberOk = await seedUser(direct, cid, `ok-${tag}@t.local`);
    const memberResigned = await seedUser(direct, cid, `resigned-${tag}@t.local`);
    const memberPending = await seedUser(direct, cid, `pending-${tag}@t.local`);
    const outsider = await seedUser(direct, cid, `outsider-${tag}@t.local`);

    await seedEmployee(direct, cid, author, "active", `E-A-${tag}`);
    await seedEmployee(direct, cid, memberOk, "active", `E-OK-${tag}`);
    await seedEmployee(direct, cid, memberResigned, "resigned", `E-RS-${tag}`);
    await seedEmployee(direct, cid, memberPending, "active", `E-PD-${tag}`);
    await seedEmployee(direct, cid, outsider, "active", `E-OS-${tag}`);

    const groupId = await seedGroup(direct, cid, `Nhóm sống ${tag}`);
    const deletedGroupId = await seedGroup(direct, cid, `Nhóm đã xoá ${tag}`, { deleted: true });

    await seedMembership(direct, cid, groupId, author, "owner", "active");
    await seedMembership(direct, cid, groupId, memberOk, "member", "active");
    await seedMembership(direct, cid, groupId, memberResigned, "member", "active");
    await seedMembership(direct, cid, groupId, memberPending, "member", "pending");
    // Nhóm đã xoá mềm: cùng tập người, để chứng minh D13 loại theo NHÓM chứ không theo người.
    await seedMembership(direct, cid, deletedGroupId, author, "owner", "active");
    await seedMembership(direct, cid, deletedGroupId, memberOk, "member", "active");

    const postId = await seedGroupNewsPost(direct, cid, author, groupId);
    const postInDeletedGroupId = await seedGroupNewsPost(direct, cid, author, deletedGroupId);

    c = {
      author,
      memberOk,
      memberResigned,
      memberPending,
      outsider,
      groupId,
      deletedGroupId,
      postId,
      postInDeletedGroupId,
    };
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G14 — `audienceUserIds` trả ĐÚNG thành viên active của nhóm (không rỗng câm)", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      repo.audienceUserIds(
        tx,
        A.companyId,
        { audience: "group", orgUnitId: null, groupId: c.groupId },
        { excludeUserId: c.author, limit: 500 },
      ),
    );

    // Neo DƯƠNG trước mọi assert phủ định — tập rỗng làm mọi `not.toContain` xanh giả.
    expect(out.userIds).toContain(c.memberOk);
    expect(out.total).toBeGreaterThan(0);

    expect(out.userIds).not.toContain(c.memberResigned); // D7 — nghỉ việc không xoá mềm hàng nào
    expect(out.userIds).not.toContain(c.memberPending); // chờ duyệt chưa phải thành viên
    expect(out.userIds).not.toContain(c.outsider);
    expect(out.userIds).not.toContain(c.author); // excludeUserId
    expect(out.userIds).toHaveLength(1);
  });

  it("G14b — `audienceUserIds` trên bài thuộc nhóm ĐÃ XOÁ MỀM ⇒ rỗng (D13)", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      repo.audienceUserIds(
        tx,
        A.companyId,
        { audience: "group", orgUnitId: null, groupId: c.deletedGroupId },
        { excludeUserId: c.author, limit: 500 },
      ),
    );
    expect(out.userIds).toHaveLength(0);
  });

  it("G11 — `unackedEmployeesFor` liệt đúng thành viên chưa xác nhận, KHÔNG liệt người đã nghỉ", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      repo.unackedEmployeesFor(
        tx,
        A.companyId,
        { id: c.postId, audience: "group", orgUnitId: null, groupId: c.groupId },
        { page: 1, limit: 50 },
      ),
    );

    const names = out.rows.map((r) => r.fullName);
    expect(out.total).toBeGreaterThan(0); // neo dương
    expect(names.length).toBe(out.rows.length);

    const ids = await direct.query<{ user_id: string }>(
      `SELECT user_id FROM employee_profiles WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [A.companyId, out.rows.map((r) => r.employeeId)],
    );
    const userIds = ids.rows.map((r) => r.user_id);
    expect(userIds).toContain(c.memberOk);
    expect(userIds).toContain(c.author); // tác giả cũng là thành viên và chưa ack
    expect(userIds).not.toContain(c.memberResigned);
    expect(userIds).not.toContain(c.memberPending);
    expect(userIds).not.toContain(c.outsider);
  });

  it("G13 — `resolveMentions` nhận mention THÀNH VIÊN nhóm, bỏ người ngoài nhóm", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      resolveMentions(
        tx,
        actorOf(c.author, A.companyId),
        { audience: "group", orgUnitId: null, groupId: c.groupId },
        [c.memberOk, c.outsider],
      ),
    );

    expect(out.accepted.map((m) => m.userId)).toEqual([c.memberOk]); // neo dương
    expect(out.dropped.map((m) => m.userId)).toEqual([c.outsider]);
  });

  it("G13b — mention trong nhóm ĐÃ XOÁ MỀM: không ai được nhận (D13)", async () => {
    const out = await dbsvc.withTenant(A.companyId, (tx) =>
      resolveMentions(
        tx,
        actorOf(c.author, A.companyId),
        { audience: "group", orgUnitId: null, groupId: c.deletedGroupId },
        [c.memberOk],
      ),
    );
    expect(out.accepted).toHaveLength(0);
    expect(out.dropped.map((m) => m.userId)).toEqual([c.memberOk]);
  });
});
