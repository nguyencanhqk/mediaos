/**
 * S16-SOCIAL-FE-3B (L5a, ca T1 — vế «giờ MÁY») — «tuần hiện tại» đi theo `companyTimeZone()`, không theo
 * múi giờ của tiến trình.
 *
 * `stats-range.spec.ts` dùng mốc tách UTC khỏi giờ VN: nó giết mutant tính theo UTC ở mọi nơi, nhưng mutant
 * đọc getter giờ MÁY (`getFullYear/getMonth/getDate`) vẫn SỐNG trên máy dev vì múi mặc định của công ty
 * trùng offset với máy (UTC+7). Ở đây `companyTimeZone()` bị ghim về `Pacific/Kiritimati` (UTC+14, tiền lệ
 * `kudos/lib/kudos-month.spec.ts`): mốc 2026-10-04T11:00Z đã là 01:00 thứ Hai 05/10 ở đó, trong khi còn là
 * Chủ nhật 04/10 ở UTC (11:00) lẫn giờ VN (18:00) ⇒ mutant giờ máy và mutant UTC cùng trả `2026-10-04`,
 * đỏ trên CẢ máy dev lẫn CI.
 */
import { describe, expect, it, vi } from "vitest";
import { canShiftForward, currentWeekEnd, type StatsRange } from "./stats-range";

vi.mock("@/routes/rooms/room-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/routes/rooms/room-time")>();
  return { ...actual, companyTimeZone: () => "Pacific/Kiritimati" };
});

/** 01:00 thứ Hai 05/10/2026 giờ công ty (UTC+14) — UTC và giờ VN còn Chủ nhật 04/10. */
const COMPANY_MONDAY = new Date("2026-10-04T11:00:00Z");
/** 23:30 Chủ nhật 04/10/2026 giờ công ty — 90 phút trước mốc trên. */
const COMPANY_SUNDAY = new Date("2026-10-04T09:30:00Z");
/** 2 tuần kết thúc Chủ nhật 04/10. */
const TWO_WEEKS: StatsRange = { from: "2026-09-21", to: "2026-10-04", weeks: 2 };

describe("currentWeekEnd — theo múi giờ CÔNG TY, không theo múi giờ máy", () => {
  it("01:00 thứ Hai 05/10 giờ công ty (UTC và giờ VN còn Chủ nhật 04/10) ⇒ 2026-10-11", () => {
    expect(currentWeekEnd(COMPANY_MONDAY)).toBe("2026-10-11");
  });

  it("đối chứng: 23:30 Chủ nhật 04/10 giờ công ty ⇒ 2026-10-04", () => {
    expect(currentWeekEnd(COMPANY_SUNDAY)).toBe("2026-10-04");
  });

  it("nút › theo cùng mốc: khoảng kết thúc 04/10 tiến được từ thứ Hai giờ công ty, không tiến được trước đó", () => {
    expect(canShiftForward(TWO_WEEKS, COMPANY_MONDAY)).toBe(true);
    expect(canShiftForward(TWO_WEEKS, COMPANY_SUNDAY)).toBe(false);
  });
});
