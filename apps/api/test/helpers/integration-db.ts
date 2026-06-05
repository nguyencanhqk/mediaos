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

/** Có đủ điều kiện chạy integration test không (cần cả direct + app URL). */
export const hasDb = Boolean(directUrl && appUrl);

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

/** Chạy `fn` với 1 client mượn từ pool rồi trả lại (đảm bảo release kể cả khi throw). */
export async function withClient<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
