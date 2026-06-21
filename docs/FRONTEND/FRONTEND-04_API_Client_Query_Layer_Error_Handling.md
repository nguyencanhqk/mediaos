> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# FRONTEND-04: API CLIENT, QUERY LAYER & ERROR HANDLING

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · **FRONTEND-04 API Client** · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Chuẩn API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [FOUNDATION API: API-09](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Routing & Auth Guard: FRONTEND-03](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [Kiến trúc FE: FRONTEND-01](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-04 |
| Tên tài liệu | API Client, Query Layer & Error Handling |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-03 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-04 mô tả cách triển khai lớp **API Client**, **Query Layer** và **Error Handling** cho frontend của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chuẩn hóa toàn bộ cách frontend gọi API backend.
2. Áp dụng thống nhất chuẩn response thành công, response lỗi, validation error và pagination đã chốt trong API-01.
3. Tạo một API client dùng chung cho toàn hệ thống thay vì mỗi module tự gọi `fetch` riêng.
4. Chuẩn hóa cách inject token, request id, client metadata và idempotency key.
5. Chuẩn hóa cách xử lý 401, refresh token, logout, redirect login và clear query cache.
6. Chuẩn hóa cách map lỗi API thành UI state: toast, form error, empty state, forbidden state, degraded state, retry state.
7. Tổ chức TanStack Query theo query key factory, hook convention, cache strategy và invalidation rule.
8. Tạo nền tảng cho các module AUTH, DASH, HR, ATT, LEAVE, TASK, NOTI và SYSTEM tích hợp API nhất quán.
9. Giảm code trùng lặp, giảm lỗi xử lý sai response, giảm rủi ro cache dữ liệu cũ hoặc lộ dữ liệu sau logout.
10. Làm cơ sở cho FRONTEND-05 Layout Implementation và các tài liệu frontend nghiệp vụ tiếp theo.

---

## 3. Vị trí FRONTEND-04 trong roadmap frontend

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System/Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```

FRONTEND-04 là lớp nền bắt buộc trước khi các module nghiệp vụ gọi API thật.

---

## 4. Căn cứ triển khai

FRONTEND-04 bám theo các quyết định đã chốt:

1. API public dùng prefix `/api/v1`.
2. Backend là nguồn kiểm soát quyền cuối cùng; frontend chỉ hỗ trợ UX bằng guard, hide, disable, mask và state.
3. Frontend không được tự gửi `company_id`, `user_id`, `employee_id`, `role`, `permission` nếu backend có thể resolve từ auth context.
4. Mọi API nghiệp vụ mặc định yêu cầu authentication.
5. Access token và refresh token là cơ chế xác thực chính của MVP.
6. Response thành công có format thống nhất: `success`, `message`, `data`, `meta`, và có `pagination` nếu là list.
7. Response lỗi có format thống nhất: `success`, `message`, `error`, `meta`.
8. Validation error có `details` theo từng field.
9. API list hỗ trợ pagination, search, filter, sort theo whitelist.
10. API quan trọng cần hỗ trợ `Idempotency-Key` để chống xử lý trùng.
11. File upload dùng service chung; file private là mặc định.
12. File download phải kiểm tra permission trước khi cấp link.
13. Dashboard cần hỗ trợ lazy load widget, cache, refresh và fallback khi module nguồn lỗi.
14. Notification deep link và dashboard quick action phải điều hướng về module gốc, không bỏ qua permission/data scope/business rule.
15. Khi logout phải clear auth context, sensitive query cache, app/sidebar/action cache theo user.
16. Design System đã có các state component cần dùng lại: Loading, Empty, Error, Forbidden, Disabled, Validation, Success, Stale.

---

## 5. Phạm vi FRONTEND-04

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| API contract types | TypeScript type cho success response, error response, pagination, meta, validation detail |
| API client core | Wrapper quanh `fetch`, base URL, method, headers, body, query params, abort signal |
| Auth integration | Token injection, cookie/memory strategy, 401 handling, refresh lock, replay request |
| Request metadata | `X-Request-Id`, `X-Client-Type`, `X-Client-Version`, `Idempotency-Key` |
| Error model | `ApiError`, `ValidationApiError`, `AuthApiError`, `ForbiddenApiError`, `BusinessRuleApiError` |
| Error mapper | Map HTTP/API error sang UI behavior, toast, form error, route redirect |
| TanStack Query | QueryClient config, QueryProvider, query key convention, retry, staleTime, invalidation |
| Module API service | Convention cho `auth.api.ts`, `dashboard.api.ts`, `hr.api.ts`, `attendance.api.ts`, `leave.api.ts`, `task.api.ts`, `notification.api.ts` |
| Query hooks | Convention `useXQuery`, `useXMutation`, optimistic update, invalidation rule |
| Pagination/query params | Chuẩn hóa page, per_page, search, filter, sort |
| Upload/download | API upload file, progress strategy, download signed URL / blob handling |
| Mock API | MSW/mock service theo API-01 contract để frontend không bị chờ backend |
| Testing | Unit test API client, error mapper, query hook, mutation invalidation |
| Security | Không lưu token nhạy cảm trong localStorage, clear cache khi logout, không log secret |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Route guard chi tiết | FRONTEND-03 |
| Layout visual hoàn chỉnh | FRONTEND-05 |
| Login/forgot/reset UI | FRONTEND-06 |
| Dashboard widget UI chi tiết | FRONTEND-07 |
| HR/ATT/LEAVE/TASK/NOTI screen logic | FRONTEND-08 -> FRONTEND-12 |
| Backend middleware/exception handler | Backend/API |
| E2E test toàn bộ flow | FRONTEND-14 |
| CI/CD deploy | FRONTEND-14 hoặc DevOps |

---

## 6. Nguyên tắc thiết kế quan trọng

### 6.1 Một API client chung cho toàn hệ thống

Không để từng module tự viết:

```ts
fetch('/api/v1/hr/employees')
```

Phải đi qua API client chung:

```ts
apiClient.get<EmployeeListItem[]>('/hr/employees', { query: params })
```

Lý do:

1. Header luôn thống nhất.
2. Error luôn được parse thống nhất.
3. 401/refresh token xử lý một chỗ.
4. Request ID và client version luôn được gửi.
5. Có thể log/telemetry dễ hơn.
6. Dễ thay đổi base URL theo môi trường.

### 6.2 API client chỉ xử lý hạ tầng, không chứa nghiệp vụ module

API client được phép xử lý:

1. Base URL.
2. Header.
3. Body serialization.
4. Response parsing.
5. Error normalization.
6. Refresh token.
7. Retry hạ tầng.

API client không xử lý nghiệp vụ như:

1. Check-in có hợp lệ không.
2. Đơn nghỉ có được duyệt không.
3. Task có thể chuyển trạng thái không.
4. Field nào trong HR nhạy cảm.

Các rule đó thuộc backend và module service/hook tương ứng.

### 6.3 Không tin dữ liệu định danh tự gửi từ frontend

Frontend không tự truyền các trường sau trong nghiệp vụ thông thường nếu backend có thể resolve từ token/session:

```text
company_id
user_id
employee_id
role
permission
data_scope
```

Ví dụ tạo đơn nghỉ của chính mình:

```http
POST /api/v1/leave/requests
```

Body chỉ chứa dữ liệu nghiệp vụ:

```json
{
  "leave_type_id": "uuid",
  "start_date": "2026-07-01",
  "end_date": "2026-07-02",
  "reason": "Nghỉ phép cá nhân"
}
```

Không gửi:

```json
{
  "company_id": "...",
  "employee_id": "..."
}
```

### 6.4 Error phải chuyển thành UX rõ ràng

Mọi lỗi API cần được map ra UI behavior thống nhất:

| Lỗi | UI behavior |
| --- | --- |
| 400 validation | Hiển thị lỗi field trong form, kèm error summary nếu cần |
| 401 unauthenticated | Refresh token một lần; nếu fail redirect login |
| 403 forbidden | Forbidden state hoặc disabled action tùy context |
| 404 not found | NotFound state cho detail page hoặc toast nếu action |
| 409 conflict | Toast/inline alert, refetch dữ liệu mới |
| 422 business rule | Alert business rule, giữ form/data để user chỉnh |
| 429 rate limit | Toast nhẹ, disable retry trong vài giây nếu có `retry_after` |
| 500 system | ErrorState có nút thử lại |
| 503 maintenance | Maintenance state hoặc banner |
| Network error | Offline/network error state, cho phép retry |

### 6.5 TanStack Query là nguồn server-state

Dữ liệu từ backend không lưu thủ công vào Zustand nếu không cần.

Đúng:

```text
Employee list -> TanStack Query
Leave request detail -> TanStack Query
Dashboard widget -> TanStack Query
Notification unread count -> TanStack Query
```

Zustand/Context chỉ dùng cho client-state nhỏ:

```text
sidebar collapsed
app switcher open
current modal/drawer state
non-sensitive preferences
```

### 6.6 Query key phải ổn định và có factory

Không viết query key rải rác:

```ts
['employees', page]
['hr-employees', page]
['employee-list', filters]
```

Phải dùng factory:

```ts
hrKeys.employees.list(params)
```

Lý do:

1. Tránh invalidation thiếu hoặc sai.
2. Dễ refactor endpoint.
3. Dễ test.
4. Dễ clear cache theo module khi logout hoặc chuyển user.

---

## 7. Cấu trúc thư mục đề xuất

```text
src/
  services/
    api/
      api-client.ts
      api-config.ts
      api-error.ts
      api-types.ts
      api-utils.ts
      api-request-id.ts
      api-idempotency.ts
      api-params.ts
      api-upload.ts
      api-download.ts
      refresh-session.ts
      query-client.ts
      query-provider.tsx
      query-keys.ts
      error-mapper.ts
      mock-api.ts
    auth/
      auth-token-store.ts
      auth-session-events.ts
  modules/
    auth/
      services/
        auth.api.ts
        auth.keys.ts
      hooks/
        useAuthMe.ts
        useLogin.ts
        useLogout.ts
    dashboard/
      services/
        dashboard.api.ts
        dashboard.keys.ts
      hooks/
        useDashboardMe.ts
        useDashboardWidget.ts
    hr/
      services/
        hr.api.ts
        hr.keys.ts
      hooks/
        useEmployees.ts
        useEmployeeDetail.ts
        useCreateEmployee.ts
    attendance/
      services/
        attendance.api.ts
        attendance.keys.ts
      hooks/
        useTodayAttendance.ts
        useCheckIn.ts
        useCheckOut.ts
    leave/
      services/
        leave.api.ts
        leave.keys.ts
      hooks/
        useMyLeaveBalances.ts
        useLeaveRequests.ts
        useCreateLeaveRequest.ts
    tasks/
      services/
        task.api.ts
        task.keys.ts
      hooks/
        useMyTasks.ts
        useTaskDetail.ts
        useUpdateTaskStatus.ts
    notifications/
      services/
        notification.api.ts
        notification.keys.ts
      hooks/
        useUnreadCount.ts
        useNotifications.ts
        useMarkNotificationRead.ts
  lib/
    errors/
      user-message-dictionary.ts
      error-copy.ts
    formatters/
      format-api-message.ts
  providers/
    AppProviders.tsx
```

---

## 8. Environment config

### 8.1 Biến môi trường

```env
VITE_APP_NAME="Enterprise Management System"
VITE_APP_ENV="local"
VITE_API_BASE_URL="http://localhost:3000/api/v1"
VITE_CLIENT_TYPE="web"
VITE_CLIENT_VERSION="0.1.0"
VITE_ENABLE_MOCK_API="false"
VITE_ENABLE_API_DEBUG="true"
```

### 8.2 API config

```ts
// src/services/api/api-config.ts
export const apiConfig = {
  baseUrl: process.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  clientType: process.env.VITE_CLIENT_TYPE ?? 'web',
  clientVersion: process.env.VITE_CLIENT_VERSION ?? '0.1.0',
  enableDebug: process.env.VITE_ENABLE_API_DEBUG === 'true',
};
```

### 8.3 Nguyên tắc env

1. Không lưu secret trong biến `VITE_*`.
2. Không hard-code API domain trong source code.
3. Không expose refresh token, access token hoặc API secret qua env frontend.
4. Mỗi môi trường có base URL riêng.
5. Version frontend phải gửi qua header để backend/debug biết client version.

---

## 9. API contract types

### 9.1 Meta và pagination

```ts
// src/services/api/api-types.ts
export interface ApiMeta {
  request_id: string;
  timestamp: string;
  correlation_id?: string;
}

export interface ApiPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}
```

### 9.2 Success response

```ts
export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ApiMeta;
  pagination?: ApiPagination;
}

