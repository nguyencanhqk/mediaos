/**
 * S16-SOCIAL-BE-2B-2 — SÁNG KIẾN ở tầng HTTP (`002/idea` · `045` · `046`) + NOTI-032.
 *
 * ┌─ VÌ SAO Ở TẦNG HTTP, VÀ ĐO BẰNG SQL ĐỘC LẬP ──────────────────────────────────────────────────┐
 * │ `046` là đường DUYỆT đầu tiên của SOCIAL. Ba bất biến đắt nhất của nó KHÔNG đo được ở tầng đơn  │
 * │ vị, vì cả ba là về chuỗi cổng + transaction + hàng DB:                                          │
 * │   · **cặp vết đi CÙNG NHAU** — `chk_feed_ideas_reviewed_pair`; thiếu một cột là 500, không phải  │
 * │     một assert sai;                                                                             │
 * │   · **một lượt chuyển = một dòng audit** — `audit_logs` append-only, hai người duyệt cùng lúc    │
 * │     mà cả hai ghi thì không có đường gỡ lại;                                                    │
 * │   · **`reviewNote` không phơi cho toàn công ty** — `045` gác `view:feed`, tức MỌI nhân viên.     │
 * │ Đọc lại bằng SQL TRỰC TIẾP, không qua chính API vừa ghi: một API tính sai cả hai vế sẽ tự xác   │
 * │ nhận mình đúng.                                                                                 │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Luật §5 của plan: **mỗi DENY có ALLOW đối chứng** — assert phủ định trên tập RỖNG là deny vacuous.
 * Assert theo **HẰNG MÃ LỖI** (`SOCIAL_ERR.*`), không theo câu chữ: census `social-error-code-census`
 * tầng A đòi đúng dạng bằng chứng này.
 *
 * 🔴 `await app.listen(0)` trong `beforeAll` là BẮT BUỘC, không phải thói quen: ca `I-6` dùng
 * `Promise.allSettled`, và supertest trên một app chỉ `init()` sẽ tự `listen(0)` rồi tự `close()` ngay
 * khi request ĐẦU về ⇒ `ECONNRESET` cho request anh em, đỏ theo thời điểm và hầu như luôn xanh cục bộ
 * (memory `supertest-closes-shared-server-on-first-response`).
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
const LOGIN_PW = "Passw0rd!socialbe2b2ideas";

/** Vai "nhân viên có thể đăng sáng kiến" — cặp theo loại bài ĐỦ. */
const IDEA_PAIRS = ["view:feed", "create:feed-post", "create:feed-idea"] as const;
/** 🔴 Vai TUỲ BIẾN của ca `T-1`: THIẾU ĐÚNG `create:feed-idea`. Xem docblock `makeUser`. */
const NO_IDEA_PAIRS = ["view:feed", "create:feed-post"] as const;
/** Vai người duyệt. */
const REVIEWER_PAIRS = [...IDEA_PAIRS, "approve:feed-idea"] as const;

