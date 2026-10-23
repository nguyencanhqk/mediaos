/**
 * S16-SOCIAL-BE-3A — CRUD CATALOG HUY HIỆU ở tầng HTTP: `049` POST · `050` PATCH · `051` DELETE (tắt)
 * · `056` GET `/social/kudos-badges/manage` (SOC-DEC-012). Plan D10–D13, ca K1–K5.
 *
 * ┌─ BA ĐIỀU CHỈ ĐO ĐƯỢC Ở TẦNG HTTP ──────────────────────────────────────────────────────────────┐
 * │ 1. Route tĩnh `manage` phải khai TRƯỚC `:badge_id` — khai sau thì `GET …/manage` không bao giờ   │
 * │    tới handler (Express khớp theo thứ tự đăng ký).                                              │
 * │ 2. `code` BẤT BIẾN là `.strict()` của Zod ⇒ 400, KHÔNG phải "bỏ qua lặng lẽ" (K4).              │
 * │ 3. Vượt trần `smallint`/`varchar(255)` phải chết ở Zod (400), không ở Postgres (500 `22003`).   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Tenant fixture có 0 huy hiệu (seeder master-data `return` khi `NODE_ENV=test` — xem đầu
 * `social-be2b2-kudos.int-spec.ts`). "Huy hiệu HỆ THỐNG" ở đây = spec tự INSERT đúng hàng mà mig
 * `0582` gieo (`teamwork`, position 1) — D11 nói huy hiệu hệ thống KHÔNG được đối xử riêng, nên hàng
 * do spec INSERT với cùng mã/cột là đối chứng trung thực.
 *
 * Luật §5: mỗi DENY có ALLOW đối chứng; assert theo HẰNG `SOCIAL_ERR`. GATE CỨNG `hasDb && LANE_DB`.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
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
const LOGIN_PW = ["Passw0rd!socialbe3a", "badges"].join("-");

/** Người quản trị catalog — cặp `manage:feed-kudos` (Company) + đủ cặp để đăng một vinh danh (D13). */
const MANAGER_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-kudos",
  "manage:feed-kudos",
] as const;
/** 🔴 Nhân viên thường: thiếu ĐÚNG `manage:feed-kudos` (K1). */
const EMPLOYEE_PAIRS = ["view:feed", "create:feed-post", "create:feed-kudos"] as const;

interface Who {
  token: string;
  userId: string;
  employeeId: string;
}

