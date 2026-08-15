/**
 * S10-ATT-NOTIPROD-1 — unit RED→GREEN cho logic THUẦN (không DB). ALLOW trước DENY (bài học
 * deny-cases-vacuous-without-allow-case): mỗi nhóm biên có ≥1 ca "còn hạn/hợp lệ" trước ca biên.
 */

import { describe, expect, it } from "vitest";
import type { ShiftCalc } from "./attendance.logic";
import {
  ATT_ALERT_DETECT_JOB_CODE,
  ATT_ABSENT_DETECTED_EVENT,
  ATT_LATE_DETECTED_EVENT,
  ATT_MISSING_CHECKOUT_EVENT,
  DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS,
  buildAbsentDedupeKey,
  buildAbsentPayload,
  buildLatePayload,
  buildMissingCheckoutPayload,
  buildRecordDedupeKey,
  isShiftWorkingDay,
  isWorkDateClosed,
  resolveAttAlertDetectIntervalMs,
  shiftEndInstant,
  storedDedupeKey,
} from "./attendance-alert-noti.logic";

const dayShift: ShiftCalc = {
  startTime: "08:00",
  endTime: "17:00",
  graceLateMinutes: 5,
  graceEarlyLeaveMinutes: 5,
  breakMinutes: 60,
  crossDay: false,
  timezone: "Asia/Ho_Chi_Minh",
};

const nightShift: ShiftCalc = {
  ...dayShift,
  startTime: "22:00",
  endTime: "06:00",
  crossDay: true,
};

describe("identifiers", () => {
  it("jobCode + eventCode ổn định (khớp seed catalog 0481:59-61)", () => {
    expect(ATT_ALERT_DETECT_JOB_CODE).toBe("ATT_ALERT_DETECT");
    expect(ATT_MISSING_CHECKOUT_EVENT).toBe("ATT_MISSING_CHECKOUT");
    expect(ATT_LATE_DETECTED_EVENT).toBe("ATT_LATE_DETECTED");
    expect(ATT_ABSENT_DETECTED_EVENT).toBe("ATT_ABSENT_DETECTED");
  });
});

