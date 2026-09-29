import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type {
  CreateFeedReportDto,
  DataScope,
  FeedReportActionDto,
  FeedReportDto,
  FeedReportPageDto,
  FeedReportPersonDto,
  FeedReportReasonDto,
  ListFeedReportsQueryDto,
  ResolveFeedReportDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { DataScopeService } from "../permission/data-scope.service";
import { SocialAccessService } from "./social-access.service";
import { SocialCommentsService } from "./social-comments.service";
import { SocialPostsModerationService } from "./social-posts-moderation.service";
import { SocialPostsService } from "./social-posts.service";
import { canPerformReportAction, isReportActionValidForTarget } from "./social-report-actions";
import { SOCIAL_EVENT_POST_REPORTED, type SocialPostReportedPayload } from "./social-noti.payload";
import { SocialReportsRepository, type ReportRow } from "./social-reports.repository";
import {
  SOCIAL_CONSTRAINT,
  SOCIAL_ERR,
  isUniqueViolationOf,
  socialPgErrorOf,
  socialError,
} from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/**
 * Trần CHỜ KHOÁ của `029` (D8) — khuôn #537/BE-2B-1. Có NGƯỜI đang chờ phản hồi HTTP; hết trần ⇒
 * 409 `REPORT_BUSY` thay vì treo.
 */
const REPORT_RESOLVE_LOCK_TIMEOUT = "5s";

/** `lock_not_available` — Postgres bắn khi `lock_timeout` hết mà chưa lấy được khoá. */
const PG_LOCK_NOT_AVAILABLE = "55P03";

/**
 * S16-SOCIAL-BE-1B — `SOCIAL-API-027..029` (báo cáo vi phạm). BE-3A thêm hành động kèm ở `029`.
 *
 * 🔴 **CROWN-JEWEL.** Cụm rủi ro cao nhất của WO: IDOR đa hình trên `feed_reports.target_id`, phạm vi
 * Department ép trong SQL, và một bypass CÓ CHỦ Ý của cổng `visiblePostCondition` cho snapshot đích.
 *
 * Thứ tự bắt buộc của mọi đường ghi giữ NGUYÊN khuôn BE-1:
 *   1. `access.resolveActor(user, routeKey)` — tầng guard 2, TRƯỚC mọi side-effect;
 *   2. `withTenant` → `assertTargetVisible`/`findReport` → kiểm nghiệp vụ → GHI → audit + outbox
 *      **CÙNG tx**;
 *   3. SAU commit: không có gì (module báo cáo không ký URL, không phát WS — hàng đợi kiểm duyệt
 *      không có room realtime nào trong API-19 §7).
 */
@Injectable()
export class SocialReportsService {
  private readonly logger = new Logger(SocialReportsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialReportsRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    // S16-SOCIAL-BE-3A (D5) — hàm lõi tầng tx của ba route gốc. Không vòng DI: không service nào
    // trong ba cái này phụ thuộc ngược `SocialReportsService`.
    private readonly moderation: SocialPostsModerationService,
    private readonly posts: SocialPostsService,
    private readonly comments: SocialCommentsService,
  ) {}

  /**
   * `SOCIAL-API-027` — `POST /social/reports`.
   *
   * ⚠️ `assertTargetVisible` chạy TRƯỚC INSERT — cửa DUY NHẤT chống IDOR đa hình: `target_id` không
   * có FK (DB-17 §11 R1) nên một actor hợp lệ của CÙNG tenant có thể trỏ vào bài `hidden`, bài
   * `org_unit` của đơn vị khác, hoặc một UUID của tenant khác mà CHECK lẫn RLS đều cho qua.
   */
  async create(user: SocialRequestUser, dto: CreateFeedReportDto): Promise<{ id: string }> {
    const actor = await this.access.resolveActor(user, "reportCreate");

    // TRƯỚC tx ghi — xem docblock `resolveReportNotiCandidates`: mỗi lượt hỏi engine tự mở một
    // `withTenant` riêng, nên hỏi trong tx ghi là lồng transaction (treo pool, không báo lỗi).
    const notiCandidates = await this.resolveReportNotiCandidates(actor);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const target = await this.access.assertTargetVisible(tx, actor, dto.targetType, dto.targetId);

      let created: { id: string };
      try {
        created = await this.repo.createReport(tx, actor.companyId, {
          targetType: dto.targetType,
          targetId: dto.targetId,
          reporterUserId: actor.actorUserId,
          reason: dto.reason,
          note: dto.note ?? null,
        });
      } catch (err) {
        // D5 — khớp theo TÊN CONSTRAINT, KHÔNG theo mã `23505` trần: `feed_reports` còn
        // `feed_reports_company_id_id_uq` (ống nước FK composite) cũng ném `23505`, và nuốt mọi
        // `23505` thành "báo cáo trùng" là dịch SAI nguyên nhân rồi xoá lỗi thật khỏi log điều tra.
        if (isUniqueViolationOf(err, SOCIAL_CONSTRAINT.REPORT_OPEN_UQ)) {
          throw new ConflictException(socialError(SOCIAL_ERR.REPORT_DUPLICATE_OPEN));
        }
        throw err;
      }

      await this.enqueueReportedNoti(tx, actor, notiCandidates, {
        reportId: created.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        postId: target.postId,
        // Đơn vị của bài đích đến TỪ CHÍNH cửa `assertTargetVisible` mà actor vừa đi qua — KHÔNG
        // đọc lại hàng báo cáo bằng một scope dựng tay (D13-R).
        targetOrgUnitId: target.postOrgUnitId,
        reason: dto.reason,
      });

      return created;
    });
  }

  /** `SOCIAL-API-028` — `GET /social/reports` (hàng đợi kiểm duyệt, phạm vi D6 ép TRONG SQL). */
  async list(user: SocialRequestUser, query: ListFeedReportsQueryDto): Promise<FeedReportPageDto> {
    const actor = await this.access.resolveActor(user, "reportsList");

    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listReports(tx, actor, {
        status: query.status,
        page: query.page,
        limit: query.limit,
      }),
    );

    // D13-a — che danh tính người tố giác với mọi scope HẸP HƠN Company (manager @Department).
    const revealReporter = SocialAccessService.isCompany(actor.routeScope);

    return {
      data: rows.map((r) => toReportDto(r, revealReporter)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /**
   * `SOCIAL-API-029` — `PATCH /social/reports/{id}` — kết thúc báo cáo, KÈM hành động (BE-3A).
   *
   * 404 TRƯỚC 409: báo cáo không đọc được (không tồn tại · tenant khác · ngoài phạm vi) trả 404 một
   * chuỗi duy nhất; CHỈ khi actor vốn đã đọc được nó mà nó đã kết thúc mới trả 409 — 409 lúc đó không
   * rò gì vì actor đã biết báo cáo tồn tại.
   *
   * ┌─ THỨ TỰ D8 (một tx, `lock_timeout` LOCAL) — ĐỔI THỨ TỰ LÀ ĐỔI NGỮ NGHĨA ──────────────────────┐
   * │ 1. 404 báo cáo                                                                                 │
   * │ 2. 403 cặp của hành động (`SOCIAL_REPORT_ACTION_PAIRS`) — TRƯỚC khoá (gate)                  │
   * │ 3. KHOÁ thứ tự mọi báo cáo `open` cùng đích (`lockOpenReportsForTargetTx`)          │
   * │ 4. 422 ma trận hành động × loại đích                                                            │
   * │ 5. câu ghi có điều kiện ⇒ 409 `ERR-021`                                                         │
   * │ 6. đọc đích qua cổng THƯỜNG ⇒ 422 · 7. thực thi qua HÀM LÕI của route gốc ⇒ 422 nếu 0 hàng      │
   * │ 8. auto-resolve anh em (chỉ `delete_target`) · 9. audit                                         │
   * │ Mọi throw sau bước 5 = rollback CẢ trạng thái báo cáo lẫn audit (`withTenant` = một tx).        │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 Đích đọc qua `findPostVisible`/`findCommentVisible` — CỔNG THƯỜNG, **không** đường snapshot
   * bypass của hàng đợi (`findReport` đọc xuyên `visiblePostCondition` để HIỂN THỊ; dùng nó để
   * HÀNH ĐỘNG là cho người xử lý sửa nội dung mà họ không được thấy — nợ D14 nhóm riêng tư).
   */
  async resolve(
    user: SocialRequestUser,
    reportId: string,
    dto: ResolveFeedReportDto,
  ): Promise<FeedReportDto> {
    const actor = await this.access.resolveActor(user, "reportResolve");

    try {
      return await this.db.withTenant(actor.companyId, (tx) =>
        this.resolveTx(tx, actor, reportId, dto),
      );
    } catch (err) {
      // Hết `lock_timeout` ở BẤT KỲ câu nào trong tx (khoá báo cáo ở bước 2 hoặc khoá hàng đích ở
      // bước 7) ⇒ lỗi TẠM, thử lại được. Để nguyên `55P03` là 500 vô danh (lớp lỗi H-1 của BE-2B-1).
      if (socialPgErrorOf(err)?.code === PG_LOCK_NOT_AVAILABLE) {
        // Không im lặng (FULL gate silent-failure LOW-1): khoá hết hạn có thể nằm trên hàng BÀI/BÌNH
        // LUẬN (một thao tác dài khác), không chỉ trên hàng báo cáo — log để truy được ai đang giữ.
        this.logger.warn(
          `029: hết lock_timeout ${REPORT_RESOLVE_LOCK_TIMEOUT} khi xử lý báo cáo ${reportId} (action=${dto.action}) — trả 409 REPORT_BUSY.`,
        );
        throw new ConflictException(socialError(SOCIAL_ERR.REPORT_BUSY));
      }
      throw err;
    }
  }

  private async resolveTx(
    tx: TenantTx,
    actor: SocialActor,
    reportId: string,
    dto: ResolveFeedReportDto,
  ): Promise<FeedReportDto> {
    // `SET LOCAL` không nhận bind param; hằng literal của module. Role app có `lock_timeout = 0`
    // (đo ở BE-2B-1) ⇒ không đặt trần là TREO vô hạn sau một lượt đang giữ khoá.
    await tx.execute(sql.raw(`set local lock_timeout = '${REPORT_RESOLVE_LOCK_TIMEOUT}'`));

    const before = await this.repo.findReport(tx, actor, reportId);
    if (!before) throw new NotFoundException(socialError(SOCIAL_ERR.REPORT_NOT_FOUND));

    // 403 TRƯỚC bước khoá (FULL gate security LOW): phép kiểm chỉ cần `actor` + `dto.action`, nên
    // một lượt bị từ chối không có lý do gì để giữ khoá hàng báo cáo của người khác.
    if (!canPerformReportAction(actor, dto.action)) {
      throw new ForbiddenException(socialError(SOCIAL_ERR.REPORT_ACTION_DENIED));
    }

    const lockedIds = await this.repo.lockOpenReportsForTargetTx(
      tx,
      actor.companyId,
      before.targetType,
      before.targetId,
    );
    if (!isReportActionValidForTarget(before.targetType, dto.action)) {
      throw new UnprocessableEntityException(
        socialError(SOCIAL_ERR.REPORT_ACTION_INVALID_FOR_TARGET),
      );
    }

    const won = await this.repo.resolveReport(tx, actor.companyId, reportId, {
      status: dto.status,
      resolutionNote: dto.resolutionNote ?? null,
      actorUserId: actor.actorUserId,
    });
    // 0 hàng ⇒ ai đó vừa xử lý trước (hoặc nó đã kết thúc từ trước). Kiểm bằng CHÍNH câu ghi, không
    // bằng `before.status`: hai lượt xử lý đồng thời thì chỉ một lượt thắng.
    if (!won) throw new ConflictException(socialError(SOCIAL_ERR.REPORT_ALREADY_DECIDED));

    let siblings: string[] = [];
    let effect: ActionEffect = "none";
    if (dto.action !== "none") {
      effect = await this.executeActionTx(
        tx,
        actor,
        before.targetType,
        before.targetId,
        dto.action,
      );
      // D9 — CHỈ `delete_target`: đích biến mất ⇒ các báo cáo khác về nó không còn gì để xử lý.
      // `hide`/`lock` để nguyên — báo cáo khác có thể nói về điều khác.
      if (dto.action === "delete_target") {
        siblings = await this.repo.resolveSiblingsTx(tx, actor.companyId, {
          targetType: before.targetType,
          targetId: before.targetId,
          exceptReportId: reportId,
          actorUserId: actor.actorUserId,
          lockedIds,
        });
      }
    }

    // KHÔNG nội dung bài, KHÔNG ghi chú xử lý (chữ tự do) — API-19 §8 chốt payload audit chỉ mang
    // id + trường đổi. `action` có mặt kể cả `none` (D3: hành động kèm CHỈ sống trong audit).
    await this.recordReportAudit(tx, actor, reportId, dto.status, {
      reportId,
      targetType: before.targetType,
      targetId: before.targetId,
      from: before.status,
      to: dto.status,
      action: dto.action,
      // FULL gate silent-failure MEDIUM-1 — hành động có ĐỔI dữ liệu không. `noop` = đích đã ở trạng
      // thái đó (không có dòng audit trường đi kèm); không có cờ này thì sổ nói «đã ẩn» mà không có
      // hiệu ứng nào tương ứng.
      effect,
    });
    for (const siblingId of siblings) {
      await this.recordReportAudit(tx, actor, siblingId, "resolved", {
        reportId: siblingId,
        targetType: before.targetType,
        targetId: before.targetId,
        // `from` của TỪNG hàng — `resolveSiblingsTx` chỉ chạm hàng `open`, không mượn của báo cáo gốc.
        from: "open",
        to: "resolved",
        action: "delete_target",
        effect: "applied",
        via: reportId,
      });
    }

    const after = await this.repo.findReport(tx, actor, reportId);
    // Không thể trượt: vị từ phạm vi không đổi trong cùng tx. Ném rõ ràng thay vì `!` rồi nổ chỗ khác.
    if (!after) throw new NotFoundException(socialError(SOCIAL_ERR.REPORT_NOT_FOUND));
    // `029` có `companyFloor:true` ⇒ tới được đây thì `routeScope` đã là Company. Vẫn hỏi
    // `isCompany` chứ KHÔNG viết thẳng `true`: nếu sàn ở `social-route-pairs` bị hạ, chỗ này đi
    // theo thay vì ở lại thành lỗ lộ im lặng.
    return toReportDto(after, SocialAccessService.isCompany(actor.routeScope));
  }

  /**
   * D5/D6/D7 — thực thi hành động qua CHÍNH hàm lõi của route gốc (`006`/`005`/`017`), trên đích đọc
   * qua cổng THƯỜNG. Mọi «không làm được» (không thấy · đã xoá · lượt đua vừa xoá) ⇒ MỘT mã 422
   * `REPORT_ACTION_TARGET_UNAVAILABLE`; throw ⇒ rollback cả câu ghi báo cáo ở bước 5.
   *
   * Không `catch (NotFoundException)`: cổng dùng biến thể `find*` trả `null`, nên một 404 ném từ chỗ
   * khác KHÔNG bị dịch nhầm thành 422.
   */
  private async executeActionTx(
    tx: TenantTx,
    actor: SocialActor,
    targetType: "post" | "comment",
    targetId: string,
    action: Exclude<FeedReportActionDto, "none">,
  ): Promise<ActionEffect> {
    const unavailable = () =>
      new UnprocessableEntityException(socialError(SOCIAL_ERR.REPORT_ACTION_TARGET_UNAVAILABLE));

    if (targetType === "post") {
      const post = await this.access.findPostVisible(tx, actor, targetId);
      if (!post) throw unavailable();
      if (action === "delete_target") {
        if (!(await this.posts.removeTx(tx, actor, post))) throw unavailable();
        return "applied";
      }
      return toEffect(
        await this.moderation.moderateTx(
          tx,
          actor,
          post,
          action === "hide_post" ? { hidden: true } : { commentsLocked: true },
        ),
        unavailable,
      );
    }

    const comment = await this.access.findCommentVisible(tx, actor, targetId);
    if (!comment) throw unavailable();
    // Ma trận D2 đã loại `hide_post` cho bình luận ở bước 4 — nhánh còn lại là `lock_comments` (khoá
    // bình luận BÀI CHA) hoặc `delete_target` (xoá bình luận).
    if (action === "delete_target") {
      if (!(await this.comments.removeTx(tx, actor, comment))) throw unavailable();
      return "applied";
    }
    return toEffect(
      await this.moderation.moderateTx(tx, actor, comment.post, { commentsLocked: true }),
      unavailable,
    );
  }

  private async recordReportAudit(
    tx: TenantTx,
    actor: SocialActor,
    reportId: string,
    status: "resolved" | "dismissed",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      action: `social.report.${status}`,
      objectType: "feed_report",
      objectId: reportId,
      actorUserId: actor.actorUserId,
      moduleCode: "SOCIAL",
      entityType: "feed_report",
      entityId: reportId,
      resultStatus: "Success",
      metadata,
    });
  }

  /**
   * Giải tập ứng viên `NOTI-036` **TRƯỚC** khi mở tx ghi — và vì sao không thể để trong tx.
   *
   * ┌─ `resolveManyOrNull` TỰ MỞ `withTenant` ──────────────────────────────────────────────────────┐
   * │ `DataScopeService.resolveManyOrNull` → `PermissionService` → `permission.repository.ts:29/70` │
   * │ = `this.db.withTenant(...)`, tức **một connection MỚI + một transaction MỚI** mỗi lượt gọi.    │
   * │ Gọi nó K lần bên trong tx ghi (đang giữ khoá hàng `feed_reports` vừa INSERT + khoá idempotency)│
   * │ là `withTenant` lồng nhau trên PgBouncer transaction-mode: pool `max: 20` KHÔNG có             │
   * │ `connectionTimeoutMillis` (`db/index.ts:18`) ⇒ 20 request `POST /social/reports` đồng thời, mỗi│
   * │ cái giữ 1 connection và xin cái thứ 2, sẽ **khoá chết, không timeout, phải restart API**.      │
   * │ Tập này chỉ phụ thuộc `companyId` (KHÔNG phụ thuộc hàng vừa tạo), nên giải trước là đúng nghĩa;│
   * │ phần phụ thuộc bài đích (`targetOrgUnitId`) là phép lọc thuần JS, ở lại trong tx.              │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Vì sao hỏi engine từng ứng viên thay vì lọc bằng SQL: repository chỉ thu hẹp xuống "ai có bất kỳ
   * grant nào chạm cặp `manage:feed-report`" (kể cả wildcard `*:*`). Quyết định CUỐI — DENY-overrides,
   * `expires_at`, cờ sensitive, ảnh chụp catalog — thuộc `PermissionService`; viết lại nó bằng SQL là
   * dựng nguồn sự thật thứ hai cho phân quyền. Tập ứng viên nhỏ (HR + company-admin + manager).
   */
  private async resolveReportNotiCandidates(actor: SocialActor): Promise<ReportNotiCandidate[]> {
    const candidates = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.manageReportCandidates(tx, actor.companyId),
    );

    const resolved: ReportNotiCandidate[] = [];
    for (const c of candidates) {
      const [scope] = await this.dataScope.resolveManyOrNull(c.userId, actor.companyId, [
        { action: "manage", resourceType: "feed-report", isSensitive: false },
      ]);
      if (scope == null) continue;

      // Department: lấy ĐÚNG tầm-với mà `028` dùng (own ∪ headed), không phải cột `org_unit_id`.
      const reach =
        scope === "Department"
          ? this.dataScope.departmentOrgUnitIds(
              await this.dataScope.resolveContext(c.userId, actor.companyId),
            )
          : [];
      resolved.push({ userId: c.userId, scope, reach });
    }

    if (resolved.length !== candidates.length) {
      // `resolveManyOrNull` trả `null` cho CẢ "không có quyền" LẪN "engine lỗi hạ tầng"
      // (`permission.service.ts` bắt mọi lỗi → `map(() => null)`, fail-closed đúng cho đường gác
      // cửa). Ở đây `null` nghĩa "bỏ người này khỏi danh sách báo" ⇒ mất người nhận MỘT PHẦN là im
      // lặng nếu không đếm: nhánh WARN bên dưới chỉ nổ khi tập RỖNG HOÀN TOÀN.
      this.logger.log(
        `NOTI-036: ${resolved.length}/${candidates.length} ứng viên có manage:feed-report hiệu lực.`,
      );
    }
    return resolved;
  }

  /**
   * `NOTI-036` — outbox ghi TRONG CÙNG tx với hàng báo cáo (C8); tập người nhận đã giải sẵn ở
   * `resolveReportNotiCandidates`, ở đây chỉ còn phép lọc theo bài đích bằng CÙNG định nghĩa phạm vi
   * mà `028` dùng (H4-iii/D6).
   *
   * ┌─ VÌ SAO HỎI ENGINE TỪNG ỨNG VIÊN, KHÔNG LỌC BẰNG SQL ─────────────────────────────────────────┐
   * │ Repository chỉ thu hẹp xuống "ai có bất kỳ grant nào chạm cặp `manage:feed-report`" (kể cả     │
   * │ wildcard `*:*`). Quyết định CUỐI — DENY-overrides, `expires_at`, cờ sensitive, ảnh chụp catalog │
   * │ — thuộc `PermissionService`; viết lại nó bằng SQL là dựng nguồn sự thật thứ hai cho phân quyền. │
   * │ Tập ứng viên nhỏ (HR + company-admin + manager), nên N lượt hỏi engine là chấp nhận được.      │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Người TỰ báo cáo cũng có thể nằm trong tập này (một manager báo cáo bài trong đơn vị mình) — giữ
   * nguyên, KHÔNG loại: hàng đợi là việc của cả nhóm xử lý, và loại người báo cáo ra sẽ làm một
   * manager đơn độc không bao giờ được nhắc về chính báo cáo họ vừa gửi.
   */
  private async enqueueReportedNoti(
    tx: TenantTx,
    actor: SocialActor,
    resolved: readonly ReportNotiCandidate[],
    ev: {
      reportId: string;
      targetType: "post" | "comment";
      targetId: string;
      postId: string;
      targetOrgUnitId: string | null;
      reason: FeedReportReasonDto;
    },
  ): Promise<void> {
    const targetOrgUnitId = ev.targetOrgUnitId;
    const recipients: string[] = [];
    for (const c of resolved) {
      if (SocialAccessService.isCompany(c.scope)) {
        recipients.push(c.userId);
        continue;
      }
      // H4-iii — Department CHỈ nhận khi bài đích thuộc ĐÚNG tầm-với của họ. `targetOrgUnitId ===
      // null` (bài toàn công ty) ⇒ không ai ở Department nhận, khớp D6: loại đó do Company xử lý.
      //
      // ⟲ **TẦM-VỚI = `own ∪ headed`, KHÔNG phải `employee_profiles.org_unit_id` đơn lẻ** (gate
      // 22/09). Route `028` lọc bằng `departmentOrgUnitIds(ctx)` = đơn vị của mình ∪ MỌI đơn vị mình
      // ĐỨNG ĐẦU (`data-scope.service.ts:161-166`). So bằng một cột `org_unit_id` là một bản luật
      // thứ hai, HẸP HƠN: trưởng phòng Marketing mà hồ sơ nằm ở «Ban giám đốc» ĐỌC ĐƯỢC báo cáo của
      // Marketing ở `028` nhưng KHÔNG được nhắc — đúng cái mà docblock `social-noti.payload.ts` tuyên
      // bố là không thể xảy ra («hai đường nói CÙNG một câu»).
      if (
        c.scope === "Department" &&
        targetOrgUnitId != null &&
        c.reach.includes(targetOrgUnitId)
      ) {
        recipients.push(c.userId);
      }
      // `Team`/`Own`: SPEC-16 không định nghĩa cặp này ở hai phạm vi đó ⇒ không nhận (cùng kết luận
      // với `scopeCondition` của `028`).
    }

    if (recipients.length === 0) {
      // KHÔNG im lặng: tập rỗng nghĩa là một báo cáo vừa vào hàng đợi mà KHÔNG AI được báo. Đó là một
      // sự cố cấu hình quyền, không phải trạng thái bình thường — và nó là đúng hình dạng "thành công
      // RỖNG" mà không log thì không ai biết.
      this.logger.warn(
        `NOTI-036: báo cáo ${ev.reportId} không có người nhận nào có manage:feed-report trong phạm vi — hàng đợi sẽ không được ai nhắc.`,
      );
      return;
    }

    const payload: SocialPostReportedPayload = {
      actorUserId: actor.actorUserId,
      postId: ev.postId,
      post_id: ev.postId,
      reportId: ev.reportId,
      report_id: ev.reportId,
      targetType: ev.targetType,
      targetId: ev.targetId,
      target_type_label: TARGET_TYPE_LABEL[ev.targetType],
      reason_label: REPORT_REASON_LABEL[ev.reason],
      recipientUserIds: recipients,
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_POST_REPORTED, payload });
  }
}

