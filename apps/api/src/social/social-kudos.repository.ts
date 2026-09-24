import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedKudos, feedKudosBadges, feedKudosRecipients, feedPosts } from "../db/schema/social";
import { users } from "../db/schema/users";
import { SocialAccessService } from "./social-access.service";
import { SOCIAL_ERR } from "./social.errors";
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

  if (!row) throw new UnprocessableEntityException(SOCIAL_ERR.KUDOS_BADGE_INVALID);
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
    throw new UnprocessableEntityException(SOCIAL_ERR.KUDOS_RECIPIENT_INVALID);
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
  /** `employee_profiles.status <> 'active'` — người đã nghỉ (S6). FE hiển thị nhãn, không đoán. */
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
   * Người nhận của một LÔ vinh danh — MỘT câu cho cả trang (không N+1).
   *
   * ⚠️ Câu này KHÔNG tự gác tầm nhìn: nó lọc theo `kudosId` mà caller VỪA đọc được từ `listKudosTx`
   * (câu đã mang `visiblePostCondition`). Đừng biến nó thành đường lấy người nhận theo id tuỳ ý — đó
   * là lớp lỗi `reused-method-must-be-actor-scoped`.
   *
   * `isFormerEmployee` suy từ `status <> 'active'`, KHÔNG từ `deleted_at`: nghỉ việc không xoá mềm.
   */
  async recipientsOfTx(
    tx: TenantTx,
    companyId: string,
    kudosIds: readonly string[],
  ): Promise<KudosRecipientRow[]> {
    if (kudosIds.length === 0) return [];

    return (
      tx
        .select({
          kudosId: feedKudosRecipients.kudosId,
          employeeId: feedKudosRecipients.employeeId,
          // Tên người sống ở `users.fullName` — `employee_profiles` KHÔNG có cột tên (chỉ
          // `employee_code`). Chiếu `employee_code` thay tên là phơi mã nhân sự nội bộ ra một danh sách
          // công khai, và vẫn không cho người xem biết ai được vinh danh.
          fullName: users.fullName,
          avatarUrl: employeeProfiles.avatarUrl,
          isFormerEmployee: sql<boolean>`(${employeeProfiles.status} <> 'active')`.mapWith(Boolean),
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
        // khỏi `047` — bài vinh danh 3 người sẽ hiện 2, không lỗi gì cả. `fullName` null ⇒ FE hiển thị
        // nhãn thay thế; ca `K-4c` đo đúng chỗ này.
        .leftJoin(
          users,
          and(
            eq(users.id, employeeProfiles.userId),
            eq(users.companyId, employeeProfiles.companyId),
          ),
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

  /**
   * `048` — catalog huy hiệu ĐANG BẬT, phân trang OFFSET.
   *
   * `is_active = true` là HẰNG của route, không phải tham số: xem docblock `listKudosBadgesQuerySchema`.
   * `ORDER BY position, id` — `position` là `smallint NOT NULL` do seed đặt 1..5 và tenant sửa được
   * qua BE-3, nên nó CÓ THỂ trùng ⇒ vẫn cần chốt cuối `id`.
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
