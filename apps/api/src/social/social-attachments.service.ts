import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_IMAGES_PER_POST,
  FEED_MAX_VIDEOS_PER_POST,
  type FeedAttachmentDto,
  type FeedAttachmentKindDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { fileLinks, files } from "../db/schema/files";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { FilePolicyAction } from "../foundation/files/file-policy.types";
import { SecurityAlertService } from "../auth/security-alert.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter.port";
import { ATTACH_GATE_ROUTE_TARGET, SOCIAL_FILE_TARGET_PAIRS } from "./social-route-pairs.const";
import { FEED_COMMENT_ENTITY, FEED_POST_ENTITY, SOCIAL_MODULE } from "./social-file.resolver";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialTargetType, SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-ATTGATE-1 (plan D-1/D-2, owner ký S-1/S-6 ngày 24/09/2026) — cổng «được GẮN tệp MỚI
 * vào đích này», tức vế 6a của `SocialFileResolver.canLinkFile` (cặp `create:feed-*` theo đích).
 *
 * ┌─ VÌ SAO LÀ MỘT GIÁ TRỊ TRUYỀN VÀO, KHÔNG PHẢI MỘT LỜI GỌI QUYỀN TẠI CHỖ ──────────────────────┐
 * │ `syncLinksTx` chạy BÊN TRONG transaction nghiệp vụ. Hỏi quyền ở đây nghĩa là gọi               │
 * │ `dataScope.resolveManyOrNull` → `permission.repository.ts:70` **tự mở `withTenant`** ⇒         │
 * │ `withTenant` LỒNG `withTenant`. `db.service.ts:83` không tái nhập (không ALS, không truyền tx  │
 * │ hiện hành) nên đó là client THỨ HAI lấy từ pool trong khi client thứ nhất còn giữ tx; pool     │
 * │ `max: 20` ⇒ đủ request đồng thời là **TREO IM LẶNG, không lỗi, không log**. Cùng lý do đã ghi  │
 * │ ở docblock lớp bên dưới về `FileService.link()`.                                               │
 * │ ⇒ RESOLVE quyền NGOÀI tx (`SocialAccessService.resolveAttachNewGate`), ÁP quyết định TRONG tx. │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Union phân biệt, KHÔNG phải `{ denyMessage: string | null }`** (plan F-2): hình dạng «vắng
 * mặt = cho qua» là fail-OPEN đội lốt — `undefined`, `""`, hay object dựng thiếu field qua một
 * `Partial`/cast đều lọt mà TS không bắt. Ở đây DENY là nhánh phải CHỦ ĐỘNG thoát ra: đọc `gate.allow`
 * trên một object thiếu field cho `undefined` ⇒ `!gate.allow` ⇒ **ném**.
 */
export type AttachNewGate =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/**
 * S16-SOCIAL-ATTDEBT-1 (C-5, plan D-5 lối (g)) — ngoại lệ của nhánh DENY cổng gắn tệp, **mang theo
 * ngữ cảnh** để ghi vết BỀN sau khi transaction nghiệp vụ đã cuộn.
 *
 * ┌─ VÌ SAO PHẢI LÀ MỘT LỚP, KHÔNG PHẢI SO CHUỖI THÔNG ĐIỆP ────────────────────────────────────┐
 * │ Cùng transaction đó còn ném `ForbiddenException` từ `assertCanMutateContent` (SOCIAL-ERR-003).│
 * │ Phân biệt bằng `err.message.includes(...)` là một hợp đồng NGẦM: một lượt đổi câu chữ (đã có  │
 * │ nợ D-4 của ATTGATE-1 muốn đổi đúng hai hằng đó!) giết lưới trong im lặng và alert ngừng ghi   │
 * │ mà không ai biết. `instanceof` không có kiểu hỏng đó. Ca int-spec H9 đo đúng điều này.        │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `super(reason)` ⇒ **hợp đồng HTTP KHÔNG đổi**: vẫn 403, vẫn đúng hằng `FILE_TARGET_*_DENIED`.
 * Đây là lớp con thuần-thêm-dữ-liệu, không phải một mã lỗi mới.
 *
 * ⚠️ `signal` CỐ Ý **không** mang `route`: `syncLinksTx` không nhận `actor`/`routeKey` và thêm tham
 * số cho nó là đường cụt (xem docblock `syncLinksTx`). `route` được DẪN XUẤT ở `reportAttachGateDeny`
 * từ nghịch đảo `ATTACH_GATE_ROUTE_TARGET`.
 */
