import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { FeedBirthdayRangeDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedTags } from "../db/schema/social";
import { users } from "../db/schema/users";

/**
 * S16-SOCIAL-BE-1B — truy vấn của cụm KHÁM PHÁ (`SOCIAL-API-023`, `024`, `026`).
 *
 * `025` (trang cá nhân) KHÔNG ở đây: nó tái dùng NGUYÊN `SocialPostsRepository.listFeed` — xem C5 ở
 * `social-discovery.service.ts`. `023` (tìm kiếm) cũng đi qua `listFeed` với một vị từ toàn văn thêm
 * vào, để nó không có bản luật visibility thứ hai.
 *
 * 🔴 **HAI ĐIỂM CHIẾU DANH TÍNH MỚI** sống ở file này (`birthdays`) và ở `listFeed` (`search`). Cả
 * hai đều phải có mặt trong sổ `identity-projection-verdicts.ts` — đó là cổng chống "thêm một đường
 * chiếu tên người mà không ai biết".
 */
@Injectable()
export class SocialDiscoveryRepository {
  /**
   * `SOCIAL-API-024` — thẻ phổ biến. Phân trang OFFSET.
   *
   * KHÔNG chiếu danh tính nào: thẻ không thuộc về ai, và `feed_tags` chỉ có `(tag, usage_count)`.
   * Vì vậy route này cũng KHÔNG cần `visiblePostCondition` — nó không trả một bài nào.
   *
   * ⚠️ `usage_count` là bộ đếm TOÀN CÔNG TY, không theo phạm vi hiển thị của actor. Đó là chủ ý: nó
   * đo mức phổ biến của một TỪ KHOÁ, không tiết lộ bài nào. Người đọc thấy `#lương` được dùng 40 lần
   * không học được bài nào trong số đó — mọi đường mở bài vẫn đi qua `listFeed` với vị từ đầy đủ.
   */
  async listTags(
    tx: TenantTx,
    companyId: string,
    opts: { q?: string; page: number; limit: number },
  ): Promise<{ rows: TagRow[]; total: number }> {
    const where = and(
      eq(feedTags.companyId, companyId),
      // `LIKE` tiền tố trên chuỗi ĐÃ chuẩn hoá (service hạ chữ thường + bỏ `#`). Escape `%`/`_`/`\`
      // TRƯỚC khi ghép: không escape thì một `q` toàn `%` quét cả bảng và, tệ hơn, người dùng điều
      // khiển được hình dạng mẫu khớp.
      ...(opts.q ? [sql`${feedTags.tag} LIKE ${likePrefix(opts.q)} ESCAPE '\\'`] : []),
    );

    const [totalRow] = await tx.select({ n: count() }).from(feedTags).where(where);

    const rows = await tx
      .select({ tag: feedTags.tag, usageCount: feedTags.usageCount })
      .from(feedTags)
      .where(where)
      // Thứ tự ỔN ĐỊNH: phổ biến giảm dần, rồi CHÍNH thẻ (khoá duy nhất trong tenant) — thiếu vế thứ
      // hai thì hai thẻ cùng `usage_count` đổi chỗ được giữa hai lần lật trang OFFSET.
      .orderBy(desc(feedTags.usageCount), asc(feedTags.tag))
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    return { rows, total: Number(totalRow?.n ?? 0) };
  }

