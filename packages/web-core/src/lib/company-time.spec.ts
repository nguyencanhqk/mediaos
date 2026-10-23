/**
 * S20-FE-COMPANYTZ-1 (US-X-92) — mốc nghiệp vụ «hôm nay», «quý này», hạn 17:00 theo GIỜ CÔNG TY.
 *
 * Ca chấp nhận phải xanh dưới CẢ HAI múi máy: chạy file này với `TZ=UTC` và `TZ=America/Los_Angeles`.
 * Mọi mốc được chọn để giờ công ty (UTC+7) rơi sang NGÀY/QUÝ khác so với UTC và so với Los Angeles ⇒
 * một hàm lỡ đọc getter giờ máy (`getDate()`, `new Date(y, m, d)`) hay đọc UTC đều đỏ ở ít nhất một
 * trong hai lượt.
 *
 * Ca DST (`America/New_York`) neo phép «cuối ngày» là phép LỊCH: ngày 10/03/2024 chỉ có 23 giờ, cộng
 * 86.4e6 ms sẽ trượt một giờ.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  companyTimeZone,
  deadlineAt,
  endOfLocalDay,
  isSameLocalDay,
  localDateOf,
  partsIn,
  quarterRange,
  startOfLocalDay,
  todayLocal,
  wallTimeToInstant,
  yearRange,
} from "./company-time";

const VN = "Asia/Ho_Chi_Minh";
const NY = "America/New_York";

describe("companyTimeZone()", () => {
  it("không bao giờ rỗng và là IANA mà Intl chấp nhận", () => {
    const tz = companyTimeZone();
    expect(tz.length).toBeGreaterThan(0);
    expect(() => new Intl.DateTimeFormat("vi-VN", { timeZone: tz })).not.toThrow();
  });

  it("hôm nay vẫn là fallback của API (`tz.util`) vì `/auth/me` chưa trả `company.timezone`", () => {
    expect(companyTimeZone()).toBe(VN);
  });
});

describe("todayLocal / isSameLocalDay", () => {
  it("23:30Z ngày 22/10 = 06:30 sáng 23/10 giờ công ty ⇒ 2026-10-23", () => {
    expect(todayLocal(new Date("2026-10-22T23:30:00Z"), VN)).toBe("2026-10-23");
  });

  it("đối chứng: cùng mốc đọc theo UTC vẫn là 22/10", () => {
    expect(todayLocal(new Date("2026-10-22T23:30:00Z"), "UTC")).toBe("2026-10-22");
  });

  it("isSameLocalDay so ngày theo múi truyền vào, không theo máy", () => {
    const a = new Date("2026-10-22T17:00:00Z"); // 00:00 ngày 23/10 giờ VN
    const b = new Date("2026-10-23T16:59:59.999Z"); // 23:59:59.999 ngày 23/10 giờ VN
    const c = new Date("2026-10-22T16:59:59.999Z"); // 23:59:59.999 ngày 22/10 giờ VN
    expect(isSameLocalDay(a, b, VN)).toBe(true);
    expect(isSameLocalDay(a, c, VN)).toBe(false);
    expect(isSameLocalDay(a, b, "UTC")).toBe(false);
  });
});

describe("startOfLocalDay / endOfLocalDay — trả instant UTC", () => {
  it("cuối ngày 31/10 giờ VN = 2026-10-31T16:59:59.999Z", () => {
    expect(endOfLocalDay("2026-10-31", VN).toISOString()).toBe("2026-10-31T16:59:59.999Z");
  });

  it("đầu ngày 31/10 giờ VN = 2026-10-30T17:00:00.000Z", () => {
    expect(startOfLocalDay("2026-10-31", VN).toISOString()).toBe("2026-10-30T17:00:00.000Z");
  });

  it("cuối ngày qua biên năm", () => {
    expect(endOfLocalDay("2026-12-31", VN).toISOString()).toBe("2026-12-31T16:59:59.999Z");
  });

  it("ngày DST 23 giờ (NY 10/03/2024): đầu 05:00Z, cuối 03:59:59.999Z hôm sau", () => {
    expect(startOfLocalDay("2024-03-10", NY).toISOString()).toBe("2024-03-10T05:00:00.000Z");
    expect(endOfLocalDay("2024-03-10", NY).toISOString()).toBe("2024-03-11T03:59:59.999Z");
  });
});

describe("deadlineAt — mốc hạn wall-clock theo giờ công ty", () => {
  it("17:00 ngày 24/10 giờ VN = 2026-10-24T10:00:00Z", () => {
    expect(deadlineAt("2026-10-24", "17:00", VN).toISOString()).toBe("2026-10-24T10:00:00.000Z");
  });

  it("trùng `wallTimeToInstant` (một công thức, không hai)", () => {
    expect(deadlineAt("2026-10-24", "08:30", VN).getTime()).toBe(
      wallTimeToInstant("2026-10-24", "08:30", VN).getTime(),
    );
  });
});

describe("quarterRange / yearRange — `YYYY-MM-DD` đầu/cuối theo giờ công ty", () => {
  it("17:30Z ngày 30/09 = 00:30 ngày 01/10 giờ VN ⇒ quý IV", () => {
    expect(quarterRange(new Date("2026-09-30T17:30:00Z"), VN)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("16:59Z ngày 30/09 = 23:59 ngày 30/09 giờ VN ⇒ quý III", () => {
    expect(quarterRange(new Date("2026-09-30T16:59:00Z"), VN)).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
  });

  it("quý I năm nhuận kết thúc 31/03, quý II kết thúc 30/06", () => {
    expect(quarterRange(new Date("2028-02-29T05:00:00Z"), VN)).toEqual({
      start: "2028-01-01",
      end: "2028-03-31",
    });
    expect(quarterRange(new Date("2026-05-15T05:00:00Z"), VN)).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
  });

  it("17:30Z ngày 31/12 = 00:30 ngày 01/01 giờ VN ⇒ năm sau", () => {
    expect(yearRange(new Date("2026-12-31T17:30:00Z"), VN)).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
    expect(yearRange(new Date("2026-12-31T16:59:00Z"), VN)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });
});

describe("partsIn / localDateOf — chuyển lên web-core, giữ nguyên hành vi", () => {
  it("nửa đêm đọc là giờ 0 (không phải 24)", () => {
    expect(partsIn(new Date("2026-10-22T17:00:00Z"), VN)).toEqual({
      year: 2026,
      month: 10,
      day: 23,
      hour: 0,
      minute: 0,
    });
  });

  it("localDateOf đệm 0 tháng/ngày", () => {
    expect(localDateOf(new Date("2026-01-04T20:00:00Z"), VN)).toBe("2026-01-05");
  });
});

/**
 * Múi MÁY đổi ngay trong tiến trình (pool `forks`: Node áp lại `process.env.TZ` khi gán). Không phụ thuộc
 * cách gọi lệnh — Git Bash trên Windows lặng lẽ bỏ `TZ=America/Los_Angeles` khi gọi tiến trình gốc, nên
 * một lượt `env TZ=… vitest` có thể chạy ở múi máy thật mà vẫn xanh. Ca tự kiểm offset dưới đây đỏ
 * thay vì xanh rỗng nếu múi máy không đổi được.
 */
