/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — Phủ HỢP ĐỒNG OpenAPI trên document THẬT (441 operation).
 *
 * Khác `openapi-docs.e2e-spec.ts` (env-gate + vệ sinh schema, S2-FND-CONTRACT-1): file này khẳng định
 * TÍNH ĐẦY ĐỦ của tài liệu — mọi endpoint phải nói được "cần đăng nhập không · cần quyền gì · lỗi trả
 * hình dạng nào", và đường dẫn tài liệu phải KHỚP đường dẫn server thật.
 *
 * KHÔNG cần Postgres (chỉ quét metadata controller/DTO như openapi-docs.e2e-spec) ⇒ CHẠY trong suite mặc
 * định, không `skipIf(!hasDb)`.
 *
 * BẪY ĐÃ VÁ (chính file này bảo vệ): document nối với metadata quyền qua `operationId` mặc định của
 * swagger (`<Class>_<method>`). Nếu quy ước đó đổi ở bản swagger sau, phép nối trượt TOÀN BỘ và tài liệu
 * mất chú thích quyền TRONG IM LẶNG — assert "mọi operation đều có `security`" bên dưới biến việc đó
 * thành ĐỎ.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { loadEnv } from "../../src/config/env.schema";
import { COMPONENT_NAMES } from "../../src/config/openapi-components";
import { API_MODULE_TAGS, UNCLASSIFIED_PREFIX } from "../../src/config/openapi-modules";
import { setupSwagger } from "../../src/config/swagger";

interface Operation {
  operationId?: string;
  tags?: string[];
  security?: unknown[];
  description?: string;
  parameters?: unknown[];
  responses?: Record<string, unknown>;
  "x-required-permission"?: string | null;
  "x-module"?: string | null;
  "x-auth-required"?: boolean;
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, unknown> };
  tags?: { name: string }[];
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Mọi operation của document kèm path/method để thông điệp lỗi chỉ đúng chỗ. */
function allOperations(doc: OpenApiDoc): { path: string; method: string; op: Operation }[] {
  const out: { path: string; method: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (HTTP_METHODS.has(method)) out.push({ path, method, op });
    }
  }
  return out;
}

/** Nhãn ngắn cho thông điệp assert. */
const label = (e: { path: string; method: string; op: Operation }): string =>
  `${e.method.toUpperCase()} ${e.path} (${e.op.operationId ?? "?"})`;