interface Who {
  token: string;
  userId: string;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2B-2 · sáng kiến (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let outboxLock: OutboxWorkerLock | undefined;
  const companyIds: string[] = [];

  let author: Who;
  let reviewer: Who;
  /** `approve:feed-idea` @Department — ca `I-2b`, vùng phủ THẬT của `SOCIAL-ERR-020`. */
  let reviewerDept: Who;
  /** Chỉ `view:feed` + `create:feed-post` — ca `T-1`. */
  let noIdea: Who;
  /** Nhân viên thường (có `create:feed-idea`, KHÔNG có `approve`) — ca `I-2`, `I-10`. */
  let plain: Who;
  /** Người của đơn vị KHÁC — ca `I-7`/`I-8`. */
  let outsider: Who;
  let bAuthor: Who;
  let bReviewer: Who;

  let ouSales = "";
  let ouTech = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const patch = (t: string, u: string) => http().patch(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  /**
   * Tạo user + hồ sơ nhân sự + **VAI TUỲ BIẾN của chính spec**, rồi đăng nhập thật.
   *
   * 🔴 Vai riêng, KHÔNG phải vai canonical — và đây là điều kiện để mọi ca DENY của cụm cặp
   * `create:feed-*` tồn tại: seed `0578:45,79-86` cấp `create:feed-idea` @Company cho CẢ 4 vai
   * canonical, nên không vai chuẩn nào dựng được `T-1`. Sửa `role_permissions` của vai canonical để
   * "dựng được ca" là **ĐÓNG DẤU VĨNH VIỄN lên lane DB dùng chung** (`permissions` là catalog toàn cục,
   * `cleanupTenants` không dọn nó) ⇒ mọi spec chạy sau đi đỏ ở NƠI KHÁC.
   * Kỹ thuật này đã được BE-2B-1 dùng ở `social-be2b1-polls-isolation` ca N1.
   */
  async function makeUser(
    tenant: SeededTenant,
    label: string,
    hash: string,
    opts: {
      pairs?: readonly string[];
      orgUnitId?: string | null;
      scope?: "Company" | "Department";
    } = {},
  ): Promise<Who> {
    const { pairs = IDEA_PAIRS, orgUnitId = null, scope = "Company" } = opts;
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);

    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    // 🔴 `seedUser` KHÔNG đặt `full_name` (đo 24/09/2026) ⇒ `users.full_name` NULL. Cần nó cho neo
    // dương của D19: `045` chiếu `reviewer.fullName` thay cho `reviewed_by` thô, và với `full_name`
    // NULL thì ca "vẫn nói được AI đã duyệt" xanh-rỗng — DTO trả `null` vì THIẾU DỮ LIỆU, không vì
    // masking đúng. Đặt tên TƯỜNG MINH ở fixture.
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [userId, `Nhân sự ${label}`]);

    const roleId = await seedRole(
      direct,
      tenant.companyId,
      `p-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      // `view:feed` + `create:feed-post` LUÔN @Company: hạ chúng xuống Department sẽ làm ca đỏ vì
      // cổng SÀN, không vì cặp đang đo (`I-2b` cần ĐÚNG MỘT cặp hẹp hơn).
      const s = key === "approve:feed-idea" || key === "create:feed-idea" ? scope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", s);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

    const res = await http()
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return { token: res.body.data.accessToken as string, userId };
  }

  async function seedOrgUnit(tenant: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [tenant.companyId, name],
    );
    return r.rows[0].id as string;
  }

  /** Tạo bài sáng kiến qua ĐÚNG route `002`. */
  async function createIdea(
    token: string,
    opts: { audience?: "company" | "org_unit"; orgUnitId?: string; body?: string | null } = {},
  ): Promise<{ postId: string; status: number; body: unknown }> {
    const payload: Record<string, unknown> = {
      type: "idea",
      audience: opts.audience ?? "company",
      ...(opts.orgUnitId ? { orgUnitId: opts.orgUnitId } : {}),
    };
    if (opts.body !== null) payload.body = opts.body ?? `Sáng kiến ${randomUUID().slice(0, 8)}`;

    const res = await post(token, "/social/posts").send(payload);
    return {
      postId: res.status === 201 ? (res.body.data.id as string) : "",
      status: res.status,
      body: res.body,
    };
  }

  const ideaRow = async (postId: string) =>
    (
      await direct.query(
        `SELECT id, status, reviewed_by, reviewed_at, review_note
           FROM feed_ideas WHERE post_id = $1`,
        [postId],
      )
    ).rows[0] as
      | {
          id: string;
          status: string;
          reviewed_by: string | null;
          reviewed_at: Date | null;
          review_note: string | null;
        }
      | undefined;

  const ideaCount = async (companyId: string, authorUserId: string) =>
    (
      await direct.query(
        `SELECT COUNT(*)::int AS n FROM feed_ideas i
           JOIN feed_posts p ON p.company_id = i.company_id AND p.id = i.post_id
          WHERE i.company_id = $1 AND p.author_user_id = $2`,
        [companyId, authorUserId],
      )
    ).rows[0].n as number;

  const auditRows = async (postId: string) =>
    (
      await direct.query(
        `SELECT metadata FROM audit_logs
          WHERE object_type = 'feed_post' AND object_id = $1 AND action = 'social.idea.review'
          ORDER BY created_at`,
        [postId],
      )
    ).rows as Array<{ metadata: Record<string, unknown> }>;

  const outboxRows = async (postId: string) =>
    (
      await direct.query(
        `SELECT payload FROM outbox_events
          WHERE event_type = 'social.idea_status_changed' AND payload->>'post_id' = $1
          ORDER BY created_at`,
        [postId],
      )
    ).rows as Array<{ payload: Record<string, unknown> }>;

  const notiRows = async (userId: string, postId: string) =>
    (
      await direct.query(
        `SELECT dedupe_key, title, body, target_url, payload FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2
            AND event_code = 'SOCIAL_IDEA_STATUS_CHANGED'
            AND payload->>'post_id' = $3 AND deleted_at IS NULL
          ORDER BY created_at`,
        [A.companyId, userId, postId],
      )
    ).rows as Array<{
      dedupe_key: string | null;
      title: string;
      body: string;
      target_url: string | null;
      payload: Record<string, unknown>;
    }>;

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2b2idea");
    B = await seedCompany(direct, "sb2b2ideab");
    companyIds.push(A.companyId, B.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Xem docblock đầu file: BẮT BUỘC cho ca `I-6` (`Promise.allSettled`).
    await app.listen(0);
    outboxLock = await acquireOutboxWorkerLock("social-be2b2-ideas");

    ouSales = await seedOrgUnit(A, `Sales-${randomUUID().slice(0, 6)}`);
    ouTech = await seedOrgUnit(A, `Tech-${randomUUID().slice(0, 6)}`);

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    author = await makeUser(A, "ideaauthor", hash, { orgUnitId: ouSales });
    reviewer = await makeUser(A, "ideareviewer", hash, {
      pairs: REVIEWER_PAIRS,
      orgUnitId: ouSales,
    });
    reviewerDept = await makeUser(A, "ideareviewerdept", hash, {
      pairs: REVIEWER_PAIRS,
      orgUnitId: ouSales,
      scope: "Department",
    });
    noIdea = await makeUser(A, "ideanoidea", hash, { pairs: NO_IDEA_PAIRS, orgUnitId: ouSales });
    plain = await makeUser(A, "ideaplain", hash, { orgUnitId: ouSales });
    outsider = await makeUser(A, "ideaoutsider", hash, { orgUnitId: ouTech });
    bAuthor = await makeUser(B, "ideabauthor", hash);
    bReviewer = await makeUser(B, "ideabreviewer", hash, { pairs: REVIEWER_PAIRS });
  }, 180_000);

  afterAll(async () => {
    await outboxLock?.release();
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  // ═════════════════ T-1 · T-3 · T-3b · T-4 — cặp quyền theo `type` + hình dạng ═════════════════

  it("T-1 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-idea` ⇒ 403 SOCIAL_ERR, KHÔNG hàng nào được ghi", async () => {
    // Neo dương #1: cùng user này TẠO ĐƯỢC bài thường ⇒ 403 dưới đến từ cặp THIẾU, không từ token /
    // `view:feed` / `create:feed-post` hỏng.
    const share = await post(noIdea.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài thường — neo dương của T-1",
    });
    expect(share.status, JSON.stringify(share.body)).toBe(201);

    const denied = await createIdea(noIdea.token);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.IDEA_CREATE_REQUIRED);