export type ApiListResponse<T> = ApiSuccessResponse<T[]> & {
  pagination: ApiPagination;
};
```

### 9.3 Error response

```ts
export interface ApiValidationDetail {
  field: string;
  message: string;
  rule?: string;
  value?: unknown;
}

export interface ApiErrorPayload {
  code: string;
  type: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: ApiErrorPayload;
  meta: ApiMeta;
}
```

### 9.4 Request options

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions<TBody = unknown> {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  requireAuth?: boolean;
  idempotencyKey?: string;
  skipRefreshAuth?: boolean;
  responseType?: 'json' | 'blob' | 'text';
}
```

### 9.5 List params chuẩn

```ts
export interface ApiListParams {
  page?: number;
  per_page?: number;
  search?: string;
  sort?: string; // dạng kết hợp `field:direction`, ví dụ `created_at:desc` (API-01 §17.3)
  filters?: Record<string, string | number | boolean | string[] | null | undefined>;
}
```

> **Lưu ý `search` vs `keyword`:** List nghiệp vụ (HR, ATT, LEAVE, TASK, NOTI) dùng param `search` theo API-01 §17.1. Riêng các list FOUNDATION/admin (companies, modules, system-settings, audit-logs) dùng param `keyword` theo API-09. Client phải map `search` của `ApiListParams` sang `keyword` khi gọi các endpoint FOUNDATION/admin tương ứng.

---

## 10. API error model

### 10.1 Base ApiError

```ts
// src/services/api/api-error.ts
export type ApiErrorKind =
  | 'NETWORK'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'SCOPE_DENIED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'MAINTENANCE'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly type?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly raw?: unknown;

  constructor(input: {
    message: string;
    kind: ApiErrorKind;
    status?: number;
    code?: string;
    type?: string;
    details?: unknown;
    requestId?: string;
    raw?: unknown;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
    this.type = input.type;
    this.details = input.details;
    this.requestId = input.requestId;
    this.raw = input.raw;
  }
}
```

### 10.2 Error kind mapping

```ts
export function mapStatusToErrorKind(status: number, code?: string, type?: string): ApiErrorKind {
  if (status === 401 && code === 'AUTH-ERR-TOKEN-EXPIRED') return 'TOKEN_EXPIRED';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403 && code === 'AUTH-ERR-SCOPE-DENIED') return 'SCOPE_DENIED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || type === 'BusinessRuleError') return 'BUSINESS_RULE';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 503) return 'MAINTENANCE';
  if (status >= 500) return 'SERVER';
  if (type === 'ValidationError' || code?.startsWith('VALIDATION-ERR')) return 'VALIDATION';
  if (status === 400) return 'VALIDATION';
  return 'UNKNOWN';
}
```

### 10.3 Parse API error response

```ts
export async function parseApiError(response: Response): Promise<ApiError> {
  let payload: ApiErrorResponse | null = null;

  try {
    payload = (await response.json()) as ApiErrorResponse;
  } catch {
    payload = null;
  }

  const code = payload?.error?.code;
  const type = payload?.error?.type;
  const kind = mapStatusToErrorKind(response.status, code, type);

  return new ApiError({
    message: payload?.message || 'Có lỗi xảy ra khi gọi API',
    kind,
    status: response.status,
    code,
    type,
    details: payload?.error?.details,
    requestId: payload?.meta?.request_id,
    raw: payload,
  });
}
```

### 10.4 Network error

```ts
export function createNetworkError(error: unknown) {
  return new ApiError({
    message: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.',
    kind: 'NETWORK',
    raw: error,
  });
}
```

---

## 11. Request ID và idempotency

### 11.1 Request ID

```ts
// src/services/api/api-request-id.ts
export function createRequestId() {
  const random = crypto.randomUUID();
  return `req_${random}`;
}
```

Mỗi request nên gửi:

```http
X-Request-Id: req_<uuid>
X-Client-Type: web
X-Client-Version: 0.1.0
```

### 11.2 Idempotency key

```ts
// src/services/api/api-idempotency.ts
export function createIdempotencyKey(prefix?: string) {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}
```

### 11.3 Khi nào cần idempotency key

