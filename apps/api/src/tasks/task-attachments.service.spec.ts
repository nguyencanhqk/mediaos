/**
 * B4 — TaskAttachmentsService deny-path RED (mock repo/storage/audit, KHÔNG network).
 *
 * Hành vi MONG MUỐN:
 *  - Gate upload: user KHÔNG có create:task VÀ KHÔNG phải owner/assignee → ForbiddenException (403).
 *  - Owner/assignee (0-quyền create:task) → cho upload (nhánh OR).
 *  - create:task permission (không phải assignee) → cho upload (nhánh OR).
 *  - content-type ngoài allowlist → BadRequest (400) ở BIÊN service (KHÔNG chỉ DTO).
 *  - size > MAX_BYTES → BadRequest (400) ở biên service.
 *  - Upload hợp lệ → INSERT metadata + audit TaskAttachmentUploaded + presigned PUT (key server-side).
 *  - storage chưa cấu hình → ServiceUnavailable (fail-closed, KHÔNG fail-open).
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_MAX_BYTES, type CreateAttachmentIntentRequest } from "@mediaos/contracts";
import { TaskAttachmentsService } from "./task-attachments.service";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const TASK_ID = "33333333-3333-3333-3333-333333333333";
const ATTACH_ID = "44444444-4444-4444-4444-444444444444";

const USER = { id: ACTOR_ID, companyId: COMPANY_ID };

const VALID_DTO: CreateAttachmentIntentRequest = {
  fileName: "report.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
};

function makeRepo() {
  return {
    findRawByIdTx: vi
      .fn()
      .mockResolvedValue([
        { id: TASK_ID, taskType: "office", workflowStepId: null, status: "not_started" },
      ]),
    isTaskAssigneeTx: vi.fn().mockResolvedValue(false),
    createAttachment: vi.fn().mockResolvedValue([
      {
        id: ATTACH_ID,
        taskId: TASK_ID,
        fileName: VALID_DTO.fileName,
        contentType: VALID_DTO.contentType,
        sizeBytes: VALID_DTO.sizeBytes,
        uploadedBy: ACTOR_ID,
        createdAt: new Date("2026-06-16T00:00:00.000Z"),
      },
    ]),
    listAttachmentsByTask: vi.fn().mockResolvedValue([]),
    findAttachmentByIdTx: vi.fn(),
    softDeleteAttachment: vi.fn().mockResolvedValue([{ id: ATTACH_ID }]),
  };
}

function makeStorage(configured = true) {
  return {
    isConfigured: vi.fn().mockReturnValue(configured),
    createUploadUrl: vi.fn().mockResolvedValue("https://minio.local/presigned-put"),
    createDownloadUrl: vi.fn().mockResolvedValue("https://minio.local/presigned-get"),
    assertUploadAllowed: vi.fn(),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeDb() {
  // withTenant chạy callback với 1 tx giả; repo methods đã mock nên tx không cần thật.
  return {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

function build(opts?: { storageConfigured?: boolean }) {
  const repo = makeRepo();
  const storage = makeStorage(opts?.storageConfigured ?? true);
  const audit = makeAudit();
  const db = makeDb();
  const service = new TaskAttachmentsService(
    db as never,
    repo as never,
    storage as never,
    audit as never,
  );
  return { service, repo, storage, audit, db };
}

describe("TaskAttachmentsService.createUploadIntent — gate", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it("DENIES (403) when no create:task permission AND not assignee", async () => {
    ctx.repo.isTaskAssigneeTx.mockResolvedValue(false);
    await expect(
      ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.repo.createAttachment).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it("ALLOWS when user is the assignee even without create:task permission", async () => {
    ctx.repo.isTaskAssigneeTx.mockResolvedValue(true);
    const out = await ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, false);
    expect(out.attachment.id).toBe(ATTACH_ID);
    expect(out.uploadUrl).toContain("presigned-put");
    expect(ctx.repo.createAttachment).toHaveBeenCalledOnce();
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "TaskAttachmentUploaded",
        objectType: "task_attachment",
      }),
    );
  });

  it("ALLOWS when user has create:task permission even if not assignee", async () => {
    ctx.repo.isTaskAssigneeTx.mockResolvedValue(false);
    const out = await ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, true);
    expect(out.attachment.id).toBe(ATTACH_ID);
    expect(ctx.repo.createAttachment).toHaveBeenCalledOnce();
  });

  it("404 when task does not exist / cross-tenant", async () => {
    ctx.repo.findRawByIdTx.mockResolvedValue([]);
    await expect(
      ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("does NOT persist a storage key in the audit payload (BẤT BIẾN #3)", async () => {
    await ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, true);
    const auditArg = ctx.audit.record.mock.calls[0][1];
    expect(JSON.stringify(auditArg)).not.toContain(`${COMPANY_ID}/tasks/`);
  });
});

describe("TaskAttachmentsService.createUploadIntent — content-type / size validation", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it("400 when content-type is not in the allowlist", async () => {
    const dto = { ...VALID_DTO, contentType: "application/x-msdownload" } as never;
    await expect(ctx.service.createUploadIntent(USER, TASK_ID, dto, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.repo.createAttachment).not.toHaveBeenCalled();
  });

  it("400 when size exceeds MAX_BYTES", async () => {
    const dto = { ...VALID_DTO, sizeBytes: ATTACHMENT_MAX_BYTES + 1 };
    await expect(ctx.service.createUploadIntent(USER, TASK_ID, dto, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.repo.createAttachment).not.toHaveBeenCalled();
  });

  it("400 when size is zero or negative", async () => {
    await expect(
      ctx.service.createUploadIntent(USER, TASK_ID, { ...VALID_DTO, sizeBytes: 0 }, true),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("TaskAttachmentsService — storage fail-closed", () => {
  it("503 (fail-closed) when object storage is not configured", async () => {
    const ctx = build({ storageConfigured: false });
    await expect(
      ctx.service.createUploadIntent(USER, TASK_ID, VALID_DTO, true),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.repo.createAttachment).not.toHaveBeenCalled();
  });
});

describe("TaskAttachmentsService.getDownloadUrl — cross-tenant deny", () => {
  it("404 when metadata row is absent (RLS 0 row, no oracle)", async () => {
    const ctx = build();
    ctx.repo.findAttachmentByIdTx.mockResolvedValue([]);
    await expect(ctx.service.getDownloadUrl(USER, TASK_ID, ATTACH_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns an ephemeral presigned GET url scoped to the tenant key", async () => {
    const ctx = build();
    const key = `${COMPANY_ID}/tasks/${TASK_ID}/${ATTACH_ID}`;
    ctx.repo.findAttachmentByIdTx.mockResolvedValue([
      { id: ATTACH_ID, taskId: TASK_ID, companyId: COMPANY_ID, storageKey: key },
    ]);
    const out = await ctx.service.getDownloadUrl(USER, TASK_ID, ATTACH_ID);
    expect(out.downloadUrl).toContain("presigned-get");
    expect(ctx.storage.createDownloadUrl).toHaveBeenCalledWith(key, COMPANY_ID);
  });
});

describe("TaskAttachmentsService.softDelete", () => {
  it("soft-deletes + audits TaskAttachmentDeleted in the same withTenant tx", async () => {
    const ctx = build();
    await ctx.service.softDelete(USER, TASK_ID, ATTACH_ID);
    expect(ctx.repo.softDeleteAttachment).toHaveBeenCalledWith(
      COMPANY_ID,
      TASK_ID,
      ATTACH_ID,
      expect.anything(),
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "TaskAttachmentDeleted",
        objectType: "task_attachment",
      }),
    );
  });

  it("404 when the row is absent (RLS / cross-tenant / already deleted, no audit)", async () => {
    const ctx = build();
    ctx.repo.softDeleteAttachment.mockResolvedValue([]);
    await expect(ctx.service.softDelete(USER, TASK_ID, ATTACH_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });
});
