/**
 * S16-SOCIAL-FILEDISPOSITION-1 — kiểu nội dung mà storage PHỤC VỤ phải gắn với MIME đã đăng ký.
 * Integration trên Postgres THẬT (DB lane cô lập) + object storage THẬT (bucket thử chốt theo TÊN).
 *
 * Ca theo plan `docs/plans/S16-SOCIAL-FILEDISPOSITION-1.md` §4 — mỗi ca TỪ CHỐI đứng cạnh ca CHO PHÉP:
 *   S1  PUT với Content-Type khác kiểu đã đăng ký ⇒ storage từ chối, object không được ghi ⇄ đúng kiểu ⇒ 200.
 *   S2  PUT không có Content-Type ⇒ storage từ chối (400/403), object không được ghi ⇄ (cặp với S1).
 *   S3  (ca NỀN) sau PUT đúng: HEAD trả ĐÚNG chuỗi đã gửi; confirm ⇒ Uploaded.
 *   S4  object ở storage mang kiểu khác MIME đã đăng ký (hàng Pending) ⇒ confirm 409, hàng Failed kèm
 *       lý do ⇄ object đúng kiểu ⇒ Uploaded.
 *   S5  object LƯU kiểu khác, hàng đăng ký `application/pdf` ⇒ URL tải trả đúng `application/pdf` +
 *       `attachment` ⇄ hàng `image/png` ⇒ `image/png` + `inline`.
 *   S6  đổi `response-content-type` trên URL đã ký ⇒ 403 ⇄ URL nguyên ⇒ 200 (+ đo `x-content-type-options`).
 *   S9  lượt PUT gửi kèm một header `Content-Disposition` KHÔNG nằm trong chữ ký: storage nhận ⇒ URL tải
 *       vẫn trả disposition do SERVER quyết định (hàng `image/png` ⇒ `inline` ⇄ hàng `application/pdf`
 *       ⇒ `attachment`); storage từ chối lượt PUT ⇒ không có object. Ca ĐO: in mã PUT + hai header GET.
 *   S7  đăng ký một kiểu trình duyệt tự dựng khi công ty ĐÃ mở allowlist cho nó ⇒ 415 `…-MIME`, 0 hàng
 *       mới ⇄ `application/pdf` · docx ⇒ 201.
 *   S8  cùng thân S7 qua cửa đăng ký của SOCIAL (054) và của CHAT ⇒ 415 ⇄ `application/pdf` ⇒ 200.
 *
 * HAI CỔNG (plan D12 — `test/helpers/storage-test-target.ts`):
 *   1. Cả file chạy khi `hasDb && LANE_DB` (job CI không có `LANE_DB`/`S3_*` ⇒ SKIP cả file, không đỏ).
 *   2. S1–S6 chỉ chạm storage khi `S3_BUCKET` đã resolve BẰNG ĐÚNG tên cho phép (cục bộ
 *      `mediaos-fdisp-test`, CI `mediaos-test`). Không khớp: CI ⇒ ĐỎ; cục bộ ⇒ bỏ qua CÓ cảnh báo
 *      (`console.warn` nêu tên ca — không `ctx.skip()` im lặng). S7/S8 luôn chạy: chỉ ký ngoại tuyến.
 *      Cổng 2 CHỈ được đánh giá trong `beforeAll` — không ở top-level, không lúc import.
 *
 * ⚠️ Luồng của mỗi ca hợp lệ trên cả mã trước lẫn sau bản vá (cùng một file đỏ trước, xanh sau): ca
 *    nào cần «object lưu khác kiểu + hàng Uploaded» thì đi register → PUT đúng → confirm → RỒI mới ghi
 *    đè object; không dựa vào việc confirm cho qua một object lệch kiểu.
 * ⚠️ Dọn: chỉ xoá object/hàng do chính file này tạo (theo tiền tố công ty test). KHÔNG xoá bucket,
 *    KHÔNG đổi policy/CORS/lifecycle.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi, type TestContext } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { SettingService } from "../../src/foundation/settings/setting.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { FALLBACK_S3_SECRET } from "../helpers/fixture-secrets";
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
import { isCiEnv, resolveStorageTestTarget } from "../helpers/storage-test-target";

const LOGIN_PW = "Passw0rd!fdisp16";
// Cổng 1 (D12) — cùng hình với các int-spec storage có sẵn. Cổng 2 nằm trong `beforeAll`.
const runDb = hasDb && Boolean(process.env.LANE_DB);

const TAG = "[fdisp-storage]";
const PDF = "application/pdf";
const PNG = "image/png";
const PLAIN = "text/plain";
const HTML = "text/html";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWLIST_KEY = "file.allowed_mime_types";
const ERR_MIME = "FOUNDATION-FILE-ERR-MIME";
const ERR_CONFIRM_MISMATCH = "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH";
/** Tên KHÔNG đuôi: phép đối chiếu đuôi↔MIME không tham gia ⇒ thứ duy nhất khác nhau giữa các ca S7/S8 là MIME. */
const NO_EXT_NAME = "tep-khong-duoi";
/** Chỉ dùng để KÝ NGOẠI TUYẾN khi máy không cấu hình storage — không bao giờ được gọi tới. */
const OFFLINE_SIGN_ONLY_BUCKET = "fdisp-offline-sign-only";

