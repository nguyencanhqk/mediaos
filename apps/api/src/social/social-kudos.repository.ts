import type { FeedKudosBadgeRefDto } from "@mediaos/contracts";
import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedKudos, feedKudosBadges, feedKudosRecipients, feedPosts } from "../db/schema/social";
import { users } from "../db/schema/users";
import { SocialAccessService } from "./social-access.service";
import { SOCIAL_ERR, socialError } from "./social.errors";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-2B-2 — SQL của VINH DANH: `047` · `048` + các vị từ của đường GHI (`002/kudos`).
 *
 * ┌─ 🔴 HAI KHOÁ, KHÔNG PHẢI MỘT — LÝ DO TỒN TẠI CỦA FILE NÀY ─────────────────────────────────────┐
 * │ `feed_kudos_recipients.employee_id` neo theo **NHÂN SỰ** (`employee_profiles.id`, DB-17 §7.8),   │
 * │ còn NOTI gửi theo **TÀI KHOẢN** (`users.id`). Chỗ nối hai khoá đó là đúng lớp lỗi mà BA reviewer │
 * │ độc lập cùng bắt ở BE-1B: **nghỉ việc KHÔNG xoá mềm** — `employee_profiles.status` đổi sang      │
 * │ `'resigned'` nhưng `deleted_at` vẫn NULL. Nên mọi vị từ "người còn hoạt động" ở đây phải nói ĐỦ  │
 * │ cả hai vế trên CẢ HAI bảng; lọc `deleted_at` một mình là **hở**.                                 │
 * │                                                                                                 │
 * │ Hai đường lọc KHÁC NHAU, cố ý không gộp:                                                        │
 * │   · `userIdsOfEmployeesTx` (**D18**, 4 vế) — vào từ `employee_id`, dùng cho NOTI-033;            │
 * │   · `activeUserIdsTx` (2 vế) — vào từ `user_id`, dùng cho NOTI-032 (tác giả bài là `user_id`).   │
 * │ Gộp lại thành một hàm "cho gọn" nghĩa là một trong hai đường phải đổi khoá vào — và đổi khoá vào │
 * │ là đúng chỗ lỗi ở trên.                                                                         │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Hàm `*Tx` là hàm THUẦN nhận `tx`: KHÔNG tự mở `withTenant`. Lồng `withTenant` trong `withTenant`
 * là **treo im lặng** trên PgBouncer transaction-mode.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Vị từ của đường GHI (`002/kudos`) — hàm thuần, gọi từ `social-post-types.ts#createKudosTx`
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `SOCIAL-ERR-022` (D11) — huy hiệu phải TỒN TẠI trong tenant **và** `is_active`.
 *
 * Một câu, ba nguyên nhân về CÙNG một mã: không có · đã tắt · thuộc tenant khác (RLS + vế
 * `company_id` đều chặn). Phân biệt ba lý do là nói cho người gọi biết một uuid huy hiệu của công ty
 * khác CÓ THẬT.
 *
 * `badgeId` vắng (`null`/`undefined`) là HỢP LỆ — `feed_kudos.badge_id` nullable: vinh danh không gắn
 * huy hiệu. Trả về sớm, KHÔNG hỏi DB.
 *
 * @throws UnprocessableEntityException 422 `SOCIAL-ERR-022`
 */
export async function assertActiveBadgeTx(
  tx: TenantTx,
  companyId: string,
  badgeId: string | null | undefined,
): Promise<void> {
  if (badgeId == null) return;

  const [row] = await tx
    .select({ id: feedKudosBadges.id })
    .from(feedKudosBadges)
    .where(
      and(
        eq(feedKudosBadges.companyId, companyId),
        eq(feedKudosBadges.id, badgeId),
        eq(feedKudosBadges.isActive, true),
      ),
    )
    .limit(1);

  if (!row) throw new UnprocessableEntityException(socialError(SOCIAL_ERR.KUDOS_BADGE_INVALID));
}

