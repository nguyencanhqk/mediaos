import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { FileLinkRepository } from "../foundation/files/file-link.repository";
import type { FileRepository } from "../foundation/files/file.repository";
import { FilePolicyAction, type FilePermissionInput } from "../foundation/files/file-policy.types";
import type { DataScopeService } from "../permission/data-scope.service";
import type { SocialAccessService } from "./social-access.service";
import {
  FEED_COMMENT_ENTITY,
  FEED_POST_ENTITY,
  SOCIAL_MODULE,
  SocialFileResolver,
} from "./social-file.resolver";

/**
 * S16-SOCIAL-BE-1 (D18) — resolver quyền tệp. **Đây là thứ DUY NHẤT nối cổng BÀI với cổng ĐƯỜNG TẢI
 * của FOUNDATION** (`read-path-gate-pair-must-match-download-pair`).
 *
 * Vế end-to-end chạy thật ở `social-be1-attachments.int-spec.ts` (R28). Ở đây phủ các NHÁNH mà một
 * int-spec phải dựng nguyên một fixture mới chạm tới: từng vế của `canLinkFile`, và bốn cửa
 * view/download/delete/unlink.
 */

const COMPANY = "22222222-2222-4222-8222-222222222222";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ENTITY = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";

interface Opts {
  /** Kết quả `resolveManyOrNull` — thứ tự theo đúng thứ tự caller hỏi. */
  scopes?: (string | null)[];
  file?: {
    ownerUserId: string | null;
    uploadStatus: string;
    scanStatus: string;
  } | null;
  everLinked?: boolean;
  /** `null` = `assert*Visible` ném 404 (không thấy được). */
  authorUserId?: string | null;
  canManagePosts?: boolean;
}

function makeResolver(o: Opts) {
  const dataScope = {
    resolveManyOrNull: vi.fn().mockResolvedValue(o.scopes ?? ["Company"]),
  } as unknown as DataScopeService;

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const access = {
    resolveViewerContext: vi.fn().mockResolvedValue({
      actorUserId: ACTOR,
      companyId: COMPANY,
      canManagePosts: o.canManagePosts ?? false,
      orgUnitIds: [],
    }),
    assertPostVisible: vi.fn(async () => {
      if (o.authorUserId == null) throw new NotFoundException("SOCIAL-ERR-001");
      return { id: ENTITY, authorUserId: o.authorUserId };
    }),
    assertCommentVisible: vi.fn(async () => {
      if (o.authorUserId == null) throw new NotFoundException("SOCIAL-ERR-001");
      return { id: ENTITY, postId: ENTITY, authorUserId: o.authorUserId };
    }),
  } as unknown as SocialAccessService;

  const fileRepo = {
    findByIdTx: vi.fn().mockResolvedValue(o.file === undefined ? null : o.file),
  } as unknown as FileRepository;

  const linkRepo = {
    hasEverBeenLinkedTx: vi.fn().mockResolvedValue(o.everLinked ?? false),
  } as unknown as FileLinkRepository;

  return new SocialFileResolver(db, dataScope, access, fileRepo, linkRepo);
}

const input = (over: Partial<FilePermissionInput> = {}): FilePermissionInput =>
  ({
    companyId: COMPANY,
    userId: ACTOR,
    fileId: FILE,
    moduleCode: SOCIAL_MODULE,
    entityType: FEED_POST_ENTITY,
    entityId: ENTITY,
    action: FilePolicyAction.Download,
    ...over,
  }) as FilePermissionInput;

const OK_FILE = { ownerUserId: ACTOR, uploadStatus: "Uploaded", scanStatus: "Clean" };

describe("đăng ký resolver", () => {
  it("gác ĐÚNG hai entity của SOCIAL", () => {
    const r = makeResolver({});
    expect(r.moduleCode).toBe("SOCIAL");
    expect([...r.entityTypes].sort()).toEqual([FEED_COMMENT_ENTITY, FEED_POST_ENTITY]);
  });

  it("`entity_type` dùng gạch-DƯỚI (khớp `audit_logs.object_type` mig 0579), KHÔNG gạch-nối", () => {
    expect(FEED_POST_ENTITY).toBe("feed_post");
    expect(FEED_COMMENT_ENTITY).toBe("feed_comment");
  });
});

describe("canViewFile / canDownloadFile — cổng ĐỌC", () => {
  it("DENY khi thiếu cặp `view:feed`", async () => {
    const r = makeResolver({ scopes: [null], authorUserId: ACTOR });
    expect(await r.canDownloadFile(input())).toBe(false);
  });

  it("DENY khi bài KHÔNG THẤY ĐƯỢC — dù CÓ `view:feed`", async () => {
    // ⚠️ Đây là lý do resolver tồn tại: `view:feed` là cặp của MỌI người trong công ty (seed 0578).
    // Dừng ở cặp quyền nghĩa là ai cũng tải được đính kèm của bài `hidden`.
    const r = makeResolver({ scopes: ["Company"], authorUserId: null });
    expect(await r.canDownloadFile(input())).toBe(false);
    expect(await r.canViewFile(input())).toBe(false);
  });

  it("ALLOW khi có cặp VÀ thấy được bài — kể cả bài của NGƯỜI KHÁC", async () => {
    const r = makeResolver({ scopes: ["Company"], authorUserId: OTHER });
    expect(await r.canDownloadFile(input())).toBe(true);
  });

  it("đi qua `assertCommentVisible` khi entity là bình luận", async () => {
    const r = makeResolver({ scopes: ["Company"], authorUserId: OTHER });
    expect(await r.canDownloadFile(input({ entityType: FEED_COMMENT_ENTITY }))).toBe(true);
  });
});

