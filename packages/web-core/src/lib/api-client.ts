import { z } from "zod";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, authRefreshResponseSchema } from "@mediaos/contracts";
import { getAccessToken, useAuthStore } from "../stores/auth";
import { type ApiErrorKind, mapStatusToErrorKind } from "./api-error-kind";
import { createRequestId } from "./api-request-id";

const DEFAULT_API_URL = "http://localhost:3100/api/v1";
let apiBaseUrl = DEFAULT_API_URL;

// App đăng nhập trung tâm (apps/auth). Khi phiên hỏng/không có → điều hướng tới đây kèm `?redirect=<đích>`.
// Dev mặc định subdomain *.localhost (cookie Domain=.localhost) để giống prod. Mỗi product app cấu hình từ
// build env của nó (VITE_AUTH_APP_URL) qua `configureAuthAppUrl` — KHÔNG đọc `import.meta` trong package.
const DEFAULT_AUTH_APP_URL = "http://auth.localhost:5275";
let authAppUrl = DEFAULT_AUTH_APP_URL;

// X-Client-Type / X-Client-Version header constants.
// Version hard-coded to '0.1.0' here; app can override via configureClient() (TODO: S1-FE-QUERY-WIRE-1).
const CLIENT_TYPE = "web";
let clientVersion = "0.1.0";

/**
 * Cấu hình base URL của API. Mỗi app gọi MỘT lần lúc khởi động, truyền giá trị từ
 * build env của nó (vd `import.meta.env.VITE_API_URL`). Tách `import.meta` ra khỏi
 * package dùng chung để web-core build sạch dual ESM/CJS (không phụ thuộc bundler-ism).
 * Bỏ qua giá trị rỗng/undefined → giữ default dev.
 */
export function configureApiBaseUrl(url: string | undefined | null): void {
  if (url) apiBaseUrl = url;
}

/** Base URL hiện tại của API (mặc định: local dev). */
export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/** Cấu hình URL app đăng nhập trung tâm (apps/auth). Bỏ qua rỗng → giữ default dev *.localhost. */
export function configureAuthAppUrl(url: string | undefined | null): void {
  if (url) authAppUrl = url;
}

/**
 * Cấu hình X-Client-Version (từ build env của app, vd `import.meta.env.VITE_APP_VERSION`).
 * Tách ra để web-core không đọc import.meta trực tiếp. TODO: gọi ở S1-FE-QUERY-WIRE-1 shell.
 */
export function configureClientVersion(version: string | undefined | null): void {
  if (version) clientVersion = version;
}

/**
 * Gỡ envelope chuẩn của API ({ success, data, error }) nếu có, ngược lại trả nguyên body.
 * API thật (main.ts ResponseEnvelopeInterceptor) luôn bọc envelope; một số test mock body trần.
 * Tolerant unwrap → cùng client chạy đúng cả 2 hình dạng.
 */
export function unwrapEnvelope(json: unknown): unknown {
  if (
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    "data" in json &&
    "error" in json
  ) {
    return (json as { data: unknown }).data;
  }
  return json;
}

// ── Object-arg input shape for ApiError constructor ───────────────────────────

interface ApiErrorInput {
  message: string;
  kind?: ApiErrorKind;
  status?: number;
  code?: string;
  type?: string;
  details?: unknown;
  requestId?: string;
  raw?: unknown;
}

