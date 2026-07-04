import { describe, expect, it } from "vitest";
import {
  confirmUploadInputSchema,
  confirmUploadResponseSchema,
  downloadUrlSchema,
  fileLinkSchema,
  fileMetadataSchema,
  FOUNDATION_FILE_ERROR_CODES,
  linkFileInputSchema,
  listFilesQuerySchema,
  registerFileResponseSchema,
  uploadFileInputSchema,
} from "./files";

/**
 * S1-FND-FILE-1 contract test (RED → GREEN).
 *
 * Quy tắc:
 *  1. Parse hợp lệ → không ném.
 *  2. visibility default = Private (bắt buộc theo SPEC-01 §16.3 / BACKEND-11 §11.3).
 *  3. sizeBytes âm → ném lỗi validation.
 *  4. ANTI-LEAK GUARD: object keys của FileMetadataDto / DownloadUrlDto / FileLinkDto
 *     KHÔNG được chứa storage internals.
 */

// ─── Constant cho test ────────────────────────────────────────────────────────

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const ISO_DT = "2026-06-24T07:00:00.000Z";

// ─── UploadFileInput ──────────────────────────────────────────────────────────

describe("uploadFileInputSchema", () => {
  const valid = {
    originalName: "hop-dong-nguyen-van-a.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: 245_000,
  };

  it("parses a minimal valid upload input", () => {
    const parsed = uploadFileInputSchema.parse(valid);
    expect(parsed.originalName).toBe("hop-dong-nguyen-van-a.pdf");
    expect(parsed.sizeBytes).toBe(245_000);
  });

  it("defaults visibility to Private when omitted", () => {
    const parsed = uploadFileInputSchema.parse(valid);
    expect(parsed.visibility).toBe("Private");
  });

  it("accepts explicit visibility values", () => {
    expect(uploadFileInputSchema.parse({ ...valid, visibility: "Internal" }).visibility).toBe(
      "Internal",
    );
    expect(uploadFileInputSchema.parse({ ...valid, visibility: "Public" }).visibility).toBe(
      "Public",
    );
  });

  it("rejects sizeBytes < 0", () => {
    expect(() => uploadFileInputSchema.parse({ ...valid, sizeBytes: -1 })).toThrow();
  });

  it("rejects empty originalName", () => {
    expect(() => uploadFileInputSchema.parse({ ...valid, originalName: "" })).toThrow();
    expect(() => uploadFileInputSchema.parse({ ...valid, originalName: "   " })).toThrow();
  });

  it("rejects an unknown visibility value", () => {
    expect(() => uploadFileInputSchema.parse({ ...valid, visibility: "secret" })).toThrow();
  });

  it("accepts optional entityId as uuid", () => {
    const parsed = uploadFileInputSchema.parse({ ...valid, entityId: UUID });
    expect(parsed.entityId).toBe(UUID);
  });

  it("rejects entityId that is not a uuid", () => {
    expect(() => uploadFileInputSchema.parse({ ...valid, entityId: "not-a-uuid" })).toThrow();
  });
});

// ─── ListFilesQuery ───────────────────────────────────────────────────────────