    // Cổng phải chặn TRƯỚC khi ghi: một cổng đặt SAU `INSERT feed_posts` vẫn trả 403 nhưng để lại bài
    // mồ côi. Đếm trên DB, không tin status.
    expect(await ideaCount(A.companyId, noIdea.userId)).toBe(0);
    const orphan = await direct.query(
      `SELECT COUNT(*)::int AS n FROM feed_posts
        WHERE company_id = $1 AND author_user_id = $2 AND type = 'idea'`,
      [A.companyId, noIdea.userId],
    );
    expect(orphan.rows[0].n, "bài `idea` mồ côi KHÔNG được để lại").toBe(0);

    // ALLOW đối chứng: vai có cặp ⇒ 201 và hàng `feed_ideas` mang `status='submitted'` TƯỜNG MINH
    // (cột không có DEFAULT — quên truyền là 23502 ⇒ 500).
    const ok = await createIdea(author.token);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await ideaRow(ok.postId))?.status).toBe("submitted");
  });

  it("T-3 — `create:feed-idea` @Department (hẹp hơn sàn Company) ⇒ 403; @Company ⇒ 201", async () => {
    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    const deptOnly = await makeUser(A, `ideadept-${randomUUID().slice(0, 6)}`, hash, {
      orgUnitId: ouSales,
      scope: "Department",
    });

    const denied = await createIdea(deptOnly.token);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.IDEA_CREATE_REQUIRED);
    expect(await ideaCount(A.companyId, deptOnly.userId)).toBe(0);

    const ok = await createIdea(author.token);
    expect(ok.status, "ALLOW đối chứng @Company").toBe(201);
  });

  it("T-3b — cách ly fixture: sau T-1/T-3, vai canonical KHÔNG bị sửa (ALLOW của T-1 vẫn 201)", async () => {
    const ok = await createIdea(author.token);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // Và người thiếu cặp VẪN bị chặn — nếu spec đã vô tình cấp cặp cho ai đó, ca này xanh mà T-1 đỏ.
    expect((await createIdea(noIdea.token)).status).toBe(403);
  });

  it("T-4 — `type='idea'` KHÔNG có `body` ⇒ 400 của Zod (CHECK không miễn `idea`)", async () => {
    const res = await createIdea(author.token, { body: null });
    // Chốt MỘT mã: đây là lỗi HÌNH DẠNG (`superRefine`), không phải lỗi nghiệp vụ. Nếu vế này bị bỏ
    // thì `chk_feed_posts_body_required` bắt bằng 23514 ⇒ **500** cho một sai sót nhập liệu thường.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await ideaCount(A.companyId, author.userId)).toBeGreaterThan(0); // neo dương: có bài hợp lệ
  });

  // ══════════════════════════════ I-2 · I-2b — cổng của `046` ══════════════════════════════

  it("I-2 — nhân viên KHÔNG có grant `approve:feed-idea` ⇒ 403 của GUARD (không phải ERR-020)", async () => {
    const { postId } = await createIdea(author.token);

    const denied = await patch(plain.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(denied.status).toBe(403);
    // 🔴 **VÙNG KHÔNG PHỦ của `SOCIAL-ERR-020`, đo 24/09/2026 — ghi vào PR.** Ca này bị `PermissionGuard`
    // chặn ở TẦNG 1, và guard ném `Permission denied: <reason>`; `@RequirePermission` không nhận message
    // tuỳ biến nên mã module KHÔNG ra được ở nhánh «không có grant nào». Phủ cả ca này đòi đổi
    // `PermissionGuard` toàn hệ = WO riêng. Assert đúng cái đang xảy ra, không assert cái mong muốn.
    expect(JSON.stringify(denied.body)).toContain("Permission denied");
    expect(JSON.stringify(denied.body)).not.toContain(SOCIAL_ERR.IDEA_APPROVE_REQUIRED);
    expect((await ideaRow(postId))?.status, "trạng thái KHÔNG đổi").toBe("submitted");

    const ok = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("I-2b — có `approve:feed-idea` nhưng @Department ⇒ 403 **SOCIAL-ERR-020** + trạng thái không đổi", async () => {
    const { postId } = await createIdea(author.token);

    const denied = await patch(reviewerDept.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    // Đây là vùng phủ THẬT của mã: tầng-1 CHO QUA (grant có, quyết định ALLOW @Department), rồi sàn
    // `companyFloor` trong `resolveActor` từ chối — và nó phát `denyMessage` của `ideaReview` thay cho
    // chuỗi `AUTH-ERR-SCOPE-DENIED` dùng chung. ĐO CỔNG: xoá `denyMessage` khỏi bảng cặp ⇒ ca này đỏ
    // (nhận `AUTH-ERR-SCOPE-DENIED`).
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.IDEA_APPROVE_REQUIRED);
    expect((await ideaRow(postId))?.status).toBe("submitted");

    const ok = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(ok.status, "ALLOW đối chứng @Company").toBe(200);
  });

  // ══════════════════════════════ I-3 · I-5 · I-12 — FSM + cặp vết ══════════════════════════════

  it("I-3 — `rejected` với note toàn khoảng trắng ⇒ 422 có MÃ (không rơi xuống 23514/500)", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });

    const denied = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "rejected",
      reviewNote: "   ",
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(422);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.IDEA_REJECT_NOTE_REQUIRED);
    expect((await ideaRow(postId))?.status, "vẫn `under_review`").toBe("under_review");

    const ok = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "rejected",
      reviewNote: "  Chưa khả thi ở quý này  ",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await ideaRow(postId);
    expect(row?.status).toBe("rejected");
    expect(row?.review_note, "lưu bản ĐÃ trim").toBe("Chưa khả thi ở quý này");
  });

  it("I-5 — `under_review → accepted`: status + reviewed_by + reviewed_at đều đặt sau MỘT câu", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "accepted",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const row = await ideaRow(postId);
    expect(row?.status).toBe("accepted");
    // 🔴 Cặp vết: `chk_feed_ideas_reviewed_pair` đòi CẢ HAI. Bỏ `reviewedAt` khỏi `reviewTx` ⇒ 23514
    // ⇒ 500, và ca này là lưới bắt được (phép ĐO CỔNG của plan §13).
    expect(row?.reviewed_by).toBe(reviewer.userId);
    expect(row?.reviewed_at).not.toBeNull();
  });

  it("I-12 — `review_note` là vết LẦN CUỐI: lượt 2 không note ⇒ note lượt 1 MẤT; audit có 2 dòng", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
      reviewNote: "Ghi chú lượt MỘT",
    });
    expect((await ideaRow(postId))?.review_note).toBe("Ghi chú lượt MỘT");

    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({ status: "accepted" });

    // Ghi đè CÓ CHỦ Ý (D21): `reviewed_by`/`reviewed_at` cũng là "lần cuối", để `review_note` lệch
    // kiểu sẽ thành ba cột kể ba câu chuyện về cùng một hàng.
    expect((await ideaRow(postId))?.review_note).toBeNull();

    // Neo dương: LỊCH SỬ không mất — nó ở `audit_logs`, mỗi lượt một dòng, và dòng 1 còn `from`.
    const rows = await auditRows(postId);
    expect(rows.length).toBe(2);
    expect(rows[0].metadata.from).toBe("submitted");
    expect(rows[0].metadata.to).toBe("under_review");
    expect(rows[1].metadata.from).toBe("under_review");
    expect(rows[1].metadata.to).toBe("accepted");
    // Audit KHÔNG chở `review_note` (chữ tự do của người duyệt).
    expect(JSON.stringify(rows)).not.toContain("Ghi chú lượt MỘT");
  });

  it("FSM: nhảy cóc `submitted → accepted` ⇒ 409 SOCIAL-ERR-019, trạng thái không đổi", async () => {
    const { postId } = await createIdea(author.token);
    const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "accepted",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.IDEA_TRANSITION);
    expect((await ideaRow(postId))?.status).toBe("submitted");
  });

  it("FSM: `accepted` là TERMINAL — mọi lượt chuyển tiếp ⇒ 409", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({ status: "accepted" });

    for (const to of ["under_review", "rejected"]) {
      const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: to,
        reviewNote: "thử mở lại",
      });
      expect(res.status, `accepted → ${to}`).toBe(409);
      expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.IDEA_TRANSITION);
    }
    expect((await ideaRow(postId))?.status).toBe("accepted");
  });

  it("DTO `046`: `status='submitted'` bị hợp đồng từ chối 400 (không là đích của cạnh nào)", async () => {
    const { postId } = await createIdea(author.token);
    const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "submitted",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("DTO `046`: `.strict()` chặn TỰ DUYỆT (`reviewedBy`/`reviewedAt` trong body ⇒ 400)", async () => {
    const { postId } = await createIdea(author.token);
    const res = await patch(author.token, `/social/posts/${postId}/idea/review`).send({
      status: "accepted",
      reviewedBy: author.userId,
      reviewedAt: new Date().toISOString(),
    });
    // 400 (hình dạng) TRƯỚC cả 403 — nhưng điều cần đo là hàng KHÔNG đổi bằng đường này.
    expect([400, 403]).toContain(res.status);
    expect((await ideaRow(postId))?.reviewed_by).toBeNull();
  });

  // ══════════════════════════════ I-6 — ĐUA hai người duyệt ══════════════════════════════

  it("I-6 — hai người duyệt CÙNG LÚC: đúng 1 dòng audit VÀ đúng 1 hàng outbox NOTI-032", async () => {
    const { postId } = await createIdea(author.token);

    const settled = await Promise.allSettled([
      patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      }),
      patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      }),
    ]);
    const statuses = settled.map((r) => (r.status === "fulfilled" ? r.value.status : 599));
    expect(statuses.filter((s) => s === 200).length, "đúng MỘT lượt thắng").toBe(1);
    expect(statuses.filter((s) => s === 409).length, "lượt còn lại thua đua ⇒ 409").toBe(1);

    // 🔴 Bất biến ĐẮT NHẤT của ca này: `audit_logs` append-only. Audit/outbox phải nằm SAU vế
    // `RETURNING` khác rỗng — ghi trước rồi mới kiểm là hai dòng cho một lượt chuyển, không gỡ lại được.
    expect((await auditRows(postId)).length).toBe(1);
    expect((await outboxRows(postId)).length).toBe(1);
    expect((await ideaRow(postId))?.status).toBe("under_review");
  });

  it("neo dương của I-6: duyệt ĐƠN LẺ vẫn sinh đúng 1 dòng audit + 1 outbox", async () => {
    const { postId } = await createIdea(author.token);
    const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(res.status).toBe(200);
    expect((await auditRows(postId)).length).toBe(1);
    expect((await outboxRows(postId)).length).toBe(1);
  });

  // ══════════════════════════════ I-7 · I-9 · I-11 — 404 trước 403 ══════════════════════════════

  it("I-7 — `046` trên bài NGOÀI audience ⇒ 404 (KHÔNG 403: 403 là rò sự tồn tại)", async () => {
    // Bài của đơn vị Tech; người duyệt thuộc Sales ⇒ không thấy được.
    const { postId } = await createIdea(outsider.token, {
      audience: "org_unit",
      orgUnitId: ouTech,
    });
    expect(postId, "fixture phải tạo được bài org_unit").not.toBe("");

    const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
    expect((await ideaRow(postId))?.status, "hàng không đổi").toBe("submitted");

    // ALLOW đối chứng: cùng người duyệt, bài TRONG audience ⇒ 200.
    const inScope = await createIdea(author.token);
    expect(
      (
        await patch(reviewer.token, `/social/posts/${inScope.postId}/idea/review`).send({
          status: "under_review",
        })
      ).status,
    ).toBe(200);
  });

  it("I-9 — cross-tenant `046` ⇒ 404, hàng của tenant B KHÔNG đổi", async () => {
    const bIdea = await createIdea(bAuthor.token);
    expect(bIdea.status).toBe(201);

    const res = await patch(reviewer.token, `/social/posts/${bIdea.postId}/idea/review`).send({
      status: "under_review",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect((await ideaRow(bIdea.postId))?.status).toBe("submitted");

    // Neo dương: người duyệt CỦA TENANT B làm được ⇒ 404 trên đến từ cô lập tenant, không từ hàng hỏng.
    expect(
      (
        await patch(bReviewer.token, `/social/posts/${bIdea.postId}/idea/review`).send({
          status: "under_review",
        })
      ).status,
    ).toBe(200);
  });

  it("I-11 — `046` trên bài `type='share'` ⇒ **404**, KHÔNG 409", async () => {
    const share = await post(author.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài chia sẻ, không phải sáng kiến",
    });
    expect(share.status).toBe(201);
    const sharePostId = share.body.data.id as string;

    const res = await patch(reviewer.token, `/social/posts/${sharePostId}/idea/review`).send({
      status: "under_review",
    });
    // 🔴 Đây là lý do `getIdeaForReviewTx` tồn tại. `assertPostVisible` cho bài `share` đi QUA, nên nếu
    // để `reviewTx` 0-hàng nuốt ca này thì route trả «chuyển trạng thái sáng kiến sai» cho một bài
    // không hề là sáng kiến. Bỏ `getIdeaForReviewTx` ⇒ ca này đỏ với 409 (ĐO CỔNG plan §13).
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
    expect(JSON.stringify(res.body)).not.toContain(SOCIAL_ERR.IDEA_TRANSITION);

    const ok = await createIdea(author.token);
    expect(
      (
        await patch(reviewer.token, `/social/posts/${ok.postId}/idea/review`).send({
          status: "under_review",
        })
      ).status,
      "ALLOW đối chứng: bài `idea` ⇒ 200",
    ).toBe(200);
  });

  // ══════════════════════════════ I-8 · I-10 — `045` ══════════════════════════════

  it("I-8 — `045` KHÔNG liệt kê sáng kiến ngoài audience; bài trong audience CÓ mặt", async () => {
    const hidden = await createIdea(outsider.token, { audience: "org_unit", orgUnitId: ouTech });
    const mine = await createIdea(author.token);

    const res = await get(author.token, "/social/ideas?page=1&limit=50");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // `body.data` = envelope NGOÀI (`ResponseEnvelopeInterceptor`), `.data` = envelope PHÂN TRANG của
    // route (khuôn `040` — `social-be2b1-polls.int-spec.ts:417`). Hai lớp, không phải một.
    const data = res.body.data.data as Array<{ postId: string }>;

    // Neo dương ĐẶT TRƯỚC assert phủ định.
    expect(
      data.some((d) => d.postId === mine.postId),
      "bài trong audience phải có mặt",
    ).toBe(true);
    expect(res.body.data.total, "envelope OFFSET có `total`").toBeGreaterThan(0);
    expect(res.body.data.page).toBe(1);
    expect(
      data.some((d) => d.postId === hidden.postId),
      "bài ngoài audience phải VẮNG",
    ).toBe(false);
  });

  it("I-8b — `045` lọc theo `status` (envelope giữ nguyên hình dạng)", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });

    const res = await get(author.token, "/social/ideas?status=under_review&page=1&limit=50");
    expect(res.status).toBe(200);
    const data = res.body.data.data as Array<{ postId: string; status: string }>;
    expect(data.some((d) => d.postId === postId)).toBe(true);
    expect(
      data.every((d) => d.status === "under_review"),
      "bộ lọc lọc THẬT",
    ).toBe(true);
  });

  it("`045` trang VƯỢT BIÊN: `data` rỗng nhưng `total` vẫn ĐÚNG (FE lùi được về trang cuối)", async () => {
    await createIdea(author.token);

    const res = await get(author.token, "/social/ideas?page=999&limit=50");
    expect(res.status).toBe(200);
    expect(res.body.data.data, "trang vượt biên ⇒ mảng rỗng").toEqual([]);
    // 🔴 Nhánh RIÊNG của repository: `count(*) over ()` chỉ tồn tại KHI CÓ HÀNG, nên trang rỗng phải
    // hỏi tổng bằng một câu thứ hai. Thiếu nhánh đó thì `total = 0` cho một tập KHÔNG rỗng ⇒ FE không
    // phân biệt được «trang cuối» với «không có gì», và không dựng được nút lùi.
    expect(res.body.data.total, "tổng THẬT, không phải 0").toBeGreaterThan(0);
  });

  it("I-10 — `045`: `reviewNote` CHỈ cho tác giả sáng kiến hoặc người có `approve:feed-idea`", async () => {
    const NOTE = `Lý do riêng ${randomUUID().slice(0, 8)}`;
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "rejected",
      reviewNote: NOTE,
    });

    const itemOf = async (who: Who) => {
      const res = await get(who.token, "/social/ideas?page=1&limit=50");
      expect(res.status).toBe(200);
      const found = (
        res.body.data.data as Array<{ postId: string; reviewNote: string | null }>
      ).find(
        (d) => d.postId === postId,
      );
      expect(found, "bài phải có mặt với CẢ BA người xem (neo dương)").toBeDefined();
      return { item: found!, raw: JSON.stringify(res.body) };
    };

    // 🔴 Neo dương TRƯỚC: hai người ĐƯỢC thấy note thì thật sự thấy. Không có vế này, một DTO trả
    // `reviewNote: null` cho TẤT CẢ sẽ làm ca phủ định dưới xanh mà tính năng thì hỏng.
    expect((await itemOf(author)).item.reviewNote, "tác giả sáng kiến THẤY note").toBe(NOTE);
    expect((await itemOf(reviewer)).item.reviewNote, "người có `approve` THẤY note").toBe(NOTE);

    const plainView = await itemOf(plain);
    expect(plainView.item.reviewNote, "nhân viên thường KHÔNG thấy note").toBeNull();
    expect(plainView.raw, "note không rò qua bất kỳ trường nào khác").not.toContain(NOTE);
  });

  it("`045` KHÔNG chiếu `reviewed_by` thô (chỉ `reviewer.fullName`)", async () => {
    const { postId } = await createIdea(author.token);
    await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
      status: "under_review",
    });

    const res = await get(plain.token, "/social/ideas?page=1&limit=50");
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    // Assert THU HẸP: liệt kê tường minh uuid của fixture thay vì quét mọi chuỗi dạng uuid (postId /
    // ideaId là uuid hợp lệ và PHẢI có mặt — quét rộng sẽ đỏ oan).
    expect(raw, "user_id người duyệt KHÔNG được có mặt").not.toContain(reviewer.userId);
    const found = (res.body.data.data as Array<{ postId: string; reviewer: unknown }>).find(
      (d) => d.postId === postId,
    );
    expect(found?.reviewer, "neo dương: vẫn nói được AI đã duyệt, bằng TÊN").toBeTruthy();
  });

  // ══════════════════════════════ NOTI-032 ══════════════════════════════

  describe("NOTI-032 — sáng kiến đổi trạng thái", () => {
    it("N-032 — 1 hàng cho TÁC GIẢ, render ra CHỮ, `target_url` không còn `{post_id}`; người duyệt KHÔNG nhận", async () => {
      const { postId } = await createIdea(author.token);
      const res = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      });
      expect(res.status).toBe(200);

      const ev = await outboxRows(postId);
      expect(ev.length, "producer ghi outbox CÙNG tx với UPDATE").toBe(1);
      expect(ev[0].payload.recipientUserIds).toEqual([author.userId]);

      await drain();

      const authorNotis = await notiRows(author.userId, postId);
      expect(authorNotis.length, "tác giả nhận đúng 1 thông báo").toBe(1);
      expect(authorNotis[0].title.length, "render ra CHỮ, không rỗng").toBeGreaterThan(0);
      expect(authorNotis[0].title, "không còn placeholder").not.toContain("{");
      expect(authorNotis[0].body).not.toContain("{");
      expect(authorNotis[0].target_url, "deep-link đã điền `post_id`").toBe(
        `/social/posts/${postId}`,
      );
      // 🔴 Cột `dedupe_key` lưu khoá ĐÃ được engine ghép tiền tố mã sự kiện
      // (`notification-dedupe.service.ts`: `computeKey = ${eventCode}:${dedupeKey}`) — đo 24/09/2026.
      // Assert nguyên dạng lưu, không dạng producer trả, để ca này còn bắt được khi ai đó đổi `computeKey`.
      expect(authorNotis[0].dedupe_key, "khoá dedupe mang CẢ trạng thái").toBe(
        `SOCIAL_IDEA_STATUS_CHANGED:${postId}:under_review`,
      );

      // DENY: người DUYỆT không nhận thông báo về quyết định của chính họ.
      expect((await notiRows(reviewer.userId, postId)).length).toBe(0);
    });

    it("N-032b — payload KHÔNG chở `review_note`, KHÔNG chở danh tính người duyệt", async () => {
      const NOTE = `Note bí mật ${randomUUID().slice(0, 8)}`;
      const { postId } = await createIdea(author.token);
      await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      });
      await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "rejected",
        reviewNote: NOTE,
      });
      await drain();

      const notis = await notiRows(author.userId, postId);
      // Neo dương TRƯỚC: có hàng, và biến template có CHỮ.
      expect(notis.length).toBeGreaterThan(0);
      const rejected = notis.find(
        (n) => n.dedupe_key === `SOCIAL_IDEA_STATUS_CHANGED:${postId}:rejected`,
      );
      expect(rejected, "lượt `rejected` phải có hàng riêng").toBeDefined();
      expect(String(rejected!.payload.status_label).length).toBeGreaterThan(0);

      // Ba vế phủ định, mỗi vế một lý do khác nhau.
      expect(
        JSON.stringify(notis),
        "ghi chú xét duyệt là chữ TỰ DO — không vào payload",
      ).not.toContain(NOTE);
      expect(rejected!.payload.actorUserId, "danh tính người duyệt: kênh trả đũa").toBeUndefined();
      expect(rejected!.payload.actor_name).toBeUndefined();
      expect(
        rejected!.payload.status,
        "enum thô chỉ dùng dựng khoá dedupe, KHÔNG vào payload",
      ).toBeUndefined();
    });

    it("N-032c — HAI lượt chuyển liên tiếp ⇒ **2** hàng `notifications` (lưới của khoá `:{status}`)", async () => {
      const { postId } = await createIdea(author.token);
      await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      });
      await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "accepted",
      });
      await drain();

      const notis = await notiRows(author.userId, postId);
      // 🔴 Lưới DUY NHẤT bắt được khoá dedupe thiếu `:{status}`. Với khoá `post_id` trần, tuple
      // `(company_id, recipient_user_id, event_code, dedupe_key)` trùng ⇒ lượt thứ hai bị NUỐT và tác
      // giả không bao giờ biết kết quả cuối.
      expect(notis.length, "mỗi lượt chuyển một thông báo").toBe(2);
      expect(notis.map((n) => n.dedupe_key).sort()).toEqual(
        [
          `SOCIAL_IDEA_STATUS_CHANGED:${postId}:accepted`,
          `SOCIAL_IDEA_STATUS_CHANGED:${postId}:under_review`,
        ].sort(),
      );
    });

    it("N-dedupe — phát LẠI cùng đối tượng + cùng trạng thái ⇒ vẫn đúng 1 hàng", async () => {
      const { postId } = await createIdea(author.token);
      await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      });
      await drain();
      expect((await notiRows(author.userId, postId)).length).toBe(1);

      // Lượt hai cho CÙNG `from` khớp 0 hàng ⇒ 409, không sinh outbox thứ hai. Drain lại để chắc chắn
      // không có hàng nào lọt qua cửa sau.
      const again = await patch(reviewer.token, `/social/posts/${postId}/idea/review`).send({
        status: "under_review",
      });
      expect(again.status).toBe(409);
      await drain();
      expect((await notiRows(author.userId, postId)).length).toBe(1);
    });

    it("N-032 — tác giả tự duyệt sáng kiến của mình ⇒ KHÔNG thông báo (không ai tự báo cho mình)", async () => {
      const selfIdea = await createIdea(reviewer.token);
      expect(selfIdea.status).toBe(201);
      await patch(reviewer.token, `/social/posts/${selfIdea.postId}/idea/review`).send({
        status: "under_review",
      });
      expect((await outboxRows(selfIdea.postId)).length).toBe(0);
      await drain();
      expect((await notiRows(reviewer.userId, selfIdea.postId)).length).toBe(0);
    });
  });

  // ══════════════════════════════ Đường tự gỡ ══════════════════════════════

  it("xoá mềm bài sáng kiến (`003`) ⇒ nó biến khỏi `045`", async () => {
    const { postId } = await createIdea(author.token);
    const before = await get(author.token, "/social/ideas?page=1&limit=50");
    expect(
      (before.body.data.data as Array<{ postId: string }>).some((d) => d.postId === postId),
      "neo dương: trước khi xoá có mặt",
    ).toBe(true);

    expect((await del(author.token, `/social/posts/${postId}`)).status).toBe(200);

    const after = await get(author.token, "/social/ideas?page=1&limit=50");
    expect((after.body.data.data as Array<{ postId: string }>).some((d) => d.postId === postId)).toBe(
      false,
    );
  });
});
