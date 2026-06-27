<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
<!-- REV2 2026-06-23: vá BLOCK của plan-reviewer — (1) ApiError dùng CONSTRUCTOR OVERLOAD (positional + object-arg) để
     KHÔNG đụng 3 construct-site ngoài api-client.ts (auth-api.spec.ts:76 + apps/auth/login.spec.tsx:108,171);
     (2) done_when#2 chốt ranh giới rõ + follow-up WO S1-FE-QUERY-WIRE-1; + named re-export, errResFull, cross-app typecheck. -->
```yaml
wo: S0-FE-API-1
zone: green
generated_by: human
reconciled_at: "2026-06-23 / feat/foundation-wave1 (rev2 — vá 2 BLOCK plan-review)"   # mốc freshness — branch/envelope đổi ⇒ reconcile-refresh lại
depends_on: [S0-API-CORE-1]   # ✅ DONE (52156cf) — envelope {success,message,data,error,meta} đã lock
lanes:
  - id: S0-FE-API-1
    builder: frontend-builder
    task: >
      Reshape FE data layer trong packages/web-core cho khớp envelope mới (S0-API-CORE-1) + FRONTEND-04.
      (1) ApiError thêm CONSTRUCTOR OVERLOAD: giữ positional (status,code,message) CHO BACK-COMPAT + thêm object-arg
      {message,kind,status,code,type,details,requestId,raw} (FRONTEND-04 §10.1). KHÔNG đổi dạng positional →
      3 construct-site ngoài api-client.ts (auth-api.spec.ts:76, apps/auth/login.spec.tsx:108,171) KHÔNG vỡ, KHÔNG
      cần đụng (apps/auth NẰM NGOÀI scope). status/code GIỮ REQUIRED (api-client luôn set đủ).
      (2) toApiError đổi sang object-arg để đính error.type + error.details + meta.request_id + kind; tính kind qua
      mapStatusToErrorKind ALIGN với BE ERROR_CODES THẬT (apps/api/.../error-codes.ts), KHÔNG bịa code BE không phát.
      (3) rawFetch gắn X-Request-Id mỗi request + Idempotency-Key (opt-in qua opts) + X-Client-Type/Version.
      (4) land 6 helper từ git stash (commit 4de72b7): api-request-id/api-idempotency/api-params như-cũ; api-types SỬA
      dedup type với @mediaos/contracts (NAMED re-export, KHÔNG wildcard — tránh đụng tên type ApiError của contracts);
      api-error-kind + error-mapper sau khi ApiError có .kind.
      (5) query-keys factory + shouldRetryQuery (HÀM THUẦN — KHÔNG thêm dep @tanstack/react-query vào web-core).
      Wiring QueryClient.defaultOptions trong apps = follow-up S1-FE-QUERY-WIRE-1 (NGOÀI scope WO này).
      (6) export công khai qua web-core/src/index.ts. Test web-core RED→GREEN, giữ 109 cũ xanh; cross-app typecheck xanh.
    paths:
      - packages/web-core/src/lib/api-client.ts          # ApiError overload + header inject + parse meta/type/details
      - packages/web-core/src/lib/api-error-kind.ts       # TỪ STASH — align code constants với BE ERROR_CODES
      - packages/web-core/src/lib/error-mapper.ts         # TỪ STASH — map ApiError.kind → ErrorUiMapping
      - packages/web-core/src/lib/api-types.ts            # TỪ STASH — DEDUP NAMED re-export với contracts
      - packages/web-core/src/lib/api-request-id.ts       # TỪ STASH — land như-cũ
      - packages/web-core/src/lib/api-idempotency.ts      # TỪ STASH — land như-cũ
      - packages/web-core/src/lib/api-params.ts           # TỪ STASH — land như-cũ
      - packages/web-core/src/lib/query-keys.ts           # TẠO MỚI — factory FRONTEND-04 §17 (mảng thuần)
      - packages/web-core/src/lib/query-retry.ts          # TẠO MỚI — shouldRetryQuery FRONTEND-04 §16.2 (hàm thuần)
      - packages/web-core/src/index.ts                    # export additive khối mới
      - packages/web-core/src/lib/api-error-kind.spec.ts  # TẠO MỚI — colocated (vitest include=src/**/*.spec.{ts,tsx})
      - packages/web-core/src/lib/error-mapper.spec.ts    # TẠO MỚI
      - packages/web-core/src/lib/api-params.spec.ts      # TẠO MỚI
      - packages/web-core/src/lib/api-idempotency.spec.ts # TẠO MỚI (request-id + idempotency)
      - packages/web-core/src/lib/query-keys.spec.ts      # TẠO MỚI
      - packages/web-core/src/lib/api-client.spec.ts      # CẬP NHẬT — thêm case 403/422/500 kind + request-id + idempotency header (GIỮ 18 case cũ + positional construct vẫn xanh)
acceptanceChecks:
  - "ApiError CÓ 2 dạng khởi tạo (overload): positional `new ApiError(status,code,message)` (BACK-COMPAT — auth-api.spec.ts:76 + apps/auth/login.spec.tsx:108,171 KHÔNG sửa) + object-arg `new ApiError({message,kind,status,code,type?,details?,requestId?,raw?})`; cả 2 set status/code/message + tự suy kind nếu thiếu (positional → mapStatusToErrorKind(status,code))"
  - "ApiError mang thêm prop kind/type/details/requestId/raw; status/code GIỮ REQUIRED (readonly status:number, code:string) — consumer CATCH cũ đọc .status/.code/.message KHÔNG vỡ; ~91 consumer + 18 test giữ nguyên"
  - "toApiError (object-arg) đọc error.code + error.type + error.details + meta.request_id từ envelope lỗi {success:false,message,data:null,error:{code,type,details},meta:{request_id,timestamp}}; kind = mapStatusToErrorKind(status,code,type)"
  - "mapStatusToErrorKind ALIGN BE ERROR_CODES THẬT: 401→UNAUTHENTICATED, 403→FORBIDDEN, 404→NOT_FOUND, 409→CONFLICT, 422→VALIDATION (BE map 422→VALIDATION-ERR-001 → KIND=VALIDATION, KHÔNG BUSINESS_RULE), 400→VALIDATION, 429→RATE_LIMIT, 5xx→SERVER; code-prefix VALIDATION-ERR ưu tiên TRƯỚC nhánh status 422 (xem §3.2)"
  - "rawFetch gắn header MỖI request: X-Request-Id (createRequestId → 'req_<uuid>', khớp BE charset /^[\\w.-]{1,128}$/), X-Client-Type, X-Client-Version; Idempotency-Key CHỈ khi opts.idempotencyKey truyền vào — GET không gắn"
  - "apiFetch opts mở rộng {skipAuth?, idempotencyKey?, requestId?} (BACK-COMPAT — opts vẫn optional, tham số thứ 4); KHÔNG đổi chữ ký 3 tham số đầu (path, schema, init)"
  - "error-mapper.mapApiErrorToUi: UNAUTHENTICATED/TOKEN_EXPIRED→REDIRECT_LOGIN, FORBIDDEN/SCOPE_DENIED→FORBIDDEN_PAGE, VALIDATION→FORM_ERRORS, NOT_FOUND→NOT_FOUND_PAGE, CONFLICT→INLINE_ALERT, NETWORK/SERVER/UNKNOWN→ERROR_STATE; mang requestId; non-ApiError→TOAST_ERROR"
  - "api-types.ts DEDUP NAMED re-export (KHÔNG `export *`): `export type { ErrorDetail as ApiValidationDetail, Pagination as ApiPagination, ResponseMeta as ApiMeta } from '@mediaos/contracts'` — TRÁNH đụng tên type `ApiError` của contracts (index.ts:33) với class ApiError của web-core; chỉ giữ type RIÊNG web-core: ApiRequestOptions/HttpMethod/ApiListParams/TableQueryState + ApiSuccessResponse/ApiErrorResponse (literal-discriminated shape FE)"
  - "query-keys.ts: rootKeys + factory authKeys/dashboardKeys/hrKeys/attendanceKeys/leaveKeys/taskKeys/notificationKeys (FRONTEND-04 §17) — mảng const thuần, KHÔNG import react-query"
  - "query-retry.shouldRetryQuery(failureCount,error): ≥2 lần→false; ApiError kind UNAUTHENTICATED/TOKEN_EXPIRED/FORBIDDEN/SCOPE_DENIED/VALIDATION/BUSINESS_RULE/NOT_FOUND→false; NETWORK/SERVER/MAINTENANCE/UNKNOWN→true — KHÔNG dep @tanstack/react-query"
  - "done_when#2 ranh giới: web-core CHỈ CUNG CẤP query-keys + shouldRetryQuery (hàm thuần) + Zod-validate (đã có ở apiFetch); wiring QueryClient.defaultOptions{retry:shouldRetryQuery,staleTime} trong apps/*/main.tsx = follow-up S1-FE-QUERY-WIRE-1 (ngoài paths WO này)"
  - "BẤT BIẾN token-storage (FE04-SEC): grep KHÔNG có localStorage/sessionStorage chứa access/refresh token; KHÔNG console.log token trong code mới; KHÔNG đụng nhánh refresh-on-401 single-flight (crown FS-1b)"
  - "web-core/src/index.ts export additive: ApiError + ApiErrorKind + mapApiErrorToUi + ErrorUiMapping/ErrorUiBehavior + createRequestId + createIdempotencyKey + buildQueryString + toApiListParams + ApiListParams/TableQueryState + *Keys + shouldRetryQuery"
  - "pnpm --filter @mediaos/web-core test XANH (109 cũ + case mới); typecheck + build XANH cho @mediaos/contracts + @mediaos/web-core + @mediaos/auth + @mediaos/console + @mediaos/app (cross-app — vì ApiError là API công khai); KHÔNG @ts-ignore / eslint-disable"
testTasks:
  - "api-error-kind.spec.ts — mapStatusToErrorKind: (1) 401→UNAUTHENTICATED; (2) 403→FORBIDDEN; (3) 404→NOT_FOUND; (4) 409→CONFLICT; (5) 422 với code='VALIDATION-ERR-001'→VALIDATION (CHỨNG MINH không bị BUSINESS_RULE — đối chiếu BE map 422→VALIDATION); (6) 400→VALIDATION; (7) 429→RATE_LIMIT; (8) 500/503→SERVER/MAINTENANCE; (9) status lạ→UNKNOWN"
  - "error-mapper.spec.ts — mapApiErrorToUi: mỗi kind → đúng behavior (REDIRECT_LOGIN/FORBIDDEN_PAGE/FORM_ERRORS/NOT_FOUND_PAGE/INLINE_ALERT/ERROR_STATE); requestId mang theo; non-ApiError (Error thường)→TOAST_ERROR message mặc định; isValidationDetails narrow `unknown→ErrorDetail[]` an toàn (KHÔNG `as`)"
  - "api-idempotency.spec.ts — createRequestId() có prefix 'req_' + duy nhất 2 lần gọi; createIdempotencyKey('x') = 'x_<uuid>'; không prefix = uuid trần; fallback KHÔNG ném khi crypto vắng"
  - "api-params.spec.ts — buildQueryString: bỏ undefined/null/''; array→multi-value; object→bracket; rỗng→''; có '?' đầu khi có param. toApiListParams: sort+order→'field:dir'; search.trim()"
  - "query-keys.spec.ts — key ổn định/đúng tiền tố: authKeys.me()=['auth','me']; hrKeys.employees.list(p) chứa 'employees','list',p; key KHÁC nhau khi params khác (ổn định cho invalidation)"
  - "api-client.spec.ts (CẬP NHẬT) — THÊM helper `errResFull(status,{code,type,details,requestId})` body lỗi CÓ meta.request_id + error.type (errRes cũ thiếu meta/type — GIỮ nguyên cho 18 case cũ): (1) 403 → kind='FORBIDDEN', KHÔNG refresh, KHÔNG redirect; (2) 422 code='VALIDATION-ERR-001' → kind='VALIDATION', details[] surface; (3) 500 → kind='SERVER'; (4) request có header X-Request-Id + X-Client-Type; (5) opts.idempotencyKey → header Idempotency-Key xuất hiện, GET KHÔNG có; (6) ApiError.requestId = meta.request_id từ errResFull; (7) GIỮ 18 case cũ xanh (error:null success vẫn unwrap; positional construct vẫn compile)"
steps:
  - "BƯỚC 0 — RED: viết api-error-kind.spec.ts + error-mapper.spec.ts + bổ sung case 403/422/500/header/idempotency (+ errResFull) vào api-client.spec.ts TRƯỚC. Chạy → FAIL (chưa có api-error-kind.ts, ApiError chưa có .kind/.requestId, chưa gắn header)."
  - "BƯỚC 1 — land 3 helper THUẦN từ stash NHƯ-CŨ từ ĐÚNG commit untracked: `git checkout 4de72b7 -- packages/web-core/src/lib/api-request-id.ts packages/web-core/src/lib/api-idempotency.ts packages/web-core/src/lib/api-params.ts` (4de72b7 = parent-3 untracked của stash@{1}; KHÔNG dùng `stash@{1} -- path` cho file untracked — không tin cậy mọi git version). KHÔNG land api-types/error-kind/error-mapper thô (cần sửa — BƯỚC 2/3)."
  - "BƯỚC 2 — api-types.ts (lấy từ 4de72b7, SỬA dedup NAMED): GIỮ ApiRequestOptions/HttpMethod/ApiListParams/TableQueryState/toApiListParams + ApiSuccessResponse/ApiErrorResponse/ApiErrorPayload (literal-discriminated shape FE; contracts chỉ có Zod schema, không export discriminated literal `success:true`). THAY 3 interface trùng bằng NAMED re-export (KHÔNG `export *`): `export type { ErrorDetail as ApiValidationDetail, Pagination as ApiPagination, ResponseMeta as ApiMeta } from '@mediaos/contracts'`. Lý do NAMED: `export *` sẽ kéo type `ApiError` của contracts (index.ts:33) đụng class ApiError của web-core."
  - "BƯỚC 3 — api-error-kind.ts (lấy từ 4de72b7, SỬA align BE): GIỮ ApiErrorKind enum + mapStatusToErrorKind. ALIGN apps/api/.../error-codes.ts: BE KHÔNG phát AUTH-ERR-TOKEN-EXPIRED / AUTH-ERR-SCOPE-DENIED → 2 nhánh code đó forward-compat (giữ; fall-through theo status vẫn đúng). 422: BE map 400+422→VALIDATION-ERR-001 → ĐỔI thứ tự: check `code?.startsWith('VALIDATION-ERR') || type==='ZodValidationException'` TRƯỚC nhánh `status===422→BUSINESS_RULE`, để 422-validation ra KIND=VALIDATION (khớp done_when '422(validation)'); giữ `422 + type==='BusinessRuleError'→BUSINESS_RULE` cho module sau. Ghi comment deviation vs §10.2."
  - "BƯỚC 4 — api-client.ts ApiError OVERLOAD (KHÔNG breaking): khai 2 signature `constructor(status:number, code:string, message:string)` + `constructor(input:{message:string; kind?:ApiErrorKind; status?:number; code?:string; type?:string; details?:unknown; requestId?:string; raw?:unknown})`; impl phân nhánh `typeof a==='number'`: positional → status=a, code, kind=mapStatusToErrorKind(a,code); object → status=input.status??0, code=input.code??'HTTP_ERROR', kind=input.kind ?? mapStatusToErrorKind(...), gán type/details/requestId/raw. readonly status:number+code:string REQUIRED. Import mapStatusToErrorKind từ ./api-error-kind. Sửa toApiError (L78-97) → object-arg đính {status,code,type,details, requestId:meta?.request_id, message, raw}; parse thêm error.type+error.details+meta.request_id. 401-fail throw (L302) → object-arg {status:401, code:'AUTH-ERR-UNAUTHENTICATED', kind:'UNAUTHENTICATED', message}."
  - "BƯỚC 5 — api-client.ts header inject: rawFetch thêm `X-Request-Id: createRequestId()` + `X-Client-Type` + `X-Client-Version` mỗi request (hằng mặc định 'web'/'0.1.0' + `configureClient()` mẫu configureApiBaseUrl — KHÔNG import.meta trong package; TODO: app override version từ build env ở S1-FE-QUERY-WIRE-1/shell). apiFetch opts += {idempotencyKey?, requestId?}; opts.idempotencyKey → set header Idempotency-Key. GIỮ Authorization/credentials/Content-Type + thứ tự refresh-on-401 KHÔNG đổi. Lưu ý: 18 test cũ assert `init.headers.Authorization`/`credentials` — header MỚI là field thêm, KHÔNG xoá/đổi field cũ → assert cũ vẫn xanh."
  - "BƯỚC 6 — error-mapper.ts (lấy từ 4de72b7): import ApiError từ ./api-client (đã có .kind) → BỎ cast `error.kind as string|undefined`, dùng error.kind trực tiếp. import type ApiValidationDetail từ ./api-types. Giữ mapApiErrorToUi + isValidationDetails (narrow unknown→ErrorDetail[] KHÔNG `as`). applyApiValidationErrors (RHF §23.2): react-hook-form CHƯA là dep web-core → KHÔNG land ở web-core (để app/TODO), tránh kéo dep nặng."
  - "BƯỚC 7 — query-keys.ts (§17) + query-retry.ts (§16.2): mảng const + hàm thuần, KHÔNG import @tanstack/react-query (shouldRetryQuery nhận (failureCount, error:unknown), tham chiếu ApiError qua instanceof). Wiring `new QueryClient({defaultOptions:{queries:{retry:shouldRetryQuery}}})` trong app = S1-FE-QUERY-WIRE-1 (NGOÀI scope)."
  - "BƯỚC 8 — web-core/src/index.ts: export additive khối API mới (ApiError đã export sẵn L18-24; THÊM ApiErrorKind, mapApiErrorToUi, ErrorUiMapping, ErrorUiBehavior, createRequestId, createIdempotencyKey, buildQueryString, toApiListParams, ApiListParams, TableQueryState, *Keys, shouldRetryQuery). KHÔNG xoá export cũ."
  - "BƯỚC 9 — GREEN: pnpm --filter @mediaos/contracts build; pnpm --filter @mediaos/web-core typecheck && build && test → 109 cũ + case mới XANH. grep token-storage guard. CROSS-APP: pnpm --filter @mediaos/auth typecheck && pnpm --filter @mediaos/console typecheck && pnpm --filter @mediaos/app typecheck (xác nhận overload giữ positional construct ở login.spec.tsx + consumer .status/.code không vỡ)."
```

