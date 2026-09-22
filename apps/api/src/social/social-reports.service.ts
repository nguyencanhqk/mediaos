import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateFeedReportDto,
  DataScope,
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
import { SOCIAL_EVENT_POST_REPORTED, type SocialPostReportedPayload } from "./social-noti.payload";
import { SocialReportsRepository, type ReportRow } from "./social-reports.repository";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR, isUniqueViolationOf } from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-1B — `SOCIAL-API-027..029` (báo cáo vi phạm).
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
          throw new ConflictException(SOCIAL_ERR.REPORT_DUPLICATE_OPEN);
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
   * `SOCIAL-API-029` — `PATCH /social/reports/{id}`.
   *
   * 404 TRƯỚC 409: báo cáo không đọc được (không tồn tại · tenant khác · ngoài phạm vi) trả 404 một
   * chuỗi duy nhất; CHỈ khi actor vốn đã đọc được nó mà nó đã kết thúc mới trả 409 — 409 lúc đó không
   * rò gì vì actor đã biết báo cáo tồn tại.
   */
  async resolve(
    user: SocialRequestUser,
    reportId: string,
    dto: ResolveFeedReportDto,
  ): Promise<FeedReportDto> {
    const actor = await this.access.resolveActor(user, "reportResolve");

    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findReport(tx, actor, reportId);
      if (!before) throw new NotFoundException(SOCIAL_ERR.REPORT_NOT_FOUND);

      const won = await this.repo.resolveReport(tx, actor.companyId, reportId, {
        status: dto.status,
        resolutionNote: dto.resolutionNote ?? null,
        actorUserId: actor.actorUserId,
      });
      // 0 hàng ⇒ ai đó vừa xử lý trước (hoặc nó đã kết thúc từ trước). Kiểm bằng CHÍNH câu ghi, không
      // bằng `before.status`: hai lượt xử lý đồng thời thì chỉ một lượt thắng.
      if (!won) throw new ConflictException(SOCIAL_ERR.REPORT_ALREADY_DECIDED);

      await this.audit.record(tx, {
        action: `social.report.${dto.status}`,
        objectType: "feed_report",
        objectId: reportId,
        actorUserId: actor.actorUserId,
        moduleCode: "SOCIAL",
        entityType: "feed_report",
        entityId: reportId,
        resultStatus: "Success",
        // KHÔNG nội dung bài, KHÔNG ghi chú xử lý (chữ tự do) — API-19 §8 chốt payload audit chỉ mang
        // id + trường đổi.
        metadata: {
          reportId,
          targetType: before.targetType,
          targetId: before.targetId,
          from: before.status,
          to: dto.status,
        },
      });

      const after = await this.repo.findReport(tx, actor, reportId);
      // Không thể trượt: vị từ phạm vi không đổi trong cùng tx. Ném rõ ràng thay vì `!` rồi nổ chỗ khác.
      if (!after) throw new NotFoundException(SOCIAL_ERR.REPORT_NOT_FOUND);
      // `029` có `companyFloor:true` ⇒ tới được đây thì `routeScope` đã là Company. Vẫn hỏi
      // `isCompany` chứ KHÔNG viết thẳng `true`: nếu sàn ở `social-route-pairs` bị hạ, chỗ này đi
      // theo thay vì ở lại thành lỗ lộ im lặng.
      return toReportDto(after, SocialAccessService.isCompany(actor.routeScope));
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
