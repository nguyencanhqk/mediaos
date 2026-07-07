/**
 * S2-FND-FILE-2 (lane FILE2-A-storage-port) — ObjectStorageService.statObject / getObjectBytes.
 *
 * RED-first (CLAUDE.md §9.3 / harness workflow): these tests are written BEFORE the implementation
 * exists on ObjectStorageService — they must FAIL until `statObject`/`getObjectBytes` land.
 *
 * BẤT BIẾN covered:
 *   - #2.1 cross-tenant guard: statObject/getObjectBytes re-assert `key ∈ companyId` prefix via
 *     `assertKeyInTenant` BEFORE touching the S3 SDK (mirrors createDownloadUrl).
 *   - #3 fail-closed: storage not configured (missing env) → StorageNotConfiguredError, not a
 *     silent no-op / fabricated result.
 *   - statObject never throws for a genuinely-absent object (404/NotFound) — returns
 *     `{ exists: false, sizeBytes: null }` so the confirm flow can set upload_status='Failed'
 *     instead of crashing.
 *
 * Mocking strategy: `@aws-sdk/client-s3`'s `S3Client` is replaced with a fake whose `.send` is a
 * vi.fn() we control per-test; all other exports (commands, error classes) come from the REAL
 * module via `vi.importActual` so `instanceof` checks on commands / NotFound stay accurate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

// Import AFTER the mock is registered (hoisted by vitest) so ObjectStorageService picks it up.
import { HeadObjectCommand, GetObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { ObjectStorageService, StorageNotConfiguredError } from "./object-storage.service";
import { InvalidStorageKeyError } from "./storage-key";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEY_A = `${COMPANY_A}/files/cccccccc-cccc-cccc-cccc-cccccccccccc`;

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

function setConfiguredEnv(): void {
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "test-access-key";
  process.env.S3_SECRET_KEY = "test-secret-key";
  process.env.S3_BUCKET = "test-bucket";
}

describe("ObjectStorageService.statObject", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    sendMock.mockReset();
  });

  it("fail-closed: throws StorageNotConfiguredError when S3 env is absent", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const service = new ObjectStorageService();
    await expect(service.statObject(KEY_A, COMPANY_A)).rejects.toBeInstanceOf(
      StorageNotConfiguredError,
    );
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("rejects cross-tenant key BEFORE calling the SDK (never leaks existence of another tenant's object)", async () => {
    setConfiguredEnv();
    const service = new ObjectStorageService();
    await expect(service.statObject(KEY_A, COMPANY_B)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("returns exists=true + sizeBytes from ContentLength when the object is present", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValueOnce({ ContentLength: 12345, $metadata: { httpStatusCode: 200 } });
    const service = new ObjectStorageService();
    const result = await service.statObject(KEY_A, COMPANY_A);
    expect(result).toEqual({ exists: true, sizeBytes: 12345 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0][0];
    expect(sentCommand).toBeInstanceOf(HeadObjectCommand);
    expect(sentCommand.input.Bucket).toBe("test-bucket");
    expect(sentCommand.input.Key).toBe(KEY_A);
    restoreEnv(envSnap);
  });

  it("returns exists=false + sizeBytes=null (no throw) when the object is absent (404/NotFound)", async () => {
    setConfiguredEnv();
    sendMock.mockRejectedValueOnce(
      new NotFound({ message: "Not Found", $metadata: { httpStatusCode: 404 } }),
    );
    const service = new ObjectStorageService();
    const result = await service.statObject(KEY_A, COMPANY_A);
    expect(result).toEqual({ exists: false, sizeBytes: null });
    restoreEnv(envSnap);
  });

  it("rethrows non-404 errors (transport/auth failures are NOT swallowed as 'absent')", async () => {
    setConfiguredEnv();
    const transportError = new Error("ECONNREFUSED");
    sendMock.mockRejectedValueOnce(transportError);
    const service = new ObjectStorageService();
    await expect(service.statObject(KEY_A, COMPANY_A)).rejects.toBe(transportError);
    restoreEnv(envSnap);
  });
});

describe("ObjectStorageService.getObjectBytes", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    sendMock.mockReset();
  });

  it("fail-closed: throws StorageNotConfiguredError when S3 env is absent", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const service = new ObjectStorageService();
    await expect(service.getObjectBytes(KEY_A, COMPANY_A)).rejects.toBeInstanceOf(
      StorageNotConfiguredError,
    );
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("rejects cross-tenant key BEFORE calling the SDK", async () => {
    setConfiguredEnv();
    const service = new ObjectStorageService();
    await expect(service.getObjectBytes(KEY_A, COMPANY_B)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("returns the object body as a Uint8Array via GetObjectCommand", async () => {
    setConfiguredEnv();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    sendMock.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(bytes) },
      $metadata: { httpStatusCode: 200 },
    });
    const service = new ObjectStorageService();
    const result = await service.getObjectBytes(KEY_A, COMPANY_A);
    expect(result).toBe(bytes);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0][0];
    expect(sentCommand).toBeInstanceOf(GetObjectCommand);
    expect(sentCommand.input.Bucket).toBe("test-bucket");
    expect(sentCommand.input.Key).toBe(KEY_A);
    restoreEnv(envSnap);
  });

  it("fails closed when the SDK returns no Body (does NOT return an empty/fabricated buffer)", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValueOnce({ Body: undefined, $metadata: { httpStatusCode: 200 } });
    const service = new ObjectStorageService();
    await expect(service.getObjectBytes(KEY_A, COMPANY_A)).rejects.toThrow();
    restoreEnv(envSnap);
  });

  it("propagates SDK errors (e.g. NoSuchKey) — does NOT swallow into an empty result", async () => {
    setConfiguredEnv();
    const notFound = new NotFound({ message: "Not Found", $metadata: { httpStatusCode: 404 } });
    sendMock.mockRejectedValueOnce(notFound);
    const service = new ObjectStorageService();
    await expect(service.getObjectBytes(KEY_A, COMPANY_A)).rejects.toBe(notFound);
    restoreEnv(envSnap);
  });
});
