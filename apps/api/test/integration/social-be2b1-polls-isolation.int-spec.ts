/**
 * S16-SOCIAL-BE-2B-1 — **cô lập & deny-path** của BÌNH CHỌN (nợ test N1·N2·N3·N5·N7 của plan §13.5).
 *
 * ┌─ VÌ SAO TÁCH KHỎI `social-be2b1-polls.int-spec.ts` ───────────────────────────────────────────┐
 * │ File kia gieo MỘT tenant, mọi bài `audience:'company'`, và mọi user cầm đủ `BASE_PAIRS`. Ba    │
 * │ thứ đó làm nó **không thể** đo được ba câu hỏi đắt nhất của cụm:                                │
 * │   · cặp quyền MỚI `create:feed-poll` có thật sự gác không (mọi user đều có ⇒ chưa chạy lần nào);│
 * │   · `listPollsTx` — SQL MỚI với `innerJoin` riêng — có rò bài NGOÀI AUDIENCE / KHÁC TENANT không;│
 * │   · job có bị `DiscoveryService` bỏ sót không (int-spec kia gọi `app.get(Handler).run()` ⇒ đi   │
 * │     TẮT qua đăng ký, nên gỡ `@SystemJobHandler()` mà mọi ca vẫn xanh).                          │
 * │ Bơm hai tenant + org-unit + user thiếu-quyền vào file kia sẽ đổi tiền đề của 14 ca đang xanh.   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Luật §5 của plan: **mỗi DENY có ALLOW đối chứng**, neo dương đặt TRƯỚC mọi assert phủ định.
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
import {
  SOCIAL_POLL_CLOSE_EXPIRED_JOB_CODE,
  SocialPollCloseExpiredJobHandler,
} from "../../src/social/social-poll-close.job-handler";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR } from "../../src/social/social.errors";
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
const LOGIN_PW = "Passw0rd!socialbe2b1iso";
const BASE_PAIRS = ["view:feed", "create:feed-post", "create:feed-poll"] as const;
/** N1: đủ để TẠO BÀI và XEM feed, nhưng KHÔNG có cặp riêng của bình chọn. */
const NO_POLL_PAIRS = ["view:feed", "create:feed-post"] as const;

