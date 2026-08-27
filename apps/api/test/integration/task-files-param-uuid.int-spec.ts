/**
 * S10-FND-PARAMUUID-5 · lane **L3-TASKFILE** (KI-078 đợt 4) — biên HTTP THẬT cho kênh **PARAM** của
 * TỆP ĐÍNH KÈM CÔNG VIỆC. **11 tham số / 1 controller** (`tasks/task-files.controller.ts`).
 *
 *   GET    /tasks/:taskId/files                    [list]        read:task
 *   GET    /tasks/:taskId/files/:fileId            [getOne]      read:task
 *   GET    /tasks/:taskId/files/:fileId/download   [download]    read:task        (302 → signed URL)
 *   POST   /tasks/:taskId/files                    [linkFile]    file-upload:task (201)
 *   POST   /tasks/:taskId/files/:fileId/cover      [setCover]    file-upload:task (201)
 *   DELETE /tasks/:taskId/files/cover              [clearCover]  file-upload:task (204)
 *   DELETE /tasks/:taskId/files/:fileId            [remove]      file-delete:task (204)
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: tham số rác vỡ `22P02` ⇒ **500**, request vẫn bị TỪ CHỐI ⇒ **KHÔNG phải
 * lỗ bảo mật**. Giá trị = hợp đồng API + hết 500 GIẢ trong giám sát.
 *
 * ─── RỦI RO RIÊNG: `DELETE .../files/cover` LÀ ANH EM LITERAL CỦA `:fileId` ─────────────────────
 * `@Delete("cover")` khai TRƯỚC `@Delete(":fileId")` và CHÍNH file controller đã cảnh báo: đảo thứ tự
 * thì `DELETE .../files/cover` rơi vào `remove()` với `fileId="cover"`, chết ở tầng uuid và cho ra lỗi
 * trông như "chưa implement". Gắn `ParseUUIDPipe` vào `:fileId` KHÔNG đổi thứ tự khớp route, nhưng nó
 * ĐỔI thông điệp của cú rơi đó từ 500 sang 400 — nên ca literal-sibling ở cuối file là bắt buộc, và
 * nó phải đo `cover` **trên task THẬT** (204), không phải trên uuid ngẫu nhiên.
 *
 * ─── CẤU TRÚC ĐO ────────────────────────────────────────────────────────────────────────────────
 * Mỗi tham số một dòng `CASES`, chạy HAI lần: `JUNK` → 400 ĐƠN TRỊ + neo `error.type`; `randomUUID()`
 * → oracle loại CẢ 400 VÀ 500. Bốn route hai-tham-số có MỘT dòng cho MỖI VẾ.
 *
 * ─── LUẬT ĐO ────────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập, KHÔNG super-admin, KHÔNG seed `*:*`. • Body HỢP LỆ mọi route ghi.
 * • KHÔNG gửi `Idempotency-Key`. • Cặp `read`/`file-upload`/`file-delete`:`task` = is_sensitive **false**
 *   (catalog lane DB) — `seedPermissionCatalog` DỪNG nếu khai lệch.
 * • Fixture `files` phải `upload_status='Uploaded'` + `scan_status='Clean'` + `mime_type` ảnh: cả
 *   `download` lẫn `setCover` có scan-guard STRICT (409 nếu Pending/Infected) và `setCover` đòi ảnh —
 *   sai fixture thì ca ALLOW đỏ vì lý do KHÔNG liên quan tới tham số.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid5`.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid5l3");

const JUNK = "khong-phai-uuid";
const uniq = () => randomUUID().slice(0, 8);

interface ParamCase {
  readonly key: string;
  readonly name: string;
  readonly run: (bad: string) => request.Test;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-5 · L3-TASKFILE — biên HTTP kênh PARAM của task-files.controller.ts (11 tham số)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let employeeId = "";
    let orgUnitId = "";

    let projectId = "";
    let taskId = "";
    let fileId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });
    const get = (u: string) => http().get(u).set(auth());
    const post = (u: string) => http().post(u).set(auth());
    const del = (u: string) => http().delete(u).set(auth());

    async function freshTask(): Promise<string> {
      const res = await post("/tasks").send({ title: `Việc ${uniq()}`, projectId });
      expect(res.status, `POST /tasks: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    /**
     * `files` row Uploaded + Clean + mime ẢNH — `download` và `setCover` đều có scan-guard STRICT, và
     * `setCover` đòi `mime_type` bắt đầu bằng `image/`. `storage_path` mang tiền tố tenant theo khuôn
     * `employee-file.int-spec.ts`.
     */
    async function seedFile(): Promise<string> {
      const id = randomUUID();
      await direct.query(
        `INSERT INTO files
           (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
            storage_path, upload_status, scan_status, uploaded_by)
         VALUES ($1, $2, 'anh-bia.png', $3, 'image/png', 2048, 'MinIO', $4, 'Uploaded', 'Clean', $5)`,
        [id, A.companyId, id, `${A.companyId}/files/${id}`, actorUserId],
      );
      return id;
    }

    /** Tệp ĐÃ đính kèm `onTask` qua ĐƯỜNG THẬT (`POST /tasks/:taskId/files`). */
    async function freshLinkedFile(onTask: string): Promise<string> {
      const id = await seedFile();
      const res = await post(`/tasks/${onTask}/files`).send({ fileId: id, category: "Attachment" });
      expect(res.status, `POST files: ${JSON.stringify(res.body)}`).toBe(201);
      return id;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu5l3");
      companyIds.push(A.companyId);

      // Counter `task` — `seedCompany` không chạy bootstrap công ty nên `POST /tasks` sẽ chết ở
      // SequenceService vì THIẾU FIXTURE, không phải vì sản phẩm hỏng.
      await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
            reset_policy, increment_by, current_value, status)
         VALUES ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
         ON CONFLICT DO NOTHING`,
        [A.companyId],
      );

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `taskfiler-${uniq()}@s10pu5l3.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [A.companyId, `s10pu5l3-ou-${uniq()}`],
      );
      orgUnitId = ou.rows[0].id;
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [A.companyId, actorUserId, orgUnitId],
      );
      employeeId = emp.rows[0].id;

      const roleId = await seedRole(direct, A.companyId, `s10pu5l3-${uniq()}`);
      const pairs: Array<[string, string, boolean]> = [
        ["read", "task", false],
        ["create", "task", false],
        ["file-upload", "task", false],
        ["file-delete", "task", false],
      ];
      for (const [action, resourceType, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, actorUserId, roleId, A.companyId);

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;

      const prj = await direct.query<{ id: string }>(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
         VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
        [A.companyId, `s10pu5l3-prj-${uniq()}`, orgUnitId, employeeId],
      );
      projectId = prj.rows[0].id;

      taskId = await freshTask();
      fileId = await freshLinkedFile(taskId);
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
    }

    function expectExact(res: request.Response, status: number): void {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    }

    const CASES: ParamCase[] = [
      {
        key: "tasks/task-files.controller.ts#list:taskId",
        name: "GET /tasks/:taskId/files",
        run: (bad) => get(`/tasks/${bad}/files`),
      },
      {
        key: "tasks/task-files.controller.ts#getOne:taskId",
        name: "GET /tasks/:taskId/files/:fileId — vế taskId",
        run: (bad) => get(`/tasks/${bad}/files/${fileId}`),
      },
      {
        key: "tasks/task-files.controller.ts#getOne:fileId",
        name: "GET /tasks/:taskId/files/:fileId — vế fileId",
        run: (bad) => get(`/tasks/${taskId}/files/${bad}`),
      },
      {
        key: "tasks/task-files.controller.ts#download:taskId",
        name: "GET /tasks/:taskId/files/:fileId/download — vế taskId",
        run: (bad) => get(`/tasks/${bad}/files/${fileId}/download`),
      },
      {
        key: "tasks/task-files.controller.ts#download:fileId",
        name: "GET /tasks/:taskId/files/:fileId/download — vế fileId",
        run: (bad) => get(`/tasks/${taskId}/files/${bad}/download`),
      },
      {
        key: "tasks/task-files.controller.ts#linkFile:taskId",
        name: "POST /tasks/:taskId/files",
        run: (bad) => post(`/tasks/${bad}/files`).send({ fileId: randomUUID() }),
      },
      {
        key: "tasks/task-files.controller.ts#setCover:taskId",
        name: "POST /tasks/:taskId/files/:fileId/cover — vế taskId",
        run: (bad) => post(`/tasks/${bad}/files/${fileId}/cover`),
      },
      {
        key: "tasks/task-files.controller.ts#setCover:fileId",
        name: "POST /tasks/:taskId/files/:fileId/cover — vế fileId",
        run: (bad) => post(`/tasks/${taskId}/files/${bad}/cover`),
      },
      {
        key: "tasks/task-files.controller.ts#clearCover:taskId",
        name: "DELETE /tasks/:taskId/files/cover",
        run: (bad) => del(`/tasks/${bad}/files/cover`),
      },
      {
        key: "tasks/task-files.controller.ts#remove:taskId",
        name: "DELETE /tasks/:taskId/files/:fileId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/files/${fileId}`),
      },
      {
        key: "tasks/task-files.controller.ts#remove:fileId",
        name: "DELETE /tasks/:taskId/files/:fileId — vế fileId",
        run: (bad) => del(`/tasks/${taskId}/files/${bad}`),
      },
    ];

    it("(0) BẢNG ĐO phủ ĐỦ 11 tham số và không dòng nào TRÙNG KHOÁ", () => {
      // Neo chống xanh-RỖNG: bảng thiếu dòng thì mọi ca dưới xanh vì KHÔNG CÓ GÌ để chạy.
      expect(CASES.length).toBe(11);
      expect(new Set(CASES.map((c) => c.key)).size, "có dòng TRÙNG KHOÁ trong bảng đo").toBe(11);
      for (const c of CASES) {
        expect(c.key.startsWith("tasks/task-files.controller.ts#"), `khoá sai file: ${c.key}`).toBe(
          true,
        );
      }
    });

    for (const c of CASES) {
      it(`PARAM · ${c.name} với giá trị rác → 400 ở BIÊN  [${c.key}]`, async () => {
        expectRejectedAtBoundary(await c.run(JUNK));
      });
    }

    for (const c of CASES) {
      it(`ALLOW · ${c.name} với UUID HỢP LỆ (không tồn tại) → KHÔNG 400, KHÔNG 500  [${c.key}]`, async () => {
        expectPassedBoundary(await c.run(randomUUID()));
      });
    }

    // ══ ALLOW-2xx TRÊN HÀNG THẬT — MỖI LOẠI KHOÁ MỘT CA ═════════════════════════════

    it("ALLOW-200 · GET /tasks/:taskId/files trên TASK THẬT (loại khoá task)", async () => {
      expectExact(await get(`/tasks/${taskId}/files`), 200);
    });

    it("ALLOW-200 · GET /tasks/:taskId/files/:fileId trên TỆP THẬT ĐÃ ĐÍNH KÈM (loại khoá file)", async () => {
      expectExact(await get(`/tasks/${taskId}/files/${fileId}`), 200);
    });

    it("ALLOW-302 · GET .../files/:fileId/download trên TỆP THẬT — redirect signed URL", async () => {
      const res = await get(`/tasks/${taskId}/files/${fileId}/download`);
      expectPassedBoundary(res);
      expect(res.status, JSON.stringify(res.body)).toBe(302);
    });

    it("ALLOW-201 · POST /tasks/:taskId/files trên TASK THẬT + TỆP THẬT", async () => {
      const t = await freshTask();
      const f = await seedFile();
      expectExact(await post(`/tasks/${t}/files`).send({ fileId: f, category: "Attachment" }), 201);
    });

    it("ALLOW-201 · POST .../files/:fileId/cover trên TỆP ẢNH THẬT ĐÃ ĐÍNH KÈM", async () => {
      const t = await freshTask();
      const f = await freshLinkedFile(t);
      expectExact(await post(`/tasks/${t}/files/${f}/cover`), 201);
    });

    it("ALLOW-204 · DELETE /tasks/:taskId/files/:fileId trên TỆP THẬT (@HttpCode(204))", async () => {
      const t = await freshTask();
      const f = await freshLinkedFile(t);
      expectExact(await del(`/tasks/${t}/files/${f}`), 204);
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * `@Delete("cover")` khai TRƯỚC `@Delete(":fileId")` trong `task-files.controller.ts` — nếu ai đó
     * đảo thứ tự thì `cover` rơi vào `remove()` với `fileId="cover"`. Ca này ĐO trên task THẬT (chứ
     * không phải uuid ngẫu nhiên) nên nó phân biệt được "route đúng, không có bìa ⇒ 204 idempotent"
     * với "route bị nuốt ⇒ 400/500".
     */
    it("ĐỊNH TUYẾN · DELETE /tasks/:taskId/files/cover trên TASK THẬT vẫn 204 (KHÔNG rơi vào :fileId)", async () => {
      const t = await freshTask();
      expectExact(await del(`/tasks/${t}/files/cover`), 204);
    });

    it("ĐỊNH TUYẾN · DELETE .../files/cover SAU khi đã đặt bìa vẫn 204 (gỡ bìa thật)", async () => {
      const t = await freshTask();
      const f = await freshLinkedFile(t);
      expectExact(await post(`/tasks/${t}/files/${f}/cover`), 201);
      expectExact(await del(`/tasks/${t}/files/cover`), 204);
    });
  },
);