const FOUNDATION_PAIRS = [
  ["upload", "foundation-file"],
  ["view", "foundation-file"],
  ["download", "foundation-file"],
] as const;
/** Người dùng của cửa SOCIAL + CHAT — KHÔNG có cặp `*:foundation-file` nào. */
const MEMBER_PAIRS = [
  ["view", "feed"],
  ["create", "feed-post"],
  ["access", "chat"],
  ["view", "chat-room"],
  ["send", "chat-message"],
] as const;

/** Hai cửa đăng ký tệp của module — cùng đổ về `FileService.upload`. */
const MODULE_DOORS = [
  { door: "SOCIAL 054", path: "/social/files/upload-url", extra: { target: "post" } },
  { door: "CHAT", path: "/chat/files/upload-url", extra: {} },
] as const;

type StorageState = { run: true; bucket: string; s3: S3Client } | { run: false; reason: string };

interface HeadResult {
  contentType: string | null;
  contentDisposition: string | null;
  sizeBytes: number | null;
}

/** Header `Content-Disposition` gửi kèm lượt PUT ở S9 — KHÔNG nằm trong chữ ký của URL. */
const UNSIGNED_ATTACHMENT_DISPOSITION = 'attachment; filename="khac.bin"';
const UNSIGNED_INLINE_DISPOSITION = "inline";

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

function errName(err: unknown): string {
  return (err as { name?: string }).name ?? "UnknownError";
}

function describeHead(head: HeadResult | null): string {
  return head === null
    ? "KHÔNG có object"
    : `có object · ContentType="${head.contentType ?? "(không có)"}" · ${head.sizeBytes ?? "?"} byte`;
}

function payload(label: string): Uint8Array {
  return new Uint8Array(Buffer.from(`fdisp-${label}-${randomUUID()}`, "utf8"));
}