# S0-FE-API-1 — Micro-plan rev2 (reconcile API client · error mapper · query layer với FRONTEND-04)

> Zone: **green** → **LIGHT gate** (`typescript-reviewer` + `quality-gate`). Builder: `frontend-builder`.
> Scope: `packages/web-core/**` (chỉ). depends_on **S0-API-CORE-1 = DONE** (52156cf) → blocker đã gỡ.
> WIP gốc ở **`git stash@{1}`** (6 file untracked, commit `4de72b7`) — note backlog cũ ghi `stash@{0}` đã LỖI THỜI.
> **Rev2 (2026-06-23):** vá 2 BLOCK của plan-reviewer (§2 overload + §6 follow-up WO) + 4 cảnh báo.

## 0. Kết quả đối chiếu (verify line-level 2026-06-23)

| done_when | Trạng thái hiện tại (đã đọc code) | Hành động |
| --- | --- | --- |
| #1 api-client: token + map **401/403/422/500** + request-id + idempotency | ⚠️ **GAP một phần**: 401-refresh single-flight ✅ (FS-1b, `api-client.ts:287`); `ApiError` (L65-75) chỉ status/code/message — thiếu kind/type/details/requestId; 403/422/500 gộp generic; **0** header X-Request-Id / Idempotency-Key. | overload ApiError + header inject + parse meta |
| #2 query/cache layer + invalidation + validate Zod | ⚠️ **MỘT PHẦN có sẵn ngoài web-core**: Zod-validate ✅ (`apiFetch` `schema.parse`); apps đã `new QueryClient()` + Provider + ~40 `*-api.ts`. **web-core thiếu**: query-keys + retry policy + error-mapper. **Wiring defaultOptions = follow-up §6**. | thêm query-keys + shouldRetryQuery + error-mapper (web-core) |
| #3 web-core test xanh | ✅ baseline **109 pass / 9 file** | RED→GREEN, giữ 109 cũ + cross-app typecheck |

