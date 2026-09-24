import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { feedComments, feedPosts } from "../db/schema/social";
import { DataScopeService } from "../permission/data-scope.service";
// ⚠️ `import type` — CHỈ kiểu, bị xoá lúc biên dịch. `SocialAttachmentsService` là lớp nặng (kéo
// theo FilePolicy + StorageAdapter); một import giá trị ở đây sẽ dựng vòng phụ thuộc runtime.
import type { AttachNewGate } from "./social-attachments.service";
import { SocialGroupAccessService } from "./social-group-access.service";
import { visibleGroupPostExists } from "./social-group-predicates";
import {
  ATTACH_GATE_ROUTE_TARGET,
  SOCIAL_FILE_TARGET_PAIRS,
  SOCIAL_KUDOS_FLAG_PAIRS,
  SOCIAL_POST_TYPE_PAIRS,
  SOCIAL_ROUTE_PAIRS,
  type SocialCreatablePostType,
  type SocialRouteKey,
} from "./social-route-pairs.const";
import {
  SOCIAL_ERR,
  SOCIAL_FILE_TARGET_DENIED,
  SOCIAL_POST_TYPE_DENIED,
  SOCIAL_POST_TYPE_PAIR_DESYNC,
} from "./social.errors";
import type {
  AttachNewGateSnapshot,
  SocialActor,
  SocialCommentAccess,
  SocialPostAccess,
  SocialRequestUser,
  SocialTargetAccess,
  SocialTargetType,
  SocialViewerContext,
} from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `SocialAccessService`: lớp phạm vi + **TẦNG GUARD THỨ HAI** của module SOCIAL
 * (SPEC-16 §11 · API-19 §8). Khuôn `RecruitAccessService`/`ChatAccessService`.
 *
 * 🔴 **CROWN-JEWEL.** Mọi quyết định "ai thấy được gì" của module đi qua đúng file này. Per-file
 * coverage threshold ở `vitest.config.ts` là cổng THẬT cho nó (plan §2 D11).
 *
 * ┌─ BỐN CỬA, KHÔNG CÓ CỬA THỨ NĂM ────────────────────────────────────────────────────────────────┐
 * │ 1. `resolveActor`        — tầng 2 của guard + 2 cờ quyền + tập org_unit. GỌI ĐÚNG MỘT LẦN đầu   │
 * │                            mỗi method service.                                                  │
 * │ 2. `visiblePostCondition` — vị từ SQL cho MỌI câu LIỆT KÊ. Audience + status lọc TRONG SQL       │
 * │                            (`done_when` #2), không bao giờ lọc bằng JS sau khi lấy về.          │
 * │ 3. `assertPostVisible` / `assertCommentVisible` — cửa của mọi đường ĐỌC/GHI theo `{id}`.         │
 * │ 4. `assertTargetVisible` — cửa ĐA HÌNH cho `feed_reactions`/`feed_mentions` (và `feed_reports`   │
 * │                            ở BE-1B). Xem khối ⚠️ IDOR bên dưới.                                 │
 * │ Cửa 2 và cửa 3 dùng CHUNG `visiblePostCondition` — một luật, một bản. Viết lại vị từ ở           │
 * │ repository là cách chắc chắn nhất để hai đường trôi khỏi nhau.                                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ⚠️ IDOR TRONG TENANT — NỢ (b) CỦA FULL GATE DB-1 ─────────────────────────────────────────────┐
 * │ `feed_reactions.target_id` và `feed_mentions.target_id` là khoá **ĐA HÌNH, KHÔNG FK** (DB-17    │
 * │ §11 R1 — Postgres không có FK đa hình). Nghĩa là DB **không đỡ gì cả**: một actor hợp lệ của    │
 * │ CÙNG tenant có thể INSERT một reaction trỏ vào `target_id` của bài `hidden`, bài `org_unit` của │
 * │ đơn vị khác, hoặc một UUID của tenant khác — tất cả đều qua được CHECK lẫn RLS (RLS chỉ gác     │
 * │ `company_id` của CHÍNH hàng reaction, không gác đích nó trỏ tới).                               │
 * │ ⇒ `assertTargetVisible` PHẢI chạy TRƯỚC MỌI `INSERT` vào hai bảng đó. Nó là hàm DUY NHẤT làm    │
 * │ việc này; review kiểm từng call-site.                                                           │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **404 TRƯỚC 403 ở nhánh ĐỌC** (SPEC-16 §12). Mọi lý do không-thấy-được trả CÙNG một chuỗi
 * `SOCIAL_ERR.POST_NOT_FOUND`. `SOCIAL-ERR-002` (403) CHỈ dùng ở nhánh GHI (`assertWriteAudience`),
 * nơi actor tự chọn đích nên đã biết nó tồn tại.
 */
/**
 * S16-SOCIAL-ATTDEBT-1 (F1) — chỉ số của phần tử thứ 5 trong batch của `resolveActor`.
 *
 * Hằng CÓ TÊN, không phải số 4 rải rác: mảng đó được đọc theo **chỉ số cứng** (luật của chính file
 * này — tra theo KHOÁ thì hai vai hỏi cùng một cặp sẽ đè nhau, và `Map.get()` trượt trả `undefined`
 * mà một cờ kiểm `!= null` coi là MỞ KHOÁ). Đặt tên cho chỉ số là cách duy nhất để lần sau ai thêm
 * phần tử thấy ngay thứ phải dịch.
 */
const ATTACH_IDX = 4;

@Injectable()
export class SocialAccessService {
  private readonly logger = new Logger(SocialAccessService.name);

  constructor(
    private readonly dataScope: DataScopeService,
    // Cổng quyền TRONG nhóm — chỉ nhận `tx`, không tự mở `withTenant` (xem docblock của nó).
    private readonly groups: SocialGroupAccessService,
  ) {}

  /**
   * Tầng 2 + ngữ cảnh. Gọi ĐÚNG MỘT LẦN đầu mỗi method service (khuôn `RecruitAccessService`).
   *
   * Ba câu hỏi scope đi CHUNG một lượt `resolveManyOrNull` (1 round-trip thay vì 3) và đọc kết quả
   * **THEO CHỈ SỐ, không theo khoá cặp**: `routeKey='postModerate'` hỏi ĐÚNG cặp `manage:feed-post`
   * mà cờ `canManagePosts` cũng hỏi — tra theo khoá thì hai vai đè nhau; và `Map.get()` trượt trả
   * `undefined`, mà một cờ kiểm `!= null` sẽ coi `undefined` là MỞ KHOÁ, typecheck không bắt
   * (nguyên văn bài học đã ghi ở `recruit-access.service.ts:36-44`). Hai cờ dưới đây đi qua
   * `isCompany()` nên `undefined` fail-closed — xem khối 🔴 ở chỗ gán.
   */
  async resolveActor(user: SocialRequestUser, routeKey: SocialRouteKey): Promise<SocialActor> {
    const p = SOCIAL_ROUTE_PAIRS[routeKey];
    const baseRequests = [
      // [0] cặp của route — cờ sensitive lấy từ BẢNG, không gõ lại literal.
      { action: p.action, resourceType: p.resourceType, isSensitive: p.isSensitive },
      // [1][2] hai cờ phụ — `isSensitive:false` TƯỜNG MINH (mirror catalog 0578). Khai tường minh
      // để lần sau ai đổi cờ catalog thì thấy ngay chỗ phải đổi theo.
      { action: "manage", resourceType: "feed-post", isSensitive: false },
      { action: "manage", resourceType: "feed-news", isSensitive: false },
      // [3] S16-SOCIAL-BE-2A (D9). CỐ Ý **không** thêm `create:feed-group` vào đây: nó đã là cặp
      // của route `031` ở [0], và hỏi hai lần cùng một cặp là đúng cái bẫy "hai vai đè nhau" ghi
      // ở docblock trên.
      { action: "manage", resourceType: "feed-group", isSensitive: false },
    ];

    // ┌─ S16-SOCIAL-ATTDEBT-1 (F1) — PHẦN TỬ THỨ 5, CHỈ CHO `004`/`016` ─────────────────────────┐
    // │ 🔴 **APPEND Ở CUỐI, TUYỆT ĐỐI KHÔNG chèn vào đầu/giữa.** Mảng này được đọc THEO CHỈ SỐ     │
    // │ CỨNG ngay dưới. Chèn ở đầu ⇒ `managePostsScope` nhận scope của `view:feed` ⇒ **mọi nhân    │
    // │ viên có `view:feed` thành `canManagePosts = true`** ⇒ đọc bài `hidden` toàn công ty        │
    // │ (`visiblePostCondition`) + sửa/xoá nội dung BẤT KỲ ai (`assertCanMutateContent`). Đó là    │
    // │ leo thang quyền cho 100% nhân viên, và tầng-1 KHÔNG bắt được (cặp tầng-1 của `004` là      │
    // │ `view:feed`, vai nào cũng có). Lưới thật cho ca này là int-spec H9, không phải typecheck.  │
    // │                                                                                            │
    // │ 48 route còn lại tra bảng ra `undefined` ⇒ gửi `baseRequests` **y hệt byte** như trước WO  │
    // │ này ⇒ 0 chi phí, 0 đổi ngữ nghĩa. Ca `U2` ghim đúng điều đó.                               │
    // └────────────────────────────────────────────────────────────────────────────────────────────┘
    const attachTarget: SocialTargetType | undefined =
      ATTACH_GATE_ROUTE_TARGET[routeKey as keyof typeof ATTACH_GATE_ROUTE_TARGET];
    const requests =
      attachTarget === undefined
        ? baseRequests
        : [
            ...baseRequests,
            // BÓC TAY 3 field, KHÔNG truyền nguyên object của bảng — cùng luật đã ghi ở
            // `canApproveIdeas` bên dưới: `resolveStrongestScopes` spread nguyên vật vào
            // `decideStrongestScope`, nên một field mới trùng tên sẽ đổi QUYẾT ĐỊNH PHÂN QUYỀN
            // trong im lặng và typecheck không bắt.
            {
              action: SOCIAL_FILE_TARGET_PAIRS[attachTarget].action,
              resourceType: SOCIAL_FILE_TARGET_PAIRS[attachTarget].resourceType,
              isSensitive: SOCIAL_FILE_TARGET_PAIRS[attachTarget].isSensitive,
            },
          ];

    const scopes = await this.dataScope.resolveManyOrNull(user.id, user.companyId, requests);
    const [routeScopeOrNull, managePostsScope, manageNewsScope, manageGroupsScope] = scopes;
    const attachNewGate: AttachNewGateSnapshot =
      attachTarget === undefined
        ? { resolved: false }
        : { resolved: true, target: attachTarget, scope: scopes[ATTACH_IDX] ?? null };

    // Tầng 2 — assert cặp của route, ĐỘC LẬP với decorator. Deny ở đây để lại ZERO side-effect vì
    // nó chạy TRƯỚC mọi thao tác ghi. Chuỗi lỗi là hợp đồng với FE/QA, không phải văn bản tự do.
    // S16-SOCIAL-BE-2B-2: route nào có mã lỗi RIÊNG của SPEC-16 §12 cho ca thiếu quyền thì phát mã
    // đó (hôm nay chỉ `046` — `SOCIAL-ERR-020`). `undefined` ⇒ giữ chuỗi chung cho 47 route còn lại.
    // Xem docblock `SocialPair.denyMessage`: đây là chỗ DUY NHẤT tới được, vì một assert thứ hai ở
    // service không bao giờ chạy tới (hai nhánh dưới đây đã chặn hết).
    if (routeScopeOrNull == null) {
      throw new ForbiddenException(p.denyMessage ?? "AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    // SÀN SCOPE (khuôn RECRUIT/ROOM · memory `dash-widget-gate-needs-scope-floor`): cặp chỉ-Company
    // mà grant resolve ra hẹp hơn ⇒ TỪ CHỐI, KHÔNG "coi như" Company — một lần đổi `data_scope`
    // per-pair sau này không được âm thầm nới thành toàn công ty.
    if (p.companyFloor && !SocialAccessService.isCompany(routeScopeOrNull)) {
      throw new ForbiddenException(
        p.denyMessage ?? "AUTH-ERR-SCOPE-DENIED: cặp SOCIAL này chỉ hợp lệ ở scope Company",
      );
    }

    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);

    return {
      actorUserId: user.id,
      companyId: user.companyId,
      routeKey,
      routeScope: routeScopeOrNull,
      // 🔴 SÀN SCOPE Company — `isCompany(scope)`, TUYỆT ĐỐI KHÔNG `scope !== null` (khuôn
      // `PayrollAccessService.canRevealTaxCode` điều 3, BLOCKER B3 của plan-review PAYROLL — giữ
      // nguyên chữ này để lượt sau không "đơn giản hoá" nó đi). `resolveManyOrNull` trả scope MẠNH
      // NHẤT và KHÔNG ép sàn nào, trong khi `SOCIAL_ROUTE_PAIRS` khai `companyFloor=true` cho TOÀN
      // BỘ 19 route. Viết `!== null` ⇒ một vai giữ `manage:feed-post`@`Department` (API ghi grant
      // cho phép: `role-admin.service.ts` chỉ chặn `System`) bị 403 ở route 006 SỞ HỮU năng lực đó,
      // nhưng đọc được MỌI bài `hidden` của cả công ty (`visiblePostCondition` :157) và sửa/xoá nội
      // dung của BẤT KỲ ai (`assertCanMutateContent` :354) — ô cửa sổ rộng hơn cửa chính.
      canManagePosts: SocialAccessService.isCompany(managePostsScope),
      canManageNews: SocialAccessService.isCompany(manageNewsScope),
      // Cùng SÀN Company như hai cờ trên — `isCompany()` để `undefined`/`null` fail-closed.
      canManageGroups: SocialAccessService.isCompany(manageGroupsScope),
      // D13 (owner ký 21/09/2026) — đơn vị của chính actor ∪ đơn vị actor đứng đầu. KHÔNG cây con.
      orgUnitIds: this.dataScope.departmentOrgUnitIds(ctx),
      // S16-SOCIAL-ATTDEBT-1 (F1) — ảnh chụp cổng gắn tệp. `scopes[ATTACH_IDX]` chỉ `undefined` được
      // nếu hợp đồng «độ dài mảng trả == độ dài `requests`» của `resolveStrongestScopes` vỡ
      // (`permission.service.ts:849-865` giữ nó kể cả ở nhánh lỗi hạ tầng) ⇒ quy về `null` =
      // fail-CLOSED, KHÔNG phải một kiểm tra runtime trên đường nóng.
      attachNewGate,
    };
  }

  /**
   * Cổng phụ **theo LOẠI BÀI** của `SOCIAL-API-002` (API-19 §5.1b). Gọi sau `resolveActor`, trước INSERT.
   *
   * ┌─ VÌ SAO LÀ MỘT HÀM ĐỌC BẢNG, KHÔNG PHẢI MỘT CHUỖI `if` ──────────────────────────────────────┐
   * │ Trước WO này `SOCIAL_POST_TYPE_PAIRS` **không có call-site nào ở runtime** — chỉ census đọc   │
   * │ (`social-two-layer-guard-census.unit-spec.ts:314`), còn `create()` gác `news` bằng cờ         │
   * │ `canManageNews` hard-code. Tức là bảng và lưới là HAI thứ rời nhau: thêm một loại bài vào     │
   * │ `feedCreatableTypeSchema` mà quên nhánh `if` thì route `002` tạo được loại đó **không cặp     │
   * │ quyền nào gác** — và census vẫn XANH, vì nó chỉ kiểm bảng CÓ khoá, không kiểm ai dùng bảng.   │
   * │                                                                                               │
   * │ Đọc bảng ở đây làm nó LOAD-BEARING: quên khai một loại ⇒ TS đỏ ngay tại `SOCIAL_POST_TYPE_    │
   * │ PAIRS[type]` (kiểu `SocialCreatablePostType` suy từ chính bảng), không cần lưới quét mã nguồn.│
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ `news` đi qua ĐÂY thay vì cờ batch `canManageNews`, CÓ CHỦ ĐÍCH: để hai loại bài không có hai
   * cơ chế. Giá phải trả là **một round-trip quyền lặp lại** cho riêng đường tạo tin tức (cờ batch
   * vẫn còn vì các route khác dùng nó) — chấp nhận trên một route GHI để đổi lấy việc xoá hẳn đường
   * trôi. Mã lỗi giữ NGUYÊN theo từng loại: đổi nó là đổi hành vi của một route đã ship.
   *
   * Scope ép SÀN `Company` qua `isCompany()` — `undefined`/`null` fail-closed, TUYỆT ĐỐI không `!= null`.
   */
  async assertCreatablePostType(actor: SocialActor, type: SocialCreatablePostType): Promise<void> {
    const pair = SOCIAL_POST_TYPE_PAIRS[type];
    if (pair === null) return; // `share` — cặp sàn `create:feed-post` là đủ.

    const denied = SOCIAL_POST_TYPE_DENIED[type];
    if (denied === null) {
      // Hai bảng lệch nhau (có cặp mà không có mã lỗi). Lựa chọn khác duy nhất là `return` — tức
      // BỎ QUA cổng quyền vì một lỗi khai báo. Chặn.
      throw new ForbiddenException(SOCIAL_POST_TYPE_PAIR_DESYNC);
    }

    const [scope] = await this.dataScope.resolveManyOrNull(actor.actorUserId, actor.companyId, [
      pair,
    ]);
    if (SocialAccessService.isCompany(scope)) return;
    throw new ForbiddenException(denied);
  }

  /**
   * S16-SOCIAL-BE-2B-2 (D22) — cổng của CỜ `isOfficial` trong payload `type='kudos'`.
   *
   * `create:feed-kudos` (cổng theo LOẠI bài) cho phép đăng một lời vinh danh thường; `isOfficial:true`
   * biến nó thành bài mang **DẤU CÔNG TY** và đòi cặp KHÁC: `manage:feed-kudos`.
   *
   * ⚠️ Đọc `SOCIAL_KUDOS_FLAG_PAIRS` thay vì gõ literal — cùng lý do đã ghi ở `assertCreatablePostType`:
   * một bảng hằng mà không call-site runtime nào đọc thì census/spec canh nó chỉ canh được một hằng
   * chết. Đọc bảng làm nó LOAD-BEARING.
   *
   * ⚠️ **TIÊU CHÍ GỘP-VÀO-BATCH (viết lại ở S16-SOCIAL-ATTDEBT-1, owner ký S-1 ngày 24/09/2026).**
   * Câu cũ ở đây là «KHÔNG nhét cặp lẻ vào batch `resolveActor` vì batch chạy cho cả 48/50 route».
   * Câu đó **không sai, nhưng thiếu chiều**: nó cấm cả những ca gộp được mà 48 route kia trả giá 0.
   * Tiêu chí đầy đủ — gộp khi và chỉ khi **cả ba**:
   *   1. cặp **suy được từ `routeKey`** (không cần `dto`) — `resolveActor` không nhìn thấy body;
   *   2. gộp **CÓ ĐIỀU KIỆN**, chỉ thêm phần tử cho đúng route cần ⇒ route khác trả giá **0**;
   *   3. lời gọi lẻ hiện tại đang mở một **transaction THỨ HAI trên đường GHI** (đo được).
   *
   * ⇒ Cặp `manage:feed-kudos` này **TRƯỢT điều (1)**: nó phụ thuộc cờ `isOfficial` trong BODY của
   * `002`, mà `resolveActor` không thấy body ⇒ gộp sẽ resolve cho MỌI lượt `postCreate` kể cả bài
   * không phải kudos. **GIỮ NGUYÊN lời gọi lẻ ở đây.**
   *
   * Scope ép SÀN `Company` qua `isCompany()` — `undefined`/`null` fail-closed.
   *
   * @throws ForbiddenException 403 `KUDOS_OFFICIAL_DENIED`
   */
  async assertKudosOfficial(actor: SocialActor): Promise<void> {
    const [scope] = await this.dataScope.resolveManyOrNull(actor.actorUserId, actor.companyId, [
      SOCIAL_KUDOS_FLAG_PAIRS.isOfficial,
    ]);
    if (SocialAccessService.isCompany(scope)) return;
    throw new ForbiddenException(SOCIAL_ERR.KUDOS_OFFICIAL_DENIED);
  }

  /**
   * S16-SOCIAL-BE-1C (D1) — cổng TẦNG 2 của cửa đăng ký tệp (`054`/`055`), theo `target`.
   *
   * ┌─ VÌ SAO CỔNG NÀY LÀ THỨ DUY NHẤT GÁC ĐƯỢC CỬA ẤY ─────────────────────────────────────────────┐
   * │ `SocialFileResolver.canLinkFile` hỏi `create:feed-post` cho `feed_post` và `create:feed-comment` │
   * │ cho `feed_comment` (vế 6a). `@RequirePermission` khai được ĐÚNG MỘT cặp tĩnh, nên tầng 1 của hai  │
   * │ route chỉ giữ được SÀN `view:feed` — một cặp mà seed `0578` cấp cho CẢ 4 vai canonical. Không có  │
   * │ hàm này thì cửa tải tệp của bảng tin **mở cho mọi nhân viên**, kể cả vai bị thu hồi cả hai cặp    │
   * │ `create:feed-*`. Đó không phải lỗ tải-về (tệp 0-link là inert) mà là lỗ GHI: một vai bị cấm đăng  │
   * │ bài vẫn bơm được tệp vào kho tenant, không giới hạn số lượt.                                      │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **TIÊU CHÍ GỘP-VÀO-BATCH** — bản đầy đủ ở docblock `assertKudosOfficial` phía trên
   * (S16-SOCIAL-ATTDEBT-1, owner ký S-1). Cặp của `054`/`055` **TRƯỢT điều (1)**: `target` là một
   * trường của REQUEST, nên gộp sẽ phải resolve CẢ HAI cặp cho cả hai route. **GIỮ NGUYÊN lời gọi
   * lẻ ở đây** (và owner ký S-7 của ATTGATE-1 cấm đụng hai route đã ship này).
   *
   * 🔴 Đối chiếu: cặp của `004`/`016` (`resolveAttachNewGate` ngay dưới) **THOẢ cả ba** — `postUpdate`
   * và `commentUpdate` là song ánh với target, nên nó ĐÃ được gộp vào batch. Hai hàm cạnh nhau, hai
   * kết luận ngược nhau, cùng một tiêu chí — đó là chủ ý, không phải bất nhất.
   *
   * ⚠️ `target` là ĐẦU VÀO của cổng, KHÔNG phải một khẳng định được tin (plan §1 D1a): khai `'comment'`
   * rồi đem tệp gắn vào BÀI thì trên đường TẠO vẫn bị chặn — nhưng bởi **TẦNG 1 của route `002`/`015`**
   * (chính là hai cặp `create:feed-*`), KHÔNG phải bởi `canLinkFile`.
   *
   * 🔴 `canLinkFile` KHÔNG nằm trên đường gắn (đo 24/09/2026): nó chỉ chạy trên
   * `POST /foundation/files/:id/links` (`link:foundation-file`). Đường gắn thật là
   * `SocialAttachmentsService.syncLinksTx` — ở đó vế 6a được ép bởi tham số `gate`, mà đường SỬA
   * `004`/`016` lấy từ `resolveAttachNewGate` ngay dưới (S16-SOCIAL-ATTGATE-1).
   *
   * Scope ép SÀN `Company` qua `isCompany()` — `undefined`/`null` fail-closed, TUYỆT ĐỐI không `!= null`.
   *
   * @throws ForbiddenException 403 `FILE_TARGET_POST_DENIED` / `FILE_TARGET_COMMENT_DENIED`
   */
  async assertFileTarget(actor: SocialActor, target: SocialTargetType): Promise<void> {
    const [scope] = await this.dataScope.resolveManyOrNull(actor.actorUserId, actor.companyId, [
      SOCIAL_FILE_TARGET_PAIRS[target],
    ]);
    if (SocialAccessService.isCompany(scope)) return;
    throw new ForbiddenException(SOCIAL_FILE_TARGET_DENIED[target]);
  }

  /**
   * S16-SOCIAL-ATTGATE-1 (plan D-1, owner ký S-1) — vế 6a cho ĐƯỜNG SỬA `004`/`016`: cặp
   * `create:feed-*` theo đích, trả về dưới dạng **quyết định** chứ không ném.
   *
   * ┌─ VÌ SAO TRẢ GIÁ TRỊ, KHÔNG NÉM ────────────────────────────────────────────────────────────┐
   * │ Câu trả lời chỉ được ÁP khi đã biết lượt sửa có thật sự THÊM tệp mới hay không — và điều đó │
   * │ chỉ tính được TRONG tx (`syncLinksTx` so tập link hiện có với tập client gửi). Ném ở đây =  │
   * │ chặn cả lượt gỡ/giữ nguyên đính kèm ⇒ vai `manage:feed-post` mất khả năng gỡ ảnh vi phạm.   │
   * │ Nên: quyết định ở đây, ném ở đó.                                                            │
   * └─────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 **ĐÍNH CHÍNH S16-SOCIAL-ATTDEBT-1 (F1) — hàm này KHÔNG còn hỏi DB.** Bản ATTGATE-1 viết
   * «hàm này mở `withTenant` riêng qua `dataScope`»; câu đó nay SAI. Cặp `create:feed-*` được
   * `resolveActor` nạp SẴN trong CÙNG lượt đọc grant (`ATTACH_GATE_ROUTE_TARGET` quyết định route
   * nào được nạp), và hàm này chỉ ĐỌC ảnh chụp đó. Lý do đổi: mỗi lời gọi `resolveManyOrNull` là
   * một `db.withTenant` THẬT (không cache — `permission.cache.ts:95` là passthrough có chủ ý), nên
   * bản cũ mở một transaction THỨ HAI trên mỗi PATCH có `attachmentIds`.
   *
   * ⚠️ Giữ kiểu trả `Promise<AttachNewGate>` dù thân hàm không còn `await`: hai call-site đang
   * `await` nó: đổi sang đồng bộ là mở đường cho một lượt "dọn dẹp" bỏ `await` ⇒ `attach.gate`
   * thành `Promise` ⇒ `!gate.allow` là `!undefined` ⇒ ném MỌI lượt (fail-closed nhưng route chết).
   *
   * ⚠️ **Owner chốt S-7 (24/09/2026): KHÔNG gộp hàm này với `assertFileTarget`.** Hai cửa (054/055
   * vs 004/016) dùng CHUNG hai bảng hằng `SOCIAL_FILE_TARGET_PAIRS` + `SOCIAL_FILE_TARGET_DENIED`,
   * và việc chống trôi giữa chúng giao cho `social-file-target-pairs-structure.spec.ts` — đổi lấy
   * việc KHÔNG đụng vào mã của hai route đã ship.
   *
   * ⚠️ Fail-closed: `resolveManyOrNull` trả `null`/scope hẹp hơn Company ⇒ DENY. TUYỆT ĐỐI không
   * `!= null` (cùng luật với `assertKudosOfficial`/`assertFileTarget` ngay trên).
   */
  resolveAttachNewGate(actor: SocialActor, target: SocialTargetType): Promise<AttachNewGate> {
    const snap = actor.attachNewGate;

    // 🔴 `snap === undefined` KHÔNG PHẢI phòng thủ thừa (plan §7 B3, đã đo): 2 trong 3 chỗ dựng
    // `SocialActor` dùng `as SocialActor` (type assertion), và TypeScript KHÔNG đòi đủ thuộc tính
    // trong một assertion ⇒ field "bắt buộc" này có thể VẮNG lúc chạy. Đọc `snap.resolved` thẳng
    // sẽ ném `TypeError` ⇒ **500 vô danh thay cho một quyết định DENY có thông điệp**.
    //
    // `snap.target !== target` là lưới runtime thứ hai: call-site khai Ý ĐỊNH (`"post"`/`"comment"`),
    // ảnh chụp khai thứ ĐÃ RESOLVE. Hai lời khai độc lập lệch nhau ⇒ DENY ồn ào, không đoán bừa.
    if (snap === undefined || snap.resolved !== true || snap.target !== target) {
      // `error`, KHÔNG `warn`: đây là lỗi NỐI DÂY của lập trình viên (route quên khai trong
      // `ATTACH_GATE_ROUTE_TARGET`), không phải một lượt deny nghiệp vụ bình thường. Trộn chung mức
      // log là chôn nó vào tiếng ồn của deny thường.
      this.logger.error(
        `attach-gate KHÔNG pre-resolve: route=${actor.routeKey} target=${target} ` +
          `snapshot=${snap === undefined ? "undefined" : JSON.stringify(snap)}`,
      );
      return Promise.resolve({ allow: false, reason: SOCIAL_FILE_TARGET_DENIED[target] });
    }

    if (SocialAccessService.isCompany(snap.scope)) return Promise.resolve({ allow: true });
    return Promise.resolve({ allow: false, reason: SOCIAL_FILE_TARGET_DENIED[target] });
  }

  /**
   * S16-SOCIAL-BE-2B-2 (D19) — **câu HỎI**, không phải cổng: actor có `approve:feed-idea` @Company không?
   *
   * Dùng cho MASK `reviewNote` ở `045` — một route gác `view:feed` (MỌI nhân viên), nơi câu hỏi "ai được
   * đọc ghi chú xét duyệt" hoàn toàn khác câu hỏi "ai được vào route".
   *
   * ┌─ 🔴 VÌ SAO ĐÂY LÀ `Promise<boolean>`, KHÔNG PHẢI MỘT `assert…` (đo 24/09/2026) ──────────────────┐
   * │ Plan (D20) định có `assertApproveIdea` để phát `SOCIAL-ERR-020` cho `046`. Hàm đó **không bao giờ │
   * │ chạy tới**: `resolveActor` ngay trên đã tự resolve cặp của route và ném ở CẢ HAI nhánh (không có   │
   * │ grant · scope hẹp hơn `companyFloor`) trước khi service chạy. Giữ một `assert` như thế = code chết │
   * │ trông y hệt một cổng — kiểu hỏng tệ nhất cho người đọc sau.                                       │
   * │ Mã `SOCIAL-ERR-020` giờ phát từ `SocialPair.denyMessage` của `ideaReview` (xem docblock ở đó).     │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ Fail-closed: `resolveManyOrNull` trả `null`/scope hẹp ⇒ `false`. Không `!= null`.
   */
  async canApproveIdeas(actor: SocialActor): Promise<boolean> {
    // ⚠️ BÓC TAY ba field, KHÔNG truyền nguyên `SOCIAL_ROUTE_PAIRS.ideaReview` (FULL gate
    // `security-reviewer`, LOW): `resolveStrongestScopes` spread nguyên vật vào `decideStrongestScope`
    // (`{ ...req, pairIsSensitive: … }`). Hôm nay `ScopeRequest` chỉ có 4 field và không trùng tên nào
    // của `SocialPair` — nhưng một field mới trùng tên (`requiresReauth`, hay một `companyFloor` tương
    // lai) sẽ đổi **quyết định phân quyền** trong im lặng, và typecheck không bắt. Đây là lý do
    // `resolveActor` cũng bóc tay ở chỗ tương ứng.
    const p = SOCIAL_ROUTE_PAIRS.ideaReview;
    const [scope] = await this.dataScope.resolveManyOrNull(actor.actorUserId, actor.companyId, [
      { action: p.action, resourceType: p.resourceType, isSensitive: p.isSensitive },
    ]);
    return SocialAccessService.isCompany(scope);
  }

  static isCompany(scope: DataScope | null): boolean {
    return scope === "Company" || scope === "System";
  }

  /**
   * Ngữ cảnh XEM cho đường KHÔNG-phải-route-SOCIAL — hiện chỉ có `SocialFileResolver`
   * (`FilePolicyService` hỏi quyền tệp qua route của FOUNDATION Files).
   *
   * ⚠️ **KHÔNG assert cặp quyền nào** và đó là đúng, không phải thiếu sót: người gọi hàm này là
   * `FilePolicyService`, và resolver PHẢI tự hỏi cặp `view:feed` của nó (xem `SocialFileResolver`).
   * Trả về ở đây chỉ là NGUYÊN LIỆU dựng vị từ visibility — nó không cấp phép gì.
   *
   * Dùng chung `visiblePostCondition` với mọi route đọc là cả mục đích: cổng MÀN HÌNH và cổng ĐƯỜNG
   * TẢI buộc phải nói cùng một câu (`read-path-gate-pair-must-match-download-pair`).
   */
  async resolveViewerContext(userId: string, companyId: string): Promise<SocialViewerContext> {
    const [managePostsScope] = await this.dataScope.resolveManyOrNull(userId, companyId, [
      { action: "manage", resourceType: "feed-post", isSensitive: false },
    ]);
    const ctx = await this.dataScope.resolveContext(userId, companyId);
    return {
      actorUserId: userId,
      companyId,
      // Cùng SÀN Company như `resolveActor` — xem khối 🔴 ở đó. Lệch giữa hai đường là tệ nhất:
      // đường TẢI TỆP sẽ rộng hơn đường MÀN HÌNH, đúng lớp lỗi `read-path-gate-pair-must-match-
      // download-pair` mà resolver này sinh ra để bịt.
      canManagePosts: SocialAccessService.isCompany(managePostsScope),
      orgUnitIds: this.dataScope.departmentOrgUnitIds(ctx),
    };
  }

  /**
   * Vị từ "bài này actor ĐƯỢC THẤY" — dùng cho CẢ liệt kê LẪN `assertPostVisible`.
   *
   * Ba vế, AND với nhau:
   *   (a) **chưa xoá mềm** — `deleted_at IS NULL`. Không có ngoại lệ nào, kể cả `manage:feed-post`:
   *       BE-1 không có route thùng rác (plan §0.2), nên một nhánh "manage thấy cả bài đã xoá" sẽ là
   *       đường đọc duy nhất vào dữ liệu đã xoá mà không ai gác.
   *   (b) **status** — `published` cho mọi người; `hidden` CHỈ cho tác giả hoặc `manage:feed-post`.
   *       `deleted` không bao giờ (đã chặn ở (a), giữ vế này để status là một tập đóng đọc được).
   *   (c) **audience** — `company` cho mọi người; `org_unit` chỉ khi `org_unit_id` ∈ tập của actor
   *       (đúng-BẰNG, không cây con — D13); `group` **luôn FALSE ở BE-1** vì chưa có route quản lý
   *       nhóm ⇒ không có cách nào biết actor có thuộc nhóm hay không, và "coi như thấy được" là
   *       phát bài riêng tư ra cả công ty. Tác giả VẪN thấy bài của chính mình ở mọi audience.
   *
   * ⚠️ `alias` cho phép dùng lại vị từ khi `feed_posts` được JOIN dưới một tên khác (đường bình
   * luận). KHÔNG mặc định truyền cột trần — quên alias ở một JOIN là vị từ bám nhầm bảng.
   */
  visiblePostCondition(actor: SocialViewerContext, t: typeof feedPosts = feedPosts): SQL {
    const isAuthor = eq(t.authorUserId, actor.actorUserId);

    const statusOk: SQL = actor.canManagePosts
      ? // `manage:feed-post` đọc được cả `published` lẫn `hidden` — nhưng KHÔNG `deleted` (vế (a)).
        inArray(t.status, ["published", "hidden"])
      : (or(eq(t.status, "published"), and(eq(t.status, "hidden"), isAuthor)) ?? sql`false`);

    const audienceOr: SQL[] = [eq(t.audience, "company")];
    if (actor.orgUnitIds.length > 0) {
      audienceOr.push(
        and(eq(t.audience, "org_unit"), inArray(t.orgUnitId, [...actor.orgUnitIds])) ?? sql`false`,
      );
    }
    // 🔴 S16-SOCIAL-BE-2A (D3) — nhánh `group`: thành viên `active` HOẶC nhóm `public`, nhóm CÒN SỐNG.
    // Vị từ RIÊNG, không dùng chung với tập-người (`activeGroupMemberExists`): xem docblock của
    // `visibleGroupPostExists` — nhóm public đọc được bởi mọi người nhưng chỉ THÀNH VIÊN mới là
    // người nhận NOTI / người bị đếm "chưa đọc". EXISTS tương
    // quan TRONG CÂU (không resolve mảng id trước: tập nhóm đổi liên tục, và một mảng đọc ở tx khác
    // là TOCTOU). Vị từ dùng CHUNG với ba hàm tập-người — một luật, một bản (`social-group-
    // predicates.ts`). Bám `t.groupId` theo tham số `alias`, KHÔNG `feedPosts.groupId` (M-g).
    //
    // ⚠️ Vị từ này phục vụ CẢ cổng màn hình LẪN cổng đường tải (`SocialFileResolver` dùng chung) —
    // nới nhánh này là nới cả hai. `manage:feed-group` CỐ Ý không có mặt ở đây (D9-ii).
    audienceOr.push(
      and(
        eq(t.audience, "group"),
        visibleGroupPostExists(actor.companyId, t.groupId, actor.actorUserId),
      ) ?? sql`false`,
    );
    // Tác giả luôn thấy bài của chính mình — kể cả `org_unit` của đơn vị họ vừa rời, kể cả `group`.
    audienceOr.push(isAuthor);
    const audienceOk = or(...audienceOr) ?? sql`false`;

    return and(isNull(t.deletedAt), statusOk, audienceOk) ?? sql`false`;
  }

  /**
   * Cửa của mọi đường theo `{post_id}`. MỘT truy vấn, MỘT thông điệp 404 cho MỌI lý do.
   *
   * @throws NotFoundException (404 `SOCIAL-ERR-001`) khi: bài không tồn tại · tenant khác · đã xoá
   *   mềm · `hidden` mà actor không phải tác giả và không có `manage:feed-post` · `audience` ngoài
   *   tầm actor — tất cả trả về BYTE GIỐNG HỆT NHAU.
   */
  async assertPostVisible(
    tx: TenantTx,
    actor: SocialViewerContext,
    postId: string,
  ): Promise<SocialPostAccess> {
    const rows = await tx
      .select({
        id: feedPosts.id,
        authorUserId: feedPosts.authorUserId,
        type: feedPosts.type,
        audience: feedPosts.audience,
        orgUnitId: feedPosts.orgUnitId,
        groupId: feedPosts.groupId,
        status: feedPosts.status,
        pinned: feedPosts.pinned,
        commentsLocked: feedPosts.commentsLocked,
        requiresAck: feedPosts.requiresAck,
        likeCount: feedPosts.likeCount,
        commentCount: feedPosts.commentCount,
      })
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.id, postId),
          // Vế tenant là belt-and-suspenders trên RLS — KHÔNG BAO GIỜ bỏ, kể cả khi `withTenant` đã
          // set GUC: một lần RLS bị tắt nhầm ở migration là mọi câu không mang `company_id` mở toang.
          eq(feedPosts.companyId, actor.companyId),
          this.visiblePostCondition(actor),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);
    return row as SocialPostAccess;
  }

  /**
   * Cửa của mọi đường theo `{comment_id}` — **JOIN qua bài cha và áp CÙNG vị từ visibility**.
   *
   * Không tách làm hai bước (đọc bình luận rồi `assertPostVisible`): hai bước để lộ chênh lệch thời
   * gian và, quan trọng hơn, mở ra nhánh "bình luận có tồn tại nhưng bài thì không" mà người viết
   * sau dễ trả 403/404 khác nhau ⇒ oracle phân biệt.
   */
  async assertCommentVisible(
    tx: TenantTx,
    actor: SocialViewerContext,
    commentId: string,
  ): Promise<SocialCommentAccess> {
    const rows = await tx
      .select({
        id: feedComments.id,
        postId: feedComments.postId,
        parentCommentId: feedComments.parentCommentId,
        authorUserId: feedComments.authorUserId,
        likeCount: feedComments.likeCount,
        postAuthorUserId: feedPosts.authorUserId,
        postType: feedPosts.type,
        postAudience: feedPosts.audience,
        postOrgUnitId: feedPosts.orgUnitId,
        postGroupId: feedPosts.groupId,
        postStatus: feedPosts.status,
        postPinned: feedPosts.pinned,
        postCommentsLocked: feedPosts.commentsLocked,
        postRequiresAck: feedPosts.requiresAck,
        postLikeCount: feedPosts.likeCount,
        postCommentCount: feedPosts.commentCount,
      })
      .from(feedComments)
      .innerJoin(
        feedPosts,
        and(
          eq(feedPosts.id, feedComments.postId),
          // FK chéo bảng là COMPOSITE ở SQL (KI-046) — nối cả `company_id` ở JOIN, đừng chỉ nối id.
          eq(feedPosts.companyId, feedComments.companyId),
        ),
      )
      .where(
        and(
          eq(feedComments.id, commentId),
          eq(feedComments.companyId, actor.companyId),
          isNull(feedComments.deletedAt),
          this.visiblePostCondition(actor),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException(SOCIAL_ERR.COMMENT_NOT_FOUND);

    return {
      id: row.id,
      postId: row.postId,
      parentCommentId: row.parentCommentId,
      authorUserId: row.authorUserId,
      likeCount: row.likeCount,
      post: {
        id: row.postId,
        authorUserId: row.postAuthorUserId,
        type: row.postType,
        audience: row.postAudience,
        orgUnitId: row.postOrgUnitId,
        groupId: row.postGroupId,
        status: row.postStatus,
        pinned: row.postPinned,
        commentsLocked: row.postCommentsLocked,
        requiresAck: row.postRequiresAck,
        likeCount: row.postLikeCount,
        commentCount: row.postCommentCount,
      },
    };
  }

  /**
   * ⚠️ **CỬA CHỐNG IDOR ĐA HÌNH — GỌI TRƯỚC MỌI INSERT vào `feed_reactions`/`feed_mentions`.**
   *
   * Xem khối ⚠️ IDOR ở docblock đầu lớp. Hàm này CHỈ uỷ quyền cho hai `assert*Visible` ở trên — nó cố
   * ý KHÔNG có truy vấn riêng: một truy vấn thứ hai cho cùng câu hỏi là một bản luật thứ hai để trôi.
   *
   * `S16-SOCIAL-BE-1B` dùng LẠI chính hàm này cho `feed_reports.target_id` (biến thể `'report'` KHÔNG
   * tồn tại — báo cáo trỏ vào post|comment như hai bảng kia).
   *
   * @returns `postId` gốc của đích — caller cần nó để bump `last_activity_at` và định tuyến WS/NOTI.
   */
  async assertTargetVisible(
    tx: TenantTx,
    actor: SocialViewerContext,
    targetType: SocialTargetType,
    targetId: string,
  ): Promise<SocialTargetAccess> {
    if (targetType === "post") {
      const post = await this.assertPostVisible(tx, actor, targetId);
      return {
        postId: post.id,
        authorUserId: post.authorUserId,
        postAudience: post.audience,
        postStatus: post.status,
        postOrgUnitId: post.orgUnitId,
      };
    }
    const comment = await this.assertCommentVisible(tx, actor, targetId);
    return {
      postId: comment.postId,
      authorUserId: comment.authorUserId,
      // Bài CHA của bình luận — cảm xúc trên bình luận của bài `org_unit` cũng là dữ liệu riêng
      // của đơn vị đó, không được phát ra room cả-công-ty (D21).
      postAudience: comment.post.audience,
      postStatus: comment.post.status,
      postOrgUnitId: comment.post.orgUnitId,
    };
  }

  /**
   * Nhánh **GHI**: actor tự chọn `audience` + khoá đi kèm khi đăng bài. 403 `SOCIAL-ERR-002` ở đây
   * KHÔNG rò gì — actor vừa gõ chính cái id đó vào request nên đã biết nó tồn tại.
   *
   * ⟲ **S16-SOCIAL-BE-2A (D4) — hàm này ĐÃ THÀNH `async` và chạy TRONG tx ghi.**
   *
   * ┌─ BA RÀNG BUỘC, KHÔNG PHẢI KHẨU VỊ ─────────────────────────────────────────────────────────────┐
   * │ 1. **MỘT call-site DUY NHẤT** (`social-posts.service.ts`), và nó nằm **TRONG** `withTenant`.    │
   * │    Trước BE-2A hàm này SYNC và chạy NGOÀI tx (`:153` đứng trước `:155`) — kiểm ở ngoài rồi ghi  │
   * │    ở trong là TOCTOU: membership có thể bị thu hồi giữa hai thời điểm.                          │
   * │ 2. Nhận `tx` của caller và **chuyển thẳng** cho `SocialGroupAccessService`. Service đó CẤM tự mở │
   * │    `withTenant` — lồng tx = treo IM LẶNG trên PgBouncer.                                        │
   * │ 3. Thứ tự lỗi ở nhánh `group`: **404 TRƯỚC 403**. Nhóm không thấy được (không tồn tại · xoá mềm │
   * │    · `private` mà không phải thành viên) ⇒ 404 `ERR-012`, KHÔNG được để lộ rằng nó tồn tại;     │
   * │    thấy được mà không phải thành viên `active` (nhóm `public`) ⇒ 403 `ERR-002`.                 │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ Thiếu `groupId` KHÔNG tới được đây: `createFeedPostSchema.superRefine` chặn từ Zod ⇒ **400**
   * (M24/D-OWNER-9). Vế `AUDIENCE_KEY_MISSING` bên dưới vì vậy là nhánh chết với cả `org_unit` —
   * giữ nguyên làm lưới thứ hai, nhưng đừng viết ca test kỳ vọng 422 ở đó.
   */
  async assertWriteAudience(
    tx: TenantTx,
    actor: SocialActor,
    audience: string,
    orgUnitId: string | null,
    groupId: string | null,
  ): Promise<void> {
    if (audience === "group") {
      if (groupId == null) {
        throw new UnprocessableEntityException(SOCIAL_ERR.AUDIENCE_KEY_MISSING);
      }
      // 404 trước: cửa này nuốt cả "nhóm đã xoá mềm" (D13) và "private mà mình không thuộc".
      await this.groups.assertGroupVisibleTx(tx, actor, groupId);
      const membership = await this.groups.getMembershipTx(
        tx,
        actor.companyId,
        groupId,
        actor.actorUserId,
      );
      // `pending` KHÔNG phải thành viên: xin vào rồi là đăng được thì cổng nhóm kín vô nghĩa.
      if (membership?.status !== "active") {
        throw new ForbiddenException(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
      }
      return;
    }
    if (audience === "org_unit") {
      if (orgUnitId == null) {
        throw new UnprocessableEntityException(SOCIAL_ERR.AUDIENCE_KEY_MISSING);
      }
      // Đăng vào đơn vị mình không thuộc (và không đứng đầu) ⇒ 403. Tập rỗng ⇒ mọi đơn vị đều bị từ
      // chối (fail-closed) — đúng: người không thuộc đơn vị nào thì không có đơn vị nào để đăng vào.
      if (!actor.orgUnitIds.includes(orgUnitId)) {
        throw new ForbiddenException(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
      }
    }
  }

  /**
   * Chủ sở hữu nội dung HOẶC `manage:feed-post` (SPEC-16 §12 `ERR-003`). 403 ở đây KHÔNG rò: cửa
   * `assert*Visible` đã chạy TRƯỚC, nên actor vốn đã được phép NHÌN THẤY đối tượng này.
   *
   * @returns `true` khi actor hành động với tư cách QUẢN LÝ trên nội dung của người khác — caller
   *   dùng nó để quyết định có ghi `audit_logs` hay không (API-19 §8: chỉ thao tác lên nội dung
   *   người khác mới vào sổ; sửa bài của chính mình thì không).
   */
  assertCanMutateContent(actor: SocialViewerContext, authorUserId: string): boolean {
    if (authorUserId === actor.actorUserId) return false;
    if (!actor.canManagePosts) {
      throw new ForbiddenException(SOCIAL_ERR.NOT_CONTENT_OWNER);
    }
    return true;
  }
}
