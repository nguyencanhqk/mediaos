import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { expect } from "vitest";
import type { z } from "zod";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "./bootstrap-app";
import { directPool } from "./integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "./seed";
import { giveVerifiedAvatar, insertImageFile, setAvatarRaw } from "./social-avatar-fixtures";

/**
 * S16-SOCIAL-AVATARPRESIGN-1 — «thế giới» fixture DÙNG CHUNG của hai int-spec của WO (ca hành vi +
 * ca đếm câu). Tách ra để mỗi file < 800 dòng; mỗi file tự dựng MỘT thế giới riêng (tenant slug ngẫu
 * nhiên) — không chia sẻ trạng thái giữa hai file.
 *
 * Nhân vật:
 *   • `author` — avatar ĐÃ XÁC MINH `vA` (tệp image + link `ME/avatar` do chính mình tạo);
 *   • `viewer` — ĐẦU ĐỘC: `avatar_url = vA` (fileId của author);
 *   • `mod`    — quản trị (006 · 022 · 028/029 @Company · 059), KHÔNG avatar;
 *   • `jsP`/`dataP`/`extP` — `javascript:` · `data:` · `https://` ngoài; `foreignP` — fileId ĐÃ XÁC MINH
 *     của một người tenant B; `unlinkedP` — ảnh của chính mình nhưng KHÔNG link.
 * `author` + `viewer` sinh nhật HÔM NAY (026). Bài/đích dựng sẵn: xem các trường của `AvatarWorld`.
 */

export type Json = Record<string, unknown>;

export interface Who {
  token: string;
  userId: string;
  employeeId: string;
}
export interface Person {
  userId: string | null;
  employeeId: string;
}
/** Một điểm chiếu danh tính trên response — `avatar` là giá trị khoá `avatarUrl` (hoặc `avatar` của 026). */
export interface Shown {
  employeeId: string | null;
  avatar: string | null;
}

const LOGIN_PW = ["Passw0rd!", "savp1"].join("");

export const BASE = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "create:feed-kudos",
] as const;
/** Quản trị: kiểm duyệt bài (006) · tin (022) · hàng đợi báo cáo @Company (028/029). */
export const MOD = [
  ...BASE,
  "manage:feed-post",
  "manage:feed-news",
  "view:feed-report",
  "manage:feed-report",
] as const;
export const PLAIN = ["view:feed", "create:feed-post", "create:feed-comment"] as const;
/** Manager đơn vị — `view:feed-report` ở **Department** (D13-a: không thấy người tố giác). */
export const MGR_DEPT = ["view:feed", "view:feed-report"] as const;

export interface AvatarWorld {
  app: INestApplication;
  direct: Pool;
  A: SeededTenant;
  B: SeededTenant;
  dobToday: string;
  ouX: string;
  author: Who;
  viewer: Who;
  mod: Who;
  /** fileId ĐÃ XÁC MINH của `author` (và là giá trị đầu độc của `viewer`). */
  vA: string;
  jsP: Person;
  dataP: Person;
  extP: Person;
  foreignP: Person;
  unlinkedP: Person;
  /** share của author · share của viewer · kudos của mod → [viewer, author]. */
  sPostA: string;
  sPostV: string;
  kPost: string;
  /** kudos của mod → [author, jsP, dataP, extP, foreignP, unlinkedP]. */
  schemePost: string;
  /** tin `requiresAck` — viewer + author ĐÃ đọc / chưa ai đọc. */
  newsAck: string;
  newsUnack: string;
  /** nhóm public: mod (owner) + viewer + author. */
  groupId: string;
  /** viewer báo cáo `sPostA` (028). */
  rPoison: string;
  get(t: string, u: string): request.Test;
  post(t: string, u: string): request.Test;
  put(t: string, u: string): request.Test;
  patch(t: string, u: string): request.Test;
  login(
    tenant: SeededTenant,
    fullName: string,
    pairs: readonly string[],
    opts?: {
      orgUnitId?: string | null;
      dob?: string | null;
      reportScope?: "Company" | "Department";
    },
  ): Promise<Who>;
  person(
    tenant: SeededTenant,
    fullName: string,
    opts?: { dob?: string | null; account?: boolean },
  ): Promise<Person>;
  createPost(t: string, body: Json): Promise<string>;
  share(t: string, text: string): Promise<string>;
  kudos(t: string, recipientEmployeeIds: string[]): Promise<string>;
  report(t: string, postId: string): Promise<string>;
  /** GET 200 + parse bằng schema FE (lệch định dạng dây ⇒ đỏ ở BE). */
  getOk(t: string, u: string, schema: z.ZodTypeAny): Promise<Json>;
  close(): Promise<void>;
}