## 1. Tài sản tái dùng từ stash (commit `4de72b7` — parent-3 untracked của stash@{1})

| File | Tái dùng | Ghi chú |
| --- | --- | --- |
| `api-request-id.ts` | ✅ NHƯ-CŨ | thuần, fallback crypto an toàn test |
| `api-idempotency.ts` | ✅ NHƯ-CŨ | thuần |
| `api-params.ts` | ✅ NHƯ-CŨ | `buildQueryString` thuần |
| `api-types.ts` | ⚠️ SỬA dedup NAMED | re-export `ErrorDetail`/`Pagination`/`ResponseMeta` (named) từ contracts — KHÔNG `export *` (đụng tên `ApiError`) |
| `api-error-kind.ts` | ⚠️ SỬA align BE | thứ tự 422→VALIDATION (§3.2); code TOKEN-EXPIRED/SCOPE-DENIED là forward-compat |
| `error-mapper.ts` | ⚠️ SỬA | bỏ cast `error.kind as string|undefined` sau khi ApiError có `.kind` |

Lý do run `wby3ahcpy` dừng: stash thêm helper NHƯNG **chưa sửa `api-client.ts`** → `ApiError` không có `.kind/.requestId` → error-mapper lệch shape. Plan vá đúng mắt xích đó (BƯỚC 4).

