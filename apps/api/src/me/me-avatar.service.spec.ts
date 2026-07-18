import "reflect-metadata";
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeAvatarService } from "./me-avatar.service";
import type { CurrentPerson } from "./me-current-person.resolver";

/**
 * S5-ME-BE-4 — MeAvatarService UNIT (không DB). Soi các nhánh crown mà silent-failure-hunter/security-reviewer
 * quan tâm nhất:
 *   - createUploadUrl: unlinked/non-image chặn TRƯỚC khi gọi FileService.upload (KHÔNG register file rác).
 *   - confirmOwnUpload: owner-check chạy TRƯỚC FileService.confirmUpload (IDOR — không confirm file người khác).
 *   - getCurrentAvatar: FAIL-SOFT narrow-by-type — Forbidden/NotFound/Conflict → null; lỗi hạ tầng KHÁC propagate.
 * Deny-path HTTP thật (403/409 qua guard) ở me-preferences-avatar.int-spec.ts (DB cô lập).
 */

const ACTOR = { id: "u1", companyId: "c1" };

const LINKED: CurrentPerson = {
  linkStatus: "linked",
  employee: {
    employeeId: "e1",
    employeeCode: "E1",
    fullName: "A",
    departmentName: "Dept",
    positionName: "Dev",
  },
};
const UNLINKED: CurrentPerson = { linkStatus: "unlinked", employee: null };

type Mock = ReturnType<typeof vi.fn>;

interface Deps {
  resolve: Mock;
  findByIdTx: Mock;
  upload: Mock;
  confirmUpload: Mock;
  getDownloadUrl: Mock;
  getAvatarFileIdTx: Mock;
}

function makeService(over: Partial<Deps> = {}): { svc: MeAvatarService; deps: Deps } {
  const deps: Deps = {
    resolve: vi.fn(async () => LINKED),
    findByIdTx: vi.fn(),
    upload: vi.fn(),
    confirmUpload: vi.fn(),
    getDownloadUrl: vi.fn(),
    getAvatarFileIdTx: vi.fn(),
    ...over,
  };

  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const currentPerson = { resolve: deps.resolve };
  const fileRepo = { findByIdTx: deps.findByIdTx };
  const linkRepo = { listActiveByEntityTx: vi.fn(async () => []) };
  const files = {
    upload: deps.upload,
    confirmUpload: deps.confirmUpload,
    getDownloadUrl: deps.getDownloadUrl,
    link: vi.fn(),
    unlink: vi.fn(),
  };
  const hrWrite = { updateOwnAvatar: vi.fn() };
  const repo = { getAvatarFileIdTx: deps.getAvatarFileIdTx };

  const svc = new MeAvatarService(
    db as never,
    currentPerson as never,
    fileRepo as never,
    linkRepo as never,
    files as never,
    hrWrite as never,
    repo as never,
  );
  return { svc, deps };
}

beforeEach(() => vi.clearAllMocks());

