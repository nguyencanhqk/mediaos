import { describe, expect, it } from "vitest";
import {
  customDeadlineToIso,
  DEFAULT_DEADLINE_PRESETS,
  DEFAULT_DEADLINE_TIME,
  isoToCustomDeadline,
  isoWeekdayOf,
  LATE_TODAY_DEADLINE_TIME,
  resolveDeadlinePresets,
  type DeadlinePresetDefinition,
} from "./deadline-presets";

/**
 * S20-TASK-QUICKEDIT-1 — mốc hạn nhanh. Hàm thuần: `now` + `timeZone` là tham số ⇒ chạy dưới mọi múi
 * MÁY (TZ=UTC, TZ=America/Los_Angeles) phải ra CÙNG kết quả. Mốc ghi bằng instant UTC tường minh.
 */
const VN = "Asia/Ho_Chi_Minh";
const LA = "America/Los_Angeles";

const byId = (now: Date, tz = VN) =>
  Object.fromEntries(resolveDeadlinePresets(now, tz).map((p) => [p.id, p]));

describe("deadline-presets — mốc theo giờ công ty", () => {
  it("giờ mặc định là hằng số 17:00, mốc muộn trong ngày là 23:59", () => {
    expect(DEFAULT_DEADLINE_TIME).toBe("17:00");
    expect(LATE_TODAY_DEADLINE_TIME).toBe("23:59");
  });

  it("thứ ISO của ngày local: 22/10/2026 là Thứ Năm, 25/10/2026 là Chủ Nhật", () => {
    expect(isoWeekdayOf("2026-10-22")).toBe(4);
    expect(isoWeekdayOf("2026-10-25")).toBe(7);
    expect(isoWeekdayOf("2026-10-26")).toBe(1);
    expect(() => isoWeekdayOf("22/10/2026")).toThrow(/không hợp lệ/);
  });

  it("Thứ Năm 22/10/2026 10:00 VN: «Thứ Sáu này» = 23/10 17:00 VN = 10:00 UTC", () => {
    const presets = byId(new Date("2026-10-22T03:00:00.000Z"));
    expect(presets.friday).toMatchObject({
      labelKey: "thisFriday",
      localDate: "2026-10-23",
      time: "17:00",
      dueAt: "2026-10-23T10:00:00.000Z",
    });
    expect(presets.today?.dueAt).toBe("2026-10-22T10:00:00.000Z");
    expect(presets.tomorrow?.dueAt).toBe("2026-10-23T10:00:00.000Z");
    expect(presets.nextMonday?.dueAt).toBe("2026-10-26T10:00:00.000Z");
  });

  it("hôm nay là Thứ Sáu: chip Thứ Sáu thành Thứ Sáu TUẦN SAU, không đặt vào quá khứ", () => {
    // 23/10/2026 18:00 VN (sau 17:00) = 11:00 UTC.
    const now = new Date("2026-10-23T11:00:00.000Z");
    const presets = byId(now);
    expect(presets.friday).toMatchObject({ labelKey: "nextFriday", localDate: "2026-10-30" });
    for (const p of resolveDeadlinePresets(now, VN)) {
      expect(new Date(p.dueAt).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("sau 17:00 VN: «Hôm nay» thành 23:59 cùng ngày; sau 23:59 thì không còn chip Hôm nay", () => {
    const evening = byId(new Date("2026-10-22T11:00:00.000Z")); // 18:00 VN
    expect(evening.today).toMatchObject({
      localDate: "2026-10-22",
      time: "23:59",
      dueAt: "2026-10-22T16:59:00.000Z",
    });
    const lastMinute = byId(new Date("2026-10-22T16:59:30.000Z")); // 23:59:30 VN
    expect(lastMinute.today).toBeUndefined();
    expect(lastMinute.tomorrow?.localDate).toBe("2026-10-23");
  });

  it("đúng 17:00 VN: mốc 17:00 không còn ở tương lai ⇒ dùng 23:59", () => {
    expect(byId(new Date("2026-10-22T10:00:00.000Z")).today?.time).toBe("23:59");
  });

  it("Chủ Nhật: «Ngày mai» và «Thứ Hai tuần sau» cùng mốc — giữ cả hai; Thứ Sáu là tuần sau", () => {
    const presets = resolveDeadlinePresets(new Date("2026-10-25T02:00:00.000Z"), VN);
    expect(presets.map((p) => p.id)).toEqual(["today", "tomorrow", "friday", "nextMonday"]);
    expect(presets[1]?.dueAt).toBe(presets[3]?.dueAt);
    expect(presets.find((p) => p.id === "friday")).toMatchObject({
      labelKey: "nextFriday",
      localDate: "2026-10-30",
    });
  });

  it("Thứ Hai: «Thứ Hai tuần sau» = +7 ngày; Thứ Bảy: Thứ Sáu là Thứ Sáu tuần sau", () => {
    expect(byId(new Date("2026-10-26T02:00:00.000Z")).nextMonday?.localDate).toBe("2026-11-02");
    expect(byId(new Date("2026-10-24T02:00:00.000Z")).friday).toMatchObject({
      labelKey: "nextFriday",
      localDate: "2026-10-30",
    });
  });

  it("ngày local theo GIỜ CÔNG TY, không theo UTC: 06:30 VN Thứ Bảy 24/10 = 23:30 UTC Thứ Sáu 23/10", () => {
    const presets = byId(new Date("2026-10-23T23:30:00.000Z"));
    expect(presets.today?.localDate).toBe("2026-10-24");
    expect(presets.friday?.labelKey).toBe("nextFriday");
  });

  it("biên DST (múi công ty Los Angeles, hết giờ hè 01/11/2026): Thứ Hai tuần sau 17:00 PST = 01:00 UTC", () => {
    // Thứ Bảy 31/10/2026 09:00 PDT = 16:00 UTC.
    const presets = byId(new Date("2026-10-31T16:00:00.000Z"), LA);
    expect(presets.nextMonday).toMatchObject({
      localDate: "2026-11-02",
      dueAt: "2026-11-03T01:00:00.000Z",
    });
    expect(presets.today?.dueAt).toBe("2026-11-01T00:00:00.000Z"); // 17:00 PDT
  });

  it("danh sách mốc là tham số: nối thêm định nghĩa riêng; định nghĩa trả null bị bỏ qua", () => {
    const inTwoHours: DeadlinePresetDefinition = {
      id: "plus2h",
      resolve: (ctx) => ({ localDate: ctx.today, time: "12:00", labelKey: "custom" }),
    };
    const never: DeadlinePresetDefinition = { id: "never", resolve: () => null };
    const presets = resolveDeadlinePresets(new Date("2026-10-22T03:00:00.000Z"), VN, [
      ...DEFAULT_DEADLINE_PRESETS,
      inTwoHours,
      never,
    ]);
    expect(presets.map((p) => p.id)).toEqual([
      "today",
      "tomorrow",
      "friday",
      "nextMonday",
      "plus2h",
    ]);
    expect(presets.at(-1)?.dueAt).toBe("2026-10-22T05:00:00.000Z");
  });

  it("ô Tuỳ chỉnh đọc theo giờ công ty; sai dạng hoặc ngày không tồn tại ⇒ null", () => {
    expect(customDeadlineToIso("2026-10-23T17:00", VN)).toBe("2026-10-23T10:00:00.000Z");
    expect(customDeadlineToIso("", VN)).toBeNull();
    expect(customDeadlineToIso("2026-10-23", VN)).toBeNull();
    expect(customDeadlineToIso("2026-02-30T10:00", VN)).toBeNull();
    expect(isoToCustomDeadline("2026-10-23T10:00:00.000Z", VN)).toBe("2026-10-23T17:00");
    expect(isoToCustomDeadline(null, VN)).toBe("");
    expect(isoToCustomDeadline("không-phải-ngày", VN)).toBe("");
  });
});
