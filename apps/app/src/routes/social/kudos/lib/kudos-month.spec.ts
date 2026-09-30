/**
 * S16-SOCIAL-FE-2C — ca KM: «tháng này» tính theo GIỜ CÔNG TY, không theo máy (plan D11 + §8 M-c).
 *
 * `companyTimeZone()` bị ghim về `Pacific/Kiritimati` (UTC+14): mốc 2026-09-30T10:30Z là 00:30 ngày
 * 1/10 ở đó, nhưng vẫn là 30/9 ở UTC và ở giờ VN (17:30). Một mutant đọc đồng hồ MÁY (`getMonth()`)
 * hay UTC trả `2026-09` trên CẢ máy dev (VN) lẫn CI (UTC) ⇒ đỏ ở mọi nơi, không chỉ trên CI.
 */
import { describe, expect, it, vi } from "vitest";
import { currentKudosMonth, isKudosMonth, kudosMonthParts } from "./kudos-month";

vi.mock("@/routes/rooms/room-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/routes/rooms/room-time")>();
  return { ...actual, companyTimeZone: () => "Pacific/Kiritimati" };
});

describe("KM — currentKudosMonth theo múi giờ công ty", () => {
  it("00:30 ngày 1/10 giờ công ty ⇒ 2026-10 (UTC và giờ VN vẫn là tháng 9)", () => {
    expect(currentKudosMonth(new Date("2026-09-30T10:30:00Z"))).toBe("2026-10");
  });

  it("đối chứng: 1 giờ trước đó (23:30 ngày 30/9 giờ công ty) ⇒ 2026-09", () => {
    expect(currentKudosMonth(new Date("2026-09-30T09:30:00Z"))).toBe("2026-09");
  });

  it("isKudosMonth chỉ nhận CHUỖI hợp lệ; kudosMonthParts tách năm/tháng", () => {
    expect(isKudosMonth("2026-09")).toBe(true);
    expect(isKudosMonth(202609)).toBe(false);
    expect(isKudosMonth("2026-9")).toBe(false);
    expect(kudosMonthParts("2026-09")).toEqual({ year: 2026, month: 9 });
  });
});