/**
 * Lỗi HTTP có cấu trúc — mang theo `status` (mã HTTP) + `code` (mã lỗi nghiệp vụ của BE
 * lấy từ envelope { error: { code } }). UI bắt theo `status`/`code` (vd publish 422,
 * double-publish/conflict 409) thay vì so khớp chuỗi message.
 *
 * CONSTRUCTOR OVERLOAD (rev2):
 *   - Positional: `new ApiError(status, code, message)` — BACK-COMPAT, 3 external construct-sites
 *     (auth-api.spec.ts:76, apps/auth/login.spec.tsx:108,171) KHÔNG cần thay đổi.
 *   - Object-arg: `new ApiError({ message, kind?, status?, code?, type?, details?, requestId?, raw? })`
 *     — dùng trong toApiError() để đính đầy đủ context từ envelope mới.
 *
 * NOTE: `status` và `code` là REQUIRED readonly trên instance (positional luôn set đủ; object-arg
 * default status??0, code??'HTTP_ERROR'). Lệch nhẹ FRONTEND-04 §10.1 (đặt optional) nhưng an toàn
 * cho consumer cũ đọc .status/.code — ghi comment deviation.
 *
 * BẤT BIẾN BE (AllExceptionsFilter): mọi lỗi bị bọc thành { success:false, error:{ code, message } }
 * — payload nghiệp vụ phụ (vd dagValidation của publish 422) BỊ DẸP, không tới client. Vì vậy
 * UI tự dựng lại chi tiết (vd chạy validateDag client-side) khi cần danh sách lỗi inline.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly type?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly raw?: unknown;

  constructor(status: number, code: string, message: string);
  constructor(input: ApiErrorInput);
  constructor(a: number | ApiErrorInput, b?: string, c?: string) {
    if (typeof a === "number") {
      // Positional form: new ApiError(status, code, message) — BACK-COMPAT
      super(c ?? "");
      this.name = "ApiError";
      this.status = a;
      this.code = b ?? "HTTP_ERROR";
      this.kind = mapStatusToErrorKind(a, b);
    } else {
      // Object-arg form: new ApiError({ message, kind?, status?, ... })
      super(a.message);
      this.name = "ApiError";
      this.status = a.status ?? 0;
      this.code = a.code ?? "HTTP_ERROR";
      this.kind = a.kind ?? mapStatusToErrorKind(this.status, this.code, a.type);
      this.type = a.type;
      this.details = a.details;
      this.requestId = a.requestId;
      this.raw = a.raw;
    }
  }
}

/**
 * Bóc { error: { code, type, details, message }, meta: { request_id } } từ body lỗi (envelope chuẩn)
 * → ApiError với đầy đủ kind/type/details/requestId; fallback nếu body không phải JSON.
 */
function toApiError(status: number, path: string, rawBody: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as { error: unknown }).error !== null &&
      typeof (parsed as { error: unknown }).error === "object"
    ) {
      const envelope = parsed as {
        error: { code?: unknown; message?: unknown; type?: unknown; details?: unknown };
        meta?: { request_id?: unknown };
        message?: unknown;
      };
      const err = envelope.error;
      const code = typeof err.code === "string" ? err.code : "HTTP_ERROR";
      const type = typeof err.type === "string" ? err.type : undefined;
      const details = err.details;
      const message =
        typeof err.message === "string"
          ? err.message
          : typeof envelope.message === "string"
            ? envelope.message
            : `${status} ${path}`;
      const requestId =
        typeof envelope.meta?.request_id === "string" && envelope.meta.request_id !== ""
          ? envelope.meta.request_id
          : undefined;

      return new ApiError({ status, code, type, details, requestId, message });
    }
  } catch {
    // body không phải JSON — rơi xuống fallback bên dưới.
  }
  return new ApiError(status, "HTTP_ERROR", `${status} ${path}: ${rawBody}`.trim());
}

// ── FS-1b SSO session lifecycle ──────────────────────────────────────────────
//
// access token CHỈ in-memory (Zustand). refresh token NẰM TRONG HttpOnly cookie (`mediaos_rt`) — JS KHÔNG
// đọc được. Mọi fetch gửi `credentials:'include'` để cookie tự đính kèm. Khi load app → silent-refresh; khi
// một request authed nhận 401 → refresh-on-401 (xếp hàng single-flight) rồi REPLAY 1 lần. Refresh fail →
// điều hướng về apps/auth. KHÔNG log/serialize token bao giờ.

/**
 * "Epoch" phiên — tăng mỗi khi phiên bị vô hiệu hoá (logout / redirect). `refreshAccessToken` chụp epoch lúc
 * bắt đầu; nếu epoch đổi giữa chừng (user logout trong lúc refresh đang bay) → KHÔNG commit access token mới
 * (chống lost-update: re-auth oan người vừa đăng xuất). Chỉ tăng nội bộ, không lộ token.
 */
let authEpoch = 0;

/** Vô hiệu hoá phiên hiện tại (logout/redirect) — refresh đang bay sẽ không commit token nữa. */
export function invalidateSession(): void {
  authEpoch += 1;
}

/** Đọc cookie CSRF (`mediaos_csrf`, KHÔNG HttpOnly) để echo qua header double-submit. null nếu vắng/không có DOM. */
function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const entry of cookies) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    if (entry.slice(0, eq) === CSRF_COOKIE_NAME) {
      return decodeURIComponent(entry.slice(eq + 1));
    }
  }
  return null;
}

