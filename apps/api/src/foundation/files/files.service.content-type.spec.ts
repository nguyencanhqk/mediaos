/**
 * S16-SOCIAL-FILEDISPOSITION-1 — FileService: kiểu nội dung trên đường đăng ký / xác nhận / tải
 * (unit cạnh nguồn, không DB, không storage thật).
 *
 * File RIÊNG — `files.service.spec.ts` đã quá dài nên ca mới của WO này không thêm vào đó. Khung giả lập
 * dựng theo đúng khung của file ấy: `withTenant` chạy callback với một tx giả; repo / policy / settings /
 * storage là `vi.fn`. Khác một điểm: `stat` mặc định trả CẢ `contentType` (hình dạng `StorageStatResult`).
 *
 * Ca:
 *   F7 — `getDownloadUrl` chuyển MIME đã đăng ký + tên gốc của hàng xuống `storage.get`.
 */
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FileAccessLogService } from "./file-access-log.service";
import type { FilePolicyDecision } from "./file-policy.types";
import { FileService } from "./files.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";
const STORAGE_PATH = `${COMPANY}/files/${FILE}`;

const user = { id: USER, companyId: COMPANY };

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-foundation" };

function makeFileRow(overrides: Record<string, unknown> = {}) {
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
    storagePath: STORAGE_PATH,
    checksumSha256: null,
    contentHash: null,
    visibility: "Private",
    uploadStatus: "Pending",
    scanStatus: "NotRequired",
    scanResult: null,
    ownerUserId: USER,
    uploadedBy: USER,
    uploadedAt: new Date("2026-10-08T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-10-08T00:00:00Z"),
    updatedAt: new Date("2026-10-08T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function makeHarness(policyDecision: FilePolicyDecision = ALLOW) {
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => ({ returning: async () => [row] }),
    }),
  };
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(fakeTx),
    ),
  };
  const fileRepo = {
    findByIdTx: vi.fn(),
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
    decideForLinkedFile: vi.fn(async () => policyDecision),
    canonicalOwnerKey: vi.fn(() => null),
  };
  const storage = {
    get: vi.fn(async () => ({
      url: "https://signed.example/get",
      expiresAt: new Date("2026-10-08T00:05:00Z"),
    })),
    put: vi.fn(),
    delete: vi.fn(),
    signedUrl: vi.fn(async () => ({
      url: "https://signed.example/put",
      expiresAt: new Date("2026-10-08T00:05:00Z"),
    })),
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
        value: ["exe", "bat", "sh"],
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

  return { service, db, fileRepo, linkRepo, accessLogSpy, audit, policy, storage, settings };
}

describe("FileService.getDownloadUrl — kiểu đã đăng ký đi xuống tầng ký", () => {
  it("F7 — storage.get nhận registeredMimeType = row.mimeType và fileName = row.originalName", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
        mimeType: "application/pdf",
        originalName: "hợp đồng (1).pdf",
      }),
    );

    const dto = await h.service.getDownloadUrl(user, FILE);

    expect(dto.url).toBe("https://signed.example/get");
    expect(h.storage.get).toHaveBeenCalledTimes(1);
    expect(h.storage.get).toHaveBeenCalledWith({
      key: STORAGE_PATH,
      companyId: COMPANY,
      registeredMimeType: "application/pdf",
      fileName: "hợp đồng (1).pdf",
    });
  });

  it("F7 — hai chuỗi của hàng đi NGUYÊN VĂN (thường hoá và quyết định attachment là việc của tầng ký)", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
        mimeType: "Text/HTML; charset=utf-8",
        originalName: "trang cũ.html",
      }),
    );

    await h.service.getDownloadUrl(user, FILE);

    expect(h.storage.get).toHaveBeenCalledWith({
      key: STORAGE_PATH,
      companyId: COMPANY,
      registeredMimeType: "Text/HTML; charset=utf-8",
      fileName: "trang cũ.html",
    });
  });

  it("F7 — TỪ CHỐI: hàng chưa Uploaded ⇒ 409, storage.get KHÔNG được gọi (không ký với bất kỳ kiểu nào)", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ uploadStatus: "Pending" }));

    await expect(h.service.getDownloadUrl(user, FILE)).rejects.toBeInstanceOf(ConflictException);

    expect(h.storage.get).not.toHaveBeenCalled();
  });
});
