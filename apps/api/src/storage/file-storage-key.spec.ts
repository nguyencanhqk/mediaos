/**
 * FILE-STORAGE-1 — file-storage-key unit tests.
 *
 * BẤT BIẾN (CLAUDE.md §2.1 / §2.3):
 *   - buildFileKey ALWAYS produces `{companyId}/files/{fileId}` — companyId/fileId are UUID-only.
 *   - originalName (user-supplied) is IGNORED in the key — ANY content (traversal, null, etc.) is inert.
 *   - Path-traversal inputs must be REJECTED (fail-closed: throw InvalidStorageKeyError).
 *   - Cross-tenant assertKeyInTenant: key of tenant A must be rejected for tenant B.
 *
 * Pattern mirrors apps/api/src/tasks/storage-key.spec.ts (existing crown-jewel tests).
 * Colocated in src/storage/ so vitest include: ["src/**\/*.spec.ts"] picks it up.
 */
import { describe, expect, it } from "vitest";
import { buildFileKey, filePrefix, InvalidStorageKeyError } from "./file-storage-key";
import { assertKeyInTenant } from "./storage-key";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FILE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// ─── RED: deny-path (these must FAIL fast — fail-closed) ──────────────────────────────────────────

describe("buildFileKey — deny-path (path-traversal / invalid input)", () => {
  it("rejects non-uuid companyId", () => {
    expect(() => buildFileKey({ companyId: "not-a-uuid", fileId: FILE_ID })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects empty companyId", () => {
    expect(() => buildFileKey({ companyId: "", fileId: FILE_ID })).toThrow(InvalidStorageKeyError);
  });

  it("rejects non-uuid fileId", () => {
    expect(() => buildFileKey({ companyId: COMPANY_A, fileId: "not-a-uuid" })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects empty fileId", () => {
    expect(() => buildFileKey({ companyId: COMPANY_A, fileId: "" })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects dotdot in companyId position", () => {
    expect(() => buildFileKey({ companyId: "../etc/passwd", fileId: FILE_ID })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects dotdot in fileId position", () => {
    expect(() => buildFileKey({ companyId: COMPANY_A, fileId: "../../secret" })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects leading slash in companyId", () => {
    expect(() => buildFileKey({ companyId: `/${COMPANY_A}`, fileId: FILE_ID })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects null byte in fileId", () => {
    expect(() => buildFileKey({ companyId: COMPANY_A, fileId: `${FILE_ID}\0evil` })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects backslash in fileId", () => {
    expect(() => buildFileKey({ companyId: COMPANY_A, fileId: `${FILE_ID}\\evil` })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects /etc/passwd as companyId", () => {
    expect(() => buildFileKey({ companyId: "/etc/passwd", fileId: FILE_ID })).toThrow(
      InvalidStorageKeyError,
    );
  });

  it("rejects Windows drive path as companyId", () => {
    expect(() => buildFileKey({ companyId: "C:\\Windows", fileId: FILE_ID })).toThrow(
      InvalidStorageKeyError,
    );
  });
});

// ─── originalName is inert — any content MUST NOT change the key ─────────────────────────────────

describe("buildFileKey — originalName is inert (never affects key)", () => {
  const baseline = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });

  it("key is identical whether originalName is absent or present", () => {
    const withName = buildFileKey({
      companyId: COMPANY_A,
      fileId: FILE_ID,
      originalName: "report Q1 final FINAL v3.pdf",
    });
    expect(withName).toBe(baseline);
  });

  it("key is identical even with path-traversal originalName", () => {
    const withTraversal = buildFileKey({
      companyId: COMPANY_A,
      fileId: FILE_ID,
      originalName: "../../../etc/passwd",
    });
    expect(withTraversal).toBe(baseline);
  });

  it("key is identical even with null-byte originalName", () => {
    const withNull = buildFileKey({
      companyId: COMPANY_A,
      fileId: FILE_ID,
      originalName: "evil\0file.exe",
    });
    expect(withNull).toBe(baseline);
  });

  it("key is identical even with backslash originalName", () => {
    const withBackslash = buildFileKey({
      companyId: COMPANY_A,
      fileId: FILE_ID,
      originalName: "C:\\Windows\\system32\\evil.dll",
    });
    expect(withBackslash).toBe(baseline);
  });
});

// ─── GREEN: happy-path ────────────────────────────────────────────────────────────────────────────

describe("buildFileKey — happy-path", () => {
  it("produces key of form {companyId}/files/{fileId}", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    expect(key).toBe(`${COMPANY_A}/files/${FILE_ID}`);
  });

  it("key always starts with the tenant prefix", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    expect(key.startsWith(`${COMPANY_A}/`)).toBe(true);
  });

  it("key contains the 'files' namespace segment", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    const segments = key.split("/");
    expect(segments[1]).toBe("files");
  });

  it("key last segment is exactly fileId", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    const segments = key.split("/");
    expect(segments[segments.length - 1]).toBe(FILE_ID);
  });

  it("different companies produce different prefix (no cross-tenant collision)", () => {
    const keyA = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    const keyB = buildFileKey({ companyId: COMPANY_B, fileId: FILE_ID });
    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith(`${COMPANY_A}/`)).toBe(true);
    expect(keyB.startsWith(`${COMPANY_B}/`)).toBe(true);
  });
});

// ─── assertKeyInTenant — cross-tenant rejection ───────────────────────────────────────────────────

describe("assertKeyInTenant — cross-tenant guard (reused from storage-key.ts)", () => {
  it("passes when the file key belongs to the requesting tenant", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    expect(() => assertKeyInTenant(key, COMPANY_A)).not.toThrow();
  });

  it("rejects a key of tenant A when checked for tenant B (cross-tenant sign attempt)", () => {
    const key = buildFileKey({ companyId: COMPANY_A, fileId: FILE_ID });
    expect(() => assertKeyInTenant(key, COMPANY_B)).toThrow(InvalidStorageKeyError);
  });

  it("rejects a manually crafted traversal key even if it looks tenant-prefixed", () => {
    const crafted = `${COMPANY_A}/../${COMPANY_B}/files/${FILE_ID}`;
    expect(() => assertKeyInTenant(crafted, COMPANY_A)).toThrow(InvalidStorageKeyError);
  });
});

// ─── filePrefix ───────────────────────────────────────────────────────────────────────────────────

describe("filePrefix", () => {
  it("returns {companyId}/files", () => {
    expect(filePrefix(COMPANY_A)).toBe(`${COMPANY_A}/files`);
  });

  it("rejects non-uuid companyId", () => {
    expect(() => filePrefix("not-a-uuid")).toThrow(InvalidStorageKeyError);
  });

  it("rejects empty companyId", () => {
    expect(() => filePrefix("")).toThrow(InvalidStorageKeyError);
  });
});
