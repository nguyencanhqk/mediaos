import { and, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { userPreferences } from "../db/schema/user-preferences";

/**
 * S16-SOCIAL-BE-1 (plan §2 D20) — đường đọc `user_preferences` của **NHIỀU NGƯỜI**, DUY NHẤT MỘT HÀM.
 *
 * ┌─ VÌ SAO PHẢI LÀ MỘT HÀM, VÀ VÌ SAO NÓ NẰM Ở BE-1 DÙ BE-1 CHƯA DÙNG ────────────────────────────┐
 * │ `user-preferences.ts:18-19` ghi thẳng: **«CROSS-USER KHÔNG DO RLS»** — policy chỉ cô lập TENANT. │
 * │ Chống đọc preference của người khác là việc của TẦNG APP, và mọi module trước đây chỉ đọc        │
 * │ preference của CHÍNH actor (`WHERE user_id = token-resolved`). SOCIAL là module đầu tiên cần đọc │
 * │ preference của NGƯỜI KHÁC (widget sinh nhật phải biết ai đã tự ẩn) — tức lần đầu tiên vế         │
 * │ `user_id = <chính mình>` bị gỡ bỏ một cách hợp lệ.                                               │
 * │ Khi vế đó gỡ được, nó phải gỡ ở ĐÚNG MỘT CHỖ. Hai đường đọc là hai chỗ để quên ép `company_id`,  │
 * │ và một lần quên = rò preference riêng tư của cả công ty.                                         │
 * │ ⇒ Hàm dựng ở BE-1 (hạ tầng chung), dùng THẬT ở BE-1B (route `026`). Đừng xoá vì "chưa ai gọi".   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **TẬP CỘT TƯỜNG MINH, KHÔNG `select()` TRẦN** (DB-17 §11 R6). Bảng này có `locale`/`timezone`/
 * `theme`/`meLayoutConfig`… — không có lý do gì để một truy vấn của SOCIAL kéo về bố cục màn hình ME
 * của người khác. Thêm cột vào tập dưới đây là một quyết định, không phải một tiện tay.
 *
 * ┌─ 🔴 DRIFT SPEC↔DB ĐÃ ĐO (21/09/2026) — NỢ CỦA `S16-SOCIAL-BE-1B` ──────────────────────────────┐
 * │ SPEC-16 §3.5 + SOC-DEC-007 chốt nhân viên tự ẩn sinh nhật bằng                                  │
 * │ **`user_preferences.feed.showBirthday = false`**. Đo thật trên `schema/user-preferences.ts:24-63`│
 * │ (và grep toàn bộ `apps/api/src/db/schema/*.ts`): **KHÔNG có cột `feed`**, không có               │
 * │ `show_birthday`, và không jsonb nào mang ngữ nghĩa đó — `me_layout_config` là bố cục màn ME.     │
 * │ ⇒ Trường SPEC hứa CHƯA TỒN TẠI. BE-1B phải mở migration thêm chỗ chứa nó TRƯỚC khi làm route     │
 * │ `026`, KHÔNG được "tạm đọc `me_layout_config`" (nhét ngữ nghĩa SOCIAL vào ô của module khác là   │
 * │ cách chắc chắn để một lần dọn ME sau này xoá mất cờ riêng tư).                                   │
 * │ Hàm dưới đây vì vậy CHƯA trả `showBirthday`: trả một cờ luôn `true` từ hư không sẽ là **fail-    │
 * │ OPEN có vẻ ngoài hoàn chỉnh** — route `026` sẽ hiện sinh nhật của mọi người và mọi ca test       │
 * │ «người đã ẩn không xuất hiện» sẽ xanh giả vì không ai ẩn được.                                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Tập cột SOCIAL được phép đọc của NGƯỜI KHÁC. Hẹp có chủ ý — xem docblock. */
export interface SocialUserPreference {
  userId: string;
  locale: string | null;
  timezone: string | null;
}

/**
 * Đọc preference của một LÔ user — **ĐÚNG MỘT truy vấn** cho cả lô, không một truy vấn mỗi người.
 *
 * `company_id` ép TƯỜNG MINH bên cạnh RLS (belt-and-suspenders): đây chính là đường mà vế
 * `user_id = <chính mình>` đã được gỡ, nên vế tenant là hàng rào còn lại duy nhất.
 *
 * `inArray` (KHÔNG `sql`…= ANY(${ids})`): drizzle bind mảng JS vào một fragment `sql` THÔ mà
 * không ép kiểu, và Postgres từ chối `= ANY($1)` khi $1 là một mảng chưa biết kiểu — lỗi chỉ hiện
 * lúc CHẠY THẬT, typecheck không bắt.
 *
 * @returns Map theo `userId`. Người CHƯA có hàng preference vắng mặt trong Map — caller tự quyết
 *   định mặc định. KHÔNG tự điền hàng giả: "không có cấu hình" và "cấu hình mặc định" là hai việc
 *   khác nhau, và gộp chúng ở đây sẽ giấu mất việc thứ nhất khỏi mọi caller.
 */
export async function getPreferencesForUsers(
  tx: TenantTx,
  companyId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, SocialUserPreference>> {
  const out = new Map<string, SocialUserPreference>();
  if (userIds.length === 0) return out;

  const rows = await tx
    .select({
      userId: userPreferences.userId,
      locale: userPreferences.locale,
      timezone: userPreferences.timezone,
    })
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.companyId, companyId),
        inArray(userPreferences.userId, [...userIds]),
      ),
    );

  for (const row of rows) out.set(row.userId, row);
  return out;
}