/**
 * D12(a) — người nhận phải là nhân sự CÒN TỒN TẠI của tenant. Trả về tập id ĐÃ KHỬ TRÙNG LẶP.
 *
 * ┌─ 🔴 VÌ SAO KHÔNG LỌC `status = 'active'` Ở ĐÂY (owner ký S6, 24/09/2026) ───────────────────────┐
 * │ Vinh danh là **LỊCH SỬ**, không phải danh bạ. "Cảm ơn lúc chia tay" là ca thật, và chặn ở đường  │
 * │ ghi làm nó biến mất. Người đã nghỉ bị chặn ở HAI chỗ khác, cả hai đều đo được:                   │
 * │   · **NOTI** — `userIdsOfEmployeesTx` lọc đủ 4 vế ⇒ họ không nhận thông báo;                     │
 * │   · **DTO `047`** — cờ `isFormerEmployee` nói rõ trạng thái, không để người xem tự đoán.        │
 * │ Bề mặt phơi = tên một người đã nghỉ trong MỘT bài mà người xem VỐN ĐÃ thấy (thừa hưởng           │
 * │ `visiblePostCondition`) — hẹp hơn widget sinh nhật của BE-1B (danh bạ toàn công ty). Và có ĐƯỜNG  │
 * │ TỰ GỠ: xoá mềm bài (`003`) làm cả bài lẫn danh sách người nhận biến khỏi `047`.                  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `deleted_at IS NULL` thì VẪN lọc: nhân sự đã xoá mềm là hàng không còn được chiếu ở đâu cả.
 *
 * ⚠️ Cross-tenant ĐÃ bị FK tổ hợp `feed_kudos_recipients_employee_tenant_fk` (`0580:439`) chặn ở tầng
 * DB bằng `23503`. Vế `company_id` ở đây là để trả **422 đọc được** thay vì 500 chưa dịch — không
 * phải lưới bảo mật duy nhất, đừng đọc thành "bỏ được cũng không sao".
 *
 * @throws UnprocessableEntityException 422 `KUDOS_RECIPIENT_INVALID` khi số hàng khớp < số id distinct
 */
export async function assertRecipientsTx(
  tx: TenantTx,
  companyId: string,
  employeeIds: readonly string[],
): Promise<string[]> {
  // Khử trùng lặp TRƯỚC khi đếm, và chuẩn hoá HOA/thường: `Set` so sánh CHUỖI còn Postgres so sánh
  // `uuid`, nên `["AB…","ab…"]` (cùng MỘT uuid) lọt qua `Set` thành 2 phần tử rồi làm phép đếm dưới
  // đây khớp 1/2 ⇒ ném "người nhận không hợp lệ" cho một lỗi thật là gửi TRÙNG. Cùng bản vá đã áp
  // cho `optionIds` của `041` (FULL gate BE-2B-1 L-5).
  const wanted = [...new Set(employeeIds.map((id) => id.toLowerCase()))];
  // Guard RỖNG — **KHÔNG phải một quyết định nghiệp vụ**, và đừng đọc nó thành «0 người nhận thì coi
  // như hợp lệ». Đo (drizzle 0.45.2): `inArray(col, [])` sinh `sql`false`` nên bỏ guard này cho ra hành
  // vi Y HỆT (0 hàng ⇒ `0 !== 0` ⇒ vẫn trả `[]`) — nó ở đây chỉ để **không tốn một vòng tới DB không
  // để làm gì**, cùng lý do đã ghi ở `payroll-templates.repository.ts`.
  //
  // Ở call-site DUY NHẤT hiện nay (`createKudosTx`) nhánh này **không tới được**: gate K2
  // (`KUDOS_RECIPIENT_MIN = 1`) chạy ngay phía trên. Call-site MỚI nào tái dùng hàm này phải tự trả lời
  // «mảng rỗng có nghĩa gì với tôi» — hàm này KHÔNG assert điều đó. (FULL gate `silent-failure-hunter`, LOW-2.)
  if (wanted.length === 0) return [];

  const rows = await tx
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(
      and(
        eq(employeeProfiles.companyId, companyId),
        inArray(employeeProfiles.id, wanted),
        isNull(employeeProfiles.deletedAt),
      ),
    );

  if (rows.length !== wanted.length) {
    throw new UnprocessableEntityException(socialError(SOCIAL_ERR.KUDOS_RECIPIENT_INVALID));
  }
  return wanted;
}

/**
 * **D18 — VỊ TỪ "NGƯỜI CÒN HOẠT ĐỘNG", VIẾT RA ĐỦ BỐN VẾ.** Người nhận NOTI-033 của một lượt vinh danh.
 *
 * Bốn vế, KHÔNG được bớt một vế nào:
 *   1. `employee_profiles.status = 'active'` — **nghỉ việc KHÔNG xoá mềm**, đây là vế duy nhất bắt
 *      được người đã nghỉ (bài học BE-1B, ba reviewer hội tụ);
 *   2. `employee_profiles.deleted_at IS NULL`;
 *   3. `users.status = 'active'` — tài khoản bị khoá/vô hiệu hoá không nhận thông báo;
 *   4. `users.deleted_at IS NULL`.
 *
 * ⚠️ **INNER JOIN, có chủ đích**: nhân sự KHÔNG có tài khoản `users` (`employee_profiles.user_id`
 * nullable từ mig `0442`) sẽ RỤNG khỏi tập người nhận. Đó là đúng — không có tài khoản thì không có
 * hộp thông báo nào để gửi tới — và nó KHÔNG được biến thành 500: ca `K-4c`.
 *
 * Trả về tập `users.id` đã khử trùng lặp. Rỗng ⇒ producer **KHÔNG enqueue** (xem `createKudosTx`).
 */
