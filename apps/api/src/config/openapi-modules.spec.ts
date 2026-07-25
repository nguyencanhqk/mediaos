import { describe, expect, it } from "vitest";
import {
  API_MODULE_TAGS,
  UNCLASSIFIED_PREFIX,
  buildDocumentTags,
  firstPathSegment,
  moduleForPath,
  subAreaFromOperationId,
  tagForOperation,
} from "./openapi-modules";

/**
 * S5-BE-CONTRACT-1 — Bất biến của registry module (xem ghi chú đầu `openapi-modules.ts`).
 * Registry là bảng tay ⇒ test giữ nó không tự mâu thuẫn khi module mới được thêm.
 */
describe("openapi-modules — bất biến registry", () => {
  it("mỗi segment CHỈ thuộc đúng 1 module (không nhập nhằng khi suy tag)", () => {
    const owner = new Map<string, string>();
    const conflicts: string[] = [];
    for (const mod of API_MODULE_TAGS) {
      for (const seg of mod.segments) {
        const prev = owner.get(seg);
        if (prev !== undefined) conflicts.push(`'${seg}' ở cả ${prev} và ${mod.code}`);
        owner.set(seg, mod.code);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("mã module và tiền tố tag đều DUY NHẤT", () => {
    const codes = API_MODULE_TAGS.map((m) => m.code);
    const prefixes = API_MODULE_TAGS.map((m) => m.tagPrefix);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("tiền tố tag khớp bảng BACKEND-12 §9.1 cho 7 module MVP + Foundation/Internal", () => {
    const byCode = new Map(API_MODULE_TAGS.map((m) => [m.code, m.tagPrefix]));
    const doc: Record<string, string> = {
      AUTH: "Auth",
      HR: "HR",
      ATT: "Attendance",
      LEAVE: "Leave",
      TASK: "Task",
      NOTI: "Notification",
      DASH: "Dashboard",
      FND: "Foundation",
      INTERNAL: "Internal",
    };
    for (const [code, prefix] of Object.entries(doc)) {
      expect(byCode.get(code), `tiền tố tag của ${code}`).toBe(prefix);
    }
  });

  it("phủ 7 module MVP của CLAUDE.md §1 + Foundation", () => {
    const codes = new Set(API_MODULE_TAGS.map((m) => m.code));
    for (const required of ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI", "FND"]) {
      expect(codes, `thiếu module ${required}`).toContain(required);
    }
  });

  it("buildDocumentTags dựng từ tag ĐÃ DÙNG + gán mô tả theo tiền tố module", () => {
    const tags = buildDocumentTags(["Leave - Leave", "Auth - Auth", "Auth - Auth"]);
    // Khử trùng lặp + sắp xếp ổn định để Swagger UI không nhảy thứ tự giữa các lần sinh.
    expect(tags.map((t) => t.name)).toEqual(["Auth - Auth", "Leave - Leave"]);
    expect(tags[0].description).toBe(
      API_MODULE_TAGS.find((m) => m.code === "AUTH")?.description,
    );
  });

  it("buildDocumentTags: tag không thuộc module nào vẫn có mặt (mô tả rỗng, không ném)", () => {
    expect(buildDocumentTags(["Khác - Gì Đó"])).toEqual([{ name: "Khác - Gì Đó", description: "" }]);
  });
});

describe("firstPathSegment — bóc segment sau global prefix", () => {
  it("bỏ prefix khi path CÓ prefix", () => {
    expect(firstPathSegment("/api/v1/auth/login", "api/v1")).toBe("auth");
  });

  it("giữ nguyên khi path KHÔNG có prefix (doc sinh ở app chưa setGlobalPrefix)", () => {
    expect(firstPathSegment("/auth/login", "api/v1")).toBe("auth");
  });

  it("không bỏ nhầm khi segment đầu chỉ TRÙNG MỘT PHẦN prefix", () => {
    // `/api/health` KHÔNG khớp đủ cặp `api/v1` ⇒ không được cắt, segment đầu vẫn là 'api'.
    expect(firstPathSegment("/api/health", "api/v1")).toBe("api");
  });

  it("path rỗng → chuỗi rỗng (không ném)", () => {
    expect(firstPathSegment("/", "api/v1")).toBe("");
  });
});

describe("subAreaFromOperationId — vùng nghiệp vụ suy từ tên controller", () => {
  it.each([
    ["AuthController_login", "Auth"],
    ["AuthLogsViewerController_list", "Auth Logs Viewer"],
    ["HrWriteController_createEmployee", "Hr Write"],
    ["LmsSsoController_link", "Lms Sso"],
  ])("%s → '%s'", (operationId, expected) => {
    expect(subAreaFromOperationId(operationId)).toBe(expected);
  });

  it("operationId vắng/rỗng → null (caller dùng riêng tiền tố module)", () => {
    expect(subAreaFromOperationId(undefined)).toBeNull();
    expect(subAreaFromOperationId("")).toBeNull();
  });
});

describe("tagForOperation — BACKEND-12 §9.1 '<tiền tố> - <vùng>'", () => {
  it("ghép tiền tố module với vùng nghiệp vụ", () => {
    expect(tagForOperation("/api/v1/attendance/check-in", "AttendanceController_checkIn", "api/v1")).toBe(
      "Attendance - Attendance",
    );
    expect(tagForOperation("/api/v1/hr/employees", "HrWriteController_createEmployee", "api/v1")).toBe(
      "HR - Hr Write",
    );
  });

  it("segment CHƯA khai → tiền tố 'Khác' (e2e coi là lỗi)", () => {
    expect(tagForOperation("/api/v1/chua-khai/x", "FooController_bar", "api/v1")).toBe(
      `${UNCLASSIFIED_PREFIX} - Foo`,
    );
  });

  it("không có operationId → chỉ tiền tố module", () => {
    expect(tagForOperation("/api/v1/leave/requests", undefined, "api/v1")).toBe("Leave");
  });
});

describe("moduleForPath", () => {
  it.each([
    ["/api/v1/auth/login", "AUTH"],
    ["/api/v1/hr/employees", "HR"],
    ["/api/v1/attendance/check-in", "ATT"],
    ["/api/v1/leave/requests", "LEAVE"],
    ["/api/v1/tasks/123", "TASK"],
    ["/api/v1/dashboard/me", "DASH"],
    ["/api/v1/notifications", "NOTI"],
    ["/api/v1/foundation/settings", "FND"],
    ["/api/v1/me/overview", "ME"],
    ["/api/v1/goals", "GOAL"],
  ])("%s → module %s", (path, code) => {
    expect(moduleForPath(path, "api/v1")?.code).toBe(code);
  });

  it("segment CHƯA khai → null (e2e coi là lỗi)", () => {
    expect(moduleForPath("/api/v1/chua-khai/abc", "api/v1")).toBeNull();
  });
});
