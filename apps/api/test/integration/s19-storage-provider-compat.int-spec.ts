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
 * Cổng = `openStorageTestGate` (`test/helpers/storage-test-gate.ts`, S16-SOCIAL-STORAGETESTGATE-1): thiếu DB lane
 * ⇒ SKIP cả file; tên bucket khác tên DUY NHẤT cho phép ⇒ CI ném / cục bộ bỏ qua có nhãn `[storage-test-skip]`
 * THEO TỪNG CA. Bucket cho phép chưa tồn tại ⇒ helper TẠO đúng tên đó (hết phụ thuộc thứ tự chạy với s16).
 * ⚠️ Dọn: `gate.removeObjects` trên tiền tố công ty ngẫu nhiên của file này. Không đụng bucket.
 */

import "reflect-metadata";
// Nạp `.env` vào `process.env` y như `src/main.ts` (biến đã có — vd do lệnh R2 đặt, hay `S3_*` mà
// `vitest.config.ts` ghim — THẮNG): file này không dựng app Nest nên `ConfigModule` không chạy.
import "../../src/config/load-env";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectStorageService } from "../../src/storage/object-storage.service";
import { hasDb } from "../helpers/integration-db";
import { openStorageTestGate, type StorageTestGate } from "../helpers/storage-test-gate";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = "[storage-compat]";
const PDF = "application/pdf";
const FILE = "test/integration/s19-storage-provider-compat.int-spec.ts";

/** URL trần: bỏ toàn bộ query (chữ ký) của một URL ký. */
function stripSignature(signedUrl: string): string {
  const u = new URL(signedUrl);
  return `${u.origin}${u.pathname}`;
}

describe.skipIf(!runDb)("S19-OPS-STORAGEPUBLIC-1 — thao tác phía server trên storage thật", () => {
  const companyId = randomUUID();
  let storage: ObjectStorageService;
  let gate: StorageTestGate;

  function newKey(label: string): string {
    return `${companyId}/storage-compat/${label}-${randomUUID()}`;
  }

  beforeAll(async () => {
    // Cổng storage NGOÀI CÙNG — trước khi dựng bất cứ thứ gì đọc `S3_*`.
    gate = await openStorageTestGate(FILE);
    if (!gate.run) return;
    storage = new ObjectStorageService();
    expect(storage.isConfigured(), `${TAG} S3_* chưa đủ`).toBe(true);
  });

  afterAll(async () => {
    // Cổng đóng ⇒ không gọi gì. Dọn lỗi ⇒ ĐỎ (không nuốt): object thử còn sót phải lộ ra.
    await gate?.removeObjects([`${companyId}/`]);
  });

  it("K-1 CHO PHÉP — putObject phía server ⇒ statObject đúng kiểu + cỡ, getObjectBytes đúng byte", async (ctx) => {
    if (!gate.needStorage(ctx, "K-1")) return;
    const key = newKey("k1");
    const body = new Uint8Array(Buffer.from(`storage-compat-k1-${randomUUID()}`, "utf8"));

    await storage.putObject(key, body, PDF, companyId);

    const head = await storage.statObject(key, companyId);
    expect(head).toEqual({ exists: true, sizeBytes: body.length, contentType: PDF });
    const bytes = await storage.getObjectBytes(key, companyId);
    expect(Buffer.from(bytes).equals(Buffer.from(body))).toBe(true);
  });

  it("K-2 — trước deleteObject ⇒ tồn tại (CHO PHÉP) · sau deleteObject ⇒ KHÔNG tồn tại (TỪ CHỐI)", async (ctx) => {
    if (!gate.needStorage(ctx, "K-2")) return;
    const key = newKey("k2");
    await storage.putObject(key, "storage-compat-k2", "text/plain", companyId);
    expect((await storage.statObject(key, companyId)).exists).toBe(true);

    await storage.deleteObject(key, companyId);

    const after = await storage.statObject(key, companyId);
    expect(after).toEqual({ exists: false, sizeBytes: null, contentType: null });
  });

  it("K-3 — CÙNG khoá: URL ký ⇒ 200 (CHO PHÉP) · URL trần không chữ ký ⇒ 4xx (TỪ CHỐI)", async (ctx) => {
    if (!gate.needStorage(ctx, "K-3")) return;
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
