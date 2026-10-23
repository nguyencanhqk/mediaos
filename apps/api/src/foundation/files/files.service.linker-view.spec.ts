/**
 * S19-SEC-FILELINKPATHS-1 — hàm chung «người gắn xem được tệp» của `FileService` (plan
 * `docs/plans/S19-SEC-FILELINKPATHS-1.md` §3 D-1 · D-2 · §6).
 *
 * Bất biến đo ở đây:
 *   (1) `decideLinkerView` trả đúng bốn loại kết quả (missing · forbidden · unlinkable · allow), không ném;
 *       trạng thái tệp chỉ xét SAU quyết định xem;
 *   (2) `preflightLinkerView` ghi dòng log từ chối CHỈ cho `forbidden` (một dòng `Link`, mã quyền FOUNDATION);
 *   (3) `recheckLinkerViewTx` khoá hàng tệp (`findByIdForUpdateTx`), phân loại tệp vắng / không gắn được, và
 *       ném 409 khi ảnh chụp liên kết lệch;
 *   (4) `link()` giữ lớp chặn trạng thái TRONG tx (hàng khoá được là Infected/tạm ⇒ 400 đúng mã cũ, 0 insert);
 *   (5) cùng fixture ⇒ `decideLinkerView` và `getMetadata` (`GET /:id`) cho cùng phán quyết xem.
 * Không DB: repo/policy giả, `FileAccessLogService` thật ghi vào tx giả.
 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkFileInput } from "@mediaos/contracts";
import { FileAccessLogService } from "./file-access-log.service";
import type { FilePolicyDecision } from "./file-policy.types";
import { FileService } from "./files.service";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const FILE = "33333333-3333-4333-8333-333333333333";
const ENTITY = "55555555-5555-4555-8555-555555555555";
const LINK_A = "66666666-6666-4666-8666-666666666666";
const LINK_B = "77777777-7777-4777-8777-777777777777";

const ALLOW: FilePolicyDecision = { allow: true, reason: "allow-resolver" };
const actor = { id: ACTOR_ID, companyId: COMPANY };
const LOG_TARGET = { moduleCode: "CHAT", entityType: "chat_message" };

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
    originalName: "anh.png",
    storedName: FILE,
    fileExtension: "png",
    mimeType: "image/png",
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
    uploadedAt: new Date("2026-10-23T00:00:00Z"),
    lastAccessedAt: null,
    downloadCount: 0,
    isTemporary: false,
    expiresAt: null,
    retentionUntil: null,
    metadata: null,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    updatedAt: new Date("2026-10-23T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

/** `moduleCode` "OK" ⇒ resolver giả cho phép; khác ⇒ từ chối. */
function linkRow(moduleCode: string, id = LINK_A) {
  return {
    id,
    companyId: COMPANY,
    fileId: FILE,
    moduleCode,
    entityType: "thing",
    entityId: ENTITY,
    linkType: "Attachment",
    accessScope: "Company",
    isPrimary: false,
    purpose: null,
    sortOrder: 0,
    createdBy: OTHER_ID,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    deletedAt: null,
    deletedBy: null,
  };
}

function makeHarness() {
  const fakeTx = {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => ({ returning: async () => [row] }),
    }),
  };
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)),
  };
  const fileRepo = {
    findByIdTx: vi.fn(async (): Promise<unknown> => fileRow()),
    findByIdForUpdateTx: vi.fn(async (): Promise<unknown> => fileRow()),
  };
  const linkRepo = {
    insertTx: vi.fn(async () => linkRow("OK", LINK_B)),
    listByFileTx: vi.fn(async () => [] as ReturnType<typeof linkRow>[]),
    hasEverBeenLinkedTx: vi.fn(async () => false),
  };
  const accessLog = new FileAccessLogService();
  const accessLogSpy = vi.fn(accessLog.record.bind(accessLog));
  accessLog.record = accessLogSpy as typeof accessLog.record;
  /** Vế dự phòng FOUNDATION (0 sống, chưa từng gắn, không phải chủ) — đổi theo ca. */
  const fallback = { decision: { allow: false, reason: "deny-foundation" } as FilePolicyDecision };
  const policy = {
    canLink: vi.fn(async () => ALLOW),
    canonicalOwnerKey: vi.fn((moduleCode: string, entityType: string) => ({
      moduleCode,
      entityType,
    })),
    decideForLinkedFile: vi.fn(
      async (
        _i: unknown,
        links: ReadonlyArray<{ moduleCode: string }>,
        _a: unknown,
        everLinked: boolean,
      ): Promise<FilePolicyDecision> => {
        if (links.length > 0) {
          return links.every((l) => l.moduleCode === "OK")
            ? ALLOW
            : { allow: false, reason: "deny-resolver" };
        }
        if (everLinked) return { allow: false, reason: "deny-links-revoked" };
        return fallback.decision;
      },
    ),
  };
  const service = new FileService(
    db as never,
    fileRepo as never,
    linkRepo as never,
    accessLog,
    { record: vi.fn(async () => undefined) } as never,
    policy as never,
    {} as never,
    {} as never,
  );
  return { service, fileRepo, linkRepo, accessLogSpy, policy, fallback, fakeTx };
}