describe("listFilesQuerySchema", () => {
  it("uses defaults when nothing is provided", () => {
    const parsed = listFilesQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it("clamps limit to max 100", () => {
    const parsed = listFilesQuerySchema.parse({ limit: "999" });
    expect(parsed.limit).toBe(100);
  });

  it("clamps page to min 1", () => {
    const parsed = listFilesQuerySchema.parse({ page: "-5" });
    expect(parsed.page).toBe(1);
  });

  it("falls back to defaults on garbage values", () => {
    const parsed = listFilesQuerySchema.parse({ page: "abc", limit: "xyz" });
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it("accepts valid entityId filter", () => {
    const parsed = listFilesQuerySchema.parse({ entityId: UUID });
    expect(parsed.entityId).toBe(UUID);
  });
});

// ─── LinkFileInput ─────────────────────────────────────────────────────────────

describe("linkFileInputSchema", () => {
  const valid = {
    fileId: UUID,
    moduleCode: "HR",
    entityType: "EmployeeContract",
    entityId: UUID_B,
    linkType: "Contract",
  };

  it("parses a valid link input", () => {
    const parsed = linkFileInputSchema.parse(valid);
    expect(parsed.fileId).toBe(UUID);
    expect(parsed.linkType).toBe("Contract");
  });

  it("defaults accessScope to Company", () => {
    const parsed = linkFileInputSchema.parse(valid);
    expect(parsed.accessScope).toBe("Company");
  });

  it("defaults isPrimary to false", () => {
    const parsed = linkFileInputSchema.parse(valid);
    expect(parsed.isPrimary).toBe(false);
  });

  it("rejects unknown linkType", () => {
    expect(() => linkFileInputSchema.parse({ ...valid, linkType: "Badge" })).toThrow();
  });

  it("rejects unknown accessScope", () => {
    expect(() => linkFileInputSchema.parse({ ...valid, accessScope: "Public" })).toThrow();
  });
});

// ─── ANTI-LEAK GUARDS ─────────────────────────────────────────────────────────

/**
 * Bảo vệ rò rỉ: các trường storage-internal (storagePath / storageBucket /
 * checksumSha256 / contentHash / signedUrl) KHÔNG được là key trong bất kỳ
 * DTO response nào.
 */
const FORBIDDEN_KEYS = [
  "storagePath",
  "storage_path",
  "storageBucket",
  "storage_bucket",
  "checksumSha256",
  "checksum_sha256",
  "contentHash",
  "content_hash",
  "storedName",
  "stored_name",
  "storageProvider",
  "storage_provider",
  "signedUrl",
  "signed_url",
  "scanResult",
  "scan_result",
] as const;

describe("FileMetadataDto — anti-leak guard (storagePath/checksum không được lộ)", () => {
  const schemaKeys = Object.keys(fileMetadataSchema.shape);

  it.each(FORBIDDEN_KEYS)("KHÔNG có key '%s' trong fileMetadataSchema", (key) => {
    expect(schemaKeys).not.toContain(key);
  });

  it("parses a valid file metadata response", () => {
    const row = {
      id: UUID,
      originalName: "avatar.png",
      mimeType: "image/png",
      fileExtension: "png",
      sizeBytes: 10_240,
      visibility: "Private",
      uploadStatus: "Uploaded",
      scanStatus: "Clean",
      uploadedAt: ISO_DT,
      downloadCount: 3,
      isTemporary: false,
    };
    const parsed = fileMetadataSchema.parse(row);
    expect(parsed.id).toBe(UUID);
    expect(parsed.uploadStatus).toBe("Uploaded");
  });

  it("strips injected storage internals (Zod strips unknown keys by default)", () => {
    const withLeak = {
      id: UUID,
      originalName: "doc.pdf",
      mimeType: "application/pdf",
      fileExtension: "pdf",
      sizeBytes: 1_000,
      visibility: "Private",
      uploadStatus: "Uploaded",
      scanStatus: "NotRequired",
      uploadedAt: ISO_DT,
      downloadCount: 0,
      isTemporary: false,
      // injected — should be stripped
      storagePath: "/internal/private/file.pdf",
      checksumSha256: "deadbeef",
      storedName: "abc123.pdf",
    };
    const parsed = fileMetadataSchema.parse(withLeak);
    expect(parsed).not.toHaveProperty("storagePath");
    expect(parsed).not.toHaveProperty("checksumSha256");
    expect(parsed).not.toHaveProperty("storedName");
  });
});

describe("DownloadUrlDto — anti-leak guard", () => {
  const schemaKeys = Object.keys(downloadUrlSchema.shape);

  it.each(FORBIDDEN_KEYS)("KHÔNG có key '%s' trong downloadUrlSchema", (key) => {
    expect(schemaKeys).not.toContain(key);
  });

  it("parses a valid short-lived download url response", () => {
    const parsed = downloadUrlSchema.parse({
      url: "https://cdn.example.com/files/proxy/abc123",
      expiresAt: ISO_DT,
    });
    expect(parsed.url).toBe("https://cdn.example.com/files/proxy/abc123");
    expect(parsed.expiresAt).toBe(ISO_DT);
  });

  it("rejects a non-url string", () => {
    expect(() => downloadUrlSchema.parse({ url: "not-a-url", expiresAt: ISO_DT })).toThrow();
  });

  it("strips injected storage_path", () => {
    const parsed = downloadUrlSchema.parse({
      url: "https://cdn.example.com/files/proxy/abc123",
      expiresAt: ISO_DT,
      storage_path: "/internal/bucket/key",
    });
    expect(parsed).not.toHaveProperty("storage_path");
    expect(parsed).not.toHaveProperty("storagePath");
  });
});

// ─── S2-FND-FILE-2 — RegisterFileResponse (presigned-PUT) ────────────────────────

describe("registerFileResponseSchema (QA06-FILE-001)", () => {
  const schemaKeys = Object.keys(registerFileResponseSchema.shape);

  it("exposes file_id + uploadUrl (presigned-PUT) + expiresAt + upload_status", () => {
    expect(schemaKeys.sort()).toEqual(["expiresAt", "fileId", "uploadStatus", "uploadUrl"].sort());
  });

  it.each(FORBIDDEN_KEYS)("KHÔNG có storage internal key '%s'", (key) => {
    expect(schemaKeys).not.toContain(key);
  });

  it("parses a valid register response (Pending + presigned url)", () => {
    const parsed = registerFileResponseSchema.parse({
      fileId: UUID,
      uploadStatus: "Pending",
      uploadUrl: "https://s3.example.com/bucket/key?X-Amz-Signature=abc",
      expiresAt: ISO_DT,
    });
    expect(parsed.fileId).toBe(UUID);
    expect(parsed.uploadStatus).toBe("Pending");
  });

  it("strips an injected storage_path (Zod strips unknown keys)", () => {
    const parsed = registerFileResponseSchema.parse({
      fileId: UUID,
      uploadStatus: "Pending",
      uploadUrl: "https://s3.example.com/bucket/key?sig=x",
      expiresAt: ISO_DT,
      storage_path: "/internal/bucket/key",
    });
    expect(parsed).not.toHaveProperty("storage_path");
    expect(parsed).not.toHaveProperty("storagePath");
  });

  it("rejects a non-url uploadUrl", () => {
    expect(() =>
      registerFileResponseSchema.parse({
        fileId: UUID,
        uploadStatus: "Pending",
        uploadUrl: "not-a-url",
        expiresAt: ISO_DT,
      }),
    ).toThrow();
  });
});

// ─── S2-FND-FILE-2 — Confirm upload (request/response) ───────────────────────────

describe("confirmUploadInputSchema", () => {
  it("accepts an empty body (fileId comes from route, size from row)", () => {
    expect(() => confirmUploadInputSchema.parse({})).not.toThrow();
  });

  it("accepts an optional client checksum for cross-check", () => {
    const parsed = confirmUploadInputSchema.parse({ checksumSha256: "a".repeat(64) });
    expect(parsed.checksumSha256).toBe("a".repeat(64));
  });

  it("rejects a malformed checksum", () => {
    expect(() => confirmUploadInputSchema.parse({ checksumSha256: "xyz" })).toThrow();
  });
});

describe("confirmUploadResponseSchema — anti-leak", () => {
  const schemaKeys = Object.keys(confirmUploadResponseSchema.shape);

  it.each(FORBIDDEN_KEYS)("KHÔNG có storage internal key '%s' (checksum không lộ)", (key) => {
    expect(schemaKeys).not.toContain(key);
  });

  it("parses a valid confirm response (Uploaded + verified size)", () => {
    const parsed = confirmUploadResponseSchema.parse({
      fileId: UUID,
      uploadStatus: "Uploaded",
      sizeBytes: 2048,
    });
    expect(parsed.uploadStatus).toBe("Uploaded");
    expect(parsed.sizeBytes).toBe(2048);
  });
});

describe("FOUNDATION_FILE_ERROR_CODES (append-only registry)", () => {
  it("registers the new S2-FND-FILE-2 codes (append-only, keeps existing)", () => {
    expect(FOUNDATION_FILE_ERROR_CODES.EXTENSION).toBe("FOUNDATION-FILE-ERR-EXTENSION");
    expect(FOUNDATION_FILE_ERROR_CODES.BLOCKED).toBe("FOUNDATION-FILE-ERR-BLOCKED");
    expect(FOUNDATION_FILE_ERROR_CODES.CONFIRM_ABSENT).toBe("FOUNDATION-FILE-ERR-CONFIRM-ABSENT");
    expect(FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
    expect(FOUNDATION_FILE_ERROR_CODES.NOT_PENDING).toBe("FOUNDATION-FILE-ERR-NOT-PENDING");
    // existing codes preserved (not renamed/removed).
    expect(FOUNDATION_FILE_ERROR_CODES.DUP_LINK).toBe("FOUNDATION-FILE-ERR-DUP-LINK");
    expect(FOUNDATION_FILE_ERROR_CODES.DUP_PRIMARY).toBe("FOUNDATION-FILE-ERR-DUP-PRIMARY");
  });

  it("every code follows the FOUNDATION-FILE-ERR-* convention (SPEC-01 §9)", () => {
    for (const code of Object.values(FOUNDATION_FILE_ERROR_CODES)) {
      expect(code).toMatch(/^FOUNDATION-FILE-ERR-[A-Z-]+$/);
    }
  });
});

describe("FileLinkDto — anti-leak guard", () => {
  const schemaKeys = Object.keys(fileLinkSchema.shape);

  it.each(FORBIDDEN_KEYS)("KHÔNG có key '%s' trong fileLinkSchema", (key) => {
    expect(schemaKeys).not.toContain(key);
  });

  it("parses a valid file link response", () => {
    const row = {
      id: UUID,
      fileId: UUID_B,
      moduleCode: "HR",
      entityType: "EmployeeContract",
      entityId: UUID,
      linkType: "Contract",
      accessScope: "Company",
      isPrimary: true,
      createdAt: ISO_DT,
    };
    const parsed = fileLinkSchema.parse(row);
    expect(parsed.linkType).toBe("Contract");
    expect(parsed.accessScope).toBe("Company");
    expect(parsed.isPrimary).toBe(true);
  });
});
