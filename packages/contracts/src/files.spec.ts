import { describe, expect, it } from "vitest";
import {
  downloadUrlSchema,
  fileLinkSchema,
  fileMetadataSchema,
  linkFileInputSchema,
  listFilesQuerySchema,
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
