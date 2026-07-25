import type { OpenAPIObject } from "@nestjs/swagger";
import type {
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import {
  IDEMPOTENCY_ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_REPLAYED_HEADER,
} from "@mediaos/contracts";
import {
  COMPONENT_NAMES,
  STANDARD_ERROR_RESPONSES,
  envelopeComponents,
} from "./openapi-components";
import { buildDocumentTags, moduleForPath, tagForOperation } from "./openapi-modules";
import type { RouteAuthMeta } from "./openapi-route-meta";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — Làm giàu OpenAPI document SAU khi swagger sinh xong.
 *
 * BASELINE ĐO ĐƯỢC trước WO này (openapi.json sinh thật, 2026-07-25): 340 path / 441 operation —
 * 441 có tag (theo TÊN CLASS controller), **0** có `security`, **0** có `description`, **0** có phản hồi
 * lỗi (chỉ 200/201/202/204 với `description` RỖNG). Tức tài liệu nói được "gọi cái gì" nhưng KHÔNG nói
 * được "cần đăng nhập không · cần quyền gì · lỗi trả về hình dạng nào" — đúng 3 thứ FE cần để tích hợp.
 *
 * Cách làm: KHÔNG gắn tay decorator lên 78 controller (bloat + chắc chắn trôi khỏi hành vi thật). Thay
 * vào đó suy tất cả từ nguồn ĐANG ĐƯỢC THỰC THI lúc chạy:
 *   - `security`      ← `@Public()` (JwtAuthGuard toàn cục ⇒ mặc định là CẦN Bearer)
 *   - permission note ← `@RequirePermission(action, resourceType)` (chính metadata PermissionGuard đọc)
 *   - 401/403/400/404 ← suy từ 2 thứ trên + hình dạng operation (có body? có path param?)
 *   - 500 + envelope  ← bất biến của AllExceptionsFilter / ResponseEnvelopeInterceptor
 * ⇒ tài liệu không thể lệch với thực thi; thêm route mới tự động có tài liệu đúng.
 *
 * DEFERRED CÓ CHỦ Ý (không phải thiếu sót): hình dạng `data` của từng endpoint (response body) CHƯA được
 * tài liệu hoá — cần gắn `@ApiOkResponse({type})` per-endpoint cho 441 operation, khối lượng của một WO
 * riêng. Bản này tài liệu hoá ENVELOPE bao quanh `data` (đúng và đủ để FE viết lớp truyền tải), và
 * `packages/contracts` vẫn là nguồn sự thật hình dạng `data` cho client TypeScript.
 */

/** Kết quả làm giàu — dùng cho e2e/telemetry để chống "xanh giả" (0 operation vẫn PASS). */
export interface OpenApiEnrichReport {
  /** Tổng số operation trong document. */
  operations: number;
  /** Số operation nối được với metadata route (theo operationId). */
  matched: number;
  /** operationId có trong document nhưng KHÔNG tìm thấy metadata (quy ước operationId đã đổi?). */
  unmatched: string[];
  /** Số operation công khai (`@Public`). */
  publicOperations: number;
  /** Số operation có chú thích quyền (`@RequirePermission`). */
  withPermission: number;
}

/** Mô tả chung đặt ở đầu tài liệu — quy ước envelope/phân trang/mã lỗi/header (một chỗ, không lặp per-op). */
export const API_DESCRIPTION = [
  "Hệ thống quản lý doanh nghiệp nội bộ — API nội bộ (chỉ dev/staging; production KHÔNG mount tài liệu).",
  "",
  "### Envelope (API-01 §11/§12)",
  "Mọi phản hồi đều được bọc: thành công `{ success:true, message, data, error:null, meta }`,",
  "lỗi `{ success:false, message, data:null, error:{ code, message, type, details }, meta }`.",
  "`meta.request_id` echo lại header `X-Request-Id` của client — dùng để đối chiếu log server.",
  "",
  "### Phân trang (API-01 §16.1)",
  "Endpoint danh sách phân trang trả thêm khối `pagination` ở CẤP ĐỈNH envelope (sibling của `data`),",
  "KHÔNG nằm trong `meta`. Tham số truy vấn theo endpoint: `page`+`pageSize` (danh sách nghiệp vụ)",
  "hoặc `limit`+`offset` (audit/log) — hai quy ước song song có chủ ý (BACKEND-12 §15.1).",
  "",
  "### Mã lỗi",
  "`error.code` ổn định theo SPEC-01 §9 (`MODULE-ERR-XXX`). Client PHẢI bắt theo `error.code` +",
  "HTTP status, KHÔNG so khớp `error.message`. Ngoài các mã chuẩn được tài liệu hoá ở mỗi endpoint,",
  "endpoint có rule nghiệp vụ riêng còn trả 409 (xung đột trạng thái) / 422 (vi phạm rule) / 429",
  "(vượt giới hạn tần suất) — chi tiết theo từng module ở `docs/spec/`.",
  "",
  "### Header chuẩn",
  "- `Authorization: Bearer <access token>` — bắt buộc trừ endpoint đánh dấu công khai.",
  "- `X-Request-Id` — client sinh, server echo ở `meta.request_id`.",
  "- `Idempotency-Key` — bắt buộc-nên-có ở các mutation quan trọng (xem chú thích từng endpoint).",
].join("\n");

/** Khoá HTTP method hợp lệ trong Path Item Object (OpenAPI 3.0 §4.7.9) — khoá khác (`parameters`,
 * `$ref`, `servers`) KHÔNG phải operation. */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** `$ref` tới component envelope lỗi. */
const errorEnvelopeRef = {
  $ref: `#/components/schemas/${COMPONENT_NAMES.errorEnvelope}`,
} as SchemaObject;

/** `$ref` tới component envelope thành công. */
const successEnvelopeRef = {
  $ref: `#/components/schemas/${COMPONENT_NAMES.successEnvelope}`,
} as SchemaObject;

/** Dựng một `ResponseObject` lỗi (envelope chuẩn). */
function errorResponse(description: string): ResponseObject {
  return {
    description,
    content: { "application/json": { schema: errorEnvelopeRef } },
  };
}

/** Operation có request body (⇒ có thể trượt validation Zod → 400). */
function hasRequestBody(operation: OperationObject): boolean {
  return operation.requestBody !== undefined;
}

/** Operation có tham số (path/query/header) — query/path sai kiểu cũng trượt validation → 400. */
function hasParameters(operation: OperationObject): boolean {
  return Array.isArray(operation.parameters) && operation.parameters.length > 0;
}

/** Path chứa tham số (`/tasks/{id}`) ⇒ tài nguyên có thể không tồn tại → 404. */
function hasPathParam(path: string): boolean {
  return path.includes("{");
}

/**
 * Dòng chú thích quyền cho phần `description` của operation.
 * Định dạng quyền theo SPEC-01 §9: `MODULE.RESOURCE.ACTION` — ở code là cặp (action, resourceType).
 */
function permissionNotes(meta: RouteAuthMeta): string[] {
  if (meta.isPublic) {
    return ["**Xác thực:** công khai — KHÔNG cần đăng nhập."];
  }
  const notes = ["**Xác thực:** cần `Authorization: Bearer <access token>`."];
  if (meta.permission) {
    const { action, resourceType, isSensitive, requiresReauth } = meta.permission;
    notes.push(`**Quyền:** \`${action}:${resourceType}\` (PermissionGuard, fail-closed → 403).`);
    if (isSensitive === true) {
      notes.push(
        "**Nhạy cảm:** quyền được đánh dấu `is_sensitive` — mọi lần gọi đều ghi audit log.",
      );
    }
    if (requiresReauth === true) {
      notes.push("**Re-auth:** cần xác thực lại trong cửa sổ gần đây mới thực hiện được.");
    }
  } else {
    notes.push(
      "**Quyền:** không khai `@RequirePermission` — kiểm soát truy cập nằm ở tầng service (phạm vi dữ liệu theo người gọi).",
    );
  }
  if (meta.isIdempotent) {
    notes.push(
      `**Idempotency:** gửi kèm header \`${IDEMPOTENCY_HEADER}\` (khoá duy nhất cho MỖI ý định, vd UUID v4). ` +
        `Gọi lại cùng khoá + cùng nội dung → phát lại phản hồi cũ kèm \`${IDEMPOTENCY_REPLAYED_HEADER}: true\`, KHÔNG chạy lại nghiệp vụ. ` +
        "Cùng khoá + nội dung khác, hoặc request trước còn đang chạy → 409.",
    );
  }
  return notes;
}

/** Tham số header `Idempotency-Key` (optional) cho route `@Idempotent()`. */
function idempotencyHeaderParameter(): ParameterObject {
  return {
    name: IDEMPOTENCY_HEADER,
    in: "header",
    required: false,
    description:
      "Khoá chống trùng cho MỘT ý định của người dùng (khuyến nghị UUID v4). Giữ NGUYÊN khoá khi thử lại; sinh khoá MỚI cho thao tác mới.",
    schema: { type: "string", maxLength: IDEMPOTENCY_KEY_MAX_LENGTH },
  } as ParameterObject;
}

/** Phản hồi 409 riêng của cơ chế idempotency (mã lỗi máy-đọc để client xử lý đúng nhánh). */
const IDEMPOTENCY_CONFLICT_DESCRIPTION =
  `Xung đột idempotency — \`error.code\` là \`${IDEMPOTENCY_ERROR_CODES.IN_PROGRESS}\` ` +
  "(request trước cùng khoá đang chạy → CHỜ rồi thử lại, KHÔNG đổi khoá) hoặc " +
  `\`${IDEMPOTENCY_ERROR_CODES.KEY_REUSED}\` (khoá đã dùng cho nội dung khác → sinh khoá mới).`;

/**
 * Ghép `description` mới vào description sẵn có (nếu controller đã tự khai `@ApiOperation`).
 * IDEMPOTENT: gọi lại trên document đã làm giàu KHÔNG nhân đôi khối chú thích (bảo hiểm cho trường hợp
 * enrich được gọi hai lần trên cùng một document).
 */
function mergeDescription(existing: string | undefined, notes: string[]): string {
  const block = notes.join("\n\n");
  if (existing === undefined || existing.trim() === "") return block;
  return existing.includes(block) ? existing : `${existing}\n\n${block}`;
}

/**
 * Điền `description` + schema envelope cho các phản hồi THÀNH CÔNG mà swagger sinh với description rỗng.
 * KHÔNG ghi đè description do controller tự khai, và KHÔNG gắn schema cho 204 (không có body).
 */
function fillSuccessResponses(operation: OperationObject): void {
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (!/^2\d\d$/.test(status)) continue;
    const res = response as ResponseObject;
    if (status === "204") {
      if (!res.description) res.description = "Thành công — không có nội dung trả về.";
      continue;
    }
    if (!res.description) {
      res.description =
        "Thành công — envelope API-01 `{ success, message, data, error:null, meta }`.";
    }
    // Chỉ gắn schema khi controller CHƯA tự khai content (không đè @ApiOkResponse có sẵn).
    if (res.content === undefined) {
      res.content = { "application/json": { schema: successEnvelopeRef } };
    }
  }
}

