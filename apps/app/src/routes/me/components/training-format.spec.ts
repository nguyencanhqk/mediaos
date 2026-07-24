/**
 * training-format tests (S5-LMS-FE-1) — helper THUẦN. Trọng tâm: clamp % theo kỷ luật "PIN SHAPE, KHÔNG
 * PIN GIÁ TRỊ" của contract (dòng dị thường completed>total ⇒ percent>100 KHÔNG làm vỡ, chỉ kẹp hiển thị)
 * + chọn khoá gần nhất theo lastActivityAt (null xếp sau).
 */
import { describe, it, expect } from "vitest";
import type { MeTrainingCourse } from "@mediaos/contracts";
import { clampPercent, learningTimeParts, pickRecentCourse } from "./training-format";

function course(overrides: Partial<MeTrainingCourse>): MeTrainingCourse {
  return {
    slug: "c",
    title: "Khoá",
    percent: 0,
    completed: 0,
    total: 0,
    learningTimeSec: 0,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("clampPercent", () => {
  it("kẹp về [0,100] + làm tròn", () => {
    expect(clampPercent(45.4)).toBe(45);
    expect(clampPercent(45.6)).toBe(46);
    expect(clampPercent(150)).toBe(100); // completed>total ⇒ >100, kẹp hiển thị (KHÔNG vỡ)
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe("learningTimeParts", () => {
  it("tách giờ/phút; giá trị âm/không hợp lệ ⇒ 0", () => {
    expect(learningTimeParts(9000)).toEqual({ hours: 2, minutes: 30 });
    expect(learningTimeParts(45)).toEqual({ hours: 0, minutes: 0 });
    expect(learningTimeParts(3600)).toEqual({ hours: 1, minutes: 0 });
    expect(learningTimeParts(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("pickRecentCourse", () => {
  it("rỗng ⇒ null", () => {
    expect(pickRecentCourse([])).toBeNull();
  });

  it("chọn khoá có lastActivityAt mới nhất", () => {
    const older = course({ slug: "a", lastActivityAt: "2026-07-10T08:00:00.000Z" });
    const newer = course({ slug: "b", lastActivityAt: "2026-07-19T08:00:00.000Z" });
    expect(pickRecentCourse([older, newer])?.slug).toBe("b");
    expect(pickRecentCourse([newer, older])?.slug).toBe("b");
  });

  it("khoá chưa hoạt động (null) xếp sau khoá có hoạt động", () => {
    const withActivity = course({ slug: "a", lastActivityAt: "2026-07-10T08:00:00.000Z" });
    const noActivity = course({ slug: "b", lastActivityAt: null });
    expect(pickRecentCourse([noActivity, withActivity])?.slug).toBe("a");
  });

  it("tất cả null ⇒ khoá đầu tiên", () => {
    const first = course({ slug: "a", lastActivityAt: null });
    const second = course({ slug: "b", lastActivityAt: null });
    expect(pickRecentCourse([first, second])?.slug).toBe("a");
  });
});
