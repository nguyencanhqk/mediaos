/**
 * S10-FND-BODYVALIDATE-1 (KI-068) — biên HTTP THẬT (supertest) cho 3 route GHI của `foundation/files`:
 *
 *   POST /foundation/files/upload        [FilesController#upload]   perm=upload:foundation-file
 *   POST /foundation/files/:id/confirm   [FilesController#confirm]  perm=upload:foundation-file
 *   POST /foundation/files/:id/links     [FilesController#link]     perm=link:foundation-file
 *
 * VÌ SAO FILE NÀY TỒN TẠI. KI-068 kê 4 route "không validate ở biên", nhưng CHỈ `POST /api-keys` từng
 * được đo bằng HTTP; 3 route trên là **SUY TỪ HÌNH DẠNG CODE**. Spec sẵn có của files
 * (`test/foundation/file-security.int-spec.ts` · `integration/files-service.int-spec.ts` ·
 * `files-rls-isolation.int-spec.ts`) gọi THẲNG `FileService` — **không một file nào dùng supertest** ⇒
 * biên HTTP của 3 route này thật sự CHƯA TỪNG chạy trong test. File này biến suy-luận thành SỐ ĐO.
 *
 * App test dựng ĐÚNG như `main.ts` (pipe → envelope → filter). Thiếu một lớp thì mọi kết luận về
 * "400 hay 500" đều vô nghĩa vì nó đo một stack khác với PROD.
 *
 * SỐ ĐO TRƯỚC BẢN VÁ (24/08/2026, chạy trên `LANE_DB=mediaos_bodyvalidate`): **cả 3 route trả 500 +
 * `error.type='ZodError'`** — suy luận của KI-068 được xác nhận bằng HTTP thật, không còn là phỏng đoán.
 *
 * Cơ chế bug (giữ lại vì nó giải thích vì sao file này tồn tại): `@Body() body: UploadFileInput` là
 * **TYPE** (`z.infer`), không phải class `createZodDto` ⇒ metatype lúc chạy là `Object` ⇒
 * `ZodValidationPipe` (kể cả bản `@UsePipes` CẤP CLASS ở `files.controller.ts:48`) KHÔNG có schema để
 * chiếu ⇒ body đi thẳng vào handler ⇒ handler tự `.parse()` ném `ZodError` THÔ ⇒ `AllExceptionsFilter`
 * chỉ hiểu `ZodValidationException` của nestjs-zod ⇒ rơi nhánh **500**.
 *
 * ✅ ĐÃ VÁ trong cùng WO: `UploadFileDto` · `ConfirmUploadDto` · `LinkFileDto` (`files.dto.ts`) —
 * class `createZodDto` THẬT ⇒ pipe chặn ở BIÊN. Ba ca dưới đây đã LẬT sang `expect(400)`.
 *
 * ⚠️ NGƯỠNG CHỐNG NỚI: assert phải ở lại `400` đơn trị. Sửa thành `expect([400, 500]).toContain(...)`
 * là mở lại lỗ KI-068 trong khi sổ vẫn ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: mỗi route có ca ALLOW đi kèm chứng minh đường xanh vẫn đi qua được lớp
 * validate — ca "sai body → lỗi" mà không có ca "đúng body → qua" là xanh RỖNG
 * ([[deny-cases-vacuous-without-allow-case]]).
 *
 * HAI CA ALLOW LÀ **CHỐNG HỒI QUY CHO CHÍNH BẢN VÁ**, không phải trang trí — xem plan §5/§6:
 *   - `confirm` với **body RỖNG** là HỢP LỆ (docblock `files.controller.ts:66`, `fileId` lấy từ route).
 *     DTO class không được biến body rỗng thành 400.
 *   - `link` **KHÔNG cần** `fileId` trong body (handler ép từ `:id`). DTO class validate body thô sẽ
 *     đòi `fileId` ⇒ 400 cho request vốn hợp lệ. Đây là điểm nguy hiểm nhất của bản vá.
 * Hai ca này phải XANH TRƯỚC và SAU khi vá. Oracle của chúng là `expectPassedBoundary()` — xem docblock
 * của hàm đó: khẳng định "body ĐI QUA ĐƯỢC BIÊN", KHÔNG phải "request thành công".
 *
 * ACTOR KHÔNG PHẢI SUPER-ADMIN ([[superadmin-not-a-canonical-role]]) — actor company-scope thường,
 * grant đúng cặp. KHÔNG seed `*:*`: `permissions` là catalog TOÀN CỤC, `cleanupTenants` KHÔNG dọn ⇒
 * thêm wildcard là đóng dấu VĨNH VIỄN lên lane DB dùng chung ([[test-fixture-stamps-global-permission-catalog]]).
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
const LOGIN_PW = loginPasswordFixture("s10fndbv1");

/** Cặp quyền dùng trong file này + cờ is_sensitive THẬT của catalog (đo trên lane DB, không đoán). */
const PAIRS = {
  upload: { action: "upload", resource: "foundation-file", sensitive: false },
  link: { action: "link", resource: "foundation-file", sensitive: false },
} as const;

