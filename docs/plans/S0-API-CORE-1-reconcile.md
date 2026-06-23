<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-API-CORE-1
zone: yellow
generated_by: human
reconciled_at: "2026-06-23 / feat/foundation-wave1 (rev2 — vá 2 plan_block)"   # mốc freshness — branch đổi ⇒ reconcile-refresh lại
lanes:
  - id: S0-API-CORE-1
    builder: backend-builder
    task: >
      Reshape envelope {success,data,error}→{success,message,data,error,meta:{request_id,timestamp}} +
      pagination block RIÊNG; GIỮ error:null trong success envelope (back-compat: web-core unwrapEnvelope +
      18 api-client test KHÔNG đổi → api-client.ts NẰM NGOÀI scope, để S0-FE-API-1 reshape sau);
      tạo error-code enum trong common/errors; AllExceptionsFilter PHẢI branch `instanceof ZodValidationException`
      (status 400) TRƯỚC fallback httpStatusToCode → code=VALIDATION-ERR-001 + details[] từ getZodError().issues;
      thêm log-redaction (Authorization/Cookie + query-string trong url) vào AllExceptionsFilter; request-id qua
      FUNCTIONAL middleware + ambient declare Express.Request.requestId (.d.ts trong paths, KHÔNG `any`/@ts-ignore);
      interceptor đọc request qua context.switchToHttp().getRequest() (KHÔNG REQUEST-scope);
      CompanyGuard — DEFER tenant-active-check sang S0-AUTH-DB-1 (xem §2);
      cập nhật 2 consumer BẮT BUỘC di chuyển cùng contract: contracts/index.spec.ts + web-core/lib/api.ts(getHealth);
      deny-path tests RED trước (no-secret-log, 5xx no-stack-leak); health giữ envelope (KHÔNG skip interceptor).
    paths:
      - packages/contracts/src/index.ts
      - packages/contracts/src/index.spec.ts                        # CẬP NHẬT — assert shape mới (cùng package, vỡ nếu không sửa)
      - packages/web-core/src/lib/api.ts                            # CẬP NHẬT/VERIFY getHealth — consumer LIVE của apiResponseSchema
      - apps/api/src/common/filters/all-exceptions.filter.ts
      - apps/api/src/common/interceptors/response-envelope.interceptor.ts
      - apps/api/src/common/errors/error-codes.ts                   # TẠO MỚI
      - apps/api/src/common/middleware/request-id.middleware.ts     # TẠO MỚI (functional)
      - apps/api/src/types/express-request.d.ts                     # TẠO MỚI — ambient declare Request.requestId (auto-include qua tsconfig "src")
      - apps/api/src/main.ts
      - apps/api/src/health/health.controller.ts                    # chỉ verify (không skip interceptor)
      - apps/api/src/common/interceptors/response-envelope.interceptor.spec.ts   # CẬP NHẬT (envelope + meta) — COLOCATED (vitest include=src/**/*.spec.ts)
      - apps/api/src/common/filters/all-exceptions.filter.spec.ts   # TẠO MỚI (deny-path #1/#2 + VALIDATION details) — COLOCATED (test/** chỉ nhận e2e/int-spec → file ở test/unit KHÔNG chạy = green giả)