/**
 * Hiệu ứng thật của hành động kèm, ghi vào metadata audit `social.report.*` (`effect`):
 * `none` (không hành động) · `applied` (đã đổi dữ liệu) · `noop` (đích đã ở trạng thái đó).
 */
type ActionEffect = "none" | "applied" | "noop";

function toEffect(
  outcome: "ok" | "noop" | "gone",
  unavailable: () => UnprocessableEntityException,
): ActionEffect {
  if (outcome === "gone") throw unavailable();
  return outcome === "ok" ? "applied" : "noop";
}

/**
 * Bảng nhãn ĐÓNG cho biến template `{target_type_label}` (`0581`). `Record` trên union ⇒ thêm một
 * loại đích mà quên nhãn là ĐỎ lúc BIÊN DỊCH, không phải một `{target_type_label}` nguyên văn trong
 * tiêu đề thông báo lúc chạy.
 */
const TARGET_TYPE_LABEL: Record<"post" | "comment", string> = {
  post: "bài viết",
  comment: "bình luận",
};

/** Bảng nhãn ĐÓNG cho `{reason_label}` — mirror CHECK `chk_feed_reports_reason` (`0577`). */
const REPORT_REASON_LABEL: Record<FeedReportReasonDto, string> = {
  spam: "Spam",
  harassment: "Quấy rối",
  inappropriate: "Nội dung không phù hợp",
  misinformation: "Thông tin sai lệch",
  other: "Khác",
};

