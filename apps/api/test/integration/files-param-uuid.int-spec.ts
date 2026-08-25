/**
 * S10-FND-PARAMUUID-1 (KI-077) — biên HTTP THẬT cho kênh **PARAM** của `foundation/files`.
 *
 *   GET    /foundation/files/:id                    [FilesController#getOne]      perm=view:foundation-file
 *   GET    /foundation/files/:id/download-url       [FilesController#downloadUrl] perm=download:foundation-file
 *   GET    /foundation/files/:id/download           [FilesController#download]    perm=download:foundation-file
 *   DELETE /foundation/files/:id/links/:linkId      [FilesController#unlink]      perm=unlink:foundation-file
 *   DELETE /foundation/files/:id                    [FilesController#remove]      perm=delete:foundation-file
 *
 * ─── VÌ SAO FILE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────
 * `S10-FND-BODYVALIDATE-1` đóng KI-068 ở kênh **BODY**, và trong lúc đọc lại diff phát hiện bản sao
 * CÙNG CƠ CHẾ nằm cách bản vá **một dòng**: `@Param("id")` không có `ParseUUIDPipe`. Hai route GHI đã
 * được đo + vá ngay tại WO đó. NĂM tham số READ/DELETE trên đây thì **chưa từng có một lượt HTTP nào
 * chạm tới** — chúng là SUY LUẬN từ hình dạng code, và WO này cấp số (KI-077) thay vì vá mù.
 *
 * Ba spec files sẵn có (`test/foundation/file-security.int-spec.ts` ·
 * `integration/files-service.int-spec.ts` · `files-rls-isolation.int-spec.ts`) gọi THẲNG
 * `FileService` ⇒ không file nào đi qua pipe/filter, nên không file nào trả lời được câu
 * "400 hay 500".
 *
 * ─── SỐ ĐO TRƯỚC BẢN VÁ ─────────────────────────────────────────────────────────────────────────
 * Xem ô "ĐO 25/08/2026" ở từng ca. Ghi SỐ THẬT, kể cả khi nó KHÁC mô tả KI-077 — `done_when` của WO
 * nói rõ: route nào hoá ra không trả 500 thì ghi lại sự thật đó, đừng ép số cho khớp mô tả.
 *
 * ─── MỨC ĐỘ (phát biểu trước, không để reviewer phải đoán) ──────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: request vẫn bị từ chối, không hàng nào rò, không quyền nào bị vượt.
 * ⇒ **KHÔNG phải lỗ bảo mật.** Giá trị của bản vá là (a) hợp đồng API — client nhận 400 có mã thay
 * vì 500 vô nghĩa; (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu
 * 500 THẬT. Y hệt KI-068.
 *
 * ⚠️ Guard chạy TRƯỚC pipe ⇒ probe không kèm token chỉ ra 401 và không đo được gì. Mọi ca dưới đây
 * dùng actor ĐÃ đăng nhập với ĐÚNG cặp quyền.
 *
 * ⚠️ ACTOR KHÔNG PHẢI super-admin ([[superadmin-not-a-canonical-role]]). KHÔNG seed `*:*`:
 * `permissions` là catalog TOÀN CỤC và `cleanupTenants` không dọn nó
 * ([[test-fixture-stamps-global-permission-catalog]]).
 *
 * ⚠️ NGƯỠNG CHỐNG NỚI: assert ở lại `400` đơn trị. `expect([400, 500]).toContain(...)` là mở lại lỗ
 * trong khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s10fndpu1");

/** Cặp quyền dùng trong file này. `is_sensitive` lấy đúng catalog thật, không đoán. */
const PAIRS = {
  view: { action: "view", resource: "foundation-file", sensitive: false },
  download: { action: "download", resource: "foundation-file", sensitive: false },
  unlink: { action: "unlink", resource: "foundation-file", sensitive: false },
  delete: { action: "delete", resource: "foundation-file", sensitive: false },
} as const;

