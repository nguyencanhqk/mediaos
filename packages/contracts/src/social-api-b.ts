import { z } from "zod";
import {
  feedPostStatusSchema,
  feedReportReasonSchema,
  feedReportStatusSchema,
  feedTargetTypeSchema,
} from "./social";
import { FEED_NOTE_MAX, FEED_PAGE_LIMIT_MAX, feedPostSchema } from "./social-api";

/**
 * S16-SOCIAL-BE-1B — DTO request/response của **Nhóm B** (10 route `SOCIAL-API-020..029`).
 *
 * TÁCH KHỎI `./social-api` theo CÙNG luật đã tách `./social-api` khỏi `./social`: file này import
 * NGƯỢC (`feedPostSchema`, hằng trần) và **KHÔNG re-export** tên nào của hai file kia — trùng tên ở
 * hai star-export là lỗi mơ hồ lúc build.
 *
 * Lý do tách, đo thật: `social-api.ts` đang 459 dòng; nhồi ~360 dòng DTO Nhóm B vào đó đẩy nó lên
 * **820 dòng — VƯỢT trần 800** của CLAUDE.md §5, và BE-2 còn 24 route nữa chưa có chỗ. Không cổng nào
 * ép trần đó tự động (memory `file-over-800-has-no-gate`), nên nó phải được giữ bằng tay, đúng lúc.
 *
 * Luật hình dạng giữ nguyên Nhóm A: DTO ghi là **allowlist `z.object({…}).strict()`** (chống
 * mass-assignment — trường do SERVER quyết định không có tên trong bất kỳ DTO ghi nào); DTO đọc
 * KHÔNG chở `userId` (danh tính = `employeeId` + tên + avatar).
 */
/** UUID — bản sao CỤC BỘ của helper cùng tên ở `./social-api` (ở đó nó là `const` nội bộ, không export). */
const uuid = () => z.string().uuid();

/**
 * Trần `limit` của các danh sách phân trang **OFFSET** (022 acks · 024 thẻ · 028 hàng đợi báo cáo).
 *
 * Ba danh sách đó là màn QUẢN TRỊ/đối soát, nơi người dùng cần nhảy trang và thấy TỔNG — đúng ngoại lệ
 * mà SPEC-16 NFR chừa cho offset. Dòng cuộn (020/023/025) vẫn keyset như Nhóm A: hai cơ chế cho hai
 * câu hỏi khác nhau, KHÔNG phải hai cách làm cùng một việc.
 */
export const FEED_ADMIN_PAGE_LIMIT_MAX = 100;

/**
 * Trần SỐ TRANG của ba danh sách OFFSET ấy (gate 22/09).
 *
 * `page` không trần ⇒ `page=50000000` sinh `OFFSET 2.5e9`: PostgreSQL vẫn phải đếm qua từng hàng bị
 * bỏ, nên một request hợp lệ về hình thức quét sạch bảng của tenant. 10 000 trang × trần 100 hàng =
 * 1 000 000 hàng — xa hơn mọi màn đối soát thật, và vượt quá thì câu trả lời đúng là 400 (lỗi đầu
 * vào), không phải một câu truy vấn đắt.
 */
export const FEED_PAGE_MAX = 10_000;

/** Trần trích đoạn nội dung đích trong hàng đợi kiểm duyệt (D13) — đủ để quyết định, không phải bản sao bài. */
export const FEED_REPORT_EXCERPT_MAX = 200;

/** Trần từ khoá tìm kiếm (023) — chặn chuỗi khổng lồ trước khi dựng `tsquery`. */
export const FEED_SEARCH_QUERY_MAX = 200;

/**
 * Cờ boolean đến từ QUERY-STRING (khuôn `asset.ts#queryBoolSchema`).
 *
 * ⚠️ `z.preprocess`, **KHÔNG** `z.coerce.boolean()`: `z.coerce.boolean("false")` = `true` (chuỗi
 * không rỗng là truthy) — `unackedOnly=false` sẽ BẬT bộ lọc, đúng chiều nguy hiểm. Và pipe Zod chạy
 * HAI lần ở Nest (global + method), nên lần hai nhận boolean THẬT ⇒ preprocess phải trả nguyên
 * boolean để idempotent (memory `zod-query-param-double-pipe-idempotent`).
 */
