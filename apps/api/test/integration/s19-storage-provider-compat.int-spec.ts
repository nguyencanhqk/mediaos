/**
 * S19-OPS-STORAGEPUBLIC-1 (plan v2 D3 · ca K-1…K-3) — thao tác PHÍA SERVER của `ObjectStorageService` trên
 * storage THẬT, chạy được trên CẢ HAI nhà cung cấp:
 *   • storage tự host — lane cục bộ + job CI (`api.yml`);
 *   • Cloudflare R2 — `scripts/storage-r2-compat.sh` (bucket R2 thử).
 *
 * VÌ SAO CÓ FILE NÀY
 * Nhóm S1–S9 của `s16-filedisposition-storage.int-spec.ts` phủ URL ký + confirm (HEAD + đọc byte) nhưng
 * KHÔNG phủ hai lời gọi server tự ghi / tự xoá: `putObject` (tệp do server sinh — phiếu lương,
 * `foundation/files/server-file.service.ts`) và `deleteObject` (dọn tệp tạm,
 * `foundation/files/temp-file-cleanup.job-handler.ts`). CI không bao giờ chạy trên R2 ⇒ một lần nâng SDK
 * làm hỏng hai đường này trên R2 sẽ không ai thấy nếu không có file này + lệnh R2 ở trên.
 *
 * Dùng THẲNG `ObjectStorageService` (constructor đọc `S3_*` của tiến trình) — đúng client + cấu hình mà
 * API dùng; không dựng app Nest, không chạm DB nghiệp vụ.
 *
 * Cổng (cùng hình #578, `test/helpers/storage-test-target.ts`): thiếu DB lane ⇒ SKIP cả file; tên bucket
 * khác tên DUY NHẤT cho phép ⇒ CI ném / cục bộ bỏ qua CÓ cảnh báo. Bucket chưa tồn tại ⇒ CI ném / cục bộ
 * bỏ qua có cảnh báo (file này không tạo bucket — `s16-filedisposition-storage.int-spec.ts` lo việc đó).
 * ⚠️ Dọn: chỉ xoá đúng các khoá do file này ghi (tiền tố một công ty ngẫu nhiên). Không đụng bucket.
 */

import "reflect-metadata";
// Nạp `.env` vào `process.env` y như `src/main.ts` (biến đã có — vd do lệnh R2 đặt — THẮNG): file này không
// dựng app Nest nên `ConfigModule` không chạy, mà `ObjectStorageService` đọc `S3_*` thẳng từ `process.env`.
import "../../src/config/load-env";
import { randomUUID } from "node:crypto";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { ObjectStorageService } from "../../src/storage/object-storage.service";
import { hasDb } from "../helpers/integration-db";
import { isCiEnv, resolveStorageTestTarget } from "../helpers/storage-test-target";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = "[storage-compat]";
const PDF = "application/pdf";

type Gate = { run: true } | { run: false; reason: string };

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchBucket" || e.$metadata?.httpStatusCode === 404;
}

function errName(err: unknown): string {
  return (err as { name?: string }).name ?? "UnknownError";
}

/** URL trần: bỏ toàn bộ query (chữ ký) của một URL ký. */
function stripSignature(signedUrl: string): string {
  const u = new URL(signedUrl);
  return `${u.origin}${u.pathname}`;
}

