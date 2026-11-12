/**
 * Harness dùng chung của các spec FileService (tách khỏi files.service.spec.ts — S16-SOCIAL-FILESVCSPLIT-1).
 * withTenant giả gọi callback với tx giả; repo/policy/storage/settings là mock — xem files.service.spec.ts.
 */
import { vi } from "vitest";
import type { FilePolicyDecision } from "./file-policy.types";
import { FileAccessLogService } from "./file-access-log.service";
import { FileService } from "./files.service";

// ─── Fakes ──────────────────────────────────────────────────────────────────────

export const COMPANY = "11111111-1111-1111-1111-111111111111";
export const USER = "22222222-2222-2222-2222-222222222222";
export const FILE = "33333333-3333-3333-3333-333333333333";
/** Chủ tệp khác người gọi — ca từ chối qua fallback không rơi vào vế chủ tệp chưa từng gắn (S19-SEC-FILELINKGATE-1). */
export const OTHER_OWNER = "44444444-4444-4444-4444-444444444444";

export function makeFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE,
    companyId: COMPANY,
    originalName: "doc.pdf",
    storedName: FILE,
    fileExtension: "pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    storageProvider: "MinIO",
    storageBucket: null,
    storagePath: `${COMPANY}/files/${FILE}`,
    checksumSha256: null,
    contentHash: null,
    visibility: "Private",
    uploadStatus: "Pending",
    scanStatus: "NotRequired",
    scanResult: null,
    ownerUserId: USER,
    uploadedBy: USER,
    uploadedAt: new Date("2026-06-24T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-06-24T00:00:00Z"),
    updatedAt: new Date("2026-06-24T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

export const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-foundation" };
export const DENY: FilePolicyDecision = { allow: false, reason: "deny-foundation" };

export interface Harness {
  service: FileService;
  fileRepo: {
    findByIdTx: ReturnType<typeof vi.fn>;
    findByIdForUpdateTx: ReturnType<typeof vi.fn>;
    insertTx: ReturnType<typeof vi.fn>;
    listTx: ReturnType<typeof vi.fn>;
    countTx: ReturnType<typeof vi.fn>;
    softDeleteTx: ReturnType<typeof vi.fn>;
    markUploadedTx: ReturnType<typeof vi.fn>;
    markFailedTx: ReturnType<typeof vi.fn>;
    incrementDownloadCountTx: ReturnType<typeof vi.fn>;
  };
  linkRepo: {
    insertTx: ReturnType<typeof vi.fn>;
    findByIdTx: ReturnType<typeof vi.fn>;
    listByFileTx: ReturnType<typeof vi.fn>;
    hasEverBeenLinkedTx: ReturnType<typeof vi.fn>;
    softDeleteTx: ReturnType<typeof vi.fn>;
  };
  accessLog: FileAccessLogService;
  accessLogSpy: ReturnType<typeof vi.fn>;
  policy: {
    canView: ReturnType<typeof vi.fn>;
    canDownload: ReturnType<typeof vi.fn>;
    canLink: ReturnType<typeof vi.fn>;
    canUnlink: ReturnType<typeof vi.fn>;
    canDelete: ReturnType<typeof vi.fn>;
    decideForLinkedFile: ReturnType<typeof vi.fn>;
    canonicalOwnerKey: ReturnType<typeof vi.fn>;
  };
  storage: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    signedUrl: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    getBytes: ReturnType<typeof vi.fn>;
  };
  settings: { resolveMany: ReturnType<typeof vi.fn> };
  txInserts: { table: string; row: Record<string, unknown> }[];
}