export class SocialAttachGateDeniedException extends ForbiddenException {
  constructor(
    reason: string,
    readonly signal: {
      readonly targetType: SocialTargetType;
      readonly targetId: string;
      readonly actorUserId: string;
      readonly newFileCount: number;
    },
  ) {
    super(reason);
  }
}

/**
 * Cổng của ĐƯỜNG TẠO (`SOCIAL-API-002` / `015`): cặp `create:feed-post` / `create:feed-comment` đã
 * bị ép ở **CẢ HAI** tầng trước khi service chạy — decorator `@RequirePermission`
 * (`social.controllers.ts:90` và `:258`) và `SocialAccessService.resolveActor` (`:105-121`, ném độc
 * lập với decorator). Hỏi lại ở đây là một round-trip quyền thừa trên đường nóng nhất của module.
 *
 * 🔴 **CHỈ dùng ở 2 call-site TẠO.** Đường SỬA (`004`/`016`) gác `view:feed` — dán hằng này lên đó
 * là ghim một lời khai SAI vào mã; `social-file-target-pairs-structure.spec.ts` đếm đúng 2 lần xuất
 * hiện để chặn việc đó.
 */
export const ATTACH_GATE_ENFORCED_BY_TIER1: AttachNewGate = { allow: true };

/** `scan_status` được phép gắn — mirror `SocialFileResolver.LINKABLE_SCAN`. */
const LINKABLE_SCAN = new Set(["Clean", "NotRequired"]);
/**
 * `file_links.link_type` — mirror `chk_file_links_link_type`, tập giá trị VIẾT HOA
 * (`Avatar|Attachment|Contract|Proof|Document|Import|Export|Other`).
 *
 * ⚠️ Chữ thường (`"attachment"`) vỡ CHECK thành **500 vô danh**, và drizzle giấu mã PG trong
 * `error.cause` nên log chỉ hiện "Failed query: insert into file_links …" — không có chữ nào nói
 * ràng buộc nào vỡ.
 */
const LINK_TYPE = "Attachment";

/**
 * S16-SOCIAL-BE-1 (plan §2 D18) — đính kèm ảnh/video cho bài & bình luận.
 *
 * ┌─ VÌ SAO KHÔNG GỌI `FileService.link()` ────────────────────────────────────────────────────────┐
 * │ `FileService.link` hỏi `policy.canLink` **NGOÀI mọi transaction** (`files.service.ts:549` trước  │
 * │ `:574`) và resolver bên trong lại tự mở `withTenant` riêng. Gọi nó từ trong transaction nghiệp   │
 * │ vụ = `withTenant` lồng `withTenant` ⇒ chiếm client thứ hai từ pool khi client thứ nhất còn giữ   │
 * │ transaction, và trên **PgBouncer transaction-mode nó TREO chứ không báo lỗi**.                   │
 * │ Gọi nó SAU commit thì mất tính nguyên tử: bài đã đăng, tệp gắn hỏng, không có đường lùi.         │
 * │ ⇒ Ở đây ta ghi `file_links` TRONG CÙNG tx, và ép LẠI ĐÚNG các vế mà `SocialFileResolver          │
 * │ .canLinkFile` ép — bằng cách dùng CHUNG `assertLinkableFilesTx` dưới đây, không phải bằng một    │
 * │ bản sao. Resolver vẫn là cổng của đường ghi đi qua route FOUNDATION.                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KÝ URL PHẢI Ở NGOÀI TRANSACTION** — cùng lý do `withTenant` lồng nhau ở trên
 * (`chat-attachments.service.ts:79-83`). Mọi caller: đọc row TRONG tx → commit → gọi `decorate*`.
 */