/** Promise refresh đang bay (single-flight). null = không có refresh nào đang chạy. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Gọi POST /auth/refresh (cookie-first): cookie `mediaos_rt` tự gửi qua credentials, kèm header CSRF =
 * cookie `mediaos_csrf`. Thành công → nạp access token mới in-memory, trả true. Mọi thất bại (vắng CSRF /
 * !ok / schema sai / network) → false (KHÔNG ném — caller quyết redirect). Dùng `fetch` THẲNG (KHÔNG apiFetch)
 * để KHÔNG đệ quy vào nhánh refresh-on-401 (chống vòng lặp refresh vô hạn).
 */
async function doRefresh(): Promise<boolean> {
  const epoch = authEpoch; // chụp epoch lúc bắt đầu (E9: logout-trong-lúc-refresh)
  const csrf = readCsrfCookie();
  // Không có cookie CSRF → chắc chắn không có phiên (CSRF cookie phát/xoá cùng refresh cookie). Bỏ qua round-trip.
  if (!csrf) return false;
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrf,
      },
      body: "{}",
    });
  } catch {
    return false; // network error — KHÔNG retry, KHÔNG lộ chi tiết
  }
  if (!res.ok) return false; // 401 (reuse/expired) / 403 (CSRF) → phiên chết, redirect ở caller
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return false;
  }
  const parsed = authRefreshResponseSchema.safeParse(unwrapEnvelope(json));
  if (!parsed.success) {
    // 200 nhưng body SAI schema = CONTRACT DRIFT (deploy skew / proxy trả HTML-200), KHÔNG phải hết phiên.
    // Vẫn false (an toàn: caller redirect login) NHƯNG phát tín hiệu để operator phân biệt với 401-thật.
    console.error(
      "[web-core] /auth/refresh trả 200 nhưng body sai authRefreshResponseSchema (contract drift)",
    );
    return false;
  }
  // Chỉ commit nếu phiên CHƯA bị vô hiệu hoá trong lúc refresh bay (E9).
  if (epoch !== authEpoch) return false;
  useAuthStore.getState().setAccessToken(parsed.data.accessToken);
  return true;
}

/**
 * Refresh access token SINGLE-FLIGHT: nhiều request 401 đồng thời → ĐÚNG 1 lần gọi /auth/refresh, tất cả chờ
 * chung 1 promise rồi replay. BẤT BIẾN crown: KHÔNG bao giờ 2 refresh song song cho cùng token xoay (server
 * reuse-detection sẽ thu hồi cả họ token → đăng xuất oan). Dùng `if (=== null)` (short-circuit tường minh,
 * an toàn dual ESM/CJS) thay `??=`. `.finally` xoá cờ → chu kỳ refresh kế tiếp (token đã xoay) chạy được.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight === null) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Đăng xuất TOÀN CỤC: gọi POST /auth/logout (cookie-first + CSRF) → server thu hồi cả họ refresh token + xoá
 * cookie. Best-effort (nuốt lỗi mạng) NHƯNG luôn xoá state cục bộ + điều hướng về apps/auth. Vô hiệu hoá phiên
 * TRƯỚC (epoch) để refresh đang bay không tái-auth oan. Dùng fetch thẳng (KHÔNG apiFetch → không kích refresh).
 */
