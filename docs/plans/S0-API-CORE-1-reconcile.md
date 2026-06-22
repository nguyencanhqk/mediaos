<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-API-CORE-1
zone: yellow
generated_by: human
reconciled_at: "2026-06-23 / feat/foundation-wave1"   # mốc freshness — branch đổi ⇒ reconcile-refresh lại
lanes:
  - id: S0-API-CORE-1
    builder: backend-builder
    task: >
      Reshape envelope {success,data,error}→{success,message,data,meta:{request_id,timestamp}} + pagination block riêng;
      tạo error-code enum MODULE-ERR-XXX trong common/; ZodValidationPipe→VALIDATION-ERR-001 với details[];
      thêm log-redaction (Authorization/password/token) vào AllExceptionsFilter + logger;
      CompanyGuard — DEFER tenant-active-check sang AUTH WO (xem quyết định §3);
      deny-path tests RED trước (no-secret-log, 5xx no-stack-leak, tenant isolation);
      health/health-db giữ nguyên (đã xanh, chỉ verify).
    paths:
      - packages/contracts/src/index.ts
      - apps/api/src/common/filters/all-exceptions.filter.ts
      - apps/api/src/common/interceptors/response-envelope.interceptor.ts
      - apps/api/src/common/interceptors/response-envelope.interceptor.spec.ts
      - apps/api/src/common/errors/error-codes.ts          # TẠO MỚI
      - apps/api/src/common/middleware/request-id.middleware.ts   # TẠO MỚI
      - apps/api/src/main.ts
      - apps/api/src/health/health.controller.ts
      - apps/api/test/unit/common/response-envelope.spec.ts       # TẠO MỚI (deny-path + envelope)
      - apps/api/test/unit/common/all-exceptions-filter.spec.ts   # TẠO MỚI (deny-path)
acceptanceChecks:
  - "apiResponseSchema (packages/contracts/src/index.ts) parse đúng {success,message,data,meta:{request_id,timestamp}} — test Zod.parse xanh"
  - "paginationSchema tách block riêng ({page,per_page,total,total_pages,has_next,has_prev})"
  - "ResponseEnvelopeInterceptor bọc data thành {success:true,message,data,meta:{request_id,timestamp}}"
  - "AllExceptionsFilter trả {success:false,message,error:{code,type,details},meta:{request_id,timestamp}} — KHÔNG trả stack/file path trong body"
  - "error-code enum tồn tại ở apps/api/src/common/errors/error-codes.ts; bao gồm AUTH-ERR-UNAUTHENTICATED, AUTH-ERR-FORBIDDEN, VALIDATION-ERR-001, RESOURCE-ERR-NOT-FOUND, SYSTEM-ERR-001"
  - "ZodValidationPipe thất bại → code=VALIDATION-ERR-001 + details[] field-level (field, message, rule)"
  - "TEST deny-path #1 (no-secret-log): request chứa Authorization header → log KHÔNG chứa giá trị Bearer token"
  - "TEST deny-path #2 (5xx no-stack-leak): forced InternalServerException → response body KHÔNG chứa 'stack' hoặc path file hệ thống"
  - "TEST deny-path #3 (tenant isolation): companyId trong JWT khác companyId của resource → truy vấn qua withTenant trả 0 row (regression guard)"
  - "GET /api/v1/health → {status:'ok'} và GET /api/v1/health/db → {status:'ok'|'down'} — response không bị bọc thêm envelope (controller trả trực tiếp, interceptor skip nếu cần)"
  - "build + typecheck apps/api + packages/contracts xanh (KHÔNG @ts-ignore / eslint-disable)"
  - "S0-FE-API-1 được ghi chú là depends_on S0-API-CORE-1; stash chưa land — không break gì"
testTasks:
  - "apps/api/test/unit/common/all-exceptions-filter.spec.ts — RED trước GREEN:
      (1) DENY: gọi filter với exception có Authorization='Bearer secret123' trong log context → assert log line KHÔNG chứa 'secret123' (header redaction);
      (2) DENY: gọi filter với InternalServerErrorException (exception.stack non-null) → assert response.json() KHÔNG chứa key 'stack';
      (3) PASS: gọi filter với BadRequestException({code:'VALIDATION-ERR-001',message:'...'}) → response body chứa {success:false, error:{code:'VALIDATION-ERR-001'}, meta:{request_id}}"
  - "apps/api/test/unit/common/response-envelope.spec.ts — mở rộng interceptor.spec hiện tại:
      (1) PASS: handler trả {id:'1'} → envelope {success:true,message,data:{id:'1'},meta:{request_id,timestamp}};
      (2) PASS: handler trả undefined → data:null;
      (3) kiểm tra meta.request_id là string non-empty; meta.timestamp là ISO-8601 string"
  - "apps/api/test/unit/common/tenant-isolation.spec.ts (TẠO MỚI) — deny-path #3:
      (1) DENY: withTenant('company-A', fn) → khi query bị intercept, set_config được gọi với 'company-A'; query trả 0 row khi record.company_id='company-B' (mock drizzle);
      (2) kiểm tra rằng AllExceptionsFilter KHÔNG lọ companyId của tenant khác trong body lỗi"