/** `MM-DD` hôm nay — sinh nhật "hôm nay" độc lập với ngày chạy (khuôn `social-be1b-discovery`). */
function todayMmDd(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function bootAvatarWorld(label: string): Promise<AvatarWorld> {
  const direct = directPool();
  const A = await seedCompany(direct, label);
  const B = await seedCompany(direct, `${label}b`);
  const companyIds = [A.companyId, B.companyId];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = applyMainPipeline(moduleRef.createNestApplication());
  await app.init();
  await app.listen(0);
  const hash = await app.get(PasswordService).hash(LOGIN_PW);

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
    reportScope: "Company" | "Department",
  ): Promise<void> {
    const roleId = await seedRole(direct, tenant.companyId, `savp-${randomUUID().slice(0, 8)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      const scope = resource === "feed-report" ? reportScope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);
  }

  async function profile(
    tenant: SeededTenant,
    userId: string | null,
    opts: { orgUnitId?: string | null; dob?: string | null },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles
         (company_id, user_id, org_unit_id, status, work_type, employee_code, date_of_birth)
       VALUES ($1, $2, $3, 'active', 'offline', $4, $5) RETURNING id`,
      [
        tenant.companyId,
        userId,
        opts.orgUnitId ?? null,
        `EMP-${randomUUID().slice(0, 8)}`,
        opts.dob ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  const login: AvatarWorld["login"] = async (tenant, fullName, pairs, opts = {}) => {
    const email = `u-${randomUUID().slice(0, 10)}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);
    const employeeId = await profile(tenant, userId, opts);
    await grant(tenant, userId, pairs, opts.reportScope ?? "Company");
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId, employeeId };
  };

  const person: AvatarWorld["person"] = async (tenant, fullName, opts = {}) => {
    let userId: string | null = null;
    if (opts.account !== false) {
      userId = await seedUser(direct, tenant.companyId, `p-${randomUUID().slice(0, 10)}@x.test`);
      await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, fullName]);
    }
    return { userId, employeeId: await profile(tenant, userId, { dob: opts.dob }) };
  };

  const createPost: AvatarWorld["createPost"] = async (t, body) => {
    const res = await post(t, "/social/posts").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };
  const share: AvatarWorld["share"] = (t, text) =>
    createPost(t, { type: "share", audience: "company", body: text });
  const kudos: AvatarWorld["kudos"] = (t, recipientEmployeeIds) =>
    createPost(t, {
      type: "kudos",
      audience: "company",
      kudos: { recipientEmployeeIds, message: "Cảm ơn" },
    });
  const report: AvatarWorld["report"] = async (t, postId) => {
    const res = await post(t, "/social/reports").send({
      targetType: "post",
      targetId: postId,
      reason: "spam",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };
  const getOk: AvatarWorld["getOk"] = async (t, u, schema) => {
    const res = await get(t, u);
    expect(res.status, `${u}: ${JSON.stringify(res.body)}`).toBe(200);
    schema.parse(res.body.data);
    return res.body.data as Json;
  };

  const dobToday = `1990-${todayMmDd()}`;
  const ouX = (
    await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [A.companyId, `X-${randomUUID().slice(0, 6)}`],
    )
  ).rows[0].id as string;

  const author = await login(A, "Avatar Tacgia", BASE, { dob: dobToday });
  const viewer = await login(A, "Avatar Nguoixem", BASE, { dob: dobToday });
  const mod = await login(A, "Kiemduyet Quantri", MOD);
  const vA = await giveVerifiedAvatar(direct, A.companyId, author.employeeId, author.userId);
  await setAvatarRaw(direct, viewer.employeeId, vA); // ĐẦU ĐỘC: trỏ ảnh của author

  const jsP = await person(A, "Avatar Js");
  await setAvatarRaw(direct, jsP.employeeId, "javascript:alert(1)");
  const dataP = await person(A, "Avatar Data");
  await setAvatarRaw(direct, dataP.employeeId, "data:image/png;base64,AAAA");
  const extP = await person(A, "Avatar Ext");
  await setAvatarRaw(direct, extP.employeeId, "https://cdn.example/a.png");
  const bOwner = await person(B, "Ngoai Tenant");
  const vB = await giveVerifiedAvatar(direct, B.companyId, bOwner.employeeId, bOwner.userId!);
  const foreignP = await person(A, "Muon Tenantb");
  await setAvatarRaw(direct, foreignP.employeeId, vB); // fileId ĐÃ XÁC MINH — nhưng ở tenant B
  const unlinkedP = await person(A, "Chua Lienket");
  // Ảnh của CHÍNH mình, KHÔNG link `ME/avatar`.
  await setAvatarRaw(
    direct,
    unlinkedP.employeeId,
    await insertImageFile(direct, A.companyId, unlinkedP.userId!),
  );

  const sPostA = await share(author.token, "Bài của tác giả");
  const sPostV = await share(viewer.token, "Bài của người xem");
  const kPost = await kudos(mod.token, [viewer.employeeId, author.employeeId]);
  const schemePost = await kudos(mod.token, [
    author.employeeId,
    jsP.employeeId,
    dataP.employeeId,
    extP.employeeId,
    foreignP.employeeId,
    unlinkedP.employeeId,
  ]);

  for (const who of [viewer, author]) {
    const c = await post(who.token, `/social/posts/${sPostA}/comments`).send({ body: "Bình luận" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const r = await put(who.token, `/social/posts/${sPostA}/reaction`).send({ emoji: "like" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  const news = { type: "news", audience: "company", body: "Tin cần đọc", requiresAck: true };
  const newsAck = await createPost(mod.token, news);
  const newsUnack = await createPost(mod.token, news);
  for (const who of [viewer, author]) {
    const ack = await post(who.token, `/social/posts/${newsAck}/ack`);
    expect(ack.status, JSON.stringify(ack.body)).toBe(201);
  }

  const groupId = (
    await direct.query(
      `INSERT INTO feed_groups (company_id, name, visibility, member_count)
       VALUES ($1, $2, 'public', 3) RETURNING id`,
      [A.companyId, `N ${randomUUID().slice(0, 8)}`],
    )
  ).rows[0].id as string;
  for (const [who, role] of [
    [mod, "owner"],
    [viewer, "member"],
    [author, "member"],
  ] as const) {
    await direct.query(
      `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status, joined_at)
       VALUES ($1, $2, $3, $4, 'active', now())`,
      [A.companyId, groupId, who.userId, role],
    );
  }

  const rPoison = await report(viewer.token, sPostA);

  return {
    app,
    direct,
    A,
    B,
    dobToday,
    ouX,
    author,
    viewer,
    mod,
    vA,
    jsP,
    dataP,
    extP,
    foreignP,
    unlinkedP,
    sPostA,
    sPostV,
    kPost,
    schemePost,
    newsAck,
    newsUnack,
    groupId,
    rPoison,
    get,
    post,
    put,
    patch,
    login,
    person,
    createPost,
    share,
    kudos,
    report,
    getOk,
    close: async () => {
      await app.close();
      await cleanupTenants(direct, companyIds);
      await direct.end();
    },
  };
}

// ─── Trích điểm chiếu danh tính khỏi response ─────────────────────────────────

export const authorOf = (p: Json): Shown => {
  const a = p.author as Json;
  return { employeeId: a.employeeId as string | null, avatar: a.avatarUrl as string | null };
};

export const recipientsOf = (p: Json): Shown[] =>
  (((p.kudos as Json | undefined)?.recipients as Json[] | undefined) ?? []).map((r) => ({
    employeeId: r.employeeId as string,
    avatar: r.avatarUrl as string | null,
  }));

export const peopleOfPost = (p: Json): Shown[] => [authorOf(p), ...recipientsOf(p)];

/** Danh sách phẳng `{employeeId, avatarUrl|avatar}` (013 · 022 · 026 · 037 · 059). */
export const peopleOfRows = (rows: Json[], avatarKey: "avatarUrl" | "avatar" = "avatarUrl") =>
  rows.map((r) => ({
    employeeId: r.employeeId as string | null,
    avatar: r[avatarKey] as string | null,
  }));

/** Ba người của một dòng báo cáo: reporter · resolver · tác giả đích (snapshot). */
export function reportPeople(r: Json): Shown[] {
  const out: Shown[] = [];
  for (const k of ["reporter", "resolvedBy"] as const) {
    const p = r[k] as Json | null;
    if (p) {
      out.push({ employeeId: p.employeeId as string | null, avatar: p.avatarUrl as string | null });
    }
  }
  const snap = r.targetSnapshot as Json | null;
  if (snap) {
    out.push({
      employeeId: snap.authorEmployeeId as string | null,
      avatar: snap.avatarUrl as string | null,
    });
  }
  return out;
}

export const byEmployee = (people: Shown[], employeeId: string): Shown | undefined =>
  people.find((p) => p.employeeId === employeeId);
