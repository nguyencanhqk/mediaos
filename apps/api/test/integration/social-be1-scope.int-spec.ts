/**
 * S16-SOCIAL-BE-1 — ma trận quyền per-pair + SÀN tầng-1 (`tier1IsFloor`) + cross-tenant.
 * Khuôn `recruit-be1-scope.int-spec.ts` (A/B cùng request, chủ thể dựng bằng API thật — KHÔNG
 * super-admin).
 *
 * ┌─ MỌI CA DENY Ở ĐÂY ĐỀU CÓ CA ALLOW ĐỐI CHỨNG ─────────────────────────────────────────────────┐
 * │ Cùng route, cùng fixture, chỉ đổi ACTOR — và ca allow assert 2xx + nội dung ≠ rỗng. Không có   │
 * │ vế đó thì một route hỏng-toàn-tập (vd sai path ⇒ 404 mọi lúc) làm MỌI ca deny xanh giả          │
 * │ (`deny-cases-vacuous-without-allow-case`).                                                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
const LOGIN_PW = "Passw0rd!socialbe1";

/** 5 cặp `feed-*` mà 19 route Nhóm A thực sự dùng. TẤT CẢ đều `is_sensitive=false` (mig 0578). */
type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news";

const ROUTE_PAIRS: PairKey[] = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "manage:feed-post",
  "manage:feed-news",
];

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1 ma trận quyền + sàn tầng-1 (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  /** Đủ 5 cặp — chủ thể dựng fixture. */
  let tFull = "";
  /** Chỉ `view:feed` + `create:feed-*` — nhân viên thường. */
  let tEmployee = "";
  /** `view:feed` + `create:*` + `manage:feed-post`, KHÔNG `manage:feed-news` (ca R13). */
  let tPostManager = "";
  /** `view:feed` + `create:*` + `manage:feed-news`, KHÔNG `manage:feed-post` (ca R12 — dư lượng M18). */
  let tNewsManager = "";
  /** Tenant B — cross-tenant (R23). */
  let tOther = "";

  let postId = "";
  let newsPostId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: readonly PairKey[],
    /** Scope cua grant. Mac dinh `Company` — moi vai canonical (mig 0578) dung o day. */
    scope: "Company" | "Department" | "Team" | "Own" = "Company",
  ) {
    const roleId = await seedRole(
      direct,
      companyId,
      `socialbe1-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      // Mọi cặp `feed-*` là NON-sensitive (mig 0578) — truyền cờ TƯỜNG MINH; `seedPermissionCatalog`
      // tự NÉM nếu lệch với catalog, nên đây là một phép đo chứ không phải một lời khai.
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(companySlug: string, email: string): Promise<string> {
    const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeActor(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
  ): Promise<string> {
    const email = `${label}@${tenant.slug}.test`;
    const uid = await seedUser(direct, tenant.companyId, email, hash);
    await grantPairs(tenant.companyId, uid, label, pairs);
    return login(tenant.slug, email);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "socialbe1a");
    B = await seedCompany(direct, "socialbe1b");
    companyIds.push(A.companyId, B.companyId);

    tFull = await makeActor(A, "full", ROUTE_PAIRS, hash);
    tEmployee = await makeActor(
      A,
      "employee",
      ["view:feed", "create:feed-post", "create:feed-comment"],
      hash,
    );
    tPostManager = await makeActor(
      A,
      "postmgr",
      ["view:feed", "create:feed-post", "create:feed-comment", "manage:feed-post"],
      hash,
    );
    tNewsManager = await makeActor(
      A,
      "newsmgr",
      ["view:feed", "create:feed-post", "create:feed-comment", "manage:feed-news"],
      hash,
    );
    tOther = await makeActor(B, "other", ROUTE_PAIRS, hash);

    // Fixture qua API THẬT (giữ đúng counter/quan hệ — không gieo tay).
    const share = await post(tFull, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài chia sẻ fixture #chiase",
    });
    expect(share.status, JSON.stringify(share.body)).toBe(201);
    postId = share.body.data.id;

    const news = await post(tFull, "/social/posts").send({
      type: "news",
      audience: "company",
      body: "Tin tức công ty fixture",
    });
    expect(news.status, JSON.stringify(news.body)).toBe(201);
    newsPostId = news.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ Tầng 1 — thiếu cặp của route ⇒ 403, có cặp ⇒ 2xx ══════════════

  describe("tầng 1 — decorator", () => {
    it("ALLOW đối chứng: đủ cặp ⇒ GET /social/feed 200 + có dữ liệu THẬT", async () => {
      const res = await get(tFull, "/social/feed");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Neo chống-xanh-rỗng: mảng rỗng làm mọi ca deny bên dưới vô nghĩa.
      expect(res.body.data.data.length).toBeGreaterThan(0);
    });

    it("DENY: thiếu `view:feed` ⇒ 403 trên GET /social/feed", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = await makeActor(A, "noviewfeed", ["create:feed-post"], hash);
      expect((await get(t, "/social/feed")).status).toBe(403);
    });

    it("DENY: thiếu `create:feed-post` ⇒ 403 trên POST /social/posts (ALLOW: có cặp ⇒ 201)", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = await makeActor(A, "nocreatepost", ["view:feed", "create:feed-comment"], hash);
      const deny = await post(t, "/social/posts").send({ type: "share", body: "thử" });
      expect(deny.status, JSON.stringify(deny.body)).toBe(403);

      const allow = await post(tEmployee, "/social/posts").send({ type: "share", body: "thử OK" });
      expect(allow.status, JSON.stringify(allow.body)).toBe(201);
      expect(allow.body.data.body).toBe("thử OK");
    });

    it("DENY: thiếu `create:feed-comment` ⇒ 403 trên POST comments (ALLOW: có cặp ⇒ 201)", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const t = await makeActor(A, "nocreatecomment", ["view:feed", "create:feed-post"], hash);
      const deny = await post(t, `/social/posts/${postId}/comments`).send({ body: "hi" });
      expect(deny.status, JSON.stringify(deny.body)).toBe(403);

      const allow = await post(tEmployee, `/social/posts/${postId}/comments`).send({ body: "hi" });
      expect(allow.status, JSON.stringify(allow.body)).toBe(201);
      expect(allow.body.data.body).toBe("hi");
    });
  });

  // ══════════════ R10 — `002` SÀN: type=news đòi thêm `manage:feed-news` ══════════════

  describe("R10 / D4 — `POST /social/posts` sàn `create:feed-post`, nhánh news đòi thêm", () => {
    it("DENY: `type='news'` mà KHÔNG có `manage:feed-news` ⇒ 403 SOCIAL-ERR-010", async () => {
      const res = await post(tEmployee, "/social/posts").send({
        type: "news",
        audience: "company",
        body: "Tin tức lén",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-010");
    });

    it("ALLOW đối chứng: CÙNG request với actor có `manage:feed-news` ⇒ 201", async () => {
      const res = await post(tNewsManager, "/social/posts").send({
        type: "news",
        audience: "company",
        body: "Tin tức hợp lệ",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.type).toBe("news");
    });

    it("ALLOW: `type='share'` KHÔNG cần `manage:feed-news` ⇒ 201 (sàn là đủ cho nhánh này)", async () => {
      const res = await post(tEmployee, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Chia sẻ thường",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ══════════════ R12/R13 — `006` SÀN `manage:feed-post` + per-field ══════════════

  describe("R12/R13 / D5 — `/moderation` sàn + cặp theo TỪNG TRƯỜNG", () => {
    it("R12 DENY: chỉ có `manage:feed-news` ⇒ 403 Ở TẦNG 1, KỂ CẢ khi chỉ đổi `pinned`", async () => {
      // ⚠️ Đây là DƯ LƯỢNG ĐÃ ĐO VÀ CHẤP NHẬN của D5/M18, KHÔNG phải bug: sàn `manage:feed-post`
      // chặn TRƯỚC khi vào service. Hôm nay 0 tác động lên vai canonical (hai cặp cấp cùng tập vai
      // `hr`+`company-admin`, mig 0578:92-95); dư lượng chỉ chạm vai TUỲ BIẾN — nợ S16-SOCIAL-BE-2.
      const res = await patch(tNewsManager, `/social/posts/${newsPostId}/moderation`).send({
        pinned: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("R12 ALLOW đối chứng: actor có CẢ HAI cặp ⇒ ghim được (đúng vai canonical hôm nay)", async () => {
      const res = await patch(tFull, `/social/posts/${newsPostId}/moderation`).send({
        pinned: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.pinned).toBe(true);
    });

    it("R13 ALLOW: chỉ `manage:feed-post` ⇒ ẩn/khoá bình luận được (sàn ĐỦ cho nhánh này)", async () => {
      const res = await patch(tPostManager, `/social/posts/${postId}/moderation`).send({
        commentsLocked: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.commentsLocked).toBe(true);

      // Trả lại trạng thái cho các ca sau.
      const undo = await patch(tPostManager, `/social/posts/${postId}/moderation`).send({
        commentsLocked: false,
      });
      expect(undo.status).toBe(200);
    });

    it("R13 DENY: CÙNG actor đó đổi `pinned` ⇒ 403 (hai quyền ĐỘC LẬP)", async () => {
      const res = await patch(tPostManager, `/social/posts/${newsPostId}/moderation`).send({
        pinned: false,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-010");
    });

    it("R13 — request đổi 2 trường mà MỘT trường bị từ chối ⇒ KHÔNG trường nào đổi", async () => {
      // Kiểm TẤT CẢ rồi mới ghi: nếu không, người dùng nhận 403 nhưng nửa thao tác đã xảy ra và
      // audit ghi một nửa sự thật.
      const before = await get(tFull, `/social/posts/${newsPostId}`);
      expect(before.status).toBe(200);
      const wasLocked = before.body.data.commentsLocked as boolean;

      const res = await patch(tPostManager, `/social/posts/${newsPostId}/moderation`).send({
        commentsLocked: !wasLocked,
        pinned: false,
      });
      expect(res.status).toBe(403);

      const after = await get(tFull, `/social/posts/${newsPostId}`);
      expect(after.body.data.commentsLocked, "trường ĐƯỢC PHÉP cũng không được đổi").toBe(
        wasLocked,
      );
    });

    it("R11 — ghim một bài KHÔNG phải `news` ⇒ 422, KHÔNG 500 (CHECK chặn ở app TRƯỚC)", async () => {
      const res = await patch(tFull, `/social/posts/${postId}/moderation`).send({ pinned: true });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    });

    it("body rỗng ⇒ 400 (không có gì để làm mà vẫn chạm đường audit)", async () => {
      const res = await patch(tFull, `/social/posts/${postId}/moderation`).send({});
      expect(res.status).toBe(400);
    });
  });

  // ══════════════ R26 — bộ lọc `status` của `001` có cổng riêng ══════════════

  describe("R26 — `GET /social/feed?status=hidden` đòi `manage:feed-post`", () => {
    it("DENY: actor thường ⇒ 403 (KHÔNG im lặng ép về `published`)", async () => {
      const res = await get(tEmployee, "/social/feed?status=hidden");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ALLOW đối chứng: CÙNG query với `manage:feed-post` ⇒ 200", async () => {
      const res = await get(tPostManager, "/social/feed?status=hidden");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it("`status=published` KHÔNG đòi cặp thêm ⇒ 200 cho actor thường", async () => {
      const res = await get(tEmployee, "/social/feed?status=published");
      expect(res.status).toBe(200);
    });

    it("`status=deleted` KHÔNG phải giá trị hợp lệ ⇒ 400 (không có đường đọc bài đã xoá)", async () => {
      expect((await get(tPostManager, "/social/feed?status=deleted")).status).toBe(400);
    });
  });

  // ══════════════ R23 — cross-tenant ══════════════

  /**
   * SÀN SCOPE Company cho CỜ DẪN XUẤT (FULL gate PR #530, HIGH-1).
   *
   * `SOCIAL_ROUTE_PAIRS` khai `companyFloor = true` cho TOÀN BỘ 19 route, nên hợp đồng của module là:
   * `manage:feed-post` CHỈ hợp lệ ở scope Company. Sàn đó được ép cho cặp CỦA ROUTE (`resolveActor`),
   * nhưng hai cờ DẪN XUẤT (`canManagePosts`/`canManageNews`) từng đọc bằng `scope !== null` — và
   * `resolveManyOrNull` trả scope MẠNH NHẤT mà KHÔNG ép sàn nào.
   *
   * Hệ quả (đo ở các ca dưới): một vai giữ `manage:feed-post`@`Department` — grant mà API ghi quyền
   * CHO PHÉP tạo (`role-admin.service.ts` chỉ chặn `System`) — bị 403 đúng ở route 006 SỞ HỮU năng
   * lực kiểm duyệt, nhưng lại đọc được mọi bài `hidden` toàn công ty và sửa/xoá nội dung của BẤT KỲ
   * ai qua 004/005/016/017. "Ô cửa sổ rộng hơn cửa chính" — đúng chữ của BLOCKER B3 ở PAYROLL
   * (`payroll-access.service.ts:144-151`), lớp lỗi kho này đã hardened một lần rồi.
   *
   * Hôm nay tác động với vai CANONICAL = 0 (mig 0578 cấp mọi cặp `feed-*` ở `Company`), nên đây là
   * fail-OPEN TIỀM ẨN: kích hoạt bằng một lần cấp quyền hợp lệ qua API đã ship.
   */
  describe("cờ dẫn xuất canManagePosts — grant HẸP hơn Company không được nới thành toàn công ty", () => {
    /** `view:feed`+`create:*` @Company, nhưng `manage:feed-post` @Department. */
    let tDeptManager = "";
    /** Bài `hidden` của NGƯỜI KHÁC (tác giả `tFull`) — đo đường ĐỌC. */
    let hiddenPostId = "";
    /**
     * Bài RIÊNG cho các ca sửa/xoá. KHÔNG dùng `postId` dùng chung: khi sàn scope hỏng, ca "XOÁ bài
     * của người khác" THÀNH CÔNG thật và xoá mềm luôn fixture chia sẻ ⇒ R23 đỏ theo và báo SAI chỗ
     * hỏng (đo được ở lượt RED của chính finding này).
     */
    let ownPostId = "";

    beforeAll(async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `deptmgr@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      // HAI role cho CÙNG user: cặp thường ở Company, cặp quản lý ở Department. Đây là hình dạng
      // thật của ý định "moderator của một phòng" mà admin dựng được qua API ghi quyền.
      await grantPairs(
        A.companyId,
        uid,
        "deptmgr-co",
        ["view:feed", "create:feed-post", "create:feed-comment"],
        "Company",
      );
      await grantPairs(A.companyId, uid, "deptmgr-dept", ["manage:feed-post"], "Department");
      tDeptManager = await login(A.slug, email);

      const h = await post(tFull, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bai se bi an cho ca san scope",
      });
      expect(h.status, JSON.stringify(h.body)).toBe(201);
      hiddenPostId = h.body.data.id;
      expect(
        (
          await patch(tFull, `/social/posts/${hiddenPostId}/moderation`).send({
            hidden: true,
          })
        ).status,
      ).toBe(200);

      const m = await post(tFull, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bai rieng cho ca sua-xoa cua block san scope",
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      ownPostId = m.body.data.id;
    }, 120_000);

    it("DENY: grant @Department ⇒ GET /social/feed?status=hidden 403", async () => {
      const res = await get(tDeptManager, "/social/feed?status=hidden");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("DENY: grant @Department ⇒ đọc bài hidden của người khác ⇒ 404", async () => {
      const res = await get(tDeptManager, `/social/posts/${hiddenPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("DENY: grant @Department ⇒ SỬA bài của người khác ⇒ 403 SOCIAL-ERR-003", async () => {
      const res = await patch(tDeptManager, `/social/posts/${ownPostId}`).send({
        body: "toi sua ho",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-003");
    });

    it("DENY: grant @Department ⇒ XOÁ bài của người khác ⇒ 403", async () => {
      const res = await auth(tDeptManager)(http().delete(`/social/posts/${ownPostId}`));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("đối chứng — 006 /moderation vốn ĐÃ 403 ở tầng 1 với grant @Department (cửa chính)", async () => {
      // Đóng đinh sự BẤT ĐỐI XỨNG là lý do finding tồn tại: cửa chính đã khoá từ trước, chỉ các ô
      // cửa sổ bên cạnh là mở. Nếu ai gỡ sàn ở `resolveActor`, ca này đỏ.
      const res = await patch(tDeptManager, `/social/posts/${ownPostId}/moderation`).send({
        hidden: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ALLOW đối chứng: CÙNG các cặp đó ở @Company ⇒ đọc bài ẩn + sửa bài người khác được", async () => {
      // Neo chống-xanh-rỗng: nếu SOCIAL từ chối manage với MỌI scope thì 5 ca deny trên vẫn xanh
      // trong khi tính năng kiểm duyệt đã chết.
      expect((await get(tPostManager, "/social/feed?status=hidden")).status).toBe(200);
      expect((await get(tPostManager, `/social/posts/${hiddenPostId}`)).status).toBe(200);
      const upd = await patch(tPostManager, `/social/posts/${ownPostId}`).send({
        body: "quan ly Company sua duoc",
      });
      expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    });
  });
  describe("R23 — cô lập tenant", () => {
    it("DENY: company B đọc bài của company A ⇒ 404 (RLS + vị từ, KHÔNG 403)", async () => {
      const res = await get(tOther, `/social/posts/${postId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("ALLOW đối chứng: company A tự đọc bài đó ⇒ 200", async () => {
      const res = await get(tFull, `/social/posts/${postId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(postId);
    });

    it("DENY: company B KHÔNG thấy bài của A trong dòng cuộn của mình", async () => {
      const res = await get(tOther, "/social/feed");
      expect(res.status).toBe(200);
      const ids = (res.body.data.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).not.toContain(postId);
    });

    it("DENY: company B thả cảm xúc lên bài của A ⇒ 404 (IDOR chặn TRƯỚC insert)", async () => {
      // ⚠️ Bộ cảm xúc là TÊN (`like|love|haha|wow|sad|angry` — `chat.ts:216`), KHÔNG phải ký tự
      // emoji. Dùng ký tự unicode ở đây sẽ bị Zod chặn 400 TRƯỚC khi chạm cổng IDOR ⇒ ca này xanh
      // giả (nó sẽ "deny", nhưng vì lý do hoàn toàn khác với lý do nó được viết ra để đo).
      const res = await auth(tOther)(http().put(`/social/posts/${postId}/reaction`)).send({
        emoji: "like",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  });

  // ══════════════ R22 — bộ mặc định của nhân viên thường ══════════════

  it("R22 — nhân viên thường (chỉ bộ cặp mặc định) đăng được bài `share`", async () => {
    const res = await post(tEmployee, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Nhân viên thường vẫn đăng được",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.isMine).toBe(true);
  });
});
