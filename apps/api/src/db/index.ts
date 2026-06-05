import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "../config/env.schema";
import * as schema from "./schema";

const env = loadEnv();

/**
 * Pool QUA PgBouncer (transaction-mode) — đường đi của MỌI query nghiệp vụ.
 * Lazy: pg.Pool không mở kết nối cho tới query đầu tiên → API vẫn boot khi DB chưa lên.
 *
 * ⚠️ G2-2 sẽ bọc bằng `withTenant(companyId, fn)`:
 *   tx.execute(sql`select set_config('app.current_company_id', ${companyId}, true)`)
 *   chạy bên trong transaction (set_config ...,true = transaction-scoped, an toàn với pooler).
 *   GIỮ chỗ này — đừng query nghiệp vụ trực tiếp trên `db` mà không qua withTenant.
 */
export const pool: Pool | undefined = env.DATABASE_URL
  ? new Pool({ connectionString: env.DATABASE_URL, max: 20 })
  : undefined;

/** Pool DIRECT (không qua pooler) — migration · LISTEN/NOTIFY · BullMQ. */
export const directPool: Pool | undefined = env.DATABASE_DIRECT_URL
  ? new Pool({ connectionString: env.DATABASE_DIRECT_URL, max: 5 })
  : undefined;

/**
 * Pool WORKER (direct, role mediaos_worker) — outbox worker (G2-4). Session bền, KHÔNG qua PgBouncer.
 * Fallback directPool nếu chưa cấu hình DATABASE_WORKER_URL (dev tiện; prod nên tách role).
 */
export const workerPool: Pool | undefined = env.DATABASE_WORKER_URL
  ? new Pool({ connectionString: env.DATABASE_WORKER_URL, max: 4 })
  : directPool;

export type Database = NodePgDatabase<typeof schema>;

/** Drizzle client trên pool đã pool-hoá. `undefined` khi chưa cấu hình DATABASE_URL. */
export const db: Database | undefined = pool ? drizzle(pool, { schema }) : undefined;

/** Drizzle client cho worker (đọc/cập nhật outbox qua directPool). */
export const workerDb: Database | undefined = workerPool
  ? drizzle(workerPool, { schema })
  : undefined;

export { schema };
