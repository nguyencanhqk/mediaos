import { Injectable } from "@nestjs/common";
import type { DataScope } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileLinkRepository } from "../foundation/files/file-link.repository";
import { FileRepository } from "../foundation/files/file.repository";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { DataScopeService } from "../permission/data-scope.service";
import { MANAGE_POSTS_PAIR, SocialAccessService } from "./social-access.service";
import type { SocialViewerContext } from "./social.types";

export const SOCIAL_MODULE = "SOCIAL";
/** `file_links.entity_type` — gạch-DƯỚI, khớp `audit_logs.object_type` của migration 0579. */
export const FEED_POST_ENTITY = "feed_post";
export const FEED_COMMENT_ENTITY = "feed_comment";

/** Cặp gác ĐƯỜNG ĐỌC của bảng tin — CÙNG cặp mà mọi route đọc bài bắt buộc. */
const FEED_READ_PAIR = { action: "view", resourceType: "feed", isSensitive: false } as const;
/** Cặp gác ĐƯỜNG GHI — ai tạo được bài/bình luận thì gắn được tệp vào nội dung của chính mình. */
const FEED_POST_CREATE_PAIR = {
  action: "create",
  resourceType: "feed-post",
  isSensitive: false,
} as const;
const FEED_COMMENT_CREATE_PAIR = {
  action: "create",
  resourceType: "feed-comment",
  isSensitive: false,
} as const;

/** `scan_status` được phép gắn — Pending/Failed/Infected đều bị từ chối TRƯỚC khi tạo link. */
const LINKABLE_SCAN = new Set(["Clean", "NotRequired"]);

/**
 * S16-SOCIAL-BE-1 (plan §2 D18) — resolver quyền tệp đính kèm bài/bình luận, khuôn
 * `RecruitCandidateFileResolver`/`ChatMessageFileResolver`.
 *
 * ┌─ VÌ SAO FILE NÀY BẮT BUỘC PHẢI TỒN TẠI TRƯỚC KHI CÓ ĐÍNH KÈM ĐẦU TIÊN ─────────────────────────┐
 * │ `FilePolicyService.decideForLinkedFile` DENY `deny-no-resolver` khi một link có cặp              │
 * │ `(module, entity)` chưa ai đăng ký — và nó KHÔNG BAO GIỜ leo thang lên `FOUNDATION.FILE.*`.      │
 * │ Không có resolver này thì: (a) mọi đính kèm SOCIAL không ký được URL, và tệ hơn (b) vì luật là    │
 * │ AND trên MỌI link của tệp, gắn một tệp vào bài sẽ làm tệp đó **không tải được ở mọi module khác**│
 * │ nữa. Tức là thiếu file này không phải "thiếu tính năng" — nó làm hỏng tệp của module khác.       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ⚠️ CỔNG ĐƯỜNG TẢI = CỔNG MÀN HÌNH, KHÔNG ĐƯỢC LỆCH ──────────────────────────────────────────┐
 * │ `canViewFile`/`canDownloadFile` KHÔNG chỉ hỏi cặp `view:feed` — nó còn chạy CHÍNH                │
 * │ `visiblePostCondition` trên bài chứa tệp. Vì sao: `view:feed` là cặp của MỌI người trong công    │
 * │ ty (seed 0578 cấp cho cả 4 vai canonical). Dừng ở cặp quyền nghĩa là bất kỳ ai cũng tải được     │
 * │ đính kèm của một bài `hidden` hoặc bài `audience='org_unit'` của đơn vị khác — đúng cái mà       │
 * │ `assertPostVisible` từ chối 404 ở đường REST. Bài học `read-path-gate-pair-must-match-download-  │
 * │ pair` nói về cặp QUYỀN; ở đây còn một vế nữa là cùng VỊ TỪ HÀNG.                                 │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Fail-closed ở mọi nhánh: không tìm thấy / khác tenant / xoá mềm / lỗi ⇒ `false`.
 */
