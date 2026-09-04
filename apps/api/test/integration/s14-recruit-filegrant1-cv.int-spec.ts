/**
 * S14-RECRUIT-FILEGRANT-1 — bề mặt tệp CV của RECRUIT (RECRUIT-API-033..037), DB cô lập, đường THẬT.
 *
 * ┌─ HAI VẾ CỦA MỖI CÂU CHUYỆN ─────────────────────────────────────────────────────────────────┐
 * │ Mọi ca DENY ở đây có ca ALLOW đối chứng CÙNG cấu hình (`deny-cases-vacuous-without-allow-     │
 * │ case`), và ca ALLOW assert mã 2xx CỤ THỂ — KHÔNG `.not.toBe(403)`, vốn nuốt cả 500            │
 * │ (`allow-counter-case-not-403-lets-500-through`).                                              │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — SA giữ `*:*` nên mọi ca deny sẽ xanh-giả
 * (`superadmin-not-a-canonical-role`). Ba chủ thể ở đây mang ĐÚNG hình dạng quyền của DB thật:
 *   • `recruiter` = 7 cặp `candidate` @Company + cặp GHI tệp mới, **0** cặp `*:foundation-file`;
 *   • `hr`        = `view`/`convert:candidate` + cặp GHI tệp mới (KHÔNG `create`/`update:candidate`);
 *   • `employee`  = 0 cặp `candidate` nào;
 *   • `company-admin` = 6 cặp `foundation-file` @Company (bulk grant 0435) — dùng để chứng minh WO này
 *     SIẾT chứ không nới cho họ.
 *
 * ⚠️ GIỚI HẠN ĐÃ BIẾT — bước PUT bytes. Suite chạy KHÔNG cần MinIO (presign S3 là HMAC offline). Leg
 * "client PUT bytes lên storage" thay bằng một câu UPDATE `upload_status='Uploaded'` qua direct pool,
 * rồi `/confirm` đi ĐƯỜNG THẬT (`confirmUpload` trả 200 idempotent khi row đã `Uploaded`). Câu UPDATE
 * đó KHÔNG lách vế nào của WO: `owner_user_id` giữ nguyên giá trị `FileService.upload` đã đặt — chính
 * cột mà `/confirm` và vế 2 của `canLinkFile` soi.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
import { FALLBACK_S3_SECRET } from "../helpers/fixture-secrets";
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
const LOGIN_PW = ["Passw0rd", "s14filegrant"].join("!");

// Presign S3 là HMAC OFFLINE — không gọi mạng, không cần MinIO chạy. Đặt TRƯỚC khi dựng app.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "mediaos";
process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
process.env.S3_BUCKET ??= "mediaos-assets";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.S3_REGION ??= "us-east-1";

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resourceType, scope, isSensitive] — cờ sensitive phải KHỚP catalog thật, seed.ts ném LOUD nếu lệch. */
type PairGrant = [action: string, resource: string, scope: Scope, sensitive: boolean];

const CANDIDATE_PAIRS: readonly [string, boolean][] = [
  ["view", true],
  ["create", true],
  ["update", true],
  ["move-stage", true],
  ["comment", true],
  ["export", true],
  ["convert", true],
];

/** Cặp GHI tệp CV — seed mig 0569, is_sensitive=TRUE. */
const CV_UPLOAD: [string, string] = ["upload", "candidate-file"];

/** 6 cặp `foundation-file` mà 0435 bulk-grant cho company-admin (tất cả is_sensitive=false). */
const FOUNDATION_FILE_ACTIONS = ["upload", "view", "download", "link", "unlink", "delete"] as const;

/** Hình dạng quyền `recruiter` SAU WO này. KHÔNG có cặp `foundation-file` nào — đó là nội dung phép thử. */
const RECRUITER_PAIRS: PairGrant[] = [
  ["access", "recruit", "Company", false],
  ...CANDIDATE_PAIRS.map(([a, sens]) => [a, "candidate", "Company", sens] as PairGrant),
  ["view", "job-opening", "Company", false],
  ["create", "job-opening", "Company", false],
  ["update", "job-opening", "Company", false],
  [CV_UPLOAD[0], CV_UPLOAD[1], "Company", true],
];