interface PermissionPair {
  action: string;
  resource: string;
  sensitive: boolean;
}

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-1 — biên HTTP kênh PARAM của foundation/files (5 route READ/DELETE)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";

    const http = () => request(app.getHttpServer());
    const authGet = (u: string) => http().get(u).set("Authorization", `Bearer ${token}`);
    const authDelete = (u: string) => http().delete(u).set("Authorization", `Bearer ${token}`);

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<PermissionPair>,
    ): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10fndpu1.local`;
      const userId = await seedUser(direct, tenant.companyId, email, hash);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10fndpu1-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận về
      // "400 hay 500" đều vô nghĩa vì nó đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10fndpu1a");
      companyIds.push(A.companyId);
      token = await actor(A, "filer", [PAIRS.view, PAIRS.download, PAIRS.unlink, PAIRS.delete]);
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    /**
     * Oracle DENY dùng chung: tham số rác phải bị chặn ở BIÊN bằng 400, và KHÔNG được mang hiện vật
     * của đường 500 cũ.
     *
     * ⚠️ `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô) đều là dấu của đường 500. Neo theo hiện vật chứ không chỉ theo status: một
     * ngày nào đó ai đó map 22P02 thành 400 ở filter thì status xanh mà lỗ vẫn còn nguyên vị trí —
     * request rác vẫn đi hết đường tới DB.
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    /**
     * Oracle ALLOW dùng chung: UUID HỢP LỆ (nhưng không tồn tại) phải ĐI QUA được biên và tới service
     * ⇒ 404/403 là ĐÚNG, 400 thì KHÔNG.
     *
     * Không có vế này thì mọi ca deny ở trên xanh RỖNG: một bản vá chặn MỌI giá trị `:id` cũng làm
     * chúng xanh ([[deny-cases-vacuous-without-allow-case]]).
     */
    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
    }

    // ── 1. GET /foundation/files/:id ──────────────────────────────────────
    it("PARAM · GET files/:id với :id rác → 400 ở BIÊN", async () => {
      // ĐO 25/08/2026 (trước vá): xem PR — số thật ghi ở RELEASE-02 KI-077.
      expectRejectedAtBoundary(await authGet(`/foundation/files/${JUNK}`));
    });

    it("ALLOW · GET files/:id với UUID hợp lệ (không tồn tại) ĐI QUA được biên", async () => {
      expectPassedBoundary(await authGet(`/foundation/files/${randomUUID()}`));
    });

    // ── 2. GET /foundation/files/:id/download-url ─────────────────────────
    it("PARAM · GET files/:id/download-url với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await authGet(`/foundation/files/${JUNK}/download-url`));
    });

    it("ALLOW · GET files/:id/download-url với UUID hợp lệ ĐI QUA được biên", async () => {
      expectPassedBoundary(await authGet(`/foundation/files/${randomUUID()}/download-url`));
    });

    // ── 3. GET /foundation/files/:id/download ─────────────────────────────
    /**
     * ⚠️ Route này dùng `@Res()` LIBRARY-MODE ⇒ **KHÔNG qua `ResponseEnvelopeInterceptor`**. Đường
     * THÀNH CÔNG trả 302 thô. Đường LỖI vẫn qua `AllExceptionsFilter` (filter bắt exception trước khi
     * handler chạm `res`), nên envelope lỗi vẫn có — nhưng đừng giả định điều đó cho ca ALLOW.
     */
    it("PARAM · GET files/:id/download với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await authGet(`/foundation/files/${JUNK}/download`));
    });

    it("ALLOW · GET files/:id/download với UUID hợp lệ ĐI QUA được biên", async () => {
      expectPassedBoundary(await authGet(`/foundation/files/${randomUUID()}/download`));
    });

    // ── 4. DELETE /foundation/files/:id/links/:linkId ─────────────────────
    /**
     * ⚠️ ALIAS: tham số tên `:linkId`, KHÔNG phải `:id` — grep theo `@Param("id")` sẽ TRƯỢT nó
     * ([[identity-projection-census-misses-alias]]). Đây chính là lý do WO kê nó riêng.
     *
     * ⚠️ VÀ MỘT ĐIỀU KHÁC: handler CHỈ đọc `:linkId`, KHÔNG đọc `:id`. Docblock của route nói
     * ":id (file) khoanh phạm vi" — điều đó KHÔNG đúng: `files.service.ts` `unlink(user, linkId)`
     * không nhận `:id` bao giờ. Cô lập tenant vẫn giữ (`findByIdTx(user.companyId, linkId, tx)`),
     * nên KHÔNG phải lỗ — nhưng comment sai theo hướng làm người đọc yên tâm hơn thực tế.
     * Hai ca dưới ghim đúng sự thật đó: `:id` rác KHÔNG bị chặn (không ai đọc nó), `:linkId` rác thì có.
     */
    it("PARAM · DELETE files/:id/links/:linkId với :linkId rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await authDelete(`/foundation/files/${randomUUID()}/links/${JUNK}`));
    });

    it("SỰ THẬT VỀ :id của route unlink — handler KHÔNG đọc nó, nên :id rác KHÔNG bị chặn", async () => {
      // Ghim hiện trạng CÓ CHỦ Ý, không phải bỏ sót: thêm `ParseUUIDPipe` cho một tham số mà không
      // handler nào đọc là dựng một lớp validate cho dữ liệu không tồn tại. Nếu sau này `:id` được
      // dùng thật (để khoanh phạm vi như docblock hứa) thì ca này ĐỎ và buộc người sửa đọc lại đây.
      const res = await authDelete(`/foundation/files/${JUNK}/links/${randomUUID()}`);
      expect(res.status, JSON.stringify(res.body)).not.toBe(400);
    });

    it("ALLOW · DELETE files/:id/links/:linkId với UUID hợp lệ ĐI QUA được biên", async () => {
      expectPassedBoundary(
        await authDelete(`/foundation/files/${randomUUID()}/links/${randomUUID()}`),
      );
    });

    // ── 5. DELETE /foundation/files/:id ───────────────────────────────────
    it("PARAM · DELETE files/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await authDelete(`/foundation/files/${JUNK}`));
    });

    it("ALLOW · DELETE files/:id với UUID hợp lệ ĐI QUA được biên", async () => {
      expectPassedBoundary(await authDelete(`/foundation/files/${randomUUID()}`));
    });
  },
);