## 2. ApiError — CONSTRUCTOR OVERLOAD (vá BLOCK #1)

> **plan-review BLOCK #1:** rev1 §2 khẳng định SAI *"không ai construct ApiError ngoài api-client.ts"*. Thực tế grep `new ApiError(` có **5 site**, 3 site **positional ngoài** api-client.ts: `packages/web-core/src/lib/auth-api.spec.ts:76` (trong scope, rev1 bỏ sót khỏi paths) + `apps/auth/src/routes/login.spec.tsx:108,171` (NGOÀI scope `packages/web-core/**`). Đổi sang object-arg-ONLY sẽ vỡ `tsc` cả `@mediaos/web-core` lẫn `@mediaos/auth`.

**Giải pháp: OVERLOAD** (giữ positional + thêm object-arg) — KHÔNG breaking, KHÔNG đụng file nào ngoài `api-client.ts`:

```ts
constructor(status: number, code: string, message: string);                       // BACK-COMPAT (giữ nguyên)
constructor(input: { message: string; kind?: ApiErrorKind; status?: number;
  code?: string; type?: string; details?: unknown; requestId?: string; raw?: unknown });
```

- 3 site positional ngoài (auth-api.spec.ts + apps/auth/login.spec.tsx) **biên dịch nguyên** → 0 vi phạm `guard-scope`, 0 đụng `apps/auth`.
- `status`/`code` **REQUIRED** (readonly status:number, code:string) — positional luôn set; object-arg default `status??0`, `code??'HTTP_ERROR'`. Lệch nhẹ FRONTEND-04 §10.1 (đặt `status?/code?` optional) nhưng AN TOÀN type cho consumer + 0 churn. Ghi comment.
- Positional auto-suy `kind = mapStatusToErrorKind(status, code)` → object cũ vẫn có kind hợp lý.
- ApiError **ở lại `api-client.ts`** — khớp `error-mapper.ts` đã `import { ApiError } from "./api-client"`; `api-error-kind.ts` tách riêng chống vòng phụ thuộc.