describe.skipIf(!runDb)("S16-SOCIAL-FILEDISPOSITION-1 — kiểu nội dung storage phục vụ", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let uploaderToken = "";
  let memberToken = "";
  let storage: StorageState = { run: false, reason: "beforeAll chưa chạy" };
  const companyIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const authPost = (token: string, url: string) =>
    http().post(url).set("Authorization", `Bearer ${token}`);

  // ── dựng người dùng ────────────────────────────────────────────────────────────
  async function makeUser(
    label: string,
    hash: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): Promise<string> {
    const email = `${label}-${randomUUID().slice(0, 8)}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3)`,
      [A.companyId, userId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(
      direct,
      A.companyId,
      `fdisp-${label}-${randomUUID().slice(0, 8)}`,
    );
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  // ── cổng 2: bucket ─────────────────────────────────────────────────────────────
  /** Đã qua chốt TÊN ⇒ dò bucket (có ký). Lỗi khác «không tồn tại» ⇒ ném ở MỌI môi trường. */
  async function openTestBucket(bucket: string): Promise<StorageState> {
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      console.log(`${TAG} bucket "${bucket}": ĐÃ TỒN TẠI — ca storage thật CHẠY.`);
      return { run: true, bucket, s3 };
    } catch (err) {
      if (!isNotFound(err)) {
        throw new Error(
          `${TAG} HeadBucket "${bucket}" lỗi ${errName(err)} — không phải «không tồn tại».`,
        );
      }
    }
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`${TAG} bucket "${bucket}": VỪA ĐƯỢC TẠO — ca storage thật CHẠY.`);
      return { run: true, bucket, s3 };
    } catch (err) {
      const reason = `tạo bucket "${bucket}" LỖI (${errName(err)})`;
      if (isCiEnv(process.env)) throw new Error(`${TAG} ${reason} — ở CI đây là ĐỎ.`);
      return { run: false, reason: `${reason} ⇒ coi như không có storage thử (O2 = B)` };
    }
  }

  function live(): { bucket: string; s3: S3Client } {
    if (!storage.run) throw new Error(`${TAG} gọi storage khi cổng bucket đang đóng.`);
    return storage;
  }

  /** Bỏ qua CÓ cảnh báo — không bao giờ im lặng (D12). */
  function skipStorageCase(ctx: Pick<TestContext, "skip">, caseName: string): void {
    const why = storage.run ? "" : storage.reason;
    console.warn(`${TAG} BỎ QUA ca storage thật «${caseName}»: ${why}`);
    ctx.skip();
  }

  // ── thao tác storage trực tiếp (cấy / HEAD) — chỉ trên bucket đã chốt ───────────
  async function headObject(key: string): Promise<HeadResult | null> {
    const { bucket, s3 } = live();
    try {
      const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentType: r.ContentType ?? null,
        contentDisposition: r.ContentDisposition ?? null,
        sizeBytes: typeof r.ContentLength === "number" ? r.ContentLength : null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function plantObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { bucket, s3 } = live();
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  // ── đường HTTP thật ────────────────────────────────────────────────────────────
  function register(body: { originalName: string; declaredMimeType: string; sizeBytes: number }) {
    return authPost(uploaderToken, "/foundation/files/upload").send({
      ...body,
      visibility: "Private",
    });
  }

  async function fileRow(fileId: string): Promise<Record<string, unknown> | undefined> {
    const r = await direct.query(
      `SELECT upload_status, metadata, checksum_sha256, storage_path, mime_type FROM files WHERE id = $1`,
      [fileId],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  }

  async function countFiles(): Promise<number> {
    const r = await direct.query(`SELECT count(*)::int AS n FROM files WHERE company_id = $1`, [
      A.companyId,
    ]);
    return r.rows[0].n as number;
  }

  /** Đăng ký hợp lệ ⇒ `{fileId, uploadUrl, key}` (key đọc từ DB — response không mang storage_path). */
  async function registerOk(
    mime: string,
    name: string,
    sizeBytes: number,
  ): Promise<{ fileId: string; uploadUrl: string; key: string }> {
    const res = await register({ originalName: name, declaredMimeType: mime, sizeBytes });
    expect(res.status, `register ${name}: ${JSON.stringify(res.body)}`).toBe(201);
    const fileId = res.body.data.fileId as string;
    const row = await fileRow(fileId);
    return {
      fileId,
      uploadUrl: res.body.data.uploadUrl as string,
      key: row?.storage_path as string,
    };
  }

  /**
   * PUT lên URL đã ký. `contentType === undefined` ⇒ KHÔNG gửi header (body `Uint8Array` ⇒ fetch không tự gắn).
   * `unsignedHeaders`: header gửi THÊM, không nằm trong chữ ký của URL (S9).
   */
  async function putPresigned(
    uploadUrl: string,
    bytes: Uint8Array,
    contentType: string | undefined,
    unsignedHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        ...(contentType === undefined ? {} : { "Content-Type": contentType }),
        ...unsignedHeaders,
      },
      body: bytes,
    });
    return { status: res.status, body: await res.text() };
  }

  /**
   * S9 — đăng ký `mime`, PUT ĐÚNG kiểu kèm một `Content-Disposition` không ký. Storage nhận ⇒ confirm rồi
   * GET URL tải, trả hai header của phản hồi; storage từ chối ⇒ `served: null` (object phải vắng).
   */
  async function putWithUnsignedDisposition(
    mime: string,
    name: string,
    unsignedDisposition: string,
  ): Promise<{
    putStatus: number;
    stored: HeadResult | null;
    served: { contentType: string | null; disposition: string | null } | null;
  }> {
    const bytes = payload(name);
    const reg = await registerOk(mime, name, bytes.byteLength);
    const put = await putPresigned(reg.uploadUrl, bytes, mime, {
      "Content-Disposition": unsignedDisposition,
    });
    const stored = await headObject(reg.key);
    if (put.status < 200 || put.status >= 300)
      return { putStatus: put.status, stored, served: null };

    const confirmed = await confirm(reg.fileId);
    expect(confirmed.status, `confirm ${name}: ${JSON.stringify(confirmed.body)}`).toBe(200);
    const res = await fetch(await downloadUrl(reg.fileId));
    await res.arrayBuffer();
    expect(res.status).toBe(200);
    return {
      putStatus: put.status,
      stored,
      served: {
        contentType: res.headers.get("content-type"),
        disposition: res.headers.get("content-disposition"),
      },
    };
  }

  function confirm(fileId: string) {
    return authPost(uploaderToken, `/foundation/files/${fileId}/confirm`).send({});
  }

  /** register → PUT đúng kiểu → confirm ⇒ hàng `Uploaded` (luồng hợp lệ trên mọi phiên bản mã). */
  async function uploadConfirmed(
    mime: string,
    name: string,
    label: string,
  ): Promise<{ fileId: string; key: string; bytes: Uint8Array }> {
    const bytes = payload(label);
    const reg = await registerOk(mime, name, bytes.byteLength);
    const put = await putPresigned(reg.uploadUrl, bytes, mime);
    expect(put.status, `PUT đúng kiểu ${name}: ${put.body}`).toBe(200);
    const res = await confirm(reg.fileId);
    expect(res.status, `confirm ${name}: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.data.uploadStatus).toBe("Uploaded");
    return { fileId: reg.fileId, key: reg.key, bytes };
  }

  async function downloadUrl(fileId: string): Promise<string> {
    const res = await http()
      .get(`/foundation/files/${fileId}/download-url`)
      .set("Authorization", `Bearer ${uploaderToken}`);
    expect(res.status, `download-url: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.url as string;
  }

  /** Tiền điều kiện của S7/S8: allowlist công ty test ĐÃ mở cho `text/html` (nếu không, 415 đến sai lý do). */
  async function expectAllowlistOpen(): Promise<void> {
    const settings = app.get(SettingService, { strict: false });
    const [resolved] = await settings.resolveMany(A.companyId, [ALLOWLIST_KEY]);
    expect(resolved?.value).toContain(HTML);
    expect(resolved?.value).toContain(PDF);
  }

  beforeAll(async () => {
    // Cổng 2 — chốt trên TÊN bucket đã resolve (AppModule import tĩnh ⇒ env đã nạp xong), TRƯỚC mọi
    // fallback bên dưới và TRƯỚC khi `ObjectStorageService` đọc env trong constructor.
    const target = resolveStorageTestTarget(process.env);
    if (target.kind === "skip-file") {
      throw new Error(`${TAG} hai cổng lệch nhau: file đang chạy nhưng helper trả skip-file.`);
    }
    if (target.kind === "throw") throw new Error(`${TAG} ${target.reason}`);

    // Fallback CHỈ để ký ngoại tuyến cho S7/S8 trên máy không cấu hình storage (không gọi mạng).
    process.env.S3_ENDPOINT ??= "http://localhost:9000";
    process.env.S3_ACCESS_KEY ??= "mediaos";
    process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
    process.env.S3_BUCKET ??= OFFLINE_SIGN_ONLY_BUCKET;
    process.env.S3_FORCE_PATH_STYLE ??= "true";
    process.env.S3_REGION ??= "us-east-1";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Pipeline y hệt main.ts (lưới S16-TEST-PIPELINE-PARITY-1) — kể cả lớp validate DTO.
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "fdisp");
    companyIds.push(A.companyId);

    // Công ty test MỞ allowlist thêm `text/html` — thay bộ resolve setting (cùng mẫu với
    // `test/foundation/file-security.int-spec.ts`), chỉ cho ĐÚNG công ty này và ĐÚNG khoá này.
    const settings = app.get(SettingService, { strict: false });
    const realResolveMany = settings.resolveMany.bind(settings);
    vi.spyOn(settings, "resolveMany").mockImplementation(async (companyId, keys) => {
      const resolved = await realResolveMany(companyId, keys);
      if (companyId !== A.companyId) return resolved;
      return resolved.map((r) =>
        r.key === ALLOWLIST_KEY && Array.isArray(r.value)
          ? { ...r, value: [...(r.value as unknown[]), HTML] }
          : r,
      );
    });

    const hash = await new PasswordService().hash(LOGIN_PW);
    uploaderToken = await makeUser("uploader", hash, FOUNDATION_PAIRS);
    memberToken = await makeUser("member", hash, MEMBER_PAIRS);

    if (target.kind === "run") {
      storage = await openTestBucket(target.bucket);
    } else {
      storage = { run: false, reason: target.reason };
    }
    if (!storage.run) {
      console.warn(`${TAG} ca storage thật S1–S6 sẽ BỎ QUA: ${storage.reason}`);
    }
  }, 180_000);

  /** Dọn object do CHÍNH file này tạo: mọi khoá của công ty test (tiền tố `{companyId}/…`). */
  async function removeTestObjects(): Promise<void> {
    if (!storage.run || !direct || companyIds.length === 0) return;
    const { bucket, s3 } = storage;
    const r = await direct.query(`SELECT storage_path FROM files WHERE company_id = ANY($1)`, [
      companyIds,
    ]);
    for (const row of r.rows as Array<{ storage_path: string }>) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.storage_path }));
      } catch (err) {
        console.warn(
          `${TAG} dọn object thất bại (${errName(err)}) — object thử còn lại trong bucket.`,
        );
      }
    }
  }

  afterAll(async () => {
    vi.restoreAllMocks();
    // Dọn object có ném thì app + công ty thử VẪN được dọn; lỗi gốc vẫn nổi lên sau `finally`.
    try {
      await removeTestObjects();
    } finally {
      try {
        await app?.close();
      } finally {
        if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
        await direct?.end();
      }
    }
  });

  // ══════════════ S1–S3 · done_when[0] + nền của [1] — PUT lên URL đã ký ══════════════

  describe("S1–S3 — PUT lên URL đã ký", () => {
    it("S1 TỪ CHỐI — PUT với Content-Type khác kiểu đã đăng ký ⇒ 403 SignatureDoesNotMatch, object không được ghi", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S1 TỪ CHỐI");
      const bytes = payload("s1-deny");
      const reg = await registerOk(PDF, "s1-lech-kieu.pdf", bytes.byteLength);

      const put = await putPresigned(reg.uploadUrl, bytes, HTML);
      const head = await headObject(reg.key);
      console.log(
        `${TAG} S1 đăng ký "${PDF}", PUT "${HTML}": HTTP ${put.status} · HEAD sau đó: ${describeHead(head)}`,
      );

      expect(put.status).toBe(403);
      expect(put.body).toContain("SignatureDoesNotMatch");
      expect(head).toBeNull();
    });

    it("S1 CHO PHÉP — PUT đúng kiểu đã đăng ký ⇒ 200, object có mặt", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S1 CHO PHÉP");
      const bytes = payload("s1-allow");
      const reg = await registerOk(PDF, "s1-dung-kieu.pdf", bytes.byteLength);

      const put = await putPresigned(reg.uploadUrl, bytes, PDF);
      const head = await headObject(reg.key);
      console.log(
        `${TAG} S1 đăng ký "${PDF}", PUT "${PDF}": HTTP ${put.status} · ${describeHead(head)}`,
      );

      expect(put.status).toBe(200);
      expect(head).not.toBeNull();
    });

    it("S2 TỪ CHỐI — PUT không có Content-Type ⇒ 400 hoặc 403, object không được ghi", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S2 TỪ CHỐI");
      const bytes = payload("s2-deny");
      const reg = await registerOk(PDF, "s2-khong-kieu.pdf", bytes.byteLength);

      const put = await putPresigned(reg.uploadUrl, bytes, undefined);
      const head = await headObject(reg.key);
      console.log(
        `${TAG} S2 đăng ký "${PDF}", PUT KHÔNG Content-Type: HTTP ${put.status} · HEAD sau đó: ${describeHead(head)}`,
      );

      expect([400, 403]).toContain(put.status);
      expect(head).toBeNull();
    });

    for (const [mime, name] of [
      [PDF, "s3-nen.pdf"],
      [PLAIN, "s3-nen.txt"],
    ] as const) {
      it(`S3 NỀN — PUT đúng "${mime}": HEAD trả ĐÚNG chuỗi đã gửi; confirm ⇒ Uploaded`, async (ctx) => {
        if (!storage.run) return skipStorageCase(ctx, `S3 NỀN ${mime}`);
        const bytes = payload("s3-base");
        const reg = await registerOk(mime, name, bytes.byteLength);

        const put = await putPresigned(reg.uploadUrl, bytes, mime);
        expect(put.status).toBe(200);
        const head = await headObject(reg.key);
        console.log(`${TAG} S3 gửi "${mime}" · HEAD trả "${head?.contentType ?? "(không có)"}"`);

        expect(head?.contentType).toBe(mime);
        const res = await confirm(reg.fileId);
        expect(res.status).toBe(200);
        expect(res.body.data.uploadStatus).toBe("Uploaded");
      });
    }
  });

  // ══════════════ S4 · done_when[1] — confirm so kiểu đã lưu ══════════════

  describe("S4 — confirm so kiểu object đã lưu với MIME đã đăng ký", () => {
    it("S4 TỪ CHỐI — object lưu kiểu khác MIME đã đăng ký ⇒ 409 CONFIRM-MISMATCH, hàng Failed + lý do", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S4 TỪ CHỐI");
      const bytes = payload("s4-deny");
      const reg = await registerOk(PDF, "s4-luu-lech.pdf", bytes.byteLength);
      await plantObject(reg.key, bytes, HTML); // hàng còn Pending; object cùng cỡ, khác kiểu

      const res = await confirm(reg.fileId);
      console.log(
        `${TAG} S4 đăng ký "${PDF}", object lưu "${HTML}": confirm HTTP ${res.status} · code=${res.body?.error?.code ?? "(không có)"}`,
      );

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe(ERR_CONFIRM_MISMATCH);
      const row = await fileRow(reg.fileId);
      expect(row?.upload_status).toBe("Failed");
      expect((row?.metadata as { confirmFailure?: string } | null)?.confirmFailure).toBe(
        "content-type-mismatch",
      );
      expect(row?.checksum_sha256 ?? null).toBeNull();
    });

    it("S4 CHO PHÉP — object lưu đúng kiểu đã đăng ký ⇒ 200 Uploaded", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S4 CHO PHÉP");
      const bytes = payload("s4-allow");
      const reg = await registerOk(PDF, "s4-luu-dung.pdf", bytes.byteLength);
      await plantObject(reg.key, bytes, PDF);

      const res = await confirm(reg.fileId);

      expect(res.status).toBe(200);
      expect(res.body.data.uploadStatus).toBe("Uploaded");
      expect((await fileRow(reg.fileId))?.upload_status).toBe("Uploaded");
    });
  });

  // ══════════════ S5–S6 · done_when[2] — URL tải ép kiểu đã đăng ký ══════════════

  describe("S5–S6 — URL tải", () => {
    it("S5 TỪ CHỐI — object LƯU kiểu khác, hàng đăng ký application/pdf ⇒ trả application/pdf + attachment", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S5 TỪ CHỐI");
      const up = await uploadConfirmed(PDF, "s5-tai-lieu.pdf", "s5-deny");
      await plantObject(up.key, up.bytes, HTML); // hàng ĐÃ Uploaded; ghi đè cùng cỡ, khác kiểu

      const res = await fetch(await downloadUrl(up.fileId));
      await res.arrayBuffer();
      const contentType = res.headers.get("content-type");
      const disposition = res.headers.get("content-disposition");
      console.log(
        `${TAG} S5 hàng "${PDF}", object lưu "${HTML}": GET HTTP ${res.status} · content-type="${contentType ?? "(không có)"}" · content-disposition="${disposition ?? "(không có)"}"`,
      );

      expect(res.status).toBe(200);
      expect(contentType).toBe(PDF);
      expect(disposition ?? "").toMatch(/^attachment; filename=/);
    });

    it("S5 CHO PHÉP — hàng image/png ⇒ trả image/png + inline (hiển thị trực tiếp)", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S5 CHO PHÉP");
      const up = await uploadConfirmed(PNG, "s5-anh.png", "s5-allow");

      const res = await fetch(await downloadUrl(up.fileId));
      await res.arrayBuffer();
      const contentType = res.headers.get("content-type");
      const disposition = res.headers.get("content-disposition");
      console.log(
        `${TAG} S5 hàng "${PNG}": GET HTTP ${res.status} · content-type="${contentType ?? "(không có)"}" · content-disposition="${disposition ?? "(không có)"}"`,
      );

      expect(res.status).toBe(200);
      expect(contentType).toBe(PNG);
      expect(disposition).toBe("inline");
    });

    it("S9 — hàng image/png, PUT kèm Content-Disposition không ký ⇒ URL tải vẫn trả inline + image/png", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S9 image/png");

      const m = await putWithUnsignedDisposition(
        PNG,
        "s9-anh.png",
        UNSIGNED_ATTACHMENT_DISPOSITION,
      );
      console.log(
        `${TAG} S9 hàng "${PNG}", PUT kèm Content-Disposition không ký: PUT HTTP ${m.putStatus} · storage LƯU disposition="${m.stored?.contentDisposition ?? "(không có)"}" · GET content-type="${m.served?.contentType ?? "(không GET)"}" · content-disposition="${m.served?.disposition ?? "(không có)"}"`,
      );

      if (m.served === null) {
        // Storage từ chối lượt PUT mang header ngoài chữ ký ⇒ không có object nào để phục vụ.
        expect(m.putStatus).toBeGreaterThanOrEqual(400);
        expect(m.putStatus).toBeLessThan(500);
        expect(m.stored).toBeNull();
        return;
      }
      expect(m.served.contentType).toBe(PNG);
      expect(m.served.disposition ?? "").toMatch(/^inline/);
    });

    it("S9 — hàng application/pdf, PUT kèm Content-Disposition không ký ⇒ URL tải vẫn trả attachment + application/pdf", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S9 application/pdf");

      const m = await putWithUnsignedDisposition(
        PDF,
        "s9-tai-lieu.pdf",
        UNSIGNED_INLINE_DISPOSITION,
      );
      console.log(
        `${TAG} S9 hàng "${PDF}", PUT kèm Content-Disposition không ký: PUT HTTP ${m.putStatus} · storage LƯU disposition="${m.stored?.contentDisposition ?? "(không có)"}" · GET content-type="${m.served?.contentType ?? "(không GET)"}" · content-disposition="${m.served?.disposition ?? "(không có)"}"`,
      );

      if (m.served === null) {
        expect(m.putStatus).toBeGreaterThanOrEqual(400);
        expect(m.putStatus).toBeLessThan(500);
        expect(m.stored).toBeNull();
        return;
      }
      expect(m.served.contentType).toBe(PDF);
      expect(m.served.disposition ?? "").toMatch(/^attachment; filename=/);
    });

    it("S6 CHO PHÉP — URL đã ký để nguyên ⇒ 200 + x-content-type-options: nosniff", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S6 CHO PHÉP");
      const up = await uploadConfirmed(PDF, "s6-nguyen-ven.pdf", "s6-allow");

      const res = await fetch(await downloadUrl(up.fileId));
      await res.arrayBuffer();
      const noSniff = res.headers.get("x-content-type-options");
      console.log(
        `${TAG} S6 ĐO header GET: x-content-type-options="${noSniff ?? "(KHÔNG có)"}" · HTTP ${res.status}`,
      );

      expect(res.status).toBe(200);
      // Header này do STORAGE tự gắn — API không đặt được nó qua tham số ký (SDK chỉ có 6 trường Response*).
      // ĐO 08/10/2026 trên MinIO (bản PROD cục bộ): có gắn ⇒ ghim cứng để một lần đổi bản storage làm mất nó
      // sẽ đỏ ở đây. R2 chưa đo: đổi nhà cung cấp storage thì ĐO lại rồi mới sửa dòng dưới.
      expect(noSniff).toBe("nosniff");
    });

    it("S6 TỪ CHỐI — đổi response-content-type trên URL đã ký ⇒ 403", async (ctx) => {
      if (!storage.run) return skipStorageCase(ctx, "S6 TỪ CHỐI");
      const up = await uploadConfirmed(PDF, "s6-sua-url.pdf", "s6-deny");
      const url = await downloadUrl(up.fileId);

      // Tiền điều kiện: kiểu trả về nằm TRONG phần đã ký của URL (không có thì không có gì để đổi).
      const pinned = new URL(url).searchParams.get("response-content-type");
      console.log(`${TAG} S6 response-content-type trên URL đã ký: ${pinned ?? "(KHÔNG có)"}`);
      expect(pinned).toBe(PDF);

      // Chỉ đổi ĐÚNG giá trị tham số đó trên chuỗi thô — mọi byte khác của URL giữ nguyên.
      const tampered = url.replace(/([?&]response-content-type=)[^&]*/, "$1text%2Fhtml");
      expect(tampered).not.toBe(url);
      const res = await fetch(tampered);
      await res.arrayBuffer();
      console.log(`${TAG} S6 URL đã đổi response-content-type: GET HTTP ${res.status}`);

      expect(res.status).toBe(403);
    });
  });

  // ══════════════ S7–S8 · done_when[3][4] — đăng ký (chỉ ký ngoại tuyến, 0 lời gọi storage) ══════════════

  describe("S7–S8 — đăng ký kiểu trình duyệt tự dựng khi allowlist công ty ĐÃ mở", () => {
    it("S7 TỪ CHỐI — cửa FOUNDATION: khai text/html, tên không đuôi ⇒ 415 …-MIME, 0 hàng files mới", async () => {
      await expectAllowlistOpen();
      const before = await countFiles();

      const res = await register({
        originalName: NO_EXT_NAME,
        declaredMimeType: HTML,
        sizeBytes: 64,
      });
      console.log(
        `${TAG} S7 FOUNDATION khai "${HTML}": HTTP ${res.status} · code=${res.body?.error?.code ?? "(không có)"}`,
      );

      expect(res.status).toBe(415);
      expect(res.body.error?.code).toBe(ERR_MIME);
      expect(await countFiles()).toBe(before);
    });

    it.each([
      ["application/pdf", PDF],
      ["docx (OOXML)", DOCX],
    ])(
      "S7 CHO PHÉP — cửa FOUNDATION: khai %s, tên không đuôi ⇒ 201 + uploadUrl",
      async (_label, mime) => {
        await expectAllowlistOpen();

        const res = await register({
          originalName: NO_EXT_NAME,
          declaredMimeType: mime,
          sizeBytes: 64,
        });

        expect(res.status).toBe(201);
        expect(res.body.data.uploadUrl).toMatch(/^https?:\/\//);
      },
    );

    for (const { door, path, extra } of MODULE_DOORS) {
      it(`S8 TỪ CHỐI — cửa ${door}: khai text/html, tên không đuôi ⇒ 415 …-MIME, 0 hàng files mới`, async () => {
        await expectAllowlistOpen();
        const before = await countFiles();

        const res = await authPost(memberToken, path).send({
          originalName: NO_EXT_NAME,
          declaredMimeType: HTML,
          sizeBytes: 64,
          ...extra,
        });
        console.log(
          `${TAG} S8 ${door} khai "${HTML}": HTTP ${res.status} · code=${res.body?.error?.code ?? "(không có)"}`,
        );

        expect(res.status).toBe(415);
        expect(res.body.error?.code).toBe(ERR_MIME);
        expect(await countFiles()).toBe(before);
      });

      it(`S8 CHO PHÉP — cửa ${door}: khai application/pdf, tên không đuôi ⇒ 200 + uploadUrl`, async () => {
        await expectAllowlistOpen();

        const res = await authPost(memberToken, path).send({
          originalName: NO_EXT_NAME,
          declaredMimeType: PDF,
          sizeBytes: 64,
          ...extra,
        });

        expect(res.status).toBe(200);
        expect(res.body.data.uploadUrl).toMatch(/^https?:\/\//);
      });
    }
  });
});