function person(
  employeeId: string | null,
  fullName: string | null,
  avatarUrl: string | null,
): FeedReportPersonDto {
  return { employeeId, fullName, avatarUrl };
}

/**
 * Hàng → DTO. Tập khoá ĐÓNG (`feedReportSchema`) — ca `H5-keys` assert bằng `toEqual` trên
 * `Object.keys`, nên mọi khoá phải LUÔN có mặt (nullable), không `.optional()`.
 *
 * `targetSnapshot` là `null` khi và chỉ khi đích không còn hàng nào (bài bị xoá CỨNG). Bài đã xoá
 * MỀM vẫn trả snapshot đầy đủ kèm `deletedAt` — đó chính là mục đích của bypass D13/H4-ii.
 *
 * 🔴 **`revealReporter` KHÔNG có giá trị mặc định — cố ý.** D13-a (owner ký 22/09/2026): danh tính
 * người tố giác CHỈ lộ cho người đọc ở scope `Company`. Bắt truyền TƯỜNG MINH để một call-site
 * MỚI phải TỰ QUYẾT — mặc định `true` thì quên là lộ lại mà typecheck vẫn xanh (fail-OPEN im lặng).
 * Nguồn luật DUY NHẤT là `SocialAccessService.isCompany(actor.routeScope)`, KHÔNG `scope !== null`.
 */
