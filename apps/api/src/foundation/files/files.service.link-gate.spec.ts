/**
 * S19-SEC-FILELINKGATE-1 — biên gắn tệp `FileService.link()` theo cùng quyết định xem từng tệp
 * (plan `docs/plans/S19-SEC-FILELINKGATE-1.md` §3 D-3 · §5).
 *
 * Thứ tự đích: cặp đã đăng ký (400) → `canLink` (403) → nạp ngữ cảnh (tệp vắng 400) → quyết định XEM của người
 * gắn (403, ngoài mọi tx; vế dự phòng FOUNDATION hỏi thêm TẢI) → trạng thái tệp (400) → tx ghi khoá hàng tệp
 * rồi so lại ảnh chụp liên kết (409) → insert.
 * Không DB: repo/policy giả, `FileAccessLogService` thật ghi vào tx giả.
 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkFileInput } from "@mediaos/contracts";
import { FileAccessLogService } from "./file-access-log.service";
import { FilePolicyAction, type FilePolicyDecision } from "./file-policy.types";
import { FileService } from "./files.service";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const FILE = "33333333-3333-4333-8333-333333333333";
const ENTITY = "55555555-5555-4555-8555-555555555555";

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-foundation" };
const DENY: FilePolicyDecision = { allow: false, reason: "deny-foundation" };
const user = { id: ACTOR_ID, companyId: COMPANY };

const INPUT: LinkFileInput = {
  fileId: FILE,
  moduleCode: "TASK",
  entityType: "task",
  entityId: ENTITY,
  linkType: "Attachment",
  accessScope: "Company",
  isPrimary: false,
};

function fileRow(overrides: Record<string, unknown> = {}) {
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
    uploadStatus: "Uploaded",
    scanStatus: "Clean",
    scanResult: null,
    ownerUserId: OTHER_ID,
    uploadedBy: OTHER_ID,
    uploadedAt: new Date("2026-10-20T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-10-20T00:00:00Z"),
    updatedAt: new Date("2026-10-20T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function linkRow(
  moduleCode: string,
  entityType: string,
  id = "66666666-6666-4666-8666-666666666666",
) {
  return {
    id,
    companyId: COMPANY,
    fileId: FILE,
    moduleCode,
    entityType,
    entityId: ENTITY,
    linkType: "Attachment",
    accessScope: "Company",
    isPrimary: false,
    purpose: null,
    sortOrder: 0,
    createdBy: OTHER_ID,
    createdAt: new Date("2026-10-20T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
  };
}

function makeHarness() {
  /** Độ sâu `withTenant` đang mở — quyết định XEM phải chạy ở độ sâu 0 (ngoài tx ghi). */
  let depth = 0;
  const events: string[] = [];
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => ({ returning: async () => [row] }),
    }),
  };
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => {
      depth += 1;
      try {
        return await fn(fakeTx);
      } finally {
        depth -= 1;
      }
    }),
  };
  const depthAtLock: number[] = [];
  const fileRepo = {
    findByIdTx: vi.fn(async () => fileRow()),
    /** Đọc khoá hàng trong tx ghi — trả cùng hàng với `findByIdTx` (ca ghi đè hàng áp cho cả hai). */
    findByIdForUpdateTx: vi.fn((): Promise<unknown> => {
      depthAtLock.push(depth);
      return fileRepo.findByIdTx();
    }),
    incrementDownloadCountTx: vi.fn(async () => 1),
  };
  const linkRepo = {
    insertTx: vi.fn(async () => {
      events.push("insert");
      return linkRow(INPUT.moduleCode, INPUT.entityType, "77777777-7777-4777-8777-777777777777");
    }),
    listByFileTx: vi.fn(async () => [] as ReturnType<typeof linkRow>[]),
    hasEverBeenLinkedTx: vi.fn(async () => false),
  };
  const accessLog = new FileAccessLogService();
  const accessLogSpy = vi.fn(accessLog.record.bind(accessLog));
  accessLog.record = accessLogSpy as typeof accessLog.record;
  const audit = { record: vi.fn(async () => undefined) };
  const depthAtDecide: number[] = [];
  const policy = {
    canLink: vi.fn(async () => ALLOW),
    canonicalOwnerKey: vi.fn((moduleCode: string, entityType: string) => ({
      moduleCode,
      entityType,
    })),
    decideForLinkedFile: vi.fn(
      async (_i: unknown, _links: unknown, _a: unknown, everLinked: boolean) => {
        depthAtDecide.push(depth);
        events.push("decide");
        return everLinked ? { allow: false, reason: "deny-links-revoked" } : ALLOW;
      },
    ),
  };
  const storage = {
    get: vi.fn(async () => ({
      url: "https://signed.example/x",
      expiresAt: new Date("2026-10-20T00:05:00Z"),
    })),
  };
  const service = new FileService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    accessLog,
    audit as never,
    policy as never,
    {} as never,
    storage as never,
  );
  return {
    service,
    db,
    fileRepo,
    linkRepo,
    accessLogSpy,
    audit,
    policy,
    depthAtDecide,
    depthAtLock,
    events,
  };
}