| Action | Cần `Idempotency-Key` |
| --- | --- |
| Login | Không bắt buộc |
| Check-in/check-out | Có |
| Tạo đơn nghỉ | Có |
| Submit/approve/reject leave | Có |
| Tạo nhân viên | Có |
| Tạo task/project | Có |
| Upload file | Nên có nếu backend hỗ trợ |
| Mark notification read | Không bắt buộc |
| GET list/detail | Không |

---

## 12. Query params serializer

```ts
// src/services/api/api-params.ts
function appendQueryParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;

  if (Array.isArray(value)) {
    for (const item of value) appendQueryParam(params, key, item);
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendQueryParam(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  params.append(key, String(value));
}

export function buildQueryString(query?: Record<string, unknown>) {
  if (!query) return '';

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    appendQueryParam(params, key, value);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}
```

Ví dụ:

```ts
buildQueryString({
  page: 1,
  per_page: 20,
  search: 'Nguyen',
  filters: {
    department_id: 'uuid',
    status: 'active',
  },
  sort: 'created_at:desc',
});
```

---

## 13. Token strategy integration

### 13.1 Token mode đề xuất

MVP ưu tiên một trong hai mode:

| Mode | Mô tả | Khuyến nghị |
| --- | --- | --- |
| Cookie auth | Access/refresh qua HttpOnly cookie, frontend dùng `credentials: 'include'` | Tốt nhất nếu backend hỗ trợ |
| Bearer memory | Access token lưu memory, refresh token HttpOnly cookie hoặc memory tạm | Dùng nếu backend yêu cầu bearer header |

Không khuyến nghị lưu access token trong `localStorage`.

### 13.2 Token store memory

```ts
// src/services/auth/auth-token-store.ts
let accessToken: string | null = null;

export const authTokenStore = {
  getAccessToken() {
    return accessToken;
  },
  setAccessToken(token: string | null) {
    accessToken = token;
  },
  clear() {
    accessToken = null;
  },
};
```

### 13.3 Refresh lock

```ts
// src/services/api/refresh-session.ts
let refreshPromise: Promise<boolean> | null = null;

async function refreshSessionRequest() {
  const response = await fetch(`${apiConfig.baseUrl}/auth/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Request-Id': createRequestId(),
      'X-Client-Type': apiConfig.clientType,
      'X-Client-Version': apiConfig.clientVersion,
    },
  });

  if (!response.ok) return false;

  const payload = await response.json();
  const newAccessToken = payload?.data?.access_token;

  if (newAccessToken) {
    authTokenStore.setAccessToken(newAccessToken);
  }

  return true;
}

export async function refreshSessionOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshSessionRequest()
      .then(Boolean)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}
```

---

## 14. API client core

### 14.1 Tạo headers

```ts
// src/services/api/api-client.ts
function createHeaders(options?: ApiRequestOptions): Headers {
  const headers = new Headers(options?.headers);

  headers.set('Accept', 'application/json');
  headers.set('X-Request-Id', createRequestId());
  headers.set('X-Client-Type', apiConfig.clientType);
  headers.set('X-Client-Version', apiConfig.clientVersion);

  const hasBody = options?.body !== undefined && !(options.body instanceof FormData);
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options?.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const token = authTokenStore.getAccessToken();
  if (options?.requireAuth !== false && token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}
```

### 14.2 Build URL

```ts
function buildUrl(path: string, query?: Record<string, unknown>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiConfig.baseUrl}${normalizedPath}${buildQueryString(query)}`;
}
```

### 14.3 Serialize body

```ts
function serializeBody(body: unknown) {
  if (body === undefined || body === null) return undefined;
  if (body instanceof FormData) return body;
  if (body instanceof Blob) return body;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}
```

### 14.4 Parse success response

```ts
async function parseSuccess<T>(response: Response, responseType: ApiRequestOptions['responseType']) {
  if (responseType === 'blob') return (await response.blob()) as T;
  if (responseType === 'text') return (await response.text()) as T;

  const payload = (await response.json()) as ApiSuccessResponse<T>;
  return payload.data;
}
```

### 14.5 Request core có refresh replay

```ts
async function request<TResponse, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
  hasRetriedAuth = false,
): Promise<TResponse> {
  const url = buildUrl(path, options.query);

  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: createHeaders(options),
      body: serializeBody(options.body),
      signal: options.signal,
      credentials: 'include',
    });
  } catch (error) {
    throw createNetworkError(error);
  }

  if (response.ok) {
    return parseSuccess<TResponse>(response, options.responseType);
  }

  const apiError = await parseApiError(response);

  const shouldTryRefresh =
    response.status === 401 &&
    options.requireAuth !== false &&
    !options.skipRefreshAuth &&
    !hasRetriedAuth;

  if (shouldTryRefresh) {
    const refreshed = await refreshSessionOnce();

    if (refreshed) {
      return request<TResponse, TBody>(path, options, true);
    }

    dispatchAuthExpiredEvent(apiError);
  }

  throw apiError;
}
```

### 14.6 Public API client object

```ts
export const apiClient = {
  get<TResponse>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) {
    return request<TResponse>(path, { ...options, method: 'GET' });
  },

  post<TResponse, TBody = unknown>(path: string, body?: TBody, options?: Omit<ApiRequestOptions<TBody>, 'method' | 'body'>) {
    return request<TResponse, TBody>(path, { ...options, method: 'POST', body });
  },

  put<TResponse, TBody = unknown>(path: string, body?: TBody, options?: Omit<ApiRequestOptions<TBody>, 'method' | 'body'>) {
    return request<TResponse, TBody>(path, { ...options, method: 'PUT', body });
  },

  patch<TResponse, TBody = unknown>(path: string, body?: TBody, options?: Omit<ApiRequestOptions<TBody>, 'method' | 'body'>) {
    return request<TResponse, TBody>(path, { ...options, method: 'PATCH', body });
  },

  delete<TResponse>(path: string, options?: Omit<ApiRequestOptions, 'method'>) {
    return request<TResponse>(path, { ...options, method: 'DELETE' });
  },
};
```

---

## 15. Auth expired event

### 15.1 Event để app shell xử lý logout

API client không nên trực tiếp gọi router. Thay vào đó bắn event để `AuthProvider` xử lý:

```ts
// src/services/auth/auth-session-events.ts
const AUTH_EXPIRED_EVENT = 'app:auth-expired';

export function dispatchAuthExpiredEvent(error?: unknown) {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: error }));
}

export function listenAuthExpired(callback: (error?: unknown) => void) {
  const handler = (event: Event) => {
    callback((event as CustomEvent).detail);
  };

  window.addEventListener(AUTH_EXPIRED_EVENT, handler);

  return () => {
    window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
  };
}
```

### 15.2 AuthProvider xử lý

```tsx
useEffect(() => {
  return listenAuthExpired(() => {
    authTokenStore.clear();
    queryClient.clear();
    clearAuthSession();
    router.replace(`/login?returnUrl=${encodeURIComponent(pathname)}`);
  });
}, [pathname, queryClient, router]);
```

---

## 16. QueryClient configuration

### 16.1 QueryProvider

```tsx
// src/services/api/query-provider.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createAppQueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

### 16.2 Retry policy

```ts
export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;

  if (!(error instanceof ApiError)) return true;

  if (['UNAUTHENTICATED', 'TOKEN_EXPIRED', 'FORBIDDEN', 'SCOPE_DENIED', 'VALIDATION', 'BUSINESS_RULE', 'NOT_FOUND'].includes(error.kind)) {
    return false;
  }

  return ['NETWORK', 'SERVER', 'MAINTENANCE', 'UNKNOWN'].includes(error.kind);
}
```

### 16.3 Cache TTL đề xuất

| Dữ liệu | `staleTime` đề xuất | Ghi chú |
| --- | ---: | --- |
| `/auth/me` | 60 giây | Refetch khi app focus nếu cần |
| App registry/sidebar | 5 phút | Invalidate khi permission/module đổi |
| Notification unread count | 15-30 giây | Có thể polling nhẹ |
| Dashboard widget | 30-60 giây | Widget nặng nên cache/invalidate theo event |
| Employee list | 30-60 giây | Invalidate khi create/update/delete |
| Attendance today | 10-30 giây | Refetch sau check-in/out |
| Attendance records | 60 giây | Dữ liệu tháng có thể stale lâu hơn |
| Leave balances | 60 giây | Invalidate sau submit/approve/cancel/adjust |
| Leave requests | 30-60 giây | Invalidate sau mutation |
| Task list/Kanban | 15-30 giây | Invalidate sau update status/comment/assign |
| Notification list | 30 giây | Invalidate sau mark read/delete |
| Settings | 5-10 phút | Invalidate khi update settings |

---

## 17. Query key convention

### 17.1 Global query key type

```ts
export type QueryKeyPart = string | number | boolean | null | undefined | Record<string, unknown>;
```

### 17.2 Root key theo module

```ts
export const rootKeys = {
  auth: ['auth'] as const,
  dashboard: ['dashboard'] as const,
  hr: ['hr'] as const,
  attendance: ['attendance'] as const,
  leave: ['leave'] as const,
  tasks: ['tasks'] as const,
  notifications: ['notifications'] as const,
  system: ['system'] as const,
};
```

### 17.3 Auth keys

```ts
export const authKeys = {
  all: rootKeys.auth,
  me: () => [...authKeys.all, 'me'] as const,
  sessions: () => [...authKeys.all, 'sessions'] as const,
};
```

### 17.4 Dashboard keys

```ts
export const dashboardKeys = {
  all: rootKeys.dashboard,
  me: () => [...dashboardKeys.all, 'me'] as const,
  byType: (type: string) => [...dashboardKeys.all, 'type', type] as const,
  widget: (widgetSlug: string, params?: Record<string, unknown>) =>
    [...dashboardKeys.all, 'widget', widgetSlug, params] as const,
};
```

### 17.5 HR keys

```ts
export const hrKeys = {
  all: rootKeys.hr,
  employees: {
    all: () => [...hrKeys.all, 'employees'] as const,
    list: (params?: ApiListParams) => [...hrKeys.employees.all(), 'list', params] as const,
    detail: (employeeId: string) => [...hrKeys.employees.all(), 'detail', employeeId] as const,
  },
  departments: {
    all: () => [...hrKeys.all, 'departments'] as const,
    list: () => [...hrKeys.departments.all(), 'list'] as const,
  },
};
```

### 17.6 Attendance keys

```ts
export const attendanceKeys = {
  all: rootKeys.attendance,
  today: () => [...attendanceKeys.all, 'today'] as const,
  records: {
    all: () => [...attendanceKeys.all, 'records'] as const,
    list: (params?: ApiListParams) => [...attendanceKeys.records.all(), 'list', params] as const,
    detail: (recordId: string) => [...attendanceKeys.records.all(), 'detail', recordId] as const,
  },
  adjustmentRequests: {
    all: () => [...attendanceKeys.all, 'adjustment-requests'] as const,
    list: (params?: ApiListParams) => [...attendanceKeys.adjustmentRequests.all(), 'list', params] as const,
  },
};
```

### 17.7 Leave keys

```ts
export const leaveKeys = {
  all: rootKeys.leave,
  balances: {
    my: () => [...leaveKeys.all, 'balances', 'my'] as const,
    list: (params?: ApiListParams) => [...leaveKeys.all, 'balances', 'list', params] as const,
  },
  requests: {
    all: () => [...leaveKeys.all, 'requests'] as const,
    my: (params?: ApiListParams) => [...leaveKeys.requests.all(), 'my', params] as const,
    list: (params?: ApiListParams) => [...leaveKeys.requests.all(), 'list', params] as const,
    detail: (requestId: string) => [...leaveKeys.requests.all(), 'detail', requestId] as const,
    approvals: (params?: ApiListParams) => [...leaveKeys.requests.all(), 'approvals', params] as const,
  },
  calendar: (params?: Record<string, unknown>) => [...leaveKeys.all, 'calendar', params] as const,
};
```

### 17.8 Task keys

```ts
export const taskKeys = {
  all: rootKeys.tasks,
  myTasks: (params?: ApiListParams) => [...taskKeys.all, 'my-tasks', params] as const,
  list: (params?: ApiListParams) => [...taskKeys.all, 'list', params] as const,
  detail: (taskId: string) => [...taskKeys.all, 'detail', taskId] as const,
  kanban: (projectId?: string) => [...taskKeys.all, 'kanban', { projectId }] as const,
  projects: {
    all: () => [...taskKeys.all, 'projects'] as const,
    list: (params?: ApiListParams) => [...taskKeys.projects.all(), 'list', params] as const,
    detail: (projectId: string) => [...taskKeys.projects.all(), 'detail', projectId] as const,
  },
};
```

### 17.9 Notification keys

```ts
export const notificationKeys = {
  all: rootKeys.notifications,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  dropdown: () => [...notificationKeys.all, 'dropdown'] as const,
  list: (params?: ApiListParams) => [...notificationKeys.all, 'list', params] as const,
  detail: (notificationId: string) => [...notificationKeys.all, 'detail', notificationId] as const,
};
```

---

## 18. Module API service convention

### 18.1 Nguyên tắc

Mỗi module có file `*.api.ts` chỉ chứa function gọi API, không chứa React hook.

Đúng:

```text
modules/leave/services/leave.api.ts
modules/leave/hooks/useLeaveRequests.ts
```

Không viết API call trực tiếp trong component.

### 18.2 Auth API

```ts
// modules/auth/services/auth.api.ts
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token?: string;
  token_type?: 'Bearer';
}