function toReportDto(r: ReportRow, revealReporter: boolean): FeedReportDto {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    targetSnapshot:
      r.targetPostId == null
        ? null
        : {
            postId: r.targetPostId,
            authorEmployeeId: r.targetAuthorEmployeeId,
            authorFullName: r.targetAuthorFullName,
            avatarUrl: r.targetAuthorAvatarUrl,
            bodyExcerpt: r.targetBodyExcerpt,
            // `targetPostId != null` ⇒ hàng bài CÓ tồn tại ⇒ `status` là một trong ba giá trị CHECK
            // `chk_feed_posts_status`. `?? "deleted"` là lưới cho nhánh không thể xảy ra (cột NOT
            // NULL) — chọn giá trị HẸP NHẤT để một bất thường không biến thành "published".
            status: (r.targetStatus ?? "deleted") as "published" | "hidden" | "deleted",
            deletedAt: r.targetDeletedAt ? r.targetDeletedAt.toISOString() : null,
          },
    reporter: revealReporter
      ? person(r.reporterEmployeeId, r.reporterFullName, r.reporterAvatarUrl)
      : null,
    reason: r.reason as FeedReportReasonDto,
    note: r.note,
    status: r.status,
    resolvedBy:
      r.resolverEmployeeId == null && r.resolverFullName == null
        ? null
        : person(r.resolverEmployeeId, r.resolverFullName, r.resolverAvatarUrl),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Ứng viên nhận `NOTI-036` đã giải phạm vi. `reach` = tầm-với Department (`own ∪ headed`) — CHỈ có
 * nghĩa khi `scope === "Department"`; rỗng ở mọi scope khác.
 */
interface ReportNotiCandidate {
  userId: string;
  scope: DataScope;
  reach: readonly string[];
}
