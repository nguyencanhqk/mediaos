import { Pool, type PoolClient } from "pg";

/**
 * Tiện ích cho integration test chạy trên Postgres THẬT (CI; local cần Docker).
 *
 * Quy ước: thiếu DATABASE_URL ⇒ coi như không có DB ⇒ test integration TỰ SKIP (không đỏ giả).
 * RLS chỉ kiểm chứng được trên Postgres thật — KHÔNG mock (plan G2 mục 6 / rủi ro "ảo tưởng xanh").
 */

export const directUrl = process.env.DATABASE_DIRECT_URL;
export const appUrl = process.env.DATABASE_URL;
export const workerUrl = process.env.DATABASE_WORKER_URL;
// PGBOUNCER_URL = mediaos_app QUA PgBouncer transaction-mode (:6432). Chỉ set khi test cần kiểm chứng
// tenant isolation giữ vững qua pooled connection bị tái dùng (GX-4). Vắng ⇒ pgbouncer-spec tự skip.
export const pgbouncerUrl = process.env.PGBOUNCER_URL;

/** Có đủ điều kiện chạy integration test không (cần cả direct + app URL). */
export const hasDb = Boolean(directUrl && appUrl);

/** Có PgBouncer để kiểm chứng tenant isolation qua pooled connection không (cần cả DB + PGBOUNCER_URL). */
export const hasPgBouncer = Boolean(hasDb && pgbouncerUrl);

// LƯU Ý: các factory này được gọi NGAY trong thân `describe.skipIf` (Vitest vẫn chạy factory để thu
// thập test dù suite bị skip). Vì vậy KHÔNG throw ở đây — chỉ tạo Pool (lazy connect). Khi suite skip,
// Pool không bao giờ query/connect ⇒ vô hại. Khi chạy thật (CI), URL đã có trong env.

/** Pool kết nối DIRECT bằng superuser/owner — dùng để seed/teardown + DDL trong test. */
export function directPool(): Pool {
  return new Pool({ connectionString: directUrl, max: 4 });
}

/**
 * Pool kết nối bằng mediaos_app (qua PgBouncer nếu DATABASE_URL trỏ :6432).
 * `max` mặc định 1 để test được hành vi tái dùng connection (PgBouncer×RLS, G2-2).
 */
export function appPool(max = 1): Pool {
  return new Pool({ connectionString: appUrl, max });
}

/** Pool kết nối bằng mediaos_worker (direct). Fallback DATABASE_URL nếu chưa set worker URL. */
export function workerPool(max = 1): Pool {
  return new Pool({ connectionString: workerUrl ?? appUrl, max });
}

/**
 * Pool kết nối mediaos_app QUA PgBouncer (PGBOUNCER_URL, :6432). `max=1` ÉP tái dùng đúng 1 server-connection
 * để test được hành vi GUC reset giữa các transaction (PgBouncer transaction-mode × RLS, GX-4).
 *
 * PgBouncer transaction-mode KHÔNG an toàn với server-side prepared statements ⇒ tắt qua `statement_timeout`
 * không liên quan; điều cần là pg client KHÔNG cache named prepared statements. node-postgres chỉ dùng
 * prepared statement khi truyền `name` trong query config — các test ở đây dùng query text thuần (simple/
 * parametrized không tên) nên an toàn qua pooler. (docker-compose: IGNORE_STARTUP_PARAMETERS đã set.)
 */
export function pgbouncerPool(max = 1): Pool {
  return new Pool({ connectionString: pgbouncerUrl, max });
}

/** Chạy `fn` với 1 client mượn từ pool rồi trả lại (đảm bảo release kể cả khi throw). */
export async function withClient<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Session-level advisory lock dùng để SERIALIZE các suite cùng mutate bảng GLOBAL `encryption_keys`
 * (registry no-RLS, không theo tenant). Vitest chạy file int-spec SONG SONG ⇒ nhiều fork cùng đổi
 * registry sẽ đua nhau (vd suite-A reset v1-active trong khi suite-B đang chờ v2-active) → false-RED.
 * Khoá theo một KEY cố định: chỉ 1 suite registry-mutating chạy tại một thời điểm trên cùng DB.
 *
 * Giữ một CLIENT riêng suốt vòng đời suite (advisory lock là session-scoped). Gọi `release()` ở afterAll.
 */
export const ENCRYPTION_KEYS_LOCK_KEY = 962_006_002; // hằng số (G6-2): "G6-2" registry lock
export async function acquireRegistryLock(pool: Pool): Promise<{ release: () => Promise<void> }> {
  const client = await pool.connect();
  await client.query("SELECT pg_advisory_lock($1)", [ENCRYPTION_KEYS_LOCK_KEY]);
  return {
    release: async () => {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [ENCRYPTION_KEYS_LOCK_KEY]);
      } finally {
        client.release();
      }
    },
  };
}
