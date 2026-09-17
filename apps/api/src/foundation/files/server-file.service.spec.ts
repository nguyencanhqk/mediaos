import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService, TenantTx } from "../../db/db.service";
import type { StorageAdapter } from "../../storage/storage-adapter.port";
import type { FileAccessLogService } from "./file-access-log.service";
import type { ServerFileRepository, ServerFileRow } from "./server-file.repository";
import { ServerFileNotDownloadableError, ServerFileService } from "./server-file.service";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TX = { __tx: true } as unknown as TenantTx;
const LINK = { moduleCode: "PAYROLL", entityType: "payslip-pdf", entityId: "e1" };

function harness(markStoredReturns = 1) {
  const repo = {
    insertReservedTx: vi.fn(async () => ({ createdAt: new Date("2026-09-17T00:00:00Z") })),
    markStoredTx: vi.fn(async () => markStoredReturns),
    markFailedTx: vi.fn(async () => 1),
    findLatestLiveTx: vi.fn(async () => null),
    findByIdTx: vi.fn(async () => null),
  };
  const accessLog = { record: vi.fn(async () => undefined) };
  const storage = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ url: "https://s3/x?X-Amz-Expires=300", expiresAt: new Date(0) })),
  };
  const db = {
    withTenant: async <T>(_c: string, fn: (tx: TenantTx) => Promise<T>) => fn(TX),
  } as unknown as DatabaseService;
  const svc = new ServerFileService(
    db,
    repo as unknown as ServerFileRepository,
    accessLog as unknown as FileAccessLogService,
    storage as unknown as StorageAdapter,
  );
  return { svc, repo, accessLog, storage };
}

const fileRow = (over: Partial<ServerFileRow> = {}): ServerFileRow => ({
  id: "f1",
  originalName: "phieu-luong-2026-08.pdf",
  mimeType: "application/pdf",
  storagePath: `${COMPANY}/files/f1`,
  uploadStatus: "Uploaded",
  scanStatus: "NotRequired",
  uploadedBy: USER,
  metadata: {},
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000),
  link: { linkId: "l1", ...LINK },
  ...over,
});

describe("ServerFileService", () => {
  afterEach(() => {
    delete process.env.S3_PRESIGN_TTL_SEC;
  });

  it("reserveTx: hàng Pending tạm có hạn + link + log Upload, key trong prefix tenant", async () => {
    const h = harness();
    const before = Date.now();
    const reserved = await h.svc.reserveTx(TX, {
      companyId: COMPANY,
      actorUserId: USER,
      originalName: "phieu-luong-2026-08.pdf",
      kind: "pdf",
      ttlSec: 900,
      link: LINK,
      metadata: { k: 1 },
    });
    expect(reserved.storageKey).toBe(`${COMPANY}/files/${reserved.fileId}`);
    const expiresIn = reserved.expiresAt.getTime() - before;
    expect(expiresIn).toBeGreaterThanOrEqual(900_000 - 50);
    expect(expiresIn).toBeLessThanOrEqual(900_000 + 1000);
    expect(h.repo.insertReservedTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        id: reserved.fileId,
        mimeType: "application/pdf",
        actorUserId: USER,
        metadata: { k: 1 },
        link: LINK,
      }),
    );
    expect(h.accessLog.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ fileId: reserved.fileId, action: "Upload", accessGranted: true }),
    );
  });

  it("store: PUT đúng content-type + companyId, rồi đánh dấu Uploaded với sha256 của CHÍNH bytes", async () => {
    const h = harness();
    const bytes = new Uint8Array([1, 2, 3]);
    const ok = await h.svc.store(
      COMPANY,
      { fileId: "f1", storageKey: `${COMPANY}/files/f1` },
      "zip",
      bytes,
    );
    expect(ok).toBe(true);
    expect(h.storage.put).toHaveBeenCalledWith({
      key: `${COMPANY}/files/f1`,
      companyId: COMPANY,
      body: bytes,
      contentType: "application/zip",
    });
    expect(h.repo.markStoredTx).toHaveBeenCalledWith(TX, COMPANY, "f1", {
      sizeBytes: 3,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("store: PUT lỗi ⇒ NÉM, không đánh dấu Uploaded", async () => {
    const h = harness();
    h.storage.put.mockRejectedValueOnce(new Error("s3 down"));
    await expect(
      h.svc.store(COMPANY, { fileId: "f1", storageKey: "k" }, "pdf", new Uint8Array([1])),
    ).rejects.toThrow("s3 down");
    expect(h.repo.markStoredTx).not.toHaveBeenCalled();
  });

  it("store: hàng không còn Pending ⇒ false (người gọi quyết)", async () => {
    const h = harness(0);
    await expect(
      h.svc.store(COMPANY, { fileId: "f1", storageKey: "k" }, "pdf", new Uint8Array([1])),
    ).resolves.toBe(false);
  });

  it.each([
    ["Pending", "NotRequired"],
    ["Failed", "NotRequired"],
    ["Uploaded", "Infected"],
  ])("issueUrlTx: %s/%s ⇒ NÉM, không ký, không log", async (uploadStatus, scanStatus) => {
    const h = harness();
    await expect(
      h.svc.issueUrlTx(TX, COMPANY, USER, fileRow({ uploadStatus, scanStatus })),
    ).rejects.toBeInstanceOf(ServerFileNotDownloadableError);
    expect(h.storage.get).not.toHaveBeenCalled();
    expect(h.accessLog.record).not.toHaveBeenCalled();
  });

  it("issueUrlTx: Uploaded ⇒ ký bằng companyId + log GenerateSignedUrl gắn link", async () => {
    const h = harness();
    const url = await h.svc.issueUrlTx(TX, COMPANY, USER, fileRow());
    expect(url.url).toContain("X-Amz-Expires");
    expect(h.storage.get).toHaveBeenCalledWith({ key: `${COMPANY}/files/f1`, companyId: COMPANY });
    expect(h.accessLog.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: "GenerateSignedUrl",
        accessGranted: true,
        actorUserId: USER,
        fileLinkId: "l1",
        moduleCode: "PAYROLL",
      }),
    );
  });

  it("findLatestLiveTx: chỉ nhận tệp còn hạn DÀI HƠN một chữ ký URL (TTL env)", async () => {
    process.env.S3_PRESIGN_TTL_SEC = "600";
    const h = harness();
    const before = Date.now();
    await h.svc.findLatestLiveTx(TX, COMPANY, LINK, USER);
    const aliveAfter = (h.repo.findLatestLiveTx.mock.calls[0] as unknown[])[4] as Date;
    expect(aliveAfter.getTime() - before).toBeGreaterThanOrEqual(600_000 - 50);
    expect(aliveAfter.getTime() - before).toBeLessThanOrEqual(600_000 + 1000);
  });

  it.each([
    [undefined, 300],
    ["abc", 300],
    ["0", 300],
    ["999999", 3600],
  ])("presignTtlSec env=%j ⇒ %i (mặc định/trần như adapter)", (env, expected) => {
    if (env === undefined) delete process.env.S3_PRESIGN_TTL_SEC;
    else process.env.S3_PRESIGN_TTL_SEC = env;
    expect(ServerFileService.presignTtlSec()).toBe(expected);
  });
});