## 3. Hai điểm reconcile QUAN TRỌNG (align BE thật, không bịa)

### 3.1 Kind mapper bám `ERROR_CODES` BE đã land
`apps/api/src/common/errors/error-codes.ts` chỉ phát: `AUTH-ERR-UNAUTHENTICATED`, `AUTH-ERR-FORBIDDEN`, `VALIDATION-ERR-001`, `RESOURCE-ERR-NOT-FOUND`, `RESOURCE-ERR-CONFLICT`, `SYSTEM-ERR-RATE-LIMIT`, `REQUEST-ERR-001`, `SYSTEM-ERR-001`. → `mapStatusToErrorKind` dựa **status là chính**; nhánh code `AUTH-ERR-TOKEN-EXPIRED`/`SCOPE-DENIED` (stash) giữ forward-compat (fall-through theo status đúng UNAUTHENTICATED/FORBIDDEN).

### 3.2 422 = VALIDATION (KHÔNG BUSINESS_RULE) — lệch FRONTEND-04 §10.2 có chủ ý
BE `httpStatusToCode` map **cả 400 và 422 → `VALIDATION-ERR-001`**. FRONTEND-04 §10.2 mẫu lại đặt `status===422 → BUSINESS_RULE` *trước* khi xét code. → **ĐỔI thứ tự**: xét `code?.startsWith('VALIDATION-ERR')`/Zod `type` **TRƯỚC** nhánh `status===422`. Kết quả: 422-validation ra `kind='VALIDATION'` — khớp done_when #1. Giữ `422 + type==='BusinessRuleError' → BUSINESS_RULE` cho module sau. Ghi comment deviation trong mapper.