const feedQueryBool = () =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return v;
  }, z.boolean());

// ─────────────────────── 020-022 · Tin tức + xác nhận đã đọc ───────────────────────

/**
 * `SOCIAL-API-020` — `GET /social/news`.
 *
 * `sort` KHÔNG có mặt: tin tức luôn sắp theo «Hoạt động mới» + ghim lên đầu (API-19 §5.1). Cho FE chọn
 * `sort=latest` ở đây sẽ đẩy bài ghim xuống giữa dòng — trả lời một câu hỏi khác câu màn hình đang hỏi.
 */
export const listNewsQuerySchema = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
    /** Chỉ tin `requires_ack` mà actor CHƯA xác nhận (nguồn widget `SOCIAL-WIDGET-002`). */
    unackedOnly: feedQueryBool().optional(),
    /** Chỉ cần CON SỐ (huy hiệu trên chuông) — `data` rỗng, `nextCursor` null, `unackedCount` có giá trị. */
    countOnly: feedQueryBool().optional(),
  })
  .strict();
export type ListNewsQueryDto = z.infer<typeof listNewsQuerySchema>;

/** Một tin tức trên danh sách `020` — thẻ bài đầy đủ + cờ «tôi đã xác nhận đọc». */
export const feedNewsItemSchema = feedPostSchema.extend({
  /**
   * Projection THEO ACTOR (lấy theo LÔ, một truy vấn cho cả trang — khuôn `savedByMe`).
   *
   * Luôn có mặt, kể cả với tin `requiresAck=false` (khi đó luôn `false`): một khoá khi-có-khi-không
   * buộc FE kiểm `undefined` và biến "chưa đọc" với "bài không cần đọc" thành cùng một giá trị falsy.
   */
  ackedByMe: z.boolean(),
});
export type FeedNewsItemDto = z.infer<typeof feedNewsItemSchema>;

/**
 * Trang tin tức. MỘT hình dạng cho cả hai chế độ (`countOnly` hay không) — không phải union.
 *
 * `unackedCount` chỉ có giá trị khi caller hỏi `countOnly=true`; ngoài ra là `null`. `null` ở đây nghĩa
 * là **"không hỏi"**, KHÔNG phải "bằng 0" — FE hiện huy hiệu theo `unackedCount ?? 0` đúng ở cả hai
 * nhánh, còn một union hai hình dạng thì mọi call-site phải rẽ nhánh kiểu.
 */
export const feedNewsPageSchema = z.object({
  data: z.array(feedNewsItemSchema),
  nextCursor: z.string().nullable(),
  unackedCount: z.number().int().nonnegative().nullable(),
});
export type FeedNewsPageDto = z.infer<typeof feedNewsPageSchema>;

/**
 * `SOCIAL-API-021` — phản hồi `POST /social/posts/{id}/ack`.
 *
 * ⚠️ KHÔNG có `userId` trong REQUEST lẫn RESPONSE: server LUÔN dùng `actor.id` (done_when: «body không
 * nhận trường userId»). Route này không có DTO body — mọi trường gửi lên đều thừa.
 *
 * `firstTime=false` = đã xác nhận từ trước (`ON CONFLICT DO NOTHING`), vẫn 200. `feed_post_acks` là sổ
 * **APPEND-ONLY** (app role chỉ SELECT+INSERT) — không có đường rút lại, nên không có route huỷ ack.
 */
export const feedAckResultSchema = z
  .object({
    postId: uuid(),
    ackedAt: z.string().datetime({ offset: true }),
    firstTime: z.boolean(),
  })
  .strict();
export type FeedAckResultDto = z.infer<typeof feedAckResultSchema>;

/**
 * `SOCIAL-API-022` — `GET /social/posts/{id}/acks`.
 *
 * `state` chọn NỬA nào của danh sách, và cả hai nửa dùng CÙNG một hình dạng trang (offset) — thay vì
 * trả hai mảng trong một response: nửa «chưa đọc» có thể là TOÀN BỘ công ty, và nhét nó vào chung một
 * payload với nửa «đã đọc» thì không nửa nào phân trang được.
 */