describe("OpenAPI contract (e2e) — độ phủ auth/quyền/lỗi trên document thật", () => {
  let app: INestApplication;
  let doc: OpenApiDoc;
  let ops: { path: string; method: string; op: Operation }[];
  let globalPrefix: string;

  beforeAll(async () => {
    const env = loadEnv();
    globalPrefix = `${env.API_PREFIX}/${env.API_VERSION}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // MIRROR main.ts: setGlobalPrefix TRƯỚC setupSwagger — thứ tự này quyết định path trong document.
    app.setGlobalPrefix(globalPrefix);
    expect(setupSwagger(app, "development")).toBe(true);
    await app.init();

    const res = await request(app.getHttpServer()).get("/docs-json");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    doc = res.body as OpenApiDoc;
    ops = allOperations(doc);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("non-vacuous: document có lượng operation đáng kể (chống assert trên tập rỗng)", () => {
    // Baseline đo được 2026-07-25: 340 path / 441 operation. Ngưỡng đặt thấp hơn nhiều để không
    // giòn khi thêm/bớt endpoint, nhưng đủ chặn trường hợp document rỗng/hỏng.
    expect(ops.length).toBeGreaterThan(300);
  });

  it("đường dẫn tài liệu KHỚP đường dẫn server (có global prefix)", () => {
    const missing = Object.keys(doc.paths ?? {}).filter((p) => !p.startsWith(`/${globalPrefix}/`));
    expect(missing, `path thiếu prefix /${globalPrefix}: ${missing.slice(0, 5).join(", ")}`).toEqual(
      [],
    );
  });

  it("MỌI operation khai `security` (⇒ nối được metadata guard qua operationId)", () => {
    const missing = ops.filter((e) => e.op.security === undefined).map(label);
    expect(missing, `operation KHÔNG nối được metadata: ${missing.slice(0, 5).join(" | ")}`).toEqual(
      [],
    );
  });

  it("MỌI operation có mô tả + phản hồi 500 (envelope lỗi chuẩn)", () => {
    const noDesc = ops.filter((e) => !e.op.description).map(label);
    const no500 = ops.filter((e) => e.op.responses?.["500"] === undefined).map(label);
    expect(noDesc.slice(0, 5)).toEqual([]);
    expect(no500.slice(0, 5)).toEqual([]);
  });

  it("route CẦN auth → có 401; route công khai → KHÔNG có 401", () => {
    const isPublic = (op: Operation): boolean =>
      Array.isArray(op.security) && op.security.length === 0;
    const authedNo401 = ops
      .filter((e) => !isPublic(e.op) && e.op.responses?.["401"] === undefined)
      .map(label);
    const publicWith401 = ops
      .filter((e) => isPublic(e.op) && e.op.responses?.["401"] !== undefined)
      .map(label);
    expect(authedNo401.slice(0, 5)).toEqual([]);
    expect(publicWith401.slice(0, 5)).toEqual([]);

    // Non-vacuous 2 chiều: phải TỒN TẠI cả route công khai (login/refresh) lẫn route cần auth.
    expect(ops.some((e) => isPublic(e.op))).toBe(true);
    expect(ops.some((e) => !isPublic(e.op))).toBe(true);
  });

  it("route có chú thích quyền → có 403 và mô tả nêu đúng cặp `action:resource`", () => {
    const withPerm = ops.filter(
      (e) => e.op["x-required-permission"] !== undefined && e.op["x-required-permission"] !== null,
    );
    expect(withPerm.length).toBeGreaterThan(100); // baseline: 387

    const no403 = withPerm.filter((e) => e.op.responses?.["403"] === undefined).map(label);
    expect(no403.slice(0, 5)).toEqual([]);

    const descMismatch = withPerm
      .filter((e) => !(e.op.description ?? "").includes(String(e.op["x-required-permission"])))
      .map(label);
    expect(descMismatch.slice(0, 5)).toEqual([]);
  });

  it("extension BACKEND-12 §11.1 có mặt trên MỌI operation nối được metadata", () => {
    const missing = ops
      .filter(
        (e) =>
          e.op["x-module"] === undefined ||
          e.op["x-auth-required"] === undefined ||
          e.op["x-required-permission"] === undefined,
      )
      .map(label);
    expect(missing.slice(0, 5)).toEqual([]);

    // x-auth-required PHẢI nhất quán với `security` (hai cách diễn đạt cùng một sự thật).
    const inconsistent = ops
      .filter((e) => {
        const isPublic = Array.isArray(e.op.security) && e.op.security.length === 0;
        return e.op["x-auth-required"] === isPublic;
      })
      .map(label);
    expect(inconsistent.slice(0, 5)).toEqual([]);
  });

  it("x-required-permission phản ánh ĐÚNG @RequirePermission của code (đối chiếu điểm)", () => {
    // ⚠️ NEO CŨ (ApprovalInboxController.approve → approve:approval-request) ĐÃ CHẾT: cả module
    // `approval/` bị gỡ ở S10-CLEAN-WORKFLOWCLUSTER-2. Neo mới phải là cặp của module ĐANG SỐNG,
    // nếu không `ops.find` trả undefined và ca này chỉ còn đo "không tìm thấy" — xanh-rỗng.
    // LeaveController.approve → approve:leave (SPEC-05, MVP lõi). Chính tả cặp khớp seed catalog;
    // đổi lệch một ký tự là 403 vĩnh viễn, đó chính là thứ ca này gác.
    const approve = ops.find((e) => e.op.operationId === "LeaveController_approveRequest");
    expect(approve, "không tìm thấy operation LeaveController_approveRequest").toBeDefined();
    expect(approve?.op["x-required-permission"]).toBe("approve:leave");
  });

  it("MỌI operation thuộc một module đã khai (không có nhóm 'chưa phân loại')", () => {
    const known = new Set(API_MODULE_TAGS.map((m) => m.tagPrefix));
    const unclassified = ops
      .filter((e) =>
        (e.op.tags ?? []).some((t) => {
          const prefix = t.split(" - ")[0];
          return prefix === UNCLASSIFIED_PREFIX || !known.has(prefix);
        }),
      )
      .map((e) => `${label(e)} → ${(e.op.tags ?? []).join(",")}`);
    expect(
      unclassified.slice(0, 8),
      "segment path mới chưa khai trong API_MODULE_TAGS (openapi-modules.ts)",
    ).toEqual([]);
  });

  it("tag theo đúng khuôn BACKEND-12 §9.1 `<tiền tố> - <vùng>`", () => {
    const malformed = ops
      .filter((e) => {
        const tag = e.op.tags?.[0] ?? "";
        return !/^[A-Za-zÀ-ỹ]+ - .+$/.test(tag);
      })
      .map((e) => `${label(e)} → ${e.op.tags?.[0] ?? "(không có tag)"}`);
    expect(malformed.slice(0, 5)).toEqual([]);
  });

  it("đủ endpoint cho 7 module MVP + Foundation (done_when WO)", () => {
    const perModule = new Map<string, number>();
    for (const e of ops) {
      const code = e.op["x-module"];
      if (typeof code === "string") perModule.set(code, (perModule.get(code) ?? 0) + 1);
    }
    for (const code of ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI", "FND"]) {
      expect(perModule.get(code) ?? 0, `module ${code} không có endpoint nào trong tài liệu`).toBeGreaterThan(0);
    }
  });

  it("ĐỦ mutation bắt buộc có idempotency theo IMPLEMENTATION-08 §13.2", () => {
    // Danh sách CHỐT theo bảng §13.2 ("Idempotency: Có cho check-in/out, tạo nghỉ, approve/reject nghỉ,
    // tạo task/employee"). Hai đường tạo nhân viên (`/employees` cũ và `/hr/employees`) đều được đánh dấu.
    const required = [
      "AttendanceController_checkIn",
      "AttendanceController_checkOut",
      "LeaveController_createRequest",
      "LeaveController_approveRequest",
      "LeaveController_rejectRequest",
      "TasksController_createTask",
      "EmployeesController_createEmployee",
      "HrWriteController_createEmployee",
    ];
    const byId = new Map(ops.map((e) => [e.op.operationId ?? "", e]));
    const missing: string[] = [];
    for (const id of required) {
      const entry = byId.get(id);
      if (entry === undefined) {
        missing.push(`${id} (không có trong document)`);
        continue;
      }
      const hasHeader = (entry.op.parameters ?? []).some(
        (p) => (p as { name?: string; in?: string }).name === "Idempotency-Key",
      );
      if (!hasHeader) missing.push(`${id} (thiếu header Idempotency-Key ⇒ thiếu @Idempotent)`);
      if (entry.op.responses?.["409"] === undefined) missing.push(`${id} (thiếu phản hồi 409)`);
    }
    expect(missing).toEqual([]);
  });

  it("component envelope + khối tags cấp tài liệu có mặt", () => {
    const schemas = doc.components?.schemas ?? {};
    for (const name of Object.values(COMPONENT_NAMES)) {
      expect(schemas[name], `thiếu component ${name}`).toBeDefined();
    }
    // tags[] cấp tài liệu = ĐÚNG tập tag đã dùng trên operation (không thừa nhóm rỗng, không thiếu mô tả).
    const usedTags = new Set(ops.flatMap((e) => e.op.tags ?? []));
    expect(new Set((doc.tags ?? []).map((t) => t.name))).toEqual(usedTags);
  });

  it("BẤT BIẾN #3: văn bản do WO này SINH RA không nội suy giá trị secret", () => {
    // PHẠM VI CÓ CHỦ Ý: chỉ soi phần văn bản mà lớp enrich tự sinh (mô tả operation · mô tả từng phản
    // hồi · x-permission). Vệ sinh của `components.schemas` (tên field DTO) đã do
    // `openapi-docs.e2e-spec.ts` phụ trách — KHÔNG lặp ở đây.
    //
    // KHÔNG grep cả document: `valueType` của Setting có enum hợp lệ `"SecretRef"` (kiểu giá trị cấu
    // hình, KHÔNG phải field bí mật) ⇒ grep toàn cục cho kết quả ĐỎ OAN. Bài học: denylist phải bám
    // đúng phần văn bản mình chịu trách nhiệm.
    const generated: string[] = [];
    for (const { op } of ops) {
      if (op.description !== undefined) generated.push(op.description);
      if (op["x-required-permission"] != null) generated.push(String(op["x-required-permission"]));
      for (const res of Object.values(op.responses ?? {})) {
        const description = (res as { description?: unknown }).description;
        if (typeof description === "string") generated.push(description);
      }
    }
    expect(generated.length).toBeGreaterThan(300); // non-vacuous

    const blob = generated.join("\n").toLowerCase();
    for (const forbidden of ["passwordhash", "password_hash", "secretref", "secret_ref", "bearer ey"]) {
      expect(blob, `LEAK '${forbidden}' trong văn bản tài liệu tự sinh`).not.toContain(forbidden);
    }
  });
});
