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
 * Tiền tố kênh pub/sub Valkey cho `@socket.io/redis-adapter`.
 *
 * BẮT BUỘC phải truyền: `createAdapter(pub, sub)` không kèm `opts.key` dùng mặc định `"socket.io"`, mà
 * CẢ BỐN môi trường của dự án (`.env`, `.env.dev`, `.env.prod`, `apps/api/.env` test-only) đều trỏ CÙNG
 * MỘT Valkey `redis://localhost:6379`. Không tiền tố ⇒ int-spec chạy trên máy dev phát/nhận trên ĐÚNG
 * kênh mà PROD đang dùng, tức là nối thẳng tiến trình test vào cụm Socket.IO PROD.
 *
 * Khoá = `socket.io:{NODE_ENV}:{db}` — hai tiến trình chỉ chung kênh broadcast khi chúng phục vụ CÙNG một
 * cơ sở dữ liệu ở CÙNG một chế độ chạy. `LANE_DB` thắng khi có, vì đó chính là DB mà tiến trình test đang
 * phục vụ (`apps/api/vitest.config.ts`).
 */
export function resolveValkeyChannelKey(
  env: { NODE_ENV: string; DATABASE_URL?: string },
  laneDb?: string,
): string {
  const db = laneDb?.trim() || databaseNameOf(env.DATABASE_URL) || "nodb";
  return `socket.io:${env.NODE_ENV}:${db}`;
}