/** Hình dạng quyền `hr`: đọc + convert ứng viên, GHI tệp CV — nhưng KHÔNG create/update:candidate. */
const HR_PAIRS: PairGrant[] = [
  ["access", "recruit", "Company", false],
  ["view", "candidate", "Company", true],
  ["convert", "candidate", "Company", true],
  [CV_UPLOAD[0], CV_UPLOAD[1], "Company", true],
];

/** `employee` — 0 cặp `candidate`, 0 cặp tệp CV. */
const EMPLOYEE_PAIRS: PairGrant[] = [["access", "recruit", "Company", false]];

/** `company-admin` — 6 cặp foundation-file + đủ cặp candidate để dựng fixture qua API thật. */
const ADMIN_PAIRS: PairGrant[] = [
  ["access", "recruit", "Company", false],
  ...CANDIDATE_PAIRS.map(([a, sens]) => [a, "candidate", "Company", sens] as PairGrant),
  ["view", "job-opening", "Company", false],
  ["create", "job-opening", "Company", false],
  ["update", "job-opening", "Company", false],
  ...FOUNDATION_FILE_ACTIONS.map((a) => [a, "foundation-file", "Company", false] as PairGrant),
];

const UPLOAD_BODY = {
  originalName: "cv-ung-vien.pdf",
  declaredMimeType: "application/pdf",
  sizeBytes: 2048,
};

interface Ctx {
  app: INestApplication;
  direct: Pool;
}

