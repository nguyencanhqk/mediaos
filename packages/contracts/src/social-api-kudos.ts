import { z } from "zod";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";
import { feedKudosBlockSchema } from "./social-feed-blocks";

/**
 * S16-SOCIAL-BE-2B-2 — DTO của `SOCIAL-API-047..048` (VINH DANH · CATALOG HUY HIỆU).
 *
 * Nhánh `type='kudos'` của route `002` khai ở `createFeedPostSchema` (payload của `002`). Ba route
 * CRUD catalog `049..051` + `056` thuộc **BE-3A** — khối cuối file.
 *
 * 🔴 Luật nghiệp vụ ném Ở SERVICE, không ở Zod: huy hiệu không có/đã tắt (`SOCIAL-ERR-022`), người
 * nhận trùng tác giả, trần 10 người nhận, `isOfficial` thiếu `manage:feed-kudos`. Zod chỉ gác HÌNH
 * DẠNG.
 */

/**
 * Tháng cần xem, dạng `YYYY-MM`.
 *
 * ┌─ VÌ SAO MỘT TRƯỜNG `YYYY-MM`, KHÔNG PHẢI CẶP `month` + `year` ─────────────────────────────────┐
 * │ Cặp rời sinh ra bốn tổ hợp mà ba trong số đó phải tự đặt luật: chỉ `month`, chỉ `year`, cả hai, │
 * │ không cái nào. Luật chéo đó rơi vào `superRefine` ⇒ FE gửi thiếu một nửa nhận **400 vô danh**.  │
 * │ Một trường thì hoặc có hoặc không, và regex nói đủ nghĩa.                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Biên tháng tính theo **múi giờ CÔNG TY** (`companies.timezone`), không theo UTC — xem
 * `social-kudos.repository.ts#listKudosTx`. Lệch 7 giờ ở VN nghĩa là một lời vinh danh đăng 03:00
 * ngày 1 sẽ rơi vào tháng TRƯỚC nếu cắt biên bằng UTC.
 */
export const kudosMonthSchema = z
  .string()
  // 🔴 `(19|20)` chứ KHÔNG `\d{4}` — FULL gate `security-reviewer` MEDIUM-1, đo thật trên Postgres:
  //   SELECT ('0000-01' || '-01')::timestamp;  =>  ERROR 22008 date/time field value out of range
  // `\d{4}` nhận năm `0000`, chuỗi đó đi thẳng vào `::timestamp AT TIME ZONE …` của `listKudosTx` và
  // không call-site nào bắt ⇒ **500** cho một tham số query. Đúng lớp lỗi mà `IDEA_REJECT_NOTE_REQUIRED`
  // (D7) ra đời để chặn: hợp lệ với schema nhưng vỡ ở tầng DB. Chặn ở hợp đồng là chỗ RẺ nhất, và nó
  // không mất ca dùng nào — `feed_kudos` không có dữ liệu trước 1900.
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/, "tháng phải có dạng YYYY-MM (năm 1900–2099)");
export type KudosMonthDto = z.infer<typeof kudosMonthSchema>;

/** `047` — phân trang theo TRANG (API-19 §6.4). Vắng `month` = vinh danh GẦN ĐÂY (mới nhất trước). */
export const listKudosQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    month: kudosMonthSchema.optional(),
  })
  .strict();
export type ListKudosQueryDto = z.infer<typeof listKudosQuerySchema>;

/**
 * `048` — catalog huy hiệu ĐANG BẬT.
 *
 * ⚠️ KHÔNG có tham số `isActive`: route này trả đúng tập `is_active = true` và không nhận lệnh khác.
 * Mở một cờ cho phép xem huy hiệu đã tắt là mở một nửa của `049..051` (BE-3, cặp `manage:feed-kudos`)
 * qua một route chỉ gác `view:feed`.
 */
export const listKudosBadgesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(50),
  })
  .strict();
export type ListKudosBadgesQueryDto = z.infer<typeof listKudosBadgesQuerySchema>;

/**
 * S16-SOCIAL-FE-2C (plan D1) — một huy hiệu của catalog `048` ở góc nhìn NGƯỜI SOẠN: KHÔNG `isActive`
 * (route chỉ trả huy hiệu đang bật), không mốc giờ. Hình dạng = `KudosBadgeRow` của repo; neo kiểu ở
 * `SocialKudosService.listBadges` (owner ký O4) ⇒ BE lệch tên/nullability là TS đỏ lúc build.
 *
 * ⚠️ Đừng parse `048` bằng `kudosBadgeAdminSchema` — nó đòi `isActive/createdAt/updatedAt` ⇒ NÉM.
 * `icon`: tên icon lucide HOẶC emoji (DB-17) — FE vẽ qua map CỐ ĐỊNH, không tra cứu tự do.
 */
export const kudosBadgeSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  position: z.number().int(),
});
export type KudosBadgeDto = z.infer<typeof kudosBadgeSchema>;

