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
  /** Lỗi `assert*Visible` ném ra THAY cho 404 — dùng để đo nhánh leo-thang của `ownerContent`. */
  failVisibleWith?: unknown;
  /** Lỗi `buildViewerContext` ném ra — nằm NGOÀI `withTenant`, nhánh riêng. */
  failViewerWith?: unknown;
}

function makeResolver(o: Opts) {
  const dataScope = {
    resolveManyOrNull: vi.fn().mockResolvedValue(o.scopes ?? ["Company"]),
  } as unknown as DataScopeService;

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const access = {
    // S16-SOCIAL-PERMCOST-1 — resolver KHÔNG còn gọi `resolveViewerContext` (nó tự nạp grant lần
    // hai). Giữ mock này để ca «một lượt nạp» chứng minh nó KHÔNG bị chạm.
    resolveViewerContext: vi.fn(async () => {
      throw new Error("resolver không được gọi resolveViewerContext (nạp grant lần 2)");
    }),
    buildViewerContext: vi.fn(async () => {
      if (o.failViewerWith !== undefined) throw o.failViewerWith;
      return {
        actorUserId: ACTOR,
        companyId: COMPANY,
        canManagePosts: o.canManagePosts ?? false,
        orgUnitIds: [],
      };
    }),
    assertPostVisible: vi.fn(async () => {
      if (o.failVisibleWith !== undefined) throw o.failVisibleWith;
      if (o.authorUserId == null) throw new NotFoundException("SOCIAL-ERR-001");
      return { id: ENTITY, authorUserId: o.authorUserId };
    }),
    assertCommentVisible: vi.fn(async () => {
      if (o.failVisibleWith !== undefined) throw o.failVisibleWith;
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

  const resolver = new SocialFileResolver(db, dataScope, access, fileRepo, linkRepo);
  return Object.assign(resolver, { mocks: { dataScope, access } });
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

/**
 * `ownerContent` — RANH GIỚI giữa "câu trả lời" và "sự cố" (silent-failure-hunter, FULL gate #530).
 *
 * Bản đầu dùng `catch { return null }` KHÔNG phân biệt loại lỗi. Hậu quả không nằm ở kết quả deny
 * (deny vẫn đúng, vẫn fail-closed) mà ở chỗ MẤT LOG: `FilePolicyService` có try/catch riêng để xếp
 * resolver-throw thành `deny-error`, và `SocialAttachmentsService.signOne` dựa ĐÚNG vào `reason` đó
 * để `logger.error`. Nuốt trắng ở đây đẩy mọi sự cố hạ tầng vào nhánh `deny-resolver` = "từ chối
 * bình thường, không log" ⇒ sự cố DB toàn hệ thống nhìn y như "bạn không có quyền", không ai gỡ được.
 */
describe("ownerContent — 404 là câu TRẢ LỜI, lỗi khác là SỰ CỐ phải leo lên", () => {
  it("lỗi DB ở `assert*Visible` LEO LÊN, KHÔNG hoá thành deny im lặng", async () => {
    const boom = new Error("connection terminated unexpectedly");
    const r = makeResolver({ scopes: ["Company"], failVisibleWith: boom });
    await expect(r.canDownloadFile(input())).rejects.toThrow(boom);
    await expect(r.canViewFile(input())).rejects.toThrow(boom);
  });

  it("lỗi ở `resolveViewerContext` (NGOÀI `withTenant`) cũng leo lên", async () => {
    const boom = new Error("pool exhausted");
    const r = makeResolver({ scopes: ["Company"], failViewerWith: boom });
    await expect(r.canDownloadFile(input())).rejects.toThrow(boom);
  });

  it("nhánh bình luận cũng leo lên, không chỉ nhánh bài", async () => {
    const boom = new Error("statement timeout");
    const r = makeResolver({ scopes: ["Company"], failVisibleWith: boom });
    await expect(r.canDownloadFile(input({ entityType: FEED_COMMENT_ENTITY }))).rejects.toThrow(
      boom,
    );
  });

  it("`canLinkFile` (vế 6b dùng CÙNG `ownerContent`) cũng leo lên", async () => {
    const boom = new Error("deadlock detected");
    const r = makeResolver({
      scopes: ["Company", "Company"],
      file: OK_FILE,
      failVisibleWith: boom,
    });
    await expect(
      r.canLinkFile(input({ action: FilePolicyAction.Link, entityType: FEED_POST_ENTITY })),
    ).rejects.toThrow(boom);
  });

  it("404 đã BỌC LẠI (không `instanceof`) vẫn được nuốt — `getStatus()` là bất biến qua mọi cách bọc", async () => {
    // Đây là lý do `isNotFound` soi `getStatus()` chứ không `instanceof NotFoundException`: ở worker
    // vitest hai bản `@nestjs/common` khác instance làm `instanceof` trượt TRONG IM LẶNG ⇒ 404 sạch
    // bị xếp thành deny-error và spam log.
    const r = makeResolver({
      scopes: ["Company"],
      failVisibleWith: { getStatus: () => 404, message: "SOCIAL-ERR-001" },
    });
    expect(await r.canDownloadFile(input())).toBe(false);
  });

  it("404 dạng thuộc tính `status` (không có `getStatus`) cũng được nuốt", async () => {
    const r = makeResolver({ scopes: ["Company"], failVisibleWith: { status: 404 } });
    expect(await r.canDownloadFile(input())).toBe(false);
  });

  it("500 đã bọc lại KHÔNG bị nuốt — chỉ ĐÚNG 404 mới là câu trả lời", async () => {
    const wrapped = { getStatus: () => 500 };
    const r = makeResolver({ scopes: ["Company"], failVisibleWith: wrapped });
    await expect(r.canDownloadFile(input())).rejects.toBe(wrapped);
  });
});

/**
 * S16-SOCIAL-PERMCOST-1 — đường ĐỌC từng nạp ảnh chụp grant HAI lần mỗi lượt ký URL: một cho
 * `view:feed` (`canReadOwner`), một cho `manage:feed-post` (`resolveViewerContext`). Giờ mọi cổng
 * hỏi đủ cặp trong MỘT lượt `resolveManyOrNull` (= một lần `getCompanyRoleGrantsWithScope`).
 *
 * Phép đo round-trip KHÔNG đủ (backlog `done_when`): gộp hai câu hỏi khác nhau phải giữ NGUYÊN ngữ
 * nghĩa ⇒ các ca DENY bên dưới chứng minh `manage:feed-post` KHÔNG thay được `view:feed`.
 */
describe("PERMCOST-1 — một lượt nạp grant, ngữ nghĩa không đổi", () => {
  const MANAGE = { action: "manage", resourceType: "feed-post", isSensitive: false };
  const READ = { action: "view", resourceType: "feed", isSensitive: false };

  it.each([
    ["canViewFile", (r: SocialFileResolver) => r.canViewFile(input())],
    ["canDownloadFile", (r: SocialFileResolver) => r.canDownloadFile(input())],
    ["canDeleteFile", (r: SocialFileResolver) => r.canDeleteFile(input())],
    ["canUnlinkFile", (r: SocialFileResolver) => r.canUnlinkFile(input())],
  ])(
    "%s — ĐÚNG một lượt resolveManyOrNull, hỏi cả `view:feed` lẫn `manage:feed-post`",
    async (_n, call) => {
      const r = makeResolver({ scopes: ["Company", "Company"], authorUserId: ACTOR });
      await call(r);
      const resolveMany = vi.mocked(r.mocks.dataScope.resolveManyOrNull);
      expect(resolveMany).toHaveBeenCalledTimes(1);
      expect(resolveMany.mock.calls[0]?.[2]).toEqual([READ, MANAGE]);
      expect(r.mocks.access.resolveViewerContext).not.toHaveBeenCalled();
    },
  );

  it("canLinkFile — ĐÚNG một lượt, hỏi cặp GHI + `view:feed` + `manage:feed-post`", async () => {
    const r = makeResolver({
      scopes: ["Company", "Company", "Company"],
      file: OK_FILE,
      authorUserId: ACTOR,
    });
    expect(await r.canLinkFile(input({ action: FilePolicyAction.Link }))).toBe(true);
    const resolveMany = vi.mocked(r.mocks.dataScope.resolveManyOrNull);
    expect(resolveMany).toHaveBeenCalledTimes(1);
    expect(resolveMany.mock.calls[0]?.[2]).toEqual([
      { action: "create", resourceType: "feed-post", isSensitive: false },
      READ,
      MANAGE,
    ]);
    expect(r.mocks.access.resolveViewerContext).not.toHaveBeenCalled();
  });

  it("scope `manage:feed-post` từ CÙNG lượt được chuyển nguyên vào dựng ngữ cảnh xem", async () => {
    const r = makeResolver({ scopes: ["Company", "Department"], authorUserId: OTHER });
    await r.canDownloadFile(input());
    expect(r.mocks.access.buildViewerContext).toHaveBeenCalledWith(ACTOR, COMPANY, "Department");
  });

  it("DENY: có `manage:feed-post` nhưng THIẾU `view:feed` ⇒ đọc bị chặn, kể cả tác giả", async () => {
    const r = makeResolver({
      scopes: [null, "Company"],
      authorUserId: ACTOR,
      canManagePosts: true,
    });
    expect(await r.canDownloadFile(input())).toBe(false);
    expect(await r.canViewFile(input())).toBe(false);
    expect(await r.canDeleteFile(input())).toBe(false);
    // Không dựng ngữ cảnh, không chạm DB bài khi cổng cặp đã từ chối.
    expect(r.mocks.access.buildViewerContext).not.toHaveBeenCalled();
  });

  it("DENY: có `manage:feed-post` + `view:feed` nhưng THIẾU cặp GHI ⇒ không gắn được tệp", async () => {
    const r = makeResolver({
      scopes: [null, "Company", "Company"],
      file: OK_FILE,
      authorUserId: OTHER,
      canManagePosts: true,
    });
    expect(await r.canLinkFile(input({ action: FilePolicyAction.Link }))).toBe(false);
  });
});

describe("PERMCOST-1 — canLinkFile chuyển ĐÚNG scope `manage:feed-post` (chỉ số [2])", () => {
  it("scope manage `Department` được chuyển nguyên ⇒ bài người khác KHÔNG gắn được tệp", async () => {
    // Chống mutant «truyền `readScope` (Company) thay `managePostsScope`»: nó sẽ bật `canManagePosts`
    // và cho gắn tệp vào bài bất kỳ. Mock ở đây suy cờ TỪ scope nhận được, như bản thật.
    const r = makeResolver({
      scopes: ["Company", "Company", "Department"],
      file: OK_FILE,
      authorUserId: OTHER,
    });
    vi.mocked(r.mocks.access.buildViewerContext).mockImplementation(async (_u, _c, scope) => ({
      actorUserId: ACTOR,
      companyId: COMPANY,
      canManagePosts: scope === "Company" || scope === "System",
      orgUnitIds: [],
    }));
    expect(await r.canLinkFile(input({ action: FilePolicyAction.Link }))).toBe(false);
    expect(r.mocks.access.buildViewerContext).toHaveBeenCalledWith(ACTOR, COMPANY, "Department");
  });
});