### 3.3 Đụng tên `ApiError` (cảnh báo plan-review) — re-export NAMED
`@mediaos/contracts` export **type** `ApiError` (index.ts:33) TRÙNG tên **class** `ApiError` web-core (index.ts:18-24). → `api-types.ts` BẮT BUỘC re-export **named** `export type { ErrorDetail as ApiValidationDetail, Pagination as ApiPagination, ResponseMeta as ApiMeta } from '@mediaos/contracts'` — TUYỆT ĐỐI KHÔNG `export *` (sẽ kéo type ApiError gây collision).

## 4. Header & request metadata (done_when #1)
`rawFetch` thêm mỗi request: `X-Request-Id` (createRequestId → `req_<uuid>`, khớp BE charset `/^[\w.-]{1,128}$/` ở `request-id.middleware.ts:15` → BE echo, không ghi đè), `X-Client-Type`, `X-Client-Version`. `Idempotency-Key` **chỉ** khi `opts.idempotencyKey` (action quan trọng §11.3). `apiFetch` opts += `{idempotencyKey?, requestId?}` — tham số thứ 4 optional → **back-compat tuyệt đối**. Client-type/version từ hằng `'web'`/`'0.1.0'` + `configureClient()` (mẫu `configureApiBaseUrl`); version hard-code là tạm — TODO đọc build env ở WO shell.

