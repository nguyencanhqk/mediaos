/**
 * S16-SOCIAL-BE-3C — `SocialRecycleBinService` (`SOCIAL-API-057` / `058`) ở tầng KHÔNG-cần-DB.
 *
 * Đo những thứ int-spec khó cô lập:
 *   • tầng 2 hỏi ĐÚNG key (`recycleFeedPostList` / `recycleFeedPostRestore`) và chạy TRƯỚC `withTenant` — deny
 *     ở tầng 2 để lại ZERO side-effect (không mở tx, không truy vấn);
 *   • 404 / 409 ⇒ KHÔNG `restorePostTx`, KHÔNG audit (thứ tự D12);
 *   • `restorePostTx` khớp 0 trên hàng vừa khoá ⇒ ném (không 200 rỗng), 0 audit;
 *   • `onModuleInit` đăng ký CHÍNH nó cho `feed_post` (mutant M6);
 *   • chiếu DTO: `authorInScope` KHÔNG lọt response; ngoài phạm vi ⇒ `author: null`;
 *   • KHÔNG tác dụng phụ ngoài danh sách đóng (D14): không realtime/outbox/noti trong file nguồn.
 */
import fs from "node:fs";
import path from "node:path";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import { RecycleBinRegistry } from "../recycle-bin/recycle-bin.registry";
import type { SocialAccessService } from "./social-access.service";
import type {
  LockedDeletedPost,
  RecycleBinPostRow,
  SocialRecycleBinRepository,
} from "./social-recycle-bin.repository";
import { SocialRecycleBinService } from "./social-recycle-bin.service";
import { SOCIAL_ERR } from "./social.errors";

const { restorePostTxMock } = vi.hoisted(() => ({ restorePostTxMock: vi.fn() }));
vi.mock("./social-counters", () => ({ restorePostTx: restorePostTxMock }));

const COMPANY = "11111111-1111-1111-1111-111111111111";
const HR = "22222222-2222-2222-2222-222222222222";
const AUTHOR = "33333333-3333-3333-3333-333333333333";
const POST = "44444444-4444-4444-4444-444444444444";
const GROUP = "55555555-5555-5555-5555-555555555555";
const USER = { id: HR, companyId: COMPANY };

function locked(over: Partial<LockedDeletedPost> = {}): LockedDeletedPost {
  return {
    id: POST,
    authorUserId: AUTHOR,
    deletedBy: HR,
    statusBeforeDelete: "published",
    groupId: null,
    groupDeletedAt: null,
    ...over,
  };
}

function row(over: Partial<RecycleBinPostRow> = {}): RecycleBinPostRow {
  return {
    id: POST,
    type: "share",
    audience: "company",
    groupId: null,
    groupDeleted: false,
    orgUnitId: null,
    bodyExcerpt: "nội dung",
    statusBeforeDelete: "published",
    restoreAs: "published",
    deletedAt: new Date("2026-09-28T01:02:03.000Z"),
    deletedByAuthor: false,
    createdAt: new Date("2026-09-27T01:02:03.000Z"),
    authorInScope: true,
    fullName: "Tác Giả",
    employeeId: "66666666-6666-6666-6666-666666666666",
    ...over,
  };
}

function build(opts: { lockResult?: LockedDeletedPost | null; rows?: RecycleBinPostRow[] } = {}) {
  const calls: string[] = [];
  const access = {
    resolveActor: vi.fn(async (_u: unknown, key: string) => {
      calls.push(`resolveActor:${key}`);
      return {
        actorUserId: HR,
        companyId: COMPANY,
        canManagePosts: true,
        orgUnitIds: [],
      };
    }),
  };
  const tx = { marker: "tx" };
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (t: unknown) => unknown) => {
      calls.push("withTenant");
      return fn(tx);
    }),
  };
  const repo = {
    listDeletedTx: vi.fn(async () => opts.rows ?? [row()]),
    countDeletedTx: vi.fn(async () => (opts.rows ?? [row()]).length),
    lockDeletedForRestoreTx: vi.fn(async () =>
      opts.lockResult === undefined ? locked() : opts.lockResult,
    ),
  };
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const registry = new RecycleBinRegistry();
  const service = new SocialRecycleBinService(
    db as unknown as DatabaseService,
    access as unknown as SocialAccessService,
    repo as unknown as SocialRecycleBinRepository,
    audit as unknown as AuditService,
    registry,
  );
  return { service, access, db, repo, audit, registry, calls, tx };
}

