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
import { grantMemoMiddleware } from "../../src/common/middleware/grant-memo.middleware";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { GrantSnapshotMemo, runWithGrantMemo } from "../../src/permission/grant-snapshot-memo";
import { CachedPermissionRepository } from "../../src/permission/permission.cache";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionService } from "../../src/permission/permission.service";
import type { ValkeyService } from "../../src/permission/valkey.service";
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
 * S16-SOCIAL-PERMMEMO-1 — ca H1–H8 của plan §4.3 (DECISIONS-15), DB THẬT.
 *
 * HAI app Nest dựng từ `AppModule`:
 *   • appMemo — `app.use(requestIdMiddleware); app.use(grantMemoMiddleware)` y hệt `main.ts`;
 *   • appCtl  — KHÔNG middleware = hiện trạng của ~311 int-spec khác (plan M6) ⇒ passthrough.
 * Spy CALL-THROUGH trên `PermissionRepository` (tầng DB, DƯỚI memo) của TỪNG app, lọc theo userId —
 * khuôn ATTDEBT H1. Spy thay ruột ⇒ grant giả ⇒ cổng trả lời sai ⇒ xanh/đỏ vì lý do khác.
 *
 * H7 (multipart): SOCIAL KHÔNG có route upload multipart (tệp đi qua cửa presign của foundation) ⇒
 * không đo ở đây; đường body JSON (body-parser/raw-body) được H1 đo (PATCH JSON, appMemo = 1 lượt ⇒
 * ngữ cảnh ALS sống qua body-parser). Multer/busboy: CHƯA đo — ghi R1 ở plan §9.
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;
// CLAUDE.md §5 — fixture giống-secret GHÉP CHUỖI.
const LOGIN_PW = ["Passw0rd!permmemo", "1"].join("");

const AUTHOR_PAIRS = [
  "view:feed",
  "create:feed-post",
  "create:feed-comment",
  "download:foundation-file",
  "view:foundation-file",
] as const;

type Scope = "Own" | "Team" | "Company";
type Pair = readonly [action: string, resourceType: string, scope: Scope, isSensitive: boolean];

/** Valkey tối thiểu cho H5 — cache Valkey KHÔNG phải đối tượng đo ở đây. */
function fakeValkey(): ValkeyService {
  return {
    get: async () => null,
    set: async () => true,
    del: async () => true,
  } as unknown as ValkeyService;
}

type ScopeSpy = { mock: { calls: unknown[][] }; mockClear: () => void; mockRestore: () => void };