steps:
  - "BƯỚC 0 — RED: Viết test deny-path trước khi sửa bất kỳ code nào. Chạy → confirm FAIL đỏ (filter test sẽ fail vì log chưa redact, envelope test fail vì chưa có meta)"
  - "BƯỚC 1 — packages/contracts/src/index.ts: reshape apiResponseSchema. Thêm message:z.string(), đổi meta từ paginationMetaSchema.optional() thành {request_id:z.string(),timestamp:z.string()}; tách paginationSchema thành export riêng. Export type ApiResponse<T>. Giữ CONTRACTS_VERSION. KHÔNG đổi các export khác. Thứ tự: contracts trước api."
  - "BƯỚC 2 — apps/api/src/common/errors/error-codes.ts (TẠO MỚI): enum/object hằng số mã lỗi theo API-01 §13.2. Map HttpStatus→code. Bao gồm VALIDATION-ERR-001 với shape details[]. Không import từ NestJS internals."
  - "BƯỚC 3 — apps/api/src/common/middleware/request-id.middleware.ts (TẠO MỚI): gán req.requestId từ X-Request-Id header hoặc sinh uuid nếu không có; set res header X-Request-Id. Đăng ký ở main.ts (app.use). KHÔNG sửa app.module.ts (global prefix pipeline)."
  - "BƯỚC 4 — apps/api/src/common/interceptors/response-envelope.interceptor.ts: thêm message (mặc định 'OK' cho 2xx, controller có thể override qua metadata hoặc data.message), meta:{request_id:từ req.requestId, timestamp:new Date().toISOString()}. Inject REQUEST scope hoặc đọc từ ExecutionContext."
  - "BƯỚC 5 — apps/api/src/common/filters/all-exceptions.filter.ts: (a) REDACTION: trước khi logger.error, lấy headers từ request và mask Authorization/Cookie header (thay value bằng '[REDACTED]'); KHÔNG log header value thô; (b) KHÔNG trả stack trong body (đã đúng — chỉ log server-side); (c) dùng error-codes.ts: map HttpStatus→code chuẩn; (d) thêm meta:{request_id,timestamp} vào response body; (e) ZodValidationException: parse Zod issues → details[] với {field,message,rule}."
  - "BƯỚC 6 — apps/api/src/main.ts: đăng ký RequestIdMiddleware (app.use); KHÔNG đổi guard/pipe/filter pipeline (đã đúng thứ tự)."
  - "BƯỚC 7 — apps/api/src/health/health.controller.ts: kiểm tra health response có bị bọc envelope hay không — nếu interceptor thêm meta không làm lệch shape thì giữ nguyên; nếu cần skip interceptor thì dùng @SkipInterceptor decorator. Mục tiêu: GET /health trả {status:'ok'} vẫn parse được, không lỗi."
  - "BƯỚC 8 — GREEN: Chạy lại test deny-path → xanh. Cập nhật interceptor.spec.ts cho shape mới. Chạy pnpm typecheck + pnpm build contracts + api."