/** Gắn các phản hồi lỗi chuẩn (không ghi đè mã mà controller đã tự khai). */
function addErrorResponses(operation: OperationObject, path: string, meta: RouteAuthMeta): void {
  const responses = (operation.responses ??= {});
  const add = (entry: { status: string; description: string }): void => {
    if (responses[entry.status] === undefined) {
      responses[entry.status] = errorResponse(entry.description);
    }
  };

  if (hasRequestBody(operation) || hasParameters(operation))
    add(STANDARD_ERROR_RESPONSES.badRequest);
  if (!meta.isPublic) add(STANDARD_ERROR_RESPONSES.unauthorized);
  if (meta.permission !== null) add(STANDARD_ERROR_RESPONSES.forbidden);
  if (hasPathParam(path)) add(STANDARD_ERROR_RESPONSES.notFound);
  // 409 CHỈ cho route thực sự có cơ chế idempotency — endpoint khác có 409 theo rule nghiệp vụ riêng
  // và tự khai (xem ghi chú "KHÔNG gắn đại trà" ở openapi-components.ts).
  if (meta.isIdempotent) add({ status: "409", description: IDEMPOTENCY_CONFLICT_DESCRIPTION });
  add(STANDARD_ERROR_RESPONSES.serverError);
}

/**
 * Extension máy-đọc theo BACKEND-12 §11.1 — để QA/script đối chiếu ma trận quyền
 * (`docs/permission-matrix-spec.md`) mà không phải parse văn xuôi tiếng Việt trong `description`.
 *
 * RECONCILE với §11.1 (ghi ở BACKEND-12, mục "Reconcile thực thi S5-BE-CONTRACT-1"):
 *  - `x-required-permission` mang CẶP ENGINE THẬT `action:resourceType` (thứ `PermissionGuard` so khớp
 *    với seed), KHÔNG phải dạng minh hoạ `ATT.ATTENDANCE.CHECK_IN`. Dạng chấm KHÔNG tồn tại trong seed;
 *    sinh ra nó ở tài liệu sẽ mời người đọc so khớp một chuỗi không có thật (đúng lớp bug perm-pair drift
 *    đã gặp ở S1-FND-MODULE).
 *  - `x-data-scope` / `x-audit-log` / `x-notification-events` CHƯA suy được từ metadata route (scope nằm
 *    trong `data_scope` per-(permission,role) ở DB, audit/event nằm trong service) ⇒ CHỦ Ý BỎ TRỐNG thay
 *    vì đoán. Bịa scope trong tài liệu nguy hiểm hơn là không có.
 */
