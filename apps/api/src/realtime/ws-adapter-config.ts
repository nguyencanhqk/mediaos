/**
 * Suy cấu hình Socket.IO từ env — TÁCH RIÊNG khỏi `ValkeyIoAdapter` để unit-test được THUẦN TUÝ
 * (không cần dựng HTTP server, không cần ioredis, không cần Nest DI).
 *
 * S7-CHAT-RT-0.
 */

/** Tách `CORS_ORIGIN` dạng `"a, b ,c"` → `["a","b","c"]`; bỏ phần tử rỗng (dấu phẩy thừa). */
export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Origin này có được phép BẮT TAY WS không.
 *
 * ⚠️ Vì sao KHÔNG thể dựa vào riêng option `cors` của engine.io: engine.io chỉ làm
 * `this.use(require("cors")(this.opts.cors))` (engine.io@6.6.8 `build/server.js:61-62`). Middleware
 * `cors`, khi origin KHÔNG khớp allowlist, chỉ **bỏ header** `Access-Control-Allow-Origin` rồi gọi
 * `next()` — nó KHÔNG BAO GIỜ từ chối request. Handshake vẫn THÀNH CÔNG ở tầng server; chỉ TRÌNH DUYỆT
 * tự chặn vì đọc thiếu header. Hệ quả: mọi client không-phải-trình-duyệt (script Node, curl, app mobile)
 * đi xuyên qua như thể không có CORS, và một test bằng client Node KHÔNG chứng minh được điều gì về việc
 * "origin lạ bị từ chối".
 * ⇒ Cưỡng chế THẬT nằm ở `allowRequest` (engine.io `build/server.js:153-161` → `Server.errors.FORBIDDEN`),
 * chạy được cho MỌI loại client. `cors` giữ nguyên bên cạnh để trình duyệt nhận đúng header ở đường hợp lệ.
 *
 * Request KHÔNG mang header `Origin` được CHO PHÉP: `Origin` là thứ trình duyệt tự gắn và không thể giả
 * mạo được từ JS; vắng nó nghĩa là client không-phải-trình-duyệt, mà CORS vốn không phải cơ chế xác thực
 * cho nhóm đó. Cổng bảo mật thật của WS là JWT ở handshake middleware (`realtime.gateway.ts`) — CORS chỉ
 * chặn trang web lạ mượn phiên trình duyệt của người dùng.
 */
export function isOriginAllowed(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (origin === undefined || origin === "") return true;
  if (allowlist.includes("*")) return true;
  return allowlist.includes(origin);
}

/** Lấy tên database từ một connection string Postgres; `undefined` nếu URL vắng/không parse được. */
function databaseNameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * **Danh tính môi trường** dùng cho MỌI không gian khoá trên Valkey dùng chung.
 *
 * ══ VÌ SAO PHẢI CÓ ══
 * Cả bốn môi trường của dự án (`.env` PROD · `.env.dev` · `.env.dev-online` · `apps/api/.env` test-only)
 * đều trỏ **CÙNG MỘT** Valkey `redis://localhost:6379`, và Valkey **không** có tiền tố kênh sẵn. Bất kỳ
 * khoá nào không mang danh tính môi trường sẽ bị hai môi trường cùng đọc-ghi: tiến trình test trên máy dev
 * phát/nhận đúng kênh PROD đang dùng, hoặc người đang mở dev-online hiện "đang online" với người dùng PROD.
 *
 * Phạm vi = `{NODE_ENV}:{db}` — hai tiến trình chỉ chung không gian khoá khi chúng phục vụ CÙNG một cơ sở
 * dữ liệu ở CÙNG một chế độ chạy. Đo thật 06/08/2026:
 *   PROD `production:mediaos` · dev-online `development:mediaos_dev` · dev local `development:mediaos`
 *   · lane test `test:mediaos_<lane>` — bốn giá trị PHÂN BIỆT từng đôi một.
 * `LANE_DB` thắng khi có, vì đó chính là DB mà tiến trình test đang phục vụ (`apps/api/vitest.config.ts`).
 *
 * ⚠️ Một phép suy DUY NHẤT cho cả kênh Socket.IO lẫn khoá presence (`ChatPresenceService`, S8-CHAT-UX-RT-1).
 * Viết phép thứ hai là mở cửa cho hai không gian khoá lệch nhau rồi trôi mà không ai đo được.
 */
export function resolveEnvScope(
  env: { NODE_ENV: string; DATABASE_URL?: string },
  laneDb?: string,
): string {
  const db = laneDb?.trim() || databaseNameOf(env.DATABASE_URL) || "nodb";
  return `${env.NODE_ENV}:${db}`;
}

/**
 * Tiền tố kênh pub/sub Valkey cho `@socket.io/redis-adapter`.
 *
 * BẮT BUỘC phải truyền: `createAdapter(pub, sub)` không kèm `opts.key` dùng mặc định `"socket.io"` —
 * xem `resolveEnvScope` cho lý do đầy đủ.
 */
export function resolveValkeyChannelKey(
  env: { NODE_ENV: string; DATABASE_URL?: string },
  laneDb?: string,
): string {
  return `socket.io:${resolveEnvScope(env, laneDb)}`;
}