interface PermissionPair {
  action: string;
  resource: string;
  sensitive: boolean;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-BODYVALIDATE-1 — biên HTTP của foundation/files (upload · confirm · links)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let tUploader = "";

    const http = () => request(app.getHttpServer());
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<PermissionPair>,
    ): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10fndbv1.local`;
      const userId = await seedUser(direct, tenant.companyId, email, hash);
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s10fndbv1-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return login(tenant.slug, email);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10fndbv1a");
      companyIds.push(A.companyId);

      tUploader = await actor(A, "uploader", [PAIRS.upload, PAIRS.link]);
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    /**
     * ORACLE của ca ALLOW — "body ĐI QUA ĐƯỢC BIÊN", KHÔNG phải "request thành công".
     *
     * `not.toBe(400)` là oracle SAI và lần đo đầu đã chứng minh: `link` với `fileId` không tồn tại trả
     * **400 từ SERVICE** (`FOUNDATION-FILE-ERR-LINK`) ⇒ ca đỏ vì lý do chẳng liên quan gì tới validate.
     * Phải phân biệt hai loại 400:
     *   - 400 của BIÊN (validate body) — cái WO này đang đổi ⇒ ca ALLOW phải ĐỎ nếu nó xuất hiện;
     *   - 400 của SERVICE (nghiệp vụ: file không tồn tại/không cùng tenant) — hợp lệ, chứng minh body
     *     đã ĐI QUA biên và tới được service. Đó chính là điều ca ALLOW cần khẳng định.
     *
     * Neo theo mã lỗi nghiệp vụ `FOUNDATION-FILE-ERR-*`, không neo theo status ([[index-ratchet-must-pin-definition-not-name]]).
     * Sau khi vá, nếu DTO class chặn nhầm request hợp lệ thì 400 đó mang mã VALIDATE ⇒ ca này ĐỎ đúng chỗ.
     */
    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      // ZodError THÔ không bao giờ được là hình dạng lỗi của một body hợp lệ.
      expect(res.body.error?.type, body).not.toBe("ZodError");
      if (res.status === 400) {
        expect(String(res.body.error?.code ?? ""), body).toMatch(/^FOUNDATION-FILE-ERR/);
      }
    }

    // ── 1. POST /foundation/files/upload ──────────────────────────────────
    /**
     * 🔴 GHIM BUG (KI-068) — `sizeBytes` ÂM vi phạm `.int().nonnegative()`.
     * Vá xong ⇒ ĐỎ ⇒ LẬT sang `expect(400)`. KHÔNG nới assert.
     */
    it("KI-068 ĐÃ ĐÓNG: POST files/upload sizeBytes ÂM → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tUploader, "/foundation/files/upload").send({
        originalName: "bao-cao.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: -1,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // `ZodError` THÔ là hiện vật của đường 500 cũ — nó quay lại nghĩa là bản vá đã tuột.
      expect(res.body.error?.type, JSON.stringify(res.body)).not.toBe("ZodError");
    });

    it("ALLOW đối chứng: POST files/upload body ĐÚNG hợp đồng ĐI QUA được biên", async () => {
      const res = await authPost(tUploader, "/foundation/files/upload").send({
        originalName: "bao-cao.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: 1024,
      });
      // Đo LỚP VALIDATE, không đo lớp storage.
      expectPassedBoundary(res);
    });

    // ── 2. POST /foundation/files/:id/confirm ─────────────────────────────
    /**
     * 🔴 GHIM BUG (KI-068) — `checksumSha256` sai regex `^[a-f0-9]{64}$`.
     * `.parse()` chạy TRƯỚC mọi lượt chạm DB ⇒ file có tồn tại hay không KHÔNG ảnh hưởng kết quả đo.
     */
    it("KI-068 ĐÃ ĐÓNG: POST files/:id/confirm checksum RÁC → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tUploader, `/foundation/files/${randomUUID()}/confirm`).send({
        checksumSha256: "khong-phai-sha256",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // `ZodError` THÔ là hiện vật của đường 500 cũ — nó quay lại nghĩa là bản vá đã tuột.
      expect(res.body.error?.type, JSON.stringify(res.body)).not.toBe("ZodError");
    });

    /**
     * ALLOW — CHỐNG HỒI QUY CHO BẢN VÁ (plan §5). Body RỖNG là HỢP LỆ theo docblock
     * `files.controller.ts:66` (`fileId` lấy từ route). DTO class không được biến nó thành 400.
     */
    it("ALLOW đối chứng: POST files/:id/confirm body RỖNG ĐI QUA được biên", async () => {
      const res = await authPost(tUploader, `/foundation/files/${randomUUID()}/confirm`).send({});
      expectPassedBoundary(res);
    });

    /**
     * PARAM — cùng lớp với ca `links` bên dưới. `confirm` cũng nhận `@Param("id") id: string` trần và
     * chuyển thẳng xuống service; `:id` rác đi tới tận DB (cột `uuid`) rồi nổ `22P02` ⇒ 500.
     * Cùng khuôn vá: `@Param("id", ParseUUIDPipe)`.
     */
    it("PARAM: POST files/:id/confirm với :id KHÔNG phải UUID → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tUploader, "/foundation/files/khong-phai-uuid/confirm").send({});
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    // ── 3. POST /foundation/files/:id/links ───────────────────────────────
    /**
     * 🔴 GHIM BUG (KI-068) — `linkType` ngoài enum.
     * `fileId` CỐ Ý không gửi trong body: handler ép từ `:id` (`files.controller.ts:126`).
     */
    it("KI-068 ĐÃ ĐÓNG: POST files/:id/links linkType NGOÀI enum → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tUploader, `/foundation/files/${randomUUID()}/links`).send({
        moduleCode: "FOUNDATION",
        entityType: "Employee",
        entityId: randomUUID(),
        linkType: "KhongPhaiLinkType",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      // `ZodError` THÔ là hiện vật của đường 500 cũ — nó quay lại nghĩa là bản vá đã tuột.
      expect(res.body.error?.type, JSON.stringify(res.body)).not.toBe("ZodError");
    });

    /**
     * ALLOW — CHỐNG HỒI QUY CHO BẢN VÁ (plan §6). Client hợp lệ KHÔNG gửi `fileId` trong body.
     * Nếu DTO class validate body THÔ, ca này ăn 400 ⇒ bản vá vừa phá hợp đồng client. Đây là ca
     * canh chừng đắt nhất của WO — đừng xoá, đừng nới.
     */
    /**
     * LỖ CÙNG HÌNH DẠNG CÒN SÓT NGAY DƯỚI BẢN VÁ — phát hiện khi tự đọc lại diff, không phải từ KI-068.
     *
     * `link()` giữ lại `linkFileInputSchema.parse({ ...body, fileId: id })` để chốt bất biến
     * "fileId = `:id` của route". Nhưng `@Param("id") id: string` KHÔNG có `ParseUUIDPipe` ⇒ `:id` không
     * phải UUID sẽ làm CHÍNH `.parse()` đó ném `ZodError` THÔ ⇒ **500** — đúng cơ chế KI-068, chỉ đổi
     * kênh đầu vào từ body sang param. Đóng KI-068 mà để nguyên dòng này là tuyên bố đóng một lỗ trong
     * khi bản sao của nó nằm cách đó một dòng.
     *
     * Khuôn đúng đã có sẵn CÙNG CÂY: `api-keys.controller.ts:71` dùng `@Param("id", ParseUUIDPipe)`.
     * `foundation/files` lại là chỗ bỏ sót — cùng một module, cùng một kiểu bỏ sót như `*.dto.ts`.
     */
    it("PARAM: POST files/:id/links với :id KHÔNG phải UUID → 400 ở BIÊN, KHÔNG phải 500", async () => {
      const res = await authPost(tUploader, "/foundation/files/khong-phai-uuid/links").send({
        moduleCode: "FOUNDATION",
        entityType: "Employee",
        entityId: randomUUID(),
        linkType: "Attachment",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.type, JSON.stringify(res.body)).not.toBe("ZodError");
    });

    it("ALLOW đối chứng: POST files/:id/links KHÔNG có fileId trong body vẫn ĐI QUA được biên", async () => {
      const res = await authPost(tUploader, `/foundation/files/${randomUUID()}/links`).send({
        moduleCode: "FOUNDATION",
        entityType: "Employee",
        entityId: randomUUID(),
        linkType: "Attachment",
      });
      expectPassedBoundary(res);
    });
  },
);