export const listPostAcksQuerySchema = z
  .object({
    state: z.enum(["acked", "unacked"]).default("acked"),
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(50),
  })
  .strict();
export type ListPostAcksQueryDto = z.infer<typeof listPostAcksQuerySchema>;

/** Một người trong danh sách đã/chưa xác nhận đọc. `ackedAt` null ⇔ thuộc nửa «chưa đọc». */
export const feedAckPersonSchema = z.object({
  employeeId: uuid().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  ackedAt: z.string().datetime({ offset: true }).nullable(),
});
export type FeedAckPersonDto = z.infer<typeof feedAckPersonSchema>;

/** Trang offset — `total` là TỔNG của NỬA đang hỏi (`state`), không phải tổng audience. */
export const feedAckPageSchema = z.object({
  data: z.array(feedAckPersonSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FeedAckPageDto = z.infer<typeof feedAckPageSchema>;

// ────────────────── 023-026 · Tìm kiếm · thẻ · trang cá nhân · sinh nhật ──────────────────

/**
 * `SOCIAL-API-023` — `GET /social/search`. Trả `feedPostPageSchema` (CÙNG thẻ bài của dòng cuộn).
 *
 * Phân trang KEYSET như `001`, KHÔNG xếp theo điểm `ts_rank`: trộn ranking vào keyset cần một cột mốc
 * ổn định mà điểm số không có (điểm đổi khi bài được sửa ⇒ hàng nhảy trang). Kết quả vì vậy sắp theo
 * «Hoạt động mới», giống mọi danh sách bài khác của module.
 */
export const searchFeedQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(FEED_SEARCH_QUERY_MAX),
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type SearchFeedQueryDto = z.infer<typeof searchFeedQuerySchema>;

/** `SOCIAL-API-024` — `GET /social/tags`. `q` = tiền tố gợi ý cho ô soạn thảo. */
export const listTagsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type ListTagsQueryDto = z.infer<typeof listTagsQuerySchema>;

/** Một thẻ + số lần dùng. KHÔNG chiếu danh tính nào — thẻ không thuộc về ai. */
export const feedTagItemSchema = z.object({
  tag: z.string(),
  usageCount: z.number().int().nonnegative(),
});
export type FeedTagItemDto = z.infer<typeof feedTagItemSchema>;

export const feedTagPageSchema = z.object({
  data: z.array(feedTagItemSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FeedTagPageDto = z.infer<typeof feedTagPageSchema>;

/** `SOCIAL-API-025` — `GET /social/profiles/{employee_id}/posts`. Trả `feedPostPageSchema`. */
export const listProfilePostsQuerySchema = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type ListProfilePostsQueryDto = z.infer<typeof listProfilePostsQuerySchema>;

/** `SOCIAL-API-026` — cửa sổ của widget sinh nhật (SOC-DEC-007 «Hôm nay / Tuần này / Tháng này»). */
export const feedBirthdayRangeSchema = z.enum(["today", "week", "month"]);
export type FeedBirthdayRangeDto = z.infer<typeof feedBirthdayRangeSchema>;

export const listBirthdaysQuerySchema = z
  .object({ range: feedBirthdayRangeSchema.default("today") })
  .strict();
export type ListBirthdaysQueryDto = z.infer<typeof listBirthdaysQuerySchema>;

/**
 * `SOCIAL-API-026` — MỘT dòng sinh nhật.
 *
 * 🔴 **ĐÚNG 5 KHOÁ, KHÔNG HƠN** (SPEC-16 §3.5 nguyên văn: «DTO **chỉ** chở
 * `{employeeId, fullName, avatar, day, month}`»; done_when đòi `Object.keys(item)` BẰNG ĐÚNG tập đó).
 * Widget này là **cửa sau tiềm năng vào PII của HR** — gate chỉ là `view:feed`, không cặp HR nào.
 * KHÔNG năm sinh, KHÔNG tuổi, KHÔNG `date_of_birth` đầy đủ, KHÔNG `userId`.
 *
 * ⚠️ Khoá là `avatar` (KHÔNG `avatarUrl` như phần còn lại của module) vì SPEC-16 §3.5 + SOC-DEC-007 +
 * `done_when` viết đúng chữ đó, và ca test khoá bằng `toEqual` trên tập khoá. Lệch tên là ĐỎ.
 */
export const feedBirthdaySchema = z
  .object({
    employeeId: uuid(),
    fullName: z.string().nullable(),
    avatar: z.string().nullable(),
    /** 1-31. Số nguyên chứ KHÔNG chuỗi ngày — một chuỗi `'2001-03-14'` lọt ra là rò năm sinh. */
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
  })
  .strict();
export type FeedBirthdayDto = z.infer<typeof feedBirthdaySchema>;

export const feedBirthdayListSchema = z.object({
  data: z.array(feedBirthdaySchema),
});
export type FeedBirthdayListDto = z.infer<typeof feedBirthdayListSchema>;

// ─────────────────────── 027-029 · Báo cáo vi phạm ───────────────────────

/**
 * `SOCIAL-API-027` — `POST /social/reports`. Allowlist 4 trường.
 *
 * `reporterUserId`/`status`/`resolvedBy`/`resolvedAt` KHÔNG có tên ở đây ⇒ `.strict()` từ chối 400:
 * người báo cáo LUÔN là `actor.id` và trạng thái LUÔN bắt đầu ở `open`.
 */
export const createFeedReportSchema = z
  .object({
    targetType: feedTargetTypeSchema,
    targetId: uuid(),
    reason: feedReportReasonSchema,
    note: z.string().trim().max(FEED_NOTE_MAX).optional(),
  })
  .strict();
export type CreateFeedReportDto = z.infer<typeof createFeedReportSchema>;

/** `SOCIAL-API-028` — `GET /social/reports` (hàng đợi kiểm duyệt, phân trang OFFSET). */
export const listFeedReportsQuerySchema = z
  .object({
    status: feedReportStatusSchema.optional(),
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type ListFeedReportsQueryDto = z.infer<typeof listFeedReportsQuerySchema>;

/**
 * `SOCIAL-API-029` — `PATCH /social/reports/{id}`.
 *
 * `status` KHÔNG nhận `'open'`: đây là route KẾT THÚC một báo cáo, không phải route mở lại. Mở lại là
 * một quyết định nghiệp vụ khác và SPEC-16 không có nó — nhận `'open'` ở đây sẽ tạo một đường mở lại
 * mà `chk_feed_reports_resolved_pair` không đỡ (nó chỉ ép chiều «đã xử lý ⇒ có người + có mốc»).
 */
export const resolveFeedReportSchema = z
  .object({
    status: z.enum(["resolved", "dismissed"]),
    resolutionNote: z.string().trim().max(FEED_NOTE_MAX).optional(),
  })
  .strict();
export type ResolveFeedReportDto = z.infer<typeof resolveFeedReportSchema>;

/** Danh tính một người trong DTO báo cáo — CÙNG hình dạng `feedAuthorSchema`, KHÔNG `userId`. */
export const feedReportPersonSchema = z.object({
  employeeId: uuid().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type FeedReportPersonDto = z.infer<typeof feedReportPersonSchema>;

/**
 * Ảnh chụp NỘI DUNG BỊ BÁO CÁO (D13 / H4-ii, cần chữ ký owner ở PR).
 *
 * 🔴 **ĐỌC XUYÊN CỔNG `visiblePostCondition` — BYPASS CÓ CHỦ Ý, KHÔNG PHẢI QUÊN GỌI ASSERT.**
 * Hàng đợi kiểm duyệt phải xem được nội dung **dù nó đã bị ẩn hoặc xoá mềm** thì mới ra quyết định
 * được; che nó đi biến hàng đợi thành một danh sách id vô nghĩa. Bù lại, ba ràng buộc giữ bypass này
 * không biến thành lỗ đọc bất kỳ bài nào trong tenant:
 *   1. Actor đã qua cặp quyền RIÊNG `view:feed-report`/`manage:feed-report` — cao hơn `view:feed`.
 *   2. Snapshot là một **JOIN nằm trong CHÍNH câu đã lọc scope** (D13-R). KHÔNG tồn tại hàm public
 *      nhận `(targetType, targetId)` rời — thêm một call-site như thế là biến nó thành "đọc bất kỳ
 *      bài nào trong tenant, xuyên mọi vị từ".
 *   3. `target_id` lấy từ CHÍNH hàng `feed_reports` vừa qua vị từ Department (D6), không bao giờ từ
 *      tham số caller.
 * `status`/`deletedAt` có mặt để UI đánh dấu «[đã ẩn]»/«[đã xoá]» thay vì che nội dung.
 */
export const feedReportTargetSnapshotSchema = z.object({
  postId: uuid(),
  authorEmployeeId: uuid().nullable(),
  authorFullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** Trích đoạn ≤200 ký tự — đủ để quyết định, KHÔNG phải bản sao bài. */
  bodyExcerpt: z.string().nullable(),
  status: feedPostStatusSchema,
  deletedAt: z.string().datetime({ offset: true }).nullable(),
});
export type FeedReportTargetSnapshotDto = z.infer<typeof feedReportTargetSnapshotSchema>;

/**
 * DTO báo cáo (`028`/`029`) — **tập khoá ĐÓNG**, ca `H5-keys` assert bằng `toEqual` chứ không
 * `toMatchObject`: DTO này chở danh tính người tố giác + trích đoạn nội dung, nên một cột thừa lọt vào
 * sẽ VÔ HÌNH dưới assert lỏng.
 *
 * ⚠️ `resolvedBy`/`resolvedAt`/`resolutionNote` **LUÔN CÓ MẶT, nullable** — KHÔNG `.optional()`:
 * khoá khi-có-khi-không làm chính `toEqual` ở trên thành ngẫu nhiên theo dữ liệu.
 *
 * ⚠️ **`reporter` là `null` khi người đọc ở scope HẸP HƠN `Company`** — D13-a, owner ký 22/09/2026.
 *
 * (Chính xác: lộ khi `SocialAccessService.isCompany(routeScope)`, tức `Company` HOẶC `System`.)
 *
 * SPEC-16 không có điều khoản báo cáo ẩn danh (khác poll, nơi SOC-DEC-009 MINH THỊ ẩn danh), nên
 * vị trí này phải tự chốt. Kịch bản đóng: bài thuộc `org_unit = X` mà **tác giả chính là trưởng phòng
 * X**; nhân viên E báo cáo bài đó; vị từ D6 tính theo đơn vị của BÀI ⇒ `view:feed-report@Department`
 * đọc được tên + avatar + `employeeId` của người vừa tố giác chính mình — kênh trả đũa trực tiếp.
 *
 * Trách nhiệm giải trình (chống báo cáo bừa) vẫn giữ được: HR/company-admin đọc ở `Company` — cũng
 * là vai DUY NHẤT xử lý được báo cáo (`029` có `companyFloor:true`) — vẫn thấy đủ danh tính.
 *
 * ⚠️ Khoá `reporter` **LUÔN CÓ MẶT**, che bằng `null` chứ KHÔNG bỏ khoá: tập khoá đóng ở trên.
 *
 * ⚠️ **HAI hình dạng, ĐỪNG gộp khi render:**
 * - `reporter === null` ⇒ **bị che theo scope**. KHÔNG BAO GIỜ có nghĩa «tra không ra»: khi được lộ,
 *   server LUÔN dựng object (có thể với trường `null` bên trong).
 * - `reporter` là object mà `employeeId === null` ⇒ **hồ sơ nhân sự không còn** (xoá mềm); `fullName`
 *   vẫn có thể có vì đến từ `users`. Đây là dữ liệu thật, không phải che.
 */
export const feedReportSchema = z.object({
  id: uuid(),
  targetType: feedTargetTypeSchema,
  targetId: uuid(),
  targetSnapshot: feedReportTargetSnapshotSchema.nullable(),
  reporter: feedReportPersonSchema.nullable(),
  reason: feedReportReasonSchema,
  note: z.string().nullable(),
  status: feedReportStatusSchema,
  resolvedBy: feedReportPersonSchema.nullable(),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type FeedReportDto = z.infer<typeof feedReportSchema>;

export const feedReportPageSchema = z.object({
  data: z.array(feedReportSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FeedReportPageDto = z.infer<typeof feedReportPageSchema>;