describe.skipIf(!hasLaneDb)("S16-SOCIAL-PERMMEMO-1 — memo grant theo request (DB cô lập)", () => {
  let appMemo: INestApplication;
  let appCtl: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let hash = "";

  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  /** Dựng app CHƯA init — init + listen ở `beforeAll` (census S18-QA-SUPERTESTLISTEN-1 đọc theo tên biến). */
  async function buildApp(withMemo: boolean): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const built = moduleRef.createNestApplication();
    if (withMemo) {
      built.use(requestIdMiddleware);
      built.use(grantMemoMiddleware);
    }
    built.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    built.useGlobalFilters(new AllExceptionsFilter());
    return built;
  }

  const http = (app: INestApplication) => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function grant(userId: string, pairs: readonly Pair[]): Promise<string> {
    const roleId = await seedRole(direct, A.companyId, `pmemo-${randomUUID().slice(0, 8)}`);
    for (const [action, resourceType, scope, isSensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    return seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function seedEmp(userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3) RETURNING id`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    return r.rows[0].id as string;
  }

  async function makeUser(label: string, pairs: readonly Pair[]): Promise<void> {
    const email = `${label}@${A.slug}.test`;
    uid[label] = await seedUser(direct, A.companyId, email, hash);
    await grant(uid[label], pairs);
    const res = await http(appCtl)
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    tok[label] = res.body.data.accessToken as string;
  }

  /** Spy CALL-THROUGH trên repo DB của một app. */
  function spyOn(app: INestApplication): ScopeSpy {
    const repo = app.get(PermissionRepository, { strict: false });
    return vi.spyOn(repo, "getCompanyRoleGrantsWithScope");
  }

  const loadsOf = (spy: ScopeSpy, userId: string) =>
    spy.mock.calls.filter(([u]) => u === userId).length;

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

  async function postWithFile(): Promise<{ postId: string; fileId: string }> {
    const fileId = await seedFile(uid.author);
    const res = await http(appCtl)
      .post("/social/posts")
      .set(bearer(tok.author))
      .send({ type: "share", audience: "company", body: "bài có ảnh", attachmentIds: [fileId] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { postId: res.body.data.id as string, fileId };
  }

  async function insertLoginLog(userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO login_logs (company_id, user_id, email, normalized_email, login_status,
                               ip_address, user_agent)
       VALUES ($1, $2, $3, $3, 'success', '10.9.9.9', 'pmemo-seed') RETURNING id`,
      [A.companyId, userId, `seed-${userId.slice(0, 8)}@pmemo.test`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    // H4 bắn supertest trong `Promise.all` ⇒ server PHẢI listen sẵn (S18-QA-SUPERTESTLISTEN-1),
    // nếu không supertest đóng server tạm khi request ĐẦU về và phần còn lại ăn ECONNRESET.
    appMemo = await buildApp(true);
    await appMemo.init();
    await appMemo.listen(0);
    appCtl = await buildApp(false);
    await appCtl.init();
    await appCtl.listen(0);
    direct = directPool();
    hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "pmemo");
    companyIds.push(A.companyId);

    await makeUser(
      "author",
      AUTHOR_PAIRS.map((k) => [...(k.split(":") as [string, string]), "Company", false] as const),
    );
    await seedEmp(uid.author);
    // `view:audit-log` là cặp SENSITIVE (`auth-logs-viewer.controller.ts`) ⇒ hàng ALLOW EXACT,
    // non-wildcard (seedRolePermission). `view:user@Company` để cột danh tính không là biến nhiễu.
    await makeUser("auditA", [
      ["view", "audit-log", "Company", true],
      ["view", "user", "Company", false],
    ]);
    await makeUser("auditB", [
      ["view", "audit-log", "Own", true],
      ["view", "user", "Company", false],
    ]);
    await makeUser("tasker", [
      ["read", "task", "Company", false],
      ["comment", "task", "Company", false],
    ]);
    await seedEmp(uid.tasker);
    await makeUser("scope", [["view", "feed", "Company", false]]);
  }, 180_000);

  afterAll(async () => {
    if (direct && companyIds.length) {
      for (const tbl of ["task_activity_logs", "task_comments", "tasks"]) {
        await direct
          .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [companyIds])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, companyIds);
    }
    await appMemo?.close();
    await appCtl?.close();
  });

  // ═══════════════ H1–H3 — số lượt nạp grant / request ═══════════════

  it("H1 🔴 PATCH bài có attachmentIds: appCtl ≥2 (neo) · appMemo = 1 · cả hai 200", async () => {
    const { postId, fileId } = await postWithFile();
    const count = async (app: INestApplication, body: string): Promise<number> => {
      const spy = spyOn(app);
      spy.mockClear();
      const res = await http(app)
        .patch(`/social/posts/${postId}`)
        .set(bearer(tok.author))
        .send({ body, attachmentIds: [fileId] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const n = loadsOf(spy, uid.author);
      spy.mockRestore();
      return n;
    };
    const ctl = await count(appCtl, "sửa ctl");
    const memo = await count(appMemo, "sửa memo");
    // Số THẬT in ra để chép vào plan §9 (trước/sau).
    process.stdout.write(`[PERMMEMO H1] appCtl=${ctl} appMemo=${memo}\n`);
    expect(ctl, "NEO: appCtl phải nạp ≥2 lần (hiện trạng)").toBeGreaterThanOrEqual(2);
    expect(memo, `PATCH đính kèm: appCtl=${ctl} · appMemo PHẢI = 1`).toBe(1);
  });

  it("H2 GET bài 1 ảnh: appCtl ≥2 · appMemo = 1 · URL ký được (neo ALLOW thật)", async () => {
    const { postId } = await postWithFile();
    const count = async (app: INestApplication): Promise<number> => {
      const spy = spyOn(app);
      spy.mockClear();
      const res = await http(app).get(`/social/posts/${postId}`).set(bearer(tok.author));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const att = (res.body.data as { attachments?: { url?: string | null }[] }).attachments;
      expect(att?.[0]?.url, "URL đính kèm phải ký được (ALLOW thật)").toBeTruthy();
      const n = loadsOf(spy, uid.author);
      spy.mockRestore();
      return n;
    };
    const ctl = await count(appCtl);
    const memo = await count(appMemo);
    process.stdout.write(`[PERMMEMO H2] appCtl=${ctl} appMemo=${memo}\n`);
    expect(ctl, "NEO: appCtl phải nạp ≥2 lần").toBeGreaterThanOrEqual(2);
    expect(memo, `GET 1 ảnh: appCtl=${ctl} · appMemo PHẢI = 1`).toBe(1);
  });

  it("H3 non-SOCIAL GET /auth/login-logs: appCtl = 2 (neo) · appMemo = 1 · 200", async () => {
    const count = async (app: INestApplication): Promise<number> => {
      const spy = spyOn(app);
      spy.mockClear();
      const res = await http(app).get("/auth/login-logs?per_page=5").set(bearer(tok.auditA));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const n = loadsOf(spy, uid.auditA);
      spy.mockRestore();
      return n;
    };
    const ctl = await count(appCtl);
    const memo = await count(appMemo);
    process.stdout.write(`[PERMMEMO H3] appCtl=${ctl} appMemo=${memo}\n`);
    expect(ctl, "NEO: login-logs hiện trạng = 2 lượt (view:audit-log + view:user)").toBe(2);
    expect(memo, `login-logs: appCtl=${ctl} · appMemo PHẢI = 1`).toBe(1);
  });

  // ═══════════════ H4 — hai actor song song, KHÔNG rò ═══════════════

  it("H4 🔴 hai actor song song (A @Company, B @Own) — không rò, 1 lượt/request/actor", async () => {
    const aRows = [await insertLoginLog(uid.auditA), await insertLoginLog(uid.auditA)];
    const bRows = [await insertLoginLog(uid.auditB), await insertLoginLog(uid.auditB)];
    const repo = appMemo.get(PermissionRepository, { strict: false });
    const original = repo.getCompanyRoleGrantsWithScope.bind(repo);
    // Chờ 25ms rồi CALL-THROUGH ⇒ ép các request chồng lấn nhau trong lúc đọc grant.
    const spy = vi
      .spyOn(repo, "getCompanyRoleGrantsWithScope")
      .mockImplementation(async (userId: string, companyId: string) => {
        await new Promise((r) => setTimeout(r, 25));
        return original(userId, companyId);
      });

    const reqA = () =>
      http(appMemo)
        .get(`/auth/login-logs?per_page=100&user_id=${uid.auditB}`)
        .set(bearer(tok.auditA));
    const reqB = () => http(appMemo).get("/auth/login-logs?per_page=100").set(bearer(tok.auditB));
    const all = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? reqA() : reqB()).then((r) => ({ i, r }))),
    );
    const nA = loadsOf(spy, uid.auditA);
    const nB = loadsOf(spy, uid.auditB);
    spy.mockRestore();

    for (const { i, r } of all) {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const ids = (r.body.data as { id: string }[]).map((x) => x.id);
      if (i % 2 === 0) {
        // Đối chứng ALLOW: A (@Company) THẤY hàng của B.
        for (const id of bRows) expect(ids, "A @Company phải thấy hàng của B").toContain(id);
      } else {
        for (const id of aRows) expect(ids, "B @Own KHÔNG được thấy hàng của A").not.toContain(id);
        for (const id of bRows) expect(ids, "B phải thấy hàng của chính mình").toContain(id);
      }
    }
    process.stdout.write(`[PERMMEMO H4] A=${nA} B=${nB}\n`);
    expect(nA, "memo KHÔNG được xuyên request: A=5 lượt").toBe(5);
    expect(nB, "memo KHÔNG được xuyên request: B=5 lượt").toBe(5);
  });

  // ═══════════════ H5 — thu hồi trong một request (dựng tay, `now` tiêm) ═══════════════

  describe("H5 🔴 thu hồi giữa request: invalidateUser (H5a) · trần tuổi (H5b)", () => {
    let t = 0;
    let svc: PermissionService;
    let cached: CachedPermissionRepository;
    let userRoleId = "";

    beforeAll(async () => {
      // DI factory (`permission.module.ts`) dựng memo 2 đối số ⇒ không chạm được `now` ⇒ dựng tay.
      cached = new CachedPermissionRepository(
        appCtl.get(PermissionRepository, { strict: false }),
        // Valkey GIẢ (del → true): plan H5 giả định lane KHÔNG có VALKEY_URL, nhưng `loadEnv()` đọc
        // `.env` gốc repo ⇒ client ioredis thật với `lazyConnect` + `enableOfflineQueue:false` làm DEL
        // ĐẦU TIÊN trên client lạnh trả `false` ⇒ `invalidateUser` ném. Nhánh DEL-lỗi đã có C3 đo; ở
        // đây chỉ đo memo trên DB thật (plan §9 ghi lệch).
        fakeValkey(),
        new GrantSnapshotMemo({ now: () => t }),
      );
      svc = new PermissionService(cached);
      const r = await direct.query(
        `SELECT id FROM user_roles WHERE user_id = $1 AND deleted_at IS NULL`,
        [uid.scope],
      );
      userRoleId = r.rows[0].id as string;
    });

    const revoke = () =>
      direct.query(`UPDATE user_roles SET deleted_at = now() WHERE id = $1`, [userRoleId]);
    const restore = () =>
      direct.query(`UPDATE user_roles SET deleted_at = NULL WHERE id = $1`, [userRoleId]);
    const scopeNow = () => svc.resolveStrongestScope(uid.scope, A.companyId, "view", "feed");

    it("H5a — trong trần còn scope (biên D1); invalidateUser ⇒ null", async () => {
      await restore();
      try {
        await runWithGrantMemo(async () => {
          expect(await scopeNow()).toBe("Company");
          await revoke();
          expect(await scopeNow(), "H5a-giữ: trong trần 2000ms ảnh chụp còn hiệu lực (D1)").toBe(
            "Company",
          );
          await cached.invalidateUser(A.companyId, uid.scope);
          expect(await scopeNow(), "sau invalidateUser lượt đọc PHẢI thấy thu hồi").toBeNull();
        });
      } finally {
        await restore();
      }
    });

    it("H5b — quá trần 2000ms (không invalidate) ⇒ null", async () => {
      await restore();
      try {
        await runWithGrantMemo(async () => {
          expect(await scopeNow()).toBe("Company");
          await revoke();
          t += 1_999;
          expect(await scopeNow(), "trong trần còn scope").toBe("Company");
          t += 1;
          expect(await scopeNow(), "quá trần 2000ms PHẢI đọc lại DB").toBeNull();
        });
      } finally {
        await restore();
      }
    });
  });

  // ═══════════════ H8 — actor không che user được mention ═══════════════

  describe("H8 🔴 mention trong CÙNG request: memo của actor KHÔNG che người được mention", () => {
    async function mkTask(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, creator_user_id)
         VALUES ($1,'office','T','Todo',$2) RETURNING id`,
        [A.companyId, uid.tasker],
      );
      return r.rows[0].id as string;
    }

    async function mention(target: string): Promise<request.Response> {
      const t = await mkTask();
      return http(appMemo)
        .post(`/tasks/${t}/comments`)
        .set(bearer(tok.tasker))
        .send({ content: "nhờ xem", mentionEmployeeIds: [target] });
    }

    it("mention user KHÔNG có read:task ⇒ 403 MENTION_OUT_OF_SCOPE (appMemo)", async () => {
      const outsider = await seedUser(direct, A.companyId, `outsider@${A.slug}.test`, hash);
      const outsiderEmp = await seedEmp(outsider);
      const res = await mention(outsiderEmp);
      expect(
        res.status,
        `memo PHẢI tách người dùng trong cùng công ty: ${JSON.stringify(res.body)}`,
      ).toBe(403);
      expect(JSON.stringify(res.body)).toContain("TASK-ERR-MENTION-OUT-OF-SCOPE");
    });

    it("ALLOW đối chứng: mention user CÓ read:task@Company ⇒ 201", async () => {
      const insider = await seedUser(direct, A.companyId, `insider@${A.slug}.test`, hash);
      await grant(insider, [["read", "task", "Company", false]]);
      const insiderEmp = await seedEmp(insider);
      const res = await mention(insiderEmp);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ═══════════════ H6 — ngoài request = passthrough trên app thật ═══════════════

  it("H6 ngoài request: resolveStrongestScope ×3 trên appMemo ⇒ spy = 3", async () => {
    const spy = spyOn(appMemo);
    spy.mockClear();
    const svc = appMemo.get(PermissionService, { strict: false });
    for (let i = 0; i < 3; i += 1) {
      expect(await svc.resolveStrongestScope(uid.scope, A.companyId, "view", "feed")).toBe(
        "Company",
      );
    }
    const n = loadsOf(spy, uid.scope);
    spy.mockRestore();
    expect(n, "ngoài request PHẢI passthrough: 3 lượt").toBe(3);
  });
});