export const kudosBadgePageSchema = z.object({
  data: z.array(kudosBadgeSchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});
export type KudosBadgePageDto = z.infer<typeof kudosBadgePageSchema>;

// ─────────── S16-SOCIAL-BE-3A — CRUD catalog huy hiệu `049..051` + đọc quản trị `056` ───────────
//
// Cả bốn route gác `manage:feed-kudos` (sàn Company). «Xoá» (`051`) = `is_active=false` — bảng không có
// `deleted_at` và app role KHÔNG có DELETE (BẤT BIẾN #2). Bật lại = `050 { isActive: true }` (D11).

/**
 * Trần độ dài — mirror cột `feed_kudos_badges` (`code varchar(32)` · `name varchar(255)` · `icon
 * varchar(64)` · `position smallint`). `description` là cột `text`: trần 1000 là trần SẢN PHẨM, không phải DB.
 */
export const KUDOS_BADGE_NAME_MAX = 255;
export const KUDOS_BADGE_DESCRIPTION_MAX = 1000;
export const KUDOS_BADGE_ICON_MAX = 64;
/** `smallint` dương: vượt trần phải là 400 ở Zod, KHÔNG 500 `22003` ở DB (ca K5). */
export const KUDOS_BADGE_POSITION_MAX = 32767;

/**
 * `code` — khoá tự nhiên per-company (`feed_kudos_badges_company_code_uq`), BẤT BIẾN sau khi tạo.
 * Chữ thường + số + gạch nối: nó đi vào URL/nhãn i18n ở FE, không phải văn bản tự do.
 */
export const kudosBadgeCodeSchema = z
  .string()
  .regex(/^[a-z0-9-]{2,32}$/, "code chỉ gồm a-z, 0-9, '-' và dài 2–32 ký tự");

const badgeName = z.string().trim().min(1).max(KUDOS_BADGE_NAME_MAX);
const badgeDescription = z.string().trim().max(KUDOS_BADGE_DESCRIPTION_MAX);
const badgeIcon = z.string().trim().max(KUDOS_BADGE_ICON_MAX);
const badgePosition = z.number().int().min(0).max(KUDOS_BADGE_POSITION_MAX);

/** `049` — `POST /social/kudos-badges`. Vắng `position` ⇒ 0. */
export const createKudosBadgeSchema = z
  .object({
    code: kudosBadgeCodeSchema,
    name: badgeName,
    description: badgeDescription.nullable().optional(),
    icon: badgeIcon.nullable().optional(),
    position: badgePosition.optional(),
  })
  .strict();
export type CreateKudosBadgeDto = z.infer<typeof createKudosBadgeSchema>;

/**
 * `050` — `PATCH /social/kudos-badges/{id}`. `.strict()` ⇒ gửi `code` là **400** (code BẤT BIẾN, ca
 * K4) chứ không bị lặng lẽ bỏ qua. Ít nhất một trường.
 */
export const updateKudosBadgeSchema = z
  .object({
    name: badgeName.optional(),
    description: badgeDescription.nullable().optional(),
    icon: badgeIcon.nullable().optional(),
    position: badgePosition.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "phải có ít nhất một trường cần đổi",
  });
export type UpdateKudosBadgeDto = z.infer<typeof updateKudosBadgeSchema>;

/** Huy hiệu ở góc nhìn QUẢN TRỊ (`049`/`050`/`056`) — khác `048`: có `isActive`. */
export const kudosBadgeAdminSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  position: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KudosBadgeAdminDto = z.infer<typeof kudosBadgeAdminSchema>;

/** `056` — `GET /social/kudos-badges/manage` (SOC-DEC-012): CẢ huy hiệu đã tắt; OFFSET. */
export const listKudosBadgesAdminQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(50),
  })
  .strict();
export type ListKudosBadgesAdminQueryDto = z.infer<typeof listKudosBadgesAdminQuerySchema>;

