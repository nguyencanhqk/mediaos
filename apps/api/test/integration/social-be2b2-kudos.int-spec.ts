/**
 * S16-SOCIAL-BE-2B-2 — VINH DANH ở tầng HTTP (`002/kudos` · `047` · `048`) + NOTI-033.
 *
 * ┌─ BẤT BIẾN ĐẮT NHẤT CỦA CỤM NÀY LÀ MỘT PHÉP GHÉP KHOÁ ─────────────────────────────────────────┐
 * │ `feed_kudos_recipients.employee_id` neo theo **NHÂN SỰ**, NOTI gửi theo **TÀI KHOẢN** (`user_id`).│
 * │ Và **nghỉ việc KHÔNG xoá mềm** — `employee_profiles.status='resigned'` mà `deleted_at` vẫn NULL.  │
 * │ Nghĩa là một vị từ chỉ lọc `deleted_at` sẽ gửi thông báo cho người đã rời công ty, **không lỗi    │
 * │ gì cả**. Đó là lớp lỗi mà BA reviewer độc lập cùng bắt ở BE-1B, và nó chỉ đo được ở tầng HTTP:    │
 * │ đường ghi CHO PHÉP vinh danh người đã nghỉ (owner ký S6), nên vế chặn nằm ở NOTI — tức phải ghi   │
 * │ thật, rồi đếm hàng outbox bằng SQL độc lập.                                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Tenant fixture có 0 hàng `feed_kudos_badges`** (đo 24/09/2026 — U6): `MasterDataSeedBootstrapService`
 * `return` ngay khi `NODE_ENV=test`, và migration `0582` `CROSS JOIN companies` chạy lúc lane chưa có
 * công ty nào. Spec tự INSERT huy hiệu (`0580:559` đã cấp INSERT cho app role). Đừng "sửa" bằng cách
 * bật seeder trong test — làm vậy là cho một tiến trình khác ghi vào lane dùng chung.
 *
 * Luật §5: mỗi DENY có ALLOW đối chứng; assert theo **HẰNG MÃ LỖI**. GATE CỨNG `hasDb && LANE_DB`.
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
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
const LOGIN_PW = "Passw0rd!socialbe2b2kudos";

const KUDOS_PAIRS = ["view:feed", "create:feed-post", "create:feed-kudos"] as const;
/** 🔴 Vai TUỲ BIẾN của ca `T-2`: THIẾU ĐÚNG `create:feed-kudos`. */
const NO_KUDOS_PAIRS = ["view:feed", "create:feed-post"] as const;
/** Vai được đăng vinh danh CHÍNH THỨC của công ty. */
const OFFICIAL_PAIRS = [...KUDOS_PAIRS, "manage:feed-kudos"] as const;

