/**
 * FileService — confirmUpload · getDownloadUrl download_count · AuditService masking (tách khỏi
 * files.service.spec.ts — S16-SOCIAL-FILESVCSPLIT-1; harness chung ở files.service.harness.ts).
 */
import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../../events/audit.service";
import {
  COMPANY,
  FILE,
  makeFileRow,
  makeHarness,
  user,
  type Harness,
} from "./files.service.harness";

// S2-FND-FILE-2 — confirmUpload state transitions (Pending → Uploaded / Failed) ─────────
describe("FileService.confirmUpload (S2-FND-FILE-2)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("missing / cross-tenant file (row undefined) → NotFound, storage NOT touched, no state change", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(undefined);
    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(h.storage.stat).not.toHaveBeenCalled();
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
    expect(h.fileRepo.markFailedTx).not.toHaveBeenCalled();
  });

  it("tệp TẠM do hệ thống sinh → 404 sentinel, storage KHÔNG chạm, trạng thái giữ (BE-5B §8.2 #4)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Pending", isTemporary: true }),
    );
    await expect(h.service.confirmUpload(user, FILE, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(h.storage.stat).not.toHaveBeenCalled();
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
    expect(h.fileRepo.markFailedTx).not.toHaveBeenCalled();
  });

  it("happy path: exists + size matches → stat+getBytes+sha256 → markUploaded, returns Uploaded", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Pending", fileSizeBytes: 4 }),
    );
    h.storage.stat.mockResolvedValue({
      exists: true,
      sizeBytes: 4,
      contentType: "application/pdf",
    });
    h.storage.getBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    const res = await h.service.confirmUpload(user, FILE, {});
    expect(res).toMatchObject({ fileId: FILE, uploadStatus: "Uploaded", sizeBytes: 4 });
    expect(h.fileRepo.markUploadedTx).toHaveBeenCalledTimes(1);
    // server-side checksum persisted; confirm RESPONSE must NOT leak the checksum (BẤT BIẾN #2.3).
    const persisted = h.fileRepo.markUploadedTx.mock.calls[0][2];
    expect(persisted.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res).not.toHaveProperty("checksumSha256");
    expect(h.fileRepo.markFailedTx).not.toHaveBeenCalled();
  });

  it("object absent → markFailed('object-absent') + 422 FOUNDATION-FILE-ERR-CONFIRM-ABSENT, checksum NOT persisted", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ uploadStatus: "Pending" }));
    h.storage.stat.mockResolvedValue({ exists: false, sizeBytes: null, contentType: null });

    const caught = await h.service.confirmUpload(user, FILE, {}).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as { getResponse(): { code?: string } }).getResponse().code).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-ABSENT",
    );
    expect(h.fileRepo.markFailedTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markFailedTx.mock.calls[0][2]).toBe("object-absent");
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
    expect(h.storage.getBytes).not.toHaveBeenCalled();
  });

  it("size mismatch → markFailed('size-mismatch') + 409 FOUNDATION-FILE-ERR-CONFIRM-MISMATCH, no checksum", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Pending", fileSizeBytes: 1024 }),
    );
    h.storage.stat.mockResolvedValue({
      exists: true,
      sizeBytes: 9999,
      contentType: "application/pdf",
    });

    const caught = await h.service.confirmUpload(user, FILE, {}).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as { getResponse(): { code?: string } }).getResponse().code).toBe(
      "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH",
    );
    expect(h.fileRepo.markFailedTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.markFailedTx.mock.calls[0][2]).toBe("size-mismatch");
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
    expect(h.storage.getBytes).not.toHaveBeenCalled();
  });

  it("already Uploaded → idempotent 200 (returns Uploaded, no storage/mark)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Uploaded", fileSizeBytes: 1024 }),
    );
    const res = await h.service.confirmUpload(user, FILE, {});
    expect(res).toMatchObject({ fileId: FILE, uploadStatus: "Uploaded" });
    expect(h.storage.stat).not.toHaveBeenCalled();
    expect(h.fileRepo.markUploadedTx).not.toHaveBeenCalled();
  });

  it("non-Pending non-Uploaded (Failed) → 409 FOUNDATION-FILE-ERR-NOT-PENDING", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(makeFileRow({ uploadStatus: "Failed" }));
    const caught = await h.service.confirmUpload(user, FILE, {}).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as { getResponse(): { code?: string } }).getResponse().code).toBe(
      "FOUNDATION-FILE-ERR-NOT-PENDING",
    );
    expect(h.storage.stat).not.toHaveBeenCalled();
  });
});

// S2-FND-FILE-2 — download bumps download_count best-effort (counter failure must not fail download) ──
describe("getDownloadUrl download_count (best-effort)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("ALLOW + Uploaded → increments download_count once", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Uploaded", scanStatus: "Clean" }),
    );
    await h.service.getDownloadUrl(user, FILE);
    expect(h.fileRepo.incrementDownloadCountTx).toHaveBeenCalledTimes(1);
    expect(h.fileRepo.incrementDownloadCountTx).toHaveBeenCalledWith(
      COMPANY,
      FILE,
      expect.anything(),
    );
  });

  it("counter update failure does NOT fail the download (best-effort, swallowed-with-log)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(
      makeFileRow({ uploadStatus: "Uploaded", scanStatus: "Clean" }),
    );
    h.fileRepo.incrementDownloadCountTx.mockRejectedValue(new Error("counter update failed"));
    const dto = await h.service.getDownloadUrl(user, FILE);
    expect(dto.url).toMatch(/^https:\/\//); // download still succeeds despite counter failure
  });
});

// 7. audit masking — storage_path/signed_url → '***' ────────────────────────────────
describe("AuditService masking (storage_path / signed_url → '***')", () => {
  it("masks before/after keys containing storage_path and signed_url", async () => {
    const audit = new AuditService();
    const captured: Record<string, unknown>[] = [];
    const tx = {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          captured.push(row);
        },
      }),
    };

    await audit.record(tx as never, {
      action: "FileUploaded",
      objectType: "file",
      objectId: FILE,
      after: {
        storage_path: `${COMPANY}/files/${FILE}`,
        signed_url: "https://x/y?sig=abc",
        originalName: "doc.pdf",
      },
    });

    const row = captured[0];
    const after = row.after as Record<string, unknown>;
    expect(after.storage_path).toBe("***");
    expect(after.signed_url).toBe("***");
    expect(after.originalName).toBe("doc.pdf"); // non-sensitive preserved
  });
});