describe("createUploadUrl", () => {
  const IMG = { originalName: "avatar.png", declaredMimeType: "image/png", sizeBytes: 10 };

  it("unlinked-employee → ném ConflictException, KHÔNG register file", async () => {
    const { svc, deps } = makeService({ resolve: vi.fn(async () => UNLINKED) });
    await expect(svc.createUploadUrl(ACTOR, IMG)).rejects.toBeInstanceOf(ConflictException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("declaredMimeType KHÔNG phải ảnh → 415, KHÔNG register file", async () => {
    const { svc, deps } = makeService();
    await expect(
      svc.createUploadUrl(ACTOR, { ...IMG, declaredMimeType: "text/plain" }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("ảnh hợp lệ → gọi files.upload (Private, KHÔNG entityId) + trả presigned-PUT", async () => {
    const upload = vi.fn(async () => ({
      fileId: "f1",
      uploadStatus: "Pending",
      uploadUrl: "https://s3/put",
      expiresAt: "2026-01-01T00:00:00.000Z",
    }));
    const { svc } = makeService({ upload });
    const res = await svc.createUploadUrl(ACTOR, IMG);

    expect(upload).toHaveBeenCalledWith(
      { id: "u1", companyId: "c1" },
      {
        originalName: "avatar.png",
        declaredMimeType: "image/png",
        sizeBytes: 10,
        visibility: "Private",
      },
    );
    // KHÔNG lộ storage_path / uploadStatus dư — chỉ 3 field ephemeral.
    expect(res).toEqual({
      fileId: "f1",
      uploadUrl: "https://s3/put",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("confirmOwnUpload", () => {
  it("file không tồn tại → 404, KHÔNG gọi confirmUpload", async () => {
    const { svc, deps } = makeService({ findByIdTx: vi.fn(async () => undefined) });
    await expect(svc.confirmOwnUpload(ACTOR, "f1")).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.confirmUpload).not.toHaveBeenCalled();
  });

  it("IDOR — file DO NGƯỜI KHÁC upload → 403 TRƯỚC confirm (KHÔNG gọi confirmUpload)", async () => {
    const { svc, deps } = makeService({
      findByIdTx: vi.fn(async () => ({
        id: "f1",
        ownerUserId: "attacker",
        uploadStatus: "Pending",
      })),
    });
    await expect(svc.confirmOwnUpload(ACTOR, "f1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.confirmUpload).not.toHaveBeenCalled();
  });

  it("file của CHÍNH MÌNH → gọi confirmUpload + trả response", async () => {
    const confirmUpload = vi.fn(async () => ({
      fileId: "f1",
      uploadStatus: "Uploaded",
      sizeBytes: 10,
    }));
    const { svc } = makeService({
      findByIdTx: vi.fn(async () => ({ id: "f1", ownerUserId: "u1", uploadStatus: "Pending" })),
      confirmUpload,
    });
    const res = await svc.confirmOwnUpload(ACTOR, "f1");
    expect(confirmUpload).toHaveBeenCalledWith({ id: "u1", companyId: "c1" }, "f1", {});
    expect(res.uploadStatus).toBe("Uploaded");
  });
});

describe("getCurrentAvatar (fail-soft)", () => {
  it("unlinked → null (KHÔNG ném 409 trên read)", async () => {
    const { svc, deps } = makeService({ resolve: vi.fn(async () => UNLINKED) });
    await expect(svc.getCurrentAvatar(ACTOR)).resolves.toBeNull();
    expect(deps.getAvatarFileIdTx).not.toHaveBeenCalled();
  });

  it("chưa set avatar (avatar_url null) → null, KHÔNG gọi getDownloadUrl", async () => {
    const { svc, deps } = makeService({ getAvatarFileIdTx: vi.fn(async () => null) });
    await expect(svc.getCurrentAvatar(ACTOR)).resolves.toBeNull();
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("có avatar → trả {fileId, downloadUrl, expiresAt}", async () => {
    const { svc } = makeService({
      getAvatarFileIdTx: vi.fn(async () => "f1"),
      getDownloadUrl: vi.fn(async () => ({
        url: "https://s3/get",
        expiresAt: "2026-01-01T00:00:00.000Z",
      })),
    });
    await expect(svc.getCurrentAvatar(ACTOR)).resolves.toEqual({
      fileId: "f1",
      downloadUrl: "https://s3/get",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it.each([
    ["Forbidden", new ForbiddenException()],
    ["NotFound", new NotFoundException()],
    ["Conflict", new ConflictException()],
  ])("getDownloadUrl ném %s → degrade về null (không rethrow)", async (_label, err) => {
    const { svc } = makeService({
      getAvatarFileIdTx: vi.fn(async () => "f1"),
      getDownloadUrl: vi.fn(async () => {
        throw err;
      }),
    });
    await expect(svc.getCurrentAvatar(ACTOR)).resolves.toBeNull();
  });

  it("lỗi hạ tầng KHÁC (InternalServerError) → PROPAGATE (KHÔNG nuốt — chống silent-failure)", async () => {
    const { svc } = makeService({
      getAvatarFileIdTx: vi.fn(async () => "f1"),
      getDownloadUrl: vi.fn(async () => {
        throw new InternalServerErrorException("db down");
      }),
    });
    await expect(svc.getCurrentAvatar(ACTOR)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