type Harness = ReturnType<typeof makeHarness>;

function denyLogEntries(h: Harness) {
  return h.accessLogSpy.mock.calls.map((c) => c[1]).filter((e) => e.accessGranted === false);
}

describe("FileService.link — cổng xem của người gắn (S19-SEC-FILELINKGATE-1)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("cặp (module, entity) chưa đăng ký resolver ⇒ 400 LINK, canLink không hỏi, có dòng log từ chối", async () => {
    h.policy.canonicalOwnerKey.mockReturnValue(null as never);
    const err = await h.service.link(user, INPUT).catch((e: unknown) => e);
    expect(err, "cặp chưa đăng ký phải bị chặn ở biên").toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toContain(
      "FOUNDATION-FILE-ERR-LINK",
    );
    expect(h.policy.canLink).not.toHaveBeenCalled();
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    expect(denyLogEntries(h)).toEqual([
      expect.objectContaining({
        action: "Link",
        permissionCode: "FOUNDATION.FILE.LINK",
        deniedReason: "deny-no-resolver",
      }),
    ]);
  });

  it("cặp chưa đăng ký + tệp không có trong công ty ⇒ 400 LINK, KHÔNG ghi dòng log từ chối", async () => {
    h.policy.canonicalOwnerKey.mockReturnValue(null as never);
    h.fileRepo.findByIdTx.mockResolvedValue(null as never);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(denyLogEntries(h), "id tệp do client gửi, không có hàng ⇒ không log").toEqual([]);
  });

  it("canLink từ chối + tệp không có trong công ty ⇒ 403, KHÔNG ghi dòng log từ chối", async () => {
    h.policy.canLink.mockResolvedValue(DENY);
    h.fileRepo.findByIdTx.mockResolvedValue(null as never);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(denyLogEntries(h), "id tệp do client gửi, không có hàng ⇒ không log").toEqual([]);
  });

  it("neo: canLink từ chối ⇒ 403, không quyết định xem, không nạp liên kết", async () => {
    h.policy.canLink.mockResolvedValue(DENY);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("neo: tệp vắng ⇒ 400 LINK, không quyết định xem", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(null as never);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
  });

  it("người gắn không xem được tệp (không phải chủ, 0 liên kết) ⇒ 403 + log Link/FOUNDATION.FILE.VIEW, không insert", async () => {
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    const err = await h.service.link(user, INPUT).catch((e: unknown) => e);
    expect(err, "phải 403 khi người gắn không xem được tệp").toBeInstanceOf(ForbiddenException);
    expect(JSON.stringify((err as ForbiddenException).getResponse())).toContain(
      "FOUNDATION-FILE-ERR-FORBIDDEN",
    );
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(
      h.policy.decideForLinkedFile,
      "không xem được ⇒ không hỏi thêm TẢI",
    ).toHaveBeenCalledTimes(1);
    expect(denyLogEntries(h)).toEqual([
      expect.objectContaining({
        fileId: FILE,
        action: "Link",
        permissionCode: "FOUNDATION.FILE.VIEW",
        deniedReason: "deny-foundation",
        moduleCode: "TASK",
        entityType: "task",
        entityId: ENTITY,
      }),
    ]);
  });

  it("vế có liên kết sống: chỉ hỏi View trên chính tệp — TẢI bị từ chối không chặn gắn", async () => {
    h.linkRepo.listByFileTx.mockResolvedValue([linkRow("TASK", "task")]);
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
    h.policy.decideForLinkedFile.mockImplementation(async (_i: unknown, _l: unknown, a: unknown) =>
      a === FilePolicyAction.Download ? DENY : ALLOW,
    );
    await expect(h.service.link(user, INPUT)).resolves.toMatchObject({ fileId: FILE });
    expect(h.policy.decideForLinkedFile).toHaveBeenCalledTimes(1);
    expect(h.policy.decideForLinkedFile).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        userId: ACTOR_ID,
        fileId: FILE,
        moduleCode: "FOUNDATION",
        entityType: "File",
        entityId: FILE,
        action: FilePolicyAction.View,
      }),
      [expect.objectContaining({ moduleCode: "TASK", entityType: "task" })],
      FilePolicyAction.View,
      true,
    );
  });

  it("vế dự phòng (không chủ · 0 liên kết · chưa từng gắn): hỏi View rồi Download trên chính tệp", async () => {
    await expect(h.service.link(user, INPUT)).resolves.toMatchObject({ fileId: FILE });
    expect(h.policy.decideForLinkedFile.mock.calls.map((c) => c[2])).toEqual([
      FilePolicyAction.View,
      FilePolicyAction.Download,
    ]);
    expect(h.policy.decideForLinkedFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fileId: FILE,
        entityType: "File",
        entityId: FILE,
        action: FilePolicyAction.Download,
      }),
      [],
      FilePolicyAction.Download,
      false,
    );
  });

  it("vế dự phòng: xem được nhưng không tải được ⇒ 403 + log Link/FOUNDATION.FILE.DOWNLOAD, không insert", async () => {
    h.policy.decideForLinkedFile.mockImplementation(async (_i: unknown, _l: unknown, a: unknown) =>
      a === FilePolicyAction.Download ? DENY : ALLOW,
    );
    const err = await h.service.link(user, INPUT).catch((e: unknown) => e);
    expect(err, "vế dự phòng đòi cả quyền tải").toBeInstanceOf(ForbiddenException);
    expect(JSON.stringify((err as ForbiddenException).getResponse())).toContain(
      "FOUNDATION-FILE-ERR-FORBIDDEN",
    );
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(denyLogEntries(h)).toEqual([
      expect.objectContaining({
        fileId: FILE,
        action: "Link",
        permissionCode: "FOUNDATION.FILE.DOWNLOAD",
        deniedReason: "deny-foundation",
      }),
    ]);
  });

  it("quyết định xem chạy NGOÀI mọi withTenant và TRƯỚC insert", async () => {
    await h.service.link(user, INPUT);
    expect(h.depthAtDecide, "vế dự phòng: hai lần hỏi (xem, tải), đều ở độ sâu tx 0").toEqual([
      0, 0,
    ]);
    expect(h.events).toEqual(["decide", "decide", "insert"]);
  });

  it("neo ALLOW: chủ tệp · 0 liên kết · chưa từng gắn ⇒ insert, không cần fallback", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.link(user, INPUT)).resolves.toMatchObject({ fileId: FILE });
    expect(h.policy.decideForLinkedFile).not.toHaveBeenCalled();
    expect(h.linkRepo.insertTx).toHaveBeenCalledTimes(1);
  });

  it("chủ tệp · 0 liên kết sống · đã từng gắn ⇒ 403, không insert", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("chủ tệp · 1 liên kết sống bị từ chối ⇒ 403 (vế chủ không vượt AND)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.linkRepo.listByFileTx.mockResolvedValue([linkRow("SOCIAL", "feed_post")]);
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
    h.policy.decideForLinkedFile.mockResolvedValue({ allow: false, reason: "deny-resolver" });
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.policy.decideForLinkedFile).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ moduleCode: "SOCIAL", entityType: "feed_post" })],
      FilePolicyAction.View,
      true,
    );
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("tệp tạm + người gắn không xem được ⇒ 403 (cổng xem trước trạng thái tệp)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ isTemporary: true }));
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("tệp Infected + người gắn không xem được ⇒ 403 (cổng xem trước trạng thái tệp)", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ scanStatus: "Infected" }));
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("neo: tệp tạm của chính người gắn (xem được) ⇒ 400 LINK", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ isTemporary: true, ownerUserId: ACTOR_ID }));
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("liên kết sống đổi giữa quyết định và tx ghi ⇒ 409 LINK, không insert", async () => {
    h.linkRepo.listByFileTx.mockResolvedValueOnce([linkRow("TASK", "task")]).mockResolvedValue([]);
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
    h.policy.decideForLinkedFile.mockResolvedValue(ALLOW);
    const err = await h.service.link(user, INPUT).catch((e: unknown) => e);
    expect(err, "ảnh chụp lệch phải ra 409").toBeInstanceOf(ConflictException);
    expect(JSON.stringify((err as ConflictException).getResponse())).toContain(
      "FOUNDATION-FILE-ERR-LINK",
    );
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("cờ «đã từng gắn» đổi giữa quyết định và tx ghi ⇒ 409, không insert", async () => {
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(h.service.link(user, INPUT)).rejects.toBeInstanceOf(ConflictException);
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });

  it("tx ghi khoá hàng tệp sau quyết định, TRƯỚC khi đọc lại ảnh chụp liên kết", async () => {
    await h.service.link(user, INPUT);
    expect(h.fileRepo.findByIdForUpdateTx, "khoá đúng một lần").toHaveBeenCalledTimes(1);
    expect(h.fileRepo.findByIdForUpdateTx).toHaveBeenCalledWith(COMPANY, FILE, expect.anything());
    expect(h.depthAtLock, "khoá nằm trong một withTenant").toEqual([1]);
    const [lockAt] = h.fileRepo.findByIdForUpdateTx.mock.invocationCallOrder;
    const lists = h.linkRepo.listByFileTx.mock.invocationCallOrder;
    const evers = h.linkRepo.hasEverBeenLinkedTx.mock.invocationCallOrder;
    expect([lists.length, evers.length], "hai ảnh chụp: quyết định + so lại").toEqual([2, 2]);
    expect(lockAt!, "khoá sau ảnh chụp dùng để quyết định").toBeGreaterThan(
      Math.max(lists[0]!, evers[0]!),
    );
    expect(lockAt!, "khoá trước ảnh chụp so lại").toBeLessThan(Math.min(lists[1]!, evers[1]!));
  });
});

