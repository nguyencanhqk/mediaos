/**
 * S16-SOCIAL-BE-1 — ranh giới NHÌN THẤY: bài `hidden`, `audience='org_unit'`, IDOR đa hình, và
 * quyền sửa/xoá nội dung người khác (SPEC-16 §12 · plan §5 R1/R2/R4 · D1t/D2t · D6 · D13).
 *
 * ⚠️ **404 TRƯỚC 403 ở nhánh ĐỌC.** Mọi ca deny ở đây kỳ vọng 404 với CÙNG MỘT thông điệp — 403 sẽ
 * xác nhận đối tượng CÓ THẬT, tức biến chính lưới này thành oracle dò kho bài của cả công ty.
 *
 * Mọi ca DENY có ca ALLOW đối chứng cùng route/fixture, chỉ đổi actor.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
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
const LOGIN_PW = "Passw0rd!socialvis1";

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news";

const BASE_PAIRS: PairKey[] = ["view:feed", "create:feed-post", "create:feed-comment"];
const ALL_PAIRS: PairKey[] = [...BASE_PAIRS, "manage:feed-post", "manage:feed-news"];

describe.skipIf(!hasLaneDb)("S16-SOCIAL-BE-1 ranh giới nhìn thấy + IDOR (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  /** Tác giả của mọi fixture, có đủ cặp. */
  let tAuthor = "";
  /** Nhân viên thường CÙNG đơn vị với tác giả. */
  let tSameUnit = "";
  /** Nhân viên thường đơn vị KHÁC. */
  let tOtherUnit = "";
  /** Trưởng đơn vị CHA của đơn vị tác giả — ca D13 (KHÔNG suy diễn cây con). */
  let tParentHead = "";
  /** Có `manage:feed-post` — đọc được bài `hidden`, sửa/xoá bài người khác. */
  let tManager = "";
  /** Tenant B. */
  let tOther = "";

  let unitChildId = "";
  let unitParentId = "";
  let unitOtherId = "";

  let publicPostId = "";
  let hiddenPostId = "";
  let orgUnitPostId = "";
  let deletedPostId = "";
  let commentOnPublicId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));
  const del = (t: string, u: string) => auth(t)(http().delete(u));
  const put = (t: string, u: string) => auth(t)(http().put(u));

  async function seedOrgUnit(
    companyId: string,
    name: string,
    parentId: string | null = null,
    headUserId: string | null = null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, parent_id, head_user_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [companyId, name, parentId, headUserId],
    );
    return r.rows[0].id as string;
  }

  async function grantPairs(companyId: string, userId: string, pairs: readonly PairKey[]) {
    const roleId = await seedRole(direct, companyId, `socvis-${randomUUID().slice(0, 8)}`);
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** User + employee_profile gắn org_unit (nguồn của `orgUnitIds` trong actor). */
  async function makeMember(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
    orgUnitId: string | null,
  ): Promise<{ token: string; userId: string }> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    await grantPairs(tenant.companyId, userId, pairs);
    return { token: await login(tenant.slug, email), userId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "socvisa");
    B = await seedCompany(direct, "socvisb");
    companyIds.push(A.companyId, B.companyId);

    unitParentId = await seedOrgUnit(A.companyId, "Khối Kỹ thuật");
    unitChildId = await seedOrgUnit(A.companyId, "Tổ Backend", unitParentId);
    unitOtherId = await seedOrgUnit(A.companyId, "Phòng Nhân sự");

    const author = await makeMember(A, "author", ALL_PAIRS, hash, unitChildId);
    tAuthor = author.token;
    tSameUnit = (await makeMember(A, "sameunit", BASE_PAIRS, hash, unitChildId)).token;
    tOtherUnit = (await makeMember(A, "otherunit", BASE_PAIRS, hash, unitOtherId)).token;
    tManager = (await makeMember(A, "manager", ALL_PAIRS, hash, unitOtherId)).token;
    tOther = (await makeMember(B, "outsider", ALL_PAIRS, hash, null)).token;

    // Trưởng đơn vị CHA — thuộc đơn vị CHA, và là head của chính nó.
    const parentHead = await makeMember(A, "parenthead", BASE_PAIRS, hash, unitParentId);
    await direct.query(`UPDATE org_units SET head_user_id = $1 WHERE id = $2`, [
      parentHead.userId,
      unitParentId,
    ]);
    // Token phải lấy SAU khi gán head (scope context đọc tươi mỗi request nên token cũ vẫn đúng,
    // nhưng lấy lại cho rõ ràng).
    tParentHead = await login(A.slug, `parenthead@${A.slug}.test`);

    const pub = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài công khai #chung",
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    publicPostId = pub.body.data.id;

    const hidden = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài sẽ bị ẩn",
    });
    expect(hidden.status).toBe(201);
    hiddenPostId = hidden.body.data.id;
    const hide = await patch(tManager, `/social/posts/${hiddenPostId}/moderation`).send({
      hidden: true,
    });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);

    const org = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "org_unit",
      orgUnitId: unitChildId,
      body: "Bài riêng của Tổ Backend",
    });
    expect(org.status, JSON.stringify(org.body)).toBe(201);
    orgUnitPostId = org.body.data.id;

    const gone = await post(tAuthor, "/social/posts").send({
      type: "share",
      audience: "company",
      body: "Bài sẽ bị xoá",
    });
    expect(gone.status).toBe(201);
    deletedPostId = gone.body.data.id;
    expect((await del(tAuthor, `/social/posts/${deletedPostId}`)).status).toBe(200);

    const c = await post(tSameUnit, `/social/posts/${publicPostId}/comments`).send({
      body: "Bình luận gốc",
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    commentOnPublicId = c.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ R1 — bài `hidden` / đã xoá ══════════════

  describe("R1 — bài `hidden` và bài đã xoá mềm", () => {
    it("DENY: người thường đọc bài `hidden` ⇒ 404 SOCIAL-ERR-001 (KHÔNG 403)", async () => {
      const res = await get(tSameUnit, `/social/posts/${hiddenPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-001");
    });

    it("ALLOW đối chứng: TÁC GIẢ đọc bài `hidden` của mình ⇒ 200 + đủ trường", async () => {
      const res = await get(tAuthor, `/social/posts/${hiddenPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.body).toBe("Bài sẽ bị ẩn");
      // Tác giả THẤY `status`; người thường thì không (kiểm ở ca dưới).
      expect(res.body.data.status).toBe("hidden");
    });

    it("ALLOW đối chứng: `manage:feed-post` đọc bài `hidden` ⇒ 200", async () => {
      const res = await get(tManager, `/social/posts/${hiddenPostId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("hidden");
    });

    it("người thường đọc bài CÔNG KHAI: DTO KHÔNG có `status` lẫn `authorUserId`", async () => {
      const res = await get(tSameUnit, `/social/posts/${publicPostId}`);
      expect(res.status).toBe(200);
      expect("status" in res.body.data).toBe(false);
      expect(JSON.stringify(res.body.data)).not.toContain("authorUserId");
    });

    it("DENY: bài ĐÃ XOÁ MỀM ⇒ 404 cho MỌI người, kể cả tác giả và `manage:feed-post`", async () => {
      // Không có ngoại lệ nào: BE-1 không có route thùng rác, nên một nhánh "manage thấy bài đã xoá"
      // sẽ là đường đọc DUY NHẤT vào dữ liệu đã xoá mà không cổng nào gác.
      for (const t of [tAuthor, tManager, tSameUnit]) {
        expect((await get(t, `/social/posts/${deletedPostId}`)).status).toBe(404);
      }
    });

    it("bài `hidden`/đã xoá KHÔNG xuất hiện trong dòng cuộn mặc định", async () => {
      const res = await get(tSameUnit, "/social/feed");
      expect(res.status).toBe(200);
      const ids = (res.body.data.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(publicPostId);
      expect(ids).not.toContain(hiddenPostId);
      expect(ids).not.toContain(deletedPostId);
    });
  });

  // ══════════════ R4 / D13 — audience `org_unit` ══════════════

  describe("R4 / D13 — `audience='org_unit'` (KHÔNG suy diễn cây con)", () => {
    it("ALLOW: người CÙNG đơn vị đọc được ⇒ 200", async () => {
      const res = await get(tSameUnit, `/social/posts/${orgUnitPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.body).toBe("Bài riêng của Tổ Backend");
    });

    it("DENY: người đơn vị KHÁC ⇒ 404", async () => {
      const res = await get(tOtherUnit, `/social/posts/${orgUnitPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("D13 (owner ký 21/09/2026) — trưởng đơn vị CHA KHÔNG đọc được bài của đơn vị CON ⇒ 404", async () => {
      // ⚠️ Đây là HÀNH VI ĐÃ CHỐT, không phải bug. `departmentOrgUnitIds()` = đơn vị của chính mình
      // ∪ đơn vị mình ĐỨNG ĐẦU — không có truy vấn đệ quy trên cây `org_units`. Nếu ca này chuyển
      // thành 200, tức ai đó đã thêm suy diễn cây con: phải đi qua owner, không phải qua một PR sửa lỗi.
      const res = await get(tParentHead, `/social/posts/${orgUnitPostId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("ALLOW đối chứng: CHÍNH trưởng đơn vị đó đọc bài của đơn vị MÌNH ĐỨNG ĐẦU ⇒ 200", async () => {
      // Chứng minh vế "∪ đơn vị mình đứng đầu" THẬT SỰ hoạt động — không phải ca trên xanh vì
      // org_unit filter hỏng-toàn-tập.
      const own = await post(tParentHead, "/social/posts").send({
        type: "share",
        audience: "org_unit",
        orgUnitId: unitParentId,
        body: "Bài của Khối Kỹ thuật",
      });
      expect(own.status, JSON.stringify(own.body)).toBe(201);
      const res = await get(tParentHead, `/social/posts/${own.body.data.id}`);
      expect(res.status).toBe(200);
    });

    it("DENY nhánh GHI: đăng vào đơn vị mình KHÔNG thuộc ⇒ 403 SOCIAL-ERR-002", async () => {
      const res = await post(tOtherUnit, "/social/posts").send({
        type: "share",
        audience: "org_unit",
        orgUnitId: unitChildId,
        body: "Đăng lén vào tổ khác",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-002");
    });

    it("bài `org_unit` KHÔNG lọt vào dòng cuộn của người đơn vị khác", async () => {
      const res = await get(tOtherUnit, "/social/feed");
      const ids = (res.body.data.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).not.toContain(orgUnitPostId);
      expect(ids).toContain(publicPostId);
    });

    /**
     * ⟲ **HỢP ĐỒNG ĐỔI Ở `S16-SOCIAL-BE-2A`** (không phải hồi quy): BE-1 chốt cửa `audience='group'`
     * bằng 422 `ERR-008` ("chưa mở"); BE-2A MỞ cửa đó, nên câu trả lời đúng cho một `groupId` lạ giờ
     * là **404 `ERR-012`** — cùng một chuỗi cho "không tồn tại · tenant khác · đã xoá mềm · private
     * mà mình không thuộc", đúng luật 404-trước-403 của SPEC-16 §12.
     *
     * Ca này CỐ Ý ở lại đây (thay vì xoá): nó giữ neo rằng đường `002` + `group` **không bao giờ**
     * trả 201 cho một nhóm actor không thuộc. Ca ALLOW (thành viên `active` đăng được) sống ở
     * `social-group-access.int.spec.ts` / int-spec của BE-2A.
     */
    it("`audience='group'` với nhóm LẠ ⇒ 404 SOCIAL-ERR-012 (BE-2A: 404 trước 403)", async () => {
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "group",
        groupId: randomUUID(),
        body: "Bài nhóm",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-012");
    });
  });

  // ══════════════ R2 — sửa/xoá nội dung người khác ══════════════

  describe("R2 — sửa/xoá bài & bình luận của người khác", () => {
    it("DENY: sửa bài người khác không có `manage:feed-post` ⇒ 403 SOCIAL-ERR-003", async () => {
      const res = await patch(tSameUnit, `/social/posts/${publicPostId}`).send({ body: "sửa lén" });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("SOCIAL-ERR-003");
    });

    it("ALLOW đối chứng: `manage:feed-post` sửa được ⇒ 200", async () => {
      const res = await patch(tManager, `/social/posts/${publicPostId}`).send({
        body: "Bài công khai #chung (đã kiểm duyệt)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.editedAt).not.toBeNull();
    });

    it("ALLOW: TÁC GIẢ tự sửa bài của mình ⇒ 200", async () => {
      const res = await patch(tAuthor, `/social/posts/${publicPostId}`).send({
        body: "Bài công khai #chung (tác giả sửa)",
      });
      expect(res.status).toBe(200);
    });

    it("DENY: xoá bình luận người khác không có `manage:feed-post` ⇒ 403", async () => {
      const res = await del(tOtherUnit, `/social/comments/${commentOnPublicId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ALLOW đối chứng: `manage:feed-post` xoá được bình luận người khác ⇒ 200 + có AUDIT", async () => {
      const res = await del(tManager, `/social/comments/${commentOnPublicId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const audit = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE company_id = $1 AND object_type = 'feed_comment' AND object_id = $2`,
        [A.companyId, commentOnPublicId],
      );
      expect(audit.rows[0].n, "xoá nội dung NGƯỜI KHÁC phải để lại vết").toBeGreaterThan(0);
    });

    it("xoá bài của CHÍNH MÌNH KHÔNG ghi audit (không nhấn chìm sổ dùng chung bằng lưu lượng UI)", async () => {
      const own = await post(tSameUnit, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "Bài tự xoá",
      });
      expect(own.status).toBe(201);
      const id = own.body.data.id as string;
      expect((await del(tSameUnit, `/social/posts/${id}`)).status).toBe(200);

      const audit = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE company_id = $1 AND object_type = 'feed_post' AND object_id = $2`,
        [A.companyId, id],
      );
      expect(audit.rows[0].n).toBe(0);
    });
  });

  // ══════════════ D1t / D2t — IDOR ĐA HÌNH (nợ (b) FULL gate DB-1) ══════════════

  describe("D6 / D1t / D2t — IDOR trên `target_id` đa hình KHÔNG FK", () => {
    it("D1t DENY: reaction trỏ `target_id` của TENANT KHÁC ⇒ 404, KHÔNG có hàng nào được ghi", async () => {
      const res = await put(tOther, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "like",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions WHERE target_id = $1 AND company_id = $2`,
        [publicPostId, B.companyId],
      );
      expect(rows.rows[0].n, "KHÔNG được có hàng reaction nào của tenant B").toBe(0);
    });

    it("D2t DENY: CÙNG tenant nhưng bài `hidden` actor không thấy được ⇒ 404 + 0 hàng", async () => {
      const res = await put(tSameUnit, `/social/posts/${hiddenPostId}/reaction`).send({
        emoji: "like",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions
          WHERE target_type = 'post' AND target_id = $1`,
        [hiddenPostId],
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it("D2t DENY: bài `org_unit` của đơn vị khác ⇒ 404 + 0 hàng", async () => {
      const res = await put(tOtherUnit, `/social/posts/${orgUnitPostId}/reaction`).send({
        emoji: "like",
      });
      expect(res.status).toBe(404);
      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions WHERE target_id = $1`,
        [orgUnitPostId],
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it("ALLOW đối chứng: đích CÙNG tenant và THẤY ĐƯỢC ⇒ 200 + hàng THẬT + likeCount tăng", async () => {
      const res = await put(tSameUnit, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "like",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.likeCount).toBeGreaterThan(0);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions
          WHERE target_type = 'post' AND target_id = $1 AND company_id = $2`,
        [publicPostId, A.companyId],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("DENY: `target_id` là UUID KHÔNG TỒN TẠI ⇒ 404 (không phân biệt với 'không thấy được')", async () => {
      const res = await put(tSameUnit, `/social/posts/${randomUUID()}/reaction`).send({
        emoji: "like",
      });
      expect(res.status).toBe(404);
    });

    it("mention vào bài `hidden` qua đường bình luận cũng bị chặn ở CỬA BÀI ⇒ 404", async () => {
      const res = await post(tSameUnit, `/social/posts/${hiddenPostId}/comments`).send({
        body: "thử lách qua bình luận",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  });

  // ══════════════ R5 — emoji ngoài bộ ══════════════

  /**
   * D21 cho `feed:reaction.changed` (FULL gate PR #530).
   *
   * `emitPostCreated`/`emitCommentCreated` thu hẹp fan-out bằng lưới `audience==='company' &&
   * status==='published'`, VÀ schema WS của chúng khoá cứng `audience: z.literal("company")` nên
   * `.parse()` là một cổng thứ hai. Payload cảm xúc KHÔNG có trường `audience` ⇒ schema không đỡ
   * được gì, lưới trong service là lớp DUY NHẤT.
   *
   * Thiếu lưới đó: mọi socket của CẢ CÔNG TY (room `co:{c}:feed`, gác bằng `view:feed` mà ai cũng có)
   * nhận `{targetType, targetId, postId, likeCount, reactions[]}` của bài `org_unit`/`hidden` — rò SỰ
   * TỒN TẠI của `postId`/`commentId` riêng tư + đường cong tương tác theo thời gian thực, đúng thứ mà
   * REST trả 404 cho chính những người đó.
   */
  describe("D21 — fan-out WS của cảm xúc thu hẹp theo audience/status của bài CHA", () => {
    let emitSpy: MockInstance<RealtimeEmitterService["emitFeedReactionChanged"]>;
    /**
     * Bình luận RIÊNG của block này. KHÔNG dùng `commentOnPublicId`: ca R2 ở trên XOÁ MẮM nó thật
     * (`tManager` có `manage:feed-post`), nên mọi ca chạy SAU sẽ nhận 404 và báo sai chỗ hỏng.
     */
    let ownCommentId = "";

    beforeAll(async () => {
      emitSpy = vi.spyOn(app.get(RealtimeEmitterService), "emitFeedReactionChanged");
      const c = await post(tSameUnit, `/social/posts/${publicPostId}/comments`).send({
        body: "binh luan rieng cho ca D21",
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      ownCommentId = c.body.data.id;
    });

    afterAll(() => {
      emitSpy.mockRestore();
    });

    it("ALLOW đối chứng: bài company+published ⇒ CÓ emit đúng 1 lần", async () => {
      // Neo chống-xanh-rỗng ĐỨNG TRƯỚC các ca deny: nếu emitter không bao giờ được gọi (đổi tên
      // method, bỏ emit, spy gắn sai instance) thì mọi ca "0 emit" dưới đây xanh vì lý do SAI.
      emitSpy.mockClear();
      const res = await put(tOtherUnit, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "love",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it("DENY fan-out: bài `org_unit` ⇒ 200 cho người TRONG đơn vị nhưng 0 emit", async () => {
      emitSpy.mockClear();
      const res = await put(tSameUnit, `/social/posts/${orgUnitPostId}/reaction`).send({
        emoji: "like",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        emitSpy,
        "room co:{c}:feed là CẢ công ty — bài org_unit không được phát vào đó",
      ).not.toHaveBeenCalled();
    });

    it("DENY fan-out: bài `hidden` ⇒ 0 emit (kể cả actor có `manage:feed-post`)", async () => {
      emitSpy.mockClear();
      const res = await put(tManager, `/social/posts/${hiddenPostId}/reaction`).send({
        emoji: "wow",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("DENY fan-out: GỠ cảm xúc trên bài `org_unit` cũng 0 emit (đường gỡ dùng cùng lưới)", async () => {
      emitSpy.mockClear();
      const res = await auth(tSameUnit)(http().delete(`/social/posts/${orgUnitPostId}/reaction`));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("ALLOW đối chứng: cảm xúc trên BÌNH LUẬN của bài company ⇒ CÓ emit", async () => {
      emitSpy.mockClear();
      const res = await put(tSameUnit, `/social/comments/${ownCommentId}/reaction`).send({
        emoji: "haha",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });
  describe("R5 — bộ cảm xúc đóng", () => {
    it("DENY: giá trị ngoài bộ CHAT ⇒ 400/422, KHÔNG ghi hàng", async () => {
      const res = await put(tSameUnit, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "rocket",
      });
      expect([400, 422]).toContain(res.status);
    });

    it("ALLOW đối chứng: giá trị TRONG bộ ⇒ 200 + đổi được emoji (không đẻ hàng thứ hai)", async () => {
      const first = await put(tOtherUnit, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "like",
      });
      expect(first.status).toBe(200);
      const second = await put(tOtherUnit, `/social/posts/${publicPostId}/reaction`).send({
        emoji: "love",
      });
      expect(second.status).toBe(200);

      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM feed_reactions
          WHERE target_type = 'post' AND target_id = $1 AND company_id = $2`,
        [publicPostId, A.companyId],
      );
      // 2 người đã thả (sameUnit + otherUnit) — đổi emoji KHÔNG đẻ hàng thứ ba.
      expect(rows.rows[0].n).toBe(2);
    });
  });
});
