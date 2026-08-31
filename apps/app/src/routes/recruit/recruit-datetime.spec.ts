/**
 * S12-RECRUIT-FE-1 (review-gate patch) — neo round-trip LOCAL⇄ISO. Ca quan trọng nhất là round-trip
 * KHÔNG lệch: `isoToLocalInput` rồi `localInputToIso` phải trả lại đúng khoảnh khắc gốc (tới độ chính
 * xác phút — input datetime-local không mang giây).
 */
import { describe, it, expect } from "vitest";
import {
  isoToLocalInput,
  localInputToIso,
  localDayStartIso,
  localDayEndIso,
} from "./recruit-datetime";

describe("recruit-datetime — round-trip ISO ⇄ input LOCAL", () => {
  it("isoToLocalInput → localInputToIso khớp lại đúng phút gốc", () => {
    const originalIso = new Date(2026, 7, 31, 9, 15, 0, 0).toISOString(); // 2026-08-31 09:15 LOCAL
    const inputValue = isoToLocalInput(originalIso);
    const roundTripIso = localInputToIso(inputValue);
    expect(new Date(roundTripIso).getTime()).toBe(new Date(originalIso).setSeconds(0, 0));
  });

  it("localInputToIso → isoToLocalInput khớp lại đúng chuỗi input gốc", () => {
    const inputValue = "2026-08-31T09:15";
    const iso = localInputToIso(inputValue);
    expect(isoToLocalInput(iso)).toBe(inputValue);
  });

  it("input rỗng ⇒ ISO rỗng, KHÔNG ném / KHÔNG trả 'Invalid Date'", () => {
    expect(localInputToIso("")).toBe("");
    expect(isoToLocalInput("")).toBe("");
  });

  it("chuỗi hỏng ⇒ rỗng (fail-soft, không ném)", () => {
    expect(localInputToIso("not-a-date")).toBe("");
    expect(isoToLocalInput("not-a-date")).toBe("");
  });

  it("localInputToIso trả instant ĐÚNG BẰNG giờ LOCAL đã gõ (không lệch offset máy)", () => {
    const iso = localInputToIso("2026-01-15T14:30");
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });
});

describe("recruit-datetime — localDayStartIso / localDayEndIso (filter from/to)", () => {
  it("localDayStartIso = 00:00:00.000 LOCAL của ngày đó", () => {
    const iso = localDayStartIso("2026-08-31");
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 31, 0, 0,
    ]);
  });

  it("localDayEndIso = 23:59:59.999 LOCAL của ngày đó — KHÔNG phải nửa đêm UTC", () => {
    const iso = localDayEndIso("2026-08-31");
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 31, 23, 59,
    ]);
  });

  it("localDayEndIso ĐI SAU localDayStartIso của CÙNG NGÀY gần trọn 24h (đối chứng bẫy nửa-đêm-UTC)", () => {
    const start = new Date(localDayStartIso("2026-08-31")).getTime();
    const end = new Date(localDayEndIso("2026-08-31")).getTime();
    const almostOneDayMs = 24 * 60 * 60 * 1000 - 1000; // trừ hao 1s cho .999
    expect(end - start).toBeGreaterThanOrEqual(almostOneDayMs);
  });

  it("chuỗi rỗng ⇒ rỗng", () => {
    expect(localDayStartIso("")).toBe("");
    expect(localDayEndIso("")).toBe("");
  });
});
