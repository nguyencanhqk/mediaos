import { describe, expect, it } from "vitest";
import {
  availabilityWindowViolation,
  bookingWindowViolation,
  companyDayBounds,
  computeNextFreeFrom,
  formatLocalDateTime,
  formatTimeRange,
  isBookingCompleted,
  lookupWindowViolation,
} from "./room-time";

const VN = "Asia/Ho_Chi_Minh";
const NOW = new Date("2026-09-01T02:00:00Z"); // 09:00 VN
const at = (iso: string) => new Date(iso);
const min = (n: number) => n * 60_000;

describe("room-time — bookingWindowViolation (ROOM-ERR-002, thứ tự cố định)", () => {
  it("hợp lệ ⇒ null", () => {
    expect(
      bookingWindowViolation(at("2026-09-01T03:00:00Z"), at("2026-09-01T04:00:00Z"), NOW),
    ).toBeNull();
  });
  it("endsAt ≤ startsAt ⇒ end-before-start (trước mọi luật khác kể cả in-past)", () => {
    expect(
      bookingWindowViolation(at("2026-08-01T04:00:00Z"), at("2026-08-01T03:00:00Z"), NOW),
    ).toBe("end-before-start");
    expect(
      bookingWindowViolation(at("2026-09-01T03:00:00Z"), at("2026-09-01T03:00:00Z"), NOW),
    ).toBe("end-before-start");
  });
  it("startsAt < now − 5′ ⇒ in-past; đúng 5′ trước vẫn hợp lệ", () => {
    expect(
      bookingWindowViolation(
        new Date(NOW.getTime() - min(6)),
        new Date(NOW.getTime() + min(60)),
        NOW,
      ),
    ).toBe("in-past");
    expect(
      bookingWindowViolation(
        new Date(NOW.getTime() - min(5)),
        new Date(NOW.getTime() + min(60)),
        NOW,
      ),
    ).toBeNull();
  });
  it("< 15′ ⇒ too-short; đúng 15′ hợp lệ", () => {
    expect(bookingWindowViolation(NOW, new Date(NOW.getTime() + min(14)), NOW)).toBe("too-short");
    expect(bookingWindowViolation(NOW, new Date(NOW.getTime() + min(15)), NOW)).toBeNull();
  });
  it("> 8h ⇒ too-long; đúng 8h hợp lệ", () => {
    expect(bookingWindowViolation(NOW, new Date(NOW.getTime() + min(8 * 60 + 1)), NOW)).toBe(
      "too-long",
    );
    expect(bookingWindowViolation(NOW, new Date(NOW.getTime() + min(8 * 60)), NOW)).toBeNull();
  });
  it("startsAt > now + 90 ngày ⇒ too-far", () => {
    const s = new Date(NOW.getTime() + 91 * 24 * min(60));
    expect(bookingWindowViolation(s, new Date(s.getTime() + min(60)), NOW)).toBe("too-far");
    const ok = new Date(NOW.getTime() + 90 * 24 * min(60));
    expect(bookingWindowViolation(ok, new Date(ok.getTime() + min(60)), NOW)).toBeNull();
  });
  it("in-past thắng too-short khi cả hai vi phạm (thứ tự §13.2)", () => {
    const s = new Date(NOW.getTime() - min(30));
    expect(bookingWindowViolation(s, new Date(s.getTime() + min(5)), NOW)).toBe("in-past");
  });
});

describe("room-time — lookupWindowViolation / availabilityWindowViolation", () => {
  it("to ≤ from hoặc > maxDays ⇒ range-too-wide; đúng 31 ngày hợp lệ", () => {
    const f = at("2026-09-01T00:00:00Z");
    expect(lookupWindowViolation(f, f, 31)).toBe("range-too-wide");
    expect(lookupWindowViolation(f, at("2026-10-02T00:00:01Z"), 31)).toBe("range-too-wide");
    expect(lookupWindowViolation(f, at("2026-10-02T00:00:00Z"), 31)).toBeNull();
  });
  it("availability: chỉ end-before-start + too-long (8h); quá khứ và 5′ vẫn hợp lệ", () => {
    const f = at("2020-01-01T00:00:00Z");
    expect(availabilityWindowViolation(f, f)).toBe("end-before-start");
    expect(availabilityWindowViolation(f, new Date(f.getTime() + min(5)))).toBeNull();
    expect(availabilityWindowViolation(f, new Date(f.getTime() + min(8 * 60 + 1)))).toBe(
      "too-long",
    );
  });
});

