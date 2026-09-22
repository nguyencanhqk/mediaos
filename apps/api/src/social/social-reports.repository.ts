import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { permissions, rolePermissions, userRoles } from "../db/schema/permissions";
import { feedComments, feedPosts, feedReports } from "../db/schema/social";
import { users } from "../db/schema/users";
import { FEED_REPORT_EXCERPT_MAX } from "@mediaos/contracts";
import type { SocialActor } from "./social.types";

/**
 * S16-SOCIAL-BE-1B — truy vấn `feed_reports` (`SOCIAL-API-027..029`). Tập cột TƯỜNG MINH, cấm
 * `select()` trần (DB-17 §11 R6).
 *
 * 🔴 **CROWN-JEWEL.** Hai thứ nguy hiểm sống ở đúng file này:
 *   1. **Vị từ phạm vi Department (D6)** — `028` là route DUY NHẤT của SOCIAL có `companyFloor:false`,
 *      nên `resolveActor` KHÔNG còn chặn scope hẹp giúp nữa.
 *   2. **Snapshot đích đọc XUYÊN `visiblePostCondition` (D13 / H4-ii)** — bypass CÓ CHỦ Ý của cổng
 *      visibility; xem docblock `feedReportTargetSnapshotSchema` ở contracts.
 *
 * ┌─ D13-R — RÀNG BUỘC HÌNH DẠNG CỦA SNAPSHOT, KHÔNG PHẢI GỢI Ý ───────────────────────────────────┐
 * │ **KHÔNG tồn tại hàm public nhận `(targetType, targetId)` rời trong file này.** Snapshot là một   │
 * │ JOIN nằm TRONG CHÍNH câu `listReports`/`findReport` — câu đã lọc `company_id` + vị từ D6 — và    │
 * │ `target_id` lấy từ CHÍNH hàng `feed_reports` vừa qua vị từ đó, KHÔNG BAO GIỜ từ tham số caller.  │
 * │ Một helper nhận id rời chỉ cần THÊM MỘT call-site nữa là biến thành «đọc bất kỳ bài nào trong   │
 * │ tenant, xuyên mọi vị từ» — lớp lỗi `reused-method-must-be-actor-scoped`. Ca: `N-D13-c/d/e`.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

// ═══ Alias — `users`/`employee_profiles` xuất hiện BA vai trong cùng câu (người báo cáo · tác giả
// bài đích · người xử lý). Khai ở cấp module: chúng chỉ là tên buộc vào bảng, không mang trạng thái.
//
// ⚠️ `alias()` của `drizzle-orm/pg-core`, KHÔNG `aliasedTable()` của `drizzle-orm` (hai tên cho cùng
// một việc). Census điểm chiếu danh tính (`identity-projection-census.ts#boundIdentifiers`) nhận diện
// alias bằng TÊN HÀM; bản đầu của file này dùng `aliasedTable` và census MÙ với cả ba điểm chiếu
// `users.fullName` ở đây — ratchet xanh trong khi ba đường chiếu tên người mở ra không ai ký. Census
// đã được nới để nhận CẢ HAI tên (cùng WO), nhưng file này giữ `alias` cho khớp 7 call-site còn lại.
const rPost = alias(feedPosts, "rp");
const rComment = alias(feedComments, "rc");
const rReporterUser = alias(users, "rru");
const rReporterEmp = alias(employeeProfiles, "rre");
const rAuthorUser = alias(users, "rau");
const rAuthorEmp = alias(employeeProfiles, "rae");
const rResolverUser = alias(users, "rsu");
const rResolverEmp = alias(employeeProfiles, "rse");

/**
 * Điều kiện JOIN của đích ĐA HÌNH — bài đích là chính nó (`target_type='post'`) hoặc bài CHA của
 * bình luận (`'comment'`). Cả snapshot LẪN vị từ Department (D6) bám vào bài này.
 *
 * 🔴 **CỐ Ý KHÔNG mang `visiblePostCondition`** (D13/H4-ii) — hàng đợi kiểm duyệt phải đọc được cả
 * bài `hidden`/đã xoá mềm. Vẫn ghim `company_id` ở MỌI vế: vế tenant là hàng rào còn lại DUY NHẤT
 * trên đường này, bỏ nó là rò xuyên tenant chứ không chỉ xuyên visibility.
 */
const TARGET_POST_ON = and(
  eq(rPost.companyId, feedReports.companyId),
  sql`${rPost.id} = CASE WHEN ${feedReports.targetType} = 'post'
                         THEN ${feedReports.targetId} ELSE ${rComment.postId} END`,
);

