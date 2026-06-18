import { describe, expect, it } from "vitest";
import { resolveReportRange } from "./report-range";

/** Build a UTC instant for an unambiguous date (mid-month, mid-day) unless a boundary is under test. */
const utc = (iso: string) => new Date(iso);

describe("resolveReportRange", () => {
  describe("thisMonth", () => {
    it("month-to-month half-open window", () => {
      expect(resolveReportRange("thisMonth", utc("2026-06-18T09:30:00.000Z"))).toEqual({
        startDate: "2026-06-01",
        endDate: "2026-07-01",
      });
    });

    it("December rolls the exclusive end into next year", () => {
      expect(resolveReportRange("thisMonth", utc("2026-12-31T23:59:59.000Z"))).toEqual({
        startDate: "2026-12-01",
        endDate: "2027-01-01",
      });
    });

    it("is stable on the first instant of the month (boundary)", () => {
      expect(resolveReportRange("thisMonth", utc("2026-06-01T00:00:00.000Z"))).toEqual({
        startDate: "2026-06-01",
        endDate: "2026-07-01",
      });
    });

    it("reproduces the legacy monthStart formula (default-period parity)", () => {
      const now = utc("2026-03-09T12:00:00.000Z");
      const legacyMonthStart = now.toISOString().slice(0, 7) + "-01";
      expect(resolveReportRange("thisMonth", now).startDate).toBe(legacyMonthStart);
    });
  });

  describe("lastMonth", () => {
    it("previous month window", () => {
      expect(resolveReportRange("lastMonth", utc("2026-06-18T09:30:00.000Z"))).toEqual({
        startDate: "2026-05-01",
        endDate: "2026-06-01",
      });
    });

    it("January reaches back into the previous year", () => {
      expect(resolveReportRange("lastMonth", utc("2026-01-10T00:00:00.000Z"))).toEqual({
        startDate: "2025-12-01",
        endDate: "2026-01-01",
      });
    });
  });

  describe("thisQuarter", () => {
    it("Q1 (Jan–Mar)", () => {
      expect(resolveReportRange("thisQuarter", utc("2026-02-10T00:00:00.000Z"))).toEqual({
        startDate: "2026-01-01",
        endDate: "2026-04-01",
      });
    });

    it("Q2 (Apr–Jun)", () => {
      expect(resolveReportRange("thisQuarter", utc("2026-06-18T00:00:00.000Z"))).toEqual({
        startDate: "2026-04-01",
        endDate: "2026-07-01",
      });
    });

    it("Q3 (Jul–Sep)", () => {
      expect(resolveReportRange("thisQuarter", utc("2026-08-01T00:00:00.000Z"))).toEqual({
        startDate: "2026-07-01",
        endDate: "2026-10-01",
      });
    });

    it("Q4 (Oct–Dec) rolls the exclusive end into next year", () => {
      expect(resolveReportRange("thisQuarter", utc("2026-11-20T00:00:00.000Z"))).toEqual({
        startDate: "2026-10-01",
        endDate: "2027-01-01",
      });
    });
  });

  describe("invariants", () => {
    const periods = ["thisMonth", "lastMonth", "thisQuarter"] as const;
    const now = utc("2026-06-18T09:30:00.000Z");

    it("every period yields start < end and starts on the 1st", () => {
      for (const p of periods) {
        const { startDate, endDate } = resolveReportRange(p, now);
        expect(startDate < endDate).toBe(true);
        expect(startDate.endsWith("-01")).toBe(true);
        expect(endDate.endsWith("-01")).toBe(true);
      }
    });
  });
});