describe("room-time — computeNextFreeFrom", () => {
  const s = at("2026-09-01T02:00:00Z");
  const busy = (a: string, b: string) => ({ startsAt: at(a), endsAt: at(b) });
  it("không bận ⇒ chính startsAt", () => {
    expect(computeNextFreeFrom(s, min(60), [])?.toISOString()).toBe(s.toISOString());
  });
  it("bận liền sau ⇒ mốc = cuối lượt bận; lượt kết thúc trước startsAt bị bỏ qua", () => {
    const r = computeNextFreeFrom(s, min(60), [
      busy("2026-09-01T00:00:00Z", "2026-09-01T01:00:00Z"),
      busy("2026-09-01T02:30:00Z", "2026-09-01T03:30:00Z"),
      busy("2026-09-01T01:30:00Z", "2026-09-01T02:30:00Z"),
    ]);
    expect(r?.toISOString()).toBe("2026-09-01T03:30:00.000Z");
  });
  it("khe giữa hai lượt đủ thời lượng ⇒ lấy khe (kể cả khi unsorted)", () => {
    const r = computeNextFreeFrom(s, min(30), [
      busy("2026-09-01T03:30:00Z", "2026-09-01T04:00:00Z"),
      busy("2026-09-01T02:00:00Z", "2026-09-01T03:00:00Z"),
    ]);
    expect(r?.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });
  it("khe không đủ ⇒ nhảy qua; hết ngày ⇒ null", () => {
    const r = computeNextFreeFrom(s, min(60), [
      busy("2026-09-01T02:00:00Z", "2026-09-01T03:00:00Z"),
      busy("2026-09-01T03:30:00Z", "2026-09-01T04:00:00Z"),
    ]);
    expect(r?.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    const none = computeNextFreeFrom(s, min(60), [
      busy("2026-09-01T02:00:00Z", "2026-09-02T01:30:00Z"),
    ]);
    expect(none).toBeNull();
  });
});

describe("room-time — render theo tz + biên ngày công ty", () => {
  it("formatTimeRange cùng ngày / qua ngày (VN +07:00)", () => {
    expect(formatTimeRange(at("2026-09-02T02:30:00Z"), at("2026-09-02T03:30:00Z"), VN)).toBe(
      "09:30–10:30 02/09/2026",
    );
    expect(formatTimeRange(at("2026-09-02T16:30:00Z"), at("2026-09-02T17:30:00Z"), VN)).toBe(
      "23:30 02/09 – 00:30 03/09/2026",
    );
  });
  it("formatLocalDateTime", () => {
    expect(formatLocalDateTime(at("2026-09-02T02:05:00Z"), VN)).toBe("09:05 02/09/2026");
  });
  it("companyDayBounds: ngày VN = [17:00Z hôm trước, 17:00Z hôm đó)", () => {
    const b = companyDayBounds("2026-09-02", VN);
    expect(b.from.toISOString()).toBe("2026-09-01T17:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-09-02T17:00:00.000Z");
  });
  it("isBookingCompleted: Confirmed ∧ endsAt ≤ now; Cancelled không bao giờ", () => {
    expect(isBookingCompleted("Confirmed", at("2026-09-01T01:00:00Z"), NOW)).toBe(true);
    expect(isBookingCompleted("Confirmed", NOW, NOW)).toBe(true);
    expect(isBookingCompleted("Confirmed", at("2026-09-01T03:00:00Z"), NOW)).toBe(false);
    expect(isBookingCompleted("Cancelled", at("2026-09-01T01:00:00Z"), NOW)).toBe(false);
  });
});