const TARGET_COMMENT_ON = and(
  eq(feedReports.targetType, "comment"),
  eq(rComment.id, feedReports.targetId),
  eq(rComment.companyId, feedReports.companyId),
);

/** Tập cột của một hàng báo cáo. TƯỜNG MINH — thêm cột ở đây là một quyết định, không phải tiện tay. */
const REPORT_COLUMNS = {
  id: feedReports.id,
  targetType: feedReports.targetType,
  targetId: feedReports.targetId,
  reason: feedReports.reason,
  note: feedReports.note,
  status: feedReports.status,
  resolvedAt: feedReports.resolvedAt,
  resolutionNote: feedReports.resolutionNote,
  createdAt: feedReports.createdAt,
  updatedAt: feedReports.updatedAt,
  reporterEmployeeId: rReporterEmp.id,
  reporterFullName: rReporterUser.fullName,
  reporterAvatarUrl: rReporterEmp.avatarUrl,
  resolverEmployeeId: rResolverEmp.id,
  resolverFullName: rResolverUser.fullName,
  resolverAvatarUrl: rResolverEmp.avatarUrl,
  targetPostId: rPost.id,
  targetOrgUnitId: rPost.orgUnitId,
  targetAuthorEmployeeId: rAuthorEmp.id,
  targetAuthorFullName: rAuthorUser.fullName,
  targetAuthorAvatarUrl: rAuthorEmp.avatarUrl,
  targetStatus: rPost.status,
  targetDeletedAt: rPost.deletedAt,
  /**
   * Nội dung của CHÍNH đối tượng bị báo cáo (`body` bình luận khi đích là bình luận, `body` bài khi
   * đích là bài). Cắt Ở SQL bằng `left()`, KHÔNG ở JS (`clamp-must-be-sql-not-js`): kéo cả bài 20 000
   * ký tự về rồi cắt là chở nguyên nội dung qua dây để lấy một trích đoạn 200 ký tự.
   */
  targetBodyExcerpt: sql<string | null>`left(
    CASE WHEN ${feedReports.targetType} = 'comment' THEN ${rComment.body} ELSE ${rPost.body} END,
    ${FEED_REPORT_EXCERPT_MAX}
  )`,
} as const;

export interface ReportRow {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  reporterEmployeeId: string | null;
  reporterFullName: string | null;
  reporterAvatarUrl: string | null;
  resolverEmployeeId: string | null;
  resolverFullName: string | null;
  resolverAvatarUrl: string | null;
  /** `null` ⇔ đích không còn hàng nào (bài bị xoá CỨNG) ⇒ DTO trả `targetSnapshot: null`. */
  targetPostId: string | null;
  targetOrgUnitId: string | null;
  targetAuthorEmployeeId: string | null;
  targetAuthorFullName: string | null;
  targetAuthorAvatarUrl: string | null;
  targetStatus: string | null;
  targetDeletedAt: Date | null;
  targetBodyExcerpt: string | null;
}

/** Ứng viên nhận `NOTI-036` — CHƯA lọc quyền thật, xem `manageReportCandidates`. */
export interface ReportRecipientCandidate {
  userId: string;
  /** Đơn vị của chính ứng viên — vế Department của H4-iii so nó với đơn vị của BÀI đích. */
  orgUnitId: string | null;
}