export async function logoutSession(): Promise<void> {
  invalidateSession();
  const csrf = readCsrfCookie();
  try {
    await fetch(`${getApiBaseUrl()}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
      },
      body: "{}",
    });
  } catch {
    // Mạng lỗi — vẫn xoá state cục bộ + điều hướng (cookie sẽ hết hạn/được dọn ở lần sau).
  }
  useAuthStore.getState().logout();
  redirectToAuth();
}

/** Đã phát lệnh điều hướng về apps/auth — chống nhiều 401 cùng lúc gọi assign() nhiều lần. */
let redirecting = false;

/**
 * URL app đăng nhập trung tâm kèm `?redirect=<đích hiện tại>` (đã encode). Dùng cho cả `redirectToAuth`
 * (window.location) lẫn route guard của app (TanStack `throw redirect({ href })`). Server (qua
 * /auth/redirect-allowed) là nguồn allowlist DUY NHẤT khi apps/auth bật lại sau đăng nhập.
 */
export function getAuthRedirectUrl(): string {
  const here = typeof window !== "undefined" ? encodeURIComponent(window.location.href) : "";
  return `${authAppUrl}/login?redirect=${here}`;
}

/**
 * Điều hướng về app đăng nhập trung tâm khi phiên hỏng (refresh fail / boot không có phiên). No-op khi không
 * có `window` (CJS/SSR). Vô hiệu hoá phiên (epoch) để refresh đang bay không commit token nữa. Cờ `redirecting`
 * chỉ DEDUPE các lời gọi trong cùng một burst đồng bộ (nhiều 401 cùng lúc → assign 1 lần); reset ở macrotask
 * kế để KHÔNG kẹt vĩnh viễn nếu điều hướng bị chặn hay tab khôi phục từ bfcache (lần hết phiên sau vẫn redirect).
 */
export function redirectToAuth(): void {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  invalidateSession();
  window.location.assign(getAuthRedirectUrl());
  setTimeout(() => {
    redirecting = false;
  }, 0);
}

/**
 * Extended options for apiFetch (additive — opts vẫn optional, tham số thứ 4 BACK-COMPAT).
 * Không đụng 3 tham số đầu (path, schema, init).
 */
export interface ApiFetchOpts {
  /** Bỏ qua Bearer token + refresh-on-401 (login / public endpoints). */
  skipAuth?: boolean;
  /**
   * Idempotency key cho action quan trọng (check-in, tạo đơn nghỉ, v.v.).
   * Khi set → gắn header `Idempotency-Key`. KHÔNG gắn khi undefined. (FRONTEND-04 §11.3)
   */
  idempotencyKey?: string;
  /** Override request ID (thường để test). Mặc định tự sinh qua createRequestId(). */
  requestId?: string;
}

/**
 * Thực hiện 1 lần fetch tới API: gắn Bearer (trừ skipAuth) + credentials:'include' + Content-Type
 * + X-Request-Id + X-Client-Type + X-Client-Version mỗi request.
 * Idempotency-Key chỉ khi opts.idempotencyKey được truyền.
 *
 * CROWN (FS-1b): doRefresh() dùng fetch THẲNG (không qua rawFetch) → KHÔNG nhận header mới này
 * → refresh path KHÔNG bị ảnh hưởng. Header inject chỉ áp lên các request nghiệp vụ thông thường.
 */
function rawFetch(
  path: string,
  init: RequestInit | undefined,
  token: string | null,
  opts?: ApiFetchOpts,
): Promise<Response> {
  const reqId = opts?.requestId ?? createRequestId();
  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": reqId,
      "X-Client-Type": CLIENT_TYPE,
      "X-Client-Version": clientVersion,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      ...init?.headers,
    },
  });
}

/** Parse 1 Response (đã !401-handled) → T qua Zod schema. Ném ApiError nếu !ok. */
async function finishResponse<T>(res: Response, schema: z.ZodType<T>, path: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw toApiError(res.status, path, body);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(unwrapEnvelope(json));
}

/**
 * HTTP client dùng chung cho mọi API module — parse response bằng Zod schema.
 *
 * SSO (FS-1b): luôn gửi `credentials:'include'` (refresh cookie tự đính kèm). Nếu request authed nhận 401 →
 * refresh-on-401: gọi `refreshAccessToken()` (single-flight) rồi REPLAY ĐÚNG 1 LẦN với token mới. Refresh
 * fail → `redirectToAuth()` + ném 401. KHÔNG vòng lặp: replay đi thẳng tới `finishResponse` (kể cả nếu replay
 * lại 401) — KHÔNG quay lại nhánh refresh; refresh dùng fetch thẳng nên cũng không đệ quy.
 *
 * Opts (tham số thứ 4, optional — BACK-COMPAT): { skipAuth?, idempotencyKey?, requestId? }
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  opts?: ApiFetchOpts,
): Promise<T> {
  // Endpoint công khai (login / 2FA verify / redirect-allowed) PHẢI opt-out: không rò Bearer phiên cũ lên route
  // chưa xác thực, và 401 của chúng KHÔNG kích hoạt refresh (không có phiên để refresh).
  const token = opts?.skipAuth ? null : getAccessToken();
  const res = await rawFetch(path, init, token, opts);

  if (res.status === 401 && !opts?.skipAuth) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToAuth();
      throw new ApiError({
        status: 401,
        code: "AUTH-ERR-UNAUTHENTICATED",
        kind: "UNAUTHENTICATED",
        message: "Phiên đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }
    // REPLAY 1 LẦN với access token mới. Kết quả (kể cả 401 lần nữa) đi thẳng tới finishResponse — KHÔNG refresh lại.
    const replay = await rawFetch(path, init, getAccessToken(), opts);
    return finishResponse(replay, schema, path);
  }

  return finishResponse(res, schema, path);
}