describe("FileService.preflightLink — kiểm gắn không ghi (S19-SEC-FILELINKGATE-1)", () => {
  it("ALLOW ⇒ không insert, không audit, không log", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    await expect(h.service.preflightLink(user, INPUT)).resolves.toBeUndefined();
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.accessLogSpy).not.toHaveBeenCalled();
  });

  it("đã từng gắn ⇒ 403, không insert", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
    await expect(h.service.preflightLink(user, INPUT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
  });
});

describe("GET theo id / tải FOUNDATION dùng cùng vị từ (vế chủ tệp)", () => {
  it("getMetadata: chủ tệp · 0 liên kết · chưa từng gắn ⇒ 200 dù fallback từ chối", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.getMetadata(user, FILE)).resolves.toMatchObject({ id: FILE });
  });

  it("getMetadata neo: không phải chủ + fallback từ chối ⇒ 403", async () => {
    const h = makeHarness();
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.getMetadata(user, FILE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("getDownloadUrl: chủ tệp · 0 liên kết · chưa từng gắn ⇒ ký URL dù fallback từ chối", async () => {
    const h = makeHarness();
    h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
    h.policy.decideForLinkedFile.mockResolvedValue(DENY);
    await expect(h.service.getDownloadUrl(user, FILE)).resolves.toMatchObject({
      url: "https://signed.example/x",
    });
  });
});