@Injectable()
export class SocialReportsRepository {
  /**
   * 🔴 **VỊ TỪ PHẠM VI (D6/M9/H3) — `switch` VÉT CẠN, KHÔNG `if/else`.**
   *
   * ┌─ VÌ SAO `companyFloor:false` KHÔNG TỰ CHẶN `Own`/`Team` ──────────────────────────────────────┐
   * │ `companyFloor` chỉ chặn scope HẸP HƠN Company khi cờ BẬT. Route `028` phải TẮT nó để            │
   * │ `Department` lọt qua (seed `0578` có đúng hàng `['manager','view','feed-report','Department']`) │
   * │ — và tắt rồi thì nó mở cho MỌI scope mà `resolveManyOrNull` trả về, kể cả `Own`/`Team`, hai giá │
   * │ trị SPEC-16 §11.1 không hề định nghĩa cho cặp này. Viết                                         │
   * │ `if (scope === 'Department') … else <không lọc>` thì một grant `view:feed-report@Own` đọc được  │
   * │ TOÀN BỘ hàng đợi của công ty. Đó là fail-OPEN, và nó im lặng.                                   │
   * │                                                                                                 │
   * │ ⚠️ KHÔNG bắt chước nhánh mặc định của `AssetAccessService.buildReadScopeExists` (:81-104): ở đó │
   * │ `Own`/`Team` rơi vào «lọc theo chính actor» vì tài sản CÓ người giữ. Báo cáo thì không — «hàng  │
   * │ đợi kiểm duyệt của riêng tôi» không có nghĩa nào trong SPEC-16, nên câu trả lời đúng là KHÔNG   │
   * │ HÀNG NÀO, chứ không phải «hàng của tôi».                                                        │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * **D6 — phạm vi tính theo NỘI DUNG BỊ BÁO CÁO, không theo người báo cáo:** `org_unit_id` của bài
   * đích. Nhất quán với cách repo LUÔN gắn `data_scope` theo org_unit của HÀNG CHỦ THỂ
   * (`data-scope.service.ts:183-185` · `asset-access.service.ts:81-104`). Hệ quả CHỦ Ý: manager
   * Department **KHÔNG** thấy báo cáo về bài `audience='company'` (`org_unit_id IS NULL` ⇒ `IN (…)`
   * trên NULL không khớp) — loại đó do HR/company-admin (Company) xử lý.
   *
   * `Department` với tập đơn vị RỖNG ⇒ `false` (fail-closed, KHÔNG BAO GIỜ match-all).
   */
  scopeCondition(scope: DataScope, orgUnitIds: readonly string[]): SQL {
    switch (scope) {
      // N=1 single-tenant: `System` vẫn bị ghim ở CHÍNH tenant hiện tại bởi `eq(companyId)` của caller.
      case "System":
      case "Company":
        return sql`true`;
      case "Department":
        return orgUnitIds.length > 0
          ? (inArray(rPost.orgUnitId, [...orgUnitIds]) ?? sql`false`)
          : sql`false`;
      case "Team":
      case "Own":
        // Có grant, nhưng ở một phạm vi SPEC không định nghĩa cho cặp này ⇒ 0 hàng. KHÔNG ném: một
        // cấu hình quyền lạ không được biến thành 500 (ca `N-H3` assert đúng điều đó).
        return sql`false`;
      default:
        // Giá trị `DataScope` MỚI mà file này chưa biết ⇒ fail-closed. `switch` vét cạn ở trên làm
        // typecheck bắt được ca đó lúc BIÊN DỊCH; nhánh này là lưới lúc CHẠY.
        return sql`false`;
    }
  }
  /**
   * Câu đọc CHUNG của `028` và `029` — **MỘT bản, không hai**.
   *
   * Cả hai đường phải mang CÙNG bộ JOIN và CÙNG vị từ phạm vi; viết lại chuỗi JOIN ở đường thứ hai là
   * cách chắc chắn nhất để một ngày nào đó `029` đọc rộng hơn `028` (hoặc ngược lại). `where` do
   * caller dựng, nhưng nó LUÔN được dựng từ `scopeCondition` + `eq(companyId)` ở hai method dưới —
   * không có đường nào khác vào đây (`private`).
   */
  private selectReports(tx: TenantTx, where: SQL | undefined) {
    return tx
      .select(REPORT_COLUMNS)
      .from(feedReports)
      .leftJoin(rComment, TARGET_COMMENT_ON)
      .leftJoin(rPost, TARGET_POST_ON)
      .leftJoin(
        rReporterUser,
        and(
          eq(rReporterUser.id, feedReports.reporterUserId),
          eq(rReporterUser.companyId, feedReports.companyId),
        ),
      )
      .leftJoin(
        rReporterEmp,
        and(
          eq(rReporterEmp.userId, feedReports.reporterUserId),
          eq(rReporterEmp.companyId, feedReports.companyId),
          isNull(rReporterEmp.deletedAt),
        ),
      )
      .leftJoin(
        rAuthorUser,
        and(eq(rAuthorUser.id, rPost.authorUserId), eq(rAuthorUser.companyId, rPost.companyId)),
      )
      .leftJoin(
        rAuthorEmp,
        and(
          eq(rAuthorEmp.id, rPost.authorEmployeeId),
          eq(rAuthorEmp.companyId, rPost.companyId),
          isNull(rAuthorEmp.deletedAt),
        ),
      )
      .leftJoin(
        rResolverUser,
        and(
          eq(rResolverUser.id, feedReports.resolvedBy),
          eq(rResolverUser.companyId, feedReports.companyId),
        ),
      )
      .leftJoin(
        rResolverEmp,
        and(
          eq(rResolverEmp.userId, feedReports.resolvedBy),
          eq(rResolverEmp.companyId, feedReports.companyId),
          isNull(rResolverEmp.deletedAt),
        ),
      )
      .where(where);
  }

