/**
 * S2-FND-FILE-2 (lane FILE2-A-storage-port) — S3StorageAdapter.stat / getBytes PORT mapping.
 *
 * RED-first: `stat`/`getBytes` do not exist yet on S3StorageAdapter — these tests fail until they're
 * added. Verifies the adapter is a thin, argument-preserving mapping onto ObjectStorageService
 * (composition, per the file header contract) — no extra logic, no TTL/clamp involvement (stat/
 * getBytes are not presigned operations).
 *
 * S2-FND-FILE-2-FIX-C (2026-07-04): closes the QA06-FILE-003 (signed-URL expiry) coverage GAP flagged
 * by Đội 3 review — `resolveTtl` (the private TTL-clamp helper exercised via `get()`/`signedUrl()`)
 * was implemented but had NO test coverage; this file previously only covered `stat`/`getBytes`. The
 * clamp/env-default behaviour under test already exists in production code (S2-FND-FILE-2-B) — these
 * are characterization tests locking in that behaviour, not a new feature.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { S3StorageAdapter } from "./s3-storage.adapter";
import type { ObjectStorageService } from "./object-storage.service";
import { DEFAULT_PRESIGN_TTL_SEC, type SignedUrlResult } from "./storage-adapter.port";

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

// ─── QA06-FILE-003 — signed-URL expiry / resolveTtl clamp ──────────────────────────────────────────

/**
 * Hard cap on presign TTL, mirrored from the private `MAX_PRESIGN_TTL_SEC` constant in
 * s3-storage.adapter.ts (not exported — same numeric contract asserted here as a characterization
 * value). Both presign-producing PORT methods (`get` for download, `signedUrl` for upload) funnel
 * through the same private `resolveTtl` helper, so both must clamp identically.
 */
const MAX_PRESIGN_TTL_SEC = 3600;

describe("S3StorageAdapter — resolveTtl clamp (QA06-FILE-003 signed-URL expiry)", () => {
  const NOW = new Date("2026-07-04T00:00:00.000Z");
  let originalEnvTtl: string | undefined;

  beforeEach(() => {
    originalEnvTtl = process.env.S3_PRESIGN_TTL_SEC;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalEnvTtl === undefined) delete process.env.S3_PRESIGN_TTL_SEC;
    else process.env.S3_PRESIGN_TTL_SEC = originalEnvTtl;
  });

  /** Both PORT methods that produce an ephemeral presigned URL — `get` (download) and `signedUrl`
   *  (upload) — must clamp/resolve TTL identically since they share the private `resolveTtl` helper. */
  const presignMethods: Array<{
    name: "get" | "signedUrl";
    call: (adapter: S3StorageAdapter, presignTtlSec?: number) => Promise<SignedUrlResult>;
  }> = [
    {
      name: "get",
      call: (adapter, presignTtlSec) =>
        adapter.get({ key: KEY_A, companyId: COMPANY_A, presignTtlSec }),
    },
    {
      name: "signedUrl",
      call: (adapter, presignTtlSec) =>
        adapter.signedUrl({
          key: KEY_A,
          contentType: "application/pdf",
          sizeBytes: 100,
          presignTtlSec,
        }),
    },
  ];

  for (const { name, call } of presignMethods) {
    describe(`${name}()`, () => {
      it(`clamps a per-call TTL above MAX_PRESIGN_TTL_SEC (${MAX_PRESIGN_TTL_SEC}s) down to the cap and logs a warning`, async () => {
        delete process.env.S3_PRESIGN_TTL_SEC;
        const fakeStorage = buildFakeObjectStorage();
        const adapter = new S3StorageAdapter(fakeStorage);
        const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

        const result = await call(adapter, 999_999); // far above the 3600s ceiling

        expect(result.expiresAt).toEqual(new Date(NOW.getTime() + MAX_PRESIGN_TTL_SEC * 1000));
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain("clamped");
      });

      it("keeps a valid per-call TTL at/below the cap unchanged and does NOT log a warning", async () => {
        delete process.env.S3_PRESIGN_TTL_SEC;
        const fakeStorage = buildFakeObjectStorage();
        const adapter = new S3StorageAdapter(fakeStorage);
        const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

        const result = await call(adapter, 900); // valid, well under the 3600s ceiling

        expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 900 * 1000));
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("uses env S3_PRESIGN_TTL_SEC when no per-call override is given", async () => {
        process.env.S3_PRESIGN_TTL_SEC = "1200";
        const fakeStorage = buildFakeObjectStorage();
        const adapter = new S3StorageAdapter(fakeStorage);

        const result = await call(adapter, undefined);

        expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 1200 * 1000));
      });

      it(`falls back to DEFAULT_PRESIGN_TTL_SEC (${DEFAULT_PRESIGN_TTL_SEC}s) when env is absent and no override is given`, async () => {
        delete process.env.S3_PRESIGN_TTL_SEC;
        const fakeStorage = buildFakeObjectStorage();
        const adapter = new S3StorageAdapter(fakeStorage);

        const result = await call(adapter, undefined);

        expect(result.expiresAt).toEqual(new Date(NOW.getTime() + DEFAULT_PRESIGN_TTL_SEC * 1000));
      });
    });
  }
});