describe("máy đặt múi khác giờ công ty ⇒ kết quả y hệt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { tz: "UTC", offsetMinutes: 0 },
    { tz: "America/Los_Angeles", offsetMinutes: 420 },
  ])("máy TZ=$tz", ({ tz, offsetMinutes }) => {
    vi.stubEnv("TZ", tz);
    expect(new Date("2026-10-22T23:30:00Z").getTimezoneOffset()).toBe(offsetMinutes);

    expect(todayLocal(new Date("2026-10-22T23:30:00Z"), VN)).toBe("2026-10-23");
    expect(quarterRange(new Date("2026-09-30T17:30:00Z"), VN)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
    expect(quarterRange(new Date("2026-09-30T16:59:00Z"), VN)).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(endOfLocalDay("2026-10-31", VN).toISOString()).toBe("2026-10-31T16:59:59.999Z");
    expect(deadlineAt("2026-10-24", "17:00", VN).toISOString()).toBe("2026-10-24T10:00:00.000Z");
  });
});

describe("ca lỗi — đầu vào không hợp lệ ném lỗi RÕ", () => {
  const now = new Date("2026-10-22T23:30:00Z");
  const invalidZones = ["", "Mars/Olympus", "+07:00", "Asia/Ho Chi Minh"];

  it.each(invalidZones)("timeZone %j ⇒ ném lỗi nêu tên múi giờ", (tz) => {
    expect(() => todayLocal(now, tz)).toThrow(/múi giờ không hợp lệ/i);
    expect(() => quarterRange(now, tz)).toThrow(/múi giờ không hợp lệ/i);
    expect(() => yearRange(now, tz)).toThrow(/múi giờ không hợp lệ/i);
    expect(() => deadlineAt("2026-10-24", "17:00", tz)).toThrow(/múi giờ không hợp lệ/i);
    expect(() => endOfLocalDay("2026-10-24", tz)).toThrow(/múi giờ không hợp lệ/i);
    expect(() => isSameLocalDay(now, now, tz)).toThrow(/múi giờ không hợp lệ/i);
  });

  it("ngày local không tồn tại hoặc sai dạng ⇒ ném lỗi, không trả Date NaN", () => {
    expect(() => startOfLocalDay("2026-02-30", VN)).toThrow(/ngày không hợp lệ/i);
    expect(() => endOfLocalDay("2026-10-31T00:00", VN)).toThrow(/ngày không hợp lệ/i);
    expect(() => deadlineAt("26-10-24", "17:00", VN)).toThrow(/ngày không hợp lệ/i);
  });

  it("giờ sai dạng ⇒ ném lỗi", () => {
    expect(() => deadlineAt("2026-10-24", "24:00", VN)).toThrow(/giờ không hợp lệ/i);
    expect(() => deadlineAt("2026-10-24", "5pm", VN)).toThrow(/giờ không hợp lệ/i);
  });

  it("instant không hợp lệ ⇒ ném lỗi", () => {
    expect(() => todayLocal(new Date(Number.NaN), VN)).toThrow(/thời điểm không hợp lệ/i);
  });
});