## 5. Query layer — ranh giới web-core (done_when #2)
web-core CHỈ cung cấp phần thuần, không React:
- `query-keys.ts` — factory mảng const (§17): rootKeys + auth/dashboard/hr/attendance/leave/task/notification.
- `query-retry.ts` — `shouldRetryQuery(failureCount, error)` (§16.2), hàm thuần (`instanceof ApiError`).
- **KHÔNG thêm `@tanstack/react-query` vào deps web-core** (đã verify package.json:23-28 không có); QueryProvider là JSX tầng app.
- `applyApiValidationErrors` (RHF §23.2): react-hook-form CHƯA là dep web-core → để tầng app/TODO; `mapApiErrorToUi`+`isValidationDetails` (không cần RHF) land ở web-core.

## 6. Out-of-scope + follow-up WO (vá BLOCK #2)
> **plan-review BLOCK #2:** done_when #2 ("TanStack Query + invalidation") không thể thoả 100% trong scope `packages/web-core/**` vì apps đang `new QueryClient()` **trần** (console/app `main.tsx:21`). rev1 đẩy sang "S1-FE-* mơ hồ".

**Chốt ranh giới rõ:** ở WO này, done_when #2 = web-core *cung cấp* query-keys + shouldRetryQuery (hàm thuần) + Zod-validate (đã có). **Wiring** `QueryClient.defaultOptions{retry:shouldRetryQuery, staleTime/gcTime theo §16.3}` + override `X-Client-Version` từ build env trong `apps/*/main.tsx` = **follow-up `S1-FE-QUERY-WIRE-1`** (id thật, đã thêm vào backlog). Module `*.api.ts`/`*.keys.ts`/query hook cụ thể (useEmployees…) = FRONTEND-06→12. MSW mock / upload-download / debug telemetry = phase sau (§26/27/31/32).

