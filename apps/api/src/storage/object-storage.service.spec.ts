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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

// S16-SOCIAL-FILEDISPOSITION-1: the presigner is replaced ONLY in this file, to drive the post-signing
// self-check with a URL the real signer would never produce. Real signing behaviour is pinned in
// `object-storage.presign.spec.ts` (no SDK mock there).
const getSignedUrlMock = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

// Import AFTER the mock is registered (hoisted by vitest) so ObjectStorageService picks it up.
import { Logger } from "@nestjs/common";
import {
  HeadObjectCommand,
  GetObjectCommand,
  NotFound,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ObjectStorageService,
  StorageNotConfiguredError,
  UnsupportedAttachmentError,
} from "./object-storage.service";
import { StoragePresignInvariantError } from "./presign-invariants";
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

  it("G6 — returns exists=true + sizeBytes + the STORED contentType (verbatim) when the object is present", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValueOnce({
      ContentLength: 12345,
      ContentType: "Application/PDF; x=1",
      $metadata: { httpStatusCode: 200 },
    });
    const service = new ObjectStorageService();
    const result = await service.statObject(KEY_A, COMPANY_A);
    // Chuỗi storage trả về được chuyển NGUYÊN VĂN — so khớp/thường hoá là việc của tầng gọi.
    expect(result).toEqual({
      exists: true,
      sizeBytes: 12345,
      contentType: "Application/PDF; x=1",
    });
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
    expect(result).toEqual({ exists: false, sizeBytes: null, contentType: null });
    restoreEnv(envSnap);
  });

  it("G6 — contentType=null when HEAD carries no ContentType (never a guessed default)", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValueOnce({ ContentLength: 7, $metadata: { httpStatusCode: 200 } });
    const service = new ObjectStorageService();
    const result = await service.statObject(KEY_A, COMPANY_A);
    expect(result).toEqual({ exists: true, sizeBytes: 7, contentType: null });
    restoreEnv(envSnap);
  });

  it("G6 — contentType=null when HEAD carries an EMPTY ContentType", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValueOnce({
      ContentLength: 7,
      ContentType: "",
      $metadata: { httpStatusCode: 200 },
    });
    const service = new ObjectStorageService();
    const result = await service.statObject(KEY_A, COMPANY_A);
    expect(result).toEqual({ exists: true, sizeBytes: 7, contentType: null });
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

describe("ObjectStorageService.createUploadUrl — post-signing self-check (S16-SOCIAL-FILEDISPOSITION-1)", () => {
  const SIGNED_BASE = `http://localhost:9000/test-bucket/${KEY_A}?X-Amz-Signature=abc`;
  let envSnap: EnvSnapshot;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    getSignedUrlMock.mockReset();
    setConfiguredEnv();
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Chỉ gỡ spy của Logger — `vi.restoreAllMocks()` sẽ xoá luôn bản giả `S3Client` dùng chung cả file.
    errorSpy.mockRestore();
    restoreEnv(envSnap);
  });

  it("DENY — signer returns a URL that does not sign content-type ⇒ throws, logs at error level, returns no URL", async () => {
    getSignedUrlMock.mockResolvedValue(`${SIGNED_BASE}&X-Amz-SignedHeaders=content-length%3Bhost`);
    const service = new ObjectStorageService();

    await expect(service.createUploadUrl(KEY_A, "application/pdf", 10)).rejects.toBeInstanceOf(
      StoragePresignInvariantError,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("StoragePresignInvariantError");
    expect(logged).toContain("PUT");
    // Dòng log không mang URL, khoá object hay chữ ký.
    expect(logged).not.toContain(KEY_A);
    expect(logged).not.toContain("X-Amz-Signature");
    expect(logged).not.toContain("http");
  });

  it("ALLOW — signer returns a URL that signs content-type ⇒ URL returned, nothing logged at error level", async () => {
    const signed = `${SIGNED_BASE}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`;
    getSignedUrlMock.mockResolvedValue(signed);
    const service = new ObjectStorageService();

    await expect(service.createUploadUrl(KEY_A, "application/pdf", 10)).resolves.toBe(signed);

    expect(errorSpy).not.toHaveBeenCalled();
    // Lớp ký được YÊU CẦU ký content-type (không chỉ tình cờ có trong URL giả).
    const options = getSignedUrlMock.mock.calls[0][2] as { signableHeaders?: Set<string> };
    expect([...(options.signableHeaders ?? [])]).toEqual(["content-type"]);
  });

  it("the hard ceilings still run BEFORE signing and say which ceiling failed (kind)", async () => {
    const service = new ObjectStorageService();

    const typeError = await service.createUploadUrl(KEY_A, "text/html", 10).catch((e) => e);
    expect(typeError).toBeInstanceOf(UnsupportedAttachmentError);
    expect((typeError as UnsupportedAttachmentError).kind).toBe("content-type");

    const emptyTypeError = await service.createUploadUrl(KEY_A, "", 10).catch((e) => e);
    expect((emptyTypeError as UnsupportedAttachmentError).kind).toBe("content-type");

    const sizeError = await service.createUploadUrl(KEY_A, "application/pdf", 0).catch((e) => e);
    expect(sizeError).toBeInstanceOf(UnsupportedAttachmentError);
    expect((sizeError as UnsupportedAttachmentError).kind).toBe("size");

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("ObjectStorageService.createDownloadUrl — serve directives + post-signing self-check (S16-SOCIAL-FILEDISPOSITION-1)", () => {
  const SIGNED_BASE = `http://localhost:9000/test-bucket/${KEY_A}?X-Amz-Signature=abc`;
  const PDF = { registeredMimeType: "application/pdf", fileName: "bao-cao.pdf" };
  let envSnap: EnvSnapshot;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    getSignedUrlMock.mockReset();
    setConfiguredEnv();
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Chỉ gỡ spy của Logger — `vi.restoreAllMocks()` sẽ xoá luôn bản giả `S3Client` dùng chung cả file.
    errorSpy.mockRestore();
    restoreEnv(envSnap);
  });

  it("DENY — signer returns a URL with no response-content-type ⇒ throws, logs at error level, returns no URL", async () => {
    getSignedUrlMock.mockResolvedValue(`${SIGNED_BASE}&X-Amz-SignedHeaders=host`);
    const service = new ObjectStorageService();

    await expect(service.createDownloadUrl(KEY_A, COMPANY_A, PDF)).rejects.toBeInstanceOf(
      StoragePresignInvariantError,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("StoragePresignInvariantError");
    expect(logged).toContain("GET");
    // Dòng log không mang URL, khoá object hay chữ ký.
    expect(logged).not.toContain(KEY_A);
    expect(logged).not.toContain("X-Amz-Signature");
    expect(logged).not.toContain("http");
  });

  /** Giá trị disposition server định ký cho `PDF` (chép TAY — không lấy từ nguồn đang được kiểm). */
  const PDF_DISPOSITION = `attachment; filename="bao-cao.pdf"; filename*=UTF-8''bao-cao.pdf`;
  const PNG = { registeredMimeType: "image/png", fileName: "anh.png" };

  /** URL giả của lớp ký với hai tham số `response-*` cho trước (`null` = vắng tham số đó). */
  function signedGet(type: string | null, disposition: string | null): string {
    const typePart = type === null ? "" : `&response-content-type=${encodeURIComponent(type)}`;
    const dispositionPart =
      disposition === null
        ? ""
        : `&response-content-disposition=${encodeURIComponent(disposition)}`;
    return `${SIGNED_BASE}${typePart}${dispositionPart}`;
  }

  it("ALLOW — signer returns a URL that pins BOTH response-* values ⇒ URL returned, nothing logged at error level", async () => {
    const signed = signedGet("application/pdf", PDF_DISPOSITION);
    getSignedUrlMock.mockResolvedValue(signed);
    const service = new ObjectStorageService();

    await expect(service.createDownloadUrl(KEY_A, COMPANY_A, PDF, 900)).resolves.toBe(signed);

    expect(errorSpy).not.toHaveBeenCalled();
    // Lớp ký được YÊU CẦU ghim kiểu trả + attachment (không chỉ tình cờ có trong URL giả).
    const command = getSignedUrlMock.mock.calls[0][1] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Key).toBe(KEY_A);
    expect(command.input.ResponseContentType).toBe("application/pdf");
    expect(command.input.ResponseContentDisposition).toBe(PDF_DISPOSITION);
    expect((getSignedUrlMock.mock.calls[0][2] as { expiresIn?: number }).expiresIn).toBe(900);
  });

  it.each([
    ["the disposition is missing", signedGet("application/pdf", null), PDF],
    ["the disposition differs (inline)", signedGet("application/pdf", "inline"), PDF],
    ["the type differs", signedGet("text/html", PDF_DISPOSITION), PDF],
    ["an inline type lost its disposition", signedGet("image/png", null), PNG],
    ["an inline type got an attachment", signedGet("image/png", PDF_DISPOSITION), PNG],
  ])(
    "DENY — signer returns a URL where %s ⇒ throws, logs ONE error line, returns no URL",
    async (_label, signed, serveAs) => {
      getSignedUrlMock.mockResolvedValue(signed);
      const service = new ObjectStorageService();

      await expect(service.createDownloadUrl(KEY_A, COMPANY_A, serveAs)).rejects.toBeInstanceOf(
        StoragePresignInvariantError,
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = String(errorSpy.mock.calls[0][0]);
      expect(logged).toContain("GET");
      // Dòng log không mang URL, khoá object, chữ ký hay tên tệp.
      expect(logged).not.toContain(KEY_A);
      expect(logged).not.toContain("X-Amz-Signature");
      expect(logged).not.toContain("http");
      expect(logged).not.toContain("bao-cao");
    },
  );

  it("an inline type asks the signer to PIN the disposition to inline (never left to the stored object)", async () => {
    const signed = signedGet("image/png", "inline");
    getSignedUrlMock.mockResolvedValue(signed);
    const service = new ObjectStorageService();

    await expect(service.createDownloadUrl(KEY_A, COMPANY_A, PNG)).resolves.toBe(signed);

    const command = getSignedUrlMock.mock.calls[0][1] as GetObjectCommand;
    expect(command.input.ResponseContentType).toBe("image/png");
    expect(command.input.ResponseContentDisposition).toBe("inline");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("DENY — a key outside the caller's tenant prefix is rejected BEFORE signing", async () => {
    const service = new ObjectStorageService();

    await expect(service.createDownloadUrl(KEY_A, COMPANY_B, PDF)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );

    expect(getSignedUrlMock).not.toHaveBeenCalled();
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

describe("ObjectStorageService.putObject (S15-PAYROLL-BE-5B)", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    sendMock.mockReset();
  });

  it("rejects a key outside the caller's tenant prefix BEFORE calling the SDK", async () => {
    setConfiguredEnv();
    const service = new ObjectStorageService();
    await expect(
      service.putObject(KEY_A, new Uint8Array([1]), "application/pdf", COMPANY_B),
    ).rejects.toBeInstanceOf(InvalidStorageKeyError);
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("PUTs the bytes with the declared content type for an in-tenant key", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValue({});
    const service = new ObjectStorageService();
    const body = new Uint8Array([1, 2]);
    await service.putObject(KEY_A, body, "application/zip", COMPANY_A);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Key: KEY_A, Body: body, ContentType: "application/zip" });
    restoreEnv(envSnap);
  });
});

describe("ObjectStorageService.deleteObject (S15-PAYROLL-BE-5B)", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    sendMock.mockReset();
  });

  it("rejects a key outside the caller's tenant prefix BEFORE calling the SDK", async () => {
    setConfiguredEnv();
    const service = new ObjectStorageService();
    await expect(service.deleteObject(KEY_A, COMPANY_B)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    expect(sendMock).not.toHaveBeenCalled();
    restoreEnv(envSnap);
  });

  it("sends DeleteObjectCommand for an in-tenant key", async () => {
    setConfiguredEnv();
    sendMock.mockResolvedValue({});
    const service = new ObjectStorageService();
    await service.deleteObject(KEY_A, COMPANY_A);
    const command = sendMock.mock.calls[0][0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Key: KEY_A });
    restoreEnv(envSnap);
  });
});