export function makeHarness(policyDecision: FilePolicyDecision = ALLOW): Harness {
  const txInserts: { table: string; row: Record<string, unknown> }[] = [];

  // Fake tx — records access-log inserts so we can assert access_granted/denied_reason.
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        txInserts.push({ table: "fileAccessLogs", row });
        return { returning: async () => [row] };
      },
    }),
  };

  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(fakeTx),
    ),
  };

  const fileRepo = {
    findByIdTx: vi.fn(),
    findByIdForUpdateTx: vi.fn((...a: unknown[]): unknown => fileRepo.findByIdTx(...a)),
    insertTx: vi.fn(),
    listTx: vi.fn(async () => []),
    countTx: vi.fn(async () => 0),
    softDeleteTx: vi.fn(async () => 1),
    markUploadedTx: vi.fn(async () => 1),
    markFailedTx: vi.fn(async () => 1),
    incrementDownloadCountTx: vi.fn(async () => 1),
  };
  const linkRepo = {
    insertTx: vi.fn(),
    findByIdTx: vi.fn(),
    listByFileTx: vi.fn(async () => []),
    hasEverBeenLinkedTx: vi.fn(async () => false),
    softDeleteTx: vi.fn(async () => 1),
  };

  // Real FileAccessLogService but spy its record to assert entries (it writes to fakeTx anyway).
  const accessLog = new FileAccessLogService();
  const accessLogSpy = vi.fn(accessLog.record.bind(accessLog));
  accessLog.record = accessLogSpy as typeof accessLog.record;

  const audit = { record: vi.fn(async () => undefined) };

  const policy = {
    canView: vi.fn(async () => policyDecision),
    canDownload: vi.fn(async () => policyDecision),
    canLink: vi.fn(async () => policyDecision),
    canUnlink: vi.fn(async () => policyDecision),
    canDelete: vi.fn(async () => policyDecision),
    // S2-FND-BE-4 (H1): view/download/delete now go through the link-aware decision point. The default
    // mirrors the single-file decision (returns policyDecision) so existing ALLOW/DENY cases still hold;
    // link-aware branching itself is unit-tested in file-policy.service.spec.ts.
    decideForLinkedFile: vi.fn(async () => policyDecision),
    // S7-CHAT-BE-3 (FULL gate): `link()` từ chối khoá điều phối lệch chính tả TRƯỚC khi hỏi quyền.
    // Mặc định = chính cặp client khai (đã đăng ký, đúng chính tắc). `null` (không resolver nào nhận cặp) ⇒
    // biên gắn từ chối 400 (S19-SEC-FILELINKGATE-1) — ca riêng trong "link guards".
    canonicalOwnerKey: vi.fn((moduleCode: string, entityType: string) => ({
      moduleCode,
      entityType,
    })),
  };

  const storage = {
    get: vi.fn(async () => ({
      url: "https://signed.example/x",
      expiresAt: new Date("2026-06-24T00:05:00Z"),
    })),
    put: vi.fn(),
    delete: vi.fn(),
    // S2-FND-FILE-2 — register presigned-PUT (upload()) returns {url, expiresAt}.
    signedUrl: vi.fn(async () => ({
      url: "https://signed.example/put",
      expiresAt: new Date("2026-06-24T00:05:00Z"),
    })),
    // S2-FND-FILE-2 — confirm HEAD/GET. Defaults: object exists, size + stored type match the register fixture.
    stat: vi.fn(async () => ({ exists: true, sizeBytes: 1024, contentType: "application/pdf" })),
    getBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  };

  const settings = {
    resolveMany: vi.fn(async () => [
      {
        key: "file.allowed_mime_types",
        value: ["application/pdf", "image/png"],
        scope: "default",
        found: true,
      },
      { key: "file.max_upload_size_mb", value: 25, scope: "default", found: true },
      {
        key: "file.blocked_extensions",
        value: ["exe", "bat", "sh", "html", "svg", "js"],
        scope: "default",
        found: true,
      },
    ]),
  };

  const service = new FileService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    accessLog,
    audit as never,
    policy as never,
    settings as never,
    storage as never,
  );

  return {
    service,
    fileRepo,
    linkRepo,
    accessLog,
    accessLogSpy,
    policy,
    storage,
    settings,
    txInserts,
  };
}

export const user = { id: USER, companyId: COMPANY };