## 7. Bất biến giữ nguyên
- **#3 no-secret (FE04-SEC):** token in-memory Zustand + refresh HttpOnly cookie (giữ FS-1b, `api-client.ts:99-104,178`); KHÔNG localStorage/sessionStorage token; KHÔNG `console.log` token. Header redaction là việc BE. Grep guard trong verify. **KHÔNG đụng nhánh refresh-on-401 single-flight (crown)** — chỉ thêm header trong `rawFetch`.
- **#1/#2 (company_id/audit):** WO thuần FE, không chạm DB/repository/audit.
- **Rollback:** thuần FE additive → rollback = `git revert`; không migration, không state ngoài.

## 8. Verify (lane độc lập)
```bash
# BƯỚC 0 — RED trước
pnpm --filter @mediaos/web-core test -- api-error-kind error-mapper   # đích: RED

# GREEN:
pnpm --filter @mediaos/contracts build        # type re-export cần contracts build trước (turbo dep)
pnpm --filter @mediaos/web-core typecheck && pnpm --filter @mediaos/web-core build
pnpm --filter @mediaos/web-core test          # đích: 109 cũ + case mới XANH

# CROSS-APP typecheck (ApiError là API công khai — overload phải giữ positional construct xanh):
pnpm --filter @mediaos/auth typecheck         # đích: login.spec.tsx positional construct OK
pnpm --filter @mediaos/console typecheck
pnpm --filter @mediaos/app typecheck

# Guard token-storage (đích: rỗng):
grep -rnE "(local|session)Storage" packages/web-core/src | grep -iE "token|access|refresh"
```

## 9. Gate
Zone green → **LIGHT gate**: `typescript-reviewer` + `quality-gate`. Reviewer tập trung:
- ApiError overload: positional + object-arg đều set status/code/message; consumer `.status/.code/.message` + 3 positional construct-site không vỡ; không `as any`/`@ts-ignore`.
- Kind mapper 422→VALIDATION khớp BE; không bịa code BE không phát.
- DEDUP type với contracts NAMED re-export (không wildcard → không đụng tên ApiError); không drift DTO.
- Không thêm dep nặng (react-query/RHF) vào web-core; không token vào storage/log.
- Cross-app typecheck xanh (apps/auth là rủi ro chính của reshape).