interface AdminBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-3A · CRUD catalog huy hiệu (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let manager: Who;
  let employee: Who;
  let bManager: Who;
  /** Huy hiệu "hệ thống" `teamwork` của A (hàng mig 0582 gieo). */
  let systemBadge = "";
  let badgeOfB = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  const uniqCode = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;

  async function makeUser(
    tenant: SeededTenant,
    label: string,
    hash: string,
    pairs: readonly string[],
  ): Promise<Who> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, `NS ${label}`]);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3) RETURNING id`,
      [tenant.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(
      direct,
      tenant.companyId,
      `p-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

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

  async function insertBadge(
    tenant: SeededTenant,
    code: string,
    opts: { name?: string; isActive?: boolean; position?: number; icon?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_kudos_badges (company_id, code, name, icon, is_active, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        tenant.companyId,
        code,
        opts.name ?? `Huy hiệu ${code}`,
        opts.icon ?? null,
        opts.isActive ?? true,
        opts.position ?? 10,
      ],
    );
    return r.rows[0].id as string;
  }

  const badgeRow = async (id: string) =>
    (
      await direct.query(
        `SELECT code, name, description, icon, position, is_active, updated_by
           FROM feed_kudos_badges WHERE id = $1`,
        [id],
      )
    ).rows[0] as
      | {
          code: string;
          name: string;
          description: string | null;
          icon: string | null;
          position: number;
          is_active: boolean;
          updated_by: string | null;
        }
      | undefined;

  const auditRows = async (badgeId: string) =>
    (
      await direct.query(
        `SELECT action, actor_user_id, metadata FROM audit_logs
          WHERE object_type = 'feed_kudos_badge' AND object_id = $1
          ORDER BY created_at, id`,
        [badgeId],
      )
    ).rows as Array<{ action: string; actor_user_id: string; metadata: Record<string, unknown> }>;

  const badgeCountOf = async (companyId: string) =>
    (
      await direct.query(`SELECT COUNT(*)::int AS n FROM feed_kudos_badges WHERE company_id = $1`, [
        companyId,
      ])
    ).rows[0].n as number;

  const adminList = async (who: Who, query = "page=1&limit=100") => {
    const res = await get(who.token, `/social/kudos-badges/manage?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { data: AdminBadge[]; page: number; limit: number; total: number };
  };

  const publicList = async (who: Who) => {
    const res = await get(who.token, `/social/kudos-badges?page=1&limit=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.data as Array<{ id: string; isActive?: boolean }>;
  };

  async function createBadge(body: Record<string, unknown>): Promise<AdminBadge> {
    const res = await post(manager.token, "/social/kudos-badges").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as AdminBadge;
  }

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sbe3akb");
    B = await seedCompany(direct, "sbe3akbb");
    companyIds.push(A.companyId, B.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    manager = await makeUser(A, "kbmanager", hash, MANAGER_PAIRS);
    employee = await makeUser(A, "kbemployee", hash, EMPLOYEE_PAIRS);
    bManager = await makeUser(B, "kbbmanager", hash, MANAGER_PAIRS);

    systemBadge = await insertBadge(A, "teamwork", {
      name: "Tinh thần đồng đội",
      icon: "users-round",
      position: 1,
    });
    badgeOfB = await insertBadge(B, uniqCode("bbadge"), { position: 1 });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ═════════════════ K1 — thiếu `manage:feed-kudos` ⇒ 403 trên CẢ BỐN route ═════════════════

  it("K1 — nhân viên gọi 049/050/051/056 ⇒ 403, catalog KHÔNG đổi; quản trị gọi cùng route ⇒ 2xx", async () => {
    const before = await badgeCountOf(A.companyId);
    const code = uniqCode("k1");

    const c = await post(employee.token, "/social/kudos-badges").send({ code, name: "K1" });
    expect(c.status, JSON.stringify(c.body)).toBe(403);
    const u = await patch(employee.token, `/social/kudos-badges/${systemBadge}`).send({
      name: "Bị chiếm",
    });
    expect(u.status, JSON.stringify(u.body)).toBe(403);
    const d = await del(employee.token, `/social/kudos-badges/${systemBadge}`);
    expect(d.status, JSON.stringify(d.body)).toBe(403);
    const l = await get(employee.token, "/social/kudos-badges/manage");
    expect(l.status, JSON.stringify(l.body)).toBe(403);

    expect(await badgeCountOf(A.companyId), "không hàng nào được tạo").toBe(before);
    const sys = await badgeRow(systemBadge);
    expect(sys?.name).toBe("Tinh thần đồng đội");
    expect(sys?.is_active).toBe(true);
    expect(await auditRows(systemBadge)).toHaveLength(0);

    // ALLOW đối chứng — cùng route, vai có cặp.
    const ok = await createBadge({ code, name: "K1 allow" });
    expect(ok.code).toBe(code);
    expect((await adminList(manager)).data.some((b) => b.id === ok.id)).toBe(true);
    // `048` của nhân viên vẫn mở (`view:feed`) — K1 chặn ĐÚNG nhóm quản trị, không chặn nhầm catalog.
    expect((await publicList(employee)).some((b) => b.id === ok.id)).toBe(true);
  });

  // ═════════════════ K2 — `badge_id` của tenant khác ⇒ 404 ═════════════════

  it("K2 — PATCH/DELETE huy hiệu của công ty B ⇒ 404 KUDOS_BADGE_NOT_FOUND, hàng của B nguyên vẹn", async () => {
    const u = await patch(manager.token, `/social/kudos-badges/${badgeOfB}`).send({
      name: "Chiếm chéo",
    });
    expect(u.status, JSON.stringify(u.body)).toBe(404);
    expect(JSON.stringify(u.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND);
    expect(u.body.error?.code).toBe(SOCIAL_ERROR_CODES.KUDOS_BADGE_NOT_FOUND);

    const d = await del(manager.token, `/social/kudos-badges/${badgeOfB}`);
    expect(d.status, JSON.stringify(d.body)).toBe(404);
    expect(JSON.stringify(d.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND);

    // Uuid không tồn tại ở đâu cả ⇒ CÙNG mã (không phân biệt "có ở tenant khác").
    const ghost = await del(manager.token, `/social/kudos-badges/${randomUUID()}`);
    expect(ghost.status).toBe(404);
    expect(JSON.stringify(ghost.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_NOT_FOUND);

    const b = await badgeRow(badgeOfB);
    expect(b?.is_active).toBe(true);
    expect(b?.name).not.toBe("Chiếm chéo");
    expect(await auditRows(badgeOfB)).toHaveLength(0);

    // `056` của A không lộ huy hiệu B.
    expect((await adminList(manager)).data.some((x) => x.id === badgeOfB)).toBe(false);
    // ALLOW đối chứng — quản trị B sửa được huy hiệu của chính B.
    const own = await patch(bManager.token, `/social/kudos-badges/${badgeOfB}`).send({
      name: "B tự sửa",
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
  });

  it("K2b — `badge_id` không phải uuid ⇒ 400 (ParseUUIDPipe), không 500", async () => {
    const res = await patch(manager.token, "/social/kudos-badges/not-a-uuid").send({ name: "x" });
    expect(res.status).toBe(400);
  });

  // ═════════════════ K3 — mã trùng ⇒ 409 ═════════════════

  it("K3 — code trùng (đang bật · đã tắt · mã hệ thống) ⇒ 409 KUDOS_BADGE_CODE_TAKEN; tenant khác cùng code ⇒ 201", async () => {
    const liveCode = uniqCode("k3live");
    await createBadge({ code: liveCode, name: "Đang bật" });
    const offCode = uniqCode("k3off");
    await insertBadge(A, offCode, { isActive: false });
    const before = await badgeCountOf(A.companyId);

    for (const code of [liveCode, offCode, "teamwork"]) {
      const res = await post(manager.token, "/social/kudos-badges").send({ code, name: "Trùng" });
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_CODE_TAKEN);
      expect(res.body.error?.code).toBe(SOCIAL_ERROR_CODES.KUDOS_BADGE_CODE_TAKEN);
    }
    expect(await badgeCountOf(A.companyId)).toBe(before);

    // UNIQUE là PER-COMPANY: cùng mã ở B là hợp lệ.
    const inB = await post(bManager.token, "/social/kudos-badges").send({
      code: liveCode,
      name: "Của B",
    });
    expect(inB.status, JSON.stringify(inB.body)).toBe(201);
  });

  // ═════════════════ K4 · K5 — validation ở Zod ═════════════════

  it("K4 — `code` trong PATCH ⇒ 400, code KHÔNG đổi", async () => {
    const res = await patch(manager.token, `/social/kudos-badges/${systemBadge}`).send({
      code: "renamed",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const res2 = await patch(manager.token, `/social/kudos-badges/${systemBadge}`).send({
      code: "renamed",
      name: "Có kèm tên",
    });
    expect(res2.status).toBe(400);
    const empty = await patch(manager.token, `/social/kudos-badges/${systemBadge}`).send({});
    expect(empty.status, "PATCH rỗng ⇒ 400").toBe(400);
    expect((await badgeRow(systemBadge))?.code).toBe("teamwork");
  });

  it("K5 — position 40000 / name 300 ký tự / code sai mẫu ⇒ 400 (không 500), không ghi gì", async () => {
    const before = await badgeCountOf(A.companyId);
    const bads: Array<Record<string, unknown>> = [
      { code: uniqCode("k5"), name: "x", position: 40000 },
      { code: uniqCode("k5"), name: "x".repeat(300) },
      { code: uniqCode("k5"), name: "x", position: -1 },
      { code: "Hoa-Chu", name: "x" },
      { code: "x", name: "x" },
      { code: uniqCode("k5"), name: "x", icon: "i".repeat(65) },
      { code: uniqCode("k5"), name: "x", extra: 1 },
    ];
    for (const body of bads) {
      const res = await post(manager.token, "/social/kudos-badges").send(body);
      expect(res.status, `${JSON.stringify(body).slice(0, 80)}: ${res.status}`).toBe(400);
    }
    for (const body of [{ position: 40000 }, { name: "y".repeat(300) }, { isActive: "yes" }]) {
      const res = await patch(manager.token, `/social/kudos-badges/${systemBadge}`).send(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await badgeCountOf(A.companyId)).toBe(before);
    expect((await badgeRow(systemBadge))?.position).toBe(1);
  });

  // ═════════════════ ALLOW — 049 tạo + audit ═════════════════

  it("049 — tạo ⇒ 201 DTO quản trị (isActive=true, position mặc định 0) + ĐÚNG 1 dòng audit create", async () => {
    const code = uniqCode("new");
    const b = await createBadge({ code, name: "  Mới  ", description: "Mô tả", icon: "star" });
    expect(b).toMatchObject({
      code,
      name: "Mới",
      description: "Mô tả",
      icon: "star",
      position: 0,
      isActive: true,
    });
    expect(typeof b.createdAt).toBe("string");

    const rows = await auditRows(b.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("social.kudos_badge.create");
    expect(rows[0].actor_user_id).toBe(manager.userId);
    expect(rows[0].metadata).toMatchObject({ badgeId: b.id, code });
  });

  // ═════════════════ ALLOW — 050 sửa: audit CHỈ trường đổi ═════════════════

  it("050 — sửa ⇒ 200, audit chỉ chở trường THẬT SỰ đổi (from/to); gửi lại y hệt ⇒ 200 KHÔNG audit", async () => {
    const b = await createBadge({ code: uniqCode("upd"), name: "Cũ", icon: "star", position: 3 });

    const res = await patch(manager.token, `/social/kudos-badges/${b.id}`).send({
      name: "Mới",
      icon: "star", // KHÔNG đổi ⇒ không được xuất hiện trong audit
      position: 7,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: b.id, name: "Mới", icon: "star", position: 7 });

    const row = await badgeRow(b.id);
    expect(row).toMatchObject({ name: "Mới", position: 7, updated_by: manager.userId });

    const rows = await auditRows(b.id);
    expect(rows.map((r) => r.action)).toEqual([
      "social.kudos_badge.create",
      "social.kudos_badge.update",
    ]);
    const changes = rows[1].metadata.changes as Record<string, unknown>;
    expect(changes).toEqual({
      name: { from: "Cũ", to: "Mới" },
      position: { from: 3, to: 7 },
    });

    // Không có thay đổi hiệu lực ⇒ 200 trả trạng thái hiện tại, KHÔNG thêm dòng audit.
    const same = await patch(manager.token, `/social/kudos-badges/${b.id}`).send({
      name: "Mới",
      position: 7,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body.data).toMatchObject({ id: b.id, name: "Mới", position: 7 });
    expect(await auditRows(b.id)).toHaveLength(2);
  });

  // ═════════════════ ALLOW — 051 tắt · lặp · bật lại huy hiệu hệ thống ═════════════════

  it("051 — tắt ⇒ is_active=false + 1 audit; gọi lại ⇒ 200 KHÔNG audit mới; 050 isActive:true bật lại huy hiệu HỆ THỐNG", async () => {
    const d1 = await del(manager.token, `/social/kudos-badges/${systemBadge}`);
    expect(d1.status, JSON.stringify(d1.body)).toBe(200);
    expect(d1.body.data).toMatchObject({ id: systemBadge, code: "teamwork", isActive: false });
    expect((await badgeRow(systemBadge))?.is_active).toBe(false);
    let rows = await auditRows(systemBadge);
    expect(rows.map((r) => r.action)).toEqual(["social.kudos_badge.deactivate"]);
    expect(rows[0].metadata).toMatchObject({ badgeId: systemBadge, code: "teamwork" });

    const d2 = await del(manager.token, `/social/kudos-badges/${systemBadge}`);
    expect(d2.status, JSON.stringify(d2.body)).toBe(200);
    expect(d2.body.data.isActive).toBe(false);
    expect(await auditRows(systemBadge), "lượt tắt thứ hai KHÔNG sinh audit").toHaveLength(1);

    // 048 (nhân viên) KHÔNG thấy; 056 (quản trị) THẤY kèm isActive=false.
    expect((await publicList(employee)).some((b) => b.id === systemBadge)).toBe(false);
    const inAdmin = (await adminList(manager)).data.find((b) => b.id === systemBadge);
    expect(inAdmin?.isActive).toBe(false);

    // D11 — bật lại qua 050.
    const on = await patch(manager.token, `/social/kudos-badges/${systemBadge}`).send({
      isActive: true,
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data.isActive).toBe(true);
    rows = await auditRows(systemBadge);
    expect(rows.map((r) => r.action)).toEqual([
      "social.kudos_badge.deactivate",
      "social.kudos_badge.update",
    ]);
    expect(rows[1].metadata.changes).toEqual({ isActive: { from: false, to: true } });
    expect((await publicList(employee)).some((b) => b.id === systemBadge)).toBe(true);
  });

  // ═════════════════ 056 — thứ tự ổn định khi position trùng ═════════════════

  it("056 — ORDER BY position, id ổn định khi position trùng; phân trang không lặp/mất hàng", async () => {
    const tied = [
      await createBadge({ code: uniqCode("tie"), name: "Hoà 1", position: 900 }),
      await createBadge({ code: uniqCode("tie"), name: "Hoà 2", position: 900 }),
      await createBadge({ code: uniqCode("tie"), name: "Hoà 3", position: 900 }),
    ];

    const full = await adminList(manager);
    expect(full.total).toBe(full.data.length);
    const sorted = [...full.data].sort((a, b) =>
      a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    expect(full.data.map((b) => b.id)).toEqual(sorted.map((b) => b.id));
    const tiedIds = full.data.filter((b) => b.position === 900).map((b) => b.id);
    expect(tiedIds).toEqual(tied.map((b) => b.id).sort());

    // Ghép các trang cỡ 2 = danh sách đầy đủ (không lặp, không mất).
    const paged: string[] = [];
    for (let page = 1; page <= Math.ceil(full.total / 2); page++) {
      const p = await adminList(manager, `page=${page}&limit=2`);
      expect(p.total).toBe(full.total);
      paged.push(...p.data.map((b) => b.id));
    }
    expect(paged).toEqual(full.data.map((b) => b.id));

    // Trang vượt biên: data rỗng, total vẫn đúng.
    const beyond = await adminList(manager, `page=${full.total + 5}&limit=2`);
    expect(beyond.data).toHaveLength(0);
    expect(beyond.total).toBe(full.total);
  });

  // ═════════════════ D13 — vinh danh CŨ vẫn hiện huy hiệu đã tắt ═════════════════

  it("D13 — tắt huy hiệu KHÔNG làm vinh danh cũ mất huy hiệu trên 047; chọn mới ⇒ 422 ERR-022", async () => {
    const b = await createBadge({ code: uniqCode("hist"), name: "Lịch sử" });
    const created = await post(manager.token, "/social/posts").send({
      type: "kudos",
      audience: "company",
      kudos: { recipientEmployeeIds: [employee.employeeId], badgeId: b.id, message: "Cảm ơn" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const postId = created.body.data.id as string;

    const off = await del(manager.token, `/social/kudos-badges/${b.id}`);
    expect(off.status).toBe(200);

    const list = await get(employee.token, "/social/kudos?page=1&limit=50");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const item = (
      list.body.data.data as Array<{ postId: string; badge: { id: string; code: string } | null }>
    ).find((k) => k.postId === postId);
    expect(item, "bài cũ vẫn có mặt").toBeDefined();
    expect(item?.badge?.id).toBe(b.id);

    const again = await post(manager.token, "/social/posts").send({
      type: "kudos",
      audience: "company",
      kudos: { recipientEmployeeIds: [employee.employeeId], badgeId: b.id, message: "Lần 2" },
    });
    expect(again.status, JSON.stringify(again.body)).toBe(422);
    expect(JSON.stringify(again.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_INVALID);
  });
});