acceptanceChecks:
  - "apiResponseSchema (packages/contracts/src/index.ts) parse đúng {success,message,data,error:null,meta:{request_id,timestamp}} — test Zod.parse xanh; error GIỮ nullable (back-compat)"
  - "paginationSchema TÁCH block riêng ({page,per_page,total,total_pages,has_next,has_prev}) — export riêng, KHÔNG nhét vào meta"
  - "ResponseEnvelopeInterceptor bọc data thành {success:true,message,data,error:null,meta:{request_id,timestamp}} — đọc request_id qua context.switchToHttp().getRequest().requestId"
  - "AllExceptionsFilter trả {success:false,message,data:null,error:{code,type,details},meta:{request_id,timestamp}} — body KHÔNG chứa stack/đường dẫn file hệ thống"
  - "error-code enum tồn tại ở apps/api/src/common/errors/error-codes.ts; gồm AUTH-ERR-UNAUTHENTICATED, AUTH-ERR-FORBIDDEN, VALIDATION-ERR-001, RESOURCE-ERR-NOT-FOUND, SYSTEM-ERR-001; map HttpStatus→code"
  - "AllExceptionsFilter branch `instanceof ZodValidationException` TRƯỚC fallback httpStatusToCode (ZodValidationException extends BadRequestException → status 400, sẽ map generic nếu không branch trước) → code=VALIDATION-ERR-001 + error.details[] field-level ({field,message,rule}) từ exception.getZodError().issues (path.join('.')→field, message, code→rule); import { ZodValidationException } from 'nestjs-zod'"
  - "request-id: FUNCTIONAL middleware (req,res,next) gán req.requestId (từ header X-Request-Id hoặc randomUUID) + set res header X-Request-Id; đăng ký app.use(requestIdMiddleware) TRƯỚC app.listen() — KHÔNG dùng class @Injectable qua app.use"
  - "req.requestId typecheck XANH ở filter+interceptor+middleware nhờ ambient declare (apps/api/src/types/express-request.d.ts: `declare global { namespace Express { interface Request { requestId?: string } } }`) — KHÔNG (req as any)/@ts-ignore"
  - "TEST deny-path #1 (no-secret-log): request có header Authorization='Bearer secret123' + Cookie + url='/x?token=secret123' → log line KHÔNG chứa 'secret123' (headers redact [REDACTED] + query-string strip khỏi url trước logger.error)"
  - "TEST deny-path #2 (5xx no-stack-leak): InternalServerErrorException (stack non-null) → response.json() KHÔNG có key 'stack' và KHÔNG có đường dẫn file"
  - "GET /api/v1/health + /health/db: ĐI QUA interceptor (KHÔNG skip) → bọc envelope mới; web-core getHealth vẫn parse + đọc .data thành công"
  - "web-core test XANH (59/59) — api-client.ts KHÔNG bị sửa (unwrapEnvelope giữ nguyên nhờ error:null); chỉ getHealth/contracts spec di chuyển cùng shape"
  - "build + typecheck packages/contracts + apps/api + packages/web-core XANH (KHÔNG @ts-ignore / eslint-disable)"
testTasks:
  - "apps/api/test/unit/common/all-exceptions-filter.spec.ts — RED trước GREEN:
      (1) DENY #1: filter nhận request có headers {authorization:'Bearer secret123', cookie:'mediaos_rt=xyz'} + url='/api/v1/x?token=secret123' + status 500 → spy trên Logger.error: KHÔNG arg nào chứa 'secret123' hoặc 'xyz' (redact [REDACTED] headers + strip query-string khỏi url);
      (2) DENY #2: InternalServerErrorException với .stack non-null → response body KHÔNG chứa key 'stack', KHÔNG chứa chuỗi '.ts:' / đường dẫn; body = {success:false, error:{code:'SYSTEM-ERR-001'}, meta:{request_id}};
      (3) PASS: dựng ZodValidationException THẬT (new ZodValidationException(new ZodError([...]))) — KHÔNG hand-build BadRequestException → error.code='VALIDATION-ERR-001' + error.details[] có {field,message} từ getZodError().issues; meta.request_id non-empty; KHẲNG ĐỊNH branch chạy TRƯỚC httpStatusToCode (không bị map generic theo 400);
      (4) PASS: ForbiddenException → error.code='AUTH-ERR-FORBIDDEN', status 403"
  - "apps/api/test/unit/common/response-envelope.spec.ts — interceptor shape mới:
      (1) PASS: handler trả {id:'1'} (request.requestId='req-1') → {success:true, message:'OK', data:{id:'1'}, error:null, meta:{request_id:'req-1', timestamp:<ISO>}};
      (2) PASS: handler trả undefined → data:null;
      (3) meta.request_id = string non-empty; meta.timestamp parse được bằng Date (ISO-8601)"
  - "packages/contracts/src/index.spec.ts — CẬP NHẬT assert shape mới:
      (1) success envelope hợp lệ phải có message + meta:{request_id,timestamp}; error:null;
      (2) error envelope: error:{code,type?,details?} + meta; data:null;
      (3) paginationSchema.parse({page,per_page,total,total_pages,has_next,has_prev}) OK; reject thiếu field;
      (4) reject envelope THIẾU meta (chứng minh meta là bắt buộc)"