@Injectable()
export class SocialFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = SOCIAL_MODULE;
  readonly entityTypes: readonly string[] = [FEED_POST_ENTITY, FEED_COMMENT_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly access: SocialAccessService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
  ) {}

  /** VIEW metadata ⇔ thấy được NỘI DUNG chứa tệp. Xem khối ⚠️ ở jsdoc lớp. */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canReadOwner(input);
  }

  /** DOWNLOAD ⇔ CÙNG điều kiện với VIEW — SOCIAL không có cặp download riêng (SPEC-16 §11). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canReadOwner(input);
  }

  /**
   * LINK ⇔ SÁU vế cùng đúng (khuôn nguyên văn `RecruitCandidateFileResolver.canAttachToCandidate`):
   *
   *   1. `fileId` có mặt — vắng (pre-link check) ⇒ deny, fail-closed;
   *   2. **CALLER SỞ HỮU TỆP** (`files.owner_user_id === userId`) — chốt chặn TẠI NGUỒN: không mượn
   *      kênh bảng tin để phát tán tệp của người khác trong tenant (plan §5 R27);
   *   3. `upload_status === 'Uploaded'` — tệp Pending chưa có bytes;
   *   4. `scan_status` ∈ {Clean, NotRequired} — CHẶT HƠN `FileService` (nó chỉ chặn Infected);
   *   5. **TỆP CHƯA TỪNG CÓ LINK NÀO** — đóng đường tái-link để phục hồi một tệp đã bị thu hồi
   *      (`deny-links-revoked` sẽ hết hiệu lực ngay khi tệp có link sống trở lại), và đóng luôn
   *      đường gắn tệp foundation-owned 0-link;
   *   6. cặp quyền GHI của đúng loại nội dung + nội dung đó actor **ghi được** (tác giả, hoặc
   *      `manage:feed-post`).
   */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAttach(input);
  }

  /** DELETE ⇔ ghi được nội dung chứa tệp (tác giả hoặc `manage:feed-post`). */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canWriteOwner(input);
  }

  /** UNLINK ⇔ cùng điều kiện với DELETE. */
  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canWriteOwner(input);
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /** Cặp `view:feed` + vị từ visibility của CHÍNH bài/bình luận chứa tệp. */
  private async canReadOwner(input: FilePermissionInput): Promise<boolean> {
    const scopes = await this.resolveReadScopes(input);
    if (scopes === null) return false;
    return (await this.ownerContent(input, scopes.managePostsScope)) !== null;
  }

  /** Đọc được + là tác giả (hoặc `manage:feed-post`). */
  private async canWriteOwner(input: FilePermissionInput): Promise<boolean> {
    const scopes = await this.resolveReadScopes(input);
    if (scopes === null) return false;
    const owner = await this.ownerContent(input, scopes.managePostsScope);
    if (owner === null) return false;
    return owner.authorUserId === input.userId || owner.viewer.canManagePosts;
  }

  /**
   * S16-SOCIAL-PERMCOST-1 — `view:feed` (cổng) và `manage:feed-post` (NGUYÊN LIỆU vị từ visibility)
   * trong MỘT lượt `resolveManyOrNull` = một lần nạp ảnh chụp grant. Trước đây `resolveViewerContext`
   * nạp lại lần hai cho mỗi lượt ký URL đính kèm.
   *
   * Hai câu hỏi vẫn KHÁC NHAU và được đọc THEO CHỈ SỐ: `manage:feed-post` KHÔNG thay được `view:feed`
   * — thiếu `view:feed` ⇒ `null` (deny) dù scope manage là gì.
   */
  private async resolveReadScopes(
    input: FilePermissionInput,
  ): Promise<{ managePostsScope: DataScope | null } | null> {
    const [readScope, managePostsScope] = await this.dataScope.resolveManyOrNull(
      input.userId,
      input.companyId,
      [FEED_READ_PAIR, MANAGE_POSTS_PAIR],
    );
    // `== null` CỐ Ý (không `=== null`): mảng trả ngắn hơn số cặp hỏi ⇒ `undefined` ⇒ phải DENY.
    if (readScope == null) return null;
    return { managePostsScope: managePostsScope ?? null };
  }

  private async canAttach(input: FilePermissionInput): Promise<boolean> {
    const fileId = input.fileId;
    if (!fileId) return false; // vế 1

    // vế 6a — cặp GHI của đúng loại nội dung. Tệp gắn vào bình luận không mượn cặp tạo BÀI.
    const createPair =
      input.entityType === FEED_COMMENT_ENTITY ? FEED_COMMENT_CREATE_PAIR : FEED_POST_CREATE_PAIR;
    // `manage:feed-post` hỏi CÙNG lượt (PERMCOST-1) — nó là nguyên liệu vị từ của vế 6b, không cấp phép.
    const [createScope, readScope, managePostsScope] = await this.dataScope.resolveManyOrNull(
      input.userId,
      input.companyId,
      [createPair, FEED_READ_PAIR, MANAGE_POSTS_PAIR],
    );
    // `== null` CỐ Ý — `undefined` (mảng ngắn) phải fail-closed; `=== null` cũ để nó lọt.
    if (createScope == null || readScope == null) return false;

    // vế 2-5 — trạng thái tệp, đọc trong MỘT tenant tx.
    const state = await this.db.withTenant(input.companyId, async (tx) => {
      const file = await this.fileRepo.findByIdTx(input.companyId, fileId, tx);
      if (!file) return null;
      const everLinked = await this.linkRepo.hasEverBeenLinkedTx(input.companyId, fileId, tx);
      return { file, everLinked };
    });
    if (state === null) return false;
    if (state.file.ownerUserId !== input.userId) return false; // vế 2
    if (state.file.uploadStatus !== "Uploaded") return false; // vế 3
    if (!LINKABLE_SCAN.has(state.file.scanStatus)) return false; // vế 4
    if (state.everLinked) return false; // vế 5

    // vế 6b — nội dung đích actor ghi được.
    const owner = await this.ownerContent(input, managePostsScope ?? null);
    if (owner === null) return false;
    return owner.authorUserId === input.userId || owner.viewer.canManagePosts;
  }

  /**
   * Nội dung (bài hoặc bình luận) mà tệp được gắn vào, ĐÃ QUA vị từ visibility.
   *
   * `null` = KHÔNG THẤY ĐƯỢC (404 của `assert*Visible`) — ở đây 404 là một câu TRẢ LỜI, không phải sự
   * cố, nên nuốt nó là đúng: hợp đồng của resolver là boolean fail-closed, và "không tồn tại" ⇄ "không
   * có quyền" hợp nhất tự nhiên theo luật 404-cho-mọi-lý-do của đường REST.
   *
   * `managePostsScope` là scope `MANAGE_POSTS_PAIR` caller đã resolve CÙNG LƯỢT với cổng cặp — KHÔNG
   * gọi `resolveViewerContext` ở đây (nó nạp ảnh chụp grant lần hai — S16-SOCIAL-PERMCOST-1).
   *
   * MỌI lỗi khác (DB timeout, cạn pool, bug ở `buildViewerContext`/`assert*Visible`) PHẢI ném tiếp.
   * Nuốt trắng như bản đầu là biến một sự cố hạ tầng thật thành "không có quyền" TRONG IM LẶNG:
   * `FilePolicyService.decideForLinkedFile` có try/catch riêng để xếp loại resolver-throw thành
   * `deny-error` CÓ LOG, và `SocialAttachmentsService.signOne` dựa ĐÚNG vào `reason` đó để
   * `logger.error`. Nuốt ở đây thì sự cố rơi vào nhánh `deny-resolver` = "từ chối bình thường, không
   * log" ⇒ mất sạch dấu vết, sự cố toàn hệ thống thành "tôi không xem được ảnh của chính mình" không
   * ai gỡ được. Sibling `ChatMessageFileResolver.seesMessage` làm đúng luật này.
   */
  private async ownerContent(
    input: FilePermissionInput,
    managePostsScope: DataScope | null,
  ): Promise<{ authorUserId: string; viewer: SocialViewerContext } | null> {
    try {
      const viewer = await this.access.buildViewerContext(
        input.userId,
        input.companyId,
        managePostsScope,
      );
      return await this.db.withTenant(input.companyId, async (tx) => {
        if (input.entityType === FEED_COMMENT_ENTITY) {
          const comment = await this.access.assertCommentVisible(tx, viewer, input.entityId);
          return { authorUserId: comment.authorUserId, viewer };
        }
        const post = await this.access.assertPostVisible(tx, viewer, input.entityId);
        return { authorUserId: post.authorUserId, viewer };
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/**
 * Nhận diện 404 mà KHÔNG `instanceof NotFoundException`: `withTenant` có thể bọc lại lỗi, và ở worker
 * vitest hai bản `@nestjs/common` khác instance làm `instanceof` trượt trong im lặng ⇒ deny-error thay
 * vì deny sạch. Soi `getStatus()` là bất biến qua mọi cách bọc.
 *
 * Bản sao của `isNotFound` trong `ChatMessageFileResolver` — CỐ Ý nhân bản: `apps/api/src/chat/**`
 * NGOÀI `paths` của WO này. Nợ gom về một util dùng chung ghi cho `S16-SOCIAL-BE-2`.
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { getStatus?: unknown; status?: unknown };
  if (typeof candidate.getStatus === "function") {
    return (candidate.getStatus as () => number)() === 404;
  }
  return candidate.status === 404;
}
