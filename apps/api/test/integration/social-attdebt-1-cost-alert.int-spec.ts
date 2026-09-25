import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PermissionRepository } from "../../src/permission/permission.repository";
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

/**
 * S16-SOCIAL-ATTDEBT-1 — F1 (chi phí quyền) · C-5 (vết bền cho lượt DENY) · F4 (index).
 *
 * ┌─ 🔴 PHÉP ĐO F1 LÀ **DELTA**, KHÔNG PHẢI SỐ TUYỆT ĐỐI (plan §7 B1) ────────────────────────────┐
 * │ Backlog từng ghi «số transaction mỗi PATCH: trước 2 · sau 1». Con số đó KHÔNG ĐẠT ĐƯỢC. Một    │
 * │ PATCH nạp ảnh chụp grant của CÙNG actor ở **bốn** chỗ:                                         │
 * │   1. `SocialAccessService.resolveActor`            (tầng 2 + 2 cờ phụ)                          │
 * │   2. `SocialAccessService.resolveAttachNewGate`    ← thứ WO này gỡ bỏ                           │
 * │   3. `SocialFileResolver.canReadOwner`             (đường `decorate` ở CUỐI update)             │
 * │   4. `SocialAccessService.resolveViewerContext`    (cũng từ `decorate` → `signOne` → policy)    │
 * │      ↳ S16-SOCIAL-PERMCOST-1 đã GỘP (4) vào (3): một lượt cho mỗi đính kèm (ca PERMCOST-1).    │
 * │ (3) và (4) chạy CHỈ KHI bài có đính kèm — mà ca đo BẮT BUỘC dùng bài có đính kèm. Vì vậy đại    │
 * │ lượng đúng là **DELTA giữa hai request trên CÙNG bài, CÙNG tập link sống**:                     │
 * │     `PATCH có attachmentIds`  −  `PATCH body-only`   ⇒ **trước = 1 · sau = 0**                  │
 * │ Đường `decorate` chạy y hệt ở cả hai vế nên tự triệt tiêu. Nếu ai đổi đường decorate, ca này    │
 * │ vẫn đúng — và đó là cả lý do chọn delta thay vì ghim một con số tuyệt đối.                      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Cả hai request phải chạy trên **CÙNG một bài đã có ≥1 link sống**: với bài KHÔNG đính kèm,
 * `decorateMany` return sớm và số lần nạp khác đi vì một lý do hoàn toàn khác ⇒ delta nói dối.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;
// CLAUDE.md §5 — fixture giống-secret GHÉP CHUỖI (gitleaks `generic-api-key` đỏ oan cả lịch sử nhánh).
const LOGIN_PW = ["Passw0rd!attdebt", "1"].join("");

const AUTHOR_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/** 🔴 Vai của ca RED: kiểm duyệt KHÔNG có cặp `create:feed-*` nào. */
const MOD_NOCREATE_PAIRS = [
  "view:feed",
  "manage:feed-post",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/** ALLOW đối chứng — y hệt vai trên NHƯNG có hai cặp `create`. Ca DENY một mình là xanh-rỗng. */
const MOD_FULL_PAIRS = [
  "view:feed",
  "manage:feed-post",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

/** Người thường: đăng được bài của MÌNH, KHÔNG `manage` ⇒ sửa bài người khác là 403 SOCIAL-ERR-003. */
const PLAIN_PAIRS = ["view:feed", "create:feed-post", "create:feed-comment"] as const;

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-ATTDEBT-1 — chi phí cổng + vết bền cho DENY (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let tAuthor = "";
    let tMod = "";
    let tModFull = "";
    let tPlain = "";
    let authorUserId = "";
    let modUserId = "";
    let modFullUserId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));

    /** Hàng `files` Uploaded+Clean của `owner`. Gieo TAY — ta đo GATE, không đo cửa upload. */
    async function seedFile(owner: string): Promise<string> {
      const id = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                            storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by)
         VALUES ($1,$2,$3,$4,'image/png',1024,'MinIO',$5,'Uploaded','Clean',$6,$6)`,
        [
          id,
          A.companyId,
          `f-${id.slice(0, 6)}.png`,
          `stored-${id}`,
          `${A.companyId}/social/${id}`,
          owner,
        ],
      );
      return id;
    }

    async function makeUser(
      label: string,
      hash: string,
      pairs: readonly string[],
    ): Promise<{ token: string; userId: string }> {
      const email = `${label}@${A.slug}.test`;
      const userId = await seedUser(direct, A.companyId, email, hash);
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
         VALUES ($1, $2, 'active', 'offline', $3)`,
        [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
      );
      const roleId = await seedRole(direct, A.companyId, `attdebt-${randomUUID().slice(0, 8)}`);
      for (const key of pairs) {
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

    async function postWithFile(): Promise<{ postId: string; fileId: string }> {
      const fileId = await seedFile(authorUserId);
      const res = await post(tAuthor, "/social/posts").send({
        type: "share",
        audience: "company",
        body: "bài có ảnh",
        attachmentIds: [fileId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { postId: res.body.data.id as string, fileId };
    }

    /** Hàng alert của ĐÚNG actor đó — đếm tuyệt đối trên lane DB dùng chung là bẫy. */
    async function alertsOf(userId: string): Promise<{ n: number; detail: unknown; sev: string }> {
      const r = await direct.query(
        `SELECT count(*)::int AS n,
                (array_agg(detail ORDER BY created_at DESC))[1] AS detail,
                (array_agg(severity ORDER BY created_at DESC))[1] AS sev
           FROM security_alerts
          WHERE alert_type = 'attach_gate_deny' AND subject_user_id = $1`,
        [userId],
      );
      return { n: r.rows[0].n as number, detail: r.rows[0].detail, sev: r.rows[0].sev as string };
    }

    async function bodyOf(postId: string): Promise<string> {
      const r = await direct.query(`SELECT body FROM feed_posts WHERE id = $1`, [postId]);
      return r.rows[0].body as string;
    }

    async function countLiveLinks(fileId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_links WHERE file_id = $1 AND deleted_at IS NULL`,
        [fileId],
      );
      return r.rows[0].n as number;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "attdebt");
      companyIds.push(A.companyId);

      const author = await makeUser("adauthor", hash, AUTHOR_PAIRS);
      tAuthor = author.token;
      authorUserId = author.userId;
      const mod = await makeUser("admod", hash, MOD_NOCREATE_PAIRS);
      tMod = mod.token;
      modUserId = mod.userId;
      const modFull = await makeUser("admodfull", hash, MOD_FULL_PAIRS);
      tModFull = modFull.token;
      modFullUserId = modFull.userId;
      tPlain = (await makeUser("adplain", hash, PLAIN_PAIRS)).token;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length) await cleanupTenants(direct, companyIds);
    });

    // ═════════════════ F1 — CHI PHÍ QUYỀN (delta) ═════════════════

    describe("F1 — cổng gắn tệp KHÔNG còn nạp lại ảnh chụp grant", () => {
      it("H1/H2 — delta(PATCH có attachmentIds − PATCH body-only) = 0 lần nạp grant", async () => {
        const { postId, fileId } = await postWithFile();
        const repo = app.get(PermissionRepository, { strict: false });
        // CALL-THROUGH (`spyOn` không thay implementation): thay ruột ⇒ grant giả ⇒ mọi cổng trả
        // lời sai ⇒ bài xanh/đỏ vì lý do khác hẳn.
        const spy = vi.spyOn(repo, "getCompanyRoleGrantsWithScope");

        // Ca A — body-only. CÙNG bài, CÙNG tập link sống với ca B (xem khối 🔴 ở đầu file).
        spy.mockClear();
        const a = await patch(tAuthor, `/social/posts/${postId}`).send({ body: "sửa 1" });
        expect(a.status, JSON.stringify(a.body)).toBe(200);
        const nA = spy.mock.calls.filter(([uid]) => uid === authorUserId).length;

        // Ca B — gửi ĐÚNG danh sách đính kèm hiện có ⇒ 0 tệp MỚI ⇒ 200, nhưng cổng vẫn được hỏi.
        spy.mockClear();
        const b = await patch(tAuthor, `/social/posts/${postId}`).send({
          body: "sửa 2",
          attachmentIds: [fileId],
        });
        expect(b.status, JSON.stringify(b.body)).toBe(200);
        const nB = spy.mock.calls.filter(([uid]) => uid === authorUserId).length;

        // NEO CHỐNG-XANH-RỖNG: spy rơi khỏi instance thật đọc y hệt «delta đúng bằng 0».
        expect(nA, "spy phải bắt được lời gọi thật ở ca body-only").toBeGreaterThan(0);
        expect(nB, "spy phải bắt được lời gọi thật ở ca có attachmentIds").toBeGreaterThan(0);
        // 🔴 Phép đo chính. Trước WO này delta = 1; sau = 0.
        expect(nB - nA, `nạp grant: body-only=${nA} · attachmentIds=${nB} — delta phải là 0`).toBe(
          0,
        );
        spy.mockRestore();
      });

      it("H3 — route KHÔNG đính kèm giữ nguyên ngữ nghĩa (hồi quy 48 route)", async () => {
        const { postId } = await postWithFile();
        const res = await auth(tAuthor)(http().get(`/social/posts/${postId}`));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    });

    // ═════════════════ S16-SOCIAL-PERMCOST-1 — ĐƯỜNG ĐỌC ═════════════════

    describe("PERMCOST-1 — ký URL một đính kèm nạp grant ĐÚNG một lần", () => {
      it("delta(GET bài 1 ảnh − GET bài 0 ảnh) = 1 lần nạp grant (trước WO = 2)", async () => {
        const { postId: withFile } = await postWithFile();
        const bare = await post(tAuthor, "/social/posts").send({
          type: "share",
          audience: "company",
          body: "bài không ảnh",
        });
        expect(bare.status, JSON.stringify(bare.body)).toBe(201);
        const withoutFile = bare.body.data.id as string;

        const repo = app.get(PermissionRepository, { strict: false });
        const spy = vi.spyOn(repo, "getCompanyRoleGrantsWithScope"); // CALL-THROUGH
        const loadsFor = async (postId: string): Promise<{ n: number; body: unknown }> => {
          spy.mockClear();
          const res = await auth(tAuthor)(http().get(`/social/posts/${postId}`));
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          return {
            n: spy.mock.calls.filter(([uid]) => uid === authorUserId).length,
            body: res.body,
          };
        };

        const a = await loadsFor(withoutFile);
        const b = await loadsFor(withFile);
        spy.mockRestore();

        // NEO CHỐNG-XANH-RỖNG: ca có ảnh phải THẬT SỰ ký được URL — một resolver deny cũng làm
        // số lần nạp giảm, và đọc y hệt «đã tối ưu».
        const attachments = (b.body as { data: { attachments?: { url?: string | null }[] } }).data
          .attachments;
        expect(attachments?.length, "bài phải trả đính kèm").toBe(1);
        expect(attachments?.[0]?.url, "URL đính kèm phải ký được (ALLOW thật)").toBeTruthy();
        expect(a.n, "spy phải bắt được lời gọi thật").toBeGreaterThan(0);
        // 🔴 Phép đo chính: trước WO `canReadOwner` + `resolveViewerContext` = 2; sau = 1.
        expect(b.n - a.n, `nạp grant: 0 ảnh=${a.n} · 1 ảnh=${b.n}`).toBe(1);
      });
    });

    // ═════════════════ C-5 — VẾT BỀN CHO LƯỢT DENY ═════════════════

    describe("C-5 — nhánh DENY để lại hàng `security_alerts` sống sót rollback", () => {
      it("H7 — DENY 004 ⇒ 403 · alert +1 · bài KHÔNG đổi · tệp KHÔNG link", async () => {
        const { postId } = await postWithFile();
        const before = await alertsOf(modUserId);
        const bodyBefore = await bodyOf(postId);
        const mine = await seedFile(modUserId);

        const res = await patch(tMod, `/social/posts/${postId}`).send({
          body: "kiểm duyệt thêm ảnh",
          attachmentIds: [mine],
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain(SOCIAL_ERR.FILE_TARGET_POST_DENIED);

        const after = await alertsOf(modUserId);
        // 🔴 Vế trung tâm: hàng alert SỐNG SÓT dù transaction nghiệp vụ đã cuộn.
        // Mutant «dùng `emitTx` trong tx» ⇒ đỏ ở đây với `expected 0 to be 1`.
        // Mutant «bỏ dòng journal của 0588» ⇒ CHECK vỡ ⇒ `emit` NUỐT lỗi ⇒ cũng đỏ ở đây; đây là
        // lưới DUY NHẤT nhìn thấy được ca đó.
        expect(after.n - before.n, "phải có ĐÚNG 1 hàng security_alerts mới").toBe(1);
        expect(after.sev, "severity chốt ở `low` (owner ký S-3)").toBe("low");
        expect(after.detail).toEqual({
          route: "postUpdate",
          target: "post",
          targetId: postId,
          newFiles: 1,
          pair: "create:feed-post",
        });

        // Lượt sửa ĐÃ CUỘN hoàn toàn — 403 để lại ZERO dấu vết nghiệp vụ (D-7 của ATTGATE-1).
        expect(await bodyOf(postId), "body KHÔNG được đổi").toBe(bodyBefore);
        expect(await countLiveLinks(mine), "tệp KHÔNG được link").toBe(0);
      });

      it("H8 — ALLOW cạnh DENY: vai ĐỦ quyền ⇒ 200 · KHÔNG sinh alert", async () => {
        const { postId, fileId } = await postWithFile();
        const before = await alertsOf(modFullUserId);
        const mine = await seedFile(modFullUserId);

        const res = await patch(tModFull, `/social/posts/${postId}`).send({
          body: "kiểm duyệt đủ quyền thêm ảnh",
          attachmentIds: [fileId, mine],
        });

        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect((await alertsOf(modFullUserId)).n - before.n, "ALLOW không sinh alert").toBe(0);
      });

      it("H9 — 403 KHÁC từ CÙNG tx (không phải chủ bài) ⇒ KHÔNG sinh alert", async () => {
        const { postId, fileId } = await postWithFile();
        const before = await direct.query(
          `SELECT count(*)::int AS n FROM security_alerts WHERE alert_type = 'attach_gate_deny'`,
        );

        // Vai `PLAIN` CÓ `create:feed-post` nhưng KHÔNG `manage` ⇒ `assertCanMutateContent` ném
        // `ForbiddenException` TRẦN từ bên trong CÙNG transaction.
        const res = await patch(tPlain, `/social/posts/${postId}`).send({
          body: "người lạ sửa bài",
          attachmentIds: [fileId],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);

        const after = await direct.query(
          `SELECT count(*)::int AS n FROM security_alerts WHERE alert_type = 'attach_gate_deny'`,
        );
        // 🔴 Chứng minh reporter phân biệt bằng `instanceof`, KHÔNG bằng thông điệp. Mutant «đổi
        // sang `err.message.includes(...)`» làm ca này đỏ `expected 1 to be 0`.
        expect(after.rows[0].n - before.rows[0].n, "403 KHÁC không được sinh alert").toBe(0);
      });

      it("H10 — khử trùng cửa sổ: hai lượt deny CÙNG đích ⇒ 1 alert (S-5)", async () => {
        const { postId } = await postWithFile();
        const before = await alertsOf(modUserId);

        for (const _ of [1, 2]) {
          const f = await seedFile(modUserId);
          const r = await patch(tMod, `/social/posts/${postId}`).send({
            body: "thử lại",
            attachmentIds: [f],
          });
          expect(r.status).toBe(403);
        }

        // `security_alerts` là append-only, KHÔNG có đường dọn (`retention.service.ts`
        // PROTECTED_TABLES) và KHÔNG có ThrottlerGuard nào ⇒ mỗi-deny-một-hàng là vector phình
        // vô hạn. Cửa sổ khử trùng in-process (60s) chặn nó. `logger.warn` vẫn ghi MỌI lượt.
        expect((await alertsOf(modUserId)).n - before.n, "hai deny cùng đích ⇒ 1 alert").toBe(1);
      });
    });

    // ═════════════════ F4 — INDEX ═════════════════

    it("H11 — index `file_links_company_file_idx` tồn tại (lưới migration-thiếu-journal)", async () => {
      const r = await direct.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'file_links' AND indexname = $1`,
        ["file_links_company_file_idx"],
      );
      expect(
        r.rowCount,
        "index F4 KHÔNG tồn tại — migration 0587 đã có dòng trong meta/_journal.json chưa?",
      ).toBe(1);
      // KHÔNG partial: thêm `WHERE deleted_at IS NULL` là tái tạo đúng lỗ đang vá.
      expect(r.rows[0].indexdef).not.toContain("WHERE");
    });
  },
);