export interface AuthMeResponse {
  user: AuthUser;
  company: CompanyContext;
  employee?: AuthEmployee | null;
  modules: ModuleAccessItem[];
  settings?: Record<string, unknown>;
}

export const authApi = {
  login(body: LoginRequest) {
    return apiClient.post<LoginResponse, LoginRequest>('/auth/login', body, {
      requireAuth: false,
    });
  },

  me() {
    return apiClient.get<AuthMeResponse>('/auth/me');
  },

  logout() {
    return apiClient.post<null>('/auth/logout');
  },
};
```

### 18.3 HR API

```ts
// modules/hr/services/hr.api.ts
export const hrApi = {
  getEmployees(params?: ApiListParams) {
    return apiClient.get<EmployeeListItem[]>('/hr/employees', { query: params });
  },

  getEmployee(employeeId: string) {
    return apiClient.get<EmployeeDetail>(`/hr/employees/${employeeId}`);
  },

  createEmployee(body: CreateEmployeeRequest) {
    return apiClient.post<EmployeeDetail, CreateEmployeeRequest>('/hr/employees', body, {
      idempotencyKey: createIdempotencyKey('employee_create'),
    });
  },

  updateEmployee(employeeId: string, body: UpdateEmployeeRequest) {
    return apiClient.patch<EmployeeDetail, UpdateEmployeeRequest>(`/hr/employees/${employeeId}`, body);
  },
};
```

### 18.4 Attendance API

```ts
// modules/attendance/services/attendance.api.ts
export const attendanceApi = {
  getToday() {
    return apiClient.get<TodayAttendanceResponse>('/attendance/today');
  },

  checkIn(body: CheckInRequest) {
    return apiClient.post<AttendanceRecord, CheckInRequest>('/attendance/check-in', body, {
      idempotencyKey: createIdempotencyKey('attendance_check_in'),
    });
  },

  checkOut(body: CheckOutRequest) {
    return apiClient.post<AttendanceRecord, CheckOutRequest>('/attendance/check-out', body, {
      idempotencyKey: createIdempotencyKey('attendance_check_out'),
    });
  },

  getRecords(params?: ApiListParams) {
    return apiClient.get<AttendanceRecord[]>('/attendance/records', { query: params });
  },
};
```

### 18.5 Leave API

```ts
// modules/leave/services/leave.api.ts
export const leaveApi = {
  getMyBalances() {
    return apiClient.get<LeaveBalance[]>('/leave/my-balances');
  },

  getMyRequests(params?: ApiListParams) {
    return apiClient.get<LeaveRequestListItem[]>('/leave/me/requests', { query: params });
  },

  getRequestsForApproval(params?: ApiListParams) {
    return apiClient.get<LeaveRequestListItem[]>('/leave/requests/pending-approvals', { query: params });
  },

  createRequest(body: CreateLeaveRequest) {
    return apiClient.post<LeaveRequestDetail, CreateLeaveRequest>('/leave/requests', body, {
      idempotencyKey: createIdempotencyKey('leave_request_create'),
    });
  },

  approveRequest(requestId: string, body: ApproveLeaveRequest) {
    return apiClient.post<LeaveRequestDetail, ApproveLeaveRequest>(`/leave/requests/${requestId}/approve`, body, {
      idempotencyKey: createIdempotencyKey('leave_request_approve'),
    });
  },
};
```

### 18.6 Task API

```ts
// modules/tasks/services/task.api.ts
export const taskApi = {
  getMyTasks(params?: ApiListParams) {
    return apiClient.get<TaskListItem[]>('/tasks/my-tasks', { query: params });
  },

  getTask(taskId: string) {
    return apiClient.get<TaskDetail>(`/tasks/${taskId}`);
  },

  updateStatus(taskId: string, body: UpdateTaskStatusRequest) {
    return apiClient.post<TaskDetail, UpdateTaskStatusRequest>(`/tasks/${taskId}/change-status`, body, {
      idempotencyKey: createIdempotencyKey('task_status_update'),
    });
  },
};
```

### 18.7 Notification API

```ts
// modules/notifications/services/notification.api.ts
export const notificationApi = {
  getUnreadCount() {
    return apiClient.get<{ unread_count: number }>('/notifications/unread-count');
  },

  getDropdown() {
    return apiClient.get<NotificationListItem[]>('/notifications/dropdown');
  },

  getNotifications(params?: ApiListParams) {
    return apiClient.get<NotificationListItem[]>('/notifications', { query: params });
  },

  markRead(notificationId: string) {
    return apiClient.post<NotificationDetail>(`/notifications/${notificationId}/mark-read`);
  },

  markAllRead() {
    return apiClient.post<{ updated_count: number }>('/notifications/mark-all-read');
  },
};
```

---

## 19. Query hook convention

### 19.1 Query hook mẫu

```ts
export function useEmployees(params?: ApiListParams) {
  return useQuery({
    queryKey: hrKeys.employees.list(params),
    queryFn: () => hrApi.getEmployees(params),
  });
}
```

### 19.2 Detail query hook

```ts
export function useEmployeeDetail(employeeId?: string) {
  return useQuery({
    queryKey: employeeId ? hrKeys.employees.detail(employeeId) : hrKeys.employees.detail('missing'),
    queryFn: () => hrApi.getEmployee(employeeId!),
    enabled: Boolean(employeeId),
  });
}
```

### 19.3 Mutation hook mẫu

```ts
export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateEmployeeRequest) => hrApi.createEmployee(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKeys.employees.all() });
      toast.success('Tạo nhân viên thành công');
    },
    onError: (error) => {
      showApiErrorToast(error);
    },
  });
}
```

### 19.4 Mutation có business rule error

```ts
export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CheckInRequest) => attendanceApi.checkIn(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
      queryClient.invalidateQueries({ queryKey: attendanceKeys.records.all() });
      queryClient.invalidateQueries({ queryKey: rootKeys.dashboard });
      toast.success('Check-in thành công');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.kind === 'BUSINESS_RULE') {
        toast.warning(error.message);
        queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
        return;
      }

      showApiErrorToast(error);
    },
  });
}
```

### 19.5 Mutation mark notification read

```ts
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => notificationApi.markRead(notificationId),
    onSuccess: (_, notificationId) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dropdown() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.list() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.detail(notificationId) });
    },
  });
}
```

---

## 20. Invalidation strategy theo nghiệp vụ

| Mutation | Query cần invalidate |
| --- | --- |
| Login success | `authKeys.me`, app/sidebar/action registry nếu có |
| Logout success | Clear toàn bộ query cache |
| Create/update employee | `hrKeys.employees.all`, dashboard HR widgets |
| Submit profile change request | My profile, profile change request list, notification unread/dropdown nếu backend tạo noti cho HR |
| Check-in/check-out | `attendanceKeys.today`, `attendanceKeys.records.all`, dashboard widgets |
| Submit attendance adjustment | attendance adjustment list, attendance today/records nếu backend tính lại, notification |
| Approve attendance adjustment | adjustment list/detail, attendance records, dashboard, notification |
| Create leave request | leave my requests, leave balances, leave calendar, dashboard, notification |
| Approve/reject/cancel leave | leave requests, balances, calendar, attendance today/records, dashboard, notification |
| Create/update task | task list, my tasks, project detail, kanban, dashboard, notification |
| Update task status | task detail, task list, kanban, dashboard |
| Comment task/mention | task detail/activity/comment, notification |
| Mark notification read | unread count, dropdown, notification list/detail |
| Update dashboard config | dashboard me/type/widgets, widget config list |
| Update settings/module status | system settings, app registry, route/sidebar visibility |

---

## 21. Optimistic update policy

### 21.1 Cho phép optimistic update với action nhẹ

| Action | Optimistic update |
| --- | --- |
| Mark notification read | Có |
| Collapse/expand widget local state | Có, nếu server sync không bắt buộc |
| Toggle favorite app | Có |
| Update task status trong Kanban | Có thể, nếu có rollback rõ |

### 21.2 Không optimistic với action rủi ro cao

| Action | Lý do |
| --- | --- |
| Check-in/check-out | Phụ thuộc server time, leave/remote/rule/business validation |
| Approve/reject leave | Có rule, balance, attendance sync, notification event |
| Create employee | Có validate trùng email/code, sinh mã tự động |
| Attendance manual adjustment | Ảnh hưởng bảng công/audit |
| Leave balance adjustment | Ảnh hưởng dữ liệu nhạy cảm |

### 21.3 Optimistic update mẫu cho notification

```ts
export function useMarkNotificationReadOptimistic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => notificationApi.markRead(notificationId),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.dropdown() });

      const previousDropdown = queryClient.getQueryData<NotificationListItem[]>(notificationKeys.dropdown());
      const previousCount = queryClient.getQueryData<{ unread_count: number }>(notificationKeys.unreadCount());

      queryClient.setQueryData<NotificationListItem[]>(notificationKeys.dropdown(), (old) =>
        old?.map((item) =>
          item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item,
        ),
      );

      queryClient.setQueryData<{ unread_count: number }>(notificationKeys.unreadCount(), (old) => ({
        unread_count: Math.max((old?.unread_count ?? 1) - 1, 0),
      }));

      return { previousDropdown, previousCount };
    },
    onError: (_error, _notificationId, context) => {
      queryClient.setQueryData(notificationKeys.dropdown(), context?.previousDropdown);
      queryClient.setQueryData(notificationKeys.unreadCount(), context?.previousCount);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.dropdown() });
    },
  });
}
```

---

## 22. Error mapping sang UI

### 22.1 Error UI behavior

```ts
export type ErrorUiBehavior =
  | 'NONE'
  | 'TOAST_ERROR'
  | 'TOAST_WARNING'
  | 'FORM_ERRORS'
  | 'FORBIDDEN_PAGE'
  | 'NOT_FOUND_PAGE'
  | 'INLINE_ALERT'
  | 'ERROR_STATE'
  | 'MAINTENANCE_STATE'
  | 'REDIRECT_LOGIN';