  /**
   * `SOCIAL-API-028` — một trang hàng đợi (OFFSET) + `total`.
   *
   * ⚠️ `total` đếm bằng CHÍNH tập vị từ của trang (cùng `where`), KHÔNG phải `COUNT(*)` toàn bảng:
   * một tổng rộng hơn tập hiển thị là nói với manager rằng có báo cáo họ không mở được.
   */
  async listReports(
    tx: TenantTx,
    actor: SocialActor,
    opts: { status?: string; page: number; limit: number },
  ): Promise<{ rows: ReportRow[]; total: number }> {
    const where = and(
      eq(feedReports.companyId, actor.companyId),
      this.scopeCondition(actor.routeScope, actor.orgUnitIds),
      ...(opts.status ? [eq(feedReports.status, opts.status as never)] : []),
    );

    // Câu đếm mang ĐÚNG hai JOIN mà vị từ D6 cần (`rComment` → `rPost`), không hơn: các JOIN danh
    // tính chỉ phục vụ projection và không đổi số hàng.
    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedReports)
      .leftJoin(rComment, TARGET_COMMENT_ON)
      .leftJoin(rPost, TARGET_POST_ON)
      .where(where);

    const rows = await this.selectReports(tx, where)
      // Thứ tự ỔN ĐỊNH `created_at DESC, id DESC`. Thiếu vế `id` thì hai báo cáo cùng mốc đổi chỗ được
      // giữa hai lần lật trang OFFSET ⇒ một hàng hiện hai lần, một hàng biến mất.
      .orderBy(desc(feedReports.createdAt), desc(feedReports.id))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    return { rows: rows as ReportRow[], total: Number(totalRow?.n ?? 0) };
  }

  /**
   * Một báo cáo theo id, ĐÃ qua CÙNG vị từ phạm vi của `listReports` (cùng `selectReports`).
   *
   * @returns `null` cho MỌI lý do không đọc được (không tồn tại · tenant khác · ngoài Department) ⇒
   *   caller trả 404 `SOCIAL_ERR.REPORT_NOT_FOUND`, MỘT chuỗi duy nhất, không oracle.
   */
  async findReport(tx: TenantTx, actor: SocialActor, reportId: string): Promise<ReportRow | null> {
    const rows = await this.selectReports(
      tx,
      and(
        eq(feedReports.id, reportId),
        eq(feedReports.companyId, actor.companyId),
        this.scopeCondition(actor.routeScope, actor.orgUnitIds),
      ),
    ).limit(1);
    return (rows[0] as ReportRow | undefined) ?? null;
  }

  /**
   * `SOCIAL-API-027` — tạo báo cáo.
   *
   * ⚠️ Người gọi PHẢI chạy `SocialAccessService.assertTargetVisible` TRƯỚC (cửa chống IDOR đa hình:
   * `feed_reports.target_id` KHÔNG có FK — DB-17 §11 R1 — nên DB không đỡ gì cả).
   *
   * Ném NGUYÊN lỗi driver khi trùng: dịch sang mã nghiệp vụ là việc của service qua
   * `isUniqueViolationOf(err, SOCIAL_CONSTRAINT.REPORT_OPEN_UQ)` — khớp theo TÊN CONSTRAINT, không
   * theo mã `23505` trần (bảng còn `feed_reports_company_id_id_uq` cùng mã).
   */
  async createReport(
    tx: TenantTx,
    companyId: string,
    input: {
      targetType: "post" | "comment";
      targetId: string;
      reporterUserId: string;
      reason: string;
      note: string | null;
    },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(feedReports)
      .values({
        companyId,
        targetType: input.targetType,
        targetId: input.targetId,
        reporterUserId: input.reporterUserId,
        reason: input.reason as never,
        note: input.note,
        // `status` CỐ Ý không truyền — DEFAULT `'open'` của DB là nguồn sự thật, và DTO ghi
        // (`createFeedReportSchema.strict()`) không mang nó.
      })
      .returning({ id: feedReports.id });
    if (!row) throw new Error("SocialReportsRepository.createReport: INSERT không trả hàng nào");
    return row;
  }

  /**
   * `SOCIAL-API-029` — kết thúc một báo cáo.
   *
   * 🔴 **MỘT câu UPDATE đặt ĐỒNG THỜI `status` + `resolved_by` + `resolved_at`** (+ ghi chú, mốc
   * sửa). Thiếu MỘT trong cặp `resolved_by`/`resolved_at` là vỡ CHECK `chk_feed_reports_resolved_pair`
   * (`db/schema/social.ts:465-468`) — và **KHÔNG được "sửa" bằng cách nới CHECK**: đó là thứ duy nhất
   * bảo đảm mọi báo cáo đã xử lý đều truy được ai xử lý và lúc nào.
   *
   * `WHERE status = 'open'` + `RETURNING`: 0 hàng ⇔ báo cáo đã kết thúc từ trước ⇒ caller trả 409
   * `SOCIAL-ERR-021`. Kiểm bằng CHÍNH câu ghi (không SELECT-rồi-UPDATE) nên hai lượt xử lý đồng thời
   * chỉ một lượt thắng — vế thua nhận 409 chứ không ghi đè quyết định của người kia.
   */
  async resolveReport(
    tx: TenantTx,
    companyId: string,
    reportId: string,
    input: { status: "resolved" | "dismissed"; resolutionNote: string | null; actorUserId: string },
  ): Promise<boolean> {
    const now = new Date();
    const updated = await tx
      .update(feedReports)
      .set({
        status: input.status,
        resolvedBy: input.actorUserId,
        resolvedAt: now,
        resolutionNote: input.resolutionNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(feedReports.id, reportId),
          eq(feedReports.companyId, companyId),
          eq(feedReports.status, "open"),
        ),
      )
      .returning({ id: feedReports.id });
    return updated.length > 0;
  }

  /**
   * ỨNG VIÊN nhận `NOTI-036` — **chưa phải câu trả lời cuối** (H4-iii).
   *
   * ┌─ VÌ SAO CHỈ LÀ ỨNG VIÊN, KHÔNG PHẢI TẬP NGƯỜI NHẬN ───────────────────────────────────────────┐
   * │ Quyết định "người này có `manage:feed-report` ở scope nào" thuộc về `PermissionService` —      │
   * │ bốn tầng ưu tiên, DENY-overrides, `expires_at`, cờ sensitive, ảnh chụp catalog                  │
   * │ (`permission.decide.ts`). Viết lại logic đó bằng SQL ở đây là dựng NGUỒN SỰ THẬT THỨ HAI cho     │
   * │ phân quyền — nó sẽ trôi khỏi engine ngay lần đầu engine đổi, và trôi về phía nào thì không ai   │
   * │ biết. Nên câu SQL này chỉ làm MỘT việc: thu hẹp từ "cả công ty" xuống "những người có bất kỳ    │
   * │ ALLOW nào chạm tới cặp đó", rồi service hỏi ENGINE từng người (tập nhỏ: HR + company-admin +    │
   * │ manager, không phải toàn bộ nhân viên).                                                         │
   * │                                                                                                 │
   * │ ⚠️ Vế wildcard `action='*'`/`resource_type='*'` PHẢI có trong câu này: 14 cặp `feed-*` đều      │
   * │ `is_sensitive=false` ⇒ `*:*` MỞ chúng (hành vi ENGINE, `permission.decide.ts` Priority 4). Bỏ   │
   * │ vế đó thì một người giữ `*:*` biến mất khỏi tập ứng viên và KHÔNG BAO GIỜ nhận thông báo, dù     │
   * │ engine cho họ mở hàng đợi — sai im lặng theo đúng chiều khó phát hiện nhất.                     │
   * │                                                                                                 │
   * │ ⚠️ KHÔNG lọc `effect='ALLOW'`-only ở đây để "tối ưu": một hàng DENY vẫn phải dẫn tới việc HỎI   │
   * │ engine (engine mới biết DENY thắng hay thua). Lọc DENY ở SQL là lại làm engine việc của nó.     │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `expires_at` lọc ở đây chỉ để thu hẹp; engine tự kiểm lại (`decideCan` re-check) — hai lớp cùng
   * chiều, không lớp nào nới lớp kia.
   */
  async manageReportCandidates(
    tx: TenantTx,
    companyId: string,
  ): Promise<ReportRecipientCandidate[]> {
    const rows = await tx
      .selectDistinct({ userId: userRoles.userId, orgUnitId: employeeProfiles.orgUnitId })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.userId, userRoles.userId),
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(userRoles.companyId, companyId),
          isNull(userRoles.deletedAt),
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > now())`,
          sql`${permissions.action} IN ('manage', '*')`,
          sql`${permissions.resourceType} IN ('feed-report', '*')`,
        ),
      )
      .orderBy(userRoles.userId);
    return rows as ReportRecipientCandidate[];
  }
}