function addExtensions(
  operation: OperationObject,
  path: string,
  meta: RouteAuthMeta,
  globalPrefix: string | undefined,
): void {
  const ext = operation as unknown as Record<string, unknown>;
  const module = moduleForPath(path, globalPrefix);
  ext["x-module"] = module?.code ?? null;
  ext["x-auth-required"] = !meta.isPublic;
  ext["x-required-permission"] =
    meta.permission === null ? null : `${meta.permission.action}:${meta.permission.resourceType}`;
  ext["x-internal"] = module?.code === "INTERNAL";
  // Chỉ phát khi TRUE — `x-idempotency-required` là cờ của "mutation quan trọng" (§11.1), gắn false cho
  // cả 441 operation chỉ làm nhiễu tài liệu.
  if (meta.isIdempotent) ext["x-idempotency-required"] = true;
  if (meta.permission?.isSensitive === true) ext["x-permission-sensitive"] = true;
  if (meta.permission?.requiresReauth === true) ext["x-reauth-required"] = true;
}

/** Bổ sung tham số header `Idempotency-Key` (không nhân bản khi enrich chạy lại). */
function addIdempotencyHeader(operation: OperationObject): void {
  const params = (operation.parameters ??= []);
  const already = params.some(
    (p) =>
      (p as ParameterObject).name === IDEMPOTENCY_HEADER && (p as ParameterObject).in === "header",
  );
  if (!already) params.push(idempotencyHeaderParameter());
}

