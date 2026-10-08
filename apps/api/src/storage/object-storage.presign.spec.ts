/**
 * S16-SOCIAL-FILEDISPOSITION-1 — ObjectStorageService: hành vi KÝ của URL đã ký (ký ngoại tuyến).
 *
 * File này KHÔNG mock SDK: ký SigV4 là phép HMAC cục bộ nên chạy được với khoá giả và một endpoint
 * không phân giải được — không có lời gọi mạng nào. (Spec `object-storage.service.spec.ts` mock toàn bộ
 * `S3Client` ở mức file nên không ghim được hành vi ký — vì thế các ca ký nằm ở file riêng này.)
 *
 * Ca:
 *   G1 — URL PUT ký header `content-type` (nằm trong `X-Amz-SignedHeaders`).
 *   G2 — kiểu nội dung tham gia chữ ký: đổi kiểu ⇒ chữ ký khác; cùng kiểu ⇒ chữ ký giống.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectStorageService } from "./object-storage.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KEY_A = `${COMPANY_A}/files/cccccccc-cccc-cccc-cccc-cccccccccccc`;
const SIZE_BYTES = 1024;
const SIGNING_DATE = new Date("2026-10-08T03:00:00.000Z");

// Khoá GIẢ, ghép chuỗi (không phải credential — tránh literal trông giống secret).
const FIXTURE_ACCESS_KEY = ["fixture", "s3", "access", "x"].join("-");
const FIXTURE_SECRET_KEY = ["fixture", "s3", "secret", "x"].join("-");

const ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_PRESIGN_TTL_SEC",
] as const;
type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function setOfflineSigningEnv(): void {
  process.env.S3_ENDPOINT = "http://storage.invalid:9000";
  process.env.S3_ACCESS_KEY = FIXTURE_ACCESS_KEY;
  process.env.S3_SECRET_KEY = FIXTURE_SECRET_KEY;
  process.env.S3_BUCKET = "fixture-bucket";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.S3_PRESIGN_TTL_SEC = "300";
}

/** Đọc một tham số query theo tên KHÔNG phân biệt hoa-thường (`null` khi vắng). */
function queryParam(url: string, name: string): string | null {
  for (const [key, value] of new URL(url).searchParams) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

function signedHeaderNames(url: string): string[] {
  return (queryParam(url, "X-Amz-SignedHeaders") ?? "").split(";");
}

describe("ObjectStorageService — URL PUT đã ký (ký ngoại tuyến, không mock SDK)", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    setOfflineSigningEnv();
    // Chỉ giả lập Date: thời điểm ký cố định ⇒ hai lượt ký so được chữ ký với nhau.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SIGNING_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv(envSnap);
  });

  it("G1 — URL PUT có content-type trong X-Amz-SignedHeaders", async () => {
    const service = new ObjectStorageService();

    const url = await service.createUploadUrl(KEY_A, "application/pdf", SIZE_BYTES);

    expect(queryParam(url, "X-Amz-SignedHeaders")).toContain("content-type");
    expect(signedHeaderNames(url)).toEqual(["content-length", "content-type", "host"]);
  });

  it("G1 — URL PUT ký ngoại tuyến trỏ đúng endpoint + khoá object, không cần mạng", async () => {
    const service = new ObjectStorageService();

    const url = await service.createUploadUrl(KEY_A, "image/png", SIZE_BYTES);

    const parsed = new URL(url);
    expect(parsed.host).toBe("storage.invalid:9000");
    expect(parsed.pathname).toBe(`/fixture-bucket/${KEY_A}`);
    expect(queryParam(url, "X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("G2 — TỪ CHỐI: đổi kiểu nội dung (cùng khoá, cỡ, thời điểm ký) ⇒ chữ ký KHÁC", async () => {
    const service = new ObjectStorageService();

    const pdfUrl = await service.createUploadUrl(KEY_A, "application/pdf", SIZE_BYTES);
    const pngUrl = await service.createUploadUrl(KEY_A, "image/png", SIZE_BYTES);

    expect(queryParam(pdfUrl, "X-Amz-Date")).toBe(queryParam(pngUrl, "X-Amz-Date"));
    expect(queryParam(pngUrl, "X-Amz-Signature")).not.toBe(queryParam(pdfUrl, "X-Amz-Signature"));
  });

  it("G2 — CHO PHÉP: cùng kiểu nội dung ⇒ chữ ký GIỐNG (phép ký tất định)", async () => {
    const service = new ObjectStorageService();

    const first = await service.createUploadUrl(KEY_A, "application/pdf", SIZE_BYTES);
    const second = await service.createUploadUrl(KEY_A, "application/pdf", SIZE_BYTES);

    expect(queryParam(first, "X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(queryParam(second, "X-Amz-Signature")).toBe(queryParam(first, "X-Amz-Signature"));
  });
});