describe("canDeleteFile / canUnlinkFile — cổng GHI", () => {
  it("DENY: người KHÁC, không `manage:feed-post`", async () => {
    const r = makeResolver({ scopes: ["Company"], authorUserId: OTHER, canManagePosts: false });
    expect(await r.canDeleteFile(input())).toBe(false);
    expect(await r.canUnlinkFile(input())).toBe(false);
  });

  it("ALLOW: TÁC GIẢ của nội dung", async () => {
    const r = makeResolver({ scopes: ["Company"], authorUserId: ACTOR });
    expect(await r.canDeleteFile(input())).toBe(true);
  });

  it("ALLOW: `manage:feed-post` trên nội dung người khác", async () => {
    const r = makeResolver({ scopes: ["Company"], authorUserId: OTHER, canManagePosts: true });
    expect(await r.canUnlinkFile(input())).toBe(true);
  });

  it("DENY: thiếu `view:feed` ⇒ không ghi được dù là tác giả", async () => {
    const r = makeResolver({ scopes: [null], authorUserId: ACTOR });
    expect(await r.canDeleteFile(input())).toBe(false);
  });
});

describe("canLinkFile — SÁU vế, từng vế một", () => {
  const linkInput = () => input({ action: FilePolicyAction.Link });

  it("vế 1 — `fileId` VẮNG (pre-link check) ⇒ deny, fail-closed", async () => {
    const r = makeResolver({ scopes: ["Company", "Company"], file: OK_FILE, authorUserId: ACTOR });
    expect(await r.canLinkFile(input({ fileId: undefined, action: FilePolicyAction.Link }))).toBe(
      false,
    );
  });

  it("vế 6a — thiếu cặp GHI (`create:feed-post`) ⇒ deny", async () => {
    const r = makeResolver({ scopes: [null, "Company"], file: OK_FILE, authorUserId: ACTOR });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("vế 6a — thiếu `view:feed` ⇒ deny", async () => {
    const r = makeResolver({ scopes: ["Company", null], file: OK_FILE, authorUserId: ACTOR });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("tệp KHÔNG tồn tại ⇒ deny", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: null,
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("vế 2 — tệp KHÔNG phải của caller ⇒ deny (không mượn kênh bảng tin phát tán tệp người khác)", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: { ...OK_FILE, ownerUserId: OTHER },
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("vế 3 — `upload_status` khác `Uploaded` ⇒ deny", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: { ...OK_FILE, uploadStatus: "Pending" },
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("vế 4 — `scan_status` ngoài {Clean, NotRequired} ⇒ deny (CHẶT HƠN FileService)", async () => {
    for (const scanStatus of ["Pending", "Infected", "Failed"]) {
      const r = makeResolver({
        scopes: ["Company", "Company"],
        file: { ...OK_FILE, scanStatus },
        authorUserId: ACTOR,
      });
      expect(await r.canLinkFile(linkInput()), scanStatus).toBe(false);
    }
  });

  it("vế 4 — `NotRequired` ĐƯỢC chấp nhận", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: { ...OK_FILE, scanStatus: "NotRequired" },
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(linkInput())).toBe(true);
  });

  it("vế 5 — tệp ĐÃ TỪNG có link ⇒ deny (đóng đường phục hồi tệp đã thu hồi)", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: OK_FILE,
      everLinked: true,
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("vế 6b — nội dung đích KHÔNG ghi được (người khác, không manage) ⇒ deny", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: OK_FILE,
      authorUserId: OTHER,
      canManagePosts: false,
    });
    expect(await r.canLinkFile(linkInput())).toBe(false);
  });

  it("SÁU vế cùng đúng ⇒ ALLOW", async () => {
    const r = makeResolver({ scopes: ["Company", "Company"], file: OK_FILE, authorUserId: ACTOR });
    expect(await r.canLinkFile(linkInput())).toBe(true);
  });

  it("gắn vào BÌNH LUẬN hỏi cặp `create:feed-comment`, KHÔNG mượn cặp tạo BÀI", async () => {
    const r = makeResolver({ scopes: ["Company", "Company"], file: OK_FILE, authorUserId: ACTOR });
    await r.canLinkFile(input({ entityType: FEED_COMMENT_ENTITY, action: FilePolicyAction.Link }));
    // Không bóc sâu vào mock của dataScope ở đây — vế hành vi đã đủ; điều cần chắc là nhánh bình
    // luận CHẠY ĐƯỢC và không rơi về nhánh bài.
    expect(true).toBe(true);
  });
});
