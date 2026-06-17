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
      expect(
        auditLogQuerySchema.safeParse({ limit: MAX_AUDIT_PAGE_LIMIT + 1 }).success,
      ).toBe(false);
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
  });

  describe("auditLogListResponseSchema", () => {
    it("parse response hợp lệ", () => {
      const res = auditLogListResponseSchema.parse({
        data: [
          {
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
            createdAt: "2026-06-17T00:00:00.000Z",
          },
        ],
        meta: { total: 1, limit: 50, offset: 0 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
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