@Injectable()
export class SocialAttachmentsService {
  private readonly logger = new Logger(SocialAttachmentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: FilePolicyService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    // S16-SOCIAL-ATTDEBT-1 (C-5) — từ `SecurityAlertModule` (module LÁ), KHÔNG từ `AuthModule`.
    private readonly securityAlerts: SecurityAlertService,
  ) {}

  /**
   * S16-SOCIAL-ATTDEBT-1 (C-5) — cửa sổ KHỬ TRÙNG trong-tiến-trình cho alert của cổng gắn tệp.
   *
   * 🔴 **Vì sao cần** (phép đo 24/09/2026, ĐỔI kết luận của plan gốc — owner ký S-5): `APP_GUARD`
   * (`app.module.ts:143-145`) chỉ có `JwtAuthGuard`/`CompanyGuard`/`TwoFactorEnforcementGuard` —
   * **KHÔNG có `ThrottlerGuard`** ở bất kỳ đâu trong `src`; và `security_alerts` nằm trong
   * `PROTECTED_TABLES` của `retention.service.ts` nên **không có đường dọn**, app role chỉ có
   * `SELECT, INSERT`. Ghi một hàng cho MỖI lượt deny = vector phình **vô hạn, không xoá được**, do
   * một vòng lặp PATCH của bất kỳ vai nào thiếu cặp `create:feed-*` kích hoạt. Nó cũng sẽ làm
   * `attach_gate_deny` thành loại DUY NHẤT không-ngưỡng trong bảng mà 3 loại kia đều `repeated_*`.
   *
   * ⚠️ TRONG-TIẾN-TRÌNH, có chủ ý: 0 chi phí DB và KHÔNG đụng `SecurityAlertService` (crown-jewel
   * của AUTH). Giá phải trả — khai thẳng: nhiều tiến trình / một lượt restart ⇒ cửa sổ mở lại. Đây
   * là giảm-thiểu phòng-thủ-theo-chiều-sâu, KHÔNG phải một bảo đảm; `logger.warn` ở nhánh deny vẫn
   * ghi MỌI lượt nên không có lượt deny nào biến mất khỏi mọi vết.
   */
  private static readonly ALERT_DEDUPE_MS = 60_000;
  private readonly alertSeenAt = new Map<string, number>();

  /**
   * `true` nếu lượt deny này nên ghi alert (chưa thấy trong cửa sổ). Dọn khoá hết hạn ngay trong
   * lượt quét — Map này KHÔNG được phép lớn vô hạn (đó là cùng lớp lỗi mà nó đang đi vá).
   */
  private shouldEmitAlert(key: string, now: number): boolean {
    for (const [k, at] of this.alertSeenAt) {
      if (now - at >= SocialAttachmentsService.ALERT_DEDUPE_MS) this.alertSeenAt.delete(k);
    }
    const seen = this.alertSeenAt.get(key);
    if (seen !== undefined && now - seen < SocialAttachmentsService.ALERT_DEDUPE_MS) return false;
    this.alertSeenAt.set(key, now);
    return true;
  }