export interface ErrorUiMapping {
  behavior: ErrorUiBehavior;
  title?: string;
  message: string;
  canRetry?: boolean;
  requestId?: string;
}
```

### 22.2 Error mapper

```ts
// src/services/api/error-mapper.ts
export function mapApiErrorToUi(error: unknown): ErrorUiMapping {
  if (!(error instanceof ApiError)) {
    return {
      behavior: 'TOAST_ERROR',
      message: 'Có lỗi không xác định. Vui lòng thử lại.',
    };
  }

  const base = {
    message: error.message,
    requestId: error.requestId,
  };

  switch (error.kind) {
    case 'UNAUTHENTICATED':
    case 'TOKEN_EXPIRED':
      return { ...base, behavior: 'REDIRECT_LOGIN', message: 'Phiên đăng nhập đã hết hạn.' };
    case 'FORBIDDEN':
    case 'SCOPE_DENIED':
      return { ...base, behavior: 'FORBIDDEN_PAGE', title: 'Không có quyền truy cập' };
    case 'VALIDATION':
      return { ...base, behavior: 'FORM_ERRORS' };
    case 'NOT_FOUND':
      return { ...base, behavior: 'NOT_FOUND_PAGE', title: 'Không tìm thấy dữ liệu' };
    case 'CONFLICT':
      return { ...base, behavior: 'INLINE_ALERT', canRetry: true };
    case 'BUSINESS_RULE':
      return { ...base, behavior: 'TOAST_WARNING' };
    case 'NETWORK':
      return { ...base, behavior: 'ERROR_STATE', canRetry: true };
    case 'MAINTENANCE':
      return { ...base, behavior: 'MAINTENANCE_STATE', canRetry: true };
    case 'SERVER':
    case 'UNKNOWN':
    default:
      return { ...base, behavior: 'ERROR_STATE', canRetry: true };
  }
}
```

### 22.3 Toast helper

```ts
export function showApiErrorToast(error: unknown) {
  const mapping = mapApiErrorToUi(error);

  if (mapping.behavior === 'TOAST_WARNING') {
    toast.warning(mapping.message);
    return;
  }

  if (['TOAST_ERROR', 'ERROR_STATE', 'INLINE_ALERT'].includes(mapping.behavior)) {
    toast.error(mapping.message);
  }
}
```

---

## 23. Validation error mapping cho form

### 23.1 Check validation details

```ts
export function isValidationDetails(details: unknown): details is ApiValidationDetail[] {
  return Array.isArray(details) && details.every((item) => {
    return typeof item === 'object' && item !== null && 'field' in item && 'message' in item;
  });
}
```

### 23.2 Apply API validation errors vào React Hook Form

```ts
import type { UseFormSetError, FieldValues, Path } from 'react-hook-form';