/**
 * Làm giàu document TẠI CHỖ (mutate) — swagger trả về object mới mỗi lần `createDocument`, và cả
 * `setupSwagger` lẫn `gen-openapi` đều gọi qua đây nên UI và artifact luôn khớp nhau.
 *
 * @param document  document do `SwaggerModule.createDocument` sinh
 * @param routeMeta map operationId → metadata auth/permission (xem `collectRouteAuthMeta`)
 * @param globalPrefix global prefix của app (`api/v1`) — để suy module từ path khi doc có prefix
 */
export function enrichOpenApiDocument(
  document: OpenAPIObject,
  routeMeta: ReadonlyMap<string, RouteAuthMeta>,
  globalPrefix?: string,
): OpenApiEnrichReport {
  document.info.description = API_DESCRIPTION;
  document.components ??= {};
  document.components.schemas = { ...envelopeComponents(), ...(document.components.schemas ?? {}) };

  const usedTags = new Set<string>();
  const report: OpenApiEnrichReport = {
    operations: 0,
    matched: 0,
    unmatched: [],
    publicOperations: 0,
    withPermission: 0,
  };

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, maybeOperation] of Object.entries(pathItem)) {
      // pathItem chứa cả khoá KHÔNG phải HTTP method (`parameters`, `$ref`, `servers`…) — bỏ qua.
      if (!HTTP_METHODS.has(method)) continue;
      const operation = maybeOperation as OperationObject;
      report.operations += 1;

      const tag = tagForOperation(path, operation.operationId, globalPrefix);
      operation.tags = [tag];
      usedTags.add(tag);

      const meta =
        operation.operationId !== undefined ? routeMeta.get(operation.operationId) : undefined;
      if (meta === undefined) {
        report.unmatched.push(operation.operationId ?? `${method.toUpperCase()} ${path}`);
        // Không nối được metadata → KHÔNG đoán bừa quyền/auth. Vẫn tài liệu hoá envelope 500 + success
        // để operation không trống trơn; e2e sẽ ĐỎ vì `unmatched` khác rỗng.
        fillSuccessResponses(operation);
        (operation.responses ??= {})[STANDARD_ERROR_RESPONSES.serverError.status] ??= errorResponse(
          STANDARD_ERROR_RESPONSES.serverError.description,
        );
        continue;
      }

      report.matched += 1;
      if (meta.isPublic) report.publicOperations += 1;
      if (meta.permission !== null) report.withPermission += 1;

      // `security: []` = ghi đè "không cần auth" cho route công khai; ngược lại yêu cầu bearer.
      operation.security = meta.isPublic ? [] : [{ bearer: [] }];
      operation.description = mergeDescription(operation.description, permissionNotes(meta));
      addExtensions(operation, path, meta, globalPrefix);

      fillSuccessResponses(operation);
      addErrorResponses(operation, path, meta);
      // SAU addErrorResponses có chủ ý: nhánh 400 xét `hasParameters(operation)`, mà header idempotency
      // KHÔNG sinh lỗi validation 400 (khoá sai → 409 INVALID_KEY). Thêm trước sẽ gắn 400 sai cho
      // operation không có tham số nào khác.
      if (meta.isIdempotent) addIdempotencyHeader(operation);
    }
  }

  // Tag là ĐỘNG (sinh theo controller thật) ⇒ dựng khối tags[] SAU vòng lặp, từ tag đã dùng.
  document.tags = buildDocumentTags(usedTags);
  return report;
}