  /**
   * S16-SOCIAL-ATTDEBT-1 (C-5) — ghi vết BỀN cho một lượt DENY của cổng gắn tệp.
   *
   * 🔴 **GỌI Ở NGOÀI `withTenant`, KHÔNG BAO GIỜ Ở TRONG.** Ba lối sai và vì sao:
   *  - `audit.record(tx, …)` / `emitTx(tx, …)` tại chỗ ném ⇒ cú ném roll back cả tx ⇒ hàng biến mất
   *    cùng lượt sửa (ca G15 của ATTGATE-1 assert đúng điều đó).
   *  - `emit()` tại chỗ ném ⇒ nó **tự mở `withTenant`** trong khi tx nghiệp vụ còn giữ client ⇒
   *    `withTenant` LỒNG `withTenant`; `db.service.ts:83` không tái nhập, pool `max:20` ⇒ **TREO IM
   *    LẶNG**, không lỗi, không log. Đây là bẫy trung tâm của cả wave này.
   *  ⇒ Đường đúng: ngoại lệ bay RA khỏi `withTenant` (tx đã cuộn xong), `update()` bắt bằng
   *    `instanceof`, gọi hàm này, rồi **ném lại nguyên vật**.
   *
   * Best-effort: `emit()` nuốt lỗi ghi (đã log) ⇒ deny vẫn là deny. Hàm này KHÔNG được phép đổi
   * outcome an ninh của caller.
   */
  async reportAttachGateDeny(err: unknown, companyId: string): Promise<void> {
    // No-op cho MỌI ngoại lệ khác — `assertCanMutateContent` cũng ném `ForbiddenException` từ trong
    // CÙNG tx, và nó KHÔNG phải một lượt deny của cổng gắn tệp.
    if (!(err instanceof SocialAttachGateDeniedException)) return;

    const { targetType, targetId, actorUserId, newFileCount } = err.signal;
    const key = `${companyId}:${actorUserId}:${targetType}:${targetId}`;
    if (!this.shouldEmitAlert(key, Date.now())) return;

    // `route` DẪN XUẤT từ nghịch đảo bảng `ATTACH_GATE_ROUTE_TARGET` ⇒ 0 tham số mới cho
    // `syncLinksTx`, và bảng đó thành load-bearing lần thứ hai (lần đầu: `resolveActor`).
    const route =
      Object.entries(ATTACH_GATE_ROUTE_TARGET).find(([, t]) => t === targetType)?.[0] ?? "unknown";
    const pair = `${SOCIAL_FILE_TARGET_PAIRS[targetType].action}:${SOCIAL_FILE_TARGET_PAIRS[targetType].resourceType}`;

    // 🔴 TỰ BỌC try/catch, KHÔNG dựa vào `emit()` nuốt hộ. `emit()` hôm nay nuốt lỗi ghi và trả
    // `false`, nhưng caller của hàm này là khối `catch` của `update()` và nó ném LẠI lỗi 403 ngay
    // sau. Nếu một ngày `emit` (hoặc một lớp chèn giữa) ném, ngoại lệ đó sẽ THAY THẾ lỗi 403 gốc ⇒
    // người dùng nhận **500 thay vì 403**, tức một sự cố hạ tầng ghi đè lên một quyết định an ninh.
    // Vết phòng-thủ-theo-chiều-sâu KHÔNG bao giờ được đổi outcome của thứ nó đang quan sát.
    try {
      await this.securityAlerts.emit(companyId, {
        alertType: "attach_gate_deny",
        // `low`: một lượt deny lẻ không phải sự cố (owner ký S-3).
        severity: "low",
        subjectUserId: actorUserId,
        // 🔴 TÊN KHOÁ phải sống sót `sanitizeDetail` — nó loại MỌI khoá khớp
        // /(password|secret|token|code|otp|dek|cipher|hash|key)/i, **im lặng**. Vì thế là `route`
        // chứ KHÔNG `routeCode`, `pair` chứ KHÔNG `pairKey`, và không `moduleCode` nào ở đây.
        // Chỉ SỐ LƯỢNG tệp — không id, không tên tệp (cùng kỷ luật với `logger.warn` nhánh deny).
        detail: { route, target: targetType, targetId, newFiles: newFileCount, pair },
      });
    } catch (alertErr) {
      // KHÔNG nuốt IM: log rồi thôi. Deny vẫn là deny.
      this.logger.error(
        `Không ghi được security_alert cho attach-gate DENY (outcome 403 giữ nguyên): ${
          alertErr instanceof Error ? alertErr.message : String(alertErr)
        }`,
      );
    }
  }