steps:
  - "BƯỚC 0 — RED: viết all-exceptions-filter.spec.ts + response-envelope.spec.ts TRƯỚC. Chạy → confirm FAIL đỏ (filter chưa redact + chưa có meta; interceptor chưa có message/meta)."
  - "BƯỚC 1 — packages/contracts/src/index.ts: thêm responseMetaSchema {request_id:z.string(), timestamp:z.string()}; mở rộng apiErrorSchema += type?:z.string(), details?: z.array({field,message,rule?}).nullable() (GIỮ message); reshape apiResponseSchema = {success, message:z.string(), data:data.nullable(), error:apiErrorSchema.nullable(), meta:responseMetaSchema, pagination:paginationSchema.optional()}; THÊM paginationSchema export riêng ({page,per_page,total,total_pages,has_next,has_prev}). GIỮ paginationMetaSchema làm alias deprecated (KHÔNG xóa — spec còn test). Build contracts trước."
  - "BƯỚC 2 — packages/contracts/src/index.spec.ts: cập nhật success/error case sang shape mới (message+meta required, error nullable); GIỮ case paginationMetaSchema cũ + THÊM case paginationSchema mới + case reject envelope thiếu meta (xem testTask). XANH sau khi index.ts đổi."
  - "BƯỚC 3 — apps/api/src/common/errors/error-codes.ts (TẠO MỚI): object hằng ERROR_CODES theo API-01 §13.2 + hàm httpStatusToCode(status). KHÔNG import NestJS internals."
  - "BƯỚC 4 — apps/api/src/common/middleware/request-id.middleware.ts (TẠO MỚI): FUNCTIONAL middleware `export function requestIdMiddleware(req,res,next){ const id = (req.headers['x-request-id'] as string) ?? randomUUID(); req.requestId = id; res.setHeader('X-Request-Id', id); next(); }` (import randomUUID từ 'node:crypto'). KHÔNG class @Injectable (không chạy đúng qua app.use)."
  - "BƯỚC 4b — apps/api/src/types/express-request.d.ts (TẠO MỚI): `declare global { namespace Express { interface Request { requestId?: string } } }` + `export {}`. Auto-include qua tsconfig include:['src']. Đây là điều kiện để req.requestId typecheck XANH ở middleware/interceptor/filter — KHÔNG dùng (req as any)/@ts-ignore."
  - "BƯỚC 5 — apps/api/src/common/interceptors/response-envelope.interceptor.ts: đọc request qua context.switchToHttp().getRequest() (KHÔNG REQUEST-scope); map data → {success:true, message:'OK', data:data??null, error:null, meta:{request_id:req.requestId, timestamp:new Date().toISOString()}}."
  - "BƯỚC 6 — apps/api/src/common/filters/all-exceptions.filter.ts. THỨ TỰ resolve code QUAN TRỌNG: (a) NẾU `exception instanceof ZodValidationException` (import từ 'nestjs-zod'; nó extends BadRequestException → status 400) → code='VALIDATION-ERR-001', details = exception.getZodError().issues.map(i=>({field:i.path.join('.'), message:i.message, rule:i.code})) — branch NÀY chạy TRƯỚC (b); (b) NGƯỢC LẠI: code = (exception payload có 'code' string hợp lệ ? payload.code : httpStatusToCode(status)); (c) REDACT trước logger.error: bản sao headers thay authorization/cookie/x-csrf-token→'[REDACTED]' + strip query-string khỏi request.url (chỉ log pathname) — KHÔNG log value thô; (d) body KHÔNG stack (đã đúng, giữ); (e) error.type = exception.name; (f) thêm message top-level + meta:{request_id:req.requestId, timestamp}."
  - "BƯỚC 7 — apps/api/src/main.ts: import { requestIdMiddleware }; gọi app.use(requestIdMiddleware) NGAY SAU NestFactory.create, TRƯỚC setGlobalPrefix/useGlobalInterceptors/useGlobalFilters và TRƯỚC app.listen() — để req.requestId sẵn cho interceptor+filter ở mọi request (kể cả request bị guard reject sớm). KHÔNG đổi thứ tự pipe/interceptor/filter còn lại."
  - "BƯỚC 8 — apps/api/src/health/health.controller.ts: VERIFY 2 endpoint vẫn trả {status} qua interceptor (KHÔNG thêm @SkipInterceptor — health phải có cùng envelope để getHealth parse được)."
  - "BƯỚC 9 — packages/web-core/src/lib/api.ts: VERIFY getHealth — apiResponseSchema(healthSchema).parse(json) với shape mới (message+meta required, error nullable) vẫn đọc .data OK. Chỉ sửa nếu parse vỡ (vd thêm message khi build healthSchema không cần). KHÔNG đụng api-client.ts."
  - "BƯỚC 10 — GREEN: chạy lại deny-path + interceptor spec → xanh; pnpm --filter @mediaos/contracts build; pnpm --filter @mediaos/api typecheck+build+test; pnpm --filter @mediaos/web-core test (xác nhận 59/59, api-client KHÔNG đổi)."
