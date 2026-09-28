import { z } from "zod";

/**
 * S16-SOCIAL-BE-3B — DTO của `SOCIAL-API-052` (`GET /social/stats/engagement`) và `053` (`…/export`, XLSX).
 *
 * Tuần = tuần ISO (thứ Hai → Chủ nhật) theo MÚI GIỜ CÔNG TY. Zod chỉ nắn NGÀY LỊCH (không phụ thuộc TZ):
 * `from` → thứ Hai tuần chứa nó, `to` → Chủ nhật tuần chứa nó; khoảng sau nắn ≤ 26 tuần. Vắng cả hai ⇒
 * server lấy 8 tuần tới hết tuần hiện tại theo TZ công ty (tính ở SQL — «hôm nay» phụ thuộc TZ).
 */

/** Trần số tuần của một lượt thống kê — cũng là trần tự nhiên số hàng của tệp XLSX (26 × số đơn vị). */
export const FEED_ENGAGEMENT_MAX_WEEKS = 26;
/** Số tuần mặc định khi vắng `from`/`to`. */
export const FEED_ENGAGEMENT_DEFAULT_WEEKS = 8;

const DAY_MS = 86_400_000;

// `(19|20)` chứ không `\d{4}` — năm `0000` hợp lệ với regex rộng nhưng vỡ `::date` ở Postgres ⇒ 500
// (bài học `kudosMonthSchema`, FULL gate BE-2B-2 MEDIUM-1).
const isoDateSchema = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "ngày phải có dạng YYYY-MM-DD");

/**
 * Chuỗi `YYYY-MM-DD` → mốc UTC nửa đêm, hoặc `null` nếu ngày không tồn tại (`2026-02-30`).
 * 🔴 SỐ HỌC UTC THUẦN (`Date.UTC`/`getUTC*`) — getter local làm kết quả phụ thuộc TZ máy chủ.
 */
function parseUtcDate(s: string): number | null {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
    ? t
    : null;
}

/** Số ngày lùi về thứ Hai của tuần ISO (`getUTCDay`: 0 = Chủ nhật). */
function isoWeekdayOffset(t: number): number {
  return (new Date(t).getUTCDay() + 6) % 7;
}

function formatUtcDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Nắn một khoảng ngày về tuần ISO trọn vẹn. Export để unit spec đo biên Chủ nhật/thứ Hai. */
export function snapToIsoWeeks(
  from: string,
  to: string,
): { from: string; to: string; weeks: number } | null {
  const f = parseUtcDate(from);
  const t = parseUtcDate(to);
  if (f === null || t === null) return null;
  const monday = f - isoWeekdayOffset(f) * DAY_MS;
  const sunday = t + (6 - isoWeekdayOffset(t)) * DAY_MS;
  return {
    from: formatUtcDate(monday),
    to: formatUtcDate(sunday),
    weeks: Math.round((sunday - monday + DAY_MS) / (7 * DAY_MS)),
  };
}

export const feedEngagementQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    orgUnitId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if ((q.from === undefined) !== (q.to === undefined)) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "from và to phải đi cùng nhau" });
      return;
    }
    if (q.from === undefined || q.to === undefined) return;
    const snapped = snapToIsoWeeks(q.from, q.to);
    if (snapped === null) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "ngày không tồn tại" });
      return;
    }
    if (q.from > q.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "from phải ≤ to" });
      return;
    }
    if (snapped.weeks > FEED_ENGAGEMENT_MAX_WEEKS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `khoảng tối đa ${FEED_ENGAGEMENT_MAX_WEEKS} tuần`,
      });
    }
  })
  .transform((q) => {
    if (q.from === undefined || q.to === undefined) return { orgUnitId: q.orgUnitId };
    // `superRefine` đã loại mọi ca `null` ⇒ non-null ở đây.
    const snapped = snapToIsoWeeks(q.from, q.to)!;
    return { from: snapped.from, to: snapped.to, orgUnitId: q.orgUnitId };
  });
export type FeedEngagementQueryDto = z.infer<typeof feedEngagementQuerySchema>;

/** Một đơn vị trong phạm vi của người xem — CŨNG là tập `orgUnitId` hợp lệ duy nhất (plan D6). */
export const feedEngagementUnitSchema = z.object({
  orgUnitId: z.string().uuid(),
  name: z.string(),
  isDeleted: z.boolean(),
});
export type FeedEngagementUnitDto = z.infer<typeof feedEngagementUnitSchema>;

const engagementCounts = {
  posts: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  reactions: z.number().int().nonnegative(),
  activeMembers: z.number().int().nonnegative(),
};

/** Một ô tuần × đơn vị có hoạt động. `orgUnitId: null` = người chưa gán đơn vị (chỉ scope Company). */
export const feedEngagementRowSchema = z.object({
  weekStart: z.string(),
  orgUnitId: z.string().uuid().nullable(),
  ...engagementCounts,
});
export type FeedEngagementRowDto = z.infer<typeof feedEngagementRowSchema>;

/** Tổng một tuần TRÊN tập đã lọc scope — `activeMembers` là DISTINCT thật, không phải tổng các đơn vị. */
export const feedEngagementWeekSchema = z.object({
  weekStart: z.string(),
  ...engagementCounts,
});
export type FeedEngagementWeekDto = z.infer<typeof feedEngagementWeekSchema>;

export const feedEngagementResponseSchema = z.object({
  range: z.object({ from: z.string(), to: z.string(), weeks: z.number().int().positive() }),
  units: z.array(feedEngagementUnitSchema),
  rows: z.array(feedEngagementRowSchema),
  weekTotals: z.array(feedEngagementWeekSchema),
});
export type FeedEngagementResponseDto = z.infer<typeof feedEngagementResponseSchema>;