describe("shiftEndInstant / isWorkDateClosed — biên ngày-đã-đóng theo ca CỦA CHÍNH NHÂN VIÊN", () => {
  it("ALLOW: ca ngày thường 08:00-17:00, workDate=2026-08-10 — instant = 2026-08-10T10:00:00.000Z (UTC+7)", () => {
    const end = shiftEndInstant("2026-08-10", dayShift);
    expect(end?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });

  it("DENY: còn TRONG ca (trước biên end_time) ⇒ chưa đóng", () => {
    expect(isWorkDateClosed(new Date("2026-08-10T09:59:59.000Z"), "2026-08-10", dayShift)).toBe(
      false,
    );
  });

  it("ALLOW: qua biên end_time ⇒ đã đóng", () => {
    expect(isWorkDateClosed(new Date("2026-08-10T10:00:01.000Z"), "2026-08-10", dayShift)).toBe(
      true,
    );
  });

  it("[CHỐT #17] ca đêm cross_day=true rơi biên sang HÔM SAU — end 2026-08-11T06:00 VN = 2026-08-10T23:00:00.000Z", () => {
    const end = shiftEndInstant("2026-08-10", nightShift);
    expect(end?.toISOString()).toBe("2026-08-10T23:00:00.000Z");
  });

  it("[CHỐT #17] CÙNG giờ start/end nhưng cross_day=false ⇒ biên KHÁC nhau (đọc CỘT, không suy đoán)", () => {
    const sameHoursNotOvernight: ShiftCalc = { ...nightShift, crossDay: false };
    const end = shiftEndInstant("2026-08-10", sameHoursNotOvernight);
    // Cùng-ngày (KHÔNG cộng thêm 1 ngày) — 06:00 VN = 2026-08-09T23:00:00.000Z, khác nightShift ở trên.
    expect(end?.toISOString()).toBe("2026-08-09T23:00:00.000Z");
  });

  it("[CHỐT #17] nhân viên CÒN TRONG ca đêm ⇒ chưa đóng (0 thông báo)", () => {
    expect(isWorkDateClosed(new Date("2026-08-10T22:59:00.000Z"), "2026-08-10", nightShift)).toBe(
      false,
    );
  });

  it("[CHỐT #18] shift.endTime NULL ⇒ fail-closed, KHÔNG suy đoán biên (null, luôn 'chưa đóng')", () => {
    const noEnd: ShiftCalc = { ...dayShift, endTime: null };
    expect(shiftEndInstant("2026-08-10", noEnd)).toBeNull();
    expect(isWorkDateClosed(new Date("2099-01-01T00:00:00.000Z"), "2026-08-10", noEnd)).toBe(false);
  });
});

describe("isShiftWorkingDay — [CHỐT #18] work_days NULL ⇒ fail-closed", () => {
  it("ALLOW: thứ nằm trong work_days", () => {
    expect(isShiftWorkingDay("2026-08-10", [1, 2, 3, 4, 5])).toBe(true); // 2026-08-10 = Thứ Hai
  });

  it("DENY: thứ KHÔNG nằm trong work_days (cuối tuần)", () => {
    expect(isShiftWorkingDay("2026-08-15", [1, 2, 3, 4, 5])).toBe(false); // 2026-08-15 = Thứ Bảy
  });

  it("[CHỐT #18] work_days NULL ⇒ KHÔNG coi là ngày làm (fail-closed, KHÔNG mặc định 'mọi ngày')", () => {
    expect(isShiftWorkingDay("2026-08-10", null)).toBe(false);
  });
});

describe("dedupe key — [CHỐT #1b/#19] nguồn ĐÓNG BĂNG, ổn định qua mọi 'giờ chạy'", () => {
  it("buildRecordDedupeKey ổn định khi gọi ở 2 mốc thời gian khác nhau (không đọc đồng hồ)", () => {
    const k1 = buildRecordDedupeKey("rec-1", "2026-08-10");
    const k2 = buildRecordDedupeKey("rec-1", "2026-08-10");
    expect(k1).toBe(k2);
    expect(k1).toBe("rec-1:2026-08-10");
  });

  it("buildAbsentDedupeKey suy từ (employeeId, closedWorkDate) — KHÔNG tham số now", () => {
    expect(buildAbsentDedupeKey("emp-1", "2026-08-10")).toBe("emp-1:2026-08-10");
  });

  it("[CHỐT #19] storedDedupeKey khớp ĐÚNG format NotificationDedupeService.computeKey('DedupeKey')", () => {
    const raw = buildRecordDedupeKey("rec-1", "2026-08-10");
    expect(storedDedupeKey(ATT_MISSING_CHECKOUT_EVENT, raw)).toBe(
      "ATT_MISSING_CHECKOUT:rec-1:2026-08-10",
    );
  });
});

describe("payload — khớp ĐÚNG placeholder template migration 0481:153-163", () => {
  it("missing-checkout: work_date + employee_name", () => {
    expect(buildMissingCheckoutPayload("2026-08-10", "Nguyễn Văn A")).toEqual({
      work_date: "2026-08-10",
      employee_name: "Nguyễn Văn A",
    });
  });

  it("late: CHỈ work_date (template 0481:157-160 không có employee_name)", () => {
    expect(buildLatePayload("2026-08-10")).toEqual({ work_date: "2026-08-10" });
  });

  it("absent: work_date + employee_name", () => {
    expect(buildAbsentPayload("2026-08-10", "Trần Thị B")).toEqual({
      work_date: "2026-08-10",
      employee_name: "Trần Thị B",
    });
  });
});

describe("resolveAttAlertDetectIntervalMs — [CHỐT #8/#23] parse-an-toàn + clamp mức NGÀY", () => {
  it("ALLOW: giá trị hợp lệ trong biên ⇒ giữ nguyên", () => {
    expect(resolveAttAlertDetectIntervalMs("3600000")).toBe(3_600_000);
  });

  it("undefined/rỗng ⇒ mặc định", () => {
    expect(resolveAttAlertDetectIntervalMs(undefined)).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
    expect(resolveAttAlertDetectIntervalMs("")).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
    expect(resolveAttAlertDetectIntervalMs("   ")).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
  });

  it("rác/NaN ⇒ mặc định, KHÔNG ném", () => {
    expect(resolveAttAlertDetectIntervalMs("abc")).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
    expect(resolveAttAlertDetectIntervalMs("12.5")).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
  });

  it("dưới sàn (< 5 phút) ⇒ mặc định", () => {
    expect(resolveAttAlertDetectIntervalMs("1000")).toBe(DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS);
  });

  it("[CHỐT #23] trên trần NGÀY (> 24h) ⇒ mặc định (KHÁC dashboard-mv-refresh trần 1h)", () => {
    expect(resolveAttAlertDetectIntervalMs(String(25 * 60 * 60_000))).toBe(
      DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS,
    );
  });

  it("đúng trần 24h ⇒ giữ nguyên (biên đóng)", () => {
    const cap = 24 * 60 * 60_000;
    expect(resolveAttAlertDetectIntervalMs(String(cap))).toBe(cap);
  });
});