export async function userIdsOfEmployeesTx(
  tx: TenantTx,
  companyId: string,
  employeeIds: readonly string[],
): Promise<string[]> {
  if (employeeIds.length === 0) return [];

  const rows = await tx
    .select({ userId: users.id })
    .from(employeeProfiles)
    .innerJoin(
      users,
      and(eq(users.id, employeeProfiles.userId), eq(users.companyId, employeeProfiles.companyId)),
    )
    .where(
      and(
        eq(employeeProfiles.companyId, companyId),
        inArray(employeeProfiles.id, [...employeeIds]),
        // (1) + (2) — vế nhân sự
        eq(employeeProfiles.status, "active"),
        isNull(employeeProfiles.deletedAt),
        // (3) + (4) — vế tài khoản
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );

  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Lọc tập `users.id` xuống những tài khoản CÒN HOẠT ĐỘNG — 2 vế (`status` + `deleted_at`).
 *
 * 🔴 **KHÔNG dùng `userIdsOfEmployeesTx` cho đường này.** Người nhận NOTI-032 là **tác giả bài**, và
 * tác giả được neo bằng `feed_posts.author_user_id` — một `users.id`. Đưa nó vào hàm nhận
 * `employee_id` là sai KIỂU (hai không gian uuid khác nhau): câu sẽ khớp 0 hàng và thông báo lặng lẽ
 * không đến ai — đúng kiểu hỏng câm mà cả file này dựng lên để chặn.
 *
 * ⚠️ Vì vào từ `users`, vị từ này KHÔNG biết gì về `employee_profiles.status` ⇒ nó **không** lọc được
 * người đã nghỉ mà tài khoản còn bật. Chấp nhận có chủ đích: tác giả một sáng kiến đang xét duyệt cần
 * biết kết quả, kể cả khi họ vừa nghỉ (bài của họ vẫn nằm đó). Muốn đổi thì đổi ở SPEC, không ở đây.
 */
export async function activeUserIdsTx(
  tx: TenantTx,
  companyId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        inArray(users.id, [...userIds]),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );

  return [...new Set(rows.map((r) => r.id))];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Đường ĐỌC — `047` · `048`
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Một dòng vinh danh của `047`, TRƯỚC khi ghép danh sách người nhận. */
export interface KudosListRow {
  kudosId: string;
  postId: string;
  message: string | null;
  isOfficial: boolean;
  badgeId: string | null;
  badgeCode: string | null;
  badgeName: string | null;
  badgeIcon: string | null;
  createdAt: Date;
}

/**
 * Một người được vinh danh, theo ĐÚNG hình dạng DTO của `047` (D12b).
 *
 * 🔴 **KHÔNG có `userId`** — ca `K-7`. Cùng luật với `feedPostAuthorSchema` (API-19 §6.1): phơi
 * `users.id` ra một danh sách công khai biến mọi màn vinh danh thành bản đồ user-id của cả công ty,
 * và đó là thứ duy nhất cần để dò các đường theo `{user_id}`.
 */
export interface KudosRecipientRow {
  kudosId: string;
  employeeId: string;
  fullName: string | null;
  avatarUrl: string | null;
  /**
   * Hồ sơ không còn `active` (nghỉ việc — S6) HOẶC hồ sơ/tài khoản đã xoá mềm (owner K1, BE-2D). FE
   * hiển thị nhãn, không đoán. Xem docblock `recipientsOfTx`.
   */
  isFormerEmployee: boolean;
}

/** Một huy hiệu của catalog `048`. */
export interface KudosBadgeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
}

@Injectable()
export class SocialKudosRepository {
  constructor(private readonly access: SocialAccessService) {}

  /**
   * `047` — vinh danh actor THẤY ĐƯỢC, phân trang OFFSET.
   *
   * Khuôn `listPollsTx`: `visiblePostCondition` NGAY TRONG CÂU (không resolve tập bài trước — đó là
   * TOCTOU và một lượt quét thừa) · `count(*) over ()` để `total` ở CÙNG ẢNH CHỤP với hàng · khoá
   * phá-hoà DUY NHẤT ở cuối `ORDER BY`.
   *
   * ⚠️ **Khoá phá-hoà là BẮT BUỘC, không phải trang trí**: `created_at` mặc định `now()` = mốc BẮT
   * ĐẦU transaction, nên mọi hàng tạo trong CÙNG một tx (seed/import) có `created_at` GIỐNG HỆT ⇒
   * OFFSET làm hàng LẶP hoặc MẤT giữa hai trang, không lỗi gì cả (API-19 §6.4).
   *
   * ┌─ BIÊN THÁNG TÍNH THEO MÚI GIỜ CÔNG TY, KHÔNG THEO UTC ─────────────────────────────────────────┐
   * │ `('2026-09' || '-01')::timestamp AT TIME ZONE <tz>` biến một mốc KHÔNG múi giờ thành đúng thời  │
   * │ điểm UTC của 00:00 ngày 1 tại công ty. Cắt bằng UTC thì ở VN (+07) một lời vinh danh đăng 03:00 │
   * │ ngày 1 rơi vào THÁNG TRƯỚC — sai hiển nhiên với người dùng, và không lỗi nào báo.               │
   * │ `tz` đọc bằng scalar subquery TRONG CÙNG CÂU (không `resolveCompanyTz` — hàm đó tự mở            │
   * │ `withTenant`, lồng vào đây là TREO IM LẶNG), fallback trùng DEFAULT của cột (`mig 0015`).        │
   * │ Hai biên là HẰNG với cả câu ⇒ index `idx_feed_kudos_company_created` vẫn dùng được (khác với    │
   * │ `to_char(created_at AT TIME ZONE tz)` — vế đó vô hiệu hoá index).                               │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async listKudosTx(
    tx: TenantTx,
    viewer: SocialViewerContext,
    opts: { month?: string; limit: number; offset: number },
  ): Promise<{ rows: KudosListRow[]; total: number }> {
    const where = [
      eq(feedKudos.companyId, viewer.companyId),
      this.access.visiblePostCondition(viewer),
    ];

    if (opts.month) {
      const tz = sql`COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ${viewer.companyId}), 'Asia/Ho_Chi_Minh')`;
      const start = sql`((${opts.month} || '-01')::timestamp AT TIME ZONE ${tz})`;
      where.push(sql`${feedKudos.createdAt} >= ${start}`);
      where.push(sql`${feedKudos.createdAt} < ${start} + interval '1 month'`);
    }

    const rows = await tx
      .select({
        kudosId: feedKudos.id,
        postId: feedKudos.postId,
        message: feedKudos.message,
        isOfficial: feedKudos.isOfficial,
        badgeId: feedKudos.badgeId,
        badgeCode: feedKudosBadges.code,
        badgeName: feedKudosBadges.name,
        badgeIcon: feedKudosBadges.icon,
        createdAt: feedKudos.createdAt,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(feedKudos)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedKudos.companyId), eq(feedPosts.id, feedKudos.postId)),
      )
      // LEFT JOIN: `badge_id` nullable, và huy hiệu ĐÃ TẮT vẫn phải hiện trên bài CŨ (lịch sử không
      // đổi khi catalog đổi). INNER JOIN ở đây làm bài mất khỏi danh sách khi admin tắt một huy hiệu.
      .leftJoin(
        feedKudosBadges,
        and(
          eq(feedKudosBadges.companyId, feedKudos.companyId),
          eq(feedKudosBadges.id, feedKudos.badgeId),
        ),
      )
      .where(and(...where))
      .orderBy(sql`${feedKudos.createdAt} DESC`, asc(feedKudos.id))
      .limit(opts.limit)
      .offset(opts.offset);

    const page = rows.map(({ total: _total, ...row }) => row);
    if (rows.length > 0) return { rows: page, total: rows[0].total };
    // Trang RỖNG: window function không có hàng để bám. `offset === 0` ⇒ tập thật sự rỗng (đường của
    // mọi tenant chưa có vinh danh nào — phải MIỄN PHÍ). Chỉ nhánh VƯỢT BIÊN mới tốn câu thứ hai, và
    // ở đó lệch ảnh chụp vô hại vì `data` đã rỗng.
    if (opts.offset === 0) return { rows: page, total: 0 };

    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedKudos)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedKudos.companyId), eq(feedPosts.id, feedKudos.postId)),
      )
      .where(and(...where));
    return { rows: page, total: Number(totalRow?.n ?? 0) };
  }

  /**
   * `048` — catalog huy hiệu ĐANG BẬT, phân trang OFFSET.
   *
   * `is_active = true` là HẰNG của route, không phải tham số: xem docblock `listKudosBadgesQuerySchema`.
   * `ORDER BY position, id` — `position` là `smallint NOT NULL` do seed đặt 1..5 và tenant sửa được
   * qua `050` (BE-3A), nên nó CÓ THỂ trùng ⇒ vẫn cần chốt cuối `id`.
   */
  async listBadgesTx(
    tx: TenantTx,
    companyId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ rows: KudosBadgeRow[]; total: number }> {
    const where = and(eq(feedKudosBadges.companyId, companyId), eq(feedKudosBadges.isActive, true));

    const rows = await tx
      .select({
        id: feedKudosBadges.id,
        code: feedKudosBadges.code,
        name: feedKudosBadges.name,
        description: feedKudosBadges.description,
        icon: feedKudosBadges.icon,
        position: feedKudosBadges.position,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(feedKudosBadges)
      .where(where)
      .orderBy(asc(feedKudosBadges.position), asc(feedKudosBadges.id))
      .limit(opts.limit)
      .offset(opts.offset);

    const page = rows.map(({ total: _total, ...row }) => row);
    if (rows.length > 0) return { rows: page, total: rows[0].total };
    if (opts.offset === 0) return { rows: page, total: 0 };

    const [totalRow] = await tx.select({ n: count() }).from(feedKudosBadges).where(where);
    return { rows: page, total: Number(totalRow?.n ?? 0) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  S16-SOCIAL-BE-2D — người nhận (MỘT luật cho `047` + thẻ bài) · khối vinh danh của thẻ · danh bạ `059`
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Người nhận của một LÔ vinh danh — MỘT câu cho cả lô (không N+1). Dùng CHUNG bởi `047`
 * (`SocialKudosService.list`) và khối `kudos` trên thẻ bài (`social-post-blocks.ts`) ⇒ một luật
 * hiển thị cho cả hai (owner K1, plan BE-2D D4). Hàm TỰ DO cùng tên với method cũ — khoá identity
 * ratchet `recipientsOfTx:users.fullName` giữ nguyên.
 *
 * ⚠️ Câu này KHÔNG tự gác tầm nhìn: `kudosIds` phải đến từ `listKudosTx` (câu mang
 * `visiblePostCondition`, CÙNG tx) HOẶC từ `kudosBlocksByPostIdsTx` trên `post_id` của hàng ĐÃ qua cổng
 * đọc bài. Đừng biến nó thành đường lấy người nhận theo id tuỳ ý — lớp lỗi
 * `reused-method-must-be-actor-scoped`.
 *
 * ┌─ 🔴 LUẬT HIỂN THỊ (owner K1 29/09/2026) ──────────────────────────────────────────────────────┐
 * │ Hồ sơ HOẶC tài khoản đã XOÁ MỀM ⇒ `fullName`/`avatarUrl` NULL + `isFormerEmployee` true. Che     │
 * │ TRONG SQL để danh tính của bản ghi đã xoá không rời DB. Trước BE-2D câu này không lọc           │
 * │ `deleted_at` nào — mà xoá mềm HR (`softDeleteEmployeeTx`) CHỈ đặt `deleted_at`, `status` vẫn    │
 * │ `active` ⇒ người đã bị xoá hiện tên + avatar như NHÂN VIÊN HIỆN TẠI.                            │
 * │ Nghỉ việc (`status <> 'active'`) ⇒ GIỮ tên + cờ (S6). TK khoá/treo ⇒ GIỮ tên (vinh danh là lịch │
 * │ sử; người nghỉ thường bị khoá TK). Không TK ⇒ `fullName` NULL (tên sống ở `users.full_name`).   │
 * │ KHÔNG bỏ người nào khỏi mảng — bỏ là FE không phân biệt «2 người» với «3 người, 1 bị xoá».       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export async function recipientsOfTx(
  tx: TenantTx,
  companyId: string,
  kudosIds: readonly string[],
): Promise<KudosRecipientRow[]> {
  if (kudosIds.length === 0) return [];

  // «Còn sống» — MỘT định nghĩa cho cả ba cột. LEFT JOIN `users`: không TK ⇒ `users.deleted_at` NULL
  // ⇒ vẫn «sống» (tên vốn NULL), đúng ca `K-4c`.
  const live = sql`(${employeeProfiles.deletedAt} IS NULL AND ${users.deletedAt} IS NULL)`;

  return (
    tx
      .select({
        kudosId: feedKudosRecipients.kudosId,
        employeeId: feedKudosRecipients.employeeId,
        // Tên người sống ở `users.fullName` — `employee_profiles` KHÔNG có cột tên (chỉ
        // `employee_code`). Chiếu `employee_code` thay tên là phơi mã nhân sự nội bộ ra một danh sách
        // công khai, và vẫn không cho người xem biết ai được vinh danh.
        fullName: sql<string | null>`CASE WHEN ${live} THEN ${users.fullName} END`,
        avatarUrl: sql<string | null>`CASE WHEN ${live} THEN ${employeeProfiles.avatarUrl} END`,
        isFormerEmployee:
          sql<boolean>`(NOT ${live} OR ${employeeProfiles.status} <> 'active')`.mapWith(Boolean),
      })
      .from(feedKudosRecipients)
      .innerJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.companyId, feedKudosRecipients.companyId),
          eq(employeeProfiles.id, feedKudosRecipients.employeeId),
        ),
      )
      // 🔴 LEFT JOIN, KHÔNG inner: `employee_profiles.user_id` nullable (mig `0442` — nhân sự tồn tại
      // TRƯỚC khi được gán tài khoản). INNER JOIN ở đây làm người nhận KHÔNG CÓ TÀI KHOẢN biến mất
      // khỏi `047` — bài vinh danh 3 người sẽ hiện 2, không lỗi gì cả (ca `K-4c`).
      .leftJoin(
        users,
        and(eq(users.id, employeeProfiles.userId), eq(users.companyId, employeeProfiles.companyId)),
      )
      .where(
        and(
          eq(feedKudosRecipients.companyId, companyId),
          inArray(feedKudosRecipients.kudosId, [...kudosIds]),
        ),
      )
      .orderBy(asc(feedKudosRecipients.employeeId))
  );
}

/** Hàng `feed_kudos` (+ huy hiệu LEFT JOIN) theo `post_id` — đầu vào khối `kudos` của thẻ bài. */
export interface KudosBlockRow {
  postId: string;
  kudosId: string;
  message: string | null;
  isOfficial: boolean;
  badgeId: string | null;
  badgeCode: string | null;
  badgeName: string | null;
  badgeIcon: string | null;
}

/**
 * Khối vinh danh cho một LÔ bài — MỘT câu (`feed_kudos_company_post_uq`), KHÔNG chiếu `users` (người
 * nhận đi qua `recipientsOfTx` — không thêm điểm danh tính).
 *
 * ⚠️ `postIds` phải là id của hàng ĐÃ qua cổng đọc bài (điều kiện của `decorate`). Câu KHÔNG tự gác
 * tầm nhìn — cùng luật `loadMentionsForTargets`.
 */
export async function kudosBlocksByPostIdsTx(
  tx: TenantTx,
  companyId: string,
  postIds: readonly string[],
): Promise<KudosBlockRow[]> {
  if (postIds.length === 0) return [];
  return (
    tx
      .select({
        postId: feedKudos.postId,
        kudosId: feedKudos.id,
        message: feedKudos.message,
        isOfficial: feedKudos.isOfficial,
        badgeId: feedKudos.badgeId,
        badgeCode: feedKudosBadges.code,
        badgeName: feedKudosBadges.name,
        badgeIcon: feedKudosBadges.icon,
      })
      .from(feedKudos)
      // LEFT JOIN — huy hiệu ĐÃ TẮT vẫn hiện trên bài cũ (D13 của BE-2B-2), `badge_id` nullable.
      .leftJoin(
        feedKudosBadges,
        and(
          eq(feedKudosBadges.companyId, feedKudos.companyId),
          eq(feedKudosBadges.id, feedKudos.badgeId),
        ),
      )
      .where(and(eq(feedKudos.companyId, companyId), inArray(feedKudos.postId, [...postIds])))
  );
}

/**
 * Huy hiệu hiển thị của một dòng vinh danh — MỘT luật cho `047` và thẻ bài (plan BE-2D §9 V9).
 *
 * `badgeId` có mà thiếu `code`/`name` là BẤT KHẢ (FK tổ hợp cùng tenant + app role không có DELETE
 * trên catalog) ⇒ `broken: true` để caller `logger.error` rồi bỏ huy hiệu — KHÔNG `?? ""` (một huy hiệu
 * không tên vẽ ra im lặng là thành công RỖNG).
 */
export function badgeRefOf(r: {
  badgeId: string | null;
  badgeCode: string | null;
  badgeName: string | null;
  badgeIcon: string | null;
}): { badge: FeedKudosBadgeRefDto | null; broken: boolean } {
  if (r.badgeId === null) return { badge: null, broken: false };
  if (r.badgeCode === null || r.badgeName === null) return { badge: null, broken: true };
  return {
    badge: { id: r.badgeId, code: r.badgeCode, name: r.badgeName, icon: r.badgeIcon },
    broken: false,
  };
}

/** Một người của danh bạ `059` — ĐÚNG ba cột, không `users.id`. */
export interface KudosRecipientCandidateRow {
  employeeId: string;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * Mọi chuỗi khoảng trắng (ASCII + Unicode) trong TÊN gộp thành MỘT dấu cách — `f_unaccent` GIỮ NGUYÊN
 * NBSP (đo PG 17), tên nhập từ Excel/HTML hay mang nó; không gộp thì «Đoàn␣Thị» không khớp `thi`
 * (plan §9 D-F11). Cùng tập với `\s` của JS mà Zod dùng gộp `q` (FULL gate DB LOW-2: bản đầu chỉ đổi
 * 4 ký tự ⇒ U+2000–U+200A/U+3000/xuống dòng trong tên làm trượt khớp đầu-từ). Truyền làm THAM SỐ.
 */
const NAME_WHITESPACE_RE = "[\\s   -     　﻿]+";

/**
 * `059` — danh bạ người nhận vinh danh (owner K2/K3, SOC-DEC-013).
 *
 * ┌─ 🔴 VÌ SAO `strpos`, KHÔNG `ILIKE` (plan BE-2D §9 V3) ───────────────────────────────────────────┐
 * │ `f_unaccent` biến `％ ＿ ＼ ﹪ ﹨` thành `% _ \` — tức ký tự đại diện LIKE sinh ra SAU mọi bước thoát │
 * │ phía JS (đo: `f_unaccent(U&'\FF05an')='%an'` ⇒ `％an` khớp «Tuấn»). `strpos` không có ký tự đại  │
 * │ diện nào ⇒ không thoát, không mệnh đề `ESCAPE`, không lớp lỗi đó.                              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Khớp **ĐẦU TỪ** (`' ' || tên` chứa `' ' || q`), bỏ dấu + chữ thường hai vế: «an» → «Nguyễn Văn An»,
 * KHÔNG → «Trần Tuấn». CHỈ trên họ tên — khớp email / mã nhân sự là oracle trên cột không trả về (vị
 * từ không bị identity ratchet đếm).
 *
 * «Đang làm» = hồ sơ `active` + chưa xoá mềm + TK `active` + chưa xoá mềm, `company_id` trên CẢ HAI
 * bảng (lưới thứ hai sau RLS). Loại chính người gọi (`users.id <> actor`). `LIMIT cap+1` để biết
 * `truncated`.
 *
 * Danh bạ cấp công ty là CÓ CHỦ ĐÍCH (owner K2) và KHÔNG chống được liệt kê (không throttler): trần
 * + min-2 chỉ là giới hạn UX/hiệu năng — xem verdict identity + SOC-DEC-013.
 */
export async function searchKudosRecipientsTx(
  tx: TenantTx,
  companyId: string,
  actorUserId: string,
  needle: string,
  opts: { limit: number; minLetters: number },
): Promise<KudosRecipientCandidateRow[]> {
  const normName = sql`regexp_replace(public.f_unaccent(${users.fullName}), ${NAME_WHITESPACE_RE}, ' ', 'g')`;
  const normNeedle = sql`lower(public.f_unaccent(${needle}))`;

  const rows = await tx
    .select({
      employeeId: employeeProfiles.id,
      fullName: users.fullName,
      avatarUrl: employeeProfiles.avatarUrl,
    })
    .from(employeeProfiles)
    .innerJoin(
      users,
      and(eq(users.id, employeeProfiles.userId), eq(users.companyId, employeeProfiles.companyId)),
    )
    .where(
      and(
        eq(employeeProfiles.companyId, companyId),
        eq(employeeProfiles.status, "active"),
        isNull(employeeProfiles.deletedAt),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        ne(users.id, actorUserId),
        isNotNull(users.fullName),
        // Lưới phụ (M10): needle co RỖNG sau `f_unaccent` ⇒ không khớp gì (Zod đã chặn ở biên).
        sql`length(btrim(public.f_unaccent(${needle}))) >= ${opts.minLetters}`,
        sql`strpos(' ' || lower(${normName}), ' ' || ${normNeedle}) > 0`,
      ),
    )
    .orderBy(sql`lower(${normName})`, asc(employeeProfiles.id))
    .limit(opts.limit + 1);

  // `isNotNull(users.fullName)` ở WHERE ⇒ không hàng nào null; chỉ thu hẹp kiểu, không đổi dữ liệu.
  return rows.filter((r): r is KudosRecipientCandidateRow => r.fullName !== null);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  S16-SOCIAL-BE-3A — CRUD catalog huy hiệu `049..051` + đọc quản trị `056` (hàm thuần nhận `tx`)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Mọi câu mang `company_id = $companyId` TƯỜNG MINH dù RLS + FORCE đã lọc: vế SQL là lưới thứ hai,
// và nó biến "uuid của tenant khác" thành 0 hàng ⇒ 404 cùng mã với "không tồn tại" (không lộ việc
// uuid đó CÓ THẬT ở công ty khác). Không hàm nào tự mở `withTenant` (lồng = treo im lặng).

/** Huy hiệu ở góc nhìn QUẢN TRỊ — hàng thô, service đổi `Date` → ISO. */
export interface KudosBadgeAdminRow extends KudosBadgeRow {
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Tập trường sửa được của `050` — `code` KHÔNG có mặt (bất biến, Zod `.strict()` đã chặn). */
export interface KudosBadgePatch {
  name?: string;
  description?: string | null;
  icon?: string | null;
  position?: number;
  isActive?: boolean;
}

const badgeAdminColumns = {
  id: feedKudosBadges.id,
  code: feedKudosBadges.code,
  name: feedKudosBadges.name,
  description: feedKudosBadges.description,
  icon: feedKudosBadges.icon,
  position: feedKudosBadges.position,
  isActive: feedKudosBadges.isActive,
  createdAt: feedKudosBadges.createdAt,
  updatedAt: feedKudosBadges.updatedAt,
};

const badgeOf = (companyId: string, badgeId: string) =>
  and(eq(feedKudosBadges.companyId, companyId), eq(feedKudosBadges.id, badgeId));

/**
 * `049` — INSERT một huy hiệu. Trùng `code` ném `23505` trên `feed_kudos_badges_company_code_uq`;
 * service dịch sang 409 bằng `isUniqueViolationOf` (theo TÊN constraint — bảng còn
 * `feed_kudos_badges_company_id_id_uq` cũng ném `23505`).
 */
export async function createBadgeTx(
  tx: TenantTx,
  companyId: string,
  actorUserId: string,
  dto: {
    code: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    position?: number;
  },
): Promise<KudosBadgeAdminRow> {
  const [row] = await tx
    .insert(feedKudosBadges)
    .values({
      companyId,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      position: dto.position ?? 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })
    .returning(badgeAdminColumns);
  return row;
}

/**
 * Đọc MỘT huy hiệu trong tenant. `forUpdate` ⇒ `SELECT … FOR UPDATE`: `050` so trạng thái cũ để
 * tính "trường THẬT SỰ đổi" rồi mới UPDATE — không khoá thì hai PATCH song song cùng đọc giá trị cũ
 * và audit ghi hai lần cùng một `from`.
 */
export async function findBadgeTx(
  tx: TenantTx,
  companyId: string,
  badgeId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<KudosBadgeAdminRow | undefined> {
  const q = tx.select(badgeAdminColumns).from(feedKudosBadges).where(badgeOf(companyId, badgeId));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row;
}

/** `050` — UPDATE các trường ĐÃ LỌC là thật sự đổi (caller bảo đảm `patch` không rỗng). */
export async function updateBadgeTx(
  tx: TenantTx,
  companyId: string,
  badgeId: string,
  actorUserId: string,
  patch: KudosBadgePatch,
): Promise<KudosBadgeAdminRow | undefined> {
  const [row] = await tx
    .update(feedKudosBadges)
    .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
    .where(badgeOf(companyId, badgeId))
    .returning(badgeAdminColumns);
  return row;
}

/**
 * `051` — "xoá" = TẮT (BẤT BIẾN #2; app role không có DELETE trên bảng này).
 *
 * Vế `is_active = true` là lưới KHÔNG-ĐIỀU-KIỆN của lượt gọi lặp: lượt hai khớp 0 hàng ⇒ `undefined`
 * ⇒ service phân biệt "đã tắt sẵn" (200, KHÔNG audit) với "không tồn tại" (404) bằng `findBadgeTx`.
 */
export async function deactivateBadgeTx(
  tx: TenantTx,
  companyId: string,
  badgeId: string,
  actorUserId: string,
): Promise<KudosBadgeAdminRow | undefined> {
  const [row] = await tx
    .update(feedKudosBadges)
    .set({ isActive: false, updatedAt: sql`now()`, updatedBy: actorUserId })
    .where(and(badgeOf(companyId, badgeId), eq(feedKudosBadges.isActive, true)))
    .returning(badgeAdminColumns);
  return row;
}

/**
 * `056` — CẢ huy hiệu đã tắt (SOC-DEC-012), OFFSET. Khuôn `listBadgesTx`: `count(*) over ()` cùng ảnh
 * chụp; `ORDER BY position, id` — `position` trùng được nên `id` là khoá phá-hoà BẮT BUỘC.
 */
export async function listBadgesAdminTx(
  tx: TenantTx,
  companyId: string,
  opts: { limit: number; offset: number },
): Promise<{ rows: KudosBadgeAdminRow[]; total: number }> {
  const where = eq(feedKudosBadges.companyId, companyId);

  const rows = await tx
    .select({ ...badgeAdminColumns, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(feedKudosBadges)
    .where(where)
    .orderBy(asc(feedKudosBadges.position), asc(feedKudosBadges.id))
    .limit(opts.limit)
    .offset(opts.offset);

  const page = rows.map(({ total: _total, ...row }) => row);
  if (rows.length > 0) return { rows: page, total: rows[0].total };
  if (opts.offset === 0) return { rows: page, total: 0 };

  const [totalRow] = await tx.select({ n: count() }).from(feedKudosBadges).where(where);
  return { rows: page, total: Number(totalRow?.n ?? 0) };
}