interface Who {
  token: string;
  userId: string;
  employeeId: string;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2B-2 · vinh danh (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let outboxLock: OutboxWorkerLock | undefined;
  const companyIds: string[] = [];

  let author: Who;
  let official: Who;
  let noKudos: Who;
  let r1: Who;
  let r2: Who;
  /** `employee_profiles.status = 'resigned'`, `deleted_at` NULL — ca `K-4`/`K-8`. */
  let resigned: Who;
  /** `users.status = 'suspended'` — ca `K-4b`. Xem ghi chú ở chỗ dựng fixture về tập giá trị hợp lệ. */
  let lockedAccount: Who;
  /** Người của đơn vị KHÁC — ca `K-5`. */
  let outsider: Who;
  let bAuthor: Who;

  /** `employee_profiles` KHÔNG có `users` (`user_id` NULL) — ca `K-4c`. U7 đã đo: DỰNG ĐƯỢC. */
  let ghostEmployeeId = "";
  let ouSales = "";
  let ouTech = "";
  let badgeOn = "";
  let badgeOff = "";
  let badgeOfB = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  /** Xem docblock cùng tên ở `social-be2b2-ideas.int-spec.ts` — vai TUỲ BIẾN, không đụng vai canonical. */
  async function makeUser(
    tenant: SeededTenant,
    label: string,
    hash: string,
    opts: {
      pairs?: readonly string[];
      orgUnitId?: string | null;
      scope?: "Company" | "Department";
      employeeStatus?: string;
      userStatus?: string;
    } = {},
  ): Promise<Who> {
    const {
      pairs = KUDOS_PAIRS,
      orgUnitId = null,
      scope = "Company",
      employeeStatus = "active",
      userStatus,
    } = opts;
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
      userId,
      `Nhân sự ${label}`,
    ]);

    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, $4, 'offline', $5) RETURNING id`,
      [tenant.companyId, userId, orgUnitId, employeeStatus, `EMP-${randomUUID().slice(0, 6)}`],
    );

    const roleId = await seedRole(
      direct,
      tenant.companyId,
      `p-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      const s = key === "create:feed-kudos" || key === "manage:feed-kudos" ? scope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", s);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

    const res = await http()
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    const token = res.body.data.accessToken as string;

    // Khoá tài khoản SAU khi đăng nhập: `K-4b` cần một người nhận có `users.status='inactive'` nhưng
    // vẫn là nhân sự `active` — không cần token của họ.
    if (userStatus && userStatus !== "active") {
      await direct.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, userStatus]);
    }

    return { token, userId, employeeId: emp.rows[0].id as string };
  }

  async function seedOrgUnit(tenant: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [tenant.companyId, name],
    );
    return r.rows[0].id as string;
  }

  /** Huy hiệu của spec — xem ⚠️ U6 ở đầu file: tenant fixture KHÔNG có huy hiệu nào. */
  async function seedBadge(
    tenant: SeededTenant,
    code: string,
    isActive: boolean,
    position: number,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO feed_kudos_badges (company_id, code, name, is_active, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant.companyId, code, `Huy hiệu ${code}`, isActive, position],
    );
    return r.rows[0].id as string;
  }

  async function createKudos(
    token: string,
    opts: {
      recipients: string[];
      badgeId?: string | null;
      isOfficial?: boolean;
      message?: string;
      audience?: "company" | "org_unit";
      orgUnitId?: string;
    },
  ): Promise<{ postId: string; status: number; body: unknown }> {
    const res = await post(token, "/social/posts").send({
      type: "kudos",
      audience: opts.audience ?? "company",
      ...(opts.orgUnitId ? { orgUnitId: opts.orgUnitId } : {}),
      kudos: {
        recipientEmployeeIds: opts.recipients,
        ...(opts.badgeId === undefined ? {} : { badgeId: opts.badgeId }),
        message: opts.message ?? `Cảm ơn ${randomUUID().slice(0, 6)}`,
        ...(opts.isOfficial === undefined ? {} : { isOfficial: opts.isOfficial }),
      },
    });
    return {
      postId: res.status === 201 ? (res.body.data.id as string) : "",
      status: res.status,
      body: res.body,
    };
  }

  const kudosRow = async (postId: string) =>
    (
      await direct.query(
        `SELECT id, badge_id, message, is_official FROM feed_kudos WHERE post_id = $1`,
        [postId],
      )
    ).rows[0] as
      | { id: string; badge_id: string | null; message: string | null; is_official: boolean }
      | undefined;

  const kudosCountOf = async (companyId: string, authorUserId: string) =>
    (
      await direct.query(
        `SELECT COUNT(*)::int AS n FROM feed_kudos k
           JOIN feed_posts p ON p.company_id = k.company_id AND p.id = k.post_id
          WHERE k.company_id = $1 AND p.author_user_id = $2`,
        [companyId, authorUserId],
      )
    ).rows[0].n as number;

  const recipientCount = async (postId: string) =>
    (
      await direct.query(
        `SELECT COUNT(*)::int AS n FROM feed_kudos_recipients r
           JOIN feed_kudos k ON k.company_id = r.company_id AND k.id = r.kudos_id
          WHERE k.post_id = $1`,
        [postId],
      )
    ).rows[0].n as number;

  const outboxRows = async (postId: string) =>
    (
      await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.kudos_received' AND payload->>'post_id' = $1
          ORDER BY created_at`,
        [postId],
      )
    ).rows as Array<{ payload: Record<string, unknown> }>;

  const notiCount = async (userId: string, postId: string) =>
    (
      await direct.query(
        `SELECT COUNT(*)::int AS n FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2
            AND event_code = 'SOCIAL_KUDOS_RECEIVED'
            AND payload->>'post_id' = $3 AND deleted_at IS NULL`,
        [A.companyId, userId, postId],
      )
    ).rows[0].n as number;

  const kudosListOf = async (who: Who, query = "page=1&limit=50") => {
    const res = await get(who.token, `/social/kudos?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return {
      rows: res.body.data.data as Array<{
        kudosId: string;
        postId: string;
        isOfficial: boolean;
        badge: { id: string; code: string } | null;
        recipients: Array<{
          employeeId: string;
          fullName: string | null;
          isFormerEmployee: boolean;
        }>;
      }>,
      total: res.body.data.total as number,
      raw: JSON.stringify(res.body),
    };
  };

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2b2kudos");
    B = await seedCompany(direct, "sb2b2kudosb");
    companyIds.push(A.companyId, B.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    outboxLock = await acquireOutboxWorkerLock("social-be2b2-kudos");

    ouSales = await seedOrgUnit(A, `Sales-${randomUUID().slice(0, 6)}`);
    ouTech = await seedOrgUnit(A, `Tech-${randomUUID().slice(0, 6)}`);

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    author = await makeUser(A, "kudauthor", hash, { orgUnitId: ouSales });
    official = await makeUser(A, "kudofficial", hash, {
      pairs: OFFICIAL_PAIRS,
      orgUnitId: ouSales,
    });
    noKudos = await makeUser(A, "kudnokudos", hash, {
      pairs: NO_KUDOS_PAIRS,
      orgUnitId: ouSales,
    });
    r1 = await makeUser(A, "kudr1", hash, { orgUnitId: ouSales });
    r2 = await makeUser(A, "kudr2", hash, { orgUnitId: ouSales });
    resigned = await makeUser(A, "kudresigned", hash, {
      orgUnitId: ouSales,
      employeeStatus: "resigned",
    });
    // 🔴 `'suspended'`, KHÔNG `'inactive'`: `users_status_chk` = {active, invited, suspended, locked}
    // (đo 24/09/2026 — `'inactive'` là giá trị của `employee_profiles.status`, hai bảng hai tập KHÁC
    // nhau). Gõ nhầm ở đây thì fixture chết bằng `23514` trong `beforeAll` và toàn bộ 29 ca SKIP —
    // trông y hệt "spec chưa chạy" chứ không giống một lỗi.
    lockedAccount = await makeUser(A, "kudlocked", hash, {
      orgUnitId: ouSales,
      userStatus: "suspended",
    });
    outsider = await makeUser(A, "kudoutsider", hash, { orgUnitId: ouTech });
    bAuthor = await makeUser(B, "kudbauthor", hash);

    // K-4c (U7 đã đo: `employee_profiles.user_id` NULLABLE từ mig 0442).
    const ghost = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, NULL, $2, 'active', 'offline', $3) RETURNING id`,
      [A.companyId, ouSales, `EMP-GHOST-${randomUUID().slice(0, 6)}`],
    );
    ghostEmployeeId = ghost.rows[0].id as string;

    badgeOn = await seedBadge(A, `on-${randomUUID().slice(0, 6)}`, true, 1);
    badgeOff = await seedBadge(A, `off-${randomUUID().slice(0, 6)}`, false, 2);
    badgeOfB = await seedBadge(B, `bon-${randomUUID().slice(0, 6)}`, true, 1);
  }, 180_000);

  afterAll(async () => {
    await outboxLock?.release();
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  // ═════════════════ U6 — phép đo NỀN của cả K-0/K-6 ═════════════════

  it("U6 — tenant fixture KHÔNG có huy hiệu nào từ seeder; huy hiệu của spec là do spec tự INSERT", async () => {
    const r = await direct.query(
      `SELECT COUNT(*)::int AS n FROM feed_kudos_badges WHERE company_id = $1 AND code LIKE 'teamwork'`,
      [A.companyId],
    );
    // Nếu ngày nào đó seeder CHẠY trong test, ca này đỏ và cả K-0/K-6 phải xem lại tiền đề (chúng giả
    // định catalog chỉ có đúng huy hiệu spec tạo).
    expect(r.rows[0].n, "seeder master-data KHÔNG được chạy trong NODE_ENV=test").toBe(0);
    const mine = await direct.query(
      `SELECT COUNT(*)::int AS n FROM feed_kudos_badges WHERE company_id = $1`,
      [A.companyId],
    );
    expect(mine.rows[0].n, "neo dương: 2 huy hiệu spec tự tạo").toBe(2);
  });

  // ═════════════════ T-2 — cặp quyền theo `type` ═════════════════

  it("T-2 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-kudos` ⇒ 403, KHÔNG hàng nào được ghi", async () => {
    const share = await post(noKudos.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài thường — neo dương của T-2",
    });
    expect(share.status, JSON.stringify(share.body)).toBe(201);

    const denied = await createKudos(noKudos.token, { recipients: [r1.employeeId] });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_CREATE_REQUIRED);
    expect(await kudosCountOf(A.companyId, noKudos.userId)).toBe(0);

    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await recipientCount(ok.postId)).toBe(1);
  });

  it("T-4b — `type='kudos'` KHÔNG có `body` ⇒ 201 (CHECK miễn `kudos`, khác `idea`)", async () => {
    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const p = await direct.query(`SELECT body FROM feed_posts WHERE id = $1`, [ok.postId]);
    expect(p.rows[0].body, "`body` NULL là hợp lệ với kudos").toBeNull();
  });

  // ═════════════════ K-0 · K-0b — huy hiệu (ERR-022) ═════════════════

  it("K-0 — huy hiệu `is_active=false` ⇒ 422 SOCIAL-ERR-022, `COUNT(*) feed_kudos = 0`", async () => {
    const before = await kudosCountOf(A.companyId, author.userId);

    const denied = await createKudos(author.token, {
      recipients: [r1.employeeId],
      badgeId: badgeOff,
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(422);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_INVALID);
    expect(await kudosCountOf(A.companyId, author.userId), "không hàng nào thêm").toBe(before);

    const ok = await createKudos(author.token, {
      recipients: [r1.employeeId],
      badgeId: badgeOn,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await kudosRow(ok.postId))?.badge_id).toBe(badgeOn);
  });

  it("K-0b — huy hiệu của TENANT KHÁC ⇒ 422, CÙNG chuỗi (không phân biệt ba lý do)", async () => {
    const denied = await createKudos(author.token, {
      recipients: [r1.employeeId],
      badgeId: badgeOfB,
    });
    expect(denied.status).toBe(422);
    // Cùng luật chống-oracle như `POST_NOT_FOUND`: phân biệt "không có" với "tenant khác" là nói cho
    // người gọi biết một uuid huy hiệu của công ty khác CÓ THẬT.
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_BADGE_INVALID);
  });

  it("`badgeId` vắng HẲN là hợp lệ (vinh danh không gắn huy hiệu)", async () => {
    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status).toBe(201);
    expect((await kudosRow(ok.postId))?.badge_id).toBeNull();
  });

  // ═════════════════ K-1 · K-2 · K-2b — danh sách người nhận ═════════════════

  it("K-1 — người nhận TRÙNG tác giả ⇒ 422 tự-vinh-danh, `COUNT = 0`", async () => {
    const before = await kudosCountOf(A.companyId, author.userId);
    const denied = await createKudos(author.token, {
      recipients: [r1.employeeId, author.employeeId],
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(422);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_SELF_RECIPIENT);
    expect(await kudosCountOf(A.companyId, author.userId)).toBe(before);

    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status).toBe(201);
  });

  it("K-1b — tự vinh danh gửi bằng chữ HOA vẫn bị chặn (chuẩn hoá trước khi so)", async () => {
    const denied = await createKudos(author.token, {
      recipients: [author.employeeId.toUpperCase()],
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(422);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_SELF_RECIPIENT);
  });

  it("K-2 — 11 người nhận ⇒ 422 trần; mảng RỖNG ⇒ cùng mã; 10 người ⇒ 201 + đúng 10 hàng", async () => {
    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    const many: string[] = [];
    for (let i = 0; i < 11; i++) {
      const w = await makeUser(A, `kudmany${i}-${randomUUID().slice(0, 4)}`, hash, {
        orgUnitId: ouSales,
      });
      many.push(w.employeeId);
    }

    const over = await createKudos(author.token, { recipients: many });
    expect(over.status, JSON.stringify(over.body)).toBe(422);
    expect(JSON.stringify(over.body)).toContain(SOCIAL_ERR.KUDOS_RECIPIENT_LIMIT);

    // Mảng RỖNG: hình dạng hợp lệ, nghiệp vụ vô nghĩa ⇒ 422 CÓ MÃ, không phải 400 vô danh của Zod.
    const empty = await createKudos(author.token, { recipients: [] });
    expect(empty.status, JSON.stringify(empty.body)).toBe(422);
    expect(JSON.stringify(empty.body)).toContain(SOCIAL_ERR.KUDOS_RECIPIENT_LIMIT);

    const ok = await createKudos(author.token, { recipients: many.slice(0, 10) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await recipientCount(ok.postId), "đúng 10 hàng người nhận").toBe(10);
  });

  it("K-2b — `employeeId` không thuộc tenant / không tồn tại ⇒ 422 người-nhận-không-hợp-lệ", async () => {
    const before = await kudosCountOf(A.companyId, author.userId);

    const stranger = await createKudos(author.token, { recipients: [randomUUID()] });
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(422);
    expect(JSON.stringify(stranger.body)).toContain(SOCIAL_ERR.KUDOS_RECIPIENT_INVALID);

    // ⚠️ Cross-tenant: FK tổ hợp `feed_kudos_recipients_employee_tenant_fk` (`0580:439`) đã chặn ở tầng
    // DB bằng `23503`, nên ca này đo **CHẤT LƯỢNG MÃ LỖI** (422 đọc được thay vì 500), không phải một
    // lỗ bảo mật đang mở.
    const bEmp = await direct.query(
      `SELECT id FROM employee_profiles WHERE company_id = $1 LIMIT 1`,
      [B.companyId],
    );
    const crossTenant = await createKudos(author.token, {
      recipients: [bEmp.rows[0].id as string],
    });
    expect(crossTenant.status).toBe(422);
    expect(JSON.stringify(crossTenant.body)).toContain(SOCIAL_ERR.KUDOS_RECIPIENT_INVALID);

    expect(await kudosCountOf(A.companyId, author.userId)).toBe(before);

    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status).toBe(201);
  });

  // ═════════════════ K-3 — cờ `isOfficial` ═════════════════

  it("K-3 — `isOfficial:true` thiếu `manage:feed-kudos` ⇒ 403, `COUNT(*) feed_kudos = 0`", async () => {
    const before = await kudosCountOf(A.companyId, author.userId);

    const denied = await createKudos(author.token, {
      recipients: [r1.employeeId],
      isOfficial: true,
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.KUDOS_OFFICIAL_DENIED);
    // 🔴 Cổng chạy TRƯỚC khi mở tx ⇒ "không ghi gì" là BẤT BIẾN, không phải hệ quả của rollback đúng.
    expect(await kudosCountOf(A.companyId, author.userId)).toBe(before);

    // ALLOW đối chứng #1: CÙNG người, KHÔNG cờ ⇒ 201 (403 trên đến từ cờ, không từ cặp theo loại bài).
    const plain = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(plain.status).toBe(201);
    expect((await kudosRow(plain.postId))?.is_official).toBe(false);

    // ALLOW đối chứng #2: người CÓ `manage:feed-kudos` ⇒ 201 và `is_official = true` THẬT.
    const ok = await createKudos(official.token, {
      recipients: [r1.employeeId],
      isOfficial: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await kudosRow(ok.postId))?.is_official).toBe(true);
  });

  it("K-3b — `manage:feed-kudos` @Department (hẹp hơn sàn) ⇒ 403 cờ chính thức", async () => {
    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    const deptOfficial = await makeUser(A, `kuddept-${randomUUID().slice(0, 6)}`, hash, {
      pairs: OFFICIAL_PAIRS,
      orgUnitId: ouSales,
      scope: "Department",
    });

    const denied = await createKudos(deptOfficial.token, {
      recipients: [r1.employeeId],
      isOfficial: true,
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    // Cả hai cặp của vai này đều @Department, nên 403 có thể đến từ cặp theo-loại-bài HOẶC từ cờ —
    // assert nó là MỘT TRONG HAI chuỗi SOCIAL, và ALLOW đối chứng chốt rằng cổng thật sự phân biệt.
    const raw = JSON.stringify(denied.body);
    expect(
      raw.includes(SOCIAL_ERR.KUDOS_OFFICIAL_DENIED) ||
        raw.includes(SOCIAL_ERR.KUDOS_CREATE_REQUIRED),
      `403 phải mang mã SOCIAL, nhận: ${raw}`,
    ).toBe(true);

    const ok = await createKudos(official.token, {
      recipients: [r1.employeeId],
      isOfficial: true,
    });
    expect(ok.status).toBe(201);
  });

  // ═════════════════ K-4 · K-4b · K-4c — NOTI-033 lọc người CÒN HOẠT ĐỘNG (D18) ═════════════════

  describe("NOTI-033 — người CÒN HOẠT ĐỘNG (D18, 4 vế)", () => {
    it("K-4 — người nhận đã NGHỈ (`status='resigned'`, KHÔNG xoá mềm) KHÔNG nhận NOTI; người `active` CÙNG bài CÓ", async () => {
      const ok = await createKudos(author.token, {
        recipients: [resigned.employeeId, r1.employeeId],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      // Đường GHI cho phép (owner ký S6): CẢ HAI người vẫn có hàng người-nhận.
      expect(await recipientCount(ok.postId), "vinh danh người đã nghỉ vẫn GHI được").toBe(2);

      const ev = await outboxRows(ok.postId);
      expect(ev.length, "producer ghi outbox CÙNG tx").toBe(1);
      const recipients = ev[0].payload.recipientUserIds as string[];
      // 🔴 Neo dương TRƯỚC: người `active` CÓ trong tập. Không có vế này, một vị từ lọc SẠCH mọi người
      // sẽ làm assert phủ định dưới xanh trong khi tính năng chết.
      expect(recipients, "người còn hoạt động PHẢI nhận").toContain(r1.userId);
      expect(recipients, "người đã NGHỈ không nhận — vế `status='active'` của D18").not.toContain(
        resigned.userId,
      );

      await drain();
      expect(await notiCount(r1.userId, ok.postId)).toBe(1);
      expect(await notiCount(resigned.userId, ok.postId)).toBe(0);
    });

    it("K-4b — nhân sự `active` nhưng `users.status='suspended'` ⇒ KHÔNG nhận NOTI", async () => {
      const ok = await createKudos(author.token, {
        recipients: [lockedAccount.employeeId, r2.employeeId],
      });
      expect(ok.status).toBe(201);
      expect(await recipientCount(ok.postId)).toBe(2);

      const recipients = (await outboxRows(ok.postId))[0].payload.recipientUserIds as string[];
      expect(recipients, "neo dương").toContain(r2.userId);
      expect(recipients, "vế `users.status='active'` của D18").not.toContain(lockedAccount.userId);
    });

    it("K-4c — người nhận KHÔNG có tài khoản `users` ⇒ không 500, hàng người-nhận vẫn ĐỦ", async () => {
      const ok = await createKudos(author.token, {
        recipients: [ghostEmployeeId, r1.employeeId],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      // INNER JOIN của D18 làm họ rụng khỏi tập NGƯỜI NHẬN THÔNG BÁO — nhưng KHÔNG được làm rụng hàng
      // `feed_kudos_recipients`: họ vẫn được vinh danh, chỉ là không có hộp thông báo nào để gửi tới.
      expect(await recipientCount(ok.postId), "2 hàng người nhận").toBe(2);
      const recipients = (await outboxRows(ok.postId))[0].payload.recipientUserIds as string[];
      expect(recipients).toEqual([r1.userId]);
    });

    it("N-033 — tới đúng tập user map từ `employee_id`; TÁC GIẢ không nhận", async () => {
      const ok = await createKudos(author.token, {
        recipients: [r1.employeeId, r2.employeeId],
      });
      expect(ok.status).toBe(201);
      await drain();

      expect(await notiCount(r1.userId, ok.postId)).toBe(1);
      expect(await notiCount(r2.userId, ok.postId)).toBe(1);
      expect(await notiCount(author.userId, ok.postId), "không ai tự báo cho mình").toBe(0);
    });

    it("N-033c — mọi người nhận đều KHÔNG hoạt động ⇒ KHÔNG hàng outbox nào (không dead-letter câm)", async () => {
      const ok = await createKudos(author.token, { recipients: [resigned.employeeId] });
      expect(ok.status, "vẫn ghi được bài").toBe(201);
      expect(await recipientCount(ok.postId)).toBe(1);
      // `recipientUserIds` rỗng ⇒ producer KHÔNG enqueue. Enqueue một hàng rỗng sẽ thành dead-letter ở
      // registrar (`requireUserIds` ném) — một lỗi hạ tầng cho một tình huống nghiệp vụ hợp lệ.
      expect((await outboxRows(ok.postId)).length).toBe(0);
    });

    it("N-dedupe — phát lại cùng bài ⇒ mỗi người nhận vẫn đúng 1 hàng `notifications`", async () => {
      const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
      expect(ok.status).toBe(201);
      await drain();
      expect(await notiCount(r1.userId, ok.postId)).toBe(1);
      await drain();
      expect(await notiCount(r1.userId, ok.postId)).toBe(1);
    });

    it("N-033b — payload NOTI-033 không chở `employee_id` nào (bản đồ nhân sự không đi ra bằng cửa NOTI)", async () => {
      const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
      expect(ok.status).toBe(201);
      await drain();

      const rows = await direct.query(
        `SELECT payload FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2
            AND event_code = 'SOCIAL_KUDOS_RECEIVED' AND payload->>'post_id' = $3`,
        [A.companyId, r1.userId, ok.postId],
      );
      expect(rows.rows.length, "neo dương").toBe(1);
      const payload = JSON.stringify(rows.rows[0].payload);
      expect(payload).not.toContain(r1.employeeId);
      expect(payload).not.toContain(author.employeeId);
      // Neo dương: biến template `actor_name` có CHỮ (render không ra `{actor_name}`).
      expect(
        String((rows.rows[0].payload as Record<string, unknown>).actor_name).length,
      ).toBeGreaterThan(0);
    });
  });

  // ═════════════════ K-5 · K-7 · K-8 · K-9 — `047` ═════════════════

  it("K-5 — `047` KHÔNG liệt kê vinh danh ngoài audience; bài trong audience CÓ mặt", async () => {
    const hidden = await createKudos(outsider.token, {
      recipients: [r1.employeeId],
      audience: "org_unit",
      orgUnitId: ouTech,
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(201);
    const mine = await createKudos(author.token, { recipients: [r1.employeeId] });

    const list = await kudosListOf(author);
    expect(
      list.rows.some((d) => d.postId === mine.postId),
      "neo dương",
    ).toBe(true);
    expect(list.total).toBeGreaterThan(0);
    expect(
      list.rows.some((d) => d.postId === hidden.postId),
      "bài ngoài audience VẮNG",
    ).toBe(false);
  });

  it("K-7 — `047` KHÔNG lộ `userId` của người nhận (assert THU HẸP theo uuid fixture)", async () => {
    const ok = await createKudos(author.token, { recipients: [r1.employeeId, r2.employeeId] });
    expect(ok.status).toBe(201);

    const list = await kudosListOf(author);
    const item = list.rows.find((d) => d.postId === ok.postId);
    // Neo dương ĐẶT TRƯỚC: có người nhận, và có TÊN — nếu DTO rỗng thì assert phủ định vô nghĩa.
    expect(item?.recipients.length, "neo dương: có người nhận").toBe(2);
    expect(
      item?.recipients.every((p) => (p.fullName ?? "").length > 0),
      "có `fullName`",
    ).toBe(true);
    // Assert THU HẸP: liệt kê tường minh uuid user của fixture, KHÔNG quét mọi chuỗi dạng uuid
    // (`postId`/`kudosId`/`employeeId` đều là uuid hợp lệ và PHẢI có mặt ⇒ quét rộng là đỏ oan).
    const recipientsRaw = JSON.stringify(item?.recipients);
    expect(recipientsRaw).not.toContain(r1.userId);
    expect(recipientsRaw).not.toContain(r2.userId);
    // Neo dương của chính phép đo: `employeeId` thì CÓ (không phải DTO rỗng mọi uuid).
    expect(recipientsRaw).toContain(r1.employeeId);
  });

  it("K-8 — `047` với người đã nghỉ: cờ `isFormerEmployee` nói rõ, người `active` cùng bài thì `false`", async () => {
    const ok = await createKudos(author.token, {
      recipients: [resigned.employeeId, r1.employeeId],
    });
    expect(ok.status).toBe(201);

    const list = await kudosListOf(author);
    const item = list.rows.find((d) => d.postId === ok.postId);
    expect(item?.recipients.length).toBe(2);

    const former = item?.recipients.find((p) => p.employeeId === resigned.employeeId);
    const active = item?.recipients.find((p) => p.employeeId === r1.employeeId);
    expect(former?.isFormerEmployee, "người đã nghỉ ⇒ true").toBe(true);
    expect(former?.fullName, "vẫn có tên (đây là bề mặt phơi mà S6 đã cân)").toBeTruthy();
    expect(active?.isFormerEmployee, "neo dương: người còn làm ⇒ false").toBe(false);
  });

  it("K-9 — ĐƯỜNG TỰ GỠ: xoá mềm bài (`003`) ⇒ bài VÀ danh sách người nhận biến khỏi `047`", async () => {
    const MSG = `Vinh danh sẽ bị gỡ ${randomUUID().slice(0, 8)}`;
    const ok = await createKudos(author.token, {
      recipients: [resigned.employeeId, r1.employeeId],
      message: MSG,
    });
    expect(ok.status).toBe(201);
    const kudosId = (await kudosRow(ok.postId))?.id;
    expect(kudosId, "fixture phải có hàng `feed_kudos`").toBeTruthy();

    const before = await kudosListOf(author);
    expect(before.rows.some((d) => d.postId === ok.postId), "neo dương: trước khi xoá CÓ").toBe(
      true,
    );
    expect(before.raw, "neo dương: nội dung có mặt trước khi xoá").toContain(MSG);

    expect((await del(author.token, `/social/posts/${ok.postId}`)).status).toBe(200);

    const after = await kudosListOf(author);
    expect(after.rows.some((d) => d.postId === ok.postId), "bài biến mất").toBe(false);
    // 🔴 Vế thứ hai của đường tự gỡ phải đo theo ĐÚNG bài này, không theo `employeeId` của người nhận:
    // cùng một người được vinh danh ở NHIỀU bài khác (K-4/K-8 vẫn còn), nên assert
    // `not.toContain(resigned.employeeId)` là **đỏ oan** — đã vấp đúng một lần khi viết ca này.
    expect(after.raw, "nội dung bài đã xoá không còn").not.toContain(MSG);
    expect(after.raw, "hàng người-nhận của bài đã xoá không còn").not.toContain(kudosId as string);
  });

  it("`047` lọc theo `month` (`YYYY-MM`) — bài tháng khác VẮNG, bài tháng này CÓ", async () => {
    const ok = await createKudos(author.token, { recipients: [r1.employeeId] });
    expect(ok.status).toBe(201);

    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const inMonth = await kudosListOf(author, `month=${thisMonth}&page=1&limit=50`);
    expect(
      inMonth.rows.some((d) => d.postId === ok.postId),
      "neo dương: tháng này CÓ",
    ).toBe(true);

    const other = await kudosListOf(author, `month=2001-01&page=1&limit=50`);
    expect(other.rows.some((d) => d.postId === ok.postId)).toBe(false);
    expect(other.total, "tháng rỗng ⇒ total 0").toBe(0);
  });

  it("`047` từ chối `month` sai hình dạng ⇒ 400", async () => {
    expect((await get(author.token, "/social/kudos?month=2026-13")).status).toBe(400);
    expect((await get(author.token, "/social/kudos?month=thang-9")).status).toBe(400);
  });

  it("`047`/`048` trang VƯỢT BIÊN: `data` rỗng nhưng `total` vẫn ĐÚNG", async () => {
    await createKudos(author.token, { recipients: [r1.employeeId] });

    // Nhánh RIÊNG của repository: `count(*) over ()` chỉ tồn tại khi CÓ HÀNG ⇒ trang rỗng phải hỏi
    // tổng bằng câu thứ hai. Thiếu nó thì `total = 0` cho một tập KHÔNG rỗng và FE mất nút lùi.
    const k = await get(author.token, "/social/kudos?page=999&limit=50");
    expect(k.status).toBe(200);
    expect(k.body.data.data).toEqual([]);
    expect(k.body.data.total, "tổng THẬT của `047`").toBeGreaterThan(0);

    const b = await get(author.token, "/social/kudos-badges?page=999&limit=50");
    expect(b.status).toBe(200);
    expect(b.body.data.data).toEqual([]);
    expect(b.body.data.total, "tổng THẬT của `048`").toBeGreaterThan(0);
  });

  // ═════════════════ K-6 — `048` catalog huy hiệu ═════════════════

  it("K-6 — `048` chỉ trả huy hiệu ĐANG BẬT; huy hiệu đã tắt VẮNG", async () => {
    const res = await get(author.token, "/social/kudos-badges?page=1&limit=50");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{ id: string; code: string; position: number }>;

    expect(
      rows.some((b) => b.id === badgeOn),
      "neo dương: huy hiệu bật CÓ mặt",
    ).toBe(true);
    expect(
      rows.some((b) => b.id === badgeOff),
      "huy hiệu đã tắt VẮNG",
    ).toBe(false);
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(res.body.data.page).toBe(1);
  });

  it("`048` KHÔNG rò huy hiệu của tenant khác", async () => {
    const res = await get(author.token, "/social/kudos-badges?page=1&limit=50");
    const rows = res.body.data.data as Array<{ id: string }>;
    expect(rows.some((b) => b.id === badgeOfB)).toBe(false);
    // Neo dương: tenant B tự thấy huy hiệu của mình.
    const resB = await get(bAuthor.token, "/social/kudos-badges?page=1&limit=50");
    expect((resB.body.data.data as Array<{ id: string }>).some((b) => b.id === badgeOfB)).toBe(
      true,
    );
  });

  it("huy hiệu đã TẮT vẫn hiện trên bài CŨ ở `047` (lịch sử không đổi khi catalog đổi)", async () => {
    const ok = await createKudos(author.token, {
      recipients: [r1.employeeId],
      badgeId: badgeOn,
    });
    expect(ok.status).toBe(201);

    const code = `tmp-${randomUUID().slice(0, 6)}`;
    await direct.query(`UPDATE feed_kudos_badges SET is_active = false, code = $2 WHERE id = $1`, [
      badgeOn,
      code,
    ]);
    try {
      const list = await kudosListOf(author);
      const item = list.rows.find((d) => d.postId === ok.postId);
      // LEFT JOIN, không INNER: INNER làm bài BIẾN MẤT khỏi `047` khi admin tắt một huy hiệu.
      expect(item, "bài cũ vẫn có mặt").toBeDefined();
      expect(item?.badge?.id).toBe(badgeOn);
    } finally {
      await direct.query(`UPDATE feed_kudos_badges SET is_active = true WHERE id = $1`, [badgeOn]);
    }
  });

  // ═════════════════ N-033b — rollback ═════════════════

  it("N-033b — lỗi SAU khi INSERT `feed_kudos` ⇒ `feed_kudos` = 0 VÀ outbox = 0 (cùng rollback)", async () => {
    // Giả lập bằng một payload mà bước SAU `createKudosTx` sẽ ném: `attachmentIds` trỏ vào tệp không
    // tồn tại ⇒ `syncLinksTx` ném TRONG tx, sau khi `feed_kudos` + outbox đã được ghi.
    const before = await kudosCountOf(A.companyId, author.userId);
    const res = await post(author.token, "/social/posts").send({
      type: "kudos",
      audience: "company",
      kudos: {
        recipientEmployeeIds: [r1.employeeId],
        message: "Vinh danh sẽ rollback",
      },
      attachmentIds: [randomUUID()],
    });
    expect(res.status, `phải THẤT BẠI: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);

    // 🔴 HAI vế, CÙNG một tx. Ghi hàng outbox SAU commit (at-most-once) sẽ làm vế thứ hai xanh trong
    // khi bài vẫn tồn tại — hoặc ngược lại. Đếm cả hai.
    expect(await kudosCountOf(A.companyId, author.userId), "không hàng `feed_kudos` nào").toBe(
      before,
    );
    const stray = await direct.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
        WHERE company_id = $1 AND event_type = 'social.kudos_received'
          AND payload->>'actor_name' IS NOT NULL
          AND payload->>'post_id' NOT IN (SELECT id::text FROM feed_posts WHERE company_id = $1)`,
      [A.companyId],
    );
    expect(stray.rows[0].n, "không hàng outbox mồ côi nào").toBe(0);
  });
});
