import "reflect-metadata";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HrEmployeeAvatarService } from "./hr-employee-avatar.service";

/**
 * S5-HR-AVATAR-1 — HrEmployeeAvatarService UNIT (không DB). RED-first (deny-path TRƯỚC — CLAUDE.md §6):
 *   - assertWriteScope: thiếu update:employee (resolveAndAssert throw) → 403 KHÔNG chạm DB; CÓ update:employee
 *     nhưng scope Department/Team → 403 (fail-closed, plan-reviewer #3) KHÔNG ghi DB.
 *   - setEmployeeAvatar: file KHÔNG do HR sở hữu → 403 TRƯỚC confirm; non-image → 415; NV không tồn tại/đã
 *     soft-delete → 404; happy → link(created_by=HR)+avatar_url+audit; replace 2 lần (A→B) → stale link
 *     soft-deleted trước khi insert mới; 23505 → 409 (KHÔNG 500); audit before/after CHỈ {avatarUrl}.
 *   - removeEmployeeAvatar: idempotent (avatar_url đã null → KHÔNG ghi audit rác).
 * Deny-path HTTP thật (403/404/409 qua guard, cross-tenant) ở hr-employee-avatar.int-spec.ts (DB cô lập).
 */

const HR = { id: "hr-1", companyId: "c1" };
const EMP_ID = "e1";
const OLD_FILE = "old-file-1";
const NEW_FILE = "new-file-1";
const FAKE_TX = { __tx: true };

type Mock = ReturnType<typeof vi.fn>;

interface Deps {
  resolveAndAssert: Mock;
  findForAvatarUpdateTx: Mock;
  updateAvatarUrlTx: Mock;
  findByIdTx: Mock;
  upload: Mock;
  confirmUpload: Mock;
  listActiveByEntityTx: Mock;
  softDeleteTx: Mock;
  insertTx: Mock;
  accessLogRecord: Mock;
  auditRecord: Mock;
}

function makeService(over: Partial<Deps> = {}): { svc: HrEmployeeAvatarService; deps: Deps } {
  const deps: Deps = {
    resolveAndAssert: vi.fn(async () => "Company"),
    findForAvatarUpdateTx: vi.fn(async () => ({ id: EMP_ID, avatarUrl: null })),
    updateAvatarUrlTx: vi.fn(async () => undefined),
    findByIdTx: vi.fn(async () => ({
      id: NEW_FILE,
      ownerUserId: HR.id,
      uploadStatus: "Uploaded",
      scanStatus: "NotRequired",
      mimeType: "image/png",
    })),
    upload: vi.fn(async () => ({
      fileId: NEW_FILE,
      uploadStatus: "Pending",
      uploadUrl: "https://s3/put",
      expiresAt: "2026-01-01T00:00:00.000Z",
    })),
    confirmUpload: vi.fn(async () => ({
      fileId: NEW_FILE,
      uploadStatus: "Uploaded",
      sizeBytes: 10,
    })),
    listActiveByEntityTx: vi.fn(async () => []),
    softDeleteTx: vi.fn(async () => 1),
    insertTx: vi.fn(async (data: Record<string, unknown>) => ({ id: "link-new", ...data })),
    accessLogRecord: vi.fn(async () => undefined),
    auditRecord: vi.fn(async () => undefined),
    ...over,
  };

  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX)) };
  const dataScope = { resolveAndAssert: deps.resolveAndAssert };
  const files = { upload: deps.upload, confirmUpload: deps.confirmUpload };
  const fileRepo = { findByIdTx: deps.findByIdTx };
  const linkRepo = {
    listActiveByEntityTx: deps.listActiveByEntityTx,
    softDeleteTx: deps.softDeleteTx,
    insertTx: deps.insertTx,
  };
  const accessLog = { record: deps.accessLogRecord };
  const hrWriteRepo = {
    findForAvatarUpdateTx: deps.findForAvatarUpdateTx,
    updateAvatarUrlTx: deps.updateAvatarUrlTx,
  };
  const audit = { record: deps.auditRecord };

  const svc = new HrEmployeeAvatarService(
    db as never,
    dataScope as never,
    files as never,
    fileRepo as never,
    linkRepo as never,
    accessLog as never,
    hrWriteRepo as never,
    audit as never,
  );
  return { svc, deps };
}

beforeEach(() => vi.clearAllMocks());