```

# S0-API-CORE-1 — Micro-plan (reconcile shared config · envelope · error-code · health)

> Zone: yellow (chạm secrets redaction + tenant isolation = BẤT BIẾN #3). Builder: backend-builder.
> Reconcile tại: 2026-06-23 / branch feat/foundation-wave1.

## 0. Kết quả đối chiếu (đã verify line-level)

| done_when | Trạng thái hiện tại | Hành động |
| --- | --- | --- |
| #1 RESHAPE envelope {success,message,data,meta} | ⚠️ **GAP**: envelope hiện tại là `{success,data,error:null}` (interceptor L18-22) và `{success,data,error:{code,message}}` (filter L46-50). `message` và `meta:{request_id,timestamp}` CHƯA có. `packages/contracts/src/index.ts` L23-30 xác nhận `apiResponseSchema` chỉ có `{success,data,error,meta?:paginationMeta}`. | Sửa contracts → interceptor → filter |
| #2 error-code enum MODULE-ERR-XXX | ⚠️ **GAP**: grep `MODULE-ERR` trong `apps/api/src/` trả 0 file nguồn code (chỉ xuất hiện trong docs/CLAUDE). `all-exceptions.filter.ts` L35 sinh code ad-hoc bằng `exception.name.replace(/Exception$/,'').toUpperCase()` — KHÔNG phải enum chuẩn. | Tạo `common/errors/error-codes.ts` |
| #3 deny-path test RED: no-secret-log + 5xx no-stack + isolation | ⚠️ **GAP**: `all-exceptions.filter.ts` L40-44 log `request.method + request.url + status` NHƯNG không redact headers. KHÔNG có test cho 3 deny-path. Interceptor spec hiện tại (L11-21) chỉ test `{success,data,error:null}` — chưa test meta. | Viết test RED trước GREEN |
| #4 GET /health + /health/db xanh | ✅ **ĐÃ ĐẠT**: health.controller.ts đã đúng, hai endpoint hoạt động. Chỉ cần verify không bị phá bởi envelope reshape. | Verify sau bước 7 |

**Không có gì để build cho:** app.module.ts (pipeline guard đúng thứ tự), main.ts (ZodValidationPipe + interceptor + filter đã đăng ký đúng), CompanyGuard (xem quyết định §3).

## 1. Phân tích gap chi tiết

### 1.1 Envelope hiện tại vs. API-01 spec

**Hiện tại (`packages/contracts/src/index.ts` L23-30):**
```typescript
// success, data (nullable), error (nullable), meta?: paginationMeta
```

**API-01 §11.1/§11.2 yêu cầu:**
```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": { ... },
  "pagination": { "page":1,"per_page":20,"total":100,"total_pages":5,"has_next":true,"has_prev":false },
  "meta": { "request_id": "...", "timestamp": "2026-06-20T10:00:00+07:00" }
}
```

Các lệch cụ thể:
- `message`: thiếu hoàn toàn
- `meta`: hiện là `paginationMeta` (total/page/limit) — phải đổi thành `{request_id,timestamp}`
- `pagination`: phải là block riêng (không nằm trong `meta`)
- `error.type` và `error.details[]`: thiếu (API-01 §12.1/§12.2)

### 1.2 Error response hiện tại vs. API-01 §12

**Hiện tại (`all-exceptions.filter.ts` L46-50):**
```typescript
{ success: false, data: null, error: { code, message } }
```

**API-01 §12.1 yêu cầu:**
```json
{ "success": false, "message": "...", "error": { "code": "AUTH-ERR-FORBIDDEN", "type": "ForbiddenError", "details": null }, "meta": { "request_id": "...", "timestamp": "..." } }
```

### 1.3 Log redaction — xác nhận gap

`AllExceptionsFilter.catch()` L40-44 gọi:
```typescript
this.logger.error(`${request.method} ${request.url} -> ${status}`, exception.stack)
```

URL không chứa Authorization header nhưng KHÔNG có kiểm tra để loại bỏ Authorization khỏi log nếu sau này được log. Quan trọng hơn: **chưa có test nào** kiểm tra rằng header Authorization không bị log. Đây là deny-path test bắt buộc theo BẤT BIẾN #3 và blocker của WO.

### 1.4 request_id — hiện trạng

Không có middleware nào sinh/đọc `X-Request-Id`. Cần tạo `RequestIdMiddleware`.

## 2. Quyết định về CompanyGuard (Blocker #4)

**Quyết định: DEFER tenant-active-check sang AUTH WO.**

**Lý do:**
1. `CompanyGuard` hiện chỉ kiểm tra `req.user?.companyId` tồn tại trong JWT (L26-28). BACKEND-01 §13.2 yêu cầu kiểm tra thêm company `Active` + tồn tại trong DB.
2. Thực hiện active-check đòi hỏi: (a) inject service đọc bảng `companies`, (b) bảng `companies` cần có cột `status`, (c) cần mã lỗi `AUTH-ERR-COMPANY-INACTIVE` + `AUTH-ERR-COMPANY-NOT-FOUND`, (d) deny-path test riêng.
3. Bảng `companies` và `AuthContext` thuộc domain AUTH module — chưa được reconcile trong WO này (thuộc `S0-AUTH-DB-1`).
4. Thực hiện ở đây sẽ vượt phạm vi `paths` của WO (CompanyGuard nằm trong paths nhưng service đọc companies thì không), và vi phạm nguyên tắc "1 Work Order tại 1 thời điểm" (CLAUDE.md §9.1).

**Ghi chú:** CompanyGuard hiện tại là **fail-closed** — nếu `companyId` không có trong JWT thì ném `ForbiddenException`. Đây là safe default. Tenant-active-check bổ sung thêm bảo vệ nhưng không phải lỗ hổng ngay lập tức ở N=1. Defer là an toàn.

**Action:** Ghi comment trong `company.guard.ts` (block "TODO S0-AUTH-DB-1: thêm tenant active-check + AUTH-ERR-COMPANY-INACTIVE sau khi companies.status được xác nhận ở S0-AUTH-DB-1"). KHÔNG implement ở WO này.

## 3. Thứ tự thay đổi và tính an toàn breaking change

Envelope thay đổi là **breaking** cho bất kỳ consumer nào đang parse `{success,data,error}`. Thứ tự đảm bảo không vỡ:

| Bước | File | Ghi chú |
| --- | --- | --- |
| 1 | `packages/contracts/src/index.ts` | Reshape schema, export type mới. Build contracts trước. |
| 2 | `apps/api/src/common/**` | Cập nhật interceptor + filter dùng shape mới. |
| 3 | FE (`packages/web-core`) | S0-FE-API-1 đang ở git stash, CHƯA land → không có consumer FE nào bị vỡ ngay. |

Tại thời điểm reconcile, S0-FE-API-1 ở stash (`backlog.mjs` L231: "WIP đang ở git stash@{0}") và có `depends_on: ['S0-API-CORE-1']` — đây là cơ chế bảo vệ đã được ghi nhận trong backlog. Không có consumer nào hiện đang dùng shape cũ trên main branch. Thứ tự contracts→api là đủ để không break.

## 4. Bất biến giữ nguyên

- **#1 company_id mọi query:** không đụng repository nào trong WO này. CompanyGuard giữ nguyên (fail-closed).
- **#2 append-only audit:** không đụng bảng audit trong WO này.
- **#3 no-secret plaintext:** đây là mục tiêu chính — deny-path test #1 (log redaction) chứng minh Authorization/password/token bị mask trước khi log. `AuditMaskerService` đã có cơ chế redact ở tầng audit; WO này thêm redaction ở tầng HTTP filter/logger.

## 5. Deviation — không churn

- `paginationMetaSchema` hiện có `total/page/limit` — sẽ được đổi sang block riêng `paginationSchema` với `{page,per_page,total,total_pages,has_next,has_prev}` theo API-01 §16.1. Đây là thay đổi chủ ý theo spec, ghi rõ ở comment block trong contracts.
- Health controller KHÔNG bị bọc thêm envelope nếu làm vỡ shape — kiểm tra sau reshape, dùng `@SkipInterceptor()` nếu cần (health là `@Public()`, không cần meta request_id).

## 6. Verify (lane độc lập)

```bash
# Bước 0 — xác nhận test đỏ TRƯỚC
pnpm --filter @mediaos/api test -- all-exceptions-filter response-envelope tenant-isolation
# Đích: FAIL (RED) vì code chưa implement

# Sau khi implement (GREEN):
pnpm --filter @mediaos/contracts build          # contracts build clean
pnpm --filter @mediaos/api typecheck            # tsc --noEmit xanh
pnpm --filter @mediaos/api build                # nest build xanh
pnpm --filter @mediaos/api test -- all-exceptions-filter response-envelope tenant-isolation
# Đích: PASS (GREEN)

# Health smoke:
curl http://localhost:3000/api/v1/health
# → {"status":"ok","service":"mediaos-api","time":"..."}
curl http://localhost:3000/api/v1/health/db
# → {"status":"ok","database":{...}}
```

## 7. Gate

Zone yellow, chạm secrets + tenant isolation → **FULL gate**: `security-reviewer` + `silent-failure-hunter`.

Reviewer tập trung vào:
- Log redaction: xác nhận Authorization/Cookie/password/token KHÔNG xuất hiện trong log output
- Stack trace: xác nhận response body 5xx KHÔNG chứa stack/file path
- Envelope shape: xác nhận contracts Zod parse đúng shape mới
- Không có `@ts-ignore` / `eslint-disable`

## 8. Out-of-scope (KHÔNG làm ở WO này)

- Tenant active-check trong CompanyGuard → **S0-AUTH-DB-1** (cần bảng companies.status + AuthContext từ AUTH module).
- Rate limiting middleware → **S1-FND-SEC-1** (phase sau).
- CORS chi tiết / IP allowlist → đã có ở SecurityPolicyModule (riêng).
- S0-FE-API-1 (web-core api-client reshape) → WO riêng, depends_on WO này, đang ở stash.
- Idempotency interceptor → phase sau (BACKEND-01 §... scope lớn hơn).
- Audit interceptor (`audit.interceptor.ts`) → S1-FND-AUDIT-1.
- OpenAPI/Swagger setup → BACKEND-12 WO riêng.