interface Who {
  token: string;
  userId: string;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-2B-1 · cô lập & deny-path (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  /** Tenant chính. */
  let A: SeededTenant;
  /** Tenant thứ hai — chỉ tồn tại để chứng minh KHÔNG ai với tới nó. */
  let B: SeededTenant;

  let ouSales = "";
  let ouTech = "";

  /** Thuộc `ouSales`, đủ quyền. */
  let author: Who;
  /** Thuộc `ouTech` — NGOÀI audience của bài `org_unit` mà `author` đăng. */
  let outsider: Who;
  /** Thiếu ĐÚNG cặp `create:feed-poll`. */
  let noPoll: Who;
  /** KHÔNG có hàng `employee_profiles` — tài khoản console/tích hợp. */
  let ghost: Who;
  /** Tác giả bên tenant B. */
  let bAuthor: Who;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http().get(u).set(auth(t));
  const post = (t: string, u: string) => http().post(u).set(auth(t));
  const put = (t: string, u: string) => http().put(u).set(auth(t));
  const del = (t: string, u: string) => http().delete(u).set(auth(t));

  async function makeUser(
    tenant: SeededTenant,
    label: string,
    hash: string,
    opts: { pairs?: readonly string[]; orgUnitId?: string | null; withProfile?: boolean } = {},
  ): Promise<Who> {
    const { pairs = BASE_PAIRS, orgUnitId = null, withProfile = true } = opts;
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);

    if (withProfile) {
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
         VALUES ($1, $2, $3, 'active', 'offline', $4)`,
        [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
      );
    }

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
    return { token: res.body.data.accessToken as string, userId };
  }

  async function seedOrgUnit(tenant: SeededTenant, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [tenant.companyId, name],
    );
    return r.rows[0].id as string;
  }

  /** Tạo bài bình chọn qua ĐÚNG route `002`. */
  async function createPoll(
    token: string,
    opts: {
      audience?: "company" | "org_unit";
      orgUnitId?: string;
      closesAt?: string;
    } = {},
  ): Promise<{ postId: string; optionIds: string[]; status: number; body: unknown }> {
    const res = await post(token, "/social/posts").send({
      type: "poll",
      audience: opts.audience ?? "company",
      ...(opts.orgUnitId ? { orgUnitId: opts.orgUnitId } : {}),
      poll: {
        question: `Câu hỏi ${randomUUID().slice(0, 6)}`,
        options: ["A", "B"],
        multipleChoice: false,
        isAnonymous: false,
        ...(opts.closesAt ? { closesAt: opts.closesAt } : {}),
      },
    });
    if (res.status !== 201)
      return { postId: "", optionIds: [], status: res.status, body: res.body };

    const postId = res.body.data.id as string;
    const o = await direct.query(
      `SELECT o.id FROM feed_poll_options o
         JOIN feed_polls p ON p.id = o.poll_id
        WHERE p.post_id = $1 ORDER BY o.position`,
      [postId],
    );
    return {
      postId,
      optionIds: o.rows.map((r: { id: string }) => r.id),
      status: res.status,
      body: res.body,
    };
  }

  /**
   * Đẩy bình chọn vào trạng thái «quá hạn mà vẫn `open`».
   *
   * 🔴 Phải lùi CẢ `created_at`: `chk_feed_polls_closes_future` phủ cả UPDATE, nên một câu chỉ kéo
   * `closes_at` về quá khứ sẽ vỡ CHECK và fixture chết bằng lỗi trông y hệt lỗi sản phẩm.
   */
  async function expirePoll(postId: string): Promise<void> {
    await direct.query(
      `UPDATE feed_polls
          SET created_at = now() - interval '2 hours', closes_at = now() - interval '1 minute'
        WHERE post_id = $1`,
      [postId],
    );
  }

  async function pollStatus(postId: string): Promise<string> {
    const r = await direct.query(`SELECT status FROM feed_polls WHERE post_id = $1`, [postId]);
    return r.rows[0]?.status as string;
  }

  async function outboxRows(postId: string): Promise<{ payload: Record<string, unknown> }[]> {
    const r = await direct.query(
      `SELECT payload FROM outbox_events
        WHERE event_type = 'social.poll_closed' AND payload->>'post_id' = $1`,
      [postId],
    );
    return r.rows as { payload: Record<string, unknown> }[];
  }

  async function auditCloseRows(postId: string): Promise<number> {
    const r = await direct.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE object_type = 'feed_post' AND object_id = $1 AND action = 'social.poll.close'`,
      [postId],
    );
    return r.rows[0].n as number;
  }