describe.skipIf(!hasLaneDb)("S14-RECRUIT-FILEGRANT-1 — tệp CV qua bề mặt RECRUIT", () => {
  const ctx = {} as Ctx;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uRecruiter = "";
  let uRecruiter2 = "";
  let uHr = "";
  let uEmployee = "";
  let uAdmin = "";
  let uOwnScope = "";
  let uWildcard = "";
  let uB = "";

  let tRecruiter = "";
  let tRecruiter2 = "";
  let tHr = "";
  let tEmployee = "";
  let tAdmin = "";
  let tOwnScope = "";
  let tWildcard = "";
  let tB = "";

  let candidateId = "";
  let candidateId2 = "";
  let candidateB = "";

  const direct = (): Pool => ctx.direct;
  const http = () => request(ctx.app.getHttpServer());
  const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct(), companyId, `s14fg-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct(), action, resource, sensitive);
      await seedRolePermission(direct(), roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct(), userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Ứng viên MỚI qua API THẬT (giữ FK/counter đúng đường). */
  async function createCandidate(token: string, label: string, orgUnitId: string): Promise<string> {
    const job = await authPost(token, "/job-openings").send({ title: `Job ${label}`, orgUnitId });
    expect(job.status, JSON.stringify(job.body)).toBe(201);
    const cand = await authPost(token, "/candidates").send({
      jobOpeningId: job.body.data.id,
      fullName: `Ung vien ${label}`,
    });
    expect(cand.status, JSON.stringify(cand.body)).toBe(201);
    return cand.body.data.id as string;
  }

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct().query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  /** Thay cho leg "client PUT bytes" — chỉ đổi `upload_status`, KHÔNG đụng `owner_user_id`. */
  async function fakePutBytes(fileId: string): Promise<void> {
    await direct().query(`UPDATE files SET upload_status = 'Uploaded' WHERE id = $1`, [fileId]);
  }

  /** 035 — đăng ký tệp qua bề mặt RECRUIT. Trả `fileId`. */
  async function registerFile(token: string, cand: string, body = UPLOAD_BODY): Promise<string> {
    const res = await authPost(token, `/candidates/${cand}/files/upload-url`).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.fileId as string;
  }

  /** 035 → PUT giả → 036: tệp sẵn sàng để GẮN, chưa gắn. */
  async function uploadAndConfirm(token: string, cand: string): Promise<string> {
    const fileId = await registerFile(token, cand);
    await fakePutBytes(fileId);
    const confirmed = await authPost(token, `/candidates/${cand}/files/${fileId}/confirm`).send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    return fileId;
  }

  /** Chuỗi ĐẦY ĐỦ 035→036→037. Trả `fileId` đã gắn sống vào `cand`. */
  async function uploadConfirmLink(token: string, cand: string): Promise<string> {
    const fileId = await uploadAndConfirm(token, cand);
    const linked = await authPost(token, `/candidates/${cand}/files/${fileId}/link`).send({});
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    return fileId;
  }

  async function countAccessLogs(fileId: string): Promise<number> {
    const r = await direct().query(
      `SELECT count(*)::int AS n FROM file_access_logs WHERE file_id = $1 AND action = 'Download'`,
      [fileId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ctx.app = moduleRef.createNestApplication();
    ctx.app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    ctx.app.useGlobalFilters(new AllExceptionsFilter());
    await ctx.app.init();

    ctx.direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(ctx.direct, "s14fga");
    B = await seedCompany(ctx.direct, "s14fgb");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(ctx.direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uRecruiter = await mk("recruiter");
    uRecruiter2 = await mk("recruiter2");
    uHr = await mk("hr");
    uEmployee = await mk("employee");
    uAdmin = await mk("admin");
    uOwnScope = await mk("ownscope");
    uWildcard = await mk("wildcard");
    uB = await seedUser(ctx.direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grant(A.companyId, uRecruiter, "recruiter", RECRUITER_PAIRS);
    await grant(A.companyId, uRecruiter2, "recruiter2", RECRUITER_PAIRS);
    await grant(A.companyId, uHr, "hr", HR_PAIRS);
    await grant(A.companyId, uEmployee, "employee", EMPLOYEE_PAIRS);
    await grant(A.companyId, uAdmin, "admin", ADMIN_PAIRS);
    // G1 — CÙNG cặp GHI nhưng scope Own: sàn scope Company phải TỪ CHỐI, không "coi như" Company.
    await grant(A.companyId, uOwnScope, "ownscope", [
      ["access", "recruit", "Company", false],
      ["view", "candidate", "Company", true],
      [CV_UPLOAD[0], CV_UPLOAD[1], "Own", true],
    ]);
    // Chủ thể `*:*` — cặp wildcard THẬT trong catalog (0435). Cặp sensitive KHÔNG kế thừa từ nó.
    await grant(A.companyId, uWildcard, "wildcard", [["*", "*", "Company", false]]);
    await grant(B.companyId, uB, "b", RECRUITER_PAIRS);

    tRecruiter = await login(A.slug, `recruiter@${A.slug}.test`);
    tRecruiter2 = await login(A.slug, `recruiter2@${A.slug}.test`);
    tHr = await login(A.slug, `hr@${A.slug}.test`);
    tEmployee = await login(A.slug, `employee@${A.slug}.test`);
    tAdmin = await login(A.slug, `admin@${A.slug}.test`);
    tOwnScope = await login(A.slug, `ownscope@${A.slug}.test`);
    tWildcard = await login(A.slug, `wildcard@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);

    const orgA = await seedOrgUnit(A.companyId, "Engineering S14FG");
    const orgB = await seedOrgUnit(B.companyId, "Engineering S14FG B");
    candidateId = await createCandidate(tRecruiter, "A1", orgA);
    candidateId2 = await createCandidate(tRecruiter, "A2", orgA);
    candidateB = await createCandidate(tB, "B1", orgB);
  }, 240_000);

  afterAll(async () => {
    await cleanupTenants(ctx.direct, companyIds);
    await ctx.direct.end();
    await ctx.app.close();
  });

  // ── A. Cặp quyền gác cả 5 route ─────────────────────────────────────────────

  it("A1: `employee` (0 cặp candidate, 0 cặp tệp CV) → cả 5 route ⇒ 403", async () => {
    const ghost = randomUUID();
    const results = [
      await authGet(tEmployee, `/candidates/${candidateId}/files`),
      await authGet(tEmployee, `/candidates/${candidateId}/files/${ghost}/download-url`),
      await authPost(tEmployee, `/candidates/${candidateId}/files/upload-url`).send(UPLOAD_BODY),
      await authPost(tEmployee, `/candidates/${candidateId}/files/${ghost}/confirm`).send({}),
      await authPost(tEmployee, `/candidates/${candidateId}/files/${ghost}/link`).send({}),
    ];
    for (const res of results) {
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
  });

  it("A2 (ALLOW đối chứng): `recruiter` đi TRỌN chuỗi 035→036→037→033→034 ⇒ 200/200/201/200/200", async () => {
    // Thứ tự CÓ Ý NGHĨA: `download-url` chỉ 200 khi tệp ĐÃ có link sống — chạy nó trước bước link là
    // đỏ-giả. Chuỗi ở đây đúng thứ tự người dùng thật đi.
    const upload = await authPost(tRecruiter, `/candidates/${candidateId}/files/upload-url`).send(
      UPLOAD_BODY,
    );
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
    const fileId = upload.body.data.fileId as string;
    // BẤT BIẾN #2.3 — response đăng ký KHÔNG mang storage_path/checksum ra ngoài.
    expect(Object.keys(upload.body.data).sort()).toEqual([
      "expiresAt",
      "fileId",
      "uploadStatus",
      "uploadUrl",
    ]);

    await fakePutBytes(fileId);
    const confirm = await authPost(
      tRecruiter,
      `/candidates/${candidateId}/files/${fileId}/confirm`,
    ).send({});
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    const link = await authPost(tRecruiter, `/candidates/${candidateId}/files/${fileId}/link`).send(
      {},
    );
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.data.fileId).toBe(fileId);
    expect(link.body.data.purpose).toBe("CV");

    const list = await authGet(tRecruiter, `/candidates/${candidateId}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(Array.isArray(list.body.data), "033 trả MẢNG TRẦN, không phong bì phân trang").toBe(
      true,
    );
    expect((list.body.data as { fileId: string }[]).map((f) => f.fileId)).toContain(fileId);

    const dl = await authGet(tRecruiter, `/candidates/${candidateId}/files/${fileId}/download-url`);
    expect(dl.status, JSON.stringify(dl.body)).toBe(200);
    expect(typeof dl.body.data.url).toBe("string");
  });

  it("[crown] A3: chủ thể chỉ có `('*','*')` ⇒ cả 5 route 403 — cặp SENSITIVE không kế thừa từ wildcard", async () => {
    // Đúng lớp lỗ mà `S14-SEC-DASHGATE-WILDCARD-1` vừa vá ở DASH. Ở đây decorator route KHÔNG khai
    // `isSensitive` (đồng nhất 32 route RECRUIT cũ), nên vế chặn là TẦNG 2: `resolveActor` hỏi
    // `resolveManyOrNull` với `isSensitive` lấy TỪ BẢNG `RECRUIT_ROUTE_PAIRS`. Ca A3b ngay dưới chứng
    // minh grant wildcard là THẬT chứ không phải "seed hỏng nên cái gì cũng 403".
    const ghost = randomUUID();
    const results = [
      await authGet(tWildcard, `/candidates/${candidateId}/files`),
      await authGet(tWildcard, `/candidates/${candidateId}/files/${ghost}/download-url`),
      await authPost(tWildcard, `/candidates/${candidateId}/files/upload-url`).send(UPLOAD_BODY),
      await authPost(tWildcard, `/candidates/${candidateId}/files/${ghost}/confirm`).send({}),
      await authPost(tWildcard, `/candidates/${candidateId}/files/${ghost}/link`).send({}),
    ];
    for (const res of results) {
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
  });

  it("A3b (đối chứng A3): CÙNG chủ thể `*:*` mở được route RECRUIT non-sensitive ⇒ grant wildcard là THẬT", async () => {
    const res = await authGet(tWildcard, "/job-openings");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("B1: `hr` (KHÔNG create/update:candidate) vẫn đi được ĐỦ 5 route — owner chốt 'hr = đủ như recruiter'", async () => {
    const fileId = await uploadConfirmLink(tHr, candidateId);
    const list = await authGet(tHr, `/candidates/${candidateId}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const dl = await authGet(tHr, `/candidates/${candidateId}/files/${fileId}/download-url`);
    expect(dl.status, JSON.stringify(dl.body)).toBe(200);
  });

  // ── L. Năm vế của canLinkFile qua HTTP thật ─────────────────────────────────

  it("L4 (ALLOW đối chứng cho L1-L3): gắn tệp vừa upload+confirm qua CHÍNH wrapper ⇒ 201", async () => {
    const fileId = await uploadAndConfirm(tRecruiter, candidateId);
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/${fileId}/link`).send(
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("[crown] L1: gắn tệp KHÔNG do mình upload ⇒ 403 (vế 2 — owner-check)", async () => {
    // `recruiter2` có ĐẦY ĐỦ cặp GHI, nên 403 ở đây CHỈ có thể đến từ owner-check.
    const fileId = await uploadAndConfirm(tRecruiter2, candidateId);
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/${fileId}/link`).send(
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("[crown] L2: gắn tệp ĐÃ TỪNG link rồi bị GỠ ⇒ 403 (vế 5 — chống bypass thu hồi)", async () => {
    const fileId = await uploadConfirmLink(tRecruiter, candidateId);
    // Thu hồi = gỡ link. Làm qua direct pool vì RECRUIT cố ý KHÔNG có route gỡ (plan §9 KI-c); điều
    // đang đo là TRẠNG THÁI "đã từng link rồi hết link sống", không phải đường gỡ.
    await direct().query(`UPDATE file_links SET deleted_at = now() WHERE file_id = $1`, [fileId]);
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/${fileId}/link`).send(
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);

    // Và tệp vẫn KHÔNG tải được — thu hồi giữ nguyên hiệu lực (`deny-links-revoked`).
    const dl = await authGet(tRecruiter, `/candidates/${candidateId}/files/${fileId}/download-url`);
    expect(dl.status, JSON.stringify(dl.body)).toBe(404);
  });

  it("L3: gắn tệp còn `upload_status='Pending'` ⇒ 403 (vế 3)", async () => {
    const fileId = await registerFile(tRecruiter, candidateId);
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/${fileId}/link`).send(
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("[crown] W2: `company-admin` (giữ link:foundation-file) gắn tệp NGƯỜI KHÁC vào ứng viên qua route generic ⇒ 403", async () => {
    // WO này SIẾT company-admin: trước đây 5 vế chưa tồn tại nên họ gắn được tệp bất kỳ. Không có ca
    // này thì lỗ bị đóng đinh ở trạng thái MỞ (`tests-can-pin-a-hole-open`).
    const foreignFile = await uploadAndConfirm(tRecruiter, candidateId);
    const res = await authPost(tAdmin, `/foundation/files/${foreignFile}/links`).send({
      fileId: foreignFile,
      moduleCode: "RECRUIT",
      entityType: "candidate",
      entityId: candidateId,
      linkType: "Document",
      accessScope: "Company",
      isPrimary: false,
      purpose: "CV",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── C. KHÔNG NỚI bề mặt foundation-file ─────────────────────────────────────

  it("[crown] C1: `recruiter` và `hr` vẫn 403 trên 4 route /foundation/files* — WO KHÔNG cấp cặp foundation-file", async () => {
    const ghost = randomUUID();
    for (const [label, token] of [
      ["recruiter", tRecruiter],
      ["hr", tHr],
    ] as const) {
      const results: [string, request.Response][] = [
        [`${label} list`, await authGet(token, "/foundation/files?page=1&limit=10")],
        [`${label} upload`, await authPost(token, "/foundation/files/upload").send(UPLOAD_BODY)],
        [`${label} metadata`, await authGet(token, `/foundation/files/${ghost}`)],
        [`${label} download`, await authGet(token, `/foundation/files/${ghost}/download-url`)],
      ];
      for (const [what, res] of results) {
        expect(res.status, `${what} | ${JSON.stringify(res.body)}`).toBe(403);
      }
    }
  });

  it("C2 (ALLOW đối chứng C1): `company-admin` vẫn dùng được 4 route đó (WO không SIẾT bề mặt chung)", async () => {
    const list = await authGet(tAdmin, "/foundation/files?page=1&limit=10");
    expect(list.status, JSON.stringify(list.body)).toBe(200);

    const up = await authPost(tAdmin, "/foundation/files/upload").send(UPLOAD_BODY);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const adminFile = up.body.data.fileId as string;
    await fakePutBytes(adminFile);

    const meta = await authGet(tAdmin, `/foundation/files/${adminFile}`);
    expect(meta.status, JSON.stringify(meta.body)).toBe(200);

    const dl = await authGet(tAdmin, `/foundation/files/${adminFile}/download-url`);
    expect(dl.status, JSON.stringify(dl.body)).toBe(200);
  });

  // ── N/D/E. Ứng viên, tenant, IDOR ───────────────────────────────────────────

  it("N1: ứng viên KHÔNG tồn tại (cùng tenant) ⇒ 404 ở CẢ list lẫn download-url", async () => {
    // Thiếu vế kiểm ứng viên thì list trả `[]` 200 còn download trả 404 — hai route lệch nhau.
    const ghostCand = randomUUID();
    const list = await authGet(tRecruiter, `/candidates/${ghostCand}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(404);
    const dl = await authGet(
      tRecruiter,
      `/candidates/${ghostCand}/files/${randomUUID()}/download-url`,
    );
    expect(dl.status, JSON.stringify(dl.body)).toBe(404);
  });

  it("N1b: ứng viên không tồn tại ⇒ upload-url cũng 404 (không cấp presign trỏ vào hư vô)", async () => {
    const res = await authPost(tRecruiter, `/candidates/${randomUUID()}/files/upload-url`).send(
      UPLOAD_BODY,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("D1: XUYÊN TENANT — người công ty A thao tác trên ứng viên công ty B ⇒ 404 (RLS 0 hàng)", async () => {
    const list = await authGet(tRecruiter, `/candidates/${candidateB}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(404);
    const up = await authPost(tRecruiter, `/candidates/${candidateB}/files/upload-url`).send(
      UPLOAD_BODY,
    );
    expect(up.status, JSON.stringify(up.body)).toBe(404);
  });

  it("D2 (ALLOW đối chứng D1): chính chủ công ty B liệt kê ứng viên của mình ⇒ 200", async () => {
    const list = await authGet(tB, `/candidates/${candidateB}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });

  it("[crown] E1: IDOR — tệp gắn vào ứng viên X, tải qua URL của ứng viên Y ⇒ 404", async () => {
    const fileId = await uploadConfirmLink(tRecruiter, candidateId);
    const res = await authGet(
      tRecruiter,
      `/candidates/${candidateId2}/files/${fileId}/download-url`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("E2 (ALLOW đối chứng E1) + H1: tải qua ĐÚNG ứng viên ⇒ 200 và `file_access_logs` +1 access_granted", async () => {
    const fileId = await uploadConfirmLink(tRecruiter, candidateId);
    const before = await countAccessLogs(fileId);
    const res = await authGet(
      tRecruiter,
      `/candidates/${candidateId}/files/${fileId}/download-url`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await countAccessLogs(fileId);
    // Đếm DELTA, không đếm tuyệt đối — suite chạy song song với worker khác trên cùng lane DB.
    expect(after - before, "tải CV phải để lại đúng MỘT vết Download").toBe(1);
    const granted = await direct().query(
      `SELECT access_granted FROM file_access_logs
       WHERE file_id = $1 AND action = 'Download' ORDER BY created_at DESC LIMIT 1`,
      [fileId],
    );
    expect(granted.rows[0].access_granted).toBe(true);
  });

  // ── F. Owner-check ở confirm ────────────────────────────────────────────────

  it("F1: confirm tệp NGƯỜI KHÁC đăng ký ⇒ 403, và tệp KHÔNG đổi trạng thái", async () => {
    // `recruiter2` có ĐỦ cặp GHI ⇒ 403 ở đây chỉ có thể đến từ owner-check, không phải cặp quyền.
    const fileId = await registerFile(tRecruiter, candidateId);
    const res = await authPost(
      tRecruiter2,
      `/candidates/${candidateId}/files/${fileId}/confirm`,
    ).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const row = await direct().query(`SELECT upload_status FROM files WHERE id = $1`, [fileId]);
    expect(row.rows[0].upload_status).toBe("Pending");
  });

  it("F2 (ALLOW đối chứng F1): chính chủ confirm ⇒ 200", async () => {
    const fileId = await registerFile(tRecruiter, candidateId);
    await fakePutBytes(fileId);
    const res = await authPost(
      tRecruiter,
      `/candidates/${candidateId}/files/${fileId}/confirm`,
    ).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  // ── G. Sàn scope Company ────────────────────────────────────────────────────

  it("G1: giữ `upload:candidate-file` nhưng scope Own ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
    const res = await authPost(tOwnScope, `/candidates/${candidateId}/files/upload-url`).send(
      UPLOAD_BODY,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error?.message, JSON.stringify(res.body)).toContain("AUTH-ERR-SCOPE-DENIED");
  });

  it("G2 (ALLOW đối chứng G1): CÙNG cặp ở scope Company ⇒ 200", async () => {
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/upload-url`).send(
      UPLOAD_BODY,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  // ── Biên ────────────────────────────────────────────────────────────────────

  it("param rác ⇒ 400 (ParseUUIDPipe), KHÔNG phải 500 vô danh từ `22P02`", async () => {
    const res = await authGet(tRecruiter, "/candidates/khong-phai-uuid/files");
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("body khai `visibility`/`entityId` ⇒ 400 tại biên (.strict) — client không đặt được cả hai", async () => {
    const res = await authPost(tRecruiter, `/candidates/${candidateId}/files/upload-url`).send({
      ...UPLOAD_BODY,
      visibility: "Public",
      entityId: candidateId2,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  // ── K. /auth/me surface cặp mới (lớp lỗi CAP-2, đã lặp 12+ lần) ─────────────

  it("[crown] K1: `/auth/me` TRẢ `upload:candidate-file` cho recruiter/hr — thiếu allowlist ⇒ nút ẨN với chính họ", async () => {
    // `getCapabilities()` lọc bỏ TOÀN BỘ cặp is_sensitive; chỉ cặp trong SENSITIVE_CAPABILITY_ALLOWLIST
    // mới được surface. Quên APPEND ⇒ FE `useCanExact('upload','candidate-file')` LUÔN false ⇒ nút
    // "Tải CV lên" ẩn với đúng vai vừa được cấp quyền — im lặng, không lỗi, không log.
    for (const [label, token] of [
      ["recruiter", tRecruiter],
      ["hr", tHr],
    ] as const) {
      const res = await authGet(token, "/auth/me");
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
      const caps = res.body.data.capabilities as Record<string, boolean>;
      expect(caps["upload:candidate-file"], `${label} thiếu cặp GHI tệp CV`).toBe(true);
      expect(caps["view:candidate"], `${label} thiếu cặp ĐỌC ứng viên`).toBe(true);
    }
  });

  it("K2 (đối chứng K1): `employee` KHÔNG có cặp nào trong hai cặp đó — allowlist không nới quyền", async () => {
    const res = await authGet(tEmployee, "/auth/me");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const caps = res.body.data.capabilities as Record<string, boolean>;
    expect(caps["upload:candidate-file"] ?? false).toBe(false);
    expect(caps["view:candidate"] ?? false).toBe(false);
  });

  // ── Z. Census bất biến (chống nới quyền âm thầm) ────────────────────────────

  describe("Z. census — WO KHÔNG nới `foundation-file` và cặp mới GIỮ cờ sensitive", () => {
    it("Z1: tập role có grant `foundation-file` (4 hình dạng, mọi role) KHÔNG chứa recruiter/hr", async () => {
      const r = await direct().query<{ role_name: string }>(
        `SELECT DISTINCT r.name AS role_name
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL
            AND r.name <> 'super-admin'
            AND rp.effect = 'ALLOW'
            AND p.action IN ('upload','view','download','link','unlink','delete','*')
            AND p.resource_type IN ('foundation-file','*')`,
      );
      const names = r.rows.map((x) => x.role_name);
      // Phát biểu theo TẬP, KHÔNG theo SỐ: con số phụ thuộc DB (dump PROD có 2 role tuỳ biến tenant,
      // lane sạch không có) — ratchet theo số sẽ đỏ oan trên một trong hai.
      expect(names.filter((n) => n.includes("recruiter") || n === "hr")).toEqual([]);
    });

    it("Z2: `object_permissions` chạm `foundation-file`/`*` = 0 hàng", async () => {
      const r = await direct().query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM object_permissions op
           JOIN permissions p ON p.id = op.permission_id
          WHERE p.resource_type IN ('foundation-file','*')`,
      );
      expect(r.rows[0].n).toBe(0);
    });

    it("Z3: tự kiểm — 5 route mới đều tồn tại và đều KHÔNG mở cho `employee` (chống vòng lặp rỗng)", async () => {
      const ghost = randomUUID();
      const probes: Array<Promise<request.Response>> = [
        authGet(tEmployee, `/candidates/${candidateId}/files`),
        authGet(tEmployee, `/candidates/${candidateId}/files/${ghost}/download-url`),
        authPost(tEmployee, `/candidates/${candidateId}/files/upload-url`).send(UPLOAD_BODY),
        authPost(tEmployee, `/candidates/${candidateId}/files/${ghost}/confirm`).send({}),
        authPost(tEmployee, `/candidates/${candidateId}/files/${ghost}/link`).send({}),
      ];
      const statuses = (await Promise.all(probes)).map((r) => r.status);
      expect(statuses.length, "phải đo ĐÚNG 5 route").toBe(5);
      // 404 ở đây nghĩa là route KHÔNG tồn tại ⇒ mọi ca deny phía trên xanh vì lý do sai.
      expect(
        statuses.filter((s) => s === 404),
        "route mới phải TỒN TẠI",
      ).toEqual([]);
      expect(statuses).toEqual([403, 403, 403, 403, 403]);
    });

    it("[crown] Z4: catalog — `('upload','candidate-file').is_sensitive = TRUE, kèm đối chứng non-sensitive", async () => {
      // E4 của S12 neo `resource_type='candidate'` nên MÙ với cặp mới; `sensitive-screen-gate-allowlist`
      // chỉ so hai mảng trong code, không đọc DB; guard của 0569 chỉ chạy lúc migrate. Không có ca này
      // thì một `UPDATE permissions SET is_sensitive=false` ở WO sau làm 0 test đỏ, và `*:*` mở được
      // đường GHI tệp CV — đúng lớp lỗ `S14-SEC-DASHGATE-WILDCARD-1` vừa vá.
      const r = await direct().query<{
        action: string;
        resource_type: string;
        is_sensitive: boolean;
      }>(
        `SELECT action, resource_type, is_sensitive FROM permissions
          WHERE (action, resource_type) IN (('upload','candidate-file'), ('view','job-opening'))`,
      );
      const byPair = new Map(r.rows.map((x) => [`${x.action}:${x.resource_type}`, x.is_sensitive]));
      expect(byPair.get("upload:candidate-file"), "cặp GHI tệp CV phải sensitive").toBe(true);
      // Đối chứng: một cặp RECRUIT non-sensitive vẫn false ⇒ ca trên không phải "assert mọi thứ true".
      expect(byPair.get("view:job-opening"), "cặp non-sensitive phải vẫn false").toBe(false);
    });
  });
});
