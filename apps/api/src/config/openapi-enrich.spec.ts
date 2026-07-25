import type { OpenAPIObject } from "@nestjs/swagger";
import type { OperationObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { beforeEach, describe, expect, it } from "vitest";
import { COMPONENT_NAMES } from "./openapi-components";
import { enrichOpenApiDocument } from "./openapi-enrich";
import { UNCLASSIFIED_PREFIX } from "./openapi-modules";
import type { RouteAuthMeta } from "./openapi-route-meta";

/**
 * S5-BE-CONTRACT-1 — enrich chạy trên document TỔNG HỢP (không cần boot Nest).
 * Phủ e2e ở `test/foundation/openapi-contract.e2e-spec.ts` (document THẬT, 441 operation).
 */

const PREFIX = "api/v1";

function meta(over: Partial<RouteAuthMeta> & { operationId: string }): RouteAuthMeta {
  return { isPublic: false, permission: null, isIdempotent: false, ...over };
}

/** Document tối thiểu đủ 4 tình huống: công khai · có quyền · có path param · có request body. */
function buildDoc(): OpenAPIObject {
  return {
    openapi: "3.0.0",
    info: { title: "t", version: "v1" },
    paths: {
      "/api/v1/auth/login": {
        post: {
          operationId: "AuthController_login",
          requestBody: { content: {} },
          responses: { "200": { description: "" } },
          tags: ["AuthController"],
        },
        // Khoá KHÔNG phải HTTP method — enrich PHẢI bỏ qua (không đếm thành operation).
        parameters: [],
      },
      "/api/v1/tasks/{id}": {
        get: {
          operationId: "TaskController_findOne",
          parameters: [{ name: "id", in: "path", required: true }],
          responses: { "200": { description: "" } },
          tags: ["TaskController"],
        },
      },
      "/api/v1/attendance/check-in": {
        post: {
          operationId: "AttendanceController_checkIn",
          responses: { "201": { description: "" }, "409": { description: "Đã check-in" } },
          tags: ["AttendanceController"],
        },
      },
      "/api/v1/chua-khai/x": {
        delete: {
          operationId: "UnknownController_remove",
          responses: { "204": { description: "" } },
          tags: ["UnknownController"],
        },
      },
    },
  } as unknown as OpenAPIObject;
}

const ROUTE_META = new Map<string, RouteAuthMeta>([
  ["AuthController_login", meta({ operationId: "AuthController_login", isPublic: true })],
  [
    "TaskController_findOne",
    meta({
      operationId: "TaskController_findOne",
      permission: { action: "read", resourceType: "task" },
    }),
  ],
  [
    "AttendanceController_checkIn",
    meta({
      operationId: "AttendanceController_checkIn",
      isIdempotent: true,
      permission: {
        action: "check-in",
        resourceType: "attendance",
        isSensitive: true,
        requiresReauth: true,
      },
    }),
  ],
  // UnknownController_remove CỐ Ý VẮNG → kiểm tra nhánh unmatched.
]);

describe("enrichOpenApiDocument", () => {
  let doc: OpenAPIObject;
  let report: ReturnType<typeof enrichOpenApiDocument>;
  const op = (path: string, method: string): OperationObject =>
    (doc.paths[path] as Record<string, OperationObject>)[method];

  beforeEach(() => {
    doc = buildDoc();
    report = enrichOpenApiDocument(doc, ROUTE_META, PREFIX);
  });

  it("đếm đúng operation, BỎ QUA khoá không phải HTTP method", () => {
    // 4 operation thật; `parameters` cạnh `post` KHÔNG được tính.
    expect(report.operations).toBe(4);
    expect(report.matched).toBe(3);
    expect(report.unmatched).toEqual(["UnknownController_remove"]);
    expect(report.publicOperations).toBe(1);
    expect(report.withPermission).toBe(2);
  });

  it("route công khai: security rỗng, KHÔNG gắn 401, ghi rõ 'công khai'", () => {
    const login = op("/api/v1/auth/login", "post");
    expect(login.security).toEqual([]);
    expect(login.responses["401"]).toBeUndefined();
    expect(login.description).toContain("công khai");
  });

  it("route cần auth: yêu cầu bearer + 401", () => {
    const task = op("/api/v1/tasks/{id}", "get");
    expect(task.security).toEqual([{ bearer: [] }]);
    expect(task.responses["401"]).toBeDefined();
  });

  it("route có @RequirePermission: 403 + chú thích quyền + extension máy-đọc (BACKEND-12 §11.1)", () => {
    const task = op("/api/v1/tasks/{id}", "get");
    const ext = task as unknown as Record<string, unknown>;
    expect(task.responses["403"]).toBeDefined();
    expect(task.description).toContain("`read:task`");
    // CẶP ENGINE THẬT (thứ PermissionGuard so khớp với seed), KHÔNG phải dạng chấm minh hoạ.
    expect(ext["x-required-permission"]).toBe("read:task");
    expect(ext["x-module"]).toBe("TASK");
    expect(ext["x-auth-required"]).toBe(true);
    expect(ext["x-internal"]).toBe(false);
  });

  it("route công khai: x-auth-required=false, x-required-permission=null", () => {
    const ext = op("/api/v1/auth/login", "post") as unknown as Record<string, unknown>;
    expect(ext["x-auth-required"]).toBe(false);
    expect(ext["x-required-permission"]).toBeNull();
  });

  it("KHÔNG bịa x-data-scope/x-audit-log (không suy được từ metadata route)", () => {
    const ext = op("/api/v1/tasks/{id}", "get") as unknown as Record<string, unknown>;
    expect(ext["x-data-scope"]).toBeUndefined();
    expect(ext["x-audit-log"]).toBeUndefined();
  });

  it("cờ isSensitive/requiresReauth hiện thành chú thích + extension riêng", () => {
    const checkIn = op("/api/v1/attendance/check-in", "post");
    const ext = checkIn as unknown as Record<string, unknown>;
    expect(checkIn.description).toContain("is_sensitive");
    expect(checkIn.description).toContain("Re-auth");
    expect(ext["x-permission-sensitive"]).toBe(true);
    expect(ext["x-reauth-required"]).toBe(true);
    expect(ext["x-idempotency-required"]).toBe(true);
  });

  it("route KHÔNG idempotent/không nhạy cảm: KHÔNG phát cờ false gây nhiễu", () => {
    const ext = op("/api/v1/tasks/{id}", "get") as unknown as Record<string, unknown>;
    expect(ext["x-idempotency-required"]).toBeUndefined();
    expect(ext["x-permission-sensitive"]).toBeUndefined();
    expect(ext["x-reauth-required"]).toBeUndefined();
  });

  it("route KHÔNG khai permission: KHÔNG gắn 403 (không tài liệu hoá lỗi không xảy ra)", () => {
    const login = op("/api/v1/auth/login", "post");
    expect(login.responses["403"]).toBeUndefined();
  });

  it("400 chỉ khi có request body hoặc tham số; 404 chỉ khi path có tham số", () => {
    expect(op("/api/v1/auth/login", "post").responses["400"]).toBeDefined(); // có requestBody
    expect(op("/api/v1/tasks/{id}", "get").responses["400"]).toBeDefined(); // có parameters
    expect(op("/api/v1/tasks/{id}", "get").responses["404"]).toBeDefined(); // path có {id}
    const checkIn = op("/api/v1/attendance/check-in", "post");
    expect(checkIn.responses["400"]).toBeUndefined(); // không body, không param
    expect(checkIn.responses["404"]).toBeUndefined(); // path tĩnh
  });

  it("500 gắn cho MỌI operation (kể cả operation không nối được metadata)", () => {
    expect(op("/api/v1/auth/login", "post").responses["500"]).toBeDefined();
    expect(op("/api/v1/chua-khai/x", "delete").responses["500"]).toBeDefined();
  });

  it("KHÔNG ghi đè phản hồi controller đã tự khai (409 giữ nguyên mô tả gốc)", () => {
    expect(op("/api/v1/attendance/check-in", "post").responses["409"]).toEqual({
      description: "Đã check-in",
    });
  });

  it("điền description + schema envelope cho 2xx rỗng; 204 KHÔNG gắn body", () => {
    const login = op("/api/v1/auth/login", "post");
    const ok = login.responses["200"] as { description: string; content?: Record<string, unknown> };
    expect(ok.description).toContain("envelope");
    expect(ok.content?.["application/json"]).toEqual({
      schema: { $ref: `#/components/schemas/${COMPONENT_NAMES.successEnvelope}` },
    });
    const noContent = op("/api/v1/chua-khai/x", "delete").responses["204"] as {
      description: string;
      content?: unknown;
    };
    expect(noContent.description).toContain("không có nội dung");
    expect(noContent.content).toBeUndefined();
  });

  it("route @Idempotent: thêm header Idempotency-Key + 409 + ghi chú, KHÔNG lan sang route khác", () => {
    const checkIn = op("/api/v1/attendance/check-in", "post");
    const header = (checkIn.parameters ?? []).find(
      (p) => (p as { name?: string }).name === "Idempotency-Key",
    ) as { in?: string; required?: boolean } | undefined;
    expect(header).toBeDefined();
    expect(header?.in).toBe("header");
    expect(header?.required).toBe(false); // BACK-COMPAT: không bắt buộc
    expect(checkIn.responses["409"]).toBeDefined();
    expect(checkIn.description).toContain("Idempotency");

    // Route KHÔNG @Idempotent: không có header, không có 409 tự sinh.
    const task = op("/api/v1/tasks/{id}", "get");
    expect(
      (task.parameters ?? []).some((p) => (p as { name?: string }).name === "Idempotency-Key"),
    ).toBe(false);
    expect(task.responses["409"]).toBeUndefined();
  });

  it("header idempotency KHÔNG kéo theo 400 oan (route không có body/param khác)", () => {
    // check-in trong doc mẫu KHÔNG có requestBody/parameters ⇒ 400 không được sinh chỉ vì thêm header.
    expect(op("/api/v1/attendance/check-in", "post").responses["400"]).toBeUndefined();
  });

  it("tag đổi sang '<tiền tố module> - <vùng>' (BACKEND-12 §9.1), segment lạ → tiền tố 'Khác'", () => {
    expect(op("/api/v1/auth/login", "post").tags?.[0]).toBe("Auth - Auth");
    expect(op("/api/v1/tasks/{id}", "get").tags?.[0]).toBe("Task - Task");
    expect(op("/api/v1/chua-khai/x", "delete").tags?.[0]).toBe(`${UNCLASSIFIED_PREFIX} - Unknown`);
  });

  it("tags[] cấp tài liệu = đúng tập tag ĐÃ DÙNG (không thừa nhóm rỗng trong Swagger UI)", () => {
    const used = new Set(
      Object.values(doc.paths).flatMap((item) =>
        Object.values(item as Record<string, OperationObject>)
          .filter((o) => o?.tags !== undefined)
          .flatMap((o) => o.tags ?? []),
      ),
    );
    expect(new Set((doc.tags ?? []).map((t) => t.name))).toEqual(used);
  });

  it("operation KHÔNG nối được metadata: KHÔNG đoán bừa security/quyền", () => {
    const unknown = op("/api/v1/chua-khai/x", "delete");
    expect(unknown.security).toBeUndefined();
    expect((unknown as unknown as Record<string, unknown>)["x-required-permission"]).toBeUndefined();
  });

  it("nạp component envelope + tags cấp tài liệu, KHÔNG đè schema DTO sẵn có", () => {
    doc = buildDoc();
    doc.components = { schemas: { LoginDto: { type: "object" } } };
    enrichOpenApiDocument(doc, ROUTE_META, PREFIX);
    const schemas = doc.components?.schemas ?? {};
    expect(schemas.LoginDto).toEqual({ type: "object" });
    expect(schemas[COMPONENT_NAMES.errorEnvelope]).toBeDefined();
    expect(schemas[COMPONENT_NAMES.pagination]).toBeDefined();
    expect((doc.tags ?? []).length).toBeGreaterThan(0);
    expect(doc.info.description).toContain("Envelope");
  });

  it("idempotent: chạy 2 lần KHÔNG nhân đôi chú thích quyền", () => {
    const before = op("/api/v1/tasks/{id}", "get").description;
    enrichOpenApiDocument(doc, ROUTE_META, PREFIX);
    expect(op("/api/v1/tasks/{id}", "get").description).toBe(before);
  });
});