  /**
   * `SOCIAL-API-026` — widget sinh nhật. **ĐIỂM CHIẾU DANH TÍNH.**
   *
   * ┌─ VỊ TỪ THẬT CỦA ROUTE NÀY — ĐỌC TRƯỚC KHI SỬA ────────────────────────────────────────────────┐
   * │ `company_id` + nhân viên đang hoạt động + cửa sổ ngày/tháng. **KHÔNG** `visiblePostCondition`:  │
   * │ nó là vị từ của BÀI VIẾT, và ở đây không có bài nào — dán nó vào sẽ vừa vô nghĩa vừa làm người  │
   * │ đọc sau tưởng phạm vi đã được bao bởi luật audience của feed. Sàn quyền là cặp `view:feed` ở    │
   * │ tầng 1/2 và **không cặp HR nào** (SOC-DEC-007): đây là cửa sau tiềm năng vào PII của HR.        │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 **CHỈ `day`/`month` RỜI KHỎI SQL** — `date_of_birth` không bao giờ được `SELECT` nguyên cột.
   * Trích ngày/tháng NGAY TRONG SQL (`EXTRACT`), không kéo cả `date` về rồi format ở JS: một cột
   * `Date` về tới tầng service là một cột `Date` ai đó sẽ `JSON.stringify` nhầm, và done_when có hẳn
   * một ca grep regex năm `\b(19|20)\d{2}\b` trên TOÀN BỘ response để bắt đúng việc đó.
   *
   * Cờ `show_birthday` KHÔNG lọc ở đây: nó đi qua `getPreferencesForUsers` (hàm DUY NHẤT đọc
   * preference của NGƯỜI KHÁC — `social-preferences.ts`) ở tầng service. Lý do: một bản `JOIN
   * user_preferences` thứ hai ở đây là bản luật thứ hai cho cùng câu hỏi riêng tư.
   *
   * @returns kèm `userId` để service tra preference theo LÔ; `userId` **KHÔNG** ra tới DTO.
   */
  async birthdays(
    tx: TenantTx,
    companyId: string,
    range: FeedBirthdayRangeDto,
    today: Date,
  ): Promise<BirthdayRow[]> {
    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        userId: employeeProfiles.userId,
        fullName: users.fullName,
        avatar: employeeProfiles.avatarUrl,
        day: sql<number>`EXTRACT(DAY FROM ${employeeProfiles.dateOfBirth})::int`,
        month: sql<number>`EXTRACT(MONTH FROM ${employeeProfiles.dateOfBirth})::int`,
      })
      .from(employeeProfiles)
      // 🔴 Liveness của TÀI KHOẢN nằm ở điều kiện JOIN, không ở `where`: giữ `leftJoin` để nhân viên
      // CHƯA có tài khoản vẫn hiện (nhánh `r.userId == null` ở service), nhưng một tài khoản đã khoá
      // /xoá mềm thì không được kéo `full_name` ra. Khuôn: `social-mentions.ts:195-201` (BE-1).
      .leftJoin(
        users,
        and(
          eq(users.id, employeeProfiles.userId),
          eq(users.companyId, employeeProfiles.companyId),
          isNull(users.deletedAt),
          eq(users.status, "active"),
        ),
      )
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          isNull(employeeProfiles.deletedAt),
          // 🔴 NGƯỜI ĐÃ NGHỈ KHÔNG BỊ XOÁ MỀM (`hr-import.repository.ts:106` ·
          // `hr-write.service.ts:600-667`: off-board đặt `resigned`/`terminated` và GIỮ NGUYÊN hàng).
          // Thiếu vế này, widget phơi tên + avatar + ngày/tháng sinh của người đã nghỉ ra TOÀN công
          // ty — và họ không còn đường gỡ, vì cách tự ẩn duy nhất (`PATCH /me/preferences`) đòi một
          // phiên đăng nhập mà tài khoản đã khoá không có. Hàng rào thứ hai của waiver
          // (`identity-projection-verdicts.ts`) rỗng với đúng nhóm này nếu bỏ vế.
          eq(employeeProfiles.status, "active"),
          sql`${employeeProfiles.dateOfBirth} IS NOT NULL`,
          birthdayWindow(range, today),
        ),
      )
      // Thứ tự đọc được: tháng rồi ngày rồi id (ổn định). Widget không phân trang nên đây thuần
      // trình bày, nhưng thứ tự ngẫu nhiên làm ca test phải sort lại và che mất lỗi thật.
      .orderBy(
        sql`EXTRACT(MONTH FROM ${employeeProfiles.dateOfBirth})`,
        sql`EXTRACT(DAY FROM ${employeeProfiles.dateOfBirth})`,
        asc(employeeProfiles.id),
      );

    return rows as BirthdayRow[];
  }
}

export interface TagRow {
  tag: string;
  usageCount: number;
}

export interface BirthdayRow {
  employeeId: string;
  /** Khoá tra `user_preferences.show_birthday`. **KHÔNG ra DTO** (5 khoá đóng — SPEC-16 §3.5). */
  userId: string | null;
  fullName: string | null;
  avatar: string | null;
  day: number;
  month: number;
}

/**
 * Cửa sổ ngày sinh — so theo **(tháng, ngày)**, KHÔNG theo ngày đầy đủ: sinh nhật lặp lại hằng năm.
 *
 * `today` truyền VÀO (không `now()` trong SQL) để ca test ghim được một ngày cụ thể; múi giờ là múi
 * của server — SPEC-16 không khai múi giờ riêng cho widget này, và một widget "hôm nay" theo múi giờ
 * của từng người đọc là một quyết định sản phẩm chưa ai ký.
 *
 * `week` = 7 ngày TỚI tính từ hôm nay (không phải tuần lịch): «Tuần này» của widget là cửa sổ trượt —
 * đúng câu người dùng hỏi («ai sắp sinh nhật»), và nó không làm danh sách rỗng đột ngột vào Chủ nhật.
 * Cửa sổ 7 ngày có thể VẮT QUA giao thừa (28/12 → 3/1), nên vị từ phải so theo chuỗi `MM-DD` có thứ
 * tự và tách làm hai đoạn khi vắt năm — so bằng một phép trừ số ngày sẽ sai đúng ở khe đó.
 */
function birthdayWindow(range: FeedBirthdayRangeDto, today: Date) {
  const dob = employeeProfiles.dateOfBirth;
  const mmdd = sql`to_char(${dob}, 'MM-DD')`;

  if (range === "month") {
    return sql`EXTRACT(MONTH FROM ${dob}) = ${today.getMonth() + 1}`;
  }
  if (range === "today") {
    return sql`${mmdd} = ${mmddOf(today)}`;
  }

  const end = new Date(today.getTime());
  end.setDate(end.getDate() + 6);
  const from = mmddOf(today);
  const to = mmddOf(end);
  // Vắt qua giao thừa ⇒ hai đoạn (… → 12-31) ∪ (01-01 → …).
  return from <= to
    ? sql`${mmdd} BETWEEN ${from} AND ${to}`
    : sql`(${mmdd} >= ${from} OR ${mmdd} <= ${to})`;
}

function mmddOf(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Escape ký tự đặc biệt của `LIKE` rồi ghép `%` — người dùng KHÔNG điều khiển hình dạng mẫu khớp. */
function likePrefix(q: string): string {
  return `${q.replace(/([\\%_])/g, "\\$1")}%`;
}