describe("assertWriteScope (fail-closed, mirror HrWriteService)", () => {
  it("thiếu update:employee (resolveAndAssert ném Forbidden) → 403, KHÔNG chạm DB", async () => {
    const { svc, deps } = makeService({
      resolveAndAssert: vi.fn(async () => {
        throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
      }),
    });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deps.findForAvatarUpdateTx).not.toHaveBeenCalled();
  });

  it.each(["Department", "Team"])(
    "CÓ update:employee nhưng scope=%s → 403 (fail-closed), KHÔNG ghi DB",
    async (scope) => {
      const { svc, deps } = makeService({ resolveAndAssert: vi.fn(async () => scope) });
      await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(deps.findForAvatarUpdateTx).not.toHaveBeenCalled();
      expect(deps.updateAvatarUrlTx).not.toHaveBeenCalled();
    },
  );

  it("scope=Department chặn CẢ createUploadUrl và removeEmployeeAvatar", async () => {
    const { svc: svcA, deps: depsA } = makeService({
      resolveAndAssert: vi.fn(async () => "Department"),
    });
    await expect(
      svcA.createUploadUrl(HR, EMP_ID, {
        originalName: "a.png",
        declaredMimeType: "image/png",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(depsA.findForAvatarUpdateTx).not.toHaveBeenCalled();

    const { svc: svcB, deps: depsB } = makeService({
      resolveAndAssert: vi.fn(async () => "Department"),
    });
    await expect(svcB.removeEmployeeAvatar(HR, EMP_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(depsB.findForAvatarUpdateTx).not.toHaveBeenCalled();
  });
});

describe("createUploadUrl", () => {
  const IMG = { originalName: "avatar.png", declaredMimeType: "image/png", sizeBytes: 10 };

  it("NV không tồn tại → 404, KHÔNG register file", async () => {
    const { svc, deps } = makeService({ findForAvatarUpdateTx: vi.fn(async () => undefined) });
    await expect(svc.createUploadUrl(HR, EMP_ID, IMG)).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("declaredMimeType KHÔNG phải ảnh → 415, KHÔNG register file", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(HR, EMP_ID, { ...IMG, declaredMimeType: "text/plain" }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("ảnh hợp lệ + NV tồn tại → gọi files.upload (owner=HR, Private) + trả presigned-PUT", async () => {
    const { svc, deps } = makeService();
    const res = await svc.createUploadUrl(HR, EMP_ID, IMG);
    expect(deps.upload).toHaveBeenCalledWith(
      { id: HR.id, companyId: HR.companyId },
      {
        originalName: "avatar.png",
        declaredMimeType: "image/png",
        sizeBytes: 10,
        visibility: "Private",
      },
    );
    expect(res).toEqual({
      fileId: NEW_FILE,
      uploadUrl: "https://s3/put",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("setEmployeeAvatar", () => {
  it("NV không tồn tại/đã soft-delete → 404, KHÔNG chạm file/link", async () => {
    const { svc, deps } = makeService({ findForAvatarUpdateTx: vi.fn(async () => undefined) });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deps.findByIdTx).not.toHaveBeenCalled();
    expect(deps.insertTx).not.toHaveBeenCalled();
  });

  it("file không tồn tại → 404", async () => {
    const { svc } = makeService({ findByIdTx: vi.fn(async () => undefined) });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("IDOR — file KHÔNG do HR upload (owner khác) → 403 TRƯỚC confirm/link", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => ({
        id: NEW_FILE,
        ownerUserId: "someone-else",
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
        mimeType: "image/png",
      })),
    });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deps.confirmUpload).not.toHaveBeenCalled();
    expect(deps.insertTx).not.toHaveBeenCalled();
  });

  it("file KHÔNG phải ảnh → 415, KHÔNG link/ghi avatar_url", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => ({
        id: NEW_FILE,
        ownerUserId: HR.id,
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
        mimeType: "application/pdf",
      })),
    });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(deps.insertTx).not.toHaveBeenCalled();
    expect(deps.updateAvatarUrlTx).not.toHaveBeenCalled();
  });

  it("file Infected → 409, KHÔNG link", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => ({
        id: NEW_FILE,
        ownerUserId: HR.id,
        uploadStatus: "Uploaded",
        scanStatus: "Infected",
        mimeType: "image/png",
      })),
    });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deps.insertTx).not.toHaveBeenCalled();
  });

  it("file Pending (chưa confirm) → gọi confirmUpload rồi refetch, tiếp tục thành công", async () => {
    const findByIdTx = vi
      .fn()
      .mockResolvedValueOnce({
        id: NEW_FILE,
        ownerUserId: HR.id,
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
        mimeType: "image/png",
      })
      .mockResolvedValueOnce({
        id: NEW_FILE,
        ownerUserId: HR.id,
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
        mimeType: "image/png",
      });
    const { svc, deps } = makeService({ findByIdTx });
    const res = await svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE);
    expect(deps.confirmUpload).toHaveBeenCalledWith(
      { id: HR.id, companyId: HR.companyId },
      NEW_FILE,
      {},
    );
    expect(res).toEqual({ fileId: NEW_FILE });
  });

  it("happy — link(created_by=HR, isPrimary, accessScope Owner) + avatar_url=fileId + audit avatar-update", async () => {
    const { svc, deps } = makeService();
    const res = await svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE);

    expect(res).toEqual({ fileId: NEW_FILE });
    expect(deps.insertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: HR.companyId,
        fileId: NEW_FILE,
        moduleCode: "ME",
        entityType: "avatar",
        entityId: EMP_ID,
        linkType: "Avatar",
        accessScope: "Owner",
        isPrimary: true,
        createdBy: HR.id,
      }),
      FAKE_TX,
    );
    expect(deps.updateAvatarUrlTx).toHaveBeenCalledWith(FAKE_TX, HR.companyId, EMP_ID, NEW_FILE);

    expect(deps.auditRecord).toHaveBeenCalledTimes(1);
    const [, entry] = deps.auditRecord.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry.action).toBe("avatar-update");
    expect(entry.objectType).toBe("employee");
    expect(entry.objectId).toBe(EMP_ID);
    expect(entry.actorUserId).toBe(HR.id);
    expect(entry.before).toEqual({ avatarUrl: null });
    expect(entry.after).toEqual({ avatarUrl: NEW_FILE });
    // BẤT BIẾN #3 — before/after CHỈ {avatarUrl}, KHÔNG PII/storage_path.
    expect(Object.keys(entry.before as object)).toEqual(["avatarUrl"]);
    expect(Object.keys(entry.after as object)).toEqual(["avatarUrl"]);
  });

  it("replace 2 lần (A→B) — link A stale bị soft-delete + logged Unlink TRƯỚC khi insert link B", async () => {
    const { svc, deps } = makeService({
      findForAvatarUpdateTx: vi.fn(async () => ({ id: EMP_ID, avatarUrl: OLD_FILE })),
      listActiveByEntityTx: vi.fn(async () => [{ id: "link-A", fileId: OLD_FILE }]),
    });
    await svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE);

    expect(deps.softDeleteTx).toHaveBeenCalledWith(HR.companyId, "link-A", HR.id, FAKE_TX);
    const unlinkCall = deps.accessLogRecord.mock.calls.find(
      (c) => (c[1] as { action: string }).action === "Unlink",
    );
    expect(unlinkCall).toBeTruthy();
    expect((unlinkCall![1] as { fileId: string }).fileId).toBe(OLD_FILE);

    // softDelete TRƯỚC insert (order) — insert vẫn thành công (không đụng uq_primary vì stale đã gỡ).
    const softDeleteOrder = deps.softDeleteTx.mock.invocationCallOrder[0];
    const insertOrder = deps.insertTx.mock.invocationCallOrder[0];
    expect(softDeleteOrder).toBeLessThan(insertOrder);

    expect(deps.insertTx).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: NEW_FILE, createdBy: HR.id }),
      FAKE_TX,
    );
  });

  it("23505 (unique-violation) ở insertTx → 409 ConflictException (KHÔNG 500)", async () => {
    const pgErr = Object.assign(new Error("duplicate key"), { code: "23505" });
    const { svc, deps } = makeService({
      insertTx: vi.fn(async () => {
        throw pgErr;
      }),
    });
    await expect(svc.setEmployeeAvatar(HR, EMP_ID, NEW_FILE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deps.updateAvatarUrlTx).not.toHaveBeenCalled();
  });
});