describe("S16-SOCIAL-BE-3C · SocialRecycleBinService", () => {
  beforeEach(() => {
    restorePostTxMock.mockReset();
  });

  it("onModuleInit đăng ký CHÍNH nó cho `feed_post` (M6: thiếu ⇒ 057/058 500)", () => {
    const { service, registry } = build();
    expect(() => registry.get("feed_post")).toThrow();
    service.onModuleInit();
    expect(registry.get("feed_post")).toBe(service);
  });

  describe("057 list", () => {
    it("tầng 2 hỏi ĐÚNG key `recycleFeedPostList`, TRƯỚC withTenant", async () => {
      const { service, calls } = build();
      await service.list(USER, { page: 2, limit: 5 });
      expect(calls).toEqual(["resolveActor:recycleFeedPostList", "withTenant"]);
    });

    it("tầng 2 ném ⇒ KHÔNG mở tx, KHÔNG truy vấn", async () => {
      const { service, access, db, repo } = build();
      access.resolveActor.mockRejectedValueOnce(new ForbiddenException("AUTH-ERR-SCOPE-DENIED"));
      await expect(service.list(USER, { page: 1, limit: 20 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(repo.listDeletedTx).not.toHaveBeenCalled();
    });

    it("trang mang page/limit/total của query; truyền page/limit xuống repo", async () => {
      const { service, repo } = build({ rows: [row(), row({ id: GROUP })] });
      const res = await service.list(USER, { page: 3, limit: 2 });
      expect(repo.listDeletedTx).toHaveBeenCalledWith(expect.anything(), expect.anything(), 3, 2);
      expect({ page: res.page, limit: res.limit, total: res.total }).toEqual({
        page: 3,
        limit: 2,
        total: 2,
      });
    });

    it("chiếu DTO: tập khoá ĐÓNG, `authorInScope` KHÔNG lọt, ngày ISO", async () => {
      const { service } = build();
      const res = await service.list(USER, { page: 1, limit: 20 });
      const item = res.data[0]!;
      expect(Object.keys(item).sort()).toEqual(
        [
          "audience",
          "author",
          "bodyExcerpt",
          "createdAt",
          "deletedAt",
          "deletedByAuthor",
          "groupDeleted",
          "groupId",
          "id",
          "orgUnitId",
          "restoreAs",
          "statusBeforeDelete",
          "type",
        ].sort(),
      );
      expect(item.author).toEqual({
        employeeId: "66666666-6666-6666-6666-666666666666",
        fullName: "Tác Giả",
      });
      expect(item.deletedAt).toBe("2026-09-28T01:02:03.000Z");
      expect(item.createdAt).toBe("2026-09-27T01:02:03.000Z");
    });

    it("ngoài phạm vi (`authorInScope=false`) ⇒ `author: null` — kể cả khi hàng thô lỡ mang tên", async () => {
      const { service } = build({ rows: [row({ authorInScope: false, fullName: "RÒ" })] });
      const res = await service.list(USER, { page: 1, limit: 20 });
      expect(res.data[0]!.author).toBeNull();
      expect(JSON.stringify(res)).not.toContain("RÒ");
    });
  });

  describe("058 restore", () => {
    it("tầng 2 hỏi ĐÚNG key `recycleFeedPostRestore`, TRƯỚC withTenant", async () => {
      const { service, calls } = build();
      restorePostTxMock.mockResolvedValueOnce("published");
      await service.restore(USER, POST);
      expect(calls).toEqual(["resolveActor:recycleFeedPostRestore", "withTenant"]);
    });

    it("tầng 2 ném ⇒ KHÔNG mở tx, KHÔNG restorePostTx, KHÔNG audit", async () => {
      const { service, access, db, audit } = build();
      access.resolveActor.mockRejectedValueOnce(new ForbiddenException("AUTH-ERR-FORBIDDEN"));
      await expect(service.restore(USER, POST)).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(restorePostTxMock).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("không hàng đã xoá khớp ⇒ 404 POST_NOT_FOUND, KHÔNG restorePostTx, KHÔNG audit", async () => {
      const { service, audit } = build({ lockResult: null });
      const err = await service.restore(USER, POST).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe(SOCIAL_ERR.POST_NOT_FOUND);
      expect(restorePostTxMock).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("bài thuộc nhóm đã xoá ⇒ 409 RESTORE_GROUP_DELETED, KHÔNG restorePostTx, KHÔNG audit", async () => {
      const { service, audit } = build({
        lockResult: locked({ groupId: GROUP, groupDeletedAt: new Date() }),
      });
      const err = await service.restore(USER, POST).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(SOCIAL_ERR.RESTORE_GROUP_DELETED);
      expect(restorePostTxMock).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("nhóm CÒN sống ⇒ khôi phục bình thường (đối chứng dương của ca 409)", async () => {
      const { service } = build({ lockResult: locked({ groupId: GROUP, groupDeletedAt: null }) });
      restorePostTxMock.mockResolvedValueOnce("hidden");
      await expect(service.restore(USER, POST)).resolves.toEqual({ id: POST, status: "hidden" });
    });

    it("restorePostTx khớp 0 trên hàng vừa khoá ⇒ NÉM (không 200 rỗng), 0 audit", async () => {
      const { service, audit } = build();
      restorePostTxMock.mockResolvedValueOnce(null);
      await expect(service.restore(USER, POST)).rejects.toThrow(/khớp 0/);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("thành công ⇒ restorePostTx(tx, company, post, ACTOR) + ĐÚNG MỘT audit đủ trường D13", async () => {
      const { service, audit, tx } = build({
        lockResult: locked({ deletedBy: AUTHOR, statusBeforeDelete: "published" }),
      });
      restorePostTxMock.mockResolvedValueOnce("hidden");
      const res = await service.restore(USER, POST);
      expect(res).toEqual({ id: POST, status: "hidden" });
      expect(restorePostTxMock).toHaveBeenCalledWith(tx, COMPANY, POST, HR);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(tx, {
        action: "social.post.restore",
        objectType: "feed_post",
        objectId: POST,
        actorUserId: HR,
        moduleCode: "SOCIAL",
        entityType: "feed_post",
        entityId: POST,
        resultStatus: "Success",
        metadata: {
          postId: POST,
          authorUserId: AUTHOR,
          restoredStatus: "hidden",
          statusBeforeDelete: "published",
          deletedByAuthor: true,
        },
      });
    });

    it("`deletedBy` NULL ⇒ audit `deletedByAuthor:false` (không chứng minh được là tác giả)", async () => {
      const { service, audit } = build({ lockResult: locked({ deletedBy: null }) });
      restorePostTxMock.mockResolvedValueOnce("hidden");
      await service.restore(USER, POST);
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({ deletedByAuthor: false }),
        }),
      );
    });
  });

  it("D14 — file nguồn KHÔNG chạm realtime/outbox/noti (không tác dụng phụ ngoài danh sách đóng)", () => {
    const src = fs
      .readFileSync(path.join(__dirname, "social-recycle-bin.service.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/RealtimeEmitterService|OutboxService|Notification|\.emit\(/);
    // Neo dương: phép quét đọc được file thật (không xanh-rỗng vì đường dẫn sai).
    expect(src).toContain("restorePostTx");
  });
});