  const job = () => app.get(SocialPollCloseExpiredJobHandler);

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "sb2b1iso");
    B = await seedCompany(direct, "sb2b1isob");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    ouSales = await seedOrgUnit(A, `Sales-${randomUUID().slice(0, 6)}`);
    ouTech = await seedOrgUnit(A, `Tech-${randomUUID().slice(0, 6)}`);

    const hash = await app.get(PasswordService).hash(LOGIN_PW);
    author = await makeUser(A, "isoauthor", hash, { orgUnitId: ouSales });
    outsider = await makeUser(A, "isooutsider", hash, { orgUnitId: ouTech });
    noPoll = await makeUser(A, "isonopoll", hash, { pairs: NO_POLL_PAIRS, orgUnitId: ouSales });
    ghost = await makeUser(A, "isoghost", hash, { withProfile: false });
    bAuthor = await makeUser(B, "isobauthor", hash);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    await direct?.end();
  });

  // ═══════════════════════════ N1 · cặp quyền MỚI `create:feed-poll` ═══════════════════════════

  it("N1 — thiếu ĐÚNG `create:feed-poll` ⇒ 403 đúng CHUỖI, và KHÔNG hàng nào được ghi", async () => {
    // Neo dương #1: cùng user này TẠO ĐƯỢC bài thường ⇒ chứng minh 403 dưới đến từ cặp THIẾU,
    // không từ việc token/`view:feed`/`create:feed-post` hỏng.
    const share = await post(noPoll.token, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài thường — neo dương của N1",
    });
    expect(share.status, JSON.stringify(share.body)).toBe(201);

    const denied = await createPoll(noPoll.token);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(SOCIAL_ERR.POLL_CREATE_REQUIRED);

    // 🔴 Cổng phải chặn TRƯỚC khi ghi: một cổng đặt SAU `INSERT feed_posts` vẫn trả 403 nhưng để
    // lại bài mồ côi. Đếm trên DB, không tin status.
    const orphan = await direct.query(
      `SELECT COUNT(*)::int AS n FROM feed_posts
        WHERE company_id = $1 AND author_user_id = $2 AND type = 'poll'`,
      [A.companyId, noPoll.userId],
    );
    expect(orphan.rows[0].n, "403 mà vẫn ghi bài = cổng đặt sai chỗ").toBe(0);

    // Neo dương #2: user CÓ cặp thì tạo được — 403 trên là của CẶP, không phải của route.
    expect((await createPoll(author.token)).status).toBe(201);
  });

  // ═══════════════════════ N2a · P-12 · bài NGOÀI AUDIENCE ═══════════════════════

  it("P-12 — bài `org_unit` KHÔNG lọt sang người đơn vị khác, ở CẢ 5 route", async () => {
    const mine = await createPoll(author.token, { audience: "org_unit", orgUnitId: ouSales });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);

    // Neo dương: người TRONG đơn vị thấy và bỏ phiếu được — nếu không, mọi assert 404 dưới đây
    // xanh vì bài không tồn tại chứ không vì cổng.
    const insiderList = await get(author.token, "/social/polls?limit=100");
    expect(insiderList.status).toBe(200);
    const insiderIds = (insiderList.body.data.data as { postId: string }[]).map((r) => r.postId);
    expect(insiderIds, "neo dương: người trong đơn vị PHẢI thấy").toContain(mine.postId);
    expect(
      (
        await put(author.token, `/social/posts/${mine.postId}/poll/vote`).send({
          optionIds: [mine.optionIds[0]],
        })
      ).status,
    ).toBe(200);

    // ── DENY: người ngoài đơn vị ──
    const outList = await get(outsider.token, "/social/polls?limit=100");
    expect(outList.status).toBe(200);
    const outIds = (outList.body.data.data as { postId: string }[]).map((r) => r.postId);
    expect(outIds, "`listPollsTx` là SQL MỚI — vế audience của nó phải có lưới").not.toContain(
      mine.postId,
    );

    for (const res of [
      await get(outsider.token, `/social/posts/${mine.postId}/poll/results`),
      await put(outsider.token, `/social/posts/${mine.postId}/poll/vote`).send({
        optionIds: [mine.optionIds[0]],
      }),
      await del(outsider.token, `/social/posts/${mine.postId}/poll/vote`),
      await post(outsider.token, `/social/posts/${mine.postId}/poll/close`),
    ]) {
      // «404 trước 403» (API-19 §6.5): trả 403 cho bài không được thấy là rò SỰ TỒN TẠI.
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.POST_NOT_FOUND);
    }

    // Và không lượt nào ở trên được đụng vào dữ liệu.
    const n = await direct.query(
      `SELECT COUNT(*)::int AS c FROM feed_poll_votes v
         JOIN feed_polls p ON p.id = v.poll_id WHERE p.post_id = $1`,
      [mine.postId],
    );
    expect(n.rows[0].c, "chỉ còn phiếu của người TRONG đơn vị").toBe(1);
    expect(await pollStatus(mine.postId), "lượt `044` của người ngoài không đóng được").toBe(
      "open",
    );
  });

  // ═══════════════════════ N2b · J-5 · CHÉO TENANT ═══════════════════════

  it("J-5 — bình chọn của tenant B: tenant A không đọc/ghi/đóng được, và job của A không đụng", async () => {
    const bPoll = await createPoll(bAuthor.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(bPoll.status, JSON.stringify(bPoll.body)).toBe(201);
    await expirePoll(bPoll.postId);

    // Neo dương: tenant A CÓ một poll quá hạn của riêng mình để job có việc thật mà làm.
    const aPoll = await createPoll(author.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expirePoll(aPoll.postId);

    // ── DENY đọc/ghi chéo tenant: 5 route, dùng postId THẬT của B ──
    for (const res of [
      await get(author.token, `/social/posts/${bPoll.postId}/poll/results`),
      await put(author.token, `/social/posts/${bPoll.postId}/poll/vote`).send({
        optionIds: [bPoll.optionIds[0]],
      }),
      await del(author.token, `/social/posts/${bPoll.postId}/poll/vote`),
      await post(author.token, `/social/posts/${bPoll.postId}/poll/close`),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }

    const listA = await get(author.token, "/social/polls?limit=100");
    const idsA = (listA.body.data.data as { postId: string }[]).map((r) => r.postId);
    expect(idsA, "neo dương: A thấy poll của chính A").toContain(aPoll.postId);
    expect(idsA, "và KHÔNG thấy poll của B").not.toContain(bPoll.postId);

    // ── DENY job: nhịp của A không được gặt hàng của B ──
    const res = await job().run({ companyId: A.companyId });
    expect(res.total, "neo dương: job của A có đóng ít nhất poll của A").toBeGreaterThan(0);
    expect(await pollStatus(aPoll.postId)).toBe("closed");
    expect(await pollStatus(bPoll.postId), "poll quá hạn của B phải CÒN NGUYÊN").toBe("open");
    expect(await outboxRows(bPoll.postId), "và không phát NOTI nào cho B").toHaveLength(0);

    // ALLOW đối chứng: nhịp của B thì đóng được — chứng minh ca trên đỏ vì TENANT, không vì vị từ.
    const resB = await job().run({ companyId: B.companyId });
    expect(resB.total).toBeGreaterThan(0);
    expect(await pollStatus(bPoll.postId)).toBe("closed");
  });

  // ═══════════════════════ N3 · J-4 · handler có được ĐĂNG KÝ không ═══════════════════════

  it("J-4 — `jobCode` được `DiscoveryService` gom từ AppModule THẬT, và DUY NHẤT toàn hệ", async () => {
    const { DiscoveryService } = await import("@nestjs/core");
    const { SYSTEM_JOB_HANDLER } = await import("../../src/scheduler/job-handler");
    const discovery = app.get(DiscoveryService);

    const codes = discovery
      .getProviders()
      .filter(
        (w) =>
          w.metatype &&
          w.instance != null &&
          Reflect.getMetadata(SYSTEM_JOB_HANDLER, w.metatype) === true,
      )
      .map((w) => (w.instance as { jobCode?: string }).jobCode);

    // 🔴 Đây là vế mà `app.get(Handler).run()` KHÔNG đo được: gỡ `@SystemJobHandler()` thì mọi ca
    // job khác vẫn xanh, còn PROD thì `closes_at` trôi mãi mà poll vẫn `open` và NOTI-035 không
    // bao giờ phát. `NODE_ENV=test` cũng làm scheduler tự tắt nên không có cổng nào khác.
    expect(codes, "neo dương: có ít nhất một handler được gom").not.toHaveLength(0);
    expect(codes).toContain(SOCIAL_POLL_CLOSE_EXPIRED_JOB_CODE);
    // Trùng `jobCode` = hai job giành MỘT khoá `system_job_locks` ⇒ một trong hai không bao giờ chạy.
    expect(codes.filter((c) => c === SOCIAL_POLL_CLOSE_EXPIRED_JOB_CODE)).toHaveLength(1);
  });

  // ═══════════════════════ N4-db · tên constraint có THẬT không ═══════════════════════

  it("N4-db — hai tên constraint mà service DỊCH đều tồn tại trong DB", async () => {
    const names = [SOCIAL_CONSTRAINT.POLL_VOTE_PK, SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ];
    const r = await direct.query(
      `SELECT relname FROM pg_class WHERE relkind = 'i' AND relname = ANY($1::text[])`,
      [names],
    );
    const found = (r.rows as { relname: string }[]).map((x) => x.relname);

    // Gõ sai tên ⇒ `isUniqueViolationOf` trả false ⇒ lỗi rơi xuống nhánh chung ⇒ **500 chưa dịch**
    // đúng vào ngày nhánh đó sống lại. Unit-spec không đo được vế này (nó tự cấp tên).
    for (const n of names) expect(found, `constraint "${n}" không tồn tại trong DB`).toContain(n);
  });

  // ═══════════════════════ N5 · bài đã xoá mềm & tác giả không hồ sơ ═══════════════════════

  it("N5a — poll quá hạn của bài ĐÃ XOÁ MỀM: job KHÔNG đóng, KHÔNG phát NOTI", async () => {
    const trashed = await createPoll(author.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const alive = await createPoll(author.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expirePoll(trashed.postId);
    await expirePoll(alive.postId);
    await direct.query(`UPDATE feed_posts SET deleted_at = now() WHERE id = $1`, [trashed.postId]);

    await job().run({ companyId: A.companyId });

    // ALLOW đối chứng đi kèm: bài còn sống thì ĐÓNG ĐƯỢC ⇒ ca dưới đỏ vì `deleted_at`, không vì
    // job không chạy.
    expect(await pollStatus(alive.postId), "neo dương: bài còn sống vẫn được đóng").toBe("closed");
    expect(await outboxRows(alive.postId)).toHaveLength(1);

    expect(await pollStatus(trashed.postId), "bài trong thùng rác KHÔNG được đóng").toBe("open");
    // 🔴 NOTI-035 chở `poll_question`, và hàng `notifications` sống lâu hơn bài: phát cho bài đã xoá
    // làm câu hỏi TÁI XUẤT HIỆN qua đường thông báo, người nhận bấm vào thì ăn 404.
    expect(await outboxRows(trashed.postId), "không phát NOTI cho bài đã xoá mềm").toHaveLength(0);
    expect(await auditCloseRows(trashed.postId)).toBe(0);
  });

  it("N5b — tác giả KHÔNG có hồ sơ nhân sự: poll VẪN đóng, nhưng KHÔNG có người nhận", async () => {
    const ghostPoll = await createPoll(ghost.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    // Neo dương: tài khoản không-hồ-sơ TẠO ĐƯỢC bài (`employeeIdOf` trả `null` là hợp lệ) — nếu
    // không tạo được thì ca này không đo gì cả.
    expect(ghostPoll.status, JSON.stringify(ghostPoll.body)).toBe(201);
    await expirePoll(ghostPoll.postId);

    await job().run({ companyId: A.companyId });

    // Hai vế TÁCH BẠCH: FSM vẫn chạy (bình chọn phải đóng đúng hạn dù ai là tác giả), chỉ người
    // nhận là rỗng — owner chốt O-2 ngày 23/09 giữ INNER JOIN `employee_profiles`, cùng luật với
    // NOTI-031 đã ship.
    expect(await pollStatus(ghostPoll.postId), "FSM không phụ thuộc hồ sơ nhân sự").toBe("closed");
    expect(await auditCloseRows(ghostPoll.postId), "audit vẫn ghi").toBe(1);
    expect(await outboxRows(ghostPoll.postId), "tập người nhận rỗng ⇒ KHÔNG enqueue").toHaveLength(
      0,
    );
  });

  // ═══════════════════════ N7 · job theo LÔ · NOTI · audit 1 dòng/poll ═══════════════════════

  it("O-1/N7 — một nhịp đóng NHIỀU poll: audit ĐÚNG 1 dòng/poll, NOTI 1 event/poll", async () => {
    const polls = [];
    for (let i = 0; i < 3; i += 1) {
      const p = await createPoll(author.token, {
        closesAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(p.status).toBe(201);
      await expirePoll(p.postId);
      polls.push(p);
    }

    const res = await job().run({ companyId: A.companyId });
    expect(res.total, "neo dương: nhịp này có đóng ít nhất 3 poll").toBeGreaterThanOrEqual(3);

    for (const p of polls) {
      expect(await pollStatus(p.postId)).toBe("closed");
      // 🔴 Owner chốt O-1: MỖI poll một dòng audit, tra được bằng `object_id` của CHÍNH NÓ. Bản cũ
      // ghi một dòng cho cả lô (`object_id` = bài đầu tiên) ⇒ poll thứ 2..N chỉ nằm trong
      // `metadata.postIds`, thứ mà mọi màn lọc audit theo đối tượng không đọc.
      expect(await auditCloseRows(p.postId), `audit của ${p.postId}`).toBe(1);
      expect(await outboxRows(p.postId), `NOTI của ${p.postId}`).toHaveLength(1);
    }

    // `recordMany`/`enqueueMany` ghi MỘT câu cho cả lô — vế này chứng minh lô > 1 thật sự đi qua
    // đường đó mà không mất hàng nào (vòng `for` gọi bản đơn cũng xanh ở đây, nhưng nó là
    // `N` round-trip trong tx đang giữ khoá — hình dạng mà H-3 đã chặn).
    const dist = await direct.query(
      `SELECT DISTINCT metadata->>'via' AS via, (metadata->>'batchSize')::int AS batch
         FROM audit_logs WHERE company_id = $1 AND action = 'social.poll.close'
          AND object_id = ANY($2::uuid[])`,
      [A.companyId, polls.map((p) => p.postId)],
    );
    expect(dist.rows.every((r: { via: string }) => r.via === "job")).toBe(true);
    expect(
      dist.rows.every((r: { batch: number }) => r.batch >= 3),
      "cả 3 dòng phải cùng ghi nhận một nhịp gặt ≥ 3 hàng",
    ).toBe(true);
  });

  it("N-035 — người nhận là TÁC GIẢ, và người bỏ phiếu KHÔNG nhận, payload không chở cử tri", async () => {
    const p = await createPoll(author.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      (
        await put(outsider.token, `/social/posts/${p.postId}/poll/vote`).send({
          optionIds: [p.optionIds[0]],
        })
      ).status,
      "neo dương: có một cử tri THẬT để mà lộ",
    ).toBe(200);

    await expirePoll(p.postId);
    await job().run({ companyId: A.companyId });

    const rows = await outboxRows(p.postId);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload;
    expect(payload.recipientUserIds, "đúng MỘT người: tác giả bài").toEqual([author.userId]);
    // 🔴 Vét cả GIÁ TRỊ, không chỉ tên khoá: id cử tri không được lọt qua bất kỳ khoá nào.
    expect(JSON.stringify(payload), "payload NOTI-035 chở id cử tri").not.toContain(
      outsider.userId,
    );
  });

  it("J-3 — job và `044` ĐUA nhau trên cùng poll: đúng MỘT NOTI, một dòng audit", async () => {
    const p = await createPoll(author.token, {
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expirePoll(p.postId);

    const [jobRes, manual] = await Promise.allSettled([
      job().run({ companyId: A.companyId }),
      post(author.token, `/social/posts/${p.postId}/poll/close`),
    ]);

    // Ai thắng KHÔNG quan trọng — bất biến là hàng chỉ đóng MỘT LẦN nên chỉ MỘT bên ghi được.
    // Ở READ COMMITTED, Postgres re-check `WHERE status='open'` sau khi chờ khoá hàng, nên bên
    // thua rớt khỏi tập `RETURNING` thay vì ghi đè.
    expect(jobRes.status, "job không được ném").toBe("fulfilled");
    if (manual.status === "fulfilled") {
      expect([201, 409], `044 trả ${manual.value.status}`).toContain(manual.value.status);
    }

    expect(await pollStatus(p.postId)).toBe("closed");
    expect(await outboxRows(p.postId), "đua KHÔNG được phát NOTI hai lần").toHaveLength(1);
    expect(await auditCloseRows(p.postId), "và KHÔNG được ghi audit hai lần").toBe(1);
  });
});
