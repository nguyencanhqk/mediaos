import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIT_PAGE_LIMIT,
  MAX_AUDIT_PAGE_LIMIT,
  auditLogListResponseSchema,
  auditLogQuerySchema,
  queueStatusResponseSchema,
} from "./observability";

describe("AC-8 observability contracts", () => {
  describe("auditLogQuerySchema", () => {
    it("parse input rỗng → default limit/offset", () => {
      const q = auditLogQuerySchema.parse({});
      expect(q.limit).toBe(DEFAULT_AUDIT_PAGE_LIMIT);
      expect(q.offset).toBe(0);
    });

    it("parse filter hợp lệ (action/objectType/objectId/actorUserId/companyId/date)", () => {
      const q = auditLogQuerySchema.parse({
        action: "operator.audit_read",
        objectType: "company",
        objectId: "00000000-0000-0000-0000-000000000001",
        actorUserId: "00000000-0000-0000-0000-000000000002",
        companyId: "00000000-0000-0000-0000-000000000003",
        dateFrom: "2026-06-01T00:00:00.000Z",
        dateTo: "2026-06-30T00:00:00.000Z",
        limit: 25,
        offset: 10,
      });
      expect(q.limit).toBe(25);
      expect(q.action).toBe("operator.audit_read");
    });

    it("coerce limit từ query string", () => {
      const q = auditLogQuerySchema.parse({ limit: "30", offset: "5" });
      expect(q.limit).toBe(30);
      expect(q.offset).toBe(5);
    });

    it("REJECT objectId không phải uuid", () => {
      expect(auditLogQuerySchema.safeParse({ objectId: "not-a-uuid" }).success).toBe(false);
    });

    it("REJECT actorUserId không phải uuid", () => {
      expect(auditLogQuerySchema.safeParse({ actorUserId: "nope" }).success).toBe(false);
    });

    it("REJECT limit > MAX (row cap §8.3)", () => {
      expect(auditLogQuerySchema.safeParse({ limit: MAX_AUDIT_PAGE_LIMIT + 1 }).success).toBe(
        false,
      );
    });

    it("REJECT limit < 1", () => {
      expect(auditLogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    });

    it("REJECT offset âm", () => {
      expect(auditLogQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    });

    it("REJECT dateFrom > dateTo (dải đảo ngược)", () => {
      const res = auditLogQuerySchema.safeParse({
        dateFrom: "2026-06-30T00:00:00.000Z",
        dateTo: "2026-06-01T00:00:00.000Z",
      });
      expect(res.success).toBe(false);
    });

    // ── §8.5 filter mới (mig 0438): actionGroup/permissionCode/dataScope ──
    it("parse filter §8.5 mới (actionGroup/permissionCode/dataScope)", () => {
      const q = auditLogQuerySchema.parse({
        actionGroup: "auth",
        permissionCode: "HR.EMPLOYEE.VIEW",
        dataScope: "Company",
      });
      expect(q.actionGroup).toBe("auth");
      expect(q.permissionCode).toBe("HR.EMPLOYEE.VIEW");
      expect(q.dataScope).toBe("Company");
    });

    it("REJECT dataScope ngoài enum (fail-closed §8.5)", () => {
      expect(auditLogQuerySchema.safeParse({ dataScope: "Galaxy" }).success).toBe(false);
    });

    it.each(["Own", "Team", "Department", "Company", "System"])(
      "ACCEPT dataScope hợp lệ '%s'",
      (scope) => {
        expect(auditLogQuerySchema.safeParse({ dataScope: scope }).success).toBe(true);
      },
    );
  });

  describe("auditLogDtoSchema / auditLogListResponseSchema", () => {
    /** Hàng audit như AuditQueryService.toDto sản xuất: v1 + MỌI cột v2 (null khi legacy/caller chỉ-v1). */
    const v2NullFields = {
      moduleCode: null,
      entityType: null,
      entityId: null,
      actorType: null,
      oldValues: null,
      newValues: null,
      changedFields: null,
      sensitivityLevel: null,
      resultStatus: null,
      requestId: null,
      correlationId: null,
      ipAddress: null,
      // §8.5 mig 0438
      actorEmployeeId: null,
      actionGroup: null,
      entityIdText: null,
      entityCode: null,
      permissionCode: null,
      dataScope: null,
      deviceInfo: null,
      diffSummary: null,
      errorCode: null,
      errorMessage: null,
      metadata: null,
    };

    function baseRow(): Record<string, unknown> {
      return {
        id: "00000000-0000-0000-0000-000000000001",
        companyId: "00000000-0000-0000-0000-000000000002",
        actorUserId: null,
        action: "TaskCreated",
        objectType: "task",
        objectId: null,
        before: null,
        after: { title: "x" },
        ip: null,
        userAgent: null,
        ...v2NullFields,
        createdAt: "2026-06-17T00:00:00.000Z",
      };
    }

    it("parse response hợp lệ (hàng legacy: mọi cột v2 = null)", () => {
      const res = auditLogListResponseSchema.parse({
        data: [baseRow()],
        meta: { total: 1, limit: 50, offset: 0 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it("parse DTO với §8.5 mig 0438 đầy đủ (actorEmployeeId/dataScope/deviceInfo/metadata…)", () => {
      const res = auditLogListResponseSchema.parse({
        data: [
          {
            ...baseRow(),
            actorEmployeeId: "00000000-0000-0000-0000-0000000000aa",
            actionGroup: "auth",
            entityIdText: "EMP-001",
            entityCode: "EMP-001",
            permissionCode: "HR.EMPLOYEE.VIEW",
            dataScope: "Company",
            deviceInfo: { browser: "chrome", token: "***" },
            diffSummary: "name changed",
            errorCode: "AUTH-ERR-001",
            errorMessage: "denied",
            metadata: { reason: "ok" },
          },
        ],
        meta: { total: 1, limit: 50, offset: 0 },
      });
      const row = res.data[0];
      expect(row.actorEmployeeId).toBe("00000000-0000-0000-0000-0000000000aa");
      expect(row.dataScope).toBe("Company");
      expect(row.deviceInfo).toEqual({ browser: "chrome", token: "***" });
      expect(row.metadata).toEqual({ reason: "ok" });
    });

    it("REJECT actorEmployeeId không phải uuid", () => {
      const res = auditLogListResponseSchema.safeParse({
        data: [{ ...baseRow(), actorEmployeeId: "not-a-uuid" }],
        meta: { total: 1, limit: 50, offset: 0 },
      });
      expect(res.success).toBe(false);
    });
  });

  describe("queueStatusResponseSchema", () => {
    it("parse queue status hợp lệ", () => {
      const res = queueStatusResponseSchema.parse({
        outbox: {
          counts: [
            { status: "pending", count: 3 },
            { status: "done", count: 10 },
          ],
          total: 13,
        },
        deadLetter: {
          unresolved: 1,
          total: 2,
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              companyId: "00000000-0000-0000-0000-000000000002",
              eventId: "00000000-0000-0000-0000-000000000003",
              consumerName: "webhook-fanout",
              eventType: "task.created",
              error: "timeout",
              createdAt: "2026-06-17T00:00:00.000Z",
              resolvedAt: null,
            },
          ],
        },
      });
      expect(res.outbox.total).toBe(13);
      expect(res.deadLetter.unresolved).toBe(1);
    });
  });
});
