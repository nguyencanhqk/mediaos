/**
 * S2-FND-FILE-2 (lane FILE2-A-storage-port) — S3StorageAdapter.stat / getBytes PORT mapping.
 *
 * RED-first: `stat`/`getBytes` do not exist yet on S3StorageAdapter — these tests fail until they're
 * added. Verifies the adapter is a thin, argument-preserving mapping onto ObjectStorageService
 * (composition, per the file header contract) — no extra logic, no TTL/clamp involvement (stat/
 * getBytes are not presigned operations).
 */
import { describe, expect, it, vi } from "vitest";
import { S3StorageAdapter } from "./s3-storage.adapter";
import type { ObjectStorageService } from "./object-storage.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KEY_A = `${COMPANY_A}/files/cccccccc-cccc-cccc-cccc-cccccccccccc`;

function buildFakeObjectStorage() {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    statObject: vi.fn(),
    getObjectBytes: vi.fn(),
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
  } as unknown as ObjectStorageService;
}

describe("S3StorageAdapter.stat", () => {
  it("delegates to ObjectStorageService.statObject with (key, companyId) unchanged", async () => {
    const fakeStorage = buildFakeObjectStorage();
    (fakeStorage.statObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      sizeBytes: 999,
    });
    const adapter = new S3StorageAdapter(fakeStorage);

    const result = await adapter.stat({ key: KEY_A, companyId: COMPANY_A });

    expect(result).toEqual({ exists: true, sizeBytes: 999 });
    expect(fakeStorage.statObject).toHaveBeenCalledWith(KEY_A, COMPANY_A);
  });

  it("propagates exists=false + sizeBytes=null from the service unchanged (no re-interpretation)", async () => {
    const fakeStorage = buildFakeObjectStorage();
    (fakeStorage.statObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: false,
      sizeBytes: null,
    });
    const adapter = new S3StorageAdapter(fakeStorage);

    const result = await adapter.stat({ key: KEY_A, companyId: COMPANY_A });

    expect(result).toEqual({ exists: false, sizeBytes: null });
  });

  it("propagates a rejection from the service (does not swallow errors)", async () => {
    const fakeStorage = buildFakeObjectStorage();
    const boom = new Error("boom");
    (fakeStorage.statObject as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
    const adapter = new S3StorageAdapter(fakeStorage);

    await expect(adapter.stat({ key: KEY_A, companyId: COMPANY_A })).rejects.toBe(boom);
  });
});

describe("S3StorageAdapter.getBytes", () => {
  it("delegates to ObjectStorageService.getObjectBytes with (key, companyId) unchanged", async () => {
    const fakeStorage = buildFakeObjectStorage();
    const bytes = new Uint8Array([9, 9, 9]);
    (fakeStorage.getObjectBytes as ReturnType<typeof vi.fn>).mockResolvedValue(bytes);
    const adapter = new S3StorageAdapter(fakeStorage);

    const result = await adapter.getBytes({ key: KEY_A, companyId: COMPANY_A });

    expect(result).toBe(bytes);
    expect(fakeStorage.getObjectBytes).toHaveBeenCalledWith(KEY_A, COMPANY_A);
  });

  it("propagates a rejection from the service (does not swallow errors)", async () => {
    const fakeStorage = buildFakeObjectStorage();
    const boom = new Error("boom");
    (fakeStorage.getObjectBytes as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
    const adapter = new S3StorageAdapter(fakeStorage);

    await expect(adapter.getBytes({ key: KEY_A, companyId: COMPANY_A })).rejects.toBe(boom);
  });
});