export const kudosBadgeAdminPageSchema = z.object({
  data: z.array(kudosBadgeAdminSchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});
export type KudosBadgeAdminPageDto = z.infer<typeof kudosBadgeAdminPageSchema>;

// ─────────── S16-SOCIAL-BE-2D — response `047` (có kiểu) + danh bạ người nhận `059` ───────────

/** Một dòng của `047` = khối vinh danh của thẻ bài + `postId` + `createdAt` (plan BE-2D D11). */
export const feedKudosListItemSchema = feedKudosBlockSchema.extend({
  postId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedKudosListItemDto = z.infer<typeof feedKudosListItemSchema>;

export const feedKudosPageSchema = z.object({
  data: z.array(feedKudosListItemSchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});
export type FeedKudosPageDto = z.infer<typeof feedKudosPageSchema>;

/**
 * Số người nhận của một lời vinh danh (`002` `type='kudos'`): 1..10 người KHÁC NHAU sau khi server
 * lowercase + khử trùng. Luật ở SERVICE (422 `SOCIAL-ERR-KUDOS-RECIPIENT-LIMIT`), Zod payload cố ý không
 * trần độ dài — đây là BẢN SAO cho FE chặn sớm (khuôn `POLL_OPTIONS_MAX`).
 *
 * ⚠️ Nguồn: `apps/api/src/social/social-post-types.ts` `KUDOS_RECIPIENT_MIN/MAX`. Không lưới tự động
 * bắt hai nơi lệch nhau — sửa một thì sửa cả hai.
 */
export const KUDOS_RECIPIENT_MIN = 1;
export const KUDOS_RECIPIENT_MAX = 10;

/** `059` — số chữ/số TỐI THIỂU của `q` (owner K2). Đếm `\p{L}`/`\p{N}`, KHÔNG đếm dấu tổ hợp. */
export const KUDOS_RECIPIENT_QUERY_MIN = 2;
/** `059` — trần độ dài `q` sau chuẩn hoá. */
export const KUDOS_RECIPIENT_QUERY_MAX = 100;
/** `059` — trần kết quả (owner K2). Không phân trang: hết trần thì gõ thêm, không lật trang. */
export const KUDOS_RECIPIENT_SEARCH_CAP = 20;

/**
 * Ký tự điều khiển (`\p{Cc}`) hoặc định dạng vô hình (`\p{Cf}` — zero-width, bidi). Tên người không
 * chứa chúng; NUL đi vào `f_unaccent` là **500** (đo ở CHAT, `chat.ts` `hasControlChar`).
 */
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/**
 * `059` — `GET /social/kudos/recipients?q=` (danh bạ cho ô chọn người nhận vinh danh; owner K2/K3).
 *
 * ┌─ 🔴 VÌ SAO ĐẾM CHỮ/SỐ, KHÔNG `min(2)` TRÊN ĐỘ DÀI ─────────────────────────────────────────────┐
 * │ Đo PG 17 (plan BE-2D M10): `f_unaccent(U&'\0301\0303')` dài **0** — chuỗi chỉ gồm dấu tổ hợp qua │
 * │ được `min(2)` rồi co thành RỖNG ở DB ⇒ khớp TẤT CẢ. Cùng lớp với `'%%'` qua `min(2)` của CHAT.  │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi phép biến đổi LUỸ ĐẲNG (NFC · gộp khoảng trắng · trim): `ZodValidationPipe` chạy HAI lần
 * (`main.ts` + `@UsePipes`). Server khớp bằng `strpos` (không LIKE) ⇒ `%`/`_` là ký tự thường, không
 * cần thoát. `.strict()`: không `page`/`limit` — tham số lật trang là đường vượt trần.
 */
export const kudosRecipientSearchQuerySchema = z
  .object({
    q: z
      .string()
      .transform((s) => s.normalize("NFC").replace(/\s+/gu, " ").trim())
      .pipe(
        z
          .string()
          .max(KUDOS_RECIPIENT_QUERY_MAX, `q tối đa ${KUDOS_RECIPIENT_QUERY_MAX} ký tự`)
          .refine((s) => !INVISIBLE_OR_CONTROL.test(s), { message: "q chứa ký tự không hợp lệ" })
          .refine((s) => (s.match(LETTER_OR_DIGIT)?.length ?? 0) >= KUDOS_RECIPIENT_QUERY_MIN, {
            message: `q phải có ít nhất ${KUDOS_RECIPIENT_QUERY_MIN} chữ hoặc số`,
          }),
      ),
  })
  .strict();
export type KudosRecipientSearchQueryDto = z.infer<typeof kudosRecipientSearchQuerySchema>;

/**
 * Một người trong danh bạ `059`. ĐÚNG ba khoá: **KHÔNG `userId`** (khoá tài khoản — cửa ĐỌC của oracle
 * mà SPEC-16 `ERR-009` đóng ở cửa ghi), không email / mã nhân sự / đơn vị. `employeeId` là thứ
 * `002` cần (`kudos.recipientEmployeeIds`). Chỉ người ĐANG làm (hồ sơ + tài khoản active) nên không có
 * `isFormerEmployee`. `avatarUrl` = URL ĐÃ KÝ hoặc `null` (chữ cái đầu) — xem `feedAuthorSchema`.
 */
export const kudosRecipientCandidateSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type KudosRecipientCandidateDto = z.infer<typeof kudosRecipientCandidateSchema>;

/** `truncated` = còn người khớp ngoài trần ⇒ FE nhắc «gõ thêm để thu hẹp». */
export const kudosRecipientSearchResultSchema = z.object({
  data: z.array(kudosRecipientCandidateSchema),
  truncated: z.boolean(),
});
export type KudosRecipientSearchResultDto = z.infer<typeof kudosRecipientSearchResultSchema>;