```

# S0-API-CORE-1 — Micro-plan rev2 (reconcile shared config · envelope · error-code · health)

> Zone: yellow (chạm secrets redaction = BẤT BIẾN #3). Builder: backend-builder. FULL gate.
> Rev2 tại 2026-06-23 / branch feat/foundation-wave1 — **vá 2 plan_block** (xem §3 + §8).

## 0. Kết quả đối chiếu (verify line-level 2026-06-23)

| done_when | Trạng thái hiện tại (đã đọc code) | Hành động |
| --- | --- | --- |
| #1 RESHAPE envelope {success,message,data,meta} | ⚠️ **GAP**: interceptor L18-22 trả `{success:true,data,error:null}`; filter L46-50 trả `{success:false,data:null,error:{code,message}}`; contracts L23-30 `apiResponseSchema` = `{success,data,error,meta?:pagination}`. Thiếu `message`, `meta:{request_id,timestamp}`. | contracts → interceptor → filter |
| #2 error-code enum | ⚠️ **GAP**: filter L35 sinh code ad-hoc `exception.name.replace(...).toUpperCase()`. Không có enum. | tạo `common/errors/error-codes.ts` |
| #3 deny-path RED: no-secret-log + 5xx no-stack | ⚠️ **GAP**: filter L40-44 log `method+url+status` (chưa redact header); body KHÔNG có stack (✅ đã đúng). 0 test cho 2 deny-path. | viết test RED trước |
| #4 GET /health + /health/db | ✅ **ĐẠT** (chỉ verify không bị envelope reshape phá). | verify BƯỚC 8 |

**Không build cho:** app.module.ts (pipeline đúng thứ tự), CompanyGuard (DEFER §2), api-client.ts (giữ nguyên §3).

## 1. Envelope đích (API-01 §11/§12/§16)

**Success** — `{success:true, message, data, error:null, meta:{request_id,timestamp}, pagination?}`
**Error** — `{success:false, message, data:null, error:{code,type,details}, meta:{request_id,timestamp}}`

- `message`: bắt buộc, default `'OK'` cho 2xx; filter set message cho lỗi.
- `meta`: `{request_id, timestamp}` (KHÁC `paginationMeta` cũ). `request_id` lấy từ `req.requestId` (middleware).
- `pagination`: **block riêng** `{page,per_page,total,total_pages,has_next,has_prev}` (API-01 §16.1) — KHÔNG nằm trong `meta`.
- `error`: **GIỮ nullable** trong cả 2 nhánh (success → `error:null`). Lý do back-compat ở §3.

## 2. Quyết định CompanyGuard (Blocker plan-review #1.4) — **DEFER**

Giữ nguyên quyết định rev1: tenant-active-check (company Active/tồn tại) → **S0-AUTH-DB-1** (cần `companies.status` + AuthContext của AUTH module). CompanyGuard hiện **fail-closed** (vắng `companyId` → ForbiddenException) = safe default ở N=1. Action: ghi comment TODO trong `company.guard.ts`. KHÔNG implement ở WO này, KHÔNG nằm trong paths.

## 3. Consumer của contract & thứ tự an toàn (VÁ plan_block #2 — điểm chặn lặp lại)

> **plan_block #2 (2026-06-22 18:57Z) chặn vì rev1 §3 KHẲNG ĐỊNH SAI "không có consumer FE nào trên main".** Sự thật (đã verify):

Reshape `apiResponseSchema` (shared `packages/contracts`) ripple tới **3 consumer**:

| Consumer | Dùng gì | Ảnh hưởng | Xử lý |
| --- | --- | --- | --- |
| `packages/contracts/src/index.spec.ts` | assert shape cũ (success không message, meta=pagination) | **VỠ** khi reshape (cùng package) | **TRONG paths** — cập nhật BƯỚC 2 |
| `packages/web-core/src/lib/api.ts` `getHealth` (L13-21, export ở index.ts L26) | `apiResponseSchema(healthSchema).parse(json)` rồi đọc `.data` / `.error?.message` | parse OK nếu message+meta có (interceptor thêm) & error giữ nullable; đọc `.data` không đổi | **TRONG paths** — verify/sửa tối thiểu BƯỚC 9 |
| `packages/web-core/src/lib/api-client.ts` `unwrapEnvelope` (L43-54) | detect `"success"&&"data"&&"error" in json` rồi lấy `.data` | **KHÔNG vỡ** vì success envelope GIỮ `error:null` → đủ 3 key → unwrap đúng. 18 test (mock `{success,data,error}`) xanh nguyên | **NGOÀI paths** — reshape đầy đủ (message/meta/error.type/request-id/idempotency) thuộc **S0-FE-API-1** |
| `apps/console/src/lib/employees-api.ts:84` (unwrapEnvelope) + `apps/console/src/routes/home.tsx` (getHealth) | đọc `.data` đã unwrap | **KHÔNG vỡ** (đã verify): unwrapEnvelope vẫn lấy `.data` (3 key còn đủ); getHealth trả `.data` nên home.tsx đọc `.status`/`.service` không đổi | **NGOÀI paths** — chỉ ghi nhận đã kiểm, không sửa |

**Chốt thiết kế:** GIỮ `error:null` trong success envelope chính là cơ chế để api-client (crown của S0-FE-API-1) KHÔNG phải đổi ở WO này → ranh giới WO sạch, web-core test 59/59 xanh. Đây là deviation chủ ý (API-01 success "thuần" không có error) — sẽ được dọn khi S0-FE-API-1 reshape api-client.

**Thứ tự:** `contracts (+spec)` → `apps/api/common` → verify `web-core/api.ts` → test cả 3 package. Build `@mediaos/contracts` trước (turbo dep) để api + web đọc type mới.

**Atomic / rollback:** reshape `packages/contracts` là thay đổi fan-out cross-package — commit **all-or-none** (toàn bộ paths trong 1 commit). Đây CHÍNH là điểm vỡ của plan_block #2 (thay đổi cross-package áp dở dang). Nếu `apps/api` build đỏ giữa chừng → revert cả commit, KHÔNG land riêng contracts.

## 4. Bất biến giữ nguyên

- **#1 company_id mọi query:** không đụng repository. CompanyGuard fail-closed giữ nguyên.
- **#2 append-only audit:** không đụng bảng audit.
- **#3 no-secret plaintext:** mục tiêu chính — deny #1 chứng minh Authorization/Cookie bị mask `[REDACTED]` trước logger.error; deny #2 chứng minh body 5xx không lộ stack/đường dẫn.

## 5. Deviation — không churn

- `paginationMetaSchema` (total/page/limit) → GIỮ làm **alias deprecated** (KHÔNG xóa — `index.spec.ts:42-46` còn test nó); THÊM `paginationSchema` mới (API-01 §16.1: page/per_page/total/total_pages/has_next/has_prev) làm block riêng cho response. `apiResponseSchema.meta` đổi từ `paginationMetaSchema.optional()` → `responseMetaSchema` (request_id/timestamp). BƯỚC 2 giữ case test paginationMetaSchema cũ + thêm case paginationSchema mới.
- `error:null` ở success envelope — back-compat có chủ ý (§3), KHÔNG churn api-client.
- Health KHÔNG `@SkipInterceptor` — đồng nhất envelope để getHealth parse được.

## 6. Verify (lane độc lập)

```bash
# BƯỚC 0 — test đỏ TRƯỚC
pnpm --filter @mediaos/api test -- all-exceptions-filter response-envelope    # đích: RED

