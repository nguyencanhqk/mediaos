/**
 * S11-ROOM-FE-1 — neo phép quy đổi thời gian của lịch phòng.
 *
 * Ca giá trị nhất là ca **DST**: `Australia/Lord_Howe` (+10:30/+11:00, nhảy 30 phút) và
 * `America/New_York` (nhảy 60 phút) — VN không DST nên một công thức sai vẫn xanh trên mọi ca VN. Ba
 * thứ phải đúng ở biên: cộng ngày là phép LỊCH (không phải + 86.4e6 ms), `wallTimeToInstant` không
 * NaN/không ném ở giờ-không-tồn-tại, và vòng `instant → parts → instant` khép kín ở giờ bình thường.
 */
import { describe, it, expect } from "vitest";
import {
  addDaysToLocalDate,
  localDateOf,
  localTimeOf,
  localDateRange,
  overlaps,
  placeOnDay,
  startOfWeekLocalDate,
  timeSlots,
  wallTimeToInstant,
  windowOfLocalDays,
  companyTimeZone,
} from "./room-time";

const VN = "Asia/Ho_Chi_Minh";
const NY = "America/New_York";
const LHI = "Australia/Lord_Howe";

describe("room-time — múi giờ công ty", () => {
  it("companyTimeZone() = IANA hợp lệ (Intl không ném)", () => {
    const tz = companyTimeZone();
    expect(() => new Intl.DateTimeFormat("vi-VN", { timeZone: tz })).not.toThrow();
    // Trùng fallback của `tz.util` ở API — hai đầu dây phải cùng một mốc khi company chưa lộ tz.
    expect(tz).toBe("Asia/Ho_Chi_Minh");
  });
});

describe("room-time — wall-clock ↔ instant", () => {
  it("09:00 VN = 02:00Z", () => {
    expect(wallTimeToInstant("2026-09-02", "09:00", VN).toISOString()).toBe(
      "2026-09-02T02:00:00.000Z",
    );
  });

  it("khép kín: instant → (date, time) → instant", () => {
    const inst = wallTimeToInstant("2026-09-02", "14:30", VN);
    expect(localDateOf(inst, VN)).toBe("2026-09-02");
    expect(localTimeOf(inst, VN)).toBe("14:30");
    expect(wallTimeToInstant(localDateOf(inst, VN), localTimeOf(inst, VN), VN).getTime()).toBe(
      inst.getTime(),
    );
  });

  it("cùng instant đọc ở hai tz cho hai ngày local khác nhau", () => {
    const inst = new Date("2026-09-02T02:00:00.000Z");
    expect(localDateOf(inst, VN)).toBe("2026-09-02"); // 09:00
    expect(localDateOf(inst, NY)).toBe("2026-09-01"); // 22:00 hôm trước
  });

  // ── PARITY VỚI BACKEND ────────────────────────────────────────────────────────────────────────
  // Hai mốc dưới đây là ĐÚNG hai ca mà `apps/api/src/common/tz.util.spec.ts` đã ghim (ADR-0008
  // "CANONICAL CHOICE"). Ghim lại y hệt ở FE là cách duy nhất phát hiện được lệch resolver giữa hai
  // đầu dây: lệch 1 giờ ở biên DST = lượt đặt rơi sai khung, mà không lưới nào khác bắt được.
  it("DST GAP: NY 2024-03-10 02:30 (không tồn tại) ⇒ 06:30Z — TRÙNG mốc canonical của tz.util", () => {
    const inst = wallTimeToInstant("2024-03-10", "02:30", NY);
    expect(Number.isNaN(inst.getTime())).toBe(false);
    expect(inst.toISOString()).toBe("2024-03-10T06:30:00.000Z");
  });

  it("DST OVERLAP: NY 2024-11-03 01:30 (xảy ra hai lần) ⇒ 05:30Z — lần TRƯỚC chuyển tiếp", () => {
    const inst = wallTimeToInstant("2024-11-03", "01:30", NY);
    expect(inst.toISOString()).toBe("2024-11-03T05:30:00.000Z");
  });

  it("ngày GAP: mốc suy ra nằm trong [01:30, 03:30] và ỔN ĐỊNH qua nhiều lần gọi", () => {
    const a = wallTimeToInstant("2026-03-08", "02:30", NY);
    const b = wallTimeToInstant("2026-03-08", "02:30", NY);
    expect(a.getTime()).toBe(b.getTime());
    expect(a.getTime()).toBeGreaterThanOrEqual(
      wallTimeToInstant("2026-03-08", "01:30", NY).getTime(),
    );
    expect(a.getTime()).toBeLessThan(wallTimeToInstant("2026-03-08", "03:30", NY).getTime());
  });

  it("DST nhảy NỬA GIỜ (Lord Howe) vẫn khép kín ở giờ bình thường", () => {
    const inst = wallTimeToInstant("2026-06-15", "10:00", LHI);
    expect(localTimeOf(inst, LHI)).toBe("10:00");
  });
});

