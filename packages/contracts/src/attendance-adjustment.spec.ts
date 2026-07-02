import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ADJUSTMENT_REQUEST_TYPES,
  ATTENDANCE_ADJUSTMENT_STATUSES,
  adjustmentListQuerySchema,
  approveAdjustmentSchema,
  attendanceAdjustmentListItemSchema,
  attendanceAdjustmentRequestDetailSchema,
  createAdjustmentRequestSchema,
  directAdjustSchema,
  rejectAdjustmentSchema,
} from "./index";

/**
 * S3-ATT-BE-4-CONTRACTS — deny-path (malformed input REJECTED) + happy-path parse round-trip
 * cho canonical attendance_adjustment_requests DTOs (DB-04 §7.6/§7.7, ATT-FUNC-018..022).
 */
describe("S3-ATT-BE-4 attendance adjustment contracts", () => {
  describe("createAdjustmentRequestSchema — deny-path (RED trước)", () => {
    it("REJECT thiếu reason", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "MISSING_CHECK_IN",
          requestedCheckInAt: "2026-07-01T01:00:00.000Z",
        }),
      ).toThrow();
    });

    it("REJECT requestType ngoài 9-enum", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "SOMETHING_ELSE",
          reason: "lý do hợp lệ",
        }),
      ).toThrow();
    });

    it("REJECT MISSING_CHECK_IN thiếu requestedCheckInAt", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "MISSING_CHECK_IN",
          reason: "quên check-in",
        }),
      ).toThrow();
    });

    it("REJECT UPDATE_CHECK_OUT thiếu requestedCheckOutAt", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "UPDATE_CHECK_OUT",
          reason: "sai giờ check-out",
        }),
      ).toThrow();
    });

    it("REJECT requestedCheckOutAt trước requestedCheckInAt", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "UPDATE_CHECK_IN",
          reason: "sai giờ",
          requestedCheckInAt: "2026-07-01T09:00:00.000Z",
          requestedCheckOutAt: "2026-07-01T01:00:00.000Z",
        }),
      ).toThrow();
    });

    it("REJECT item fieldName ngoài allowlist", () => {
      expect(() =>
        createAdjustmentRequestSchema.parse({
          workDate: "2026-07-01",
          requestType: "OTHER",
          reason: "trường hợp đặc biệt",
          items: [{ fieldName: "salary", newValue: 100 }],
        }),
      ).toThrow();
    });

    it("STRIP field server-authoritative gửi kèm (status/employeeId/submittedAt/requestedBy)", () => {
      const out = createAdjustmentRequestSchema.parse({
        workDate: "2026-07-01",
        requestType: "OTHER",
        reason: "trường hợp đặc biệt",
        status: "Approved",
        employeeId: "11111111-1111-1111-1111-111111111111",
        submittedAt: "2026-07-01T00:00:00.000Z",
        requestedBy: "22222222-2222-2222-2222-222222222222",
      }) as Record<string, unknown>;
      expect(out).not.toHaveProperty("status");
      expect(out).not.toHaveProperty("employeeId");
      expect(out).not.toHaveProperty("submittedAt");
      expect(out).not.toHaveProperty("requestedBy");
    });

    it("PASS happy-path đủ trường + items + targetEmployeeId (create-thay)", () => {
      const out = createAdjustmentRequestSchema.parse({
        workDate: "2026-07-01",
        requestType: "UPDATE_STATUS",
        reason: "bị ghi vắng mặt sai",
        items: [{ fieldName: "attendanceStatus", newValue: "Present", note: "đã có mặt" }],
        attachmentFileId: "33333333-3333-3333-3333-333333333333",
        targetEmployeeId: "44444444-4444-4444-4444-444444444444",
      });
      expect(out.requestType).toBe("UPDATE_STATUS");
      expect(out.targetEmployeeId).toBe("44444444-4444-4444-4444-444444444444");
      expect(out.items?.[0].fieldName).toBe("attendanceStatus");
    });

    it("9 request type khớp đúng bảng ATT-FUNC-018", () => {
      expect(ATTENDANCE_ADJUSTMENT_REQUEST_TYPES).toEqual([
        "MISSING_CHECK_IN",
        "MISSING_CHECK_OUT",
        "UPDATE_CHECK_IN",
        "UPDATE_CHECK_OUT",
        "EXPLAIN_LATE",
        "EXPLAIN_EARLY_LEAVE",
        "UPDATE_STATUS",
        "REMOTE_CORRECTION",
        "OTHER",
      ]);
    });
  });

  describe("adjustmentListQuerySchema", () => {
    it("REJECT scope ngoài me|team|company", () => {
      expect(() => adjustmentListQuerySchema.parse({ scope: "all" })).toThrow();
    });

    it("REJECT status lowercase (không canonical TitleCase)", () => {
      expect(() => adjustmentListQuerySchema.parse({ status: "pending" })).toThrow();
    });

    it("default scope=me, page=1, pageSize=20", () => {
      const out = adjustmentListQuerySchema.parse({});
      expect(out).toMatchObject({ scope: "me", page: 1, pageSize: 20 });
    });

    it("PASS scope=team + status=Pending", () => {
      const out = adjustmentListQuerySchema.parse({ scope: "team", status: "Pending" });
      expect(out.scope).toBe("team");
      expect(out.status).toBe("Pending");
    });
  });

  describe("approveAdjustmentSchema / rejectAdjustmentSchema — §7.6 quy tắc 7", () => {
    it("approve: note optional — PASS body rỗng", () => {
      expect(approveAdjustmentSchema.parse({})).toEqual({});
    });

    it("reject: REJECT thiếu reason (bắt buộc review_note khi Rejected)", () => {
      expect(() => rejectAdjustmentSchema.parse({})).toThrow();
    });

    it("reject: REJECT reason rỗng", () => {
      expect(() => rejectAdjustmentSchema.parse({ reason: "" })).toThrow();
    });

    it("reject: PASS reason hợp lệ", () => {
      const out = rejectAdjustmentSchema.parse({ reason: "Không đủ căn cứ" });
      expect(out.reason).toBe("Không đủ căn cứ");
    });
  });

  describe("directAdjustSchema — ATT-FUNC-021", () => {
    it("REJECT thiếu cả recordId lẫn (employeeId+workDate)", () => {
      expect(() =>
        directAdjustSchema.parse({
          items: [{ fieldName: "checkInAt", newValue: "2026-07-01T01:00:00.000Z" }],
          reason: "chỉnh trực tiếp",
        }),
      ).toThrow();
    });

    it("REJECT items rỗng", () => {
      expect(() =>
        directAdjustSchema.parse({
          recordId: "11111111-1111-1111-1111-111111111111",
          items: [],
          reason: "chỉnh trực tiếp",
        }),
      ).toThrow();
    });

    it("REJECT thiếu reason", () => {
      expect(() =>
        directAdjustSchema.parse({
          recordId: "11111111-1111-1111-1111-111111111111",
          items: [{ fieldName: "checkInAt", newValue: "2026-07-01T01:00:00.000Z" }],
        }),
      ).toThrow();
    });

    it("PASS xác định qua recordId", () => {
      const out = directAdjustSchema.parse({
        recordId: "11111111-1111-1111-1111-111111111111",
        items: [{ fieldName: "checkInAt", newValue: "2026-07-01T01:00:00.000Z" }],
        reason: "chỉnh trực tiếp do lỗi thiết bị",
      });
      expect(out.recordId).toBe("11111111-1111-1111-1111-111111111111");
    });

    it("PASS xác định qua (employeeId + workDate) khi chưa có record", () => {
      const out = directAdjustSchema.parse({
        employeeId: "22222222-2222-2222-2222-222222222222",
        workDate: "2026-07-01",
        items: [{ fieldName: "note", newValue: "đã xác nhận thủ công" }],
        reason: "chưa phát sinh record",
      });
      expect(out.workDate).toBe("2026-07-01");
    });
  });

  describe("attendanceAdjustmentRequestDetailSchema / listItemSchema — kèm items[]", () => {
    const baseDetail = {
      id: "11111111-1111-1111-1111-111111111111",
      requestCode: "ADJ-000001",
      employeeId: "22222222-2222-2222-2222-222222222222",
      employeeCode: "EMP001",
      fullName: "Nguyễn Văn A",
      attendanceRecordId: null,
      workDate: "2026-07-01",
      requestType: "MISSING_CHECK_IN" as const,
      requestedCheckInAt: "2026-07-01T01:00:00.000Z",
      requestedCheckOutAt: null,
      reason: "quên check-in",
      status: "Pending" as const,
      submittedAt: "2026-07-01T02:00:00.000Z",
      requestedBy: "22222222-2222-2222-2222-222222222222",
      currentApproverUserId: "33333333-3333-3333-3333-333333333333",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      attachmentFileId: null,
      createdAt: "2026-07-01T02:00:00.000Z",
      updatedAt: "2026-07-01T02:00:00.000Z",
    };

    it("PASS detail kèm items[] rỗng (Pending, chưa duyệt)", () => {
      const out = attendanceAdjustmentRequestDetailSchema.parse({ ...baseDetail, items: [] });
      expect(out.items).toEqual([]);
      expect(out.status).toBe("Pending");
    });

    it("PASS detail kèm items[] đã áp dụng (Approved)", () => {
      const out = attendanceAdjustmentRequestDetailSchema.parse({
        ...baseDetail,
        status: "Approved",
        reviewedBy: "33333333-3333-3333-3333-333333333333",
        reviewedAt: "2026-07-01T03:00:00.000Z",
        reviewNote: "Đã xác minh",
        items: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            fieldName: "checkInAt",
            oldValue: null,
            newValue: "2026-07-01T01:00:00.000Z",
            appliedValue: "2026-07-01T01:00:00.000Z",
            isApplied: true,
            note: null,
            createdAt: "2026-07-01T03:00:00.000Z",
          },
        ],
      });
      expect(out.items[0].isApplied).toBe(true);
    });

    it("REJECT status ngoài canonical FSM", () => {
      expect(() =>
        attendanceAdjustmentRequestDetailSchema.parse({
          ...baseDetail,
          status: "pending",
          items: [],
        }),
      ).toThrow();
    });

    it("attendanceAdjustmentListItemSchema KHÔNG có items[] (gọn cho list)", () => {
      const out = attendanceAdjustmentListItemSchema.parse(baseDetail) as Record<string, unknown>;
      expect(out).not.toHaveProperty("items");
      expect(out.id).toBe(baseDetail.id);
    });
  });

  it("5 status canonical khớp FSM DB-04 §7.6", () => {
    expect(ATTENDANCE_ADJUSTMENT_STATUSES).toEqual([
      "Draft",
      "Pending",
      "Approved",
      "Rejected",
      "Cancelled",
    ]);
  });
});
