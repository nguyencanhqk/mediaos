import { describe, expect, it } from "vitest";
import {
  ME_TRAINING_MAX_COURSES,
  meTrainingProgressSchema,
  meTrainingResponseSchema,
} from "./me-training";

/**
 * S5-LMS-BE-3 — pin hợp đồng tiến độ đào tạo (APP-3 §5). Khoá 3 hành vi:
 *   1. version === 1 (literal) — v2/thiếu/chuỗi → REJECT (fail-safe, service map 502 contract-mismatch).
 *   2. field lạ (kể cả PII LMS thêm về sau) bị STRIP — KHÔNG passthrough ra FE.
 *   3. envelope: 'ok' ⇔ progress != null; 'no_account' ⇔ progress === null.
 */

function course(overrides: Record<string, unknown> = {}) {
  return {
    slug: "an-toan-lao-dong",
    title: "An toàn lao động",
    percent: 62,
    completed: 5,
    total: 8,
    learningTimeSec: 3600,
    lastActivityAt: "2026-07-20T03:00:00.000Z",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generatedAt: "2026-07-23T10:00:00.000Z",
    user: { email: "a@b.test", name: "Tên", active: true },
    summary: {
      courseCount: 1,
      completedCourses: 0,
      learningTimeSec: 3600,
      lastActivityAt: "2026-07-20T03:00:00.000Z",
    },
    courses: [course()],
    coursesTruncated: false,
    exams: {
      submitted: 4,
      passed: 2,
      failed: 1,
      pendingGrading: 1,
      bestScore10: 8.5,
      lastSubmittedAt: "2026-07-19T03:00:00.000Z",
      truncated: false,
    },
    quizzes: { submitted: 12, averagePercent: 78, lastSubmittedAt: null },
    ...overrides,
  };
}

describe("meTrainingProgressSchema — pin version", () => {
  it("version 1 (shape THẬT của LMS §5) parse OK", () => {
    const parsed = meTrainingProgressSchema.parse(payload());
    expect(parsed.version).toBe(1);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.exams.bestScore10).toBe(8.5);
  });

  it("version 2 → REJECT (LMS bump shape ⇒ MediaOS fail-safe, không render mù)", () => {
    expect(meTrainingProgressSchema.safeParse(payload({ version: 2 })).success).toBe(false);
  });

  it("thiếu version → REJECT", () => {
    const { version: _drop, ...withoutVersion } = payload();
    expect(meTrainingProgressSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("version dạng chuỗi '1' → REJECT (không coerce)", () => {
    expect(meTrainingProgressSchema.safeParse(payload({ version: "1" })).success).toBe(false);
  });

  it("thiếu field bắt buộc (summary) → REJECT", () => {
    const { summary: _drop, ...withoutSummary } = payload();
    expect(meTrainingProgressSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe("meTrainingProgressSchema — strip field ngoài whitelist", () => {
  it("field lạ ở cấp gốc/user/course (id nội bộ, PII) bị STRIP", () => {
    const parsed = meTrainingProgressSchema.parse(
      payload({
        internalUserId: "u-1",
        user: {
          email: "a@b.test",
          name: "Tên",
          active: true,
          phone: "0900000000",
          passwordHash: "x",
        },
        courses: [course({ id: 99, essayContent: "bài làm" })],
      }),
    );
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("internalUserId");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("essayContent");
    expect(Object.keys(parsed.courses[0]).sort()).toEqual([
      "completed",
      "lastActivityAt",
      "learningTimeSec",
      "percent",
      "slug",
      "title",
      "total",
    ]);
  });

  it("courses vượt trần phòng thủ → REJECT (không âm thầm cắt)", () => {
    const many = Array.from({ length: ME_TRAINING_MAX_COURSES + 1 }, (_, i) =>
      course({ slug: `c-${i}` }),
    );
    expect(meTrainingProgressSchema.safeParse(payload({ courses: many })).success).toBe(false);
  });

  it("số ÂM → REJECT (shape/kiểu sai)", () => {
    expect(
      meTrainingProgressSchema.safeParse(payload({ courses: [course({ completed: -1 })] })).success,
    ).toBe(false);
    expect(
      meTrainingProgressSchema.safeParse(payload({ courses: [course({ percent: -1 })] })).success,
    ).toBe(false);
  });

  it("percent > 100 (dữ liệu dị thường bên LMS) vẫn PARSE — pin SHAPE, không pin GIÁ TRỊ", () => {
    // Cố ý: 1 dòng dữ liệu lỗi KHÔNG được làm 502 cả thẻ Đào tạo. FE kẹp 0–100 khi vẽ thanh tiến độ.
    const parsed = meTrainingProgressSchema.safeParse(
      payload({ courses: [course({ percent: 140 })] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("kiểu sai (percent là chuỗi) → REJECT", () => {
    expect(
      meTrainingProgressSchema.safeParse(payload({ courses: [course({ percent: "62" })] })).success,
    ).toBe(false);
  });
});

describe("meTrainingResponseSchema — envelope", () => {
  it("ok + progress → hợp lệ", () => {
    expect(meTrainingResponseSchema.safeParse({ status: "ok", progress: payload() }).success).toBe(
      true,
    );
  });

  it("no_account + progress null → hợp lệ (fail-soft, KHÔNG lỗi)", () => {
    expect(
      meTrainingResponseSchema.safeParse({ status: "no_account", progress: null }).success,
    ).toBe(true);
  });

  it("ok nhưng progress null → REJECT (bất biến envelope)", () => {
    expect(meTrainingResponseSchema.safeParse({ status: "ok", progress: null }).success).toBe(
      false,
    );
  });

  it("no_account nhưng có progress → REJECT", () => {
    expect(
      meTrainingResponseSchema.safeParse({ status: "no_account", progress: payload() }).success,
    ).toBe(false);
  });

  it("status lạ → REJECT", () => {
    expect(meTrainingResponseSchema.safeParse({ status: "error", progress: null }).success).toBe(
      false,
    );
  });
});
