/**
 * S19-OPS-TASKFILEURL-1 — `GET /tasks/:taskId/files/:fileId/download-url` (route JSON phát URL ký) ĐI CÙNG
 * MỘT hàm kiểm với route 302 `.../download` (`TaskFileService.getDownloadUrl`). Plan:
 * `docs/plans/S19-OPS-TASKFILEURL-1.md` §6 (ca J-0…J-11). App THẬT (AppModule) dựng qua `applyMainPipeline`,
 * engine quyền THẬT, Postgres THẬT (lane cô lập). Không cần storage chạy: ký URL là tính toán cục bộ.
 *
 * ⚠️ Bẫy xanh giả: route chưa tồn tại thì router trả 404 ⇒ ca từ chối nào chỉ chờ «404» sẽ XANH trên mã chưa
 *    vá. Mọi ca từ chối assert theo thứ tự: status → `error.code` → mã nghiệp vụ (tiền tố `TASK-ERR-…` của
 *    `error.message` — lỗi 404 của service mang mã chung `RESOURCE-ERR-NOT-FOUND` ở `error.code`, giống hệt
 *    404 của router; chỉ tiền tố message phân biệt hai bên) → body không có `data`, không có tham số ký.
 *
 * J-10 (parity): mỗi ca gọi route JSON RỒI route 302 trên CÙNG dữ liệu (`both`), ghi cặp vào `pairs`; ca J-10
 * chạy CUỐI so từng cặp: cho phép 200 ⇔ 302 · từ chối cùng status + mã · nhật ký `file_access_logs` mới GIỐNG
 * NHAU theo tuple (action, access_granted, actor_user_id, permission_code, file_id) · `origin + pathname` của URL
 * và tham số `response-content-disposition` giống nhau. Cặp của J-6/J-7/J-11 được đo TRƯỚC khi xoá / đổi
 * membership (vế cho phép chạy trước).
 *
 * ⚠️ PHỤ THUỘC THỨ TỰ: các ca J-* chạy tuần tự trên CÙNG dữ liệu — J-6/J-7/J-11 tự đổi dữ liệu (DELETE thật,
 *    UPDATE `tasks.deleted_at`, UPDATE `project_members.member_status` bằng superuser) và J-10 đọc mảng `pairs` do
 *    các ca trước ghi. CHỈ chạy cả tệp; `-t` lọc một ca sẽ đỏ ở neo `EXPECTED_PAIRS` của J-10 (không xanh giả).
 *    J-10 so `origin + pathname` + `response-content-disposition`, KHÔNG so phần còn lại của tham số ký.
 *
 * Cổng `hasDb && LANE_DB` (CLAUDE.md §9.5). Không `Promise.all` quanh supertest (census S18-QA-SUPERTESTLISTEN-1).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { downloadUrlSchema } from "@mediaos/contracts";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { ERROR_CODES } from "../../src/common/errors/error-codes";
import { DEFAULT_PRESIGN_TTL_SEC } from "../../src/storage/storage-adapter.port";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { FALLBACK_S3_SECRET, loginPasswordFixture } from "../helpers/fixture-secrets";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import {
  grant,
  seedEmployee,
  seedFile,
  seedProjectMember,
  seedTask,
  seedTaskLink,
  type Pair,
} from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s19tfu");
const SIGNED_PARAM = /X-Amz-(Signature|Credential)/;
const NOT_DOWNLOADABLE = "FOUNDATION-FILE-ERR-NOT-DOWNLOADABLE";
const TASK_NOT_FOUND = "TASK-ERR-TASK-NOT-FOUND";
const FILE_NOT_FOUND = "TASK-ERR-FILE-NOT-FOUND";
const DL_PERM = "FOUNDATION.FILE.DOWNLOAD";
/** Dung sai đồng hồ giữa lúc gửi request và lúc server tính `expiresAt`. */
const CLOCK_SLACK_MS = 5_000;
/** Số cặp (JSON, 302) mà các ca J-0…J-9 + J-11 ghi vào `pairs` — neo chống xanh-rỗng của J-10. */
const EXPECTED_PAIRS = 24;