export function applyApiValidationErrors<TForm extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TForm>,
) {
  if (!(error instanceof ApiError)) return false;
  if (error.kind !== 'VALIDATION') return false;
  if (!isValidationDetails(error.details)) return false;

  for (const detail of error.details) {
    setError(detail.field as Path<TForm>, {
      type: detail.rule ?? 'server',
      message: detail.message,
    });
  }

  return true;
}
```

### 23.3 Form submit mẫu

```tsx
const mutation = useCreateLeaveRequest();

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await mutation.mutateAsync(values);
    toast.success('Tạo đơn nghỉ thành công');
    router.push('/leave/me/requests');
  } catch (error) {
    const applied = applyApiValidationErrors(error, form.setError);
    if (!applied) showApiErrorToast(error);
  }
});
```

---

## 24. Page state mapping

### 24.1 Query state -> UI state

| Query state | UI component |
| --- | --- |
| `isLoading` | `Skeleton`, `FullPageLoadingState`, table skeleton |
| `isError` + 403 | `ForbiddenState` |
| `isError` + 404 | `NotFoundState` |
| `isError` + network/server | `ErrorState` có retry |
| data empty | `EmptyState` |
| `isFetching` khi đã có data | Stale indicator hoặc top progress nhỏ |
| partial widget error | `WidgetErrorState`, không crash toàn dashboard |

### 24.2 Helper cho resource page

```tsx
export function ResourceQueryState<TData>({
  query,
  children,
  empty,
}: {
  query: UseQueryResult<TData>;
  children: (data: TData) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  if (query.isLoading) return <SkeletonState />;

  if (query.isError) {
    const mapping = mapApiErrorToUi(query.error);

    if (mapping.behavior === 'FORBIDDEN_PAGE') return <ForbiddenState message={mapping.message} />;
    if (mapping.behavior === 'NOT_FOUND_PAGE') return <NotFoundState message={mapping.message} />;

    return <ErrorState message={mapping.message} onRetry={() => query.refetch()} />;
  }

  if (!query.data) return empty ?? <EmptyState message="Không có dữ liệu" />;

  return <>{children(query.data)}</>;
}
```

---

## 25. Pagination, filter, sort

### 25.1 Chuẩn params frontend

```ts
export interface TableQueryState {
  page: number;
  per_page: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}
```

### 25.2 Convert table state sang API params

```ts
export function toApiListParams(state: TableQueryState): ApiListParams {
  // Gộp field + direction thành dạng `field:direction` để chỉ emit một param `sort` (API-01 §17.3)
  const sort = state.sort ? `${state.sort}:${state.order ?? 'asc'}` : undefined;

  return {
    page: state.page,
    per_page: state.per_page,
    search: state.search?.trim() || undefined,
    sort,
    filters: state.filters,
  };
}
```

### 25.3 Debounce search

```ts
export function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
```

### 25.4 Table hook mẫu

```ts
export function useEmployeeTableQueryState() {
  const [state, setState] = useState<TableQueryState>({ page: 1, per_page: 20 });
  const debouncedSearch = useDebouncedValue(state.search, 300);

  const params = useMemo(
    () => toApiListParams({ ...state, search: debouncedSearch }),
    [state, debouncedSearch],
  );

  const query = useEmployees(params);

  return { state, setState, params, query };
}
```

---

## 26. Upload file strategy

### 26.1 Nguyên tắc upload

1. Upload đi qua Foundation/File API.
2. File private là mặc định.
3. Frontend không tự dựng storage path.
4. Backend trả `file_id`, `file_name`, `mime_type`, `size`, `download_url` nếu user có quyền.
5. Module nghiệp vụ chỉ link file bằng `file_id` hoặc gọi API module để attach file.
6. Upload lỗi validation cần hiển thị rõ: sai định dạng, quá dung lượng, thiếu quyền.

### 26.2 Upload bằng fetch không có progress

```ts
export async function uploadFile(file: File, options?: { entityType?: string; entityId?: string }) {
  const formData = new FormData();
  formData.append('file', file);
  if (options?.entityType) formData.append('entity_type', options.entityType);
  if (options?.entityId) formData.append('entity_id', options.entityId);

  return apiClient.post<FileMetadata, FormData>('/foundation/files', formData, {
    idempotencyKey: createIdempotencyKey('file_upload'),
  });
}
```

### 26.3 Upload có progress bằng XMLHttpRequest

Nếu cần progress bar thực tế, dùng XHR riêng nhưng vẫn reuse header/error parser concept.

```ts
export function uploadFileWithProgress(input: {
  file: File;
  onProgress?: (percent: number) => void;
}) {
  return new Promise<FileMetadata>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', input.file);

    xhr.open('POST', `${apiConfig.baseUrl}/foundation/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Request-Id', createRequestId());
    xhr.setRequestHeader('X-Client-Type', apiConfig.clientType);
    xhr.setRequestHeader('X-Client-Version', apiConfig.clientVersion);
    xhr.setRequestHeader('Idempotency-Key', createIdempotencyKey('file_upload'));

    const token = authTokenStore.getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload.data as FileMetadata);
        } else {
          reject(new ApiError({
            message: payload.message || 'Upload file thất bại',
            kind: mapStatusToErrorKind(xhr.status, payload?.error?.code, payload?.error?.type),
            status: xhr.status,
            code: payload?.error?.code,
            type: payload?.error?.type,
            details: payload?.error?.details,
            requestId: payload?.meta?.request_id,
            raw: payload,
          }));
        }
      } catch (error) {
        reject(createNetworkError(error));
      }
    };

    xhr.onerror = () => reject(createNetworkError(xhr.statusText));
    xhr.send(formData);
  });
}
```

---

## 27. Download file strategy

### 27.1 Download qua signed URL

```ts
export async function getFileDownloadUrl(fileId: string) {
  return apiClient.get<{ download_url: string; expires_at: string }>(`/foundation/files/${fileId}/download-url`);
}
```

### 27.2 Download blob

```ts
export async function downloadFileBlob(fileId: string) {
  return apiClient.get<Blob>(`/foundation/files/${fileId}/download`, {
    responseType: 'blob',
  });
}
```

### 27.3 Nguyên tắc bảo mật download

1. Không cache URL private quá lâu.
2. Không log download URL private.
3. Không tự hiển thị file nhạy cảm nếu backend trả forbidden/masked.
4. Khi 403, hiển thị `ForbiddenState` hoặc toast tùy context.
5. File access log thuộc backend/foundation.

---

## 28. Dashboard query strategy

### 28.1 Dashboard không xử lý nghiệp vụ gốc

Dashboard chỉ gọi API tổng hợp hoặc widget API:

```http
GET /api/v1/dashboard/me
GET /api/v1/dashboard/{type}
GET /api/v1/dashboard/widgets/{widget_slug}
```

Quick action như check-in, tạo đơn nghỉ, duyệt đơn, update task vẫn gọi module API gốc:

```text
Check-in -> attendanceApi.checkIn
Tạo đơn nghỉ -> leaveApi.createRequest
Duyệt đơn -> leaveApi.approveRequest
Cập nhật task -> taskApi.updateStatus
Mark notification read -> notificationApi.markRead
```

### 28.2 Widget lazy load

```ts
export function useDashboardWidget<TData>(widgetSlug: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: dashboardKeys.widget(widgetSlug, params),
    queryFn: () => dashboardApi.getWidget<TData>(widgetSlug, params),
    staleTime: 60_000,
  });
}
```

### 28.3 Widget degraded state

Nếu một widget lỗi, không làm sập toàn dashboard.

```tsx
function DashboardWidgetBoundary({ query, children }: Props) {
  if (query.isLoading) return <WidgetSkeleton />;

  if (query.isError) {
    return <WidgetErrorState message="Widget tạm thời chưa tải được" onRetry={() => query.refetch()} />;
  }

  return <>{children}</>;
}
```

---

## 29. Notification query strategy

### 29.1 Unread count polling nhẹ

```ts
export function useNotificationUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: notificationApi.getUnreadCount,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
```

### 29.2 Dropdown latest notifications

```ts
export function useNotificationDropdown() {
  return useQuery({
    queryKey: notificationKeys.dropdown(),
    queryFn: notificationApi.getDropdown,
    staleTime: 30_000,
  });
}
```

### 29.3 Deep link rule

Khi user click notification:

```text
Mark read nếu cần
-> Resolve target route từ notification payload
-> Điều hướng sang module gốc
-> Route guard kiểm tra permission
-> Module page gọi API detail
-> Backend kiểm tra permission/data scope/business rule lần nữa
```

---

## 30. SSR/CSR strategy trong Next.js

### 30.1 Default MVP: client-side query cho protected data

Để tránh phức tạp token/cookie/tenant trong server component, MVP có thể ưu tiên:

1. Protected layout boot session ở client.
2. Module pages dùng TanStack Query ở client.
3. Server component chủ yếu render shell/static layout.

### 30.2 Khi nào dùng server fetch

Có thể dùng server fetch cho:

1. Public page không nhạy cảm.
2. Static config không phụ thuộc user.
3. SEO/public content nếu có.

Không nên dùng server fetch tùy tiện cho dữ liệu nhạy cảm nếu chưa chốt cookie/session strategy.

### 30.3 Hydration sau này

Phase sau có thể dùng:

```text
Server prefetch -> dehydrate -> HydrationBoundary
```

Nhưng phải đảm bảo:

1. Cookie auth được backend hỗ trợ tốt.
2. Không leak data user này sang user khác.
3. Query key có tenant/user boundary.
4. Cache server/CDN không lưu private response.

---

## 31. Mock API strategy

### 31.1 Mục tiêu

Mock API giúp frontend triển khai song song với backend nhưng vẫn bám API-01 contract.

### 31.2 Công cụ đề xuất

```text
MSW - Mock Service Worker
```

### 31.3 Mock response phải giống API thật

```ts
export function mockSuccess<T>(data: T, message = 'Lấy dữ liệu thành công'): ApiSuccessResponse<T> {
  return {
    success: true,
    message,
    data,
    meta: {
      request_id: createRequestId(),
      timestamp: new Date().toISOString(),
    },
  };
}

export function mockError(input: {
  message: string;
  code: string;
  type: string;
  details?: unknown;
}): ApiErrorResponse {
  return {
    success: false,
    message: input.message,
    error: {
      code: input.code,
      type: input.type,
      details: input.details ?? null,
    },
    meta: {
      request_id: createRequestId(),
      timestamp: new Date().toISOString(),
    },
  };
}
```

### 31.4 Mock handler mẫu

```ts
http.get('/api/v1/auth/me', () => {
  return HttpResponse.json(mockSuccess(mockAuthMe));
});

http.get('/api/v1/attendance/today', () => {
  return HttpResponse.json(mockSuccess(mockTodayAttendance));
});

http.post('/api/v1/attendance/check-in', () => {
  return HttpResponse.json(mockSuccess(mockAttendanceRecord, 'Check-in thành công'));
});
```

---

## 32. Telemetry và debug

### 32.1 Debug log chỉ bật ở local/dev

```ts
export function debugApiLog(input: {
  method: string;
  path: string;
  status?: number;
  requestId?: string;
  durationMs?: number;
}) {
  if (!apiConfig.enableDebug) return;

  console.debug('[api]', input);
}
```

### 32.2 Không log dữ liệu nhạy cảm

Không log:

1. Access token.
2. Refresh token.
3. Password.
4. Reset token.
5. File private URL.
6. Dữ liệu lương, hợp đồng, giấy tờ tùy thân.
7. Response body của API nhạy cảm nếu chưa mask.

### 32.3 Debug panel phase sau

Có thể bổ sung debug panel cho môi trường dev:

1. Current user id.
2. Company id.
3. Build version.
4. Last API request id.
5. Query cache inspector.
6. Permission checker preview.

---

## 33. Security checklist

| Mã | Checklist |
| --- | --- |
| FE04-SEC-001 | Không lưu access token trong localStorage nếu có thể tránh |
| FE04-SEC-002 | Refresh token ưu tiên HttpOnly Secure SameSite cookie |
| FE04-SEC-003 | Clear query cache khi logout hoặc auth expired |
| FE04-SEC-004 | Không persist dữ liệu HR/ATT/LEAVE/TASK/NOTI nhạy cảm vào localStorage |
| FE04-SEC-005 | Không tự gửi company_id/user_id/employee_id thay backend context |
| FE04-SEC-006 | Không log token, password, file private URL, dữ liệu nhạy cảm |
| FE04-SEC-007 | 403 từ backend phải tôn trọng, không retry vô hạn |
| FE04-SEC-008 | 401 chỉ refresh một lần cho mỗi request |
| FE04-SEC-009 | Có refresh lock tránh nhiều request cùng refresh token |
| FE04-SEC-010 | File download/upload phải đi qua API có permission check |
| FE04-SEC-011 | API client gửi `X-Request-Id` để truy vết |
| FE04-SEC-012 | Idempotency key cho action quan trọng |
| FE04-SEC-013 | Không cache private response bằng browser/CDN ngoài ý muốn |
| FE04-SEC-014 | Route guard frontend không thay thế backend guard |

---

## 34. Testing strategy

### 34.1 Unit test API utils

Cần test:

1. `buildQueryString`.
2. `mapStatusToErrorKind`.
3. `parseApiError`.
4. `createRequestId`.
5. `createIdempotencyKey`.
6. `applyApiValidationErrors`.
7. `mapApiErrorToUi`.
8. Retry policy.

### 34.2 API client test bằng MSW

Test case bắt buộc:

| Case | Kỳ vọng |
| --- | --- |
| GET success | Trả `data` đã unwrap |
| List success | Pagination được giữ ở hook/table nếu cần |
| 400 validation | Throw `ApiError` kind `VALIDATION` |
| 401 expired + refresh success | Replay request thành công |
| 401 expired + refresh fail | Dispatch auth expired |
| 403 | Không retry, throw `FORBIDDEN` |
| 422 business rule | Throw `BUSINESS_RULE` |
| 500 | Retry theo policy |
| Network error | Throw `NETWORK` |
| Upload error | Parse error đúng contract |

### 34.3 Query hook test

Test:

1. Query key đúng.
2. `enabled` hoạt động với detail id missing.
3. Mutation invalidate đúng key.
4. Optimistic update rollback đúng.
5. Error mapper hiển thị đúng UI behavior.

### 34.4 E2E smoke test liên quan API layer

| Flow | Kiểm tra |
| --- | --- |
| Login -> auth/me -> home | Session load đúng |
| Token expired khi vào protected route | Refresh hoặc redirect login |
| Check-in business rule error | Tooltip/toast đúng, không crash page |
| Leave form validation error | Field error đúng |
| Forbidden direct URL | 403 state đúng |
| Notification mark read | Count giảm và refetch đúng |
| Logout | Clear cache, back login, không còn dữ liệu cũ |

---

## 35. File skeleton cần tạo

```text
src/services/api/api-config.ts
src/services/api/api-types.ts
src/services/api/api-error.ts
src/services/api/api-request-id.ts
src/services/api/api-idempotency.ts
src/services/api/api-params.ts
src/services/api/api-client.ts
src/services/api/api-upload.ts
src/services/api/api-download.ts
src/services/api/refresh-session.ts
src/services/api/error-mapper.ts
src/services/api/query-client.ts
src/services/api/query-provider.tsx
src/services/api/query-keys.ts
src/services/api/mock-api.ts
src/services/auth/auth-token-store.ts
src/services/auth/auth-session-events.ts
src/modules/auth/services/auth.api.ts
src/modules/auth/services/auth.keys.ts
src/modules/auth/hooks/useAuthMe.ts
src/modules/auth/hooks/useLogin.ts
src/modules/auth/hooks/useLogout.ts
src/modules/dashboard/services/dashboard.api.ts
src/modules/dashboard/services/dashboard.keys.ts
src/modules/hr/services/hr.api.ts
src/modules/hr/services/hr.keys.ts
src/modules/attendance/services/attendance.api.ts
src/modules/attendance/services/attendance.keys.ts
src/modules/leave/services/leave.api.ts
src/modules/leave/services/leave.keys.ts
src/modules/tasks/services/task.api.ts
src/modules/tasks/services/task.keys.ts
src/modules/notifications/services/notification.api.ts
src/modules/notifications/services/notification.keys.ts
```

---

## 36. Thứ tự triển khai đề xuất

### Giai đoạn 1: API foundation

1. Tạo `api-types.ts`.
2. Tạo `api-error.ts`.
3. Tạo `api-config.ts`.
4. Tạo request id/idempotency helpers.
5. Tạo query params serializer.
6. Tạo `api-client.ts` bản GET/POST/PATCH/DELETE cơ bản.
7. Tạo unit test cho parser/error mapper.

### Giai đoạn 2: Auth integration

1. Tạo token store memory.
2. Tạo refresh session lock.
3. Tích hợp 401 refresh replay.
4. Tạo auth expired event.
5. Tích hợp clear query cache khi logout.
6. Test 401/refresh success/fail.

### Giai đoạn 3: Query layer

1. Tạo QueryClient config.
2. Tạo QueryProvider.
3. Tạo root query keys.
4. Tạo query key factory cho AUTH/DASH/HR/ATT/LEAVE/TASK/NOTI.
5. Tạo hook mẫu `useAuthMe`, `useTodayAttendance`, `useNotificationUnreadCount`.

### Giai đoạn 4: Error UX integration

1. Tạo error mapper.
2. Tạo toast helper.
3. Tạo form validation mapper.
4. Tạo ResourceQueryState hoặc pattern tương đương.
5. Mapping với component Design System: `ErrorState`, `ForbiddenState`, `EmptyState`, `Skeleton`.

### Giai đoạn 5: Module service starter

1. Tạo service API cho AUTH.
2. Tạo service API cho DASH.
3. Tạo service API cho HR.
4. Tạo service API cho ATT.
5. Tạo service API cho LEAVE.
6. Tạo service API cho TASK.
7. Tạo service API cho NOTI.
8. Tạo MSW mock handler tối thiểu.

### Giai đoạn 6: Upload/download và QA

1. Tạo upload file helper.
2. Tạo download URL/blob helper.
3. Test upload/download error.
4. Chốt security checklist.
5. Chốt acceptance criteria.

---

## 37. Ví dụ tích hợp AppProviders

```tsx
// src/providers/AppProviders.tsx
'use client';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <PermissionProvider>
              <DirtyFormProvider>
                <AppSwitcherProvider>{children}</AppSwitcherProvider>
              </DirtyFormProvider>
            </PermissionProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
```

---

## 38. Ví dụ hoàn chỉnh: Today Attendance

### 38.1 API service

```ts
export const attendanceApi = {
  getToday() {
    return apiClient.get<TodayAttendanceResponse>('/attendance/today');
  },
  checkIn(body: CheckInRequest) {
    return apiClient.post<AttendanceRecord, CheckInRequest>('/attendance/check-in', body, {
      idempotencyKey: createIdempotencyKey('check_in'),
    });
  },
  checkOut(body: CheckOutRequest) {
    return apiClient.post<AttendanceRecord, CheckOutRequest>('/attendance/check-out', body, {
      idempotencyKey: createIdempotencyKey('check_out'),
    });
  },
};
```

### 38.2 Query hooks

```ts
export function useTodayAttendance() {
  return useQuery({
    queryKey: attendanceKeys.today(),
    queryFn: attendanceApi.getToday,
    staleTime: 10_000,
  });
}

export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: attendanceApi.checkIn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today() });
      queryClient.invalidateQueries({ queryKey: rootKeys.dashboard });
      toast.success('Check-in thành công');
    },
    onError: showApiErrorToast,
  });
}
```

### 38.3 Component usage

```tsx
function TodayAttendancePanel() {
  const todayQuery = useTodayAttendance();
  const checkInMutation = useCheckIn();

  return (
    <ResourceQueryState query={todayQuery}>
      {(today) => (
        <AttendanceStatusCard
          data={today}
          isSubmitting={checkInMutation.isPending}
          onCheckIn={() => checkInMutation.mutate({ source: 'web' })}
        />
      )}
    </ResourceQueryState>
  );
}
```

---

## 39. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Mỗi module tự gọi fetch | Lỗi không thống nhất, khó debug | Bắt buộc dùng `apiClient` chung |
| Response API backend chưa đồng nhất | Frontend parse lỗi | Mock/test theo API-01, feedback sớm cho backend |
| Refresh token bị gọi đồng thời nhiều lần | Race condition, logout sai | Dùng refresh lock `refreshSessionOnce` |
| Query cache giữ dữ liệu user cũ sau logout | Rò rỉ dữ liệu | Clear query cache và auth store khi logout/auth expired |
| Invalidation thiếu sau mutation | UI stale, user thấy dữ liệu cũ | Query key factory + invalidation matrix |
| Retry mutation quan trọng gây duplicate | Tạo nhiều đơn/task/check-in | Mutation mặc định không retry; dùng idempotency key |
| Lỗi validation không map vào form | UX kém | `applyApiValidationErrors` dùng chung |
| Dashboard widget lỗi làm crash dashboard | UX tệ | Widget-level error boundary/degraded state |
| Upload progress thiếu | UX upload file kém | Dùng XHR helper nếu cần progress |
| Log dữ liệu nhạy cảm | Rủi ro bảo mật | Debug chỉ log metadata, không log body/token/private URL |

---

## 40. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE04-OQ-001 | Backend MVP dùng HttpOnly cookie hay Bearer memory token? | BE/FE Lead | Cao |
| FE04-OQ-002 | Endpoint refresh chính xác là `/api/v1/auth/refresh-token` hay tên khác? | BE Lead | Cao |
| FE04-OQ-003 | API list đặt `pagination` ngoài root hay trong `meta` ở implementation thật? | BE Lead | Cao |
| FE04-OQ-004 | Validation details field path có hỗ trợ nested field như `items.0.name` không? | BE/FE | Trung bình |
| FE04-OQ-005 | Backend có trả `retry_after` cho 429 không? | BE | Thấp |
| FE04-OQ-006 | Upload file dùng single-step multipart hay presigned upload phase sau? | BE/FE | Trung bình |
| FE04-OQ-007 | Có cần SSE/WebSocket cho notification trong MVP hay polling là đủ? | Product/BE/FE | Thấp |
| FE04-OQ-008 | Có cần persist query cache offline không? | Product/FE | Thấp |
| FE04-OQ-009 | Có chuẩn error copy dictionary theo từng module không? | Product/UX/FE | Trung bình |
| FE04-OQ-010 | Có cần OpenAPI generator để sinh TypeScript types không? | BE/FE | Trung bình |

---

## 41. Definition of Done cho FRONTEND-04

FRONTEND-04 được xem là hoàn thành khi:

1. Có API contract types bám chuẩn API-01.
2. Có API client dùng chung, không còn gọi `fetch` rời rạc trong module.
3. API client tự thêm base URL, request id, client type, client version và authorization nếu cần.
4. API client parse success/error response đúng chuẩn.
5. Có error model và error mapper thống nhất.
6. Có xử lý 401 refresh token một lần với refresh lock.
7. Có auth expired event để App/AuthProvider logout và redirect login.
8. Có QueryClient config dùng chung.
9. Có query key factory cho các module MVP.
10. Có convention module API service và query/mutation hook.
11. Có invalidation matrix cho mutation quan trọng.
12. Có helper map validation error vào React Hook Form.
13. Có upload/download helper tối thiểu.
14. Có mock API strategy theo contract.
15. Có test case cho API client, error mapper, refresh flow và query hooks cơ bản.
16. Có security checklist được review.
17. Có open questions rõ để backend/frontend chốt trước khi tích hợp API thật.

---

## 42. Kết luận

FRONTEND-04 chốt lớp giao tiếp dữ liệu giữa frontend và backend.

Tư duy triển khai chính:

```text
Một API client chung
-> Response/error contract thống nhất
-> Auth refresh an toàn
-> Query key ổn định
-> Cache/invalidation rõ ràng
-> Error map được sang UI/form/page state
-> Không cache/lộ dữ liệu nhạy cảm
-> Module nghiệp vụ chỉ tập trung vào business UI
```

Sau FRONTEND-04, đội frontend có thể tiếp tục triển khai:

```text
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
```

Trong đó FRONTEND-05 dùng API/query layer này để load session, app registry, sidebar state, notification badge và các dữ liệu layout-level cần thiết.
