import { describe, expect, it } from "vitest";
import {
  attendanceStatusForMode,
  dateRangeInclusive,
  isCancellable,
  isDecidable,
  isSubmittable,
  REMOTE_REQUEST_STATUS,
  workModeForRequestType,
} from "./remote-work-request.logic";

describe("remote-work-request.logic", () => {
  describe("isSubmittable", () => {
    it("Draft is submittable", () => {
      expect(isSubmittable(REMOTE_REQUEST_STATUS.DRAFT)).toBe(true);
    });
    it("Pending/Approved/Rejected/Cancelled are NOT submittable", () => {
      expect(isSubmittable(REMOTE_REQUEST_STATUS.PENDING)).toBe(false);
      expect(isSubmittable(REMOTE_REQUEST_STATUS.APPROVED)).toBe(false);
      expect(isSubmittable(REMOTE_REQUEST_STATUS.REJECTED)).toBe(false);
      expect(isSubmittable(REMOTE_REQUEST_STATUS.CANCELLED)).toBe(false);
    });
  });

  describe("isDecidable", () => {
    it("only Pending is decidable (approve/reject)", () => {
      expect(isDecidable(REMOTE_REQUEST_STATUS.PENDING)).toBe(true);
      expect(isDecidable(REMOTE_REQUEST_STATUS.DRAFT)).toBe(false);
      expect(isDecidable(REMOTE_REQUEST_STATUS.APPROVED)).toBe(false);
      expect(isDecidable(REMOTE_REQUEST_STATUS.REJECTED)).toBe(false);
      expect(isDecidable(REMOTE_REQUEST_STATUS.CANCELLED)).toBe(false);
    });
  });

  describe("isCancellable", () => {
    it("Draft and Pending are cancellable", () => {
      expect(isCancellable(REMOTE_REQUEST_STATUS.DRAFT)).toBe(true);
      expect(isCancellable(REMOTE_REQUEST_STATUS.PENDING)).toBe(true);
    });
    it("terminal states are NOT cancellable", () => {
      expect(isCancellable(REMOTE_REQUEST_STATUS.APPROVED)).toBe(false);
      expect(isCancellable(REMOTE_REQUEST_STATUS.REJECTED)).toBe(false);
      expect(isCancellable(REMOTE_REQUEST_STATUS.CANCELLED)).toBe(false);
    });
  });

  describe("workModeForRequestType", () => {
    it("BusinessTrip → BusinessTrip", () => {
      expect(workModeForRequestType("BusinessTrip")).toBe("BusinessTrip");
    });
    it("Remote/Offsite → Remote", () => {
      expect(workModeForRequestType("Remote")).toBe("Remote");
      expect(workModeForRequestType("Offsite")).toBe("Remote");
    });
  });

  describe("attendanceStatusForMode", () => {
    it("AUTO_ATTENDANCE → 'Auto Attendance'", () => {
      expect(attendanceStatusForMode("AUTO_ATTENDANCE")).toBe("Auto Attendance");
    });
    it("SELF_CHECK_IN → 'Remote Work'", () => {
      expect(attendanceStatusForMode("SELF_CHECK_IN")).toBe("Remote Work");
    });
    it("NO_ATTENDANCE → null (no record written)", () => {
      expect(attendanceStatusForMode("NO_ATTENDANCE")).toBeNull();
    });
  });

  describe("dateRangeInclusive", () => {
    it("single-day range returns exactly that date", () => {
      expect(dateRangeInclusive("2024-07-01", "2024-07-01")).toEqual(["2024-07-01"]);
    });
    it("multi-day range is inclusive ascending", () => {
      expect(dateRangeInclusive("2024-07-01", "2024-07-03")).toEqual([
        "2024-07-01",
        "2024-07-02",
        "2024-07-03",
      ]);
    });
    it("month-boundary range crosses correctly", () => {
      expect(dateRangeInclusive("2024-06-29", "2024-07-01")).toEqual([
        "2024-06-29",
        "2024-06-30",
        "2024-07-01",
      ]);
    });
  });
});