type Harness = ReturnType<typeof makeHarness>;

const denyLogs = (h: Harness) =>
  h.accessLogSpy.mock.calls.map((c) => c[1]).filter((e) => e.accessGranted === false);

describe("FileService — quyết định xem của người gắn dùng chung (S19-SEC-FILELINKPATHS-1)", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  describe("decideLinkerView — bốn loại kết quả, không ném", () => {
    it("tệp vắng (RLS 0 hàng) ⇒ missing", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(undefined);
      expect(await h.service.decideLinkerView(actor, FILE)).toEqual({ kind: "missing" });
    });

    it("đã từng gắn, 0 liên kết sống — kể cả chủ tệp ⇒ forbidden mang mã quyền XEM", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
      h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
      const out = await h.service.decideLinkerView(actor, FILE);
      expect(out).toMatchObject({
        kind: "forbidden",
        reason: "deny-links-revoked",
        action: "View",
      });
    });

    it("chủ tệp nhưng tệp có liên kết sống người gắn không xem được ⇒ forbidden (AND trên liên kết sống)", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
      h.linkRepo.listByFileTx.mockResolvedValue([linkRow("OK"), linkRow("NO", LINK_B)]);
      h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
      const out = await h.service.decideLinkerView(actor, FILE);
      expect(out).toMatchObject({ kind: "forbidden", reason: "deny-resolver" });
    });

    it("xem được nhưng Infected ⇒ unlinkable (trạng thái xét SAU quyết định xem)", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        fileRow({ ownerUserId: ACTOR_ID, scanStatus: "Infected" }),
      );
      expect((await h.service.decideLinkerView(actor, FILE)).kind).toBe("unlinkable");
    });

    it("không xem được và Infected ⇒ forbidden — người không xem được không học được trạng thái", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ scanStatus: "Infected" }));
      expect((await h.service.decideLinkerView(actor, FILE)).kind).toBe("forbidden");
    });

    it("tệp tạm hệ thống sinh, chủ là người gắn ⇒ unlinkable", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        fileRow({ ownerUserId: ACTOR_ID, isTemporary: true }),
      );
      expect((await h.service.decideLinkerView(actor, FILE)).kind).toBe("unlinkable");
    });

    it("liên kết sống người gắn xem được ⇒ allow, trả đúng ảnh chụp đã dùng (live giữ nguyên)", async () => {
      const live = [linkRow("OK")];
      h.linkRepo.listByFileTx.mockResolvedValue(live);
      h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
      const out = await h.service.decideLinkerView(actor, FILE);
      expect(out.kind).toBe("allow");
      if (out.kind !== "allow") return;
      expect(out.ctx.live.map((l) => l.id)).toEqual([LINK_A]);
      expect(out.ctx.everLinked).toBe(true);
      expect(denyLogs(h), "decideLinkerView chỉ đọc — không ghi log").toEqual([]);
    });
  });

  describe("preflightLinkerView — log từ chối chỉ cho forbidden", () => {
    it("forbidden ⇒ đúng 1 dòng log Link từ chối, mã FOUNDATION.FILE.VIEW, mang đích của module", async () => {
      h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
      const out = await h.service.preflightLinkerView(actor, FILE, LOG_TARGET);
      expect(out.kind).toBe("forbidden");
      const logs = denyLogs(h);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        fileId: FILE,
        action: "Link",
        permissionCode: "FOUNDATION.FILE.VIEW",
        deniedReason: "deny-links-revoked",
        moduleCode: "CHAT",
        entityType: "chat_message",
      });
    });

    it("vế dự phòng: xem được nhưng không tải được ⇒ forbidden, log mã FOUNDATION.FILE.DOWNLOAD", async () => {
      h.policy.decideForLinkedFile.mockImplementation(async (_i, _l, action) =>
        action === "View" ? ALLOW : { allow: false, reason: "deny-foundation" },
      );
      const out = await h.service.preflightLinkerView(actor, FILE, LOG_TARGET);
      expect(out).toMatchObject({ kind: "forbidden", action: "Download" });
      expect(denyLogs(h).map((e) => e.permissionCode)).toEqual(["FOUNDATION.FILE.DOWNLOAD"]);
    });

    it.each([
      ["missing", () => fileRow(), undefined],
      ["unlinkable", () => fileRow({ ownerUserId: ACTOR_ID, scanStatus: "Infected" }), "x"],
      ["allow", () => fileRow({ ownerUserId: ACTOR_ID }), "x"],
    ] as const)("%s ⇒ 0 dòng log từ chối", async (kind, row, present) => {
      h.fileRepo.findByIdTx.mockResolvedValue(present ? row() : undefined);
      const out = await h.service.preflightLinkerView(actor, FILE, LOG_TARGET);
      expect(out.kind).toBe(kind);
      expect(denyLogs(h)).toEqual([]);
    });
  });

  describe("recheckLinkerViewTx — trong tx ghi của module", () => {
    const decided = { live: [], everLinked: false };

    it("khoá hàng tệp bằng findByIdForUpdateTx (không đọc thường)", async () => {
      const out = await h.service.recheckLinkerViewTx(COMPANY, FILE, decided, h.fakeTx as never);
      expect(out.kind).toBe("ok");
      expect(h.fileRepo.findByIdForUpdateTx).toHaveBeenCalledTimes(1);
      expect(h.fileRepo.findByIdTx).not.toHaveBeenCalled();
    });

    it("hàng khoá được vắng ⇒ missing", async () => {
      h.fileRepo.findByIdForUpdateTx.mockResolvedValue(undefined);
      const out = await h.service.recheckLinkerViewTx(COMPANY, FILE, decided, h.fakeTx as never);
      expect(out).toEqual({ kind: "missing" });
    });

    it.each([
      ["Infected", { scanStatus: "Infected" }],
      ["tệp tạm", { isTemporary: true }],
    ] as const)("hàng khoá được %s ⇒ unlinkable", async (_n, patch) => {
      h.fileRepo.findByIdForUpdateTx.mockResolvedValue(fileRow(patch));
      const out = await h.service.recheckLinkerViewTx(COMPANY, FILE, decided, h.fakeTx as never);
      expect(out.kind).toBe("unlinkable");
    });

    it("ảnh chụp liên kết lệch so với lúc quyết định ⇒ 409 FOUNDATION-FILE-ERR-LINK", async () => {
      h.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(true);
      const err = await h.service
        .recheckLinkerViewTx(COMPANY, FILE, decided, h.fakeTx as never)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(JSON.stringify((err as ConflictException).getResponse())).toContain(
        "FOUNDATION-FILE-ERR-LINK",
      );
    });
  });

  describe("link() — lớp chặn trạng thái trong tx giữ nguyên", () => {
    it.each([
      ["Infected", { scanStatus: "Infected" }, "FOUNDATION-FILE-ERR-INFECTED"],
      ["tệp tạm", { isTemporary: true }, "FOUNDATION-FILE-ERR-LINK"],
    ] as const)(
      "hàng khoá được là %s (đổi sau quyết định) ⇒ 400 đúng mã cũ, 0 insert",
      async (_n, patch, code) => {
        h.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: ACTOR_ID }));
        h.fileRepo.findByIdForUpdateTx.mockResolvedValue(
          fileRow({ ownerUserId: ACTOR_ID, ...patch }),
        );
        const err = await h.service.link(actor, INPUT).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify((err as BadRequestException).getResponse())).toContain(code);
        expect(h.linkRepo.insertTx).not.toHaveBeenCalled();
      },
    );

    it("checkLink ánh xạ unlinkable về 400 (không thành 403)", async () => {
      h.fileRepo.findByIdTx.mockResolvedValue(
        fileRow({ ownerUserId: ACTOR_ID, scanStatus: "Infected" }),
      );
      const err = await h.service.link(actor, INPUT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("một nguồn quyết định: decideLinkerView ⇔ GET /:id", () => {
    const owners = [
      ["chủ", ACTOR_ID],
      ["không chủ", OTHER_ID],
    ] as const;
    const contexts = [
      ["0 sống, chưa gắn", [], false],
      ["0 sống, đã gắn", [], true],
      ["sống, cho phép", [linkRow("OK")], true],
      ["sống, từ chối", [linkRow("NO")], true],
    ] as const;
    const fallbacks = [
      ["fallback cho phép", { allow: true, reason: "allow-foundation" }],
      ["fallback từ chối", { allow: false, reason: "deny-foundation" }],
    ] as const;

    it("mọi tổ hợp chủ × ngữ cảnh × fallback cho cùng phán quyết, có cả ALLOW lẫn DENY", async () => {
      const verdicts: boolean[] = [];
      const mismatches: string[] = [];
      for (const [ownerName, owner] of owners) {
        for (const [ctxName, live, ever] of contexts) {
          for (const [fbName, fb] of fallbacks) {
            const hh = makeHarness();
            hh.fallback.decision = fb;
            hh.fileRepo.findByIdTx.mockResolvedValue(fileRow({ ownerUserId: owner }));
            hh.linkRepo.listByFileTx.mockResolvedValue([...live]);
            hh.linkRepo.hasEverBeenLinkedTx.mockResolvedValue(ever);
            const linker = (await hh.service.decideLinkerView(actor, FILE)).kind === "allow";
            const viewer = await hh.service.getMetadata(actor, FILE).then(
              () => true,
              () => false,
            );
            verdicts.push(linker);
            if (linker !== viewer) mismatches.push(`${ownerName} · ${ctxName} · ${fbName}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(verdicts).toContain(true);
      expect(verdicts).toContain(false);
    });
  });
});