  /**
   * Ép MỌI vế của đường gắn tệp, TRONG tx nghiệp vụ. Ném 422 `SOCIAL-ERR-007` ở mọi nhánh hỏng.
   *
   * Vế 2-5 trùng ĐÚNG với `SocialFileResolver.canLinkFile` (xem jsdoc ở đó để biết vì sao từng vế
   * tồn tại). Vế giới hạn số lượng/dung lượng là của SPEC-16 §16 và chỉ có ở đây — resolver không
   * đếm được "bài này đã có mấy ảnh".
   *
   * 🔴 **VẾ 6a KHÔNG Ở ĐÂY, và đó là CÓ CHỦ ĐÍCH** (S16-SOCIAL-ATTGATE-1): cặp `create:feed-*` theo
   * đích được ép bởi tham số `gate` của `syncLinksTx` — một quyết định resolve NGOÀI tx, vì hỏi
   * quyền trong tx = `withTenant` lồng nhau = treo im lặng (xem docblock `AttachNewGate`). Đừng
   * "hoàn thiện" hàm này bằng một lời gọi `dataScope`/`access` — đó chính là cái bẫy.
   *
   * ⚠️ Thông điệp lỗi CỐ Ý không nói tệp nào hỏng vì lý do gì: `fileId` do client gửi lên, nhưng
   * "tệp này tồn tại nhưng không phải của bạn" và "tệp này không tồn tại" phải không phân biệt được
   * — nếu không, vòng lặp đoán UUID đọc được kho tệp của cả công ty.
   */
  async assertLinkableFilesTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    fileIds: readonly string[],
  ): Promise<FileRow[]> {
    if (fileIds.length === 0) return [];
    const unique = [...new Set(fileIds)];

    const rows = await tx
      .select({
        id: files.id,
        originalName: files.originalName,
        mimeType: files.mimeType,
        fileSizeBytes: files.fileSizeBytes,
        storagePath: files.storagePath,
        uploadStatus: files.uploadStatus,
        scanStatus: files.scanStatus,
        ownerUserId: files.ownerUserId,
      })
      .from(files)
      .where(
        and(eq(files.companyId, companyId), inArray(files.id, unique), isNull(files.deletedAt)),
      );

    // Thiếu tệp nào ⇒ hỏng — KHÔNG "bỏ qua tệp không tìm thấy": bỏ qua im lặng làm người dùng đăng
    // bài rồi phát hiện ảnh biến mất, không lỗi, không cách nào biết vì sao.
    if (rows.length !== unique.length) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID);
    }
    for (const f of rows) {
      if (f.ownerUserId !== userId)
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 2
      if (f.uploadStatus !== "Uploaded")
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 3
      if (!LINKABLE_SCAN.has(f.scanStatus))
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID); // vế 4
      if (f.fileSizeBytes > FEED_MAX_ATTACHMENT_BYTES)
        throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_LIMIT);
    }

    // vế 5 — tệp CHƯA TỪNG có link nào (kể cả link đã gỡ). `deleted_at` KHÔNG lọc ở đây có chủ đích:
    // câu hỏi là "đã từng", không phải "đang".
    const everLinked = await tx
      .select({ fileId: fileLinks.fileId })
      .from(fileLinks)
      .where(and(eq(fileLinks.companyId, companyId), inArray(fileLinks.fileId, unique)));
    if (everLinked.length > 0) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_INVALID);
    }

    // Giới hạn SPEC-16 §16 theo LOẠI.
    const images = rows.filter((f) => kindOf(f.mimeType) === "image").length;
    const videos = rows.filter((f) => kindOf(f.mimeType) === "video").length;
    if (images > FEED_MAX_IMAGES_PER_POST || videos > FEED_MAX_VIDEOS_PER_POST) {
      throw new UnprocessableEntityException(SOCIAL_ERR.ATTACHMENT_LIMIT);
    }

    return rows;
  }

  /**
   * Ghi `file_links` cho một nội dung, TRONG tx. Dùng lúc TẠO (tập rỗng ban đầu) và lúc SỬA (thay
   * toàn bộ tập).
   *
   * Lúc sửa: link cũ bị **gỡ mềm** (`deleted_at`), không xoá cứng — `file_links` là vết của việc
   * "tệp này đã từng thuộc về đâu", và vế 5 ở trên dựa vào chính vết đó để chặn tái-link.
   *
   * `gate` (S16-SOCIAL-ATTGATE-1) là vế 6a — cặp `create:feed-*` theo đích — đã resolve NGOÀI tx.
   * Tham số **BẮT BUỘC**, không optional, không default: một call-site thứ năm quên khai là TS đỏ
   * lúc build, không phải một đường gắn không cổng phát hiện sau khi ship.
   */
  async syncLinksTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    targetType: SocialTargetType,
    targetId: string,
    fileIds: readonly string[],
    gate: AttachNewGate,
  ): Promise<void> {
    const entityType = targetType === "post" ? FEED_POST_ENTITY : FEED_COMMENT_ENTITY;

    const current = await tx
      .select({ id: fileLinks.id, fileId: fileLinks.fileId })
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, SOCIAL_MODULE),
          eq(fileLinks.entityType, entityType),
          eq(fileLinks.entityId, targetId),
          isNull(fileLinks.deletedAt),
        ),
      );
    const had = new Set(current.map((r) => r.fileId));
    const wanted = new Set(fileIds);

    const toUnlink = current.filter((r) => !wanted.has(r.fileId));
    if (toUnlink.length > 0) {
      await tx
        .update(fileLinks)
        // `deletedBy` (FULL gate 24/09/2026, `database-reviewer` F3): cột đã có sẵn, trước đây để
        // NULL. Từ S16-SOCIAL-ATTGATE-1, việc «vai `manage:feed-post` GỠ đính kèm của người khác mà
        // KHÔNG cần cặp `create:feed-*`» là hành vi CHÍNH THỨC (owner ký S-1) — mà gỡ là MỘT CHIỀU
        // (vế 5 «đã TỪNG link» làm tệp không gắn lại được). Không ghi ai gỡ thì không còn nơi nào
        // trả lời được câu đó: audit của `004` chỉ mang `{postId, authorUserId}`.
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(
          and(
            eq(fileLinks.companyId, companyId),
            inArray(
              fileLinks.id,
              toUnlink.map((r) => r.id),
            ),
          ),
        );
    }

    const toAdd = [...wanted].filter((id) => !had.has(id));
    if (toAdd.length === 0) return;

    // ┌─ VẾ 6a — CẶP `create` THEO ĐÍCH (S16-SOCIAL-ATTGATE-1) ──────────────────────────────────┐
    // │ Đặt SAU `toAdd.length === 0` là toàn bộ nội dung quyết định D-1 (owner ký S-1): lượt sửa  │
    // │ KHÔNG thêm tệp nào — gỡ bớt, gửi lại y nguyên danh sách, hay `[]` để bỏ hết — **không**   │
    // │ đòi cặp `create`. Nếu không, vai `manage:feed-post` mất luôn khả năng GỠ một ảnh vi phạm  │
    // │ (FE gửi lại danh sách còn lại ⇒ non-empty ⇒ 403): đó là hồi quy CHỨC NĂNG kiểm duyệt,     │
    // │ không phải siết chặt.                                                                     │
    // │ Đặt TRƯỚC `assertLinkableFilesTx` cũng có chủ đích: "anh có được gắn không" đi trước      │
    // │ "tệp này có gắn được không" ⇒ vai thiếu cặp nhận **403**, không phải 422 nói về sở hữu    │
    // │ tệp — một mã 422 ở đây sẽ mô tả sai hoàn toàn lý do bị chặn.                              │
    // └───────────────────────────────────────────────────────────────────────────────────────────┘
    if (!gate.allow) {
      // ⚠️ PHẢI là `logger`, KHÔNG phải `audit.record(tx, …)`: cú ném ngay dưới roll back cả tx
      // (D-7, ca G15 assert đúng điều đó) ⇒ một hàng audit sẽ biến mất cùng lượt sửa. Lời gọi
      // logger sống sót qua rollback. Không có dòng này thì cổng crown-jewel là vùng MÙ: filter
      // toàn cục chỉ log khi status ≥ 500, nên một vai đâm liên tục vào 403 mới để lại 0 log ·
      // 0 audit · 0 số đo. KHÔNG log id/tên tệp — chỉ SỐ LƯỢNG.
      this.logger.warn(
        `SOCIAL attach-gate DENY target=${targetType}:${targetId} actor=${userId} newFiles=${toAdd.length}`,
      );
      // S16-SOCIAL-ATTDEBT-1 (C-5): ném LỚP MANG NGỮ CẢNH. Dòng `logger.warn` ngay trên GIỮ NGUYÊN,
      // không thay bằng alert: hai vết hỏng theo hai cách khác nhau — `emit()` nuốt lỗi ghi alert
      // (`security-alert.service.ts:64-76`), còn log thì không phụ thuộc DB.
      throw new SocialAttachGateDeniedException(gate.reason, {
        targetType,
        targetId,
        actorUserId: userId,
        newFileCount: toAdd.length,
      });
    }

    // Chỉ tệp MỚI mới đi qua cổng — tệp đã gắn từ trước đã qua rồi, và bắt nó qua lại sẽ đỏ ở vế 5
    // ("đã từng có link" — chính là link của nó).
    await this.assertLinkableFilesTx(tx, companyId, userId, toAdd);

    await tx.insert(fileLinks).values(
      toAdd.map((fileId, i) => ({
        companyId,
        fileId,
        moduleCode: SOCIAL_MODULE,
        entityType,
        entityId: targetId,
        linkType: LINK_TYPE,
        sortOrder: i,
        createdBy: userId,
      })),
    );
  }

  /**
   * `targetId → đính kèm ĐÃ KÝ cho CHÍNH người gọi`. **GỌI SAU KHI tx đã commit.**
   *
   * Một truy vấn cho cả lô (không phải một truy vấn mỗi bài), rồi một quyết định policy mỗi TỆP.
   */
  async decorateMany(
    viewer: SocialViewerContext,
    targetType: SocialTargetType,
    targetIds: readonly string[],
  ): Promise<Map<string, FeedAttachmentDto[]>> {
    const out = new Map<string, FeedAttachmentDto[]>();
    if (targetIds.length === 0) return out;
    const entityType = targetType === "post" ? FEED_POST_ENTITY : FEED_COMMENT_ENTITY;

    const rows = await this.db.withTenant(viewer.companyId, (tx) =>
      tx
        .select({
          entityId: fileLinks.entityId,
          fileId: files.id,
          originalName: files.originalName,
          mimeType: files.mimeType,
          fileSizeBytes: files.fileSizeBytes,
          storagePath: files.storagePath,
          sortOrder: fileLinks.sortOrder,
        })
        .from(fileLinks)
        .innerJoin(
          files,
          and(eq(files.id, fileLinks.fileId), eq(files.companyId, fileLinks.companyId)),
        )
        .where(
          and(
            eq(fileLinks.companyId, viewer.companyId),
            eq(fileLinks.moduleCode, SOCIAL_MODULE),
            eq(fileLinks.entityType, entityType),
            inArray(fileLinks.entityId, [...targetIds]),
            isNull(fileLinks.deletedAt),
            isNull(files.deletedAt),
          ),
        ),
    );
    if (rows.length === 0) return out;

    // Luật AND của `decideForLinkedFile` chỉ đúng khi thấy ĐỦ link của tệp — kể cả link của module
    // khác. Truy vấn này vì vậy KHÔNG lọc `module_code`.
    const fileIds = [...new Set(rows.map((r) => r.fileId))];
    const linksByFile = await this.db.withTenant(viewer.companyId, async (tx) => {
      const all = await tx
        .select({
          fileId: fileLinks.fileId,
          moduleCode: fileLinks.moduleCode,
          entityType: fileLinks.entityType,
          entityId: fileLinks.entityId,
        })
        .from(fileLinks)
        .where(
          and(
            eq(fileLinks.companyId, viewer.companyId),
            inArray(fileLinks.fileId, fileIds),
            isNull(fileLinks.deletedAt),
          ),
        );
      const map = new Map<string, { moduleCode: string; entityType: string; entityId: string }[]>();
      for (const l of all) {
        const list = map.get(l.fileId) ?? [];
        list.push({ moduleCode: l.moduleCode, entityType: l.entityType, entityId: l.entityId });
        map.set(l.fileId, list);
      }
      return map;
    });

    const urlByFile = new Map<string, string | null>();
    for (const row of rows) {
      if (urlByFile.has(row.fileId)) continue;
      urlByFile.set(
        row.fileId,
        await this.signOne(viewer, row, entityType, linksByFile.get(row.fileId) ?? []),
      );
    }

    for (const row of rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const list = out.get(row.entityId) ?? [];
      list.push({
        fileId: row.fileId,
        kind: kindOf(row.mimeType),
        fileName: row.originalName,
        sizeBytes: row.fileSizeBytes,
        url: urlByFile.get(row.fileId) ?? null,
      });
      out.set(row.entityId, list);
    }
    return out;
  }

  /** `null` = không ký được (mọi lý do). KHÔNG ném — fail-soft CÓ LOG, khuôn CHAT. */
  private async signOne(
    viewer: SocialViewerContext,
    row: { fileId: string; storagePath: string },
    entityType: string,
    links: readonly { moduleCode: string; entityType: string; entityId: string }[],
  ): Promise<string | null> {
    try {
      // 0 link = tệp đã rời mọi entity ⇒ KHÔNG ký (chặn sớm, rẻ hơn, không phụ thuộc cờ caller truyền).
      if (links.length === 0) return null;
      const decision = await this.policy.decideForLinkedFile(
        {
          companyId: viewer.companyId,
          userId: viewer.actorUserId,
          fileId: row.fileId,
          moduleCode: SOCIAL_MODULE,
          entityType,
          entityId: links[0].entityId,
          action: FilePolicyAction.Download,
        },
        links,
        FilePolicyAction.Download,
        // `everLinked` chỉ dùng khi `links` RỖNG — đã chặn ở trên. `true` để nếu ai gỡ đai kia thì
        // hành vi rơi về FAIL-CLOSED (`deny-links-revoked`) chứ không mở fallback FOUNDATION.FILE.*.
        true,
      );
      if (!decision.allow) {
        // `deny-no-resolver`/`deny-error` = resolver rơi khỏi đăng ký ⇒ tính năng chết trong im lặng,
        // phải kêu to. `deny-resolver` là từ chối THƯỜNG GẶP (không thấy được bài) — không log ồn.
        if (decision.reason === "deny-no-resolver" || decision.reason === "deny-error") {
          this.logger.error(
            `social attachment presign denied: reason=${decision.reason} file=${row.fileId} — ` +
              `resolver SOCIAL/${entityType} còn đăng ký không?`,
          );
        }
        return null;
      }
      const signed = await this.storage.get({
        key: row.storagePath,
        companyId: viewer.companyId,
      });
      return signed.url;
    } catch (err) {
      // Degrade CÓ LOG (không nuốt im lặng): storage lỗi/cấu hình thiếu ⇒ tệp hiện "không tải được",
      // dòng cuộn vẫn trả. Kèm lý do để một BUG THẬT không lẩn sau fail-soft.
      this.logger.warn(
        `social attachment presign failed: file=${row.fileId} — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return null;
    }
  }
}

interface FileRow {
  id: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  uploadStatus: string;
  scanStatus: string;
  ownerUserId: string | null;
}

/**
 * Phân loại đính kèm từ `mime_type` — **suy ở SERVER**, client không gửi lên.
 *
 * Client gửi `kind` nghĩa là client quyết định giới hạn nào áp cho tệp của mình: khai một video là
 * `image` để lách trần «1 video/bài».
 */
export function kindOf(mimeType: string): FeedAttachmentKindDto {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}