# GREEN:
pnpm --filter @mediaos/contracts build
pnpm --filter @mediaos/api typecheck && pnpm --filter @mediaos/api build
pnpm --filter @mediaos/api test -- all-exceptions-filter response-envelope    # đích: PASS
pnpm --filter @mediaos/web-core test                                          # đích: 59/59 (api-client không đổi)
pnpm --filter @mediaos/contracts test                                         # đích: PASS (spec shape mới)

# Health smoke (cần API chạy):
curl http://localhost:3100/api/v1/health      # → envelope {success,message,data:{status},error:null,meta:{request_id,timestamp}}
curl http://localhost:3100/api/v1/health/db
```

## 7. Gate

Zone yellow, chạm secrets redaction → **FULL gate**: `security-reviewer` + `silent-failure-hunter`. Reviewer tập trung:
- Redaction: Authorization/Cookie/CSRF KHÔNG xuất hiện trong log output (cả message lẫn trace arg).
- Stack: body 5xx KHÔNG chứa stack/đường dẫn file.
- Envelope: contracts Zod parse đúng shape mới; web-core 59/59 xanh; api-client KHÔNG bị sửa.
- Không `@ts-ignore` / `eslint-disable`.

## 8. Out-of-scope (KHÔNG làm ở WO này)

- **Tenant-active-check trong CompanyGuard** → S0-AUTH-DB-1 (cần companies.status + AuthContext).
- **Deny-path tenant-isolation (rev1 testTask #3)** → **GỠ khỏi WO này.** WO không chạm repository/`withTenant`/auth-context nào (CompanyGuard DEFER), nên test isolation ở đây chỉ kiểm mock (plan_block #2 đã chỉ ra "không chứng minh isolation thật"). Isolation thật do `rls-tenant-isolation-tester` + S0-AUTH-DB-1 phụ trách.
- **api-client.ts reshape đầy đủ** (message/meta/error.type/request-id attach/idempotency-key/error-mapper/query layer) → **S0-FE-API-1** (depends_on WO này; WIP ở `git stash@{1}`).
- Rate limiting / CORS chi tiết / IP allowlist → security policy module riêng / phase sau.
- Audit interceptor → S1-FND-AUDIT-1. OpenAPI/Swagger → BACKEND-12.
