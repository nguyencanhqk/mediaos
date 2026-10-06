/**
 * S16-SOCIAL-FE-3 (L1) — fixture của cụm quản trị phải là dữ liệu mà SERVER thật có thể trả: dữ liệu
 * mặc định của mỗi factory đi qua CHÍNH schema contracts. Fixture lệch hợp đồng làm mọi spec màn phía
 * sau xanh trên một hình dạng không tồn tại.
 */
import {
  feedEngagementResponseSchema,
  feedReportSchema,
  IDEMPOTENCY_ERROR_CODES,
  kudosBadgeAdminSchema,
  SOCIAL_ERROR_CODES,
} from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { describe, expect, it } from "vitest";
import { ADMIN_ERR, makeBadgeAdmin, makeEngagement, makeReport } from "./admin-test-doubles";

const C = SOCIAL_ERROR_CODES;

describe("admin-test-doubles — factory khớp hợp đồng", () => {
  it("makeReport(): qua `feedReportSchema`, không khoá thừa, avatar KHÁC rỗng (để ca «không <img>» có răng)", () => {
    const report = makeReport();
    expect(feedReportSchema.safeParse(report).success).toBe(true);
    const parsed = feedReportSchema.parse(report);
    // `z.object` bỏ khoá lạ khi parse ⇒ bằng nhau nghĩa là fixture không mang khoá ngoài tập đóng của DTO.
    expect(parsed).toEqual(report);
    expect(report.status).toBe("open");
    expect(report.targetType).toBe("post");
    expect(report.reporter?.avatarUrl).toMatch(/^https:\/\//);
    expect(report.targetSnapshot?.avatarUrl).toMatch(/^https:\/\//);
    // Bài bị báo cáo và người báo cáo là hai người khác nhau; id bài ≠ id báo cáo.
    expect(report.targetSnapshot?.postId).toBe(report.targetId);
    expect(report.id).not.toBe(report.targetId);
  });

  it("makeReport(over): ghi đè từng trường và kết quả VẪN qua schema (báo cáo bình luận · bị che · đã xử lý)", () => {
    const commentId = "99999999-9999-4999-8999-999999999999";
    const masked = makeReport({ targetType: "comment", targetId: commentId, reporter: null });
    expect(feedReportSchema.safeParse(masked).success).toBe(true);
    expect(feedReportSchema.parse(masked).reporter).toBeNull();
    expect(masked.targetId).toBe(commentId);
    // Snapshot của báo cáo bình luận mang `postId` của BÀI CHA — khác `targetId` (plan M2b).
    expect(masked.targetSnapshot?.postId).not.toBe(commentId);

    const resolved = makeReport({
      status: "resolved",
      resolvedAt: "2026-10-02T03:04:05.000Z",
      resolvedBy: { employeeId: null, fullName: "Lê Văn C", avatarUrl: null },
    });
    expect(feedReportSchema.parse(resolved).resolvedBy?.fullName).toBe("Lê Văn C");
  });

  it("makeEngagement(): qua `feedEngagementResponseSchema`, có đơn vị + hàng «chưa gán đơn vị» + tổng tuần", () => {
    const data = makeEngagement();
    expect(feedEngagementResponseSchema.safeParse(data).success).toBe(true);
    expect(feedEngagementResponseSchema.parse(data)).toEqual(data);
    expect(data.units.length).toBeGreaterThan(0);
    expect(data.weekTotals.length).toBeGreaterThan(1);
    expect(data.rows.some((row) => row.orgUnitId === null)).toBe(true);
    expect(makeEngagement({ units: [], rows: [] }).units).toEqual([]);
  });

  it("makeBadgeAdmin(): qua `kudosBadgeAdminSchema`, mặc định đang bật; ghi đè `isActive:false` được", () => {
    const badge = makeBadgeAdmin();
    expect(kudosBadgeAdminSchema.safeParse(badge).success).toBe(true);
    expect(kudosBadgeAdminSchema.parse(badge)).toEqual(badge);
    expect(badge.isActive).toBe(true);
    expect(makeBadgeAdmin({ isActive: false, code: "da-tat" })).toMatchObject({
      isActive: false,
      code: "da-tat",
    });
  });
});

describe("ADMIN_ERR — lỗi đúng hình dạng trên dây", () => {
  const EXPECTED: readonly (readonly [string, number, string])[] = [
    ["reportAlreadyDecided", 409, C.REPORT_ALREADY_DECIDED],
    ["reportBusy", 409, C.REPORT_BUSY],
    ["reportActionDenied", 403, C.REPORT_ACTION_DENIED],
    ["reportActionInvalid", 422, C.REPORT_ACTION_INVALID_FOR_TARGET],
    ["reportTargetUnavailable", 422, C.REPORT_ACTION_TARGET_UNAVAILABLE],
    ["reportGone", 404, C.REPORT_NOT_FOUND],
    ["postGone", 404, C.POST_NOT_FOUND],
    ["reportDuplicate", 409, C.REPORT_DUPLICATE_OPEN],
    ["idempotencyInProgress", 409, IDEMPOTENCY_ERROR_CODES.IN_PROGRESS],
    ["moderationDenied", 403, C.MODERATION_FIELD_DENIED],
    ["forbidden", 403, "AUTH-ERR-FORBIDDEN"],
    ["badRequest", 400, "VALIDATION-ERR-001"],
    ["server", 500, "INTERNAL"],
  ];
  const table: Record<string, (() => ApiError) | undefined> = ADMIN_ERR;

  it("đúng 13 lỗi, đúng tên (danh sách viết tay)", () => {
    expect(Object.keys(ADMIN_ERR).sort()).toEqual(EXPECTED.map(([name]) => name).sort());
  });

  it.each(EXPECTED)(
    "%s ⇒ ApiError %i với mã %s, mỗi lần gọi một instance mới",
    (name, status, code) => {
      const make = table[name];
      expect(make).toBeTypeOf("function");
      const first = make?.();
      expect(first).toBeInstanceOf(ApiError);
      expect(first?.status).toBe(status);
      expect(first?.code).toBe(code);
      expect(first?.message.length).toBeGreaterThan(0);
      expect(make?.()).not.toBe(first);
    },
  );
});