const jsonPath = (t: string, f: string) => `/tasks/${t}/files/${f}/download-url`;
const redirectPath = (t: string, f: string) => `/tasks/${t}/files/${f}/download`;

interface Hit {
  res: request.Response;
  /** Dòng `file_access_logs` MỚI do đúng lượt gọi này ghi, dạng tuple B5 đã sắp xếp. */
  logs: string[];
  sentAt: number;
}
interface RoutePair {
  label: string;
  json: Hit;
  redirect: Hit;
}

const tuple = (action: string, granted: boolean, actor: string, perm: string, fileId: string) =>
  [action, String(granted), actor, perm, fileId].join("|");

describe.skipIf(!runDb)("S19-OPS-TASKFILEURL-1 — route JSON download-url cho tệp TASK", () => {
  const direct: Pool = directPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  let ttlSec = 0;
  const pairs: RoutePair[] = [];
  const token: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let taskA = "";
  let taskOther = "";
  let taskB = "";
  let taskDel = "";
  let pmMemberId = "";
  const f: Record<string, string> = {};

  async function logIds(fileId: string): Promise<Set<string>> {
    const r = await direct.query(`SELECT id FROM file_access_logs WHERE file_id = $1`, [fileId]);
    return new Set(r.rows.map((x: { id: string }) => x.id));
  }

  async function newLogs(fileId: string, seen: Set<string>): Promise<string[]> {
    const r = await direct.query(
      `SELECT id, action, access_granted, actor_user_id, permission_code, file_id
         FROM file_access_logs WHERE file_id = $1`,
      [fileId],
    );
    return r.rows
      .filter((x: { id: string }) => !seen.has(x.id))
      .map((x) => tuple(x.action, x.access_granted, x.actor_user_id, x.permission_code, x.file_id))
      .sort();
  }

  async function hit(path: string, fileId: string, who: string | null): Promise<Hit> {
    const seen = await logIds(fileId);
    const sentAt = Date.now();
    const req = request(nest.getHttpServer()).get(path);
    const res = who ? await req.set("Authorization", `Bearer ${token[who]}`) : await req;
    return { res, logs: await newLogs(fileId, seen), sentAt };
  }

  /** Gọi route JSON rồi route 302 trên CÙNG dữ liệu; ghi cặp cho J-10; trả lượt JSON. */
  async function both(label: string, who: string | null, t: string, fileId: string): Promise<Hit> {
    const json = await hit(jsonPath(t, fileId), fileId, who);
    const redirect = await hit(redirectPath(t, fileId), fileId, who);
    pairs.push({ label, json, redirect });
    return json;
  }

  function expectDenied(
    h: Hit,
    status: number,
    code: string,
    bizCode: string | null,
    logs: string[],
  ) {
    const body = JSON.stringify(h.res.body);
    expect(h.res.status, body).toBe(status);
    expect(h.res.body?.error?.code, body).toBe(code);
    if (bizCode) expect(String(h.res.body?.error?.message).split(":")[0], body).toBe(bizCode);
    expect(h.res.body?.data ?? null).toBeNull();
    expect(body).not.toMatch(SIGNED_PARAM);
    expect(h.logs).toEqual(logs);
  }

  function expectAllowed(h: Hit, who: string, fileId: string) {
    expect(h.res.status, h.res.status === 200 ? "" : JSON.stringify(h.res.body)).toBe(200);
    const dto = downloadUrlSchema.parse(h.res.body.data);
    expect(h.res.headers["cache-control"]).toBe("no-store");
    const exp = Date.parse(dto.expiresAt);
    expect(exp).toBeGreaterThan(h.sentAt);
    // Cận dưới: TTL bị rút ngắn (vd 1 s) phải ĐỎ ở đây, không chỉ ở cận trên.
    expect(exp, `expiresAt ngắn hơn TTL ${ttlSec}s`).toBeGreaterThanOrEqual(
      h.sentAt + ttlSec * 1000 - CLOCK_SLACK_MS,
    );
    expect(exp).toBeLessThanOrEqual(h.sentAt + ttlSec * 1000 + CLOCK_SLACK_MS);
    expect(h.logs).toEqual([tuple("Download", true, uid[who], DL_PERM, fileId)]);
  }

  beforeAll(async () => {
    // Ký ngoại tuyến khi máy không cấu hình storage (cùng khuôn s16-filedisposition-storage); `??=` không đè.
    process.env.S3_ENDPOINT ??= "http://localhost:9000";
    process.env.S3_ACCESS_KEY ??= "mediaos";
    process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
    process.env.S3_BUCKET ??= "tfu-offline-sign-only";
    // TTL hiệu lực = đúng luật của `S3StorageAdapter.resolveTtl` (env, hoặc hằng mặc định của port).
    ttlSec = Number.parseInt(process.env.S3_PRESIGN_TTL_SEC ?? "", 10) || DEFAULT_PRESIGN_TTL_SEC;

    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "tfuA");
    B = await seedCompany(direct, "tfuB");
    const user = async (k: string, pairsOf: Pair[] | null, scope?: "Own" | "Company") => {
      uid[k] = await seedUser(direct, A.companyId, `${k}@${A.slug}.test`, hash);
      if (pairsOf) await grant(direct, A.companyId, uid[k], pairsOf, scope);
    };
    await user(
      "hr",
      [
        ["read", "task"],
        ["file-upload", "task"],
        ["file-delete", "task"],
      ],
      "Company",
    );
    await user("reader", [["read", "task"]], "Company");
    await user(
      "emp",
      [
        ["read", "task"],
        ["file-upload", "task"],
      ],
      "Own",
    );
    await user("pm", [["read", "task"]], "Own");
    await user("noPerm", null);
    await user("fndOnly", [["download", "foundation-file"]], "Company");

    const empEmp = await seedEmployee(direct, A.companyId, uid.emp);
    const pmEmp = await seedEmployee(direct, A.companyId, uid.pm);
    const otherEmp = await seedEmployee(direct, A.companyId, null);
    const proj = await seedProjectMember(direct, A.companyId, {
      userId: uid.pm,
      employeeId: pmEmp,
    });
    pmMemberId = proj.memberId;

    taskA = await seedTask(direct, A.companyId, empEmp);
    taskOther = await seedTask(direct, A.companyId, otherEmp, proj.projectId);
    taskDel = await seedTask(direct, A.companyId, null);
    taskB = await seedTask(direct, B.companyId, null);

    const file = async (
      k: string,
      t: string,
      opts?: { scanStatus?: string; uploadStatus?: string },
    ) => {
      f[k] = await seedFile(direct, A.companyId, uid.hr, opts ?? { scanStatus: "Clean" });
      await seedTaskLink(direct, A.companyId, f[k], t, uid.hr);
    };
    await file("cleanA", taskA);
    await file("nrA", taskA, { scanStatus: "NotRequired" });
    await file("pendScanA", taskA, { scanStatus: "Pending" });
    await file("failA", taskA, { scanStatus: "Failed" });
    await file("infA", taskA, { scanStatus: "Infected" });
    await file("pendUpA", taskA, { scanStatus: "NotRequired", uploadStatus: "Pending" });
    await file("delA", taskA);
    await file("cleanOther", taskOther);
    await file("fileDel", taskDel);
    const bUser = await seedUser(direct, B.companyId, `bhr@${B.slug}.test`, hash);
    f.fileB = await seedFile(direct, B.companyId, bUser, { scanStatus: "Clean" });
    await seedTaskLink(direct, B.companyId, f.fileB, taskB, bUser);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();

    for (const k of Object.keys(uid)) {
      const res = await request(nest.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: A.slug, email: `${k}@${A.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
      token[k] = res.body.data.accessToken as string;
    }
  });

  afterAll(async () => {
    if (nest) await nest.close();
    if (A && B) await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("J-R app role (DATABASE_URL) không superuser, không BYPASSRLS · RLS tự chặn file_links của B dưới GUC của A", async () => {
    const app = appPool(1);
    try {
      const role = await app.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      const countUnder = async (companyId: string): Promise<number> => {
        const c = await app.connect();
        try {
          await c.query("BEGIN");
          await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
          const r = await c.query(
            "SELECT count(*)::int AS n FROM file_links WHERE entity_id = $1",
            [taskB],
          );
          await c.query("COMMIT");
          return r.rows[0].n as number;
        } finally {
          c.release();
        }
      };
      // Không lọc company_id trong câu SQL: chỉ RLS + FORCE quyết. Vế B là đối chứng chống xanh-rỗng.
      expect(await countUnder(A.companyId), "RLS phải giấu file_links của B dưới GUC của A").toBe(
        0,
      );
      expect(await countUnder(B.companyId), "đối chứng: GUC của B thấy liên kết của B").toBe(1);
    } finally {
      await app.end();
    }
  });

  it("J-0 không Bearer → 401 trên CẢ hai route (route tồn tại, guard xác thực chặn — T2 dựa vào đây)", async () => {
    const h = await both("J-0 không token", null, taskA, f.cleanA);
    expectDenied(h, 401, ERROR_CODES.AUTH_UNAUTHENTICATED, null, []);
    expect(pairs.at(-1)?.redirect.res.status).toBe(401);
  });

  it("J-1 noPerm → 403, 0 nhật ký ⇄ reader cùng tệp → 200 + no-store + expiresAt trong TTL + 1 grant", async () => {
    expectDenied(
      await both("J-1 noPerm", "noPerm", taskA, f.cleanA),
      403,
      ERROR_CODES.AUTH_FORBIDDEN,
      null,
      [],
    );
    expectAllowed(await both("J-1 reader", "reader", taskA, f.cleanA), "reader", f.cleanA);
  });

  it("J-2 fndOnly (chỉ download:foundation-file) → 403, không leo thang ⇄ hr cùng tệp → 200", async () => {
    expectDenied(
      await both("J-2 fndOnly", "fndOnly", taskA, f.cleanA),
      403,
      ERROR_CODES.AUTH_FORBIDDEN,
      null,
      [],
    );
    expectAllowed(await both("J-2 hr", "hr", taskA, f.cleanA), "hr", f.cleanA);
  });

  it("J-3 chéo công ty: hr(A) taskB/fileB → 404 TASK-NOT-FOUND ⇄ hr taskA/cleanA → 200", async () => {
    const deny = await both("J-3 hr→taskB", "hr", taskB, f.fileB);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, TASK_NOT_FOUND, []);
    expectAllowed(await both("J-3 hr→taskA", "hr", taskA, f.cleanA), "hr", f.cleanA);
  });

  it("J-4 IDOR chéo task: hr taskA/cleanOther → 404 FILE-NOT-FOUND ⇄ hr taskOther/cleanOther → 200", async () => {
    const deny = await both("J-4 taskA/cleanOther", "hr", taskA, f.cleanOther);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, FILE_NOT_FOUND, []);
    expectAllowed(
      await both("J-4 taskOther/cleanOther", "hr", taskOther, f.cleanOther),
      "hr",
      f.cleanOther,
    );
  });

  it("J-5 ngoài scope: emp@Own taskOther → 404 TASK-NOT-FOUND ⇄ emp taskA (assignee) → 200", async () => {
    const deny = await both("J-5 emp→taskOther", "emp", taskOther, f.cleanOther);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, TASK_NOT_FOUND, []);
    expectAllowed(await both("J-5 emp→taskA", "emp", taskA, f.cleanA), "emp", f.cleanA);
  });

  it("J-6 hr → 200 trên delA ⇄ sau DELETE thật (204) → 404 FILE-NOT-FOUND", async () => {
    expectAllowed(await both("J-6 trước xoá", "hr", taskA, f.delA), "hr", f.delA);
    const del = await request(nest.getHttpServer())
      .delete(`/tasks/${taskA}/files/${f.delA}`)
      .set("Authorization", `Bearer ${token.hr}`);
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    const deny = await both("J-6 sau xoá", "hr", taskA, f.delA);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, FILE_NOT_FOUND, []);
  });

  it("J-7 hr → 200 trên taskDel/fileDel ⇄ sau khi xoá mềm task → 404 TASK-NOT-FOUND", async () => {
    expectAllowed(await both("J-7 trước xoá", "hr", taskDel, f.fileDel), "hr", f.fileDel);
    await direct.query(`UPDATE tasks SET deleted_at = now() WHERE id = $1`, [taskDel]);
    const deny = await both("J-7 sau xoá", "hr", taskDel, f.fileDel);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, TASK_NOT_FOUND, []);
  });

  it("J-8 scan Pending/Failed/Infected → 409 NOT_DOWNLOADABLE, 0 nhật ký ⇄ Clean/NotRequired → 200", async () => {
    for (const k of ["pendScanA", "failA", "infA"]) {
      expectDenied(await both(`J-8 ${k}`, "hr", taskA, f[k]), 409, NOT_DOWNLOADABLE, null, []);
    }
    expectAllowed(await both("J-8 cleanA", "hr", taskA, f.cleanA), "hr", f.cleanA);
    expectAllowed(await both("J-8 nrA", "hr", taskA, f.nrA), "hr", f.nrA);
  });

  it("J-9 upload Pending (scan NotRequired) → 409 + ĐÚNG 1 dòng deny ⇄ nrA → 200 + 1 grant", async () => {
    const deny = await both("J-9 pendUpA", "hr", taskA, f.pendUpA);
    expectDenied(deny, 409, NOT_DOWNLOADABLE, null, [
      tuple("Download", false, uid.hr, DL_PERM, f.pendUpA),
    ]);
    expectAllowed(await both("J-9 nrA", "hr", taskA, f.nrA), "hr", f.nrA);
  });

  it("J-11 thành viên Viewer Active của dự án → 200 ⇄ member_status 'Inactive' → 404 TASK-NOT-FOUND, 0 nhật ký", async () => {
    expectAllowed(await both("J-11 Active", "pm", taskOther, f.cleanOther), "pm", f.cleanOther);
    // CHECK 0478: member_status IS NULL OR IN ('Active','Inactive','Removed') — 'Inactive' hợp lệ, khác 'Active'.
    await direct.query(`UPDATE project_members SET member_status = 'Inactive' WHERE id = $1`, [
      pmMemberId,
    ]);
    const deny = await both("J-11 Inactive", "pm", taskOther, f.cleanOther);
    expectDenied(deny, 404, ERROR_CODES.RESOURCE_NOT_FOUND, TASK_NOT_FOUND, []);
  });

  it("J-10 parity: mỗi cặp (JSON, 302) cùng kết quả · cùng nhật ký · cùng URL gốc + disposition", () => {
    for (const p of pairs) {
      const { json, redirect } = p;
      expect(json.res.status === 200 ? 302 : json.res.status, p.label).toBe(redirect.res.status);
      expect(json.logs, p.label).toEqual(redirect.logs);
      if (redirect.res.status === 302) {
        const j = new URL(String(json.res.body.data.url));
        const r = new URL(String(redirect.res.headers.location));
        expect(j.origin + j.pathname, p.label).toBe(r.origin + r.pathname);
        const disp = "response-content-disposition";
        expect(j.searchParams.get(disp), p.label).toBe(r.searchParams.get(disp));
      } else {
        expect(json.res.body?.error?.code, p.label).toBe(redirect.res.body?.error?.code);
        expect(json.res.body?.error?.message, p.label).toBe(redirect.res.body?.error?.message);
      }
    }
    expect(pairs.length, "số cặp đã đo — thiếu ⇒ có ca J-* dừng giữa chừng").toBe(EXPECTED_PAIRS);
  });
});