describe("removeEmployeeAvatar", () => {
  it("NV không tồn tại → 404", async () => {
    const { svc } = makeService({ findForAvatarUpdateTx: vi.fn(async () => undefined) });
    await expect(svc.removeEmployeeAvatar(HR, EMP_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("idempotent — avatar_url đã null → KHÔNG ghi audit rác, KHÔNG gọi updateAvatarUrlTx", async () => {
    const { svc, deps } = makeService({
      findForAvatarUpdateTx: vi.fn(async () => ({ id: EMP_ID, avatarUrl: null })),
    });
    await svc.removeEmployeeAvatar(HR, EMP_ID);
    expect(deps.updateAvatarUrlTx).not.toHaveBeenCalled();
    expect(deps.auditRecord).not.toHaveBeenCalled();
  });

  it("happy — gỡ link stale + avatar_url=null + audit avatar-remove", async () => {
    const { svc, deps } = makeService({
      findForAvatarUpdateTx: vi.fn(async () => ({ id: EMP_ID, avatarUrl: OLD_FILE })),
      listActiveByEntityTx: vi.fn(async () => [{ id: "link-A", fileId: OLD_FILE }]),
    });
    await svc.removeEmployeeAvatar(HR, EMP_ID);

    expect(deps.softDeleteTx).toHaveBeenCalledWith(HR.companyId, "link-A", HR.id, FAKE_TX);
    expect(deps.updateAvatarUrlTx).toHaveBeenCalledWith(FAKE_TX, HR.companyId, EMP_ID, null);

    expect(deps.auditRecord).toHaveBeenCalledTimes(1);
    const [, entry] = deps.auditRecord.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry.action).toBe("avatar-remove");
    expect(entry.objectType).toBe("employee");
    expect(entry.before).toEqual({ avatarUrl: OLD_FILE });
    expect(entry.after).toEqual({ avatarUrl: null });
  });
});