describe("room-time — cộng ngày là phép LỊCH", () => {
  it("qua biên tháng và năm nhuận", () => {
    expect(addDaysToLocalDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToLocalDate("2028-02-28", 1)).toBe("2028-02-29"); // 2028 nhuận
    expect(addDaysToLocalDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("qua NGÀY DST 23 giờ vẫn nhảy đúng 1 ngày lịch (cộng 86.4e6 ms sẽ trượt)", () => {
    expect(addDaysToLocalDate("2026-03-08", 1)).toBe("2026-03-09");
    // Và cửa sổ một ngày DST đó dài 23 giờ, không phải 24 — bằng chứng công thức KHÔNG cộng ms.
    const w = windowOfLocalDays("2026-03-08", 1, NY);
    expect(w.to.getTime() - w.from.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("tuần bắt đầu THỨ HAI (vi-VN)", () => {
    expect(startOfWeekLocalDate("2026-09-02")).toBe("2026-08-31"); // 02/09/2026 là thứ Tư
    expect(startOfWeekLocalDate("2026-08-31")).toBe("2026-08-31"); // đã là thứ Hai
    expect(startOfWeekLocalDate("2026-09-06")).toBe("2026-08-31"); // Chủ nhật thuộc tuần TRƯỚC
  });

  it("localDateRange trả đúng số ngày liên tiếp", () => {
    expect(localDateRange("2026-08-31", 7)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("windowOfLocalDays nửa mở: to = 00:00 ngày SAU ngày cuối", () => {
    const w = windowOfLocalDays("2026-09-02", 7, VN);
    expect(w.from.toISOString()).toBe("2026-09-01T17:00:00.000Z"); // 00:00 VN ngày 02
    expect(w.to.toISOString()).toBe("2026-09-08T17:00:00.000Z"); // 00:00 VN ngày 09
  });
});

describe("room-time — giao khoảng (nền của kiểm trùng client)", () => {
  const d = (iso: string) => new Date(iso);

  it("kề nhau KHÔNG giao (nửa mở) — 09:00–10:00 và 10:00–11:00 đặt được cả hai", () => {
    expect(
      overlaps(
        d("2026-09-02T09:00:00Z"),
        d("2026-09-02T10:00:00Z"),
        d("2026-09-02T10:00:00Z"),
        d("2026-09-02T11:00:00Z"),
      ),
    ).toBe(false);
  });

  it("chồng một phần / chứa trọn ⇒ giao", () => {
    expect(
      overlaps(
        d("2026-09-02T09:00:00Z"),
        d("2026-09-02T10:30:00Z"),
        d("2026-09-02T10:00:00Z"),
        d("2026-09-02T11:00:00Z"),
      ),
    ).toBe(true);
    expect(
      overlaps(
        d("2026-09-02T09:00:00Z"),
        d("2026-09-02T12:00:00Z"),
        d("2026-09-02T10:00:00Z"),
        d("2026-09-02T11:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("room-time — đặt lượt lên lưới", () => {
  const place = (startIso: string, endIso: string, day = "2026-09-02") =>
    placeOnDay(new Date(startIso), new Date(endIso), day, VN, 7, 21);

  it("lượt 09:00–10:00 VN nằm ở 1/7 khung 07:00–21:00", () => {
    const p = place("2026-09-02T02:00:00Z", "2026-09-02T03:00:00Z");
    expect(p).not.toBeNull();
    expect(p?.topPct).toBeCloseTo((2 / 14) * 100, 5);
    expect(p?.heightPct).toBeCloseTo((1 / 14) * 100, 5);
    expect(p?.clippedTop).toBe(false);
    expect(p?.clippedBottom).toBe(false);
  });

  it("lượt của NGÀY KHÁC ⇒ null (gọi thẳng trên mảng cả tuần được)", () => {
    expect(place("2026-09-03T02:00:00Z", "2026-09-03T03:00:00Z")).toBeNull();
  });

  it("lượt tràn đầu khung (06:00–08:00) bị KẸP chứ KHÔNG bị bỏ — giấu lịch bận là mời 409", () => {
    const p = place("2026-09-01T23:00:00Z", "2026-09-02T01:00:00Z"); // 06:00–08:00 VN
    expect(p).not.toBeNull();
    expect(p?.clippedTop).toBe(true);
    expect(p?.topPct).toBe(0);
    expect(p?.heightPct).toBeCloseTo((1 / 14) * 100, 5);
  });

  it("lượt NẰM TRỌN ngoài khung (22:00–23:00) vẫn hiện, và ở TRONG cột", () => {
    const p = place("2026-09-02T15:00:00Z", "2026-09-02T16:00:00Z"); // 22:00–23:00 VN
    expect(p).not.toBeNull();
    // Nằm SAU khung ⇒ kẹp ở ĐÁY (clippedBottom), không phải đỉnh.
    expect(p?.clippedBottom).toBe(true);
    expect(p?.clippedTop).toBe(false);
    // Không được để top = 100%: thẻ sẽ vẽ ngay dưới đáy lưới, nhìn như biến mất.
    expect(p?.topPct).toBeLessThanOrEqual(98.5);
    expect((p?.topPct ?? 0) + (p?.heightPct ?? 0)).toBeLessThanOrEqual(100.0001);
  });

  it("lượt NẰM TRỌN trước khung (05:00–06:00) kẹp ở ĐỈNH", () => {
    const p = place("2026-09-01T22:00:00Z", "2026-09-01T23:00:00Z"); // 05:00–06:00 VN ngày 02
    expect(p).not.toBeNull();
    expect(p?.clippedTop).toBe(true);
    expect(p?.clippedBottom).toBe(false);
    expect(p?.topPct).toBe(0);
  });

  it("lượt siêu ngắn vẫn có chiều cao bấm được", () => {
    const p = place("2026-09-02T02:00:00Z", "2026-09-02T02:05:00Z");
    expect(p?.heightPct).toBeGreaterThan(0);
  });

  it("lượt qua đêm chia thành hai ô ở hai ngày, mỗi ô bị kẹp một đầu", () => {
    const a = place("2026-09-02T15:00:00Z", "2026-09-02T18:00:00Z", "2026-09-02"); // 22:00→01:00
    const b = place("2026-09-02T15:00:00Z", "2026-09-02T18:00:00Z", "2026-09-03");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b?.clippedTop).toBe(true);
  });
});

describe("room-time — mốc chọn giờ", () => {
  it("bước 30 phút, bao gồm cả mốc cuối", () => {
    const slots = timeSlots(7, 9, 30);
    expect(slots).toEqual(["07:00", "07:30", "08:00", "08:30", "09:00"]);
  });
});