describe.skipIf(!runDb)("S19-OPS-STORAGEPUBLIC-1 — thao tác phía server trên storage thật", () => {
  const companyId = randomUUID();
  const written: string[] = [];
  let storage: ObjectStorageService;
  let gate: Gate = { run: false, reason: "beforeAll chưa chạy" };

  function skipCase(ctx: Pick<TestContext, "skip">, caseName: string): void {
    const why = gate.run ? "" : gate.reason;
    console.warn(`${TAG} BỎ QUA ca storage thật «${caseName}»: ${why}`);
    ctx.skip();
  }

  function newKey(label: string): string {
    const key = `${companyId}/storage-compat/${label}-${randomUUID()}`;
    written.push(key);
    return key;
  }

  beforeAll(async () => {
    const target = resolveStorageTestTarget(process.env);
    if (target.kind === "throw") throw new Error(`${TAG} ${target.reason}`);
    if (target.kind !== "run") {
      gate = { run: false, reason: target.reason };
      return;
    }
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
      await s3.send(new HeadBucketCommand({ Bucket: target.bucket }));
    } catch (err) {
      const reason = `bucket "${target.bucket}" ${isNotFound(err) ? "CHƯA tồn tại" : `lỗi ${errName(err)}`}`;
      if (isCiEnv(process.env) || !isNotFound(err)) throw new Error(`${TAG} ${reason}`);
      gate = {
        run: false,
        reason: `${reason} — chạy s16-filedisposition-storage trước để tạo bucket`,
      };
      return;
    } finally {
      // Client dò bucket chỉ dùng một lần — đóng socket keep-alive, không để treo tới hết worker.
      s3.destroy();
    }
    storage = new ObjectStorageService();
    expect(storage.isConfigured(), `${TAG} S3_* chưa đủ`).toBe(true);
    gate = { run: true };
    console.log(`${TAG} bucket "${target.bucket}": ĐÃ TỒN TẠI — ca storage thật CHẠY.`);
  });

  afterAll(async () => {
    if (!gate.run) return;
    for (const key of written) {
      try {
        await storage.deleteObject(key, companyId);
      } catch (err) {
        console.warn(
          `${TAG} dọn object thất bại (${errName(err)}) — object thử còn lại trong bucket.`,
        );
      }
    }
  });

  it("K-1 CHO PHÉP — putObject phía server ⇒ statObject đúng kiểu + cỡ, getObjectBytes đúng byte", async (ctx) => {
    if (!gate.run) return skipCase(ctx, "K-1");
    const key = newKey("k1");
    const body = new Uint8Array(Buffer.from(`storage-compat-k1-${randomUUID()}`, "utf8"));

    await storage.putObject(key, body, PDF, companyId);

    const head = await storage.statObject(key, companyId);
    expect(head).toEqual({ exists: true, sizeBytes: body.length, contentType: PDF });
    const bytes = await storage.getObjectBytes(key, companyId);
    expect(Buffer.from(bytes).equals(Buffer.from(body))).toBe(true);
  });

  it("K-2 — trước deleteObject ⇒ tồn tại (CHO PHÉP) · sau deleteObject ⇒ KHÔNG tồn tại (TỪ CHỐI)", async (ctx) => {
    if (!gate.run) return skipCase(ctx, "K-2");
    const key = newKey("k2");
    await storage.putObject(key, "storage-compat-k2", "text/plain", companyId);
    expect((await storage.statObject(key, companyId)).exists).toBe(true);

    await storage.deleteObject(key, companyId);

    const after = await storage.statObject(key, companyId);
    expect(after).toEqual({ exists: false, sizeBytes: null, contentType: null });
  });

  it("K-3 — CÙNG khoá: URL ký ⇒ 200 (CHO PHÉP) · URL trần không chữ ký ⇒ 4xx (TỪ CHỐI)", async (ctx) => {
    if (!gate.run) return skipCase(ctx, "K-3");
    const key = newKey("k3");
    await storage.putObject(key, "storage-compat-k3", PDF, companyId);
    const signed = await storage.createDownloadUrl(key, companyId, {
      registeredMimeType: PDF,
      fileName: "k3.pdf",
    });

    // Vế CHO PHÉP đứng TRƯỚC: chứng minh khoá có thật — nếu không, vế TỪ CHỐI xanh giả (storage trả cùng
    // mã cho khoá có / không có khi không có chữ ký — đo 14/10/2026 trên R2).
    const allowed = await fetch(signed);
    await allowed.arrayBuffer();
    expect(allowed.status).toBe(200);

    const denied = await fetch(stripSignature(signed));
    await denied.arrayBuffer();
    console.log(`${TAG} K-3 GET không chữ ký vào khoá có thật ⇒ HTTP ${denied.status}`);
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(denied.status).toBeLessThan(500);
  });
});
